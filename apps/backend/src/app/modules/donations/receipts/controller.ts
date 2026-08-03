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
import { buildAcknowledgementPdf } from '../../../lib/pdf/acknowledgement-pdf';
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
};

/**
 * What the gift's own campaign contributes to a receipt.
 *
 * Two unrelated questions are answered from one row, which is why this is a single fetch:
 *
 * - `isElection` picks the issuance rule. Some regimes hand candidate receipting to the electoral
 *   authority (Ontario) and some require extra fields for candidates (British Columbia).
 * - `electoralDistrict` is the seat this campaign is contesting (`campaigns.seat_name`). It beats
 *   the workspace `receipts.electoral_district` setting, because that setting is ONE value for the
 *   whole workspace: a workspace running two campaigns in two seats can only store one of them, so
 *   for at least one of those campaigns the workspace value is simply wrong.
 */
interface ReceiptCampaignFacts {
  isElection: boolean;
  /** `campaigns.seat_name`, trimmed. Null when the seat is at large, unnamed, or there is no campaign. */
  electoralDistrict: string | null;
}

/** The answer for a gift with no campaign, and the default everywhere a campaign cannot apply. */
const NO_CAMPAIGN: ReceiptCampaignFacts = { isElection: false, electoralDistrict: null };

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

  /**
   * One issuer field's value at issue time: the gift's campaign if it can answer, else the
   * workspace setting.
   *
   * The electoral district is the only field a campaign answers, and the reasons the other nine
   * stay workspace-level are worth stating so nobody adds a tenth by analogy:
   *
   * - `polling_day` has no campaign column. A campaign's `enddate` is the end of the campaign, not
   *   a declared voting day, and a receipt that prints a guessed polling day is a compliance
   *   problem rather than a small inaccuracy.
   * - `place_of_issue` is where the issuing organization signs the receipt. `office_locality` is
   *   the municipality of the seat being contested — a different fact that happens to look similar.
   * - The remaining seven (legal name, address, registration number, signatory name and title,
   *   signature image, agent name) describe the organization that issues receipts. A campaign
   *   record holds none of them.
   */
  private resolvedIssuerValue(
    settings: ReceiptWorkspaceSettings,
    campaign: ReceiptCampaignFacts,
    field: ReceiptIssuerField,
  ): string {
    if (field === 'electoral_district' && campaign.electoralDistrict) return campaign.electoralDistrict;
    return settings.values[field] ?? '';
  }

  /**
   * Which regime fields are still missing (labels), for the settings banner and issue guards.
   *
   * This checks the RESOLVED value rather than the raw setting, so the guard and the printed
   * receipt can never disagree — a field the campaign answered is a field the receipt carries. It
   * changes nothing for the workspace settings banner: no regime lists `electoral_district` in
   * `requiredIssuerFields`. British Columbia asks for it in `candidateExtraFields` alone, and a
   * candidate gift always arrives with its campaign already loaded.
   */
  private missingFields(
    settings: ReceiptWorkspaceSettings,
    spec: ReceiptRegimeSpec,
    campaign: ReceiptCampaignFacts,
  ): string[] {
    const required = campaign.isElection
      ? [...spec.requiredIssuerFields, ...spec.candidateExtraFields]
      : spec.requiredIssuerFields;
    return required
      .filter((field) => !this.resolvedIssuerValue(settings, campaign, field))
      .map((field) => RECEIPT_ISSUER_FIELD_LABELS[field]);
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

  /**
   * Whether this workspace is set up to issue official TAX receipts, and what is missing if not.
   *
   * None of this affects acknowledgements. Every gift is acknowledged the moment it is recorded,
   * in every workspace, whatever this reports — the two documents are independent, and a workspace
   * that never opens this settings page still thanks its donors.
   */
  public async getReceiptSettingsStatus(tenantId: string): Promise<{
    regime: ReceiptRegimeId | null;
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
        complete: false,
        missing: ['receipting regime'],
        advisory: [],
        advisoryMessage: null,
        externalIssuance: false,
        message:
          'No receipting regime is chosen, so this workspace issues no official tax receipts. ' +
          'Every gift is still acknowledged by email, and donors receive a year-end giving summary.',
      };
    }
    const spec = RECEIPT_REGIMES[settings.regime];
    if (spec.issuance === 'external') {
      return {
        regime: settings.regime,
        complete: false,
        missing: [],
        advisory: [],
        advisoryMessage: null,
        externalIssuance: true,
        message: spec.externalExplanation ?? null,
      };
    }
    // Workspace-level status: no gift, so no campaign. NO_CAMPAIGN also means the candidate-only
    // extras are not reported here — they are checked per gift, against that gift's campaign.
    const missing = this.missingFields(settings, spec, NO_CAMPAIGN);
    const advisory = this.advisoryMissingFields(settings, spec);
    return {
      regime: settings.regime,
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
    campaign: ReceiptCampaignFacts,
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
    if (campaign.isElection && spec.candidateIssuance === 'external') {
      throw new PreconditionFailedError(
        spec.candidateExternalExplanation ??
          'Candidate-campaign contributions are receipted by the electoral authority.',
      );
    }
    const missing = this.missingFields(settings, spec, campaign);
    if (missing.length > 0) {
      throw new PreconditionFailedError(
        `Finish receipt setup in Workspace settings → Donations. Missing: ${missing.join(', ')}.`,
      );
    }
    return { settings, spec };
  }

  /**
   * The issuer details frozen onto the receipt row (and printed), taken at issue time.
   *
   * Every value comes from the workspace `receipts.*` settings except the electoral district, which
   * the gift's campaign answers first — see {@link resolvedIssuerValue} for why that one field and
   * no other.
   *
   * Receipts already issued are untouched by any of this. The values are frozen into
   * `issuer_snapshot` here and re-read from the row when the PDF renders, so changing what the
   * resolution reads changes future receipts only. Nothing backfills or rewrites a stored snapshot.
   */
  private issuerSnapshot(
    settings: ReceiptWorkspaceSettings,
    campaign: ReceiptCampaignFacts = NO_CAMPAIGN,
  ): ReceiptIssuerSnapshot {
    const value = (field: ReceiptIssuerField): string | undefined =>
      this.resolvedIssuerValue(settings, campaign, field) || undefined;
    return {
      org_legal_name: value('org_legal_name'),
      org_address: value('org_address'),
      registration_number: value('registration_number'),
      place_of_issue: value('place_of_issue'),
      signatory_name: value('signatory_name'),
      signatory_title: value('signatory_title'),
      agent_name: value('agent_name'),
      electoral_district: value('electoral_district'),
      polling_day: value('polling_day'),
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

  /**
   * Load the gift's campaign once, for both the issuance rule and the electoral district.
   *
   * One query on purpose: the candidate-issuance check already had to read this row, so reading the
   * seat costs nothing extra. A gift with no campaign, or a campaign row that has since been
   * deleted, falls back to the workspace settings via {@link NO_CAMPAIGN}.
   */
  private async loadCampaignFacts(tenantId: string, campaignId: string | null): Promise<ReceiptCampaignFacts> {
    if (!campaignId) return NO_CAMPAIGN;
    const campaign = await this.donationsRepo.db
      .selectFrom('campaigns')
      .select(['kind', 'seat_name'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', campaignId)
      .executeTakeFirst();
    if (!campaign) return NO_CAMPAIGN;
    const seat = campaign.seat_name?.trim();
    return { isElection: campaign.kind === 'election', electoralDistrict: seat ? seat : null };
  }

  /**
   * Issue one official per-gift TAX receipt for a single gift, on request.
   *
   * Nothing calls this automatically. Official receipting is a year-end activity
   * ({@link generateYearEndDocumentForDonor}); this exists for the donor who asks for their receipt
   * in March, and it is reached only from the button on the gift detail page.
   */
  public async issueReceipt(
    auth: { tenant_id: string; user_id: string },
    donationId: string,
    opts: { advantageCents?: number; advantageDescription?: string },
  ): Promise<ReceiptRow> {
    return this.issueOfficialForDonation(auth.tenant_id, auth.user_id, donationId, opts);
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

    const campaign = await this.loadCampaignFacts(tenantId, donation.campaign_id);
    const { settings } = await this.assertIssuable(tenantId, campaign);

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
          issuerSnapshot: this.issuerSnapshot(settings, campaign),
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

  // ── Acknowledgement (every gift, no configuration) ──────────────────────────

  /**
   * The plain acknowledgement, issued the moment a gift is recorded.
   *
   * This is the one document with NO preconditions beyond a successful gift and a donor to address
   * it to. It asserts no tax treatment, so it needs no regime, no registration number, no
   * authorized signatory and — unlike every tax receipt — no mailing address. That is deliberate:
   * a donor who gives and hears nothing back assumes the payment failed, and the workspaces most
   * likely to be unconfigured (a municipal campaign, any United States workspace) are exactly the
   * ones that can never satisfy a tax regime.
   *
   * Returns null instead of throwing when the gift cannot be acknowledged at all, because the caller
   * is a background job and none of these conditions is fixed by a retry.
   */
  public async issueAcknowledgement(
    tenantId: string,
    donationId: string,
    userId: string,
    /**
     * `email: false` stores the PDF and sends nothing. Used by the backfill over gifts recorded
     * before acknowledgements existed: mailing a donor a receipt for a gift from four months ago
     * is worse than the gap it fills.
     */
    opts: { email?: boolean } = {},
  ): Promise<{ receipt: ReceiptRow | null; skipped?: string }> {
    const donation = await this.donationsRepo.db
      .selectFrom('donations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', donationId)
      .executeTakeFirst();
    if (!donation) return { receipt: null, skipped: 'Donation not found' };
    if (donation.status !== 'succeeded') return { receipt: null, skipped: `Gift is ${donation.status}` };
    if (!donation.person_id) return { receipt: null, skipped: 'Gift has no donor on file' };

    const existing = await this.getRepo().getLiveAcknowledgementForDonation(tenantId, donationId);
    if (existing) return { receipt: existing };

    const { donor } = await this.resolveDonor(tenantId, donation.person_id, donation);
    if (!donor) return { receipt: null, skipped: 'Gift has no donor name on file' };

    const settings = await this.loadSettings(tenantId);
    const orgName = await this.resolveOrgName(tenantId, settings);
    const now = new Date();
    const year = torontoYear(now);
    const giftDate = torontoDateString(new Date(donation.created_at));
    const personId = String(donation.person_id);

    const receipt = await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // Own counter sequence: acknowledging a gift must never advance the official tax-receipt
        // serials, which are audited for gaps. The counter row lock also serializes racing
        // acknowledgements for one gift, which is why the coverage re-check sits after it.
        const serial = await this.getRepo().nextSerial(trx, tenantId, year, 'acknowledgement');
        const raced = await this.getRepo().getLiveAcknowledgementForDonation(tenantId, donationId, trx);
        if (raced) return raced;

        const row = await this.getRepo().insertReceiptWithItems(
          trx,
          {
            tenant_id: tenantId,
            kind: 'acknowledgement',
            regime: null,
            year,
            serial,
            receipt_number: `A-${year}-${String(serial).padStart(SERIAL_PAD, '0')}`,
            status: 'issued',
            person_id: personId,
            campaign_id: donation.campaign_id,
            donor_name: donor.name,
            donor_email: donor.email,
            donor_address_line1: donor.line1,
            donor_address_line2: donor.line2,
            donor_city: donor.city,
            donor_province: donor.province,
            donor_postal_code: donor.postalCode,
            donor_country: donor.country,
            amount_cents: donation.amount,
            advantage_cents: 0,
            eligible_cents: donation.amount,
            advantage_description: null,
            gift_date: giftDate,
            // Only the two fields an acknowledgement prints. No registration number, no signatory:
            // printing them would dress a non-tax document up as a tax document.
            issuer_snapshot: JSON.stringify({
              org_legal_name: orgName,
              org_address: settings.values.org_address || undefined,
            }),
            replaces_receipt_id: null,
            createdby_id: userId,
            updatedby_id: userId,
          },
          [{ donation_id: donationId, amount_cents: donation.amount, gift_date: giftDate }],
        );

        await this.enqueueRenderJob(trx, tenantId, row.id, userId, opts.email ?? true);
        return row;
      });

    return { receipt };
  }

  /**
   * The organization name an acknowledgement or statement prints: the receipting legal name when the
   * workspace has set one, otherwise the plain organization name every workspace has from signup.
   * The fallback is what lets an unconfigured workspace produce a usable document on day one.
   */
  private async resolveOrgName(tenantId: string, settings: ReceiptWorkspaceSettings): Promise<string> {
    if (settings.values.org_legal_name) return settings.values.org_legal_name;
    const row = await this.settingsRepo.getByKey({ tenant_id: tenantId, key: 'organization.name' });
    return typeof row?.value === 'string' ? row.value : '';
  }

  // ── Cumulative tax receipt ──────────────────────────────────────────────────

  /** One official receipt covering a donor's un-receipted gifts in a year. */
  public async issueCumulativeReceipt(
    auth: { tenant_id: string; user_id: string },
    personId: string,
    year: number,
    opts: { advantageCents?: number; advantageDescription?: string },
  ): Promise<ReceiptRow> {
    const tenantId = auth.tenant_id;
    // A cumulative receipt covers a donor's gifts across every campaign in the year, so no single
    // campaign can answer for it. The workspace setting is the only correct source here.
    const { settings } = await this.assertIssuable(tenantId, NO_CAMPAIGN);
    return this.insertCumulativeReceipt(tenantId, auth.user_id, personId, year, settings, opts);
  }

  /**
   * The cumulative-receipt write, with the workspace-level checks already done by the caller.
   *
   * Split out for the year-end batch: `assertIssuable` reads every workspace setting, and running it
   * once per donor would repeat that read for every donor in the workspace. The batch evaluates it
   * once per execution and calls this directly.
   */
  private async insertCumulativeReceipt(
    tenantId: string,
    userId: string,
    personId: string,
    year: number,
    settings: ReceiptWorkspaceSettings,
    opts: { advantageCents?: number; advantageDescription?: string },
  ): Promise<ReceiptRow> {
    const auth = { tenant_id: tenantId, user_id: userId };
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
          // No campaign argument: this receipt spans campaigns (see assertIssuable above).
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

    await this.enqueueRenderJob(trx, input.tenantId, receipt.id, input.userId, true);
    return receipt;
  }

  /**
   * Transactional outbox: the PDF render and the donor email happen in the worker, and the job
   * exists only if the issuance it belongs to commits. Shared by acknowledgements and tax receipts.
   */
  private async enqueueRenderJob(
    trx: Transaction<Models>,
    tenantId: string,
    receiptId: string,
    userId: string,
    email: boolean,
  ): Promise<void> {
    await trx
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'render-receipt-pdf',
          tenant_id: tenantId,
          receipt_id: receiptId,
          email,
          user_id: userId,
        }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();
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
    if (predecessor.kind === 'acknowledgement') {
      // Cancel-and-replace exists because a tax authority requires cancelled serials to be retained
      // and a successor to reference them. An acknowledgement is under no such rule, and a corrected
      // one is simply a fresh acknowledgement.
      throw new BadRequestError('Acknowledgements are not reissued. Issue a tax receipt for this gift instead.');
    }
    if (predecessor.status === 'issued' && !reason?.trim()) {
      throw new BadRequestError('Give a short reason — it is recorded on the cancelled receipt.');
    }

    const campaign = await this.loadCampaignFacts(tenantId, predecessor.campaign_id);
    const { settings } = await this.assertIssuable(tenantId, campaign);
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
          // A reissue re-freezes today's values, the campaign's seat included — the predecessor's
          // own snapshot is left exactly as it was issued.
          issuerSnapshot: this.issuerSnapshot(settings, campaign),
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
   * A gift was refunded or charged back: no document covering it may stand. Acknowledgements and
   * per-gift receipts cancel outright; cumulative receipts cancel AND flag reissue_required (an
   * immutable receipt cannot shrink — a human confirms the corrected total via reissue); statements
   * cancel and come back on the next batch rerun.
   *
   * The acknowledgement is included on purpose. It says a gift was received, which stops being true
   * the moment the money goes back, and it is the one document the donor is guaranteed to hold.
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
        receipt.kind === 'per_gift' || receipt.kind === 'acknowledgement'
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
      // A specimen has no gift and therefore no campaign: it previews the workspace settings alone.
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

  /** Everything the render job needs to draw an acknowledgement from a stored row. */
  public async buildPdfForAcknowledgement(tenantId: string, receipt: ReceiptRow): Promise<Buffer> {
    const issuer = (
      receipt.issuer_snapshot && typeof receipt.issuer_snapshot === 'object' ? receipt.issuer_snapshot : {}
    ) as ReceiptIssuerSnapshot;
    const items = await this.getRepo().getItems(tenantId, receipt.id);
    const method = await this.donationsRepo.db
      .selectFrom('donations as d')
      .innerJoin('donation_receipt_items as dri', 'dri.donation_id', 'd.id')
      .select('d.method')
      .where('d.tenant_id', '=', tenantId)
      .where('dri.tenant_id', '=', tenantId)
      .where('dri.receipt_id', '=', receipt.id)
      .executeTakeFirst();

    const giftDate = receipt.gift_date ?? items[0]?.gift_date ?? receipt.issued_at;
    const settings = await this.loadSettings(tenantId);

    return buildAcknowledgementPdf({
      number: receipt.receipt_number ?? String(receipt.id),
      orgName: issuer.org_legal_name ?? '',
      orgAddress: issuer.org_address,
      donorName: receipt.donor_name,
      donorAddressLines: this.donorAddressLines(receipt),
      giftDate: torontoDateString(new Date(giftDate)),
      issuedAt: new Date(receipt.issued_at),
      amountCents: receipt.amount_cents,
      method: method?.method ?? 'card',
      currency: await this.workspaceCurrency(tenantId),
      // Read live rather than frozen: a workspace that configures receipting in March should stop
      // promising tax receipts on gifts it will never receipt, and start promising on ones it will.
      taxReceiptExpected: Boolean(settings.regime && RECEIPT_REGIMES[settings.regime].issuance === 'internal'),
      cancelled:
        receipt.status === 'cancelled' && receipt.cancelled_at
          ? { reason: receipt.cancelled_reason ?? '', at: new Date(receipt.cancelled_at) }
          : null,
    });
  }

  /**
   * Everything the render job needs to draw an official TAX receipt from a stored row.
   *
   * Only for `per_gift` and `cumulative` rows. Acknowledgements go to buildAcknowledgementPdf and
   * statements to buildStatementPdf; neither has a regime, and this layout is regime-driven
   * throughout.
   */
  public async buildPdfForReceipt(tenantId: string, receipt: ReceiptRow): Promise<Buffer> {
    const spec = receipt.regime ? RECEIPT_REGIMES[receipt.regime as ReceiptRegimeId] : undefined;
    if (!spec) {
      throw new BadRequestError(`Receipt ${receipt.id} has no receipting regime and cannot be drawn as a tax receipt.`);
    }
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
   * Whether this workspace can issue official cumulative TAX receipts at all, evaluated once per
   * year-end batch execution rather than once per donor.
   *
   * Returns the settings when it can, null when it cannot — no regime chosen, the regime hands
   * issuance to the electoral authority, or a required issuer field is blank. Null is not a failure:
   * the batch then sends every donor a giving summary instead, which is the correct document for a
   * workspace that does not issue tax receipts.
   */
  public async cumulativeIssuanceSettings(tenantId: string): Promise<ReceiptWorkspaceSettings | null> {
    try {
      // NO_CAMPAIGN because a cumulative receipt spans every campaign the donor gave to; see
      // issueCumulativeReceipt for why no single campaign can answer for it.
      const { settings } = await this.assertIssuable(tenantId, NO_CAMPAIGN);
      return settings;
    } catch (err) {
      if (err instanceof PreconditionFailedError) return null;
      throw err;
    }
  }

  /**
   * One donor's year-end document: an official cumulative tax receipt when this workspace and this
   * donor both qualify, otherwise an unnumbered giving summary.
   *
   * The choice is per donor, not per workspace. A charity with its receipting fully configured still
   * has donors with no mailing address on file, and a tax receipt cannot be issued to them — they
   * get the summary rather than nothing.
   *
   * No PDF and no email here; the batch handler renders and delivers, so send-cap handling lives in
   * one place. Returns null when the donor has nothing to send.
   */
  public async generateYearEndDocumentForDonor(
    tenantId: string,
    personId: string,
    year: number,
    userId: string,
    issuanceSettings: ReceiptWorkspaceSettings | null,
  ): Promise<ReceiptRow | null> {
    if (issuanceSettings) {
      try {
        return await this.insertCumulativeReceipt(tenantId, userId, personId, year, issuanceSettings, {});
      } catch (err) {
        // Nothing left to receipt, or this donor cannot be receipted (no address, advantage larger
        // than the surviving gifts). Fall through to the summary — never leave the donor with
        // nothing because one of them failed a tax-document rule.
        if (!(err instanceof PreconditionFailedError || err instanceof ConflictError)) throw err;
        logger.info({ tenantId, personId, year, reason: err.message }, 'Year-end: summary instead of a tax receipt');
      }
    }
    return this.generateStatementForDonor(tenantId, personId, year, userId);
  }

  /**
   * Create one donor's year-end statement row + items. Returns null when the donor has nothing to
   * state or already has a live statement (idempotent rerun).
   *
   * A workspace with no receipting regime reaches here for every donor, and the statement row then
   * carries a null regime — the summary asserts no tax treatment, so there is nothing to stamp.
   */
  public async generateStatementForDonor(
    tenantId: string,
    personId: string,
    year: number,
    userId: string,
  ): Promise<ReceiptRow | null> {
    const settings = await this.loadSettings(tenantId);

    const gifts = await this.getRepo().getSucceededDonationsForPersonYear(tenantId, personId, year);
    if (gifts.length === 0) return null;

    const { donor } = await this.resolveDonor(tenantId, personId, gifts[0]);
    if (!donor) return null;

    const orgName = await this.resolveOrgName(tenantId, settings);

    try {
      return await this.getRepo()
        .transaction()
        .execute(async (trx) =>
          this.getRepo().insertReceiptWithItems(
            trx,
            {
              tenant_id: tenantId,
              kind: 'statement',
              regime: settings.regime,
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
