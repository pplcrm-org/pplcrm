import { hashToken } from '../../lib/token-hash';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IAuthKeyPayload } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { generateTurfToken } from '../canvassing/repositories/turf-assignments.repo';
import { CompanionAccessController } from './controller';

type Db = typeof BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  adminId: string;
  organizerId: string;
  campaignId: string;
  turfId: string;
  personId: string;
  token: string;
}

/** Seed a tenant with an admin, an organizer, a person, and an assigned turf link. */
async function seed(db: Db, opts?: { email?: string | null; mobile?: string | null }): Promise<Seed> {
  const tenantId = rand();
  const adminId = rand();
  const organizerId = rand();
  const campaignId = rand();
  const turfId = rand();
  const personId = rand();
  const token = generateTurfToken();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Companion Test' }).execute();
  for (const [id, role, first] of [
    [adminId, 'admin', 'Avery'],
    [organizerId, 'user', 'Sam'],
  ] as const) {
    await db
      .insertInto('authusers')
      .values({
        id,
        tenant_id: tenantId,
        email: `t-${id}@example.com`,
        password: 'x',
        first_name: first,
        last_name: 'Staff',
        role,
        verified: true,
        createdby_id: id,
        updatedby_id: id,
      })
      .execute();
  }
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: adminId,
      name: 'C',
      createdby_id: adminId,
      updatedby_id: adminId,
    })
    .execute();
  const householdId = rand();
  await db
    .insertInto('households')
    .values({
      id: householdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('persons')
    .values({
      id: personId,
      tenant_id: tenantId,
      household_id: householdId,
      first_name: 'Jordan',
      last_name: 'Rivera',
      email: opts?.email === undefined ? 'jordan@example.com' : opts.email,
      mobile: opts?.mobile === undefined ? '(613) 555-0142' : opts.mobile,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('turfs')
    .values({
      id: turfId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Maple Heights',
      status: 'active',
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('turf_assignments')
    .values({
      tenant_id: tenantId,
      turf_id: turfId,
      // Tokens are stored hashed now (M5) — the raw value is only ever in the volunteer's link.
      token_hash: hashToken(token),
      status: 'active',
      volunteer_person_id: personId,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();

  return { tenantId, adminId, organizerId, campaignId, turfId, personId, token };
}

async function cleanup(db: Db, tenantId: string): Promise<void> {
  await db.deleteFrom('companion_sessions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_approval_tokens').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_organizer_tokens').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_segment_claims').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_join_codes').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_volunteers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_assignments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turfs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

/** Pull the 6-digit code back out of the enqueued outbox job. */
async function lastCodeFromOutbox(db: Db, tenantId: string): Promise<string> {
  const rows = await db
    .selectFrom('background_jobs')
    .select(['payload'])
    .where('tenant_id', '=', tenantId)
    .orderBy('id', 'desc')
    .execute();
  for (const row of rows) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const haystack = `${payload?.text ?? ''} ${payload?.body ?? ''}`;
    const match = haystack.match(/\b(\d{6})\b/);
    if (match?.[1]) return match[1];
  }
  throw new Error('no verification code found in outbox');
}

async function outboxTypes(db: Db, tenantId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('background_jobs')
    .select(['payload'])
    .where('tenant_id', '=', tenantId)
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r) => {
    const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    return String(payload?.type ?? '');
  });
}

describe('CompanionAccessController', () => {
  const controller = new CompanionAccessController();
  const db = BaseRepository.dbInstance;
  let s: Seed;
  let adminAuth: IAuthKeyPayload;

  beforeEach(async () => {
    s = await seed(db);
    adminAuth = { tenant_id: s.tenantId, user_id: s.adminId, name: 'Avery Staff', session_id: 'sess', role: 'admin' };
  });

  afterEach(async () => {
    // Durable rate-limit buckets are keyed by token / tenant id / admin user id, not by a
    // tenant_id column.
    await db.deleteFrom('rate_limits').where('key', 'like', `%${s.token}%`).execute();
    await db.deleteFrom('rate_limits').where('key', 'like', `%${s.tenantId}%`).execute();
    await db.deleteFrom('rate_limits').where('key', 'like', `companion-organizer-send:%${s.adminId}%`).execute();
    await cleanup(db, s.tenantId);
  });

  it('reports dead for an unknown token and unassigned when no volunteer is attached', async () => {
    expect((await controller.getAccess('turf', 'not-a-real-token', null)).state).toBe('dead');

    await db
      .updateTable('turf_assignments')
      .set({ volunteer_person_id: null })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    const access = await controller.getAccess('turf', s.token, null);
    expect(access.state).toBe('unassigned');
    expect(access.organizerName).toBe('Sam');
  });

  it('asks a fresh device to verify, exposing only masked contacts', async () => {
    const access = await controller.getAccess('turf', s.token, null);
    expect(access.state).toBe('need_verification');
    expect(access.volunteerName).toBe('Jordan');
    expect(access.contacts).toEqual([
      { channel: 'email', masked: 'j•••@example.com' },
      { channel: 'sms', masked: '(•••) •••-0142' },
    ]);
    // Payload minimization: never the raw email/phone anywhere in the response.
    const json = JSON.stringify(access);
    expect(json).not.toContain('jordan@example.com');
    expect(json).not.toContain('0142142');
  });

  it('runs the full journey: code → pending approval → admin approves → ready; new device for an approved volunteer is ready immediately', async () => {
    // Send an email code.
    const start = await controller.verifyStart('turf', s.token, 'email');
    expect(start.masked).toBe('j•••@example.com');
    const code = await lastCodeFromOutbox(db, s.tenantId);

    // Confirm it — session minted, but pending admin approval.
    const confirm = await controller.verifyConfirm('turf', s.token, code, 'vitest');
    expect(confirm.status).toBe('pending_approval');
    expect(confirm.sessionToken).toBeTruthy();

    // Admins were notified by email through the outbox.
    const types = await outboxTypes(db, s.tenantId);
    expect(types.filter((t) => t === 'send-transactional-email').length).toBeGreaterThanOrEqual(2); // code + admin notice

    // ...and by an in-app bell notification linking to the approval page.
    const bell = await db
      .selectFrom('notifications')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('user_id', '=', s.adminId)
      .execute();
    expect(bell).toHaveLength(1);
    expect(bell[0]?.title).toMatch(/waiting for approval/i);
    expect(bell[0]?.link).toBe('/volunteer-access');

    // The session exists but the guard blocks unapproved volunteers.
    const link = { tenant_id: s.tenantId, volunteer_person_id: s.personId };
    await expect(controller.requireSession(confirm.sessionToken, link)).rejects.toThrow(/approval/i);
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('pending_approval');

    // Admin approves — same session becomes usable without a second code.
    const volunteers = await controller.getAllVolunteers(s.tenantId);
    expect(volunteers).toHaveLength(1);
    expect(volunteers[0]?.status).toBe('verified');
    await controller.approveVolunteer(adminAuth, String(volunteers[0]?.id));

    await expect(controller.requireSession(confirm.sessionToken, link)).resolves.toBeUndefined();
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('ready');

    // A new device for the now-approved volunteer: one code, ready immediately.
    const start2 = await controller.verifyStart('turf', s.token, 'sms');
    expect(start2.masked).toBe('(•••) •••-0142');
    const smsCode = await lastCodeFromOutbox(db, s.tenantId);
    const confirm2 = await controller.verifyConfirm('turf', s.token, smsCode, 'vitest-2');
    expect(confirm2.status).toBe('ready');
    expect((await outboxTypes(db, s.tenantId)).includes('send-sms')).toBe(true);
  });

  it('locks a code after five wrong attempts and requires a resend', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    const wrong = code === '000000' ? '000001' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(controller.verifyConfirm('turf', s.token, wrong, null)).rejects.toThrow(/didn't match/i);
    }
    // Sixth attempt — even the right code is dead now.
    await expect(controller.verifyConfirm('turf', s.token, code, null)).rejects.toThrow(/too many attempts/i);
    await expect(controller.verifyConfirm('turf', s.token, code, null)).rejects.toThrow(/request a new code/i);
  });

  it('rate-limits code sends per token with a durable counter', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    await controller.verifyStart('turf', s.token, 'email');
    await controller.verifyStart('turf', s.token, 'email');
    await expect(controller.verifyStart('turf', s.token, 'email')).rejects.toThrow(/too many requests/i);

    // The counter must live in Postgres, not a per-process Map: each send costs a real
    // SMS/email, so the ceiling has to survive a deploy and be shared across replicas.
    const buckets = await db
      .selectFrom('rate_limits')
      .select(['count'])
      .where('key', '=', `companion-verify-start:${s.token}`)
      .execute();
    expect(buckets.length).toBeGreaterThan(0);
  });

  it('refuses to send verification codes while the organization is suspended', async () => {
    await db.updateTable('tenants').set({ suspended_at: new Date() }).where('id', '=', s.tenantId).execute();
    await expect(controller.verifyStart('turf', s.token, 'email')).rejects.toThrow(/temporarily unavailable/i);
    // No code email was queued to the outbox.
    expect((await outboxTypes(db, s.tenantId)).includes('send-transactional-email')).toBe(false);
  });

  it('still sends verification codes when sending is only tripwire-paused, not suspended', async () => {
    // A hard-bounce pause halts newsletters, but must NOT knock out field-ops verification codes —
    // only a full suspension (abuse review) gates the companion path.
    await db.updateTable('tenants').set({ sending_paused_at: new Date() }).where('id', '=', s.tenantId).execute();
    const start = await controller.verifyStart('turf', s.token, 'email');
    expect(start.masked).toBe('j•••@example.com');
    expect((await outboxTypes(db, s.tenantId)).includes('send-transactional-email')).toBe(true);
  });

  it('rejects a channel that is not on file', async () => {
    await db.updateTable('persons').set({ mobile: null }).where('tenant_id', '=', s.tenantId).execute();
    await expect(controller.verifyStart('turf', s.token, 'sms')).rejects.toThrow(/not on file/i);
    const access = await controller.getAccess('turf', s.token, null);
    expect(access.contacts).toEqual([{ channel: 'email', masked: 'j•••@example.com' }]);
  });

  it('revoking a volunteer kills every session and dead-ends the link', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('turf', s.token, code, null);
    const volunteers = await controller.getAllVolunteers(s.tenantId);
    const volunteerId = String(volunteers[0]?.id);
    await controller.approveVolunteer(adminAuth, volunteerId);

    const link = { tenant_id: s.tenantId, volunteer_person_id: s.personId };
    await expect(controller.requireSession(confirm.sessionToken, link)).resolves.toBeUndefined();

    await controller.revokeVolunteer(adminAuth, volunteerId);
    await expect(controller.requireSession(confirm.sessionToken, link)).rejects.toThrow();
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('dead');
  });

  it('rejects sessions across tenants and expired assignments', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('turf', s.token, code, null);

    // Wrong tenant/link pairing → unauthorized.
    await expect(
      controller.requireSession(confirm.sessionToken, { tenant_id: rand(), volunteer_person_id: s.personId }),
    ).rejects.toThrow(/verification/i);

    // Expired capability link → dead, regardless of session.
    await db
      .updateTable('turf_assignments')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('dead');
  });

  // ------------------------------------------------------------- QR join ---

  /** A live join code for the seeded tenant, optionally scoped to the seeded turf. */
  async function makeJoinCode(opts?: { turf_id?: string | null; max_uses?: number | null }): Promise<string> {
    const created = await controller.createJoinCode(adminAuth, {
      turf_id: opts?.turf_id ?? null,
      max_uses: opts?.max_uses ?? null,
      label: 'Saturday launch',
    });
    return created.code;
  }

  /** joinStart needs somewhere to put a person with no address. */
  async function givePlaceholderHousehold(): Promise<void> {
    const householdId = rand();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        createdby_id: s.organizerId,
        updatedby_id: s.organizerId,
      })
      .execute();
    await db
      .updateTable('tenants')
      .set({ placeholder_household_id: householdId })
      .where('id', '=', s.tenantId)
      .execute();
  }

  it('asks a scanned join code who is holding the phone', async () => {
    const code = await makeJoinCode({ turf_id: s.turfId });
    const access = await controller.getAccess('join', code, null);
    expect(access.state).toBe('need_identity');
    expect(access.organizerName).toBe('Avery');
    // Answers "what am I signing up for?" before anything is typed.
    expect(access.joiningLabel).toBe('Maple Heights');
  });

  it('creates a person for a stranger and matches one who already exists', async () => {
    await givePlaceholderHousehold();
    const code = await makeJoinCode();

    const stranger = await controller.joinStart(
      { code, first_name: 'Priya', last_name: 'Anand', email: 'priya@example.com' },
      '203.0.113.1',
    );
    expect(stranger.channel).toBe('email');
    expect(stranger.claim).toBeTruthy();
    const created = await db
      .selectFrom('persons')
      .select(['id', 'volunteer_status'])
      .where('tenant_id', '=', s.tenantId)
      .where('email', '=', 'priya@example.com')
      .executeTakeFirst();
    // Prospective, not active: scanning a poster is an intention, not a commitment.
    expect(created?.volunteer_status).toBe('prospective');

    // Someone already in the rolodex must not become a second copy of themselves.
    const before = await db
      .selectFrom('persons')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('tenant_id', '=', s.tenantId)
      .executeTakeFirst();
    await controller.joinStart({ code, first_name: 'Jordan', email: 'jordan@example.com' }, '203.0.113.2');
    const after = await db
      .selectFrom('persons')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('tenant_id', '=', s.tenantId)
      .executeTakeFirst();
    expect(Number(after?.c)).toBe(Number(before?.c));
  });

  it('answers every unusable code with the same refusal', async () => {
    await givePlaceholderHousehold();
    const messages: string[] = [];

    const collect = async (code: string): Promise<void> => {
      await expect(
        controller
          .joinStart({ code, first_name: 'Test', email: `t-${rand()}@example.com` }, `203.0.113.${rand().slice(0, 2)}`)
          .catch((err: unknown) => {
            messages.push(err instanceof Error ? err.message : String(err));
            throw err;
          }),
      ).rejects.toThrow();
    };

    await collect('NOTACODE');
    const revoked = await controller.createJoinCode(adminAuth, {});
    await controller.revokeJoinCode(adminAuth, revoked.id);
    await collect(revoked.code);
    const exhausted = await makeJoinCode({ max_uses: 1 });
    await controller.joinStart({ code: exhausted, first_name: 'A', email: `a-${rand()}@example.com` }, '203.0.113.9');
    await collect(exhausted);

    // One message for three very different causes — otherwise this is an oracle.
    expect(new Set(messages).size).toBe(1);
  });

  it('verifies a QR joiner through the claim and places them on the turf once approved', async () => {
    await givePlaceholderHousehold();
    const code = await makeJoinCode({ turf_id: s.turfId });
    const started = await controller.joinStart({ code, first_name: 'Priya', mobile: '(613) 555-0199' }, '203.0.113.20');

    const verifyCode = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('join', started.claim, verifyCode, null);
    expect(confirm.status).toBe('pending_approval');

    // The claim is one-shot: a screenshotted QR cannot be replayed into a second signup.
    await expect(controller.verifyConfirm('join', started.claim, verifyCode, null)).rejects.toThrow();

    const volunteer = await db
      .selectFrom('companion_volunteers')
      .select(['id', 'person_id'])
      .where('tenant_id', '=', s.tenantId)
      .where('status', '=', 'verified')
      .executeTakeFirstOrThrow();

    // No assignment before approval — a stranger holds nothing until someone says so.
    const beforeApproval = await db
      .selectFrom('turf_assignments')
      .select('id')
      .where('tenant_id', '=', s.tenantId)
      .where('volunteer_person_id', '=', String(volunteer.person_id))
      .execute();
    expect(beforeApproval).toHaveLength(0);

    await controller.approveVolunteer(adminAuth, String(volunteer.id));
    const afterApproval = await db
      .selectFrom('turf_assignments')
      .select('turf_id')
      .where('tenant_id', '=', s.tenantId)
      .where('volunteer_person_id', '=', String(volunteer.person_id))
      .where('status', '=', 'active')
      .execute();
    expect(afterApproval.map((r) => String(r.turf_id))).toEqual([s.turfId]);

    // And the session alone now opens the app, with no link in hand.
    expect((await controller.getAccess('session', null, confirm.sessionToken)).state).toBe('ready');
  });

  it('places an already-approved volunteer on a turf-scoped join code when they open it, idempotently', async () => {
    // A second turf the volunteer is NOT on — the join link's promise is this one.
    const turf2 = rand();
    await db
      .insertInto('turfs')
      .values({
        id: turf2,
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        name: 'Birch Flats',
        status: 'active',
        createdby_id: s.organizerId,
        updatedby_id: s.organizerId,
      })
      .execute();
    const code = await makeJoinCode({ turf_id: turf2 });

    // Approve the seeded volunteer the normal way, so the device session is real.
    await controller.verifyStart('turf', s.token, 'email');
    const verifyCode = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('turf', s.token, verifyCode, null);
    const volunteers = await controller.getAllVolunteers(s.tenantId);
    await controller.approveVolunteer(adminAuth, String(volunteers[0]?.id));

    // Opening the link places them — approval already happened and never fires again.
    const attach = await controller.attachJoinCode(code, confirm.sessionToken);
    expect(attach.turf_id).toBe(turf2);
    const placed = await db
      .selectFrom('turf_assignments')
      .select('id')
      .where('tenant_id', '=', s.tenantId)
      .where('turf_id', '=', turf2)
      .where('volunteer_person_id', '=', s.personId)
      .where('status', '=', 'active')
      .execute();
    expect(placed).toHaveLength(1);

    // A second open (re-scan, reload) is a no-op, not a second assignment.
    const again = await controller.attachJoinCode(code, confirm.sessionToken);
    expect(again.turf_id).toBe(turf2);
    const stillOne = await db
      .selectFrom('turf_assignments')
      .select('id')
      .where('tenant_id', '=', s.tenantId)
      .where('turf_id', '=', turf2)
      .where('volunteer_person_id', '=', s.personId)
      .where('status', '=', 'active')
      .execute();
    expect(stillOne).toHaveLength(1);
  });

  it('refuses join-code attach without an approved session, and answers an unscoped code with no turf', async () => {
    const scoped = await makeJoinCode({ turf_id: s.turfId });

    // No session at all → the gate must re-verify.
    await expect(controller.attachJoinCode(scoped, null)).rejects.toThrow(/verify/i);

    // Verified but not yet approved → still waiting.
    await controller.verifyStart('turf', s.token, 'email');
    const verifyCode = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('turf', s.token, verifyCode, null);
    await expect(controller.attachJoinCode(scoped, confirm.sessionToken)).rejects.toThrow(/approv/i);

    const volunteers = await controller.getAllVolunteers(s.tenantId);
    await controller.approveVolunteer(adminAuth, String(volunteers[0]?.id));

    // An unscoped code names no turf: the app falls back to the picker.
    const unscoped = await makeJoinCode();
    expect((await controller.attachJoinCode(unscoped, confirm.sessionToken)).turf_id).toBeNull();

    // A revoked code answers with the uniform refusal, session or not.
    const revoked = await controller.createJoinCode(adminAuth, {});
    await controller.revokeJoinCode(adminAuth, revoked.id);
    await expect(controller.attachJoinCode(revoked.code, confirm.sessionToken)).rejects.toThrow();
  });

  // -------------------------------------------------------- approve by text --

  /**
   * Make the seeded turf link look like an admin invited it, and opt that admin into the
   * approval SMS. The inviter must be an admin for any of this to fire — a staff member
   * who cannot approve is not sent a link to approve with.
   */
  async function optInviterIntoSms(): Promise<void> {
    await db
      .updateTable('turf_assignments')
      .set({ createdby_id: s.adminId })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    await db
      .insertInto('profiles')
      .values({
        tenant_id: s.tenantId,
        auth_id: s.adminId,
        mobile: '(613) 555-0177',
        preferences: JSON.stringify({ notifications: { companion_approval_sms: true } }),
        createdby_id: s.adminId,
        updatedby_id: s.adminId,
      })
      .execute();
  }

  /** Verify the seeded volunteer and pull the raw approval token out of the SMS body. */
  async function approvalTokenFromSms(): Promise<string> {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    await controller.verifyConfirm('turf', s.token, code, null);

    const rows = await db
      .selectFrom('background_jobs')
      .select(['payload'])
      .where('tenant_id', '=', s.tenantId)
      .orderBy('id', 'desc')
      .execute();
    for (const row of rows) {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const match = String(payload?.body ?? '').match(/\/a\/([A-Za-z0-9_-]+)/);
      if (match?.[1]) return match[1];
    }
    throw new Error('no approval link found in the outbox');
  }

  it('mints one approval token per admin', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    await controller.verifyConfirm('turf', s.token, code, null);
    const minted = await db
      .selectFrom('companion_approval_tokens')
      .select(['admin_user_id'])
      .where('tenant_id', '=', s.tenantId)
      .execute();
    // One per admin/owner — per-admin is what makes `approved_by` honest.
    expect(minted.map((r) => String(r.admin_user_id))).toEqual([s.adminId]);
  });

  it('texts an inviter who has never touched the preference', async () => {
    // The preference defaults ON: an unapproved volunteer is stuck until someone lets them in,
    // so silence is the worse failure. A profile with no stored preferences must still text.
    await db
      .updateTable('turf_assignments')
      .set({ createdby_id: s.adminId })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    await db
      .insertInto('profiles')
      .values({
        tenant_id: s.tenantId,
        auth_id: s.adminId,
        mobile: '(613) 555-0177',
        createdby_id: s.adminId,
        updatedby_id: s.adminId,
      })
      .execute();

    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    await controller.verifyConfirm('turf', s.token, code, null);

    expect((await outboxTypes(db, s.tenantId)).filter((t) => t === 'send-sms')).toHaveLength(1);
  });

  it('does not text an inviter who turned the preference off', async () => {
    await db
      .updateTable('turf_assignments')
      .set({ createdby_id: s.adminId })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    await db
      .insertInto('profiles')
      .values({
        tenant_id: s.tenantId,
        auth_id: s.adminId,
        mobile: '(613) 555-0177',
        preferences: JSON.stringify({ notifications: { companion_approval_sms: false } }),
        createdby_id: s.adminId,
        updatedby_id: s.adminId,
      })
      .execute();

    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    await controller.verifyConfirm('turf', s.token, code, null);

    // An explicit opt-out is honoured even though a mobile is on file.
    expect((await outboxTypes(db, s.tenantId)).filter((t) => t === 'send-sms')).toHaveLength(0);
  });

  it('does not text an inviter with no mobile on file', async () => {
    await db
      .updateTable('turf_assignments')
      .set({ createdby_id: s.adminId })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    await db
      .insertInto('profiles')
      .values({
        tenant_id: s.tenantId,
        auth_id: s.adminId,
        createdby_id: s.adminId,
        updatedby_id: s.adminId,
      })
      .execute();

    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    await controller.verifyConfirm('turf', s.token, code, null);

    expect((await outboxTypes(db, s.tenantId)).filter((t) => t === 'send-sms')).toHaveLength(0);
  });

  it('texts the opted-in inviter a link that approves, and reports back to a second tap', async () => {
    await optInviterIntoSms();
    const token = await approvalTokenFromSms();

    const pending = await controller.getApprovalRequest(token);
    expect(pending.state).toBe('pending');
    expect(pending.volunteerName).toBe('Jordan');
    // Enough to recognize someone, never enough to harvest.
    expect(pending.volunteerContact).toBe('j•••@example.com');

    const decided = await controller.actOnApprovalRequest(token, 'approve');
    expect(decided.state).toBe('decided');
    expect(decided.decision).toBe('approved');
    expect(decided.decidedByName).toBe('Avery Staff');

    // A second tap reports what happened; it never re-decides.
    const again = await controller.actOnApprovalRequest(token, 'decline');
    expect(again.decision).toBe('approved');
  });

  it('refuses an expired approval link', async () => {
    await optInviterIntoSms();
    const token = await approvalTokenFromSms();
    await db
      .updateTable('companion_approval_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    expect((await controller.getApprovalRequest(token)).state).toBe('dead');
  });

  // ------------------------------------------------- organizer mobile page --

  /** Give the admin a mobile, then text themselves a code's organizer link. */
  async function organizerLinkFor(joinCodeId: string): Promise<string> {
    await db
      .insertInto('profiles')
      .values({
        tenant_id: s.tenantId,
        auth_id: s.adminId,
        mobile: '(613) 555-0177',
        createdby_id: s.adminId,
        updatedby_id: s.adminId,
      })
      .execute();
    const sent = await controller.sendJoinCodeToPhone(adminAuth, joinCodeId);
    expect(sent.status).toBe('sent');

    const rows = await db
      .selectFrom('background_jobs')
      .select(['payload'])
      .where('tenant_id', '=', s.tenantId)
      .orderBy('id', 'desc')
      .execute();
    for (const row of rows) {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const match = String(payload?.body ?? '').match(/\/o\/([A-Za-z0-9_-]+)/);
      if (match?.[1]) return match[1];
    }
    throw new Error('no organizer link found in the outbox');
  }

  /** Scan a code as a stranger and verify, leaving them waiting for approval. */
  async function scanAndVerify(code: string, email: string): Promise<void> {
    const started = await controller.joinStart({ code, first_name: 'Priya', email }, `203.0.113.${rand().slice(0, 2)}`);
    const verifyCode = await lastCodeFromOutbox(db, s.tenantId);
    await controller.verifyConfirm('join', started.claim, verifyCode, null);
  }

  it('guides rather than errors when the admin has no mobile on file', async () => {
    const created = await controller.createJoinCode(adminAuth, {});
    // Nothing was minted and nothing was sent — the caller narrates "add a number".
    expect(await controller.sendJoinCodeToPhone(adminAuth, created.id)).toEqual({ status: 'no_mobile' });
    expect((await outboxTypes(db, s.tenantId)).filter((t) => t === 'send-sms')).toHaveLength(0);
  });

  it('shows the QR and the people who scanned it, and approves them inline', async () => {
    await givePlaceholderHousehold();
    const created = await controller.createJoinCode(adminAuth, { turf_id: s.turfId });
    const token = await organizerLinkFor(created.id);

    const empty = await controller.getOrganizerPage(token);
    expect(empty.state).toBe('live');
    expect(empty.code).toBe(created.code);
    expect(empty.joiningLabel).toBe('Maple Heights');
    // The matrix is what the page draws — never a server-rendered image.
    expect(empty.matrix?.length).toBeGreaterThan(0);
    expect(empty.pending).toEqual([]);

    await scanAndVerify(created.code, 'priya@example.com');
    const waiting = await controller.getOrganizerPage(token);
    expect(waiting.pending?.map((p) => p.name)).toEqual(['Priya']);
    expect(waiting.pending?.[0]?.contact).toBe('p•••@example.com');

    const after = await controller.decideOnOrganizerPage(token, {
      volunteer_id: String(waiting.pending?.[0]?.volunteer_id),
      decision: 'approve',
    });
    expect(after.pending).toEqual([]);
    expect(after.approvedCount).toBe(1);
  });

  it('records the admin who minted the link as the approver', async () => {
    await givePlaceholderHousehold();
    const created = await controller.createJoinCode(adminAuth, {});
    const token = await organizerLinkFor(created.id);
    await scanAndVerify(created.code, 'priya@example.com');

    const waiting = await controller.getOrganizerPage(token);
    await controller.decideOnOrganizerPage(token, {
      volunteer_id: String(waiting.pending?.[0]?.volunteer_id),
      decision: 'approve',
    });

    // The whole reason the token names an admin: `approved_by` has to be a real person.
    const row = await db
      .selectFrom('companion_volunteers')
      .select(['approved_by'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', String(waiting.pending?.[0]?.volunteer_id))
      .executeTakeFirst();
    expect(String(row?.approved_by)).toBe(s.adminId);
  });

  it('cannot reach a volunteer who joined through a different code', async () => {
    await givePlaceholderHousehold();
    const mine = await controller.createJoinCode(adminAuth, {});
    const other = await controller.createJoinCode(adminAuth, {});
    const token = await organizerLinkFor(mine.id);

    await scanAndVerify(other.code, 'elsewhere@example.com');
    // Visible to nobody on this page, and refused even with the id in hand — the token's
    // reach is exactly the poster it was minted for.
    expect((await controller.getOrganizerPage(token)).pending).toEqual([]);
    const stranger = await db
      .selectFrom('companion_volunteers')
      .select(['id'])
      .where('tenant_id', '=', s.tenantId)
      .where('status', '=', 'verified')
      .executeTakeFirst();
    await expect(
      controller.decideOnOrganizerPage(token, { volunteer_id: String(stranger?.id), decision: 'approve' }),
    ).rejects.toThrow(/not on this list/i);
  });

  it('dies with the poster it was printed alongside', async () => {
    const created = await controller.createJoinCode(adminAuth, {});
    const token = await organizerLinkFor(created.id);
    expect((await controller.getOrganizerPage(token)).state).toBe('live');

    await controller.rotateJoinCode(adminAuth, created.id);

    // A live phone link against a dead poster would keep approving people into a code
    // nobody can scan any more.
    expect((await controller.getOrganizerPage(token)).state).toBe('dead');
    const revoked = await db
      .selectFrom('companion_organizer_tokens')
      .select(['revoked_at'])
      .where('tenant_id', '=', s.tenantId)
      .executeTakeFirst();
    expect(revoked?.revoked_at).not.toBeNull();
  });

  it('refuses an expired organizer link', async () => {
    const created = await controller.createJoinCode(adminAuth, {});
    const token = await organizerLinkFor(created.id);
    await db
      .updateTable('companion_organizer_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    expect((await controller.getOrganizerPage(token)).state).toBe('dead');
  });
});
