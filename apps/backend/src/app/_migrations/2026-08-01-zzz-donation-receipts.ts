import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Real donation receipts, replacing a boolean that lied.
 *
 * `donations.receipt_sent` was hardcoded true on every insert while nothing generated, stored
 * or emailed anything. This migration drops it and gives receipts real state:
 *
 * `donation_receipts`  — official receipts (CRA charitable / Canadian political regimes) and
 *                        year-end giving statements. Immutable once issued; corrections go
 *                        through cancel-and-replace (`replaces_receipt_id`), because CRA and the
 *                        provincial regimes all require cancelled receipts to be RETAINED and a
 *                        replacement to print both serial numbers. Donor identity and issuer
 *                        details are frozen onto the row at issue time so a later edit to the
 *                        person or the settings cannot silently rewrite an issued receipt.
 * `donation_receipt_items` — the gifts a receipt covers. Used by every kind (a per-gift receipt
 *                        has exactly one item) so "which live receipt covers donation X" is one
 *                        join, and cumulative receipts/statements need no special casing.
 * `receipt_counters`   — gap-free serial numbering, one row per (tenant, year, kind), bumped
 *                        with INSERT … ON CONFLICT DO UPDATE … RETURNING inside the same
 *                        transaction as the receipt insert. A rolled-back issuance returns its
 *                        number; concurrent issuers serialize on the row lock. (Plain FOR UPDATE
 *                        cannot serialize insert-if-absent — see lib/jobs/reschedule.ts.)
 * `receipt_statement_runs` — progress row for the year-end statement batch (keyset cursor,
 *                        counters, one live run per tenant-year).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.donation_receipts (
      id                    bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id             bigint      NOT NULL,
      kind                  text        NOT NULL,
      regime                text        NOT NULL,
      year                  integer     NOT NULL,
      serial                integer,
      receipt_number        text,
      status                text        NOT NULL DEFAULT 'issued',
      person_id             bigint      NOT NULL,
      campaign_id           bigint,
      donor_name            text        NOT NULL,
      donor_email           text,
      donor_address_line1   text,
      donor_address_line2   text,
      donor_city            text,
      donor_province        text,
      donor_postal_code     text,
      donor_country         text,
      amount_cents          integer     NOT NULL,
      advantage_cents       integer     NOT NULL DEFAULT 0,
      eligible_cents        integer     NOT NULL,
      advantage_description text,
      gift_date             date,
      issuer_snapshot       jsonb       NOT NULL,
      replaces_receipt_id   bigint,
      reissue_required      boolean     NOT NULL DEFAULT false,
      cancelled_reason      text,
      cancelled_at          timestamptz,
      cancelled_by          bigint,
      file_id               bigint,
      issued_at             timestamptz NOT NULL DEFAULT now(),
      emailed_at            timestamptz,
      createdby_id          bigint      NOT NULL,
      updatedby_id          bigint      NOT NULL,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT donation_receipts_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT donation_receipts_id_key UNIQUE (id),
      CONSTRAINT chk_dr_kind CHECK (kind IN ('per_gift', 'cumulative', 'statement')),
      CONSTRAINT chk_dr_regime CHECK (regime IN
        ('cra_charity', 'political_federal', 'political_on', 'political_bc', 'political_ab', 'political_qc')),
      CONSTRAINT chk_dr_qc_statement_only CHECK (regime <> 'political_qc' OR kind = 'statement'),
      CONSTRAINT chk_dr_status CHECK (status IN ('issued', 'cancelled')),
      CONSTRAINT chk_dr_serial_presence CHECK ((kind = 'statement') = (serial IS NULL)),
      CONSTRAINT chk_dr_number_presence CHECK ((serial IS NULL) = (receipt_number IS NULL)),
      CONSTRAINT chk_dr_amounts CHECK (
        amount_cents > 0 AND advantage_cents >= 0 AND eligible_cents = amount_cents - advantage_cents
      ),
      CONSTRAINT chk_dr_cancelled_fields CHECK (
        status <> 'cancelled' OR (cancelled_reason IS NOT NULL AND cancelled_at IS NOT NULL)
      )
    )
  `.execute(db);

  // Serial uniqueness inside a tenant-year; gap-freeness comes from receipt_counters.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_serial
      ON public.donation_receipts (tenant_id, year, serial)
      WHERE serial IS NOT NULL
  `.execute(db);

  // One LIVE statement per donor per year — also the batch job's idempotency key on rerun.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_statement
      ON public.donation_receipts (tenant_id, person_id, year)
      WHERE kind = 'statement' AND status = 'issued'
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_donation_receipts_person
      ON public.donation_receipts (tenant_id, person_id, year)
  `.execute(db);

  // The receipts list and its needs-attention filter (cancelled / reissue_required).
  await sql`
    CREATE INDEX IF NOT EXISTS idx_donation_receipts_status
      ON public.donation_receipts (tenant_id, status, kind)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.donation_receipt_items (
      id           bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id    bigint      NOT NULL,
      receipt_id   bigint      NOT NULL,
      donation_id  bigint      NOT NULL,
      amount_cents integer     NOT NULL,
      gift_date    date        NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT donation_receipt_items_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT donation_receipt_items_id_key UNIQUE (id),
      CONSTRAINT uq_dri_receipt_donation UNIQUE (tenant_id, receipt_id, donation_id),
      CONSTRAINT chk_dri_amount CHECK (amount_cents > 0)
    )
  `.execute(db);

  // "Which receipts cover this donation" — the refund hook and the grid's receipt-state join.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_dri_donation
      ON public.donation_receipt_items (tenant_id, donation_id)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.receipt_counters (
      tenant_id bigint  NOT NULL,
      year      integer NOT NULL,
      kind      text    NOT NULL,
      n         integer NOT NULL,
      CONSTRAINT receipt_counters_pk PRIMARY KEY (tenant_id, year, kind),
      CONSTRAINT chk_rc_n CHECK (n > 0)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.receipt_statement_runs (
      id               bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id        bigint      NOT NULL,
      year             integer     NOT NULL,
      status           text        NOT NULL DEFAULT 'running',
      cursor_person_id bigint,
      donors_total     integer,
      generated_count  integer     NOT NULL DEFAULT 0,
      emailed_count    integer     NOT NULL DEFAULT 0,
      skipped_no_email integer     NOT NULL DEFAULT 0,
      failed_count     integer     NOT NULL DEFAULT 0,
      error            text,
      requested_by     bigint      NOT NULL,
      createdby_id     bigint      NOT NULL,
      updatedby_id     bigint      NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT receipt_statement_runs_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT receipt_statement_runs_id_key UNIQUE (id),
      CONSTRAINT chk_rsr_status CHECK (status IN ('running', 'completed', 'failed'))
    )
  `.execute(db);

  // A second concurrent run for the same year could double-email donors mid-continuation.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rsr_one_running
      ON public.receipt_statement_runs (tenant_id, year)
      WHERE status = 'running'
  `.execute(db);

  // Tenant isolation, same NULLIF-escape shape as every other table: background-job paths run
  // with no app.tenant_id GUC and rely on explicit .where('tenant_id', ...) scoping.
  for (const table of [
    'donation_receipts',
    'donation_receipt_items',
    'receipt_counters',
    'receipt_statement_runs',
  ] as const) {
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

  // The boolean that claimed receipts were sent while nothing sent them. Receipt state is now
  // derived from donation_receipt_items ⋈ donation_receipts.
  await sql`ALTER TABLE public.donations DROP COLUMN IF EXISTS receipt_sent`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS receipt_sent boolean DEFAULT true NOT NULL
  `.execute(db);
  await sql`DROP TABLE IF EXISTS public.receipt_statement_runs`.execute(db);
  await sql`DROP TABLE IF EXISTS public.receipt_counters`.execute(db);
  await sql`DROP TABLE IF EXISTS public.donation_receipt_items`.execute(db);
  await sql`DROP TABLE IF EXISTS public.donation_receipts`.execute(db);
}
