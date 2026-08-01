import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';

/**
 * Export entity key (what the UI asks for, `exportEntitySchema`) -> the table the job actually
 * reads. Several differ: `users` lives in `authusers`, `forms` in `web_forms`, `volunteer` in
 * `volunteer_events`, and `issues` is `tags` filtered by type.
 *
 * Typed as `keyof Models`, which is what caught the second half of this bug: `newsletters` was
 * mapped to `marketing_emails`, a table that no longer exists, so that export could never have
 * succeeded regardless of the allow-list.
 *
 * This map and the allow-list below live together on purpose. They used to be in two files, and
 * the allow-list had been written with *entity keys* while the job checks it against the *mapped
 * table name* — so five of the thirteen export entities (lists, newsletters, users, volunteer,
 * forms) validated at the boundary, created a `data_exports` row, queued a job, and then failed in
 * the worker with "Invalid export entity". The user just saw an export that never arrived.
 * Deriving the allow-list from the map makes that class of drift impossible.
 */
export const EXPORT_ENTITY_TABLE: Record<string, keyof Models> = {
  persons: 'persons',
  households: 'households',
  companies: 'companies',
  tags: 'tags',
  issues: 'tags',
  tasks: 'tasks',
  lists: 'lists',
  newsletters: 'newsletters',
  teams: 'teams',
  users: 'authusers',
  volunteer: 'volunteer_events',
  forms: 'web_forms',
  workflows: 'workflows',
};

/**
 * Columns each export table may put in a CSV, keyed by TABLE (not entity), because the table name
 * is what the background job carries in its payload.
 *
 * SECURITY: this list gates the SQL `select`, not just the CSV header. The job used to run
 * `selectFrom(table).selectAll()` and let `csv-stream.ts` derive the header from the first row's
 * keys, so an export of the `users` entity — reachable by any signed-in non-viewer member —
 * wrote every column of `authusers` into a file in blob storage, including the `password` hash,
 * `password_reset_code`, `two_factor_code`, `previous_email` and `previous_role`. Naming the
 * columns in an explicit list means those values are never read out of Postgres at all.
 *
 * The list is deliberately fail-closed: a column added to one of these tables later is invisible
 * to exports until somebody adds it here on purpose. That is the trade this list exists to make —
 * a new column silently missing from a CSV is a nuisance, a new secret column silently appearing
 * in one is a breach.
 *
 * Two deliberate omissions beyond the credentials:
 *  - `tenant_id`, which is the same value on every row of a tenant's export and tells the reader
 *    nothing; and
 *  - `search_vector` (persons, households, companies, volunteer_events), a Postgres `tsvector`
 *    that `selectAll()` used to dump into the CSV as an unreadable index blob.
 */
