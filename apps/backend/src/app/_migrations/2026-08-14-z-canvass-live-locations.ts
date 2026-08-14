import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Live volunteer locations for canvassing (the Live tab).
 *
 * Two tables with very different lifespans, split on purpose:
 *
 * - `canvass_shifts` — one row per walking session. Opens when the Companion first reports
 *   activity (a location ping or a knock batch), closes when the volunteer taps Finish, when
 *   30 minutes pass with no pings and no knocks (ended_at = the last activity, not the timeout
 *   moment — a phone that died at 6:41 must read "ended 6:41"), or at local midnight. The row
 *   OUTLIVES the day: started_at / ended_at / distance_walked_m are the aggregates that remain
 *   after the coordinates are gone.
 * - `canvass_location_pings` — one row per broadcast, written only while a shift is open.
 *   Deleted nightly once local midnight passes (see the purge_canvass_pings job). No coordinate
 *   persists past the day; that promise is what makes the feature acceptable to volunteers, so
 *   nothing else may ever read or copy these rows into longer-lived storage.
 *
 * The shift carries the LAST ping denormalized (last_lat/last_lng/last_accuracy_m/last_ping_at)
 * for two reasons: the distance accumulator needs the previous point without re-reading the ping
 * table on every insert, and last_activity_at is what the 30-minute close reads. Positions shown
 * in the CRM always come from the pings themselves (accuracy-filtered) — a closed shift shows an
 * end time and totals, never a position.
 *
 * `location_state` records what the device told us: 'sharing' once a coordinate arrived, 'off'
 * when the volunteer declined the browser permission (their row still shows knocks and door
 * counts — knock data does not depend on location), 'unknown' before either happened.
 *
 * `campaigns.canvass_location_precision` is the campaign-level privacy fallback: 'street'
 * (default) returns coordinates and paths to the CRM; 'turf' makes every live read return only
 * turf-level presence — the API omits coordinates entirely, so no client can draw a dot it was
 * never sent.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.canvass_shifts (
      id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id            bigint NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
      turf_id              bigint NOT NULL REFERENCES public.turfs (id) ON DELETE CASCADE,
      campaign_id          bigint REFERENCES public.campaigns (id) ON DELETE SET NULL,
      volunteer_person_id  bigint NOT NULL REFERENCES public.persons (id) ON DELETE CASCADE,
      canvasser_name       text   NOT NULL,
      started_at           timestamptz NOT NULL DEFAULT now(),
      last_activity_at     timestamptz NOT NULL DEFAULT now(),
      ended_at             timestamptz,
      end_reason           text CHECK (end_reason IN ('finished', 'timeout', 'midnight', 'switched')),
      location_state       text NOT NULL DEFAULT 'unknown' CHECK (location_state IN ('unknown', 'sharing', 'off')),
      distance_walked_m    double precision NOT NULL DEFAULT 0,
      last_lat             double precision,
      last_lng             double precision,
      last_accuracy_m      real,
      last_ping_at         timestamptz
    )
  `.execute(db);

  // The live board's two hot questions: open shifts on a turf, and this volunteer's open shift.
  await sql`
    CREATE INDEX IF NOT EXISTS ix_canvass_shifts_open_turf
      ON public.canvass_shifts (tenant_id, turf_id)
      WHERE ended_at IS NULL
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ix_canvass_shifts_open_volunteer
      ON public.canvass_shifts (tenant_id, volunteer_person_id)
      WHERE ended_at IS NULL
  `.execute(db);
  // "Wrapped up today" reads shifts by start time; the midnight job scans the same way.
  await sql`
    CREATE INDEX IF NOT EXISTS ix_canvass_shifts_tenant_started
      ON public.canvass_shifts (tenant_id, started_at)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.canvass_location_pings (
      id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id            bigint NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
      shift_id             bigint NOT NULL REFERENCES public.canvass_shifts (id) ON DELETE CASCADE,
      turf_id              bigint NOT NULL,
      volunteer_person_id  bigint NOT NULL,
      lat                  double precision NOT NULL,
      lng                  double precision NOT NULL,
      accuracy_m           real,
      recorded_at          timestamptz,
      received_at          timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  // Path reads are "this shift's pings in order"; the purge deletes by age per tenant.
  await sql`
    CREATE INDEX IF NOT EXISTS ix_canvass_pings_shift
      ON public.canvass_location_pings (tenant_id, shift_id, received_at)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ix_canvass_pings_tenant_received
      ON public.canvass_location_pings (tenant_id, received_at)
  `.execute(db);

  // High-churn table (every row written today is deleted tonight): same autovacuum posture as
  // the other churn tables (2026-08-13-autovacuum-churn-tables).
  await sql`
    ALTER TABLE public.canvass_location_pings SET (
      autovacuum_vacuum_scale_factor = 0.02,
      autovacuum_vacuum_cost_delay = 0
    )
  `.execute(db);

  for (const table of ['canvass_shifts', 'canvass_location_pings']) {
    await sql`ALTER TABLE public.${sql.raw(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE public.${sql.raw(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant_isolation ON public.${sql.raw(table)}`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation ON public.${sql.raw(table)}
        USING (
          NULLIF(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        )
        WITH CHECK (
          NULLIF(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        )
    `.execute(db);
  }

  // Campaign-level location precision for the Live surfaces. 'street' = dots and paths;
  // 'turf' = presence only, the API never returns a coordinate.
  await sql`
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS canvass_location_precision text NOT NULL DEFAULT 'street'
        CHECK (canvass_location_precision IN ('street', 'turf'))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.campaigns DROP COLUMN IF EXISTS canvass_location_precision`.execute(db);
  await sql`DROP TABLE IF EXISTS public.canvass_location_pings`.execute(db);
  await sql`DROP TABLE IF EXISTS public.canvass_shifts`.execute(db);
}
