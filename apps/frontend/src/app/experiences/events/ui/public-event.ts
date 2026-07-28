import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { apiBase, tenantQuery } from '../../../shared/public-pages';
import { PublicPageMeta } from '../../../shared/public-page-meta';

/**
 * Which public surface this page instance serves. Event RSVPs (/e/:slug, events table) and
 * volunteer signups (/v/:slug, volunteer_events table) share one page — same layout, same states —
 * differing only in API paths, copy, and the tickets section. The route provides the kind via
 * `data.kind`.
 */
type PublicEventKind = 'event' | 'volunteer';

interface PublicEventInfo {
  name: string;
  description: string | null;
  location_address: string | null;
  start_time: string;
  end_time: string;
  capacity: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_private?: boolean;
  fields: string[];
}

interface PublicTicket {
  name: string;
  description: string | null;
  price_cents: number | null;
  capacity: number | null;
}

interface FormFieldDef {
  key: string;
  label: string;
  required: boolean;
  kind: 'text' | 'email' | 'area' | 'country';
}

type PageState = 'loading' | 'open' | 'notfound' | 'thanks';

const FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  mobile: 'Mobile / phone',
  street1: 'Street address',
  city: 'City',
  state: 'State / province',
  zip: 'Zip / postal code',
  country: 'Country',
  notes: 'Notes / message',
};

