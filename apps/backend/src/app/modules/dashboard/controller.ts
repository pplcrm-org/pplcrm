import { sql } from 'kysely';

import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import { calculateWorkingTimeMs, TASK_OPEN_STATUSES } from '../../../../../../libs/common/src';
import { BaseRepository } from '../../lib/base.repo';
import { checkRateLimit } from '../../lib/rate-limiter';
import { settingsMapFrom, slaPolicyFrom } from '../../lib/sla-policy';
import { IN_FIELD_WINDOW_MS } from '../canvassing/controller';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import {
  dashboardRefreshPending,
  enqueueDashboardStatsRefresh,
  readLatestDashboardSnapshot,
} from './dashboard-stats.service';

/** Inbox / Sent folder ids, as everywhere else in the emails module. */
const INBOX_FOLDER_ID = '11';
const SENT_FOLDER_ID = '3';

/** Manual snapshot refreshes per tenant per window — the button is coalesced anyway; this stops a held-down key. */
const REFRESH_RATE_LIMIT = 3;
const REFRESH_RATE_WINDOW_MS = 5 * 60 * 1000;

const MS_PER_HOUR = 1000 * 60 * 60;

interface BreachedEmailCandidate {
  id: string;
  from_email: string | null;
  subject: string | null;
  created_at: Date;
  assigned_to: string | null;
  first_comment_at: Date | null;
  first_outbound_at: Date | null;
}

interface BreachedEmail {
  id: string;
  from_email: string | null;
  subject: string | null;
  created_at: Date | string;
  assigned_to: string | null;
  assignee_name: string | null;
  working_time_hours: number;
}

interface BreachedTask {
  id: string;
  name: string;
  created_at: Date | string;
  assigned_to: string | null;
  assignee_name: string | null;
  working_time_hours: number;
}

/**
 * Dashboard reads, split live/snapshot (REVIEW6 T1-3).
 *
 * LIVE (computed here, every call, always bounded): open-inbox counts per assignee, the oldest
 * unassigned email, and the two SLA-breach lists. "Bounded" is structural, not hopeful — the open
 * queries read only `status='open'` rows, and every breach candidate set carries a calendar-age
 * pre-filter in SQL (`created_at <= now() - SLA`), which can never miss a breach because
 * working-hours age is always ≤ calendar age. The working-hours arithmetic then runs only on the
 * survivors.
 *
 * SNAPSHOT (read here, computed by the `refresh_dashboard_stats*` background jobs): windowed
 * closed counts and the first-response / time-to-close averages — see dashboard-stats.service.ts.
 * The only write this controller ever queues from a read path is the one-time "no snapshot exists
 * yet" bootstrap, which is coalesced.
 *
 * The old implementation read every inbox email, task, close-activity row, and sent-email
 * recipient the tenant ever had, on every page view. Nothing here may reintroduce an unbounded
 * read; the specs pin the SQL shapes.
 */
export class DashboardController {
  private get db() {
    return BaseRepository.dbInstance;
  }

  private async loadSla(tenant_id: string) {
    const settingsRows = await new SettingsRepo().getAllForTenant(tenant_id);
    return slaPolicyFrom(settingsMapFrom(settingsRows));
  }

  /**
   * Open inbox emails older (calendar) than the SLA, each with its first-response probes resolved
   * in the same query. The two laterals are index probes (idx_email_recipients_to_address /
   * email_comments PK path), not scans.
   */
  private async breachedEmailCandidates(tenant_id: string, emailSlaMs: number): Promise<BreachedEmailCandidate[]> {
    const cutoff = new Date(Date.now() - emailSlaMs);
    const res = await sql<BreachedEmailCandidate>`
      SELECT
        e.id::text AS id,
        e.from_email,
        e.subject,
        e.created_at,
        e.assigned_to::text AS assigned_to,
        cm.first_comment_at,
        snt.first_outbound_at
      FROM emails e
      LEFT JOIN LATERAL (
        SELECT min(c.created_at) AS first_comment_at
        FROM email_comments c
        WHERE c.tenant_id = ${tenant_id} AND c.email_id = e.id
      ) cm ON true
      LEFT JOIN LATERAL (
        SELECT min(e2.created_at) AS first_outbound_at
        FROM email_recipients r
        JOIN emails e2 ON e2.id = r.email_id AND e2.tenant_id = ${tenant_id}
        WHERE r.tenant_id = ${tenant_id}
          AND r.kind = 'to'
          AND lower(r.email) = lower(btrim(e.from_email))
          AND e2.folder_id = ${SENT_FOLDER_ID}
          AND e2.created_at > e.created_at
      ) snt ON true
      WHERE e.tenant_id = ${tenant_id}
        AND e.folder_id = ${INBOX_FOLDER_ID}
        AND e.status = 'open'
        AND e.created_at <= ${cutoff}
    `.execute(this.db);
    return res.rows;
  }

