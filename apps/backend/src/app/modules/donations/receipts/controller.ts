import {
  RECEIPT_ISSUER_FIELD_LABELS,
  RECEIPT_REGIMES,
  toWorkspaceCurrency,
  type ReceiptIssuerField,
  type ReceiptRegimeId,
  type ReceiptRegimeSpec,
} from '@common';
import type { Selectable, Transaction } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BadRequestError, ConflictError, NotFoundError, PreconditionFailedError } from '../../../errors/app-errors';
import { BaseController } from '../../../lib/base.controller';
import { buildReceiptPdf, type ReceiptIssuerSnapshot } from '../../../lib/pdf/receipt-pdf';
import { torontoDateString } from '../../../lib/pdf/pdf-common';
import { StorageService } from '../../../lib/storage.service';
import { logger } from '../../../logger';
import { SettingsRepo } from '../../settings/repositories/settings.repo';
import { DonationsRepo } from '../repositories/donations.repo';
import { ReceiptsRepo, type ReceiptItemInput, type ReceiptRow } from '../repositories/receipts.repo';

/** The receipts.* workspace settings, loaded in one pass. Client-readable — nothing secret. */
export interface ReceiptWorkspaceSettings {
  regime: ReceiptRegimeId | null;
  mode: 'per_gift' | 'annual_cumulative';
  autoIssue: boolean;
  numberPrefix: string;
  values: Partial<Record<ReceiptIssuerField, string>>;
}

interface DonorSnapshot {
  name: string;
  email: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
}

type IssueOptions = {
  advantageCents?: number;
  advantageDescription?: string;
  /** 'auto' skips silently on blocks (settings problems can't be fixed by a retry); 'manual' throws. */
  mode: 'manual' | 'auto';
};

const SERIAL_PAD = 5;

/** Calendar year in Toronto — the numbering year for official receipts (issue-date year). */
export function torontoYear(date: Date): number {
  return Number(torontoDateString(date).slice(0, 4));
}

