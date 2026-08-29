import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked, OnInit } from '@angular/core';
import { FormField, form, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterModule } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { EntityOverview as PcEntityOverview } from '@uxcommon/components/entity-overview/entity-overview';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { FieldsSelector } from '@uxcommon/components/fields-selector/fields-selector';
import { PublicLinkPanel } from '@uxcommon/components/public-link-panel/public-link-panel';

import {
  AddVolunteerEventObj,
  AddVolunteerEventType,
  UpdateVolunteerEventType,
} from '../../../../../../../libs/common/src';
import { AuthService } from '../../../auth/auth-service';
import { publicPageUrl } from '../../../shared/public-pages';
import { VolunteerService } from '../../../services/api/volunteer-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { PersonsService } from '../../persons/services/persons-service';
import { ShiftsService } from '../services/shifts-service';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

/** True only for a real typed zero — a blank field (null or '') means "unlimited". */
function isZeroCapacity(capacity: number | null): boolean {
  if (capacity == null || String(capacity).trim() === '') return false;
  return Number(capacity) === 0;
}

/** Normalizes a roster row's hours field for the wire: blank stays null, a typed 0 stays 0. */
function normalizeHoursWorked(hours: unknown): number | null {
  if (hours == null || String(hours).trim() === '') return null;
  return Number(hours);
}

@Component({
  selector: 'pc-shift-form',
  imports: [
    DatePipe,
    FormField,
    PcInput,
    PcTextarea,
    RouterModule,
    Icon,
    PcDetailHeader,
    PcEntityOverview,
    PcCard,
    FieldsSelector,
    PublicLinkPanel,
  ],
  templateUrl: './shift-form.html',
  providers: [VolunteerService],
})
export class ShiftFormComponent implements OnInit {
  private readonly _loading = createLoadingGate();
  private readonly alerts = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly personsSvc = inject(PersonsService);
  private readonly router = inject(Router);
  private readonly volunteerEventsSvc = inject(ShiftsService);
  private readonly volunteerSvc = inject(VolunteerService);

  private slugTimeoutId: ReturnType<typeof setTimeout> | null = null;

  protected readonly selectedFields = signal<string[]>(['first_name', 'last_name', 'email', 'mobile', 'notes']);
  protected readonly publicUrl = computed(() => {
    const slug = this.payload().slug;
    if (!slug || this.isNew()) return '';
    return publicPageUrl(this.auth.getUser()?.tenant_slug, `v/${slug}`);
  });