  /** Same rule as always: breached = past the working-hours SLA with no first response of any kind. */
  private breachedEmailsFrom(
    candidates: BreachedEmailCandidate[],
    sla: Awaited<ReturnType<DashboardController['loadSla']>>,
    userMap: Map<string, string>,
  ): BreachedEmail[] {
    const emailSlaMs = sla.emailSlaHours * MS_PER_HOUR;
    const now = new Date();
    const breached: BreachedEmail[] = [];
    for (const email of candidates) {
      const createdAt = new Date(email.created_at);
      const responseTimes = [email.first_comment_at, email.first_outbound_at]
        .filter((t): t is Date => t != null)
        .map((t) => new Date(t).getTime())
        .filter((t) => t > createdAt.getTime());
      if (responseTimes.length > 0) continue;

      const workingTimeMs = calculateWorkingTimeMs(
        createdAt,
        now,
        sla.workingDays,
        sla.workingHoursStart,
        sla.workingHoursEnd,
        sla.timeZone,
      );
      if (workingTimeMs <= emailSlaMs) continue;

      breached.push({
        id: email.id,
        from_email: email.from_email,
        subject: email.subject || null,
        created_at: email.created_at,
        assigned_to: email.assigned_to,
        assignee_name: email.assigned_to ? userMap.get(email.assigned_to) || null : null,
        working_time_hours: Math.round(workingTimeMs / MS_PER_HOUR),
      });
    }
    breached.sort((a, b) => b.working_time_hours - a.working_time_hours);
    return breached;
  }

  /** Open tasks past the working-hours SLA; candidates pre-filtered by calendar age in SQL. */
  private async breachedTasksList(
    tenant_id: string,
    sla: Awaited<ReturnType<DashboardController['loadSla']>>,
    userMap: Map<string, string>,
  ): Promise<BreachedTask[]> {
    const taskSlaMs = sla.taskSlaHours * MS_PER_HOUR;
    const cutoff = new Date(Date.now() - taskSlaMs);
    const openTasks = await this.db
      .selectFrom('tasks')
      .select(['id', 'name', 'created_at', 'assigned_to'])
      .where('tenant_id', '=', tenant_id)
      .where('status', 'in', [...TASK_OPEN_STATUSES])
      .where('created_at', '<=', cutoff)
      .execute();

    const now = new Date();
    const breached: BreachedTask[] = [];
    for (const task of openTasks) {
      const workingTimeMs = calculateWorkingTimeMs(
        new Date(task.created_at),
        now,
        sla.workingDays,
        sla.workingHoursStart,
        sla.workingHoursEnd,
        sla.timeZone,
      );
      if (workingTimeMs <= taskSlaMs) continue;
      breached.push({
        id: String(task.id),
        name: task.name,
        created_at: task.created_at,
        assigned_to: task.assigned_to,
        assignee_name: task.assigned_to ? userMap.get(task.assigned_to) || null : null,
        working_time_hours: Math.round(workingTimeMs / MS_PER_HOUR),
      });
    }
    breached.sort((a, b) => b.working_time_hours - a.working_time_hours);
    return breached;
  }

  private async loadUserMap(tenant_id: string) {
    const users = await this.db
      .selectFrom('authusers')
      .select(['id', 'first_name', 'last_name'])
      .where('tenant_id', '=', tenant_id)
      .execute();
    const userMap = new Map<string, string>();
    for (const u of users) {
      userMap.set(String(u.id), `${u.first_name || ''} ${u.last_name || ''}`.trim());
    }
    return { users, userMap };
  }

