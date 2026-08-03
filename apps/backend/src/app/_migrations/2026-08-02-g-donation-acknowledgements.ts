import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Immediate donation acknowledgements — a receipt for every gift, in every workspace.
 *
 * Until now `donation_receipts` held only tax documents: an official receipt always belongs to one
 * of the six Canadian regimes, and a workspace that has not chosen one (a municipal campaign, any
 * United States workspace) sent its donors nothing at all. That is the wrong default. Every gift now
 * gets a plain acknowledgement immediately: it asserts no tax treatment, so it needs no regime, no
 * registration number, no authorized signatory and no mailing address.
 *
 * Three schema facts make that possible:
 *
 * - `regime` becomes nullable, and `chk_dr_regime` becomes per-kind. An acknowledgement must have
 *   NO regime; a tax receipt must have one; a year-end summary may go either way, because a
 *   workspace with no regime configured still sends its donors a summary and there is no
 *   jurisdiction to stamp on it. Tax documents therefore stay jurisdiction-tagged and
 *   acknowledgements stay out of that space — neither can drift into the other by an insert that
 *   forgets a column.
 * - `chk_dr_kind` gains 'acknowledgement'.
 * - `receipt_statement_runs.official_count` records how many donors a year-end run gave a numbered
 *   official receipt rather than an unnumbered summary. The run now produces both, and a progress
 *   row that cannot tell them apart cannot report the batch honestly.
 *
 * Two constraints deliberately need NO change:
 *
 * - `chk_dr_serial_presence` reads `(kind = 'statement') = (serial IS NULL)`. An acknowledgement is
 *   numbered, so it satisfies the existing rule unchanged. Its serial comes from a SEPARATE
 *   `receipt_counters` row (kind 'acknowledgement'), which the counter table's composite primary key
 *   already allows, so the official tax-receipt sequence stays gap-free and auditable.
 * - `chk_dr_qc_statement_only` forbids a Quebec regime row that is not a statement. Acknowledgements
 *   carry a NULL regime, so a Quebec workspace acknowledges every gift and still issues no tax
 *   receipt itself — which is the correct outcome, not a loophole.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.donation_receipts ALTER COLUMN regime DROP NOT NULL`.execute(db);

  await sql`ALTER TABLE public.donation_receipts DROP CONSTRAINT IF EXISTS chk_dr_kind`.execute(db);
  await sql`
    ALTER TABLE public.donation_receipts
      ADD CONSTRAINT chk_dr_kind CHECK (kind IN ('acknowledgement', 'per_gift', 'cumulative', 'statement'))
  `.execute(db);

  await sql`ALTER TABLE public.donation_receipts DROP CONSTRAINT IF EXISTS chk_dr_regime`.execute(db);
  await sql`
    ALTER TABLE public.donation_receipts
      ADD CONSTRAINT chk_dr_regime CHECK (
        CASE kind
          WHEN 'acknowledgement' THEN regime IS NULL
          WHEN 'statement' THEN regime IS NULL OR regime IN
            ('cra_charity', 'political_federal', 'political_on', 'political_bc', 'political_ab', 'political_qc')
          ELSE regime IN
            ('cra_charity', 'political_federal', 'political_on', 'political_bc', 'political_ab', 'political_qc')
        END
      )
  `.execute(db);

  await sql`
    ALTER TABLE public.receipt_statement_runs
      ADD COLUMN IF NOT EXISTS official_count integer NOT NULL DEFAULT 0
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.receipt_statement_runs DROP COLUMN IF EXISTS official_count`.execute(db);

  // Every row with no regime — acknowledgements, and the summaries an unconfigured workspace sent —
  // has no place in the pre-acknowledgement schema. Drop them before restoring the NOT NULL, or the
  // column change fails on their NULLs.
  await sql`
    DELETE FROM public.donation_receipt_items
      WHERE receipt_id IN (
        SELECT id FROM public.donation_receipts WHERE kind = 'acknowledgement' OR regime IS NULL
      )
  `.execute(db);
  await sql`DELETE FROM public.donation_receipts WHERE kind = 'acknowledgement' OR regime IS NULL`.execute(db);
  await sql`DELETE FROM public.receipt_counters WHERE kind = 'acknowledgement'`.execute(db);

  await sql`ALTER TABLE public.donation_receipts DROP CONSTRAINT IF EXISTS chk_dr_regime`.execute(db);
  await sql`
    ALTER TABLE public.donation_receipts
      ADD CONSTRAINT chk_dr_regime CHECK (regime IN
        ('cra_charity', 'political_federal', 'political_on', 'political_bc', 'political_ab', 'political_qc'))
  `.execute(db);

  await sql`ALTER TABLE public.donation_receipts DROP CONSTRAINT IF EXISTS chk_dr_kind`.execute(db);
  await sql`
    ALTER TABLE public.donation_receipts
      ADD CONSTRAINT chk_dr_kind CHECK (kind IN ('per_gift', 'cumulative', 'statement'))
  `.execute(db);

  await sql`ALTER TABLE public.donation_receipts ALTER COLUMN regime SET NOT NULL`.execute(db);
}