  protected readonly detail = signal<any>(null);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    const shifts: PcBreadcrumb = { label: 'Forms', route: '/forms' };
    const id = this.id();
    if (id) {
      return [
        shifts,
        { label: this.detail()?.name || 'Volunteer event', route: ['/events/shifts', id] },
        { label: 'Edit' },
      ];
    }
    return [shifts, { label: 'New volunteer event' }];
  });

  protected readonly payload = signal({
    name: '',
    slug: '',
    description: '',
    location_address: '',
    start_time: '',
    end_time: '',
    capacity: null as number | null,
    contact_email: '',
    contact_phone: '',
    is_private: false,
    send_reminder: true,
    send_signup_confirmation: true,
    send_volunteer_alert: true,
  });
  protected readonly endBeforeStartError = computed(() => {
    const { start_time, end_time } = this.payload();
    if (!start_time || !end_time) return false;
    return new Date(end_time) <= new Date(start_time);
  });
  protected readonly volunteerListUrl = computed(() => publicPageUrl(this.auth.getUser()?.tenant_slug, 'volunteer'));
  protected readonly error = signal<string | null>(null);
  protected readonly eventPassed = computed(() => {
    const end = this.payload().end_time;
    if (!end) return false;
    return new Date(end) < new Date();
  });
  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, AddVolunteerEventObj);
  });
  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);
  protected readonly isNew = computed(() => !this.id());
  protected readonly loading = this._loading.visible;

  // Roster state
  protected readonly roster = signal<any[]>([]);
  /**
   * Roster rows whose Hours or Notes have been typed but not written yet. The header
   * "Save event" flushes these, and the leave guard counts them, so they can no longer
   * be lost by clicking the button that looks like it saves everything on the page.
   */
  protected readonly dirtyShiftIds = signal<ReadonlySet<string>>(new Set());
  /** A cancelled shift has given its spot back, so it is not one of the people coming. */
  protected readonly activeRosterCount = computed(() => this.roster().filter((r) => r.status !== 'cancelled').length);
  protected readonly dirtyFieldCount = computed(() => this.unsavedChanges.dirtyCount() + this.dirtyShiftIds().size);
  protected readonly saving = signal(false);
  protected readonly slugChecking = signal(false);
  protected readonly slugUnique = signal<boolean | null>(null);
  protected readonly volunteerSearch = signal('');
  /** Non-null when the volunteer search could not run, so an empty search can say so. */
  protected readonly volunteersError = signal<string | null>(null);

  /**
   * Server-searched matches, roster members excluded. This used to be a computed filtering an
   * up-front `allVolunteers` load: the form fetched up to 1000 FULL person rows (wide joined
   * grid rows) on open just to search four fields client-side, and any volunteer past the load
   * window was silently unfindable. Each (debounced) keystroke now asks the backend, whose
   * search covers the same fields the People grid searches, windowed to a dropdown's worth.
   */
  protected readonly volunteerSearchResults = signal<any[]>([]);
  private volunteerFetchTimer: ReturnType<typeof setTimeout> | null = null;
  private volunteerFetchToken = 0;

  protected slugManuallyEdited = false;

  public readonly id = input<string>();

  constructor() {
    const nameSignal = computed(() => this.payload().name);
    effect(() => {
      const name = nameSignal();
      if (this.isNew() && !this.slugManuallyEdited) {
        const suggested = this.slugify(name);
        if (untracked(this.payload).slug !== suggested) {
          this.payload.update((p) => ({
            ...p,
            slug: suggested,
          }));
        }
      }
    });

    const slugSignal = computed(() => this.payload().slug);
    effect(() => {
      const slug = slugSignal();
      if (this.slugTimeoutId) {
        clearTimeout(this.slugTimeoutId);
        this.slugTimeoutId = null;
      }

      if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        this.slugUnique.set(null);
        this.slugChecking.set(false);
        return;
      }

      this.slugChecking.set(true);
      this.slugTimeoutId = setTimeout(() => {
        void (async () => {
          try {
            const res = await this.volunteerEventsSvc.checkSlugUnique(slug, this.isNew() ? null : (this.id() ?? null));
            if (untracked(slugSignal) === slug) {
              this.slugUnique.set(res.unique);
            }
          } catch (err) {
            console.error('Failed to check slug uniqueness', err);
          } finally {
            if (untracked(slugSignal) === slug) {
              this.slugChecking.set(false);
            }
          }
        })();
      }, 300);
    });
  }

  public ngOnInit(): void {
    const end = this._loading.begin();
    try {
      void this.loadEvent().finally(() => end());
    } catch {
      end();
    }
  }

  // Roster Management
  protected async addVolunteer(person: any) {
    try {
      await this.volunteerSvc.signupVolunteer({
        event_id: this.id()!,
        person_id: String(person.id),
        status: 'signed_up',
      });
      this.volunteerSearch.set('');
      this.volunteerSearchResults.set([]);
      this.alerts.showSuccess(`${person.first_name} added to roster`);
      await this.loadRoster();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to add volunteer');
    }
  }

  protected copyToClipboard(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => this.alerts.showSuccess('Link copied to clipboard'))
      .catch((err) => console.error('Failed to copy', err));
  }

  protected async deleteEvent() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Event',
      message: 'Are you sure you want to delete this event? This will also delete all signed up shifts.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;

    this.saving.set(true);
    try {
      await this.volunteerEventsSvc.delete(this.id()!);
      this.volunteerEventsSvc.triggerRefresh();
      this.alerts.showSuccess('Event deleted');
      await this.router.navigate(['/forms']);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to delete event');
    } finally {
      this.saving.set(false);
    }
  }

  protected async loadEvent() {
    if (this.isNew()) {
      const state = window.history.state;
      if (state && state.cloneData) {
        const event = state.cloneData;
        this.payload.set({
          name: event.name ? `${event.name} (Copy)` : '',
          slug: event.slug ? `${event.slug}-copy` : '',
          description: event.description ?? '',
          location_address: event.location_address ?? '',
          start_time: this.toDatetimeLocalString(event.start_time),
          end_time: this.toDatetimeLocalString(event.end_time),
          capacity: event.capacity ?? null,
          contact_email: event.contact_email ?? '',
          contact_phone: event.contact_phone ?? '',
          is_private: !!event.is_private,
          send_reminder: event.send_reminder !== false,
          send_signup_confirmation: event.send_signup_confirmation !== false,
          send_volunteer_alert: event.send_volunteer_alert !== false,
        });
      }
      return;
    }

    try {
      const event = (await this.volunteerEventsSvc.getById(this.id()!)) as any;
      this.detail.set(event);
      this.payload.set({
        name: event.name ?? '',
        slug: event.slug ?? '',
        description: event.description ?? '',
        location_address: event.location_address ?? '',
        start_time: this.toDatetimeLocalString(event.start_time),
        end_time: this.toDatetimeLocalString(event.end_time),
        capacity: event.capacity ?? null,
        contact_email: event.contact_email ?? '',
        contact_phone: event.contact_phone ?? '',
        is_private: !!event.is_private,
        send_reminder: event.send_reminder !== false,
        send_signup_confirmation: event.send_signup_confirmation !== false,
        send_volunteer_alert: event.send_volunteer_alert !== false,
      });

      if (Array.isArray((event as any).fields) && (event as any).fields.length > 0) {
        this.selectedFields.set((event as any).fields);
      }

      await this.loadRoster();
    } catch (err) {
      this.error.set(err instanceof Error && err.message ? err.message : 'Failed to load event');
      this.alerts.showError(this.error()!);
    }
  }

  protected async loadRoster() {
    if (!this.id()) return;
    try {
      const roster = await this.volunteerSvc.getShiftsForEvent(this.id()!);
      this.roster.set(roster || []);
    } catch (err) {
      console.error('Failed to load event roster', err);
    }
  }

  private async fetchVolunteerMatches() {
    const token = ++this.volunteerFetchToken;
    const search = this.volunteerSearch().trim();
    if (!search) {
      this.volunteerSearchResults.set([]);
      return;
    }
    try {
      this.volunteersError.set(null);
      const res = await this.personsSvc.getAll({
        searchStr: search,
        tags: ['volunteer'],
        startRow: 0,
        endRow: 25,
        columns: ['id', 'first_name', 'last_name', 'email'],
      });
      if (token !== this.volunteerFetchToken) return; // a newer keystroke superseded this one
      const rosterIds = new Set(this.roster().map((r) => String(r.person_id)));
      this.volunteerSearchResults.set((res?.rows || []).filter((v) => !rosterIds.has(String(v['id']))));
    } catch (err) {
      if (token !== this.volunteerFetchToken) return;
      console.error('Failed to search volunteers', err);
      // Only the console knew about this before, so the search box just looked empty.
      this.volunteersError.set(err instanceof Error && err.message ? err.message : 'Could not load your volunteers.');
    }
  }

  /** Retry for the search after a failure, without reloading the whole page. */
  protected reloadVolunteers(): void {
    void this.fetchVolunteerMatches();
  }

  protected onSlugInput() {
    this.slugManuallyEdited = true;
  }

  protected onVolunteerSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.volunteerSearch.set(input?.value ?? '');
    if (this.volunteerFetchTimer) clearTimeout(this.volunteerFetchTimer);
    this.volunteerFetchTimer = setTimeout(() => void this.fetchVolunteerMatches(), 200);
  }

  protected onShiftStatusChange(shift: any, event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) return;
    void this.updateShiftStatus(shift, select.value);
  }

  protected onShiftHoursInput(shift: any, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.updateShiftHours(shift, input?.value ?? '');
  }

  protected onShiftNotesInput(shift: any, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.updateShiftNotes(shift, input?.value ?? '');
  }

  protected async removeVolunteer(shift: any) {
    const confirmed = await this.dialogs.confirm({
      title: 'Remove Volunteer',
      message: 'Remove this person from the event roster?',
      variant: 'danger',
      confirmText: 'Remove',
    });
    if (!confirmed) return;
    try {
      await this.volunteerSvc.deleteShift(shift.id);
      this.alerts.showSuccess('Volunteer removed');
      await this.loadRoster();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to remove volunteer');
    }
  }

  public async canDeactivate(): Promise<boolean> {
    // stayPut: the router is already navigating away, so the guard-time save must not navigate.
    const proceed = await this.unsavedChanges.confirmDiscardIfDirty(this.detail()?.name || 'this volunteer event', () =>
      this.save(undefined, true),
    );
    if (!proceed) return false;
    // That handle only watches the event payload. Roster hours and notes live in a separate
    // table on the same page and would otherwise disappear without a word.
    return this.confirmDiscardRosterEdits();
  }

  private async confirmDiscardRosterEdits(): Promise<boolean> {
    const count = this.dirtyShiftIds().size;
    if (count === 0) return true;
    return this.dialogs.confirm({
      title: 'Leave without saving?',
      message: `Hours or notes for ${count} volunteer${count === 1 ? '' : 's'} on the roster have not been saved. Leaving discards them.`,
      variant: 'warning',
      confirmText: 'Discard roster edits',
      cancelText: 'Keep editing',
      emphasizeCancel: true,
    });
  }

  protected async save(done?: (() => void) | Event, stayPut = false): Promise<boolean> {
    if (done instanceof Event) {
      done.preventDefault();
    }
    this.form().markAsTouched();
    if (this.form().invalid()) return false;

    if (this.endBeforeStartError()) {
      this.alerts.showError('The event cannot end before it starts, please check the dates and times again.');
      return false;
    }

    // A typed 0 used to be saved as null and displayed as "Unlimited" — the opposite of
    // what the organizer asked for. Say so, and name the control that does close signups.
    if (isZeroCapacity(this.payload().capacity)) {
      this.alerts.showError(
        'A capacity of 0 is not a limit we can save. Leave it blank for unlimited, or mark the event Private to stop taking signups.',
      );
      return false;
    }

    if (this.slugUnique() === false) {
      this.alerts.showError('This URL slug is already in use. Please choose a different one.');
      return false;
    }

    this.saving.set(true);
    this.error.set(null);

    const raw = this.payload();
    const data = {
      name: raw.name.trim(),
      slug: raw.slug.trim(),
      description: raw.description?.trim() || null,
      location_address: raw.location_address?.trim() || null,
      start_time: new Date(raw.start_time),
      end_time: new Date(raw.end_time),
      capacity: raw.capacity ? Number(raw.capacity) : null,
      contact_email: raw.contact_email?.trim() || null,
      contact_phone: raw.contact_phone?.trim() || null,
      is_private: !!raw.is_private,
      send_reminder: !!raw.send_reminder,
      send_signup_confirmation: !!raw.send_signup_confirmation,
      send_volunteer_alert: !!raw.send_volunteer_alert,
      fields: this.selectedFields(),
    };

    try {
      // Hours and Notes typed into the roster table are pending edits on this page too.
      // Write them first: if one fails we stop here instead of navigating away with a
      // success toast that would leave the typing behind.
      if (!this.isNew() && !(await this.saveDirtyShifts())) return false;

      if (this.isNew()) {
        const res = await this.volunteerEventsSvc.add(data as AddVolunteerEventType);
        this.volunteerEventsSvc.triggerRefresh();
        this.alerts.showSuccess('Event created successfully');
        this.form().reset();
        if (!stayPut) await this.router.navigate(['/events/shifts', res.id]);
      } else {
        await this.volunteerEventsSvc.update(this.id()!, data as UpdateVolunteerEventType);
        this.volunteerEventsSvc.triggerRefresh();
        this.alerts.showSuccess('Event updated successfully');
        // Pristine again, so the post-save navigation doesn't hit the leave guard.
        this.form().reset();
        if (typeof done === 'function') {
          done();
        } else if (!stayPut) {
          await this.router.navigate(['/events/shifts', this.id()]);
        }
      }
      return true;
    } catch (err) {
      this.error.set(err instanceof Error && err.message ? err.message : 'Failed to save event');
      this.alerts.showError(this.error()!);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  protected async saveShiftDetails(shift: any) {
    try {
      await this.volunteerSvc.updateShift(shift.id, {
        status: shift.status,
        hours_worked: normalizeHoursWorked(shift.hours_worked),
        notes: shift.notes || null,
      });
      this.alerts.showSuccess('Shift details saved');
      this.markShiftClean(shift);
      await this.loadRoster();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to save shift details');
    }
  }

  protected slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  protected toDatetimeLocalString(val: any): string {
    if (!val) return '';
    const date = new Date(val);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  protected updateShiftHours(shift: any, hours: any) {
    shift.hours_worked = normalizeHoursWorked(hours);
    this.markShiftDirty(shift);
  }

  protected updateShiftNotes(shift: any, notes: any) {
    shift.notes = notes || null;
    this.markShiftDirty(shift);
  }

  private markShiftDirty(shift: any): void {
    const id = String(shift.id);
    this.dirtyShiftIds.update((ids) => (ids.has(id) ? ids : new Set(ids).add(id)));
  }

  private markShiftClean(shift: any): void {
    const id = String(shift.id);
    this.dirtyShiftIds.update((ids) => {
      if (!ids.has(id)) return ids;
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  }

  /**
   * Writes every roster row with pending Hours/Notes. Returns false if any write failed,
   * so the caller can stop rather than navigate away and report success.
   */
  private async saveDirtyShifts(): Promise<boolean> {
    const dirty = this.dirtyShiftIds();
    if (dirty.size === 0) return true;
    const rows = this.roster().filter((r) => dirty.has(String(r.id)));
    try {
      await Promise.all(
        rows.map((shift) =>
          this.volunteerSvc.updateShift(shift.id, {
            status: shift.status,
            hours_worked: normalizeHoursWorked(shift.hours_worked),
            notes: shift.notes || null,
          }),
        ),
      );
      this.dirtyShiftIds.set(new Set());
      await this.loadRoster();
      return true;
    } catch (err) {
      this.alerts.showError(
        err instanceof Error && err.message ? err.message : 'Failed to save roster hours and notes',
      );
      return false;
    }
  }

  protected async updateShiftStatus(shift: any, status: any) {
    try {
      await this.volunteerSvc.updateShift(shift.id, {
        status,
        hours_worked: normalizeHoursWorked(shift.hours_worked),
        notes: shift.notes || null,
      });
      // The status write carries the row's hours and notes with it, so nothing is pending here.
      this.alerts.showSuccess('Shift status updated');
      this.markShiftClean(shift);
      await this.loadRoster();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to update shift');
    }
  }
}