  public async getStats(auth: IAuthKeyPayload) {
    const tenant_id = auth.tenant_id;
    const sla = await this.loadSla(tenant_id);
    const { taskSlaHours, emailSlaHours } = sla;
    const emailSlaMs = emailSlaHours * MS_PER_HOUR;

    const { users, userMap } = await this.loadUserMap(tenant_id);

    // The live working set: open inbox emails only. Closed mail is snapshot territory.
    const openEmails = await this.db
      .selectFrom('emails')
      .select(['id', 'created_at', 'assigned_to'])
      .where('tenant_id', '=', tenant_id)
      .where('folder_id', '=', INBOX_FOLDER_ID)
      .where('status', '=', 'open')
      .execute();

    const openCountByUser = new Map<string, number>();
    let unassignedCount = 0;
    let oldestUnassignedCreatedAt: Date | null = null;
    for (const email of openEmails) {
      if (email.assigned_to == null) {
        unassignedCount++;
        const created = new Date(email.created_at);
        if (!oldestUnassignedCreatedAt || created < oldestUnassignedCreatedAt) {
          oldestUnassignedCreatedAt = created;
        }
      } else {
        const key = String(email.assigned_to);
        openCountByUser.set(key, (openCountByUser.get(key) ?? 0) + 1);
      }
    }
    const totalOpenCount = openEmails.length;

    // 5.1 Oldest unassigned open inbox email → the "waiting for an owner" next-action card
    // (age since arrival + how long until the first-response SLA is due, in working time).
    let oldestUnassignedAgeHours: number | null = null;
    let firstResponseDueHours: number | null = null;
    if (oldestUnassignedCreatedAt) {
      oldestUnassignedAgeHours = (Date.now() - oldestUnassignedCreatedAt.getTime()) / MS_PER_HOUR;
      const workedMs = calculateWorkingTimeMs(
        oldestUnassignedCreatedAt,
        new Date(),
        sla.workingDays,
        sla.workingHoursStart,
        sla.workingHoursEnd,
        sla.timeZone,
      );
      firstResponseDueHours = Math.max(0, (emailSlaMs - workedMs) / MS_PER_HOUR);
    }

    // Live SLA breaches, both kinds, calendar-pre-filtered in SQL.
    const emailCandidates = await this.breachedEmailCandidates(tenant_id, emailSlaMs);
    const breachedEmails = this.breachedEmailsFrom(emailCandidates, sla, userMap);
    const breachedTasks = await this.breachedTasksList(tenant_id, sla, userMap);

    const emailBreachByUser = new Map<string, number>();
    let unassignedEmailSlaBreaches = 0;
    for (const b of breachedEmails) {
      if (b.assigned_to == null) unassignedEmailSlaBreaches++;
      else emailBreachByUser.set(b.assigned_to, (emailBreachByUser.get(b.assigned_to) ?? 0) + 1);
    }
    const taskBreachByUser = new Map<string, number>();
    let unassignedTaskSlaBreaches = 0;
    for (const b of breachedTasks) {
      if (b.assigned_to == null) unassignedTaskSlaBreaches++;
      else taskBreachByUser.set(b.assigned_to, (taskBreachByUser.get(b.assigned_to) ?? 0) + 1);
    }

    // 5. Contacts Growth (Last 30 days) — already bounded, unchanged.
    const growthRows = await this.db
      .selectFrom('persons')
      .select([sql<string>`date_trunc('day', created_at)`.as('day'), sql<number>`count(id)`.as('count')])
      .where('tenant_id', '=', tenant_id)
      .where('created_at', '>=', sql<Date>`now() - interval '30 days'`)
      .groupBy(sql`date_trunc('day', created_at)`)
      .orderBy(sql`date_trunc('day', created_at)`, 'asc')
      .execute();
    const contactsGrowth = growthRows.map((r) => ({
      date: r.day ? (new Date(r.day).toISOString().split('T')[0] ?? '') : '',
      count: Number(r.count || 0),
    }));

    // 5.2 Latest unsent (draft) newsletter → "ready to send" next-action card + briefing clause.
    const draftRow = await this.db
      .selectFrom('newsletters')
      .select(['id', 'name', 'total_recipients'])
      .where('tenant_id', '=', tenant_id)
      .where('status', '=', 'pending')
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const draftNewsletter = draftRow
      ? { id: String(draftRow.id), name: draftRow.name, total_recipients: Number(draftRow.total_recipients || 0) }
      : null;

    // 5.3 Upcoming volunteer events → "coming up" list (real rows only; empty state otherwise).
    const upcomingRows = await this.db
      .selectFrom('volunteer_events')
      .select(['id', 'name', 'start_time', 'capacity', 'location_address'])
      .where('tenant_id', '=', tenant_id)
      .where('start_time', '>=', new Date())
      .orderBy('start_time', 'asc')
      .limit(3)
      .execute();
    const upcomingEvents = upcomingRows.map((e) => ({
      id: String(e.id),
      name: e.name,
      start_time: new Date(e.start_time).toISOString(),
      capacity: e.capacity == null ? null : Number(e.capacity),
      location_address: e.location_address ?? null,
    }));

    // 5.4 Field operations: three cheap tenant-scoped counts over turf_knocks. The card
    // only renders for workspaces whose plan and modules allow field ops (decided in the
    // frontend with the sidebar's own gating), but the counts are computed unconditionally —
    // a workspace with no knocks pays for an index scan over zero rows.
    const inFieldHours = IN_FIELD_WINDOW_MS / MS_PER_HOUR;
    const knockRow = await this.db
      .selectFrom('turf_knocks')
      .select([
        sql<number>`count(DISTINCT household_id)`.as('doors'),
        sql<number>`count(*) FILTER (WHERE outcome = 'conversation')`.as('conversations'),
        sql<number>`count(DISTINCT turf_id) FILTER (WHERE knocked_at >= now() - interval '1 hour' * ${inFieldHours})`.as(
          'in_field',
        ),
      ])
      .where('tenant_id', '=', tenant_id)
      .where('knocked_at', '>=', sql<Date>`now() - interval '7 days'`)
      .executeTakeFirst();
    const field = {
      doorsKnocked7d: Number(knockRow?.doors ?? 0),
      conversations7d: Number(knockRow?.conversations ?? 0),
      turfsKnockingNow: Number(knockRow?.in_field ?? 0),
    };

    // The snapshot half. A workspace that has never had one computed gets a coalesced bootstrap
    // enqueue — the ONE deliberate exception to "reads never trigger a refresh".
    const snapshot = await readLatestDashboardSnapshot(this.db, tenant_id);
    let refreshPending = await dashboardRefreshPending(this.db, tenant_id);
    if (!snapshot && !refreshPending) {
      await enqueueDashboardStatsRefresh(this.db, tenant_id);
      refreshPending = true;
    }

    // Per-user LIVE numbers. Windowed closed counts and averages ride in snapshot.windows and are
    // joined to these rows by user_id in the frontend.
    const userLive = users.map((u) => {
      const id = String(u.id);
      const emailBreaches = emailBreachByUser.get(id) ?? 0;
      const taskBreaches = taskBreachByUser.get(id) ?? 0;
      return {
        user_id: id,
        first_name: u.first_name || '',
        last_name: u.last_name || '',
        openCount: openCountByUser.get(id) ?? 0,
        emailSlaBreaches: emailBreaches,
        taskSlaBreaches: taskBreaches,
        slaBreaches: emailBreaches + taskBreaches,
      };
    });

    return {
      unassignedCount,
      totalOpenCount,
      userLive,
      field,
      contactsGrowth,
      oldestUnassignedAgeHours,
      firstResponseDueHours,
      draftNewsletter,
      upcomingEvents,
      unassignedSlaBreaches: unassignedEmailSlaBreaches + unassignedTaskSlaBreaches,
      unassignedEmailSlaBreaches,
      unassignedTaskSlaBreaches,
      snapshot: {
        computedAt: snapshot ? snapshot.computedAt.toISOString() : null,
        refreshPending,
        windows: snapshot ? snapshot.stats.windows : null,
      },
      taskSlaHours,
      emailSlaHours,
      emailSlaWarningThreshold: sla.emailWarningThreshold,
      emailSlaCriticalThreshold: sla.emailCriticalThreshold,
      taskSlaWarningThreshold: sla.taskWarningThreshold,
      taskSlaCriticalThreshold: sla.taskCriticalThreshold,
    };
  }