const COUNTRY_OPTIONS = [
  { value: 'CA', label: 'Canada' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AU', label: 'Australia' },
] as const;

/**
 * Unauthenticated public event page served at /e/:slug (event RSVP) and /v/:slug (volunteer
 * signup), outside the app shell — the event/volunteer sibling of the /f/:slug public form page.
 * The tenant comes from the page's own subdomain and is passed to the API as `?t=`.
 */
@Component({
  selector: 'pc-public-event',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink],
  template: `
    <div class="flex min-h-screen items-start justify-center bg-base-200 px-4 py-10">
      @switch (state()) {
        @case ('loading') {
          <span class="loading loading-spinner loading-lg mt-20 text-primary"></span>
        }
        @case ('open') {
          <div class="w-full max-w-[760px]">
            @if (kind === 'volunteer' && !event()!.is_private) {
              <a class="link-hover link mb-4 inline-block text-sm text-primary" routerLink="/volunteer">
                ← All volunteer events
              </a>
            }

            <div class="pc-panel p-8">
              <div class="mb-4 flex items-center gap-2">
                <div
                  class="flex size-7 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary"
                >
                  {{ orgInitials() }}
                </div>
                <span class="text-sm font-medium text-base-content">{{ orgName() }}</span>
              </div>

              <p class="pc-eyebrow mb-1">
                {{ kind === 'volunteer' ? 'Volunteer event' : 'Event' }}
              </p>
              <h1 class="mb-1 text-xl font-semibold text-base-content">{{ event()!.name }}</h1>
              @if (event()!.description) {
                <p class="mb-4 text-sm leading-relaxed text-base-content/60">{{ event()!.description }}</p>
              }

              <div class="mb-6 flex flex-col gap-2 text-sm text-base-content">
                <div class="flex items-baseline gap-2">
                  <span class="pc-eyebrow w-24 shrink-0">When</span>
                  <span>
                    {{ event()!.start_time | date: 'EEEE, MMMM d, y' }} ·
                    {{ event()!.start_time | date: 'shortTime' }} – {{ event()!.end_time | date: 'shortTime' }}
                  </span>
                </div>
                @if (event()!.location_address) {
                  <div class="flex items-baseline gap-2">
                    <span class="pc-eyebrow w-24 shrink-0">Where</span>
                    <span>{{ event()!.location_address }}</span>
                  </div>
                }
                @if (event()!.capacity !== null) {
                  <div class="flex items-baseline gap-2">
                    <span class="pc-eyebrow w-24 shrink-0">Spots</span>
                    <span class="tabular-nums">{{ remaining() }} of {{ event()!.capacity }} left</span>
                  </div>
                }
                @if (event()!.contact_email || event()!.contact_phone) {
                  <div class="flex items-baseline gap-2">
                    <span class="pc-eyebrow w-24 shrink-0">Questions</span>
                    <span>
                      @if (event()!.contact_email) {
                        <a class="link-hover link text-primary" [href]="'mailto:' + event()!.contact_email">{{
                          event()!.contact_email
                        }}</a>
                      }
                      @if (event()!.contact_email && event()!.contact_phone) {
                        ·
                      }
                      {{ event()!.contact_phone }}
                    </span>
                  </div>
                }
              </div>

              @if (tickets().length > 0) {
                <div class="mb-6">
                  <h2 class="mb-2 text-sm font-semibold text-base-content">Tickets</h2>
                  <div class="flex flex-col gap-2">
                    @for (ticket of tickets(); track ticket.name) {
                      <div class="flex items-center justify-between pc-panel px-4 py-3">
                        <div>
                          <p class="text-sm font-medium text-base-content">{{ ticket.name }}</p>
                          @if (ticket.description) {
                            <p class="text-xs text-base-content/60">{{ ticket.description }}</p>
                          }
                        </div>
                        <span class="text-sm font-semibold tabular-nums text-primary">
                          {{ ticket.price_cents ? '$' + (ticket.price_cents / 100).toFixed(2) : 'Free' }}
                        </span>
                      </div>
                    }
                  </div>
                </div>
              }

              <div class="divider my-2"></div>

              <h2 class="mb-3 text-sm font-semibold text-base-content">
                {{ kind === 'volunteer' ? 'Sign up to volunteer' : 'RSVP for this event' }}
              </h2>

              @if (isPast()) {
                <div class="rounded-xl border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">
                  This event has passed and registration is closed.
                </div>
              } @else if (isFull()) {
                <div class="rounded-xl border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">
                  This event is at full capacity. No spots are left.
                </div>
              } @else {
                <form class="flex flex-col gap-5" (submit)="$event.preventDefault(); submit()" novalidate>
                  @for (field of formFields(); track field.key) {
                    <div class="flex flex-col gap-2" [class.md:max-w-[380px]]="field.kind !== 'area'">
                      <label class="text-sm font-medium text-base-content" [for]="field.key">
                        {{ field.label }}
                        @if (field.required) {
                          <span class="text-base-content/50"> *</span>
                        }
                      </label>
                      @switch (field.kind) {
                        @case ('area') {
                          <textarea
                            [id]="field.key"
                            class="textarea textarea-bordered min-h-[76px] w-full resize-none text-sm"
                            [class.textarea-error]="!!errors()[field.key]"
                            (input)="setValue(field.key, $any($event.target).value)"
                          ></textarea>
                        }
                        @case ('country') {
                          <select
                            [id]="field.key"
                            class="select select-bordered w-full text-sm"
                            [class.select-error]="!!errors()[field.key]"
                            (change)="setValue(field.key, $any($event.target).value)"
                          >
                            <option value="">Choose…</option>
                            @for (opt of countryOptions; track opt.value) {
                              <option [value]="opt.value">{{ opt.label }}</option>
                            }
                          </select>
                        }
                        @default {
                          <input
                            [id]="field.key"
                            class="input input-bordered w-full text-sm"
                            [class.input-error]="!!errors()[field.key]"
                            [type]="field.kind === 'email' ? 'email' : 'text'"
                            (input)="setValue(field.key, $any($event.target).value)"
                          />
                        }
                      }
                      @if (errors()[field.key]) {
                        <span class="text-xs text-error">{{ errors()[field.key] }}</span>
                      }
                    </div>
                  }

                  @if (submitError()) {
                    <p class="text-sm text-error">{{ submitError() }}</p>
                  }

                  <button class="btn btn-primary mt-1 w-full md:max-w-[380px]" [disabled]="submitting()" type="submit">
                    @if (submitting()) {
                      <span class="loading loading-spinner loading-sm"></span>
                    }
                    {{ kind === 'volunteer' ? 'Sign up to volunteer' : 'Confirm RSVP' }}
                  </button>
                </form>
              }

              <p class="mt-6 text-center text-xs text-base-content/40">Powered by pplCRM</p>
            </div>
          </div>
        }
        @case ('thanks') {
          <div class="mt-20 w-full max-w-[440px] pc-panel p-8 text-center">
            <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
              ✓
            </div>
            <h1 class="mb-2 text-xl font-semibold text-base-content">
              {{ kind === 'volunteer' ? 'You’re signed up!' : 'You’re registered!' }}
            </h1>
            <p class="text-sm text-base-content/60">A confirmation email with the event details is on its way.</p>
          </div>
        }
        @default {
          <div class="mt-20 w-full max-w-[440px] pc-panel p-8 text-center">
            <h1 class="mb-2 text-xl font-semibold text-base-content">Event not found</h1>
            <p class="text-sm text-base-content/60">This event doesn’t exist or hasn’t been published yet.</p>
          </div>
        }
      }
    </div>
  `,
})
export class PublicEventComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  protected readonly kind: PublicEventKind = this.route.snapshot.data['kind'] === 'volunteer' ? 'volunteer' : 'event';
  protected readonly countryOptions = COUNTRY_OPTIONS;

  protected readonly state = signal<PageState>('loading');
  private readonly pageMeta = inject(PublicPageMeta);
  protected readonly orgName = signal('Our organization');
  protected readonly event = signal<PublicEventInfo | null>(null);
  protected readonly tickets = signal<PublicTicket[]>([]);
  protected readonly isPast = signal(false);
  protected readonly isFull = signal(false);
  protected readonly remaining = signal<number | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  private readonly values = new Map<string, string>();

  protected readonly orgInitials = computed(() => {
    const parts = this.orgName().trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'pC';
  });

  /**
   * The signup form's fields, from the event's legacy string[] config ("mobile:required").
   * Email is always present and required — it is the identity key server-side.
   */
  protected readonly formFields = computed<FormFieldDef[]>(() => {
    const raw = this.event()?.fields ?? [];
    const enabled = new Map<string, boolean>();
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const required = entry.endsWith(':required');
      const key = required ? entry.slice(0, -':required'.length) : entry;
      if (key && key !== 'email') enabled.set(key, required);
    }

    const fields: FormFieldDef[] = [];
    const push = (key: string): void => {
      if (!enabled.has(key)) return;
      const kind: FormFieldDef['kind'] = key === 'notes' ? 'area' : key === 'country' ? 'country' : 'text';
      fields.push({ key, label: FIELD_LABELS[key] ?? key, required: enabled.get(key) === true, kind });
    };

    push('first_name');
    push('last_name');
    fields.push({ key: 'email', label: 'Email address', required: true, kind: 'email' });
    for (const key of ['mobile', 'street1', 'city', 'state', 'zip', 'country', 'notes']) {
      push(key);
    }
    return fields;
  });

  public ngOnInit(): void {
    void this.load();
  }

  protected setValue(key: string, value: string): void {
    this.values.set(key, value);
    if (this.errors()[key]) {
      this.errors.update((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
    }
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;

    const errors: Record<string, string> = {};
    for (const field of this.formFields()) {
      if (field.required && !(this.values.get(field.key) ?? '').trim()) {
        errors[field.key] = `${field.label} is required.`;
      }
    }
    if (Object.keys(errors).length > 0) {
      this.errors.set(errors);
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    try {
      const payload: Record<string, string> = {};
      for (const [key, value] of this.values.entries()) payload[key] = value;

      const res = await fetch(this.submitUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.submitError.set(data?.error || 'Something went wrong. Please try again.');
        return;
      }
      this.state.set('thanks');
    } catch {
      this.submitError.set('Couldn’t reach the server. Check your connection and try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  private async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.state.set('notfound');
      this.pageMeta.setNotFound('event');
      return;
    }
    try {
      const res = await fetch(this.configUrl(slug));
      if (!res.ok) {
        this.state.set('notfound');
        this.pageMeta.setNotFound('event');
        return;
      }
      const data = await res.json();
      if (data?.orgName) this.orgName.set(String(data.orgName));
      this.event.set(data.event as PublicEventInfo);
      this.tickets.set(Array.isArray(data.tickets) ? (data.tickets as PublicTicket[]) : []);
      this.isPast.set(!!data.isPast);
      this.isFull.set(!!data.isFull);
      this.remaining.set(typeof data.remaining === 'number' ? data.remaining : null);
      this.state.set('open');
      // Tab title and share card, now that the org and event names are known.
      this.pageMeta.set(this.event()?.name ?? '', this.orgName(), this.event()?.description ?? undefined);
    } catch {
      this.state.set('notfound');
      this.pageMeta.setNotFound('event');
    }
  }

  private configUrl(slug: string): string {
    const path = this.kind === 'volunteer' ? 'api/events/v' : 'api/event-pages/e';
    return `${apiBase()}/${path}/${encodeURIComponent(slug)}${tenantQuery()}`;
  }

  private submitUrl(): string {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    const path = this.kind === 'volunteer' ? 'api/events/signup' : 'api/event-pages/rsvp';
    return `${apiBase()}/${path}/${encodeURIComponent(slug)}${tenantQuery()}`;
  }
}