export const EXPORT_TABLE_COLUMNS: Record<string, readonly string[]> = {
  persons: [
    'id',
    'campaign_id',
    'household_id',
    'company_id',
    'file_id',
    'first_name',
    'middle_names',
    'last_name',
    'email',
    'email2',
    'mobile',
    'home_phone',
    'notes',
    'linkedin',
    'twitter',
    'facebook',
    'instagram',
    'assigned_to',
    'preferred_contact',
    'public_id',
    'slug',
    'do_not_contact',
    'do_not_contact_channels',
    'volunteer_status',
    'staff_status',
    'deceased_at',
    'senior',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  households: [
    'id',
    'campaign_id',
    'file_id',
    'apt',
    'street_num',
    'street1',
    'street2',
    'city',
    'state',
    'zip',
    'country',
    'formatted_address',
    'lat',
    'lng',
    'type',
    'home_phone',
    'notes',
    'district',
    'precinct',
    'ward',
    'geocoding_status',
    'address_fp_street',
    'address_fp_full',
    'is_placeholder',
    'slug',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  companies: [
    'id',
    'name',
    'description',
    'website',
    'email',
    'phone',
    'industry',
    'notes',
    'enrichment',
    'file_id',
    'slug',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  tags: [
    'id',
    'name',
    'description',
    'color',
    'deletable',
    'type',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  tasks: [
    'id',
    'name',
    'details',
    'due_at',
    'status',
    'priority',
    'completed_at',
    'assigned_to',
    'team_id',
    'person_id',
    'file_id',
    'sla_breached_at',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  lists: [
    'id',
    'campaign_id',
    'name',
    'description',
    'object',
    'is_dynamic',
    'definition',
    'status',
    'system_key',
    'last_refreshed_at',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  // `send_offset` and `send_cursor` are batch-send bookmarks (the cursor is the last recipient
  // address written); they are worker internals, not reporting data, so they stay out.
  newsletters: [
    'id',
    'campaign_id',
    'name',
    'status',
    'subject',
    'preview_text',
    'audience_description',
    'target_lists',
    'segments',
    'summary',
    'html_content',
    'plain_text_content',
    'top_links',
    'total_recipients',
    'delivered_count',
    'bounce_count',
    'open_rate',
    'click_rate',
    'unique_opens',
    'unique_clicks',
    'unsubscribe_count',
    'spam_complaint_count',
    'reply_count',
    'send_date',
    'last_engagement_at',
    'resend_of_id',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  teams: [
    'id',
    'name',
    'description',
    'team_captain_id',
    'team_lead_user_id',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  // The workspace roster. Everything a sign-in depends on is absent by construction:
  // `password`, `password_reset_code`, `password_reset_code_created_at`, `two_factor_code`,
  // `two_factor_expires_at` and `two_factor_attempts` are credentials or live challenge state,
  // and `previous_email` / `previous_role` are the audit trail of an account change that an
  // admin reads in the app, not something a CSV needs.
  authusers: [
    'id',
    'email',
    'first_name',
    'last_name',
    'role',
    'campaign_id',
    'verified',
    'two_factor_enabled',
    'deactivated_at',
    'deleted_at',
    'deletion_scheduled_at',
    'passkey_setup_dismissed_at',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  volunteer_events: [
    'id',
    'name',
    'description',
    'location_address',
    'start_time',
    'end_time',
    'capacity',
    'contact_email',
    'contact_phone',
    'is_private',
    'send_reminder',
    'send_signup_confirmation',
    'send_volunteer_alert',
    'fields',
    'slug',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  web_forms: [
    'id',
    'campaign_id',
    'name',
    'description',
    'status',
    'form_type',
    'type',
    'slug',
    'redirect_url',
    'target_tags',
    'target_lists',
    'fields',
    'send_confirmation',
    'send_alert',
    'notify_team_on',
    'submit_label',
    'thanks_title',
    'thanks_body',
    'confirm_subject',
    'confirm_body',
    'archived_at',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  workflows: [
    'id',
    'name',
    'description',
    'trigger_type',
    'status',
    'trigger_event_id',
    'conditions',
    'exit_conditions',
    'createdby_id',
    'updatedby_id',
    'created_at',
    'updated_at',
  ],
  // Reachable by passing `table` directly rather than through an entity key — the activity feed's
  // own export does this (activity/controller.ts), and the job has a bespoke joined query for it.
  // These names are the SELECT aliases that query produces, not raw `user_activity` columns:
  // `user` is a concatenation of the actor's names and `email` comes from the joined `authusers`
  // row. Because the select is fixed, this list only filters the CSV header.
  user_activity: ['id', 'created_at', 'user', 'email', 'activity', 'entity', 'entity_id', 'quantity', 'metadata'],
};

/**
 * Export entities that only a workspace admin or owner may request.
 *
 * `users` exports the workspace roster — every colleague's email address, role, verification and
 * deactivation state. Every other way to read or change that roster (inviting, listing users,
 * changing a role) is already restricted to admins and owners, and no data grid in the Angular app
 * sets `exportEntity: 'users'`, so nothing shipped asks for it. Reading the roster through the
 * export queue was simply the one route around that rule.
 */
export const PRIVILEGED_EXPORT_ENTITIES: ReadonlySet<string> = new Set<string>(['users']);

/** Every table an export job is permitted to read: exactly those with a column allow-list. */
export const ALLOWED_EXPORT_TABLES: ReadonlySet<string> = new Set<string>(Object.keys(EXPORT_TABLE_COLUMNS));

export interface ResolvedExportColumns {
  /** The columns to select and write, in the order they will appear in the CSV. */
  readonly columns: string[];
  /** Requested columns that are not exportable for this table, in request order. */
  readonly dropped: string[];
}

/**
 * Decide which columns an export of `table` may emit.
 *
 * A requested column that is not on the table's allow-list is **dropped**, not rejected, for two
 * reasons. First, the shipped People grid legitimately asks for `name` and `address`, which are
 * display columns computed in the browser and not columns of `persons` at all — rejecting unknown
 * names would break the main export path immediately. Second, a background job's only channel for
 * refusing work is to mark the `data_exports` row failed, and the Exports page renders that as a
 * red "Failed" badge with no reason text, so a rejection would reach the user as an unexplained
 * dead end. Dropped names are logged by the job.
 *
 * Requesting nothing (or nothing exportable) yields the table's whole allow-list, which is what
 * the old `selectAll()` meant, minus the columns that must never leave Postgres.
 */
export function resolveExportColumns(table: string, requested: readonly string[] = []): ResolvedExportColumns {
  const allowed = EXPORT_TABLE_COLUMNS[table];
  if (!allowed) return { columns: [], dropped: [...requested] };

  const allowedSet = new Set(allowed);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const column of requested) {
    if (allowedSet.has(column)) {
      if (!kept.includes(column)) kept.push(column);
    } else {
      dropped.push(column);
    }
  }

  return { columns: kept.length ? kept : [...allowed], dropped };
}