  /** Queue a snapshot refresh for this workspace (coalesced; rate-limited per tenant). */
  public async refreshStats(auth: IAuthKeyPayload) {
    checkRateLimit(`dashboardStatsRefresh:${auth.tenant_id}`, REFRESH_RATE_LIMIT, REFRESH_RATE_WINDOW_MS);
    const status = await enqueueDashboardStatsRefresh(this.db, auth.tenant_id);
    return { status };
  }

  public async getBreachedEmails(auth: IAuthKeyPayload, input: { page: number; limit: number }) {
    const tenant_id = auth.tenant_id;
    const { page, limit } = input;
    const offset = (page - 1) * limit;

    const sla = await this.loadSla(tenant_id);
    const { userMap } = await this.loadUserMap(tenant_id);
    const candidates = await this.breachedEmailCandidates(tenant_id, sla.emailSlaHours * MS_PER_HOUR);
    const breached = this.breachedEmailsFrom(candidates, sla, userMap);

    const totalCount = breached.length;
    return {
      items: breached.slice(offset, offset + limit),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  public async getBreachedTasks(auth: IAuthKeyPayload, input: { page: number; limit: number }) {
    const tenant_id = auth.tenant_id;
    const { page, limit } = input;
    const offset = (page - 1) * limit;

    const sla = await this.loadSla(tenant_id);
    const { userMap } = await this.loadUserMap(tenant_id);
    const breached = await this.breachedTasksList(tenant_id, sla, userMap);

    const totalCount = breached.length;
    return {
      items: breached.slice(offset, offset + limit),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }
}