/** Postgres unique-violation (SQLSTATE 23505) — same probe as settings/controller.ts. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

export class DonationReceiptsController extends BaseController<'donation_receipts', ReceiptsRepo> {
  private settingsRepo = new SettingsRepo();
  private donationsRepo = new DonationsRepo();

  constructor() {
    super(new ReceiptsRepo());
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  public async loadSettings(tenantId: string): Promise<ReceiptWorkspaceSettings> {
    const rows = await this.settingsRepo.getAllForTenant(tenantId);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const str = (key: string): string => {
      const value = map.get(`receipts.${key}`);
      return typeof value === 'string' ? value.trim() : '';
    };
    const regime = str('regime');
    return {
      regime: regime && regime in RECEIPT_REGIMES ? (regime as ReceiptRegimeId) : null,
      mode: str('mode') === 'annual_cumulative' ? 'annual_cumulative' : 'per_gift',
      autoIssue: map.get('receipts.auto_issue') === true,
      numberPrefix: str('number_prefix') || 'R',
      values: {
        org_legal_name: str('org_legal_name'),
        org_address: str('org_address'),
        registration_number: str('registration_number'),
        signatory_name: str('signatory_name'),
        signatory_title: str('signatory_title'),
        signature_file_id: str('signature_file_id'),
        place_of_issue: str('place_of_issue'),
        agent_name: str('agent_name'),
        electoral_district: str('electoral_district'),
        polling_day: str('polling_day'),
      },
    };
  }

  /** Which regime fields are still missing (labels), for the settings banner and issue guards. */
  private missingFields(settings: ReceiptWorkspaceSettings, spec: ReceiptRegimeSpec, forCandidate: boolean): string[] {
    const required = forCandidate
      ? [...spec.requiredIssuerFields, ...spec.candidateExtraFields]
      : spec.requiredIssuerFields;
    return required.filter((field) => !settings.values[field]).map((field) => RECEIPT_ISSUER_FIELD_LABELS[field]);
  }

  /**
   * Prescribed fields that are absent but do NOT stop a receipt going out — currently the
   * signature image. Reported so the workspace knows; never fed to `assertIssuable`.
   */
  private advisoryMissingFields(settings: ReceiptWorkspaceSettings, spec: ReceiptRegimeSpec): string[] {
    return spec.advisoryIssuerFields
      .filter((field) => !settings.values[field])
      .map((field) => RECEIPT_ISSUER_FIELD_LABELS[field]);
  }

  public async getReceiptSettingsStatus(tenantId: string): Promise<{
    regime: ReceiptRegimeId | null;
    mode: 'per_gift' | 'annual_cumulative';
    autoIssue: boolean;
    complete: boolean;
    missing: string[];
    advisory: string[];
    advisoryMessage: string | null;
    externalIssuance: boolean;
    message: string | null;
  }> {
    const settings = await this.loadSettings(tenantId);
    if (!settings.regime) {
      return {
        regime: null,
        mode: settings.mode,
        autoIssue: settings.autoIssue,
        complete: false,
        missing: ['receipting regime'],
        advisory: [],
        advisoryMessage: null,
        externalIssuance: false,
        message: 'Choose a receipting regime in Workspace settings → Donations before issuing receipts.',
      };
    }
    const spec = RECEIPT_REGIMES[settings.regime];
    if (spec.issuance === 'external') {
      return {
        regime: settings.regime,
        mode: settings.mode,
        autoIssue: settings.autoIssue,
        complete: false,
        missing: [],
        advisory: [],
        advisoryMessage: null,
        externalIssuance: true,
        message: spec.externalExplanation ?? null,
      };
    }
    const missing = this.missingFields(settings, spec, false);
    const advisory = this.advisoryMissingFields(settings, spec);
    return {
      regime: settings.regime,
      mode: settings.mode,
      autoIssue: settings.autoIssue,
      complete: missing.length === 0,
      missing,
      advisory,
      advisoryMessage: advisory.length
        ? `This regime prescribes a ${advisory.join(', ')} on receipts. Receipts still issue without one — ` +
          'add it if your organization wants it printed.'
        : null,
      externalIssuance: false,
      message: missing.length ? `Missing: ${missing.join(', ')}.` : null,
    };
  }

  private async workspaceCurrency(tenantId: string): Promise<string> {
    const row = await this.settingsRepo.getByKey({ tenant_id: tenantId, key: 'organization.currency' });
    return toWorkspaceCurrency(typeof row?.value === 'string' ? row.value : undefined);
  }

  // ── Donor snapshot ──────────────────────────────────────────────────────────

  /**
   * Donor identity + mailing address frozen onto the receipt. Address priority: the donation
   * row's own snapshot (collected at gift time — required since 2026-08), then the person's
   * household. Null address → the caller blocks with "needs donor address" (legacy gifts only).
   */
  private async resolveDonor(
    tenantId: string,
    personId: string,
    donation?: Selectable<Models['donations']> | null,
  ): Promise<{ donor: DonorSnapshot | null; hasAddress: boolean }> {
    const person = await this.donationsRepo.db
      .selectFrom('persons')
      .leftJoin('households', 'households.id', 'persons.household_id')
      .select([
        'persons.first_name',
        'persons.middle_names',
        'persons.last_name',
        'persons.email',
        'households.street_num',
        'households.street1',
        'households.street2',
        'households.apt',
        'households.city',
        'households.state',
        'households.zip',
        'households.country',
      ])
      .where('persons.tenant_id', '=', tenantId)
      .where('persons.id', '=', personId)
      .executeTakeFirst();

    const name = [person?.first_name, person?.middle_names, person?.last_name]
      .concat(!person ? [donation?.first_name, donation?.last_name] : [])
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' ')
      .trim();
    if (!name) return { donor: null, hasAddress: false };

    let line1: string | null = null;
    let line2: string | null = null;
    let city: string | null = null;
    let province: string | null = null;
    let postalCode: string | null = null;
    let country: string | null = null;

    if (donation?.street && donation.city) {
      line1 = donation.street;
      line2 = donation.apt;
      city = donation.city;
      province = donation.state;
      postalCode = donation.zip;
      country = donation.country;
    } else if (person && (person.street1 || person.street_num) && person.city) {
      line1 = [person.street_num, person.street1].filter(Boolean).join(' ') || null;
      line2 = [person.apt, person.street2].filter(Boolean).join(', ') || null;
      city = person.city;
      province = person.state ?? null;
      postalCode = person.zip ?? null;
      country = person.country ?? null;
    }

    return {
      donor: {
        name,
        email: person?.email ?? donation?.email ?? null,
        line1,
        line2,
        city,
        province,
        postalCode,
        country,
      },
      hasAddress: Boolean(line1 && city),
    };
  }

  private donorAddressLines(receipt: ReceiptRow): string[] {
    return [
      [receipt.donor_address_line1, receipt.donor_address_line2].filter(Boolean).join(', '),
      [receipt.donor_city, receipt.donor_province, receipt.donor_postal_code].filter(Boolean).join(', '),
      receipt.donor_country ?? '',
    ].filter((line) => line.trim().length > 0);
  }

  // ── Issuance ────────────────────────────────────────────────────────────────

  /**
   * Everything that must be true before this workspace may issue ANY official receipt.
   * Returns the pieces issuance needs; throws PreconditionFailedError with a fix-it message.
   */
  private async assertIssuable(
    tenantId: string,
    forCandidateCampaign: boolean,
  ): Promise<{ settings: ReceiptWorkspaceSettings; spec: ReceiptRegimeSpec }> {
    const settings = await this.loadSettings(tenantId);
    if (!settings.regime) {
      throw new PreconditionFailedError(
        'Choose a receipting regime in Workspace settings → Donations before issuing receipts.',
      );
    }
    const spec = RECEIPT_REGIMES[settings.regime];
    if (spec.issuance === 'external') {
      throw new PreconditionFailedError(
        spec.externalExplanation ??
          'This regime’s receipts are issued by the electoral authority, not by this workspace.',
      );
    }
    if (forCandidateCampaign && spec.candidateIssuance === 'external') {
      throw new PreconditionFailedError(
        spec.candidateExternalExplanation ??
          'Candidate-campaign contributions are receipted by the electoral authority.',
      );
    }
    const missing = this.missingFields(settings, spec, forCandidateCampaign);
    if (missing.length > 0) {
      throw new PreconditionFailedError(
        `Finish receipt setup in Workspace settings → Donations. Missing: ${missing.join(', ')}.`,
      );
    }
    return { settings, spec };
  }

  /** The issuer details frozen onto the receipt row (and printed) — from settings, at issue time. */
  private issuerSnapshot(settings: ReceiptWorkspaceSettings): ReceiptIssuerSnapshot {
    const v = settings.values;
    return {
      org_legal_name: v.org_legal_name || undefined,
      org_address: v.org_address || undefined,
      registration_number: v.registration_number || undefined,
      place_of_issue: v.place_of_issue || undefined,
      signatory_name: v.signatory_name || undefined,
      signatory_title: v.signatory_title || undefined,
      agent_name: v.agent_name || undefined,
      electoral_district: v.electoral_district || undefined,
      polling_day: v.polling_day || undefined,
    };
  }

  private formatNumber(prefix: string, year: number, serial: number): string {
    return `${prefix}-${year}-${String(serial).padStart(SERIAL_PAD, '0')}`;
  }

  private validateAdvantage(amountCents: number, advantageCents: number): void {
    if (advantageCents < 0 || advantageCents >= amountCents) {
      throw new BadRequestError('The advantage must be smaller than the gift amount.');
    }
  }

  private async isElectionCampaign(tenantId: string, campaignId: string | null): Promise<boolean> {
    if (!campaignId) return false;
    const campaign = await this.donationsRepo.db
      .selectFrom('campaigns')
      .select('kind')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', campaignId)
      .executeTakeFirst();
    return campaign?.kind === 'election';
  }

  /** Issue one official per-gift receipt. The manual path; the auto path wraps it (tryAutoIssue). */
  public async issueReceipt(
    auth: { tenant_id: string; user_id: string },
    donationId: string,
    opts: { advantageCents?: number; advantageDescription?: string },
  ): Promise<ReceiptRow> {
    return this.issueOfficialForDonation(auth.tenant_id, auth.user_id, donationId, { ...opts, mode: 'manual' });
  }

  /**
   * Auto-issue from the background job. Never throws for settings/eligibility problems — those
   * can't be fixed by a retry; the gift simply stays visibly unreceipted. Returns the skip reason
   * for the job log.
   */
  public async tryAutoIssue(
    tenantId: string,
    donationId: string,
    userId: string,
  ): Promise<{ receipt: ReceiptRow | null; skipped?: string }> {
    try {
      const receipt = await this.issueOfficialForDonation(tenantId, userId, donationId, { mode: 'auto' });
      return { receipt };
    } catch (err) {
      if (err instanceof PreconditionFailedError || err instanceof ConflictError || err instanceof BadRequestError) {
        return { receipt: null, skipped: err.message };
      }
      throw err;
    }
  }

  private async issueOfficialForDonation(
    tenantId: string,
    userId: string,
    donationId: string,
    opts: IssueOptions,
  ): Promise<ReceiptRow> {
    const donation = await this.donationsRepo.db
      .selectFrom('donations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', donationId)
      .executeTakeFirst();
    if (!donation) throw new NotFoundError('Donation not found');
    if (donation.status !== 'succeeded') {
      throw new ConflictError('Only successful gifts can be receipted — this one was refunded or disputed.');
    }
    if (!donation.person_id) {
      throw new PreconditionFailedError('This gift has no donor on file — link it to a person first.');
    }

    const forCandidate = await this.isElectionCampaign(tenantId, donation.campaign_id);
    const { settings, spec } = await this.assertIssuable(tenantId, forCandidate);

    if (opts.mode === 'auto') {
      if (settings.mode === 'annual_cumulative') {
        throw new PreconditionFailedError('Workspace uses one cumulative receipt per donor per year.');
      }
      if (spec.autoIssueThresholdCents && donation.amount < spec.autoIssueThresholdCents) {
        throw new PreconditionFailedError(
          `Below this regime’s auto-issue threshold (${spec.autoIssueThresholdCents / 100} dollars) — issue manually if the donor asks.`,
        );
      }
    }

    const { donor, hasAddress } = await this.resolveDonor(tenantId, donation.person_id, donation);
    if (!donor) throw new PreconditionFailedError('This gift has no donor name on file.');
    if (!hasAddress) {
      throw new PreconditionFailedError(
        'This donor has no mailing address on file. Add one to their household, then issue the receipt.',
      );
    }

    const advantageCents = opts.advantageCents ?? 0;
    this.validateAdvantage(donation.amount, advantageCents);

    const now = new Date();
    const year = torontoYear(now);
    const giftDate = torontoDateString(new Date(donation.created_at));

    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // The counter row lock serializes issuers per tenant-year, so this coverage re-check
        // inside the transaction is race-free: two racing issues for one gift cannot both pass.
        const serial = await this.getRepo().nextSerial(trx, tenantId, year);
        const existing = await this.getRepo().getOfficialReceiptsForDonation(tenantId, donationId, trx);
        if (existing.some((r) => r.status === 'issued')) {
          throw new ConflictError('This gift already has a receipt. Cancel it first to reissue.');
        }

        const receipt = await this.insertOfficialReceipt(trx, {
          tenantId,
          userId,
          kind: 'per_gift',
          regime: settings.regime as ReceiptRegimeId,
          year,
          serial,
          numberPrefix: settings.numberPrefix,
          personId: String(donation.person_id),
          campaignId: donation.campaign_id,
          donor,
          amountCents: donation.amount,
          advantageCents,
          advantageDescription: opts.advantageDescription ?? null,
          giftDate,
          issuerSnapshot: this.issuerSnapshot(settings),
          replacesReceiptId: null,
          items: [{ donation_id: donationId, amount_cents: donation.amount, gift_date: giftDate }],
        });

        await this.logActivity(
          trx,
          tenantId,
          userId,
          String(donation.person_id),
          `Issued receipt ${receipt.receipt_number}`,
        );
        return receipt;
      });
  }

  /** Annual cumulative mode: one official receipt covering a donor's un-receipted gifts in a year. */
  public async issueCumulativeReceipt(
    auth: { tenant_id: string; user_id: string },
    personId: string,
    year: number,
    opts: { advantageCents?: number; advantageDescription?: string },
  ): Promise<ReceiptRow> {
    const tenantId = auth.tenant_id;
    const { settings } = await this.assertIssuable(tenantId, false);

    const { donor, hasAddress } = await this.resolveDonor(tenantId, personId);
    if (!donor) throw new NotFoundError('Person not found');
    if (!hasAddress) {
      throw new PreconditionFailedError(
        'This donor has no mailing address on file. Add one to their household, then issue the receipt.',
      );
    }

    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const serial = await this.getRepo().nextSerial(trx, tenantId, torontoYear(new Date()));
        // After the counter lock: gather what is STILL un-receipted (racing issues serialized).
        const donations = await this.getRepo().getUnreceiptedSucceededDonations(tenantId, personId, year, trx);
        if (donations.length === 0) {
          throw new ConflictError(`No un-receipted gifts for ${year} — every gift is already covered.`);
        }

        const amountCents = donations.reduce((sum, d) => sum + d.amount, 0);
        const advantageCents = opts.advantageCents ?? 0;
        this.validateAdvantage(amountCents, advantageCents);

        const receipt = await this.insertOfficialReceipt(trx, {
          tenantId,
          userId: auth.user_id,
          kind: 'cumulative',
          regime: settings.regime as ReceiptRegimeId,
          year: torontoYear(new Date()),
          serial,
          numberPrefix: settings.numberPrefix,
          personId,
          campaignId: null,
          donor,
          amountCents,
          advantageCents,
          advantageDescription: opts.advantageDescription ?? null,
          giftDate: null,
          issuerSnapshot: this.issuerSnapshot(settings),
          replacesReceiptId: null,
          items: donations.map((d) => ({
            donation_id: d.id,
            amount_cents: d.amount,
            gift_date: torontoDateString(new Date(d.created_at)),
          })),
        });

        await this.logActivity(
          trx,
          tenantId,
          auth.user_id,
          personId,
          `Issued cumulative receipt ${receipt.receipt_number} covering ${donations.length} gifts`,
        );
        return receipt;
      });
  }

  private async insertOfficialReceipt(
    trx: Transaction<Models>,
    input: {
      tenantId: string;
      userId: string;
      kind: 'per_gift' | 'cumulative';
      regime: ReceiptRegimeId;
      year: number;
      serial: number;
      numberPrefix: string;
      personId: string;
      campaignId: string | null;
      donor: DonorSnapshot;
      amountCents: number;
      advantageCents: number;
      advantageDescription: string | null;
      giftDate: string | null;
      issuerSnapshot: ReceiptIssuerSnapshot;
      replacesReceiptId: string | null;
      items: ReceiptItemInput[];
    },
  ): Promise<ReceiptRow> {
    const receipt = await this.getRepo().insertReceiptWithItems(
      trx,
      {
        tenant_id: input.tenantId,
        kind: input.kind,
        regime: input.regime,
        year: input.year,
        serial: input.serial,
        receipt_number: this.formatNumber(input.numberPrefix, input.year, input.serial),
        status: 'issued',
        person_id: input.personId,
        campaign_id: input.campaignId,
        donor_name: input.donor.name,
        donor_email: input.donor.email,
        donor_address_line1: input.donor.line1,
        donor_address_line2: input.donor.line2,
        donor_city: input.donor.city,
        donor_province: input.donor.province,
        donor_postal_code: input.donor.postalCode,
        donor_country: input.donor.country,
        amount_cents: input.amountCents,
        advantage_cents: input.advantageCents,
        eligible_cents: input.amountCents - input.advantageCents,
        advantage_description: input.advantageDescription,
        gift_date: input.giftDate,
        issuer_snapshot: JSON.stringify(input.issuerSnapshot),
        replaces_receipt_id: input.replacesReceiptId,
        createdby_id: input.userId,
        updatedby_id: input.userId,
      },
      input.items,
    );

    // Transactional outbox: the PDF render + donor email happen in the worker, and the job
    // exists only if this issuance commits.
    await trx
      .insertInto('background_jobs')
      .values({
        tenant_id: input.tenantId,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'render-receipt-pdf',
          tenant_id: input.tenantId,
          receipt_id: receipt.id,
          email: true,
          user_id: input.userId,
        }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();

    return receipt;
  }

  // ── Cancel / reissue ────────────────────────────────────────────────────────

  public async cancelReceipt(
    auth: { tenant_id: string; user_id: string },
    receiptId: string,
    reason: string,
  ): Promise<ReceiptRow> {
    const receipt = await this.getRepo().getReceiptById(auth.tenant_id, receiptId);
    if (!receipt) throw new NotFoundError('Receipt not found');
    if (receipt.status !== 'issued') throw new ConflictError('This receipt is already cancelled.');

    await this.getRepo().cancelReceipt(auth.tenant_id, receiptId, auth.user_id, reason);
    await this.logActivity(
      this.getRepo().db,
      auth.tenant_id,
      auth.user_id,
      receipt.person_id,
      `Cancelled receipt ${receipt.receipt_number ?? receipt.id}: ${reason}`,
    );
    const updated = await this.getRepo().getReceiptById(auth.tenant_id, receiptId);
    if (!updated) throw new NotFoundError('Receipt not found');
    return updated;
  }

  /**
   * Cancel-and-replace. The successor takes a NEW serial from the current year's counter, points
   * at the predecessor, re-takes the donor snapshot (the usual reason for replacing is a wrong
   * name/address), and re-validates the covered gifts — refunded ones are dropped, which is how
   * a `reissue_required` cumulative receipt gets corrected. The PDF prints both serials.
   */
  public async reissueReceipt(
    auth: { tenant_id: string; user_id: string },
    receiptId: string,
    reason?: string,
  ): Promise<ReceiptRow> {
    const tenantId = auth.tenant_id;
    const predecessor = await this.getRepo().getReceiptById(tenantId, receiptId);
    if (!predecessor) throw new NotFoundError('Receipt not found');
    if (predecessor.kind === 'statement') {
      throw new BadRequestError('Statements are regenerated by rerunning the year, not reissued.');
    }
    if (predecessor.status === 'issued' && !reason?.trim()) {
      throw new BadRequestError('Give a short reason — it is recorded on the cancelled receipt.');
    }

    const forCandidate = await this.isElectionCampaign(tenantId, predecessor.campaign_id);
    const { settings } = await this.assertIssuable(tenantId, forCandidate);
    if (settings.regime !== predecessor.regime) {
      throw new PreconditionFailedError(
        'The workspace regime changed since this receipt was issued. Cancel it and issue a fresh receipt instead.',
      );
    }

    const items = await this.getRepo().getItems(tenantId, receiptId);
    const donationIds = items.map((i) => i.donation_id);
    const donations = donationIds.length
      ? await this.donationsRepo.db
          .selectFrom('donations')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', donationIds)
          .execute()
      : [];
    const surviving = donations.filter((d) => d.status === 'succeeded');
    if (surviving.length === 0) {
      throw new PreconditionFailedError('Every gift on this receipt was refunded — there is nothing left to reissue.');
    }

    const perGiftDonation = predecessor.kind === 'per_gift' ? surviving[0] : null;
    const { donor, hasAddress } = await this.resolveDonor(tenantId, predecessor.person_id, perGiftDonation);
    if (!donor || !hasAddress) {
      throw new PreconditionFailedError(
        'This donor has no mailing address on file. Add one to their household, then reissue.',
      );
    }

    const amountCents = surviving.reduce((sum, d) => sum + d.amount, 0);
    const advantageCents = predecessor.advantage_cents;
    if (advantageCents >= amountCents) {
      throw new PreconditionFailedError(
        'The recorded advantage now exceeds the surviving gifts. Cancel this receipt and issue a fresh one with a corrected advantage.',
      );
    }

    const now = new Date();
    const year = torontoYear(now);

    const successor = await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const serial = await this.getRepo().nextSerial(trx, tenantId, year);
        if (predecessor.status === 'issued') {
          // reason is validated non-empty above when the predecessor is still issued.
          await this.getRepo().cancelReceipt(tenantId, receiptId, auth.user_id, String(reason), { trx });
        } else {
          await this.getRepo().clearReissueRequired(trx, tenantId, receiptId);
        }

        const receipt = await this.insertOfficialReceipt(trx, {
          tenantId,
          userId: auth.user_id,
          kind: predecessor.kind === 'cumulative' ? 'cumulative' : 'per_gift',
          regime: predecessor.regime as ReceiptRegimeId,
          year,
          serial,
          numberPrefix: settings.numberPrefix,
          personId: predecessor.person_id,
          campaignId: predecessor.campaign_id,
          donor,
          amountCents,
          advantageCents,
          advantageDescription: predecessor.advantage_description,
          giftDate: perGiftDonation ? torontoDateString(new Date(perGiftDonation.created_at)) : null,
          issuerSnapshot: this.issuerSnapshot(settings),
          replacesReceiptId: predecessor.id,
          items: surviving.map((d) => ({
            donation_id: d.id,
            amount_cents: d.amount,
            gift_date: torontoDateString(new Date(d.created_at)),
          })),
        });

        await this.logActivity(
          trx,
          tenantId,
          auth.user_id,
          predecessor.person_id,
          `Receipt ${receipt.receipt_number} cancels and replaces ${predecessor.receipt_number ?? predecessor.id}`,
        );
        return receipt;
      });

    return successor;
  }

  // ── Refund hook (called from DonationsController.reverseDonation, same transaction) ─────────

  /**
   * A receipted gift was refunded or charged back: no receipt covering it may stand. Per-gift
   * receipts cancel outright; cumulative receipts cancel AND flag reissue_required (an immutable
   * receipt cannot shrink — a human confirms the corrected total via reissue); statements cancel
   * and come back on the next batch rerun.
   */
  public async cancelReceiptsForReversedDonation(
    trx: Transaction<Models>,
    tenantId: string,
    userId: string,
    donationId: string,
    verb: 'refunded' | 'disputed (chargeback)',
  ): Promise<void> {
    const live = await this.getRepo().getLiveReceiptsForDonation(tenantId, donationId, trx);
    for (const receipt of live) {
      const isCumulative = receipt.kind === 'cumulative';
      const reason =
        receipt.kind === 'per_gift'
          ? `Donation ${verb}`
          : isCumulative
            ? `A covered donation was ${verb} — reissue required`
            : `A covered donation was ${verb}`;
      await this.getRepo().cancelReceipt(tenantId, receipt.id, userId, reason, {
        reissueRequired: isCumulative,
        trx,
      });
      logger.info(
        { tenantId, receiptId: receipt.id, kind: receipt.kind, donationId },
        'Cancelled receipt because a covered donation was reversed',
      );
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  public async listReceipts(
    tenantId: string,
    filters: Parameters<ReceiptsRepo['listReceipts']>[1],
  ): Promise<ReceiptRow[]> {
    return this.getRepo().listReceipts(tenantId, filters);
  }

  // ── Preview (SPECIMEN) ──────────────────────────────────────────────────────

  /** A watermarked sample PDF from the current settings — no rows written. */
  public async previewReceipt(tenantId: string): Promise<{ pdfBase64: string }> {
    const settings = await this.loadSettings(tenantId);
    if (!settings.regime) {
      throw new PreconditionFailedError('Choose a receipting regime first.');
    }
    const spec = RECEIPT_REGIMES[settings.regime];
    if (spec.issuance === 'external') {
      throw new PreconditionFailedError(spec.externalExplanation ?? 'This regime does not print receipts here.');
    }

    const signatureImage = await this.loadSignatureImage(tenantId, settings.values.signature_file_id || null);
    const now = new Date();
    const pdf = await buildReceiptPdf({
      regime: spec,
      receiptNumber: this.formatNumber(settings.numberPrefix, torontoYear(now), 1),
      kind: 'per_gift',
      issuedAt: now,
      giftDate: torontoDateString(now),
      items: [],
      amountCents: 10000,
      advantageCents: 0,
      eligibleCents: 10000,
      advantageDescription: null,
      donorName: 'Sample Donor',
      donorAddressLines: ['123 Example Street', 'Sampletown, ON, A1A 1A1', 'Canada'],
      issuer: this.issuerSnapshot(settings),
      specimen: true,
      signatureImage,
      currency: await this.workspaceCurrency(tenantId),
    });
    return { pdfBase64: pdf.toString('base64') };
  }

  /** The signatory's facsimile signature from the files service (tenant-scoped). */
  public async loadSignatureImage(tenantId: string, fileId: string | null): Promise<Buffer | null> {
    if (!fileId) return null;
    const file = await this.getRepo()
      .db.selectFrom('files')
      .select(['storage_key'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .executeTakeFirst();
    if (!file) return null;
    try {
      return await new StorageService().download(file.storage_key);
    } catch (err) {
      logger.warn({ err, tenantId, fileId }, 'Receipt signature image could not be downloaded');
      return null;
    }
  }

  /** Everything the render job needs to draw an official receipt from a stored row. */
  public async buildPdfForReceipt(tenantId: string, receipt: ReceiptRow): Promise<Buffer> {
    const spec = RECEIPT_REGIMES[receipt.regime as ReceiptRegimeId];
    const settings = await this.loadSettings(tenantId);
    const issuer = (
      receipt.issuer_snapshot && typeof receipt.issuer_snapshot === 'object' ? receipt.issuer_snapshot : {}
    ) as ReceiptIssuerSnapshot;
    const items = await this.getRepo().getItems(tenantId, receipt.id);
    const replaces = receipt.replaces_receipt_id
      ? await this.getRepo().getReceiptById(tenantId, receipt.replaces_receipt_id)
      : null;
    const signatureImage = await this.loadSignatureImage(tenantId, settings.values.signature_file_id || null);

    return buildReceiptPdf({
      regime: spec,
      receiptNumber: receipt.receipt_number ?? String(receipt.id),
      kind: receipt.kind === 'cumulative' ? 'cumulative' : 'per_gift',
      issuedAt: new Date(receipt.issued_at),
      giftDate: receipt.gift_date ? torontoDateString(new Date(receipt.gift_date)) : null,
      items: items.map((i) => ({ gift_date: torontoDateString(new Date(i.gift_date)), amount_cents: i.amount_cents })),
      amountCents: receipt.amount_cents,
      advantageCents: receipt.advantage_cents,
      eligibleCents: receipt.eligible_cents,
      advantageDescription: receipt.advantage_description,
      donorName: receipt.donor_name,
      donorAddressLines: this.donorAddressLines(receipt),
      issuer,
      replacesReceiptNumber: replaces?.receipt_number ?? null,
      cancelled:
        receipt.status === 'cancelled' && receipt.cancelled_at
          ? { reason: receipt.cancelled_reason ?? '', at: new Date(receipt.cancelled_at) }
          : null,
      signatureImage,
      currency: await this.workspaceCurrency(tenantId),
    });
  }

  /**
   * Create one donor's year-end statement row + items (no PDF, no email — the batch handler
   * renders and delivers so the send-cap handling lives in one place). Returns null when the
   * donor has nothing to state or already has a live statement (idempotent rerun).
   */
  public async generateStatementForDonor(
    tenantId: string,
    personId: string,
    year: number,
    userId: string,
  ): Promise<ReceiptRow | null> {
    const settings = await this.loadSettings(tenantId);
    if (!settings.regime) return null; // the run mutation guards this; belt for direct calls

    const gifts = await this.getRepo().getSucceededDonationsForPersonYear(tenantId, personId, year);
    if (gifts.length === 0) return null;

    const { donor } = await this.resolveDonor(tenantId, personId, gifts[0]);
    if (!donor) return null;

    const orgRow = await this.settingsRepo.getByKey({ tenant_id: tenantId, key: 'organization.name' });
    const orgName = settings.values.org_legal_name || (typeof orgRow?.value === 'string' ? orgRow.value : '');

    try {
      return await this.getRepo()
        .transaction()
        .execute(async (trx) =>
          this.getRepo().insertReceiptWithItems(
            trx,
            {
              tenant_id: tenantId,
              kind: 'statement',
              regime: settings.regime as ReceiptRegimeId,
              year,
              serial: null,
              receipt_number: null,
              status: 'issued',
              person_id: personId,
              campaign_id: null,
              donor_name: donor.name,
              donor_email: donor.email,
              donor_address_line1: donor.line1,
              donor_address_line2: donor.line2,
              donor_city: donor.city,
              donor_province: donor.province,
              donor_postal_code: donor.postalCode,
              donor_country: donor.country,
              amount_cents: gifts.reduce((sum, d) => sum + d.amount, 0),
              advantage_cents: 0,
              eligible_cents: gifts.reduce((sum, d) => sum + d.amount, 0),
              advantage_description: null,
              gift_date: null,
              issuer_snapshot: JSON.stringify({
                org_legal_name: orgName,
                org_address: settings.values.org_address || undefined,
              }),
              replaces_receipt_id: null,
              createdby_id: userId,
              updatedby_id: userId,
            },
            gifts.map((d) => ({
              donation_id: d.id,
              amount_cents: d.amount,
              gift_date: torontoDateString(new Date(d.created_at)),
            })),
          ),
        );
    } catch (err) {
      // The one-live-statement-per-donor-year unique index makes racing/replayed generation a
      // no-op instead of a duplicate statement.
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /** A statement's gift rows with methods, for the statement PDF table. */
  public async getStatementGifts(
    tenantId: string,
    receiptId: string,
  ): Promise<{ gift_date: string; amount_cents: number; method: string }[]> {
    const rows = await this.getRepo()
      .db.selectFrom('donation_receipt_items as dri')
      .innerJoin('donations as d', 'd.id', 'dri.donation_id')
      .select(['dri.gift_date', 'dri.amount_cents', 'd.method'])
      .where('dri.tenant_id', '=', tenantId)
      .where('d.tenant_id', '=', tenantId)
      .where('dri.receipt_id', '=', receiptId)
      .orderBy('dri.gift_date', 'asc')
      .execute();
    return rows.map((r) => ({
      gift_date: torontoDateString(new Date(r.gift_date)),
      amount_cents: r.amount_cents,
      method: r.method,
    }));
  }

  // ── Year-end statement runs ─────────────────────────────────────────────────

  public async runYearEndStatements(
    auth: { tenant_id: string; user_id: string },
    year: number,
  ): Promise<{ runId: string }> {
    const tenantId = auth.tenant_id;
    const existing = await this.getRepo()
      .db.selectFrom('receipt_statement_runs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('year', '=', year)
      .where('status', '=', 'running')
      .executeTakeFirst();
    if (existing) {
      throw new ConflictError(`A ${year} statement run is already in progress.`);
    }

    const donorsTotal = await this.getRepo().countStatementDonors(tenantId, year);
    if (donorsTotal === 0) {
      throw new PreconditionFailedError(`No donors with successful gifts in ${year}.`);
    }

    const runId = await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const run = await trx
          .insertInto('receipt_statement_runs')
          .values({
            tenant_id: tenantId,
            year,
            status: 'running',
            donors_total: donorsTotal,
            requested_by: auth.user_id,
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('background_jobs')
          .values({
            tenant_id: tenantId,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'run-year-end-statements',
              tenant_id: tenantId,
              run_id: run.id,
              user_id: auth.user_id,
              year,
            }),
            run_at: new Date(),
            max_attempts: 3,
          })
          .execute();
        return String(run.id);
      });

    return { runId };
  }

  public async getStatementRun(tenantId: string, runId: string) {
    const run = await this.getRepo()
      .db.selectFrom('receipt_statement_runs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', runId)
      .executeTakeFirst();
    if (!run) throw new NotFoundError('Statement run not found');
    return run;
  }

  public async listStatementRuns(tenantId: string) {
    return this.getRepo()
      .db.selectFrom('receipt_statement_runs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
  }

  // ── Shared ──────────────────────────────────────────────────────────────────

  private async logActivity(
    dbOrTrx: Pick<Transaction<Models>, 'insertInto'>,
    tenantId: string,
    userId: string,
    personId: string,
    activity: string,
  ): Promise<void> {
    try {
      await dbOrTrx
        .insertInto('user_activity')
        .values({
          tenant_id: tenantId,
          user_id: userId,
          activity,
          entity: 'persons',
          entity_id: personId,
          quantity: 1,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    } catch (err) {
      logger.error({ err }, 'Failed to write receipt activity log');
    }
  }
}
