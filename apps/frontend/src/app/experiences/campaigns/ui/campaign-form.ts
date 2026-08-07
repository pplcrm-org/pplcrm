import { Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { form, FormField, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterModule } from '@angular/router';
import { z } from 'zod';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { Icon } from '@icons/icon';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { Select as PcSelect } from '@uxcommon/components/select/select';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { createLoadingGate } from '@uxcommon/loading-gate';
import {
  AddCampaignObj,
  AddCampaignType,
  CHAMBERS,
  CHAMBER_LABELS,
  JURISDICTIONS,
  JURISDICTION_IDS,
  ORG_MODE_IS_ELECTORAL,
  SEAT_AREAS_MAX,
  SEAT_TYPES,
  UpdateCampaignType,
  US_AT_LARGE_CONGRESSIONAL_STATES,
  isJurisdictionId,
  regionsForCountry,
  seatLabelFor,
  seatLabelPluralFor,
} from '../../../../../../../libs/common/src';
import type { JurisdictionId, SeatAreaSuggestionType } from '../../../../../../../libs/common/src';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { OrgModeService } from '../../../services/org-mode.service';
import { CampaignDetail, CampaignsService } from '../services/campaigns-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

/**
 * The office fields whose blank value means "not answered", plus the two dates.
 *
 * Every one of these is `nullable().optional()` in `AddCampaignObj`, and a text input or a select
 * placeholder produces an empty string rather than null when nobody has answered. Two of them
 * reject an empty string outright: `chamber` is an enum, and the dates are regex-checked. Left
 * unconverted, an unanswered chamber or a campaign with no dates makes the whole form invalid with
 * no visible field to fix, which is the silent dead end the design principles forbid.
 */
const BLANK_MEANS_UNANSWERED = [
  'startdate',
  'enddate',
  'office_region',
  'office_locality',
  'chamber',
  'seat_name',
  'seat_position',
  'seat_label_override',
  'office_title',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Empty and whitespace-only answers become null before the shared schema sees them. */
function blanksToNull(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const normalized: Record<string, unknown> = { ...raw };
  for (const key of BLANK_MEANS_UNANSWERED) {
    const value = normalized[key];
    if (typeof value === 'string' && value.trim().length === 0) normalized[key] = null;
  }
  return normalized;
}

/**
 * The shared campaign schema, reading the form's own empty strings as unanswered.
 *
 * `AddCampaignObj` is the single source of truth for what a campaign may contain, including every
 * cross-field office rule and its plain-language messages. This wrapper changes nothing about those
 * rules; it only translates the form's representation of "blank" into the schema's. Issue paths
 * pass through a Zod preprocess untouched, so each message still lands on the field it names.
 */
const CampaignFormSchema = z.preprocess(blanksToNull, AddCampaignObj);

/**
 * Where one area can elect more than one person, so a seat position is worth asking about.
 *
 * There is no flag for this on `JurisdictionSpec`, and adding one would overstate what the registry
 * knows: whether a district is multi-member is a per-state and often per-chamber fact, not a
 * property of the level of government. This list is the honest middle ground, naming the levels
 * where multi-member seats are common enough that the question earns its place on the form:
 *
 * - `us_state`: the Arizona House and the New Jersey General Assembly elect two members per
 *   district, Washington numbers positions within each legislative district, and several New
 *   England states use multi-member districts.
 * - `us_local` and `ca_municipal`: at-large council seats are frequently numbered ("Seat B").
 * - `other`: unmodelled bodies vary too much to rule it out.
 *
 * Canadian federal and provincial seats are always single-member, and every US congressional
 * district elects one representative, so the field would be noise there.
 */
const MULTI_MEMBER_JURISDICTIONS: readonly JurisdictionId[] = ['us_state', 'us_local', 'ca_municipal', 'other'];

/**
 * How many area names to show at once before typing narrows them.
 *
 * A published US state house map holds 4,874 areas. Rendering all of them is not a chooser, it is a
 * wall, so the list shows a workable number and the search box does the rest.
 */
const AREA_SUGGESTION_LIMIT = 8;

/**
 * Campaigns §15 — create/edit. New campaigns are always elections: the office
 * context is permanent and created at signup, so there is never a second one.
 * Kind is immutable after creation; status changes only via archive/unarchive.
 *
 * The office card above the name/date card asks what seat the campaign is contesting, one question
 * at a time: each answer decides whether the next question is meaningful at all. A Canadian federal
 * campaign is never shown a chamber selector, a US Senate campaign is never asked to name a
 * district it does not have, and a workspace that does not run elections is not shown the card.
 */
@Component({
  selector: 'pc-campaign-form',
  imports: [FormField, RouterModule, Icon, PcDetailHeader, PcInput, PcSelect, PcTextarea, PcCard],
  templateUrl: './campaign-form.html',
})
export class CampaignFormComponent implements OnInit {
  readonly id = input<string>();

  private readonly alerts = inject(AlertService);
  private readonly router = inject(Router);
  private readonly campaignsSvc = inject(CampaignsService);
  private readonly context = inject(CampaignContextService);
  private readonly orgMode = inject(OrgModeService);

  protected readonly isNew = computed(() => !this.id());
  protected readonly detail = signal<CampaignDetail | null>(null);
  /** getById is loosely typed at the crud-router boundary; read the name defensively. */
  protected readonly detailName = computed(() => {
    const name = (this.detail() as Record<string, unknown> | null)?.['name'];
    return typeof name === 'string' ? name : '';
  });
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  /**
   * The permanent office context is edited through this same form, and it is not an election
   * campaign — its subtitle and its end-date label must not say it is. New records are always
   * elections, so only a loaded record can be the office. The detail view branches the same way.
   */
  protected readonly isOfficeContext = computed<boolean>(
    () => (this.detail() as Record<string, unknown> | null)?.['kind'] === 'office',
  );

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    // Full trail from the root down, matching /workspace/campaigns/:id/edit segment for segment.
    const workspace: PcBreadcrumb = { label: 'Workspace', route: '/workspace' };
    const campaigns: PcBreadcrumb = { label: 'Campaigns', route: '/workspace/campaigns' };
    const id = this.id();
    if (id) {
      return [
        workspace,
        campaigns,
        { label: this.detailName() || 'Campaign', route: ['/workspace/campaigns', id] },
        { label: 'Edit' },
      ];
    }
    return [workspace, campaigns, { label: 'New campaign' }];
  });

  protected readonly payload = signal({
    name: '',
    description: '',
    notes: '',
    kind: 'election' as const,
    startdate: '',
    enddate: '',
    jurisdiction: 'other' as JurisdictionId,
    office_region: '',
    office_locality: '',
    chamber: '',
    seat_type: 'district',
    seat_name: '',
    seat_position: '',
    seat_label_override: '',
    office_title: '',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, () => CampaignFormSchema);
  });

  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  /** Every jurisdiction the picker offers, each with the one sentence that explains it. */
  protected readonly jurisdictionOptions = JURISDICTION_IDS.map((id) => JURISDICTIONS[id]);
  protected readonly seatTypeOptions = SEAT_TYPES;
  protected readonly chamberOptions = CHAMBERS;
  protected readonly chamberLabels = CHAMBER_LABELS;

  /** A church, charity or advocacy workspace contests no seat, so it is never asked about one. */
  protected readonly isElectoral = computed<boolean>(() => ORG_MODE_IS_ELECTORAL[this.orgMode.mode()]);

  protected readonly jurisdiction = computed<JurisdictionId>(() => this.payload().jurisdiction);
  protected readonly spec = computed(() => JURISDICTIONS[this.jurisdiction()]);
  protected readonly region = computed(() => this.payload().office_region || null);
  protected readonly isAtLarge = computed(() => this.payload().seat_type === 'at_large');

  /** The list this jurisdiction's region picker offers: provinces, states, or nothing. */
  protected readonly regionOptions = computed(() => regionsForCountry(this.spec().country));
  /** 'province or territory' or 'state', so every message names what the picker actually holds. */
  protected readonly regionTerm = computed(() => (this.spec().country === 'CA' ? 'province or territory' : 'state'));

  /** The jurisdiction's own word for a seat area, following the override as it is typed. */
  protected readonly seatWord = computed(() =>
    seatLabelFor(this.jurisdiction(), this.region(), this.payload().seat_label_override || null),
  );
  protected readonly seatWordLower = computed(() => this.seatWord().toLowerCase());

  /** Which further questions this jurisdiction makes meaningful. */
  protected readonly showRegion = computed(() => this.spec().requiresRegion && this.regionOptions().length > 0);
  protected readonly showLocality = computed(() => this.spec().requiresLocality);
  /** Only a district seat sits in a chamber; a statewide office (governor) is asked no chamber. */
  protected readonly showChamber = computed(() => this.spec().usesChamber && !this.isAtLarge());
  protected readonly showSeatType = computed(() => this.spec().supportsAtLarge);
  protected readonly showSeatName = computed(() => !this.isAtLarge());

  // ── The areas this campaign represents ────────────────────────────────────────────────────────
  //
  // Separate from the seat's name on purpose, and the two are different answers for a municipal
  // candidate: someone running in Ward 12 is still a City of Toronto candidate, so the receipt says
  // the city and the areas say the ward. Several areas because one seat can be elected by several —
  // a regional councillor by two wards — and a door in any of them is in their territory.

  /** The areas chosen so far. `set_id` records the map a name came from, null when it was typed. */
  protected readonly seatAreas = signal<{ name: string; set_id: string | null }[]>([]);
  /** Names offered by whichever map covers this office. Empty is ordinary: most wards have no map. */
  protected readonly areaSuggestions = signal<SeatAreaSuggestionType[]>([]);
  protected readonly loadingAreaSuggestions = signal(false);

  /** What has been typed into the add-an-area box, wrapped so pc-input can bind to it. */
  protected readonly areaDraft = signal({ name: '' });
  protected readonly areaDraftForm = form(this.areaDraft, () => {
    // No rules: any text is a valid area name. The list this feeds is validated when the form saves.
  });

  /** Areas already chosen, lower-cased, so a suggestion cannot be offered or added twice. */
  private readonly chosenAreaKeys = computed(() => new Set(this.seatAreas().map((a) => a.name.toLowerCase())));

  /**
   * Suggestions still worth showing: not already chosen, and matching what has been typed.
   *
   * Capped because a US state house map holds 4,874 areas and a list that long is not a chooser.
   * Typing narrows it; the cap only decides how many are shown before you do.
   */
  protected readonly visibleAreaSuggestions = computed<SeatAreaSuggestionType[]>(() => {
    const typed = this.areaDraft().name.trim().toLowerCase();
    const chosen = this.chosenAreaKeys();
    return this.areaSuggestions()
      .filter((s) => !chosen.has(s.name.toLowerCase()) && (typed === '' || s.name.toLowerCase().includes(typed)))
      .slice(0, AREA_SUGGESTION_LIMIT);
  });

  /** True when what has been typed is not among the suggestions, so "add it anyway" is the answer. */
  protected readonly canAddTypedArea = computed<boolean>(() => {
    const typed = this.areaDraft().name.trim();
    if (typed === '') return false;
    return !this.chosenAreaKeys().has(typed.toLowerCase());
  });

  protected readonly atAreaLimit = computed(() => this.seatAreas().length >= SEAT_AREAS_MAX);

  /** The word for one area at this level of government, pluralised once several are chosen. */
  protected readonly areaSectionLabel = computed(() => {
    const word = seatLabelPluralFor(this.jurisdiction(), this.region(), this.payload().seat_label_override || null);
    return `Which ${word.toLowerCase()} does this campaign represent?`;
  });
  protected readonly showSeatPosition = computed(() => MULTI_MEMBER_JURISDICTIONS.includes(this.jurisdiction()));
  protected readonly officeTitles = computed(() => this.spec().officeTitles);
  /**
   * Example shown in the empty office-title input: the jurisdiction's own first title, so a US
   * local race is not shown "MP". Every registry entry lists at least one title today; 'Candidate'
   * is the neutral word if one ever lists none.
   */
  protected readonly officeTitlePlaceholder = computed(() => this.officeTitles()[0] ?? 'Candidate');

  /** The area an at-large seat actually covers, stated back so "at large" is never abstract. */
  protected readonly atLargeArea = computed(() => {
    const locality = this.payload().office_locality.trim();
    if (locality) return locality;
    const code = this.region();
    const named = code ? this.regionOptions().find((r) => r.code === code)?.name : undefined;
    return named ?? 'the whole area';
  });

  /**
   * True for the six states that elect their single member of the House of Representatives
   * statewide. Saying so where the choice is made saves an Alaska or Wyoming campaign from hunting
   * for a district number that does not exist.
   */
  protected readonly isSingleDistrictState = computed(() => {
    const code = this.region();
    return (
      this.jurisdiction() === 'us_federal' &&
      code != null &&
      (US_AT_LARGE_CONGRESSIONAL_STATES as readonly string[]).includes(code)
    );
  });

  constructor() {
    // Changing the level of government invalidates the answers that only made sense at the old one.
    // Left in place they would fail validation on a field that is no longer rendered, which reads to
    // the user as a Save button that does nothing.
    effect(() => {
      const jurisdiction = this.jurisdiction();
      const atLarge = this.isAtLarge();
      untracked(() => this.dropAnswersThatNoLongerApply(jurisdiction, atLarge));
    });

    // Which map covers this office depends on the jurisdiction, the region and the chamber, so the
    // suggestions are re-read whenever one of those three changes. Reading the signals here is what
    // subscribes to them; the request itself is untracked so its own signal writes do not re-run it.
    effect(() => {
      const raw = this.payload();
      const key = [raw.jurisdiction, raw.office_region.trim(), raw.chamber, raw.seat_type].join('|');
      void key;
      untracked(() => void this.loadAreaSuggestions());
    });
  }

  public ngOnInit(): void {
    void this.loadCampaign();
  }

  public canDeactivate(): Promise<boolean> {
    // stayPut: the router is already navigating away, so the guard-time save must not navigate.
    return this.unsavedChanges.confirmDiscardIfDirty(this.detailName() || 'this campaign', () =>
      this.save(undefined, true),
    );
  }

  /** Fills the office title from the jurisdiction's own list; the field stays free text. */
  protected useOfficeTitle(title: string): void {
    this.payload.update((p) => ({ ...p, office_title: title }));
  }

  protected async save(done?: (() => void) | Event, stayPut = false): Promise<boolean> {
    if (done instanceof Event) done.preventDefault();

    this.form().markAsTouched();
    if (this.form().invalid()) return false;

    const raw = this.payload();
    this.saving.set(true);
    this.error.set(null);

    try {
      if (this.isNew()) {
        const payload: AddCampaignType = {
          name: raw.name.trim(),
          description: raw.description.trim() || null,
          notes: raw.notes.trim() || null,
          kind: 'election',
          startdate: raw.startdate || null,
          enddate: raw.enddate || null,
          ...this.officeFields(),
        };
        const result: CampaignDetail = await this.campaignsSvc.add(payload);
        this.campaignsSvc.triggerRefresh();
        await this.context.refresh();
        this.detail.set(result);
        this.form().reset();
        this.alerts.showSuccess('Campaign created');
        if (typeof done === 'function') done();
        else if (!stayPut) await this.router.navigate(['/workspace/campaigns']);
      } else {
        const payload: UpdateCampaignType = {
          name: raw.name.trim() || undefined,
          description: raw.description.trim() || null,
          notes: raw.notes.trim() || null,
          startdate: raw.startdate || null,
          enddate: raw.enddate || null,
          // A workspace that runs no elections never sees the office card, so it has no answers to
          // send. Sending the form's defaults instead would overwrite what is already stored.
          ...(this.isElectoral() ? this.officeFields() : {}),
        };
        const result = await this.campaignsSvc.update(this.id()!, payload);
        this.campaignsSvc.triggerRefresh();
        await this.context.refresh();
        this.detail.set(result);
        this.setForm(result);
        this.form().reset();
        this.alerts.showSuccess('Campaign updated');
        if (typeof done === 'function') done();
        else if (!stayPut) await this.router.navigate(['/workspace/campaigns', this.id()]);
      }
      return true;
    } catch (err) {
      const message = getUserErrorMessage(err, 'Unable to save the campaign');
      this.error.set(message);
      this.alerts.showError(message);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * The nine office fields as the API takes them.
   *
   * A new campaign always sends them: in a workspace that runs no elections the untouched values
   * are `other` and `district`, which is exactly what the database would default to anyway.
   */
  /** Add an area, either chosen from a map (with its set) or typed by hand (without one). */
  protected addArea(name: string, setId: string | null): void {
    const trimmed = name.trim();
    if (trimmed === '' || this.atAreaLimit()) return;
    if (this.chosenAreaKeys().has(trimmed.toLowerCase())) return;
    this.seatAreas.update((areas) => [...areas, { name: trimmed, set_id: setId }]);
    this.areaDraft.set({ name: '' });
  }

  /** Add exactly what was typed, for an area no map offers — the ordinary case for a ward. */
  protected addTypedArea(): void {
    this.addArea(this.areaDraft().name, null);
  }

  protected removeArea(name: string): void {
    const key = name.toLowerCase();
    this.seatAreas.update((areas) => areas.filter((area) => area.name.toLowerCase() !== key));
  }

  /**
   * Load the names this office's map offers, whenever the office changes.
   *
   * Failure is deliberately quiet: suggestions are a convenience, and a campaign is still perfectly
   * describable by typing the area name. Showing an error for a failed convenience would suggest
   * the form is broken when it is not.
   */
  protected async loadAreaSuggestions(): Promise<void> {
    if (!this.isElectoral() || this.isAtLarge()) {
      this.areaSuggestions.set([]);
      return;
    }
    this.loadingAreaSuggestions.set(true);
    try {
      const raw = this.payload();
      this.areaSuggestions.set(
        await this.campaignsSvc.getAreaSuggestions({
          jurisdiction: raw.jurisdiction,
          office_region: raw.office_region.trim() || null,
          chamber: raw.chamber === 'upper' || raw.chamber === 'lower' ? raw.chamber : null,
        }),
      );
    } catch {
      this.areaSuggestions.set([]);
    } finally {
      this.loadingAreaSuggestions.set(false);
    }
  }

  private officeFields(): Pick<
    AddCampaignType,
    | 'jurisdiction'
    | 'office_region'
    | 'office_locality'
    | 'chamber'
    | 'seat_type'
    | 'seat_name'
    | 'seat_position'
    | 'seat_label_override'
    | 'office_title'
    | 'seat_areas'
  > {
    const raw = this.payload();
    const atLarge = raw.seat_type === 'at_large';
    return {
      jurisdiction: raw.jurisdiction,
      office_region: raw.office_region.trim() || null,
      office_locality: raw.office_locality.trim() || null,
      chamber: raw.chamber === 'upper' || raw.chamber === 'lower' ? raw.chamber : null,
      seat_type: atLarge ? 'at_large' : 'district',
      seat_name: raw.seat_name.trim() || null,
      seat_position: raw.seat_position.trim() || null,
      seat_label_override: raw.seat_label_override.trim() || null,
      office_title: raw.office_title.trim() || null,
      // An at-large office is elected across the whole city or state, so it represents no one area
      // and sends an empty list — which clears any areas left behind by an earlier district answer.
      seat_areas: atLarge ? [] : this.seatAreas().map((area) => ({ name: area.name, set_id: area.set_id })),
    };
  }

  /** Clears answers the current jurisdiction and seat type no longer ask for. */
  private dropAnswersThatNoLongerApply(jurisdiction: JurisdictionId, atLarge: boolean): void {
    const spec = JURISDICTIONS[jurisdiction];
    this.payload.update((p) => {
      const next = { ...p };
      if (!spec.requiresRegion || regionsForCountry(spec.country).length === 0) next.office_region = '';
      if (!spec.requiresLocality) next.office_locality = '';
      // At large also drops the chamber: a statewide office sits in no chamber, and the schema
      // refuses the combination.
      if (!spec.usesChamber || atLarge) next.chamber = '';
      if (!spec.supportsAtLarge) next.seat_type = 'district';
      if (!MULTI_MEMBER_JURISDICTIONS.includes(jurisdiction)) next.seat_position = '';
      if (atLarge && spec.supportsAtLarge) next.seat_name = '';
      return next;
    });
  }

  private async loadCampaign(): Promise<void> {
    if (this.isNew()) return;
    const end = this._loading.begin();
    try {
      const campaign = await this.campaignsSvc.getById(this.id()!);
      this.detail.set(campaign);
      this.setForm(campaign);
    } catch (err) {
      const message = getUserErrorMessage(err, 'Failed to load the campaign');
      this.error.set(message);
      this.alerts.showError(message);
    } finally {
      end();
    }
  }

  private setForm(campaign: CampaignDetail | null) {
    if (!campaign) return;
    const c = campaign as Record<string, unknown>;
    const jurisdiction = c['jurisdiction'];
    const seatType = c['seat_type'];
    const chamber = c['chamber'];
    this.payload.set({
      name: this.text(c, 'name'),
      description: this.text(c, 'description'),
      notes: this.text(c, 'notes'),
      kind: 'election',
      startdate: this.text(c, 'startdate'),
      enddate: this.text(c, 'enddate'),
      jurisdiction: isJurisdictionId(jurisdiction) ? jurisdiction : 'other',
      office_region: this.text(c, 'office_region'),
      office_locality: this.text(c, 'office_locality'),
      chamber: chamber === 'upper' || chamber === 'lower' ? chamber : '',
      seat_type: seatType === 'at_large' ? 'at_large' : 'district',
      seat_name: this.text(c, 'seat_name'),
      seat_position: this.text(c, 'seat_position'),
      seat_label_override: this.text(c, 'seat_label_override'),
      office_title: this.text(c, 'office_title'),
    });

    // The areas live in their own table, so they are fetched rather than read off the campaign row.
    // Quiet on failure for the same reason the suggestions are: the rest of the form still works,
    // and an error banner over a list that simply has not arrived yet reads as a broken page.
    const id = c['id'];
    if (id != null) {
      void this.campaignsSvc
        .getAreas(String(id))
        .then((areas) => this.seatAreas.set(areas.map((area) => ({ name: area.name, set_id: area.set_id }))))
        .catch(() => this.seatAreas.set([]));
    }
  }

  private text(source: Record<string, unknown>, key: string): string {
    const value = source[key];
    return typeof value === 'string' ? value : '';
  }
}
