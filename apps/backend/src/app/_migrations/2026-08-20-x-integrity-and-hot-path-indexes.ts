import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Referential integrity for the post-baseline tables, one FK repair in the baseline, RLS for the
 * one tenant table that skipped it, and the index set the 2026-08-20 database review found missing.
 *
 * 1. FOREIGN KEYS. Nine tables created after the 2026-07-26 squash shipped with zero foreign keys
 *    (donation_receipts, donation_receipt_items, receipt_counters, receipt_statement_runs,
 *    campaign_join_codes, companion_approval_tokens, turf_segment_claims,
 *    companion_organizer_tokens, geocode_cache). Each gets the constraints its columns always
 *    implied. Delete rules follow the app's existing semantics, not a blanket policy:
 *
 *    - tenant_id → tenants ON DELETE CASCADE everywhere here. The tenant wipe
 *      (deletions.handlers.ts) empties every one of these tables before the tenants row goes, so
 *      the cascade never fires in practice — it exists so a table accidentally dropped from that
 *      list can never strand rows.
 *    - donation_receipts.person_id becomes NULLABLE with ON DELETE SET NULL, mirroring
 *      fk_donations_person: deleting a donor keeps the legal document (donor identity is a frozen
 *      snapshot on the row) and severs the live link. NO ACTION would make every donor with an
 *      auto-acknowledged gift undeletable.
 *    - donation_receipt_items.donation_id is NO ACTION: a receipt item citing a gift pins that
 *      gift. The donations controller now detaches acknowledgement items and refuses the delete
 *      when an official receipt covers the gift — see DonationsController.delete/deleteMany.
 *    - turf_segment_claims.volunteer_person_id becomes NULLABLE with ON DELETE SET NULL: the
 *      persons delete path deliberately KEEPS released claims as history (canvasser_name is
 *      denormalized for exactly that), so the row must survive its person.
 *    - Ephemeral credential rows (approval/organizer tokens) CASCADE from their parent — a token
 *      that outlives its volunteer, admin, or join code is a dangling credential, not history.
 *    - createdby/updatedby/requested_by/cancelled_by → authusers with NO ACTION, like every other
 *      audit column; authusers rows are only ever hard-deleted by the tenant wipe, which empties
 *      these tables first.
 *
 *    Orphan cleanups run before each ADD CONSTRAINT. Dangling references exist BY DESIGN today
 *    (persons/turfs were deletable while nothing enforced these links), so the cleanups are not
 *    hypothetical: claims for re-cut turfs are deleted, join codes for re-cut turfs fall back to
 *    the turf picker (turf_id NULL), receipts for deleted donors keep their frozen snapshot with
 *    person_id NULL, and dangling receipt items (their donation was deleted while that was
 *    possible) are removed.
 *
 * 2. EVENTS FK REPAIR. The baseline carries three constraints NAMED fk_events_tenant /
 *    fk_events_createdby / fk_events_updatedby that are attached to volunteer_events — a
 *    copy-paste error that left events.tenant_id, createdby_id and updatedby_id unenforced. The
 *    misnamed constraints are renamed to say what they do, and events gets its own.
 *
 * 3. campaign_areas RLS. Every tenant-owned table enables + forces row-level security with the
 *    shared tenant_isolation policy; 2026-08-06-campaign-areas skipped it. Same shape as
 *    everywhere else: the NULLIF escape admits GUC-less paths (migrations, background jobs), and
 *    the explicit .where('tenant_id') in queries stays the first lock.
 *
 * 4. INDEXES (see each comment). The two map_lists_* (list_id) indexes are the single biggest win:
 *    the Lists grid joins both membership tables on list_id alone, and neither had a list_id-leading
 *    index, so every Lists page load scanned both tables in full.
 *
 * 5. AUTOVACUUM. sessions, webhook_events and emails all rewrite an indexed status/lifecycle
 *    column (so their updates cannot be HOT) at a rate comparable to the four tables
 *    2026-08-13-autovacuum-churn-tables already tuned; they get the same settings.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // ---------------------------------------------------------------------------------------------
  // 2. events: rename the misattached volunteer_events constraints, then enforce events' own.
  // ---------------------------------------------------------------------------------------------
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_events_tenant' AND conrelid = 'public.volunteer_events'::regclass) THEN
        ALTER TABLE public.volunteer_events RENAME CONSTRAINT fk_events_tenant TO fk_volunteer_events_tenant;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_events_createdby' AND conrelid = 'public.volunteer_events'::regclass) THEN
        ALTER TABLE public.volunteer_events RENAME CONSTRAINT fk_events_createdby TO fk_volunteer_events_createdby;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_events_updatedby' AND conrelid = 'public.volunteer_events'::regclass) THEN
        ALTER TABLE public.volunteer_events RENAME CONSTRAINT fk_events_updatedby TO fk_volunteer_events_updatedby;
      END IF;
    END $$
  `.execute(db);

  // Rows whose tenant was wiped before events joined the wipe list (if any) can't satisfy the FK.
  await sql`
    DELETE FROM public.events e
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = e.tenant_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.events
      ADD CONSTRAINT fk_events_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
      ADD CONSTRAINT fk_events_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_events_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers (id)
  `.execute(db);

  // ---------------------------------------------------------------------------------------------
  // 1a. donation_receipts — the legal-document table. person_id goes nullable first (see header).
  // ---------------------------------------------------------------------------------------------
  await sql`ALTER TABLE public.donation_receipts ALTER COLUMN person_id DROP NOT NULL`.execute(db);
  await sql`
    DELETE FROM public.donation_receipts r
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = r.tenant_id)
  `.execute(db);
  await sql`
    UPDATE public.donation_receipts r SET person_id = NULL
    WHERE person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = r.person_id)
  `.execute(db);
  await sql`
    UPDATE public.donation_receipts r SET campaign_id = NULL
    WHERE campaign_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = r.campaign_id)
  `.execute(db);
  await sql`
    UPDATE public.donation_receipts r SET file_id = NULL
    WHERE file_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = r.file_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.donation_receipts
      ADD CONSTRAINT fk_donation_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_donation_receipts_person FOREIGN KEY (person_id) REFERENCES public.persons (id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_donation_receipts_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns (id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_donation_receipts_file FOREIGN KEY (file_id) REFERENCES public.files (id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_donation_receipts_replaces FOREIGN KEY (replaces_receipt_id) REFERENCES public.donation_receipts (id),
      ADD CONSTRAINT fk_donation_receipts_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_donation_receipts_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_donation_receipts_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers (id)
  `.execute(db);

  // 1b. donation_receipt_items. Dangling items (donation deleted while nothing stopped it) are
  // removed — their receipt keeps its frozen totals; the item's only job is the live join.
  await sql`
    DELETE FROM public.donation_receipt_items i
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = i.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM public.donation_receipts r WHERE r.id = i.receipt_id)
       OR NOT EXISTS (SELECT 1 FROM public.donations d WHERE d.id = i.donation_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.donation_receipt_items
      ADD CONSTRAINT fk_donation_receipt_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_donation_receipt_items_receipt FOREIGN KEY (receipt_id) REFERENCES public.donation_receipts (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_donation_receipt_items_donation FOREIGN KEY (donation_id) REFERENCES public.donations (id)
  `.execute(db);

  // 1c. receipt_counters / receipt_statement_runs.
  await sql`
    DELETE FROM public.receipt_counters c
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = c.tenant_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.receipt_counters
      ADD CONSTRAINT fk_receipt_counters_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    DELETE FROM public.receipt_statement_runs s
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = s.tenant_id)
  `.execute(db);
  await sql`
    UPDATE public.receipt_statement_runs s SET cursor_person_id = NULL
    WHERE cursor_person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = s.cursor_person_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.receipt_statement_runs
      ADD CONSTRAINT fk_receipt_statement_runs_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_receipt_statement_runs_requested_by FOREIGN KEY (requested_by) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_receipt_statement_runs_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_receipt_statement_runs_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_receipt_statement_runs_cursor_person FOREIGN KEY (cursor_person_id) REFERENCES public.persons (id) ON DELETE SET NULL
  `.execute(db);

  // 1d. campaign_join_codes. A code whose preset turf was re-cut falls back to the turf picker
  // (that is what turf_id NULL means — see the table's creation comment); a code whose campaign
  // is gone keeps resolving the tenant, campaign-less.
  await sql`
    DELETE FROM public.campaign_join_codes j
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = j.tenant_id)
  `.execute(db);
  await sql`
    UPDATE public.campaign_join_codes j SET turf_id = NULL
    WHERE turf_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.turfs tf WHERE tf.id = j.turf_id)
  `.execute(db);
  await sql`
    UPDATE public.campaign_join_codes j SET campaign_id = NULL
    WHERE campaign_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = j.campaign_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.campaign_join_codes
      ADD CONSTRAINT fk_campaign_join_codes_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_campaign_join_codes_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns (id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_campaign_join_codes_turf FOREIGN KEY (turf_id) REFERENCES public.turfs (id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_campaign_join_codes_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers (id),
      ADD CONSTRAINT fk_campaign_join_codes_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers (id)
  `.execute(db);

  // 1e. companion_approval_tokens / companion_organizer_tokens — bearer credentials, CASCADE from
  // every parent: an approve/organizer link must die with its volunteer, admin, or join code.
  await sql`
    DELETE FROM public.companion_approval_tokens a
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM public.companion_volunteers v WHERE v.id = a.volunteer_id)
       OR NOT EXISTS (SELECT 1 FROM public.authusers u WHERE u.id = a.admin_user_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.companion_approval_tokens
      ADD CONSTRAINT fk_companion_approval_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_companion_approval_tokens_volunteer FOREIGN KEY (volunteer_id) REFERENCES public.companion_volunteers (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_companion_approval_tokens_admin FOREIGN KEY (admin_user_id) REFERENCES public.authusers (id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    DELETE FROM public.companion_organizer_tokens o
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = o.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM public.campaign_join_codes j WHERE j.id = o.join_code_id)
       OR NOT EXISTS (SELECT 1 FROM public.authusers u WHERE u.id = o.admin_user_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.companion_organizer_tokens
      ADD CONSTRAINT fk_companion_organizer_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_companion_organizer_tokens_join_code FOREIGN KEY (join_code_id) REFERENCES public.campaign_join_codes (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_companion_organizer_tokens_admin FOREIGN KEY (admin_user_id) REFERENCES public.authusers (id) ON DELETE CASCADE
  `.execute(db);

  // 1f. turf_segment_claims. Claims for re-cut turfs are dead advisory state — delete; a claim
  // whose person was deleted stays as history with the link severed (canvasser_name is the record).
  await sql`ALTER TABLE public.turf_segment_claims ALTER COLUMN volunteer_person_id DROP NOT NULL`.execute(db);
  await sql`
    DELETE FROM public.turf_segment_claims c
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = c.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM public.turfs tf WHERE tf.id = c.turf_id)
       OR NOT EXISTS (SELECT 1 FROM public.turf_assignments a WHERE a.id = c.assignment_id)
  `.execute(db);
  await sql`
    UPDATE public.turf_segment_claims c SET volunteer_person_id = NULL
    WHERE volunteer_person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = c.volunteer_person_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.turf_segment_claims
      ADD CONSTRAINT fk_turf_segment_claims_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_turf_segment_claims_turf FOREIGN KEY (turf_id) REFERENCES public.turfs (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_turf_segment_claims_assignment FOREIGN KEY (assignment_id) REFERENCES public.turf_assignments (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_turf_segment_claims_volunteer FOREIGN KEY (volunteer_person_id) REFERENCES public.persons (id) ON DELETE SET NULL
  `.execute(db);

  // 1g. geocode_cache. Deliberately not tied to households (surviving household deletion is the
  // point of the cache) — but it must die with its tenant.
  await sql`
    DELETE FROM public.geocode_cache g
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = g.tenant_id)
  `.execute(db);
  await sql`
    ALTER TABLE public.geocode_cache
      ADD CONSTRAINT fk_geocode_cache_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE
  `.execute(db);

  // ---------------------------------------------------------------------------------------------
  // 3. campaign_areas RLS — the shared tenant_isolation shape, verbatim.
  // ---------------------------------------------------------------------------------------------
  await sql`ALTER TABLE public.campaign_areas ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.campaign_areas FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation ON public.campaign_areas`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation ON public.campaign_areas
      USING (
        NULLIF(current_setting('app.tenant_id', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
      )
      WITH CHECK (
        NULLIF(current_setting('app.tenant_id', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
      )
  `.execute(db);

  // ---------------------------------------------------------------------------------------------
  // 4. Indexes.
  // ---------------------------------------------------------------------------------------------

  // The Lists grid and list detail join map_lists_persons/map_lists_households on list_id alone
  // (lists.repo.ts), and list deletion cascades hit the same columns; the composite PKs lead with
  // tenant_id so neither path had an index. These two are the hottest fix in this migration.
  await sql`CREATE INDEX IF NOT EXISTS idx_map_lists_persons_list ON public.map_lists_persons (list_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_map_lists_households_list ON public.map_lists_households (list_id)`.execute(
    db,
  );

  // Every claim attempt aggregates processing rows per tenant (job-claim.ts); the existing
  // (tenant_id, status) index leads with tenant_id, so that was a scan of every tenant-owned job
  // row including completed ones awaiting the prune. This partial stays a few rows big by
  // construction (bounded by worker concurrency).
  await sql`
    CREATE INDEX IF NOT EXISTS idx_background_jobs_processing_tenant
      ON public.background_jobs (tenant_id)
      WHERE status = 'processing'
  `.execute(db);

  // Cross-tenant retention prunes with no supporting index (same fix 2026-08-14 applied to
  // workflow_runs/notifications/companion_ops, extended to the sweeps it missed).
  await sql`CREATE INDEX IF NOT EXISTS idx_data_exports_created_prune ON public.data_exports (created_at)`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_data_imports_source_prune
      ON public.data_imports (processed_at)
      WHERE source_file_key IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_prune
      ON public.webhook_events (processed_at)
      WHERE status = 'processed'
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_failed_prune
      ON public.webhook_events (updated_at)
      WHERE status = 'failed'
  `.execute(db);

  // newsletter_events: the nightly per-tenant retention prune filters (tenant_id, created_at);
  // the person-detail activity pane filters (tenant_id, email) ordered by "timestamp". Both ran
  // against indexes leading (newsletter_id, ...) on one of the highest-insert tables.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_newsletter_events_tenant_created
      ON public.newsletter_events (tenant_id, created_at)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_newsletter_events_person_activity
      ON public.newsletter_events (tenant_id, email, "timestamp" DESC)
  `.execute(db);

  // Password-reset / email-verify links look the code hash up with no index; authusers is global
  // (not tenant-partitioned), so this walk grows with total user count.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_authusers_password_reset_code
      ON public.authusers (password_reset_code)
      WHERE password_reset_code IS NOT NULL
  `.execute(db);

  // event_ticket_types had no index at all beyond its keys; this serves the per-event read
  // (tenant_id, event_id ORDER BY sort_order) and the event-delete cascade in one.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_event_ticket_types_event
      ON public.event_ticket_types (tenant_id, event_id, sort_order)
  `.execute(db);

  // The public unsubscribe path resolves (tenant, campaign, email) with only a status-leading
  // index available.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaign_subscriptions_email
      ON public.campaign_subscriptions (tenant_id, campaign_id, email)
  `.execute(db);

  // Person-detail correspondence ("recent mail involving these addresses" — persons.service.ts)
  // orders the tenant's mail by recency with LIMIT; nothing indexed (tenant_id, created_at).
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emails_tenant_created
      ON public.emails (tenant_id, created_at DESC)
  `.execute(db);

  // Inbox sender matching (email.repo.ts): the sender joins compare lower(email)/lower(email2) per
  // page row. The existing unique on lower(email) carries a TRIM() in its predicate the planner
  // cannot prove from the join clause, and email2 had nothing. IS NOT NULL alone IS provable from
  // the strict = comparison, so these two are what actually serve the joins.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_persons_tenant_email_lookup
      ON public.persons (tenant_id, lower(email))
      WHERE email IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_persons_tenant_email2_lookup
      ON public.persons (tenant_id, lower(email2))
      WHERE email2 IS NOT NULL
  `.execute(db);

  // Referencing-side indexes for delete cascades that still seq-scanned their children (the
  // continuation of 2026-08-04-a-fk-ri-indexes, which covered persons/households referrers):
  // emptying email trash / the detached-mail sweep (email_read_states, email_trash), turf re-cuts
  // (turf_households, turf_knocks, turf_assignments), workflow deletion (workflow_runs,
  // workflow_steps), and shift deletion (canvass_location_pings).
  await sql`CREATE INDEX IF NOT EXISTS idx_email_read_states_email_ri ON public.email_read_states (email_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_email_trash_email_ri ON public.email_trash (email_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_turf_households_turf_ri ON public.turf_households (turf_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_turf_knocks_turf_ri ON public.turf_knocks (turf_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_turf_assignments_turf_ri ON public.turf_assignments (turf_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_turf_segment_claims_turf_ri ON public.turf_segment_claims (turf_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_turf_segment_claims_assignment_ri ON public.turf_segment_claims (assignment_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_ri ON public.workflow_runs (workflow_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_ri ON public.workflow_steps (workflow_id)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_canvass_pings_shift_ri ON public.canvass_location_pings (shift_id)`.execute(
    db,
  );

  // ---------------------------------------------------------------------------------------------
  // 5. Autovacuum for the churn tables 2026-08-13 missed. All three rewrite an indexed column
  // (sessions.status on rotation, webhook_events.status on claim/finish, emails.status/assigned_to
  // on triage), so none of those updates can be HOT and dead index tuples accumulate at the
  // update rate. Same settings, same SHARE UPDATE EXCLUSIVE-only lock as the 2026-08-13 file.
  // ---------------------------------------------------------------------------------------------
  for (const table of ['sessions', 'webhook_events', 'emails'] as const) {
    await sql`
      ALTER TABLE public.${sql.raw(table)}
        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_delay = 1)
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ['sessions', 'webhook_events', 'emails'] as const) {
    await sql`
      ALTER TABLE public.${sql.raw(table)}
        RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_cost_delay)
    `.execute(db);
  }

  for (const index of [
    'idx_canvass_pings_shift_ri',
    'idx_workflow_steps_workflow_ri',
    'idx_workflow_runs_workflow_ri',
    'idx_turf_segment_claims_assignment_ri',
    'idx_turf_segment_claims_turf_ri',
    'idx_turf_assignments_turf_ri',
    'idx_turf_knocks_turf_ri',
    'idx_turf_households_turf_ri',
    'idx_email_trash_email_ri',
    'idx_email_read_states_email_ri',
    'idx_persons_tenant_email2_lookup',
    'idx_persons_tenant_email_lookup',
    'idx_emails_tenant_created',
    'idx_campaign_subscriptions_email',
    'idx_event_ticket_types_event',
    'idx_authusers_password_reset_code',
    'idx_newsletter_events_person_activity',
    'idx_newsletter_events_tenant_created',
    'idx_webhook_events_failed_prune',
    'idx_webhook_events_processed_prune',
    'idx_data_imports_source_prune',
    'idx_data_exports_created_prune',
    'idx_background_jobs_processing_tenant',
    'idx_map_lists_households_list',
    'idx_map_lists_persons_list',
  ] as const) {
    await sql`DROP INDEX IF EXISTS public.${sql.raw(index)}`.execute(db);
  }

  await sql`DROP POLICY IF EXISTS tenant_isolation ON public.campaign_areas`.execute(db);
  await sql`ALTER TABLE public.campaign_areas NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.campaign_areas DISABLE ROW LEVEL SECURITY`.execute(db);

  const drops: Array<[string, string]> = [
    ['geocode_cache', 'fk_geocode_cache_tenant'],
    ['turf_segment_claims', 'fk_turf_segment_claims_volunteer'],
    ['turf_segment_claims', 'fk_turf_segment_claims_assignment'],
    ['turf_segment_claims', 'fk_turf_segment_claims_turf'],
    ['turf_segment_claims', 'fk_turf_segment_claims_tenant'],
    ['companion_organizer_tokens', 'fk_companion_organizer_tokens_admin'],
    ['companion_organizer_tokens', 'fk_companion_organizer_tokens_join_code'],
    ['companion_organizer_tokens', 'fk_companion_organizer_tokens_tenant'],
    ['companion_approval_tokens', 'fk_companion_approval_tokens_admin'],
    ['companion_approval_tokens', 'fk_companion_approval_tokens_volunteer'],
    ['companion_approval_tokens', 'fk_companion_approval_tokens_tenant'],
    ['campaign_join_codes', 'fk_campaign_join_codes_updatedby'],
    ['campaign_join_codes', 'fk_campaign_join_codes_createdby'],
    ['campaign_join_codes', 'fk_campaign_join_codes_turf'],
    ['campaign_join_codes', 'fk_campaign_join_codes_campaign'],
    ['campaign_join_codes', 'fk_campaign_join_codes_tenant'],
    ['receipt_statement_runs', 'fk_receipt_statement_runs_cursor_person'],
    ['receipt_statement_runs', 'fk_receipt_statement_runs_updatedby'],
    ['receipt_statement_runs', 'fk_receipt_statement_runs_createdby'],
    ['receipt_statement_runs', 'fk_receipt_statement_runs_requested_by'],
    ['receipt_statement_runs', 'fk_receipt_statement_runs_tenant'],
    ['receipt_counters', 'fk_receipt_counters_tenant'],
    ['donation_receipt_items', 'fk_donation_receipt_items_donation'],
    ['donation_receipt_items', 'fk_donation_receipt_items_receipt'],
    ['donation_receipt_items', 'fk_donation_receipt_items_tenant'],
    ['donation_receipts', 'fk_donation_receipts_updatedby'],
    ['donation_receipts', 'fk_donation_receipts_createdby'],
    ['donation_receipts', 'fk_donation_receipts_cancelled_by'],
    ['donation_receipts', 'fk_donation_receipts_replaces'],
    ['donation_receipts', 'fk_donation_receipts_file'],
    ['donation_receipts', 'fk_donation_receipts_campaign'],
    ['donation_receipts', 'fk_donation_receipts_person'],
    ['donation_receipts', 'fk_donation_receipts_tenant'],
    ['events', 'fk_events_updatedby'],
    ['events', 'fk_events_createdby'],
    ['events', 'fk_events_tenant'],
  ];
  for (const [table, constraint] of drops) {
    await sql`ALTER TABLE public.${sql.raw(table)} DROP CONSTRAINT IF EXISTS ${sql.raw(constraint)}`.execute(db);
  }

  // volunteer_person_id / person_id stay nullable on down(): restoring NOT NULL could fail on
  // rows the up() legitimately nulled, and nullable is the safe superset.

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_volunteer_events_tenant' AND conrelid = 'public.volunteer_events'::regclass) THEN
        ALTER TABLE public.volunteer_events RENAME CONSTRAINT fk_volunteer_events_tenant TO fk_events_tenant;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_volunteer_events_createdby' AND conrelid = 'public.volunteer_events'::regclass) THEN
        ALTER TABLE public.volunteer_events RENAME CONSTRAINT fk_volunteer_events_createdby TO fk_events_createdby;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_volunteer_events_updatedby' AND conrelid = 'public.volunteer_events'::regclass) THEN
        ALTER TABLE public.volunteer_events RENAME CONSTRAINT fk_volunteer_events_updatedby TO fk_events_updatedby;
      END IF;
    END $$
  `.execute(db);
}
