import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormField, safeRedirectUrl } from '../../../../../../../libs/common/src';

import { apiBase, tenantQuery } from '../../../shared/public-pages';
import { PublicPageMeta } from '../../../shared/public-page-meta';

interface PublicForm {
  id: string;
  name: string;
  description: string | null;
  submit_label: string | null;
  thanks_title: string | null;
  thanks_body: string | null;
  redirect_url: string | null;
  fields: FormField[];
}

type PageState = 'loading' | 'open' | 'closed' | 'notfound' | 'thanks';

/**
 * Unauthenticated public form page served at /f/:slug, outside the app shell. Fetches the form's
 * render config from the backend, collects a response with coach-don't-block validation, and posts
 * it to the existing public submit endpoint.
 */
@Component({
  selector: 'pc-public-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-10">
      @switch (state()) {
        @case ('loading') {
          <span class="loading loading-spinner loading-lg text-primary"></span>
        }
        @case ('open') {
          <div class="w-full max-w-[440px] pc-panel p-8">
            <div class="mb-4 flex items-center gap-2">
              <div
                class="flex size-7 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary"
              >
                {{ orgInitials() }}
              </div>
              <span class="text-sm font-medium text-base-content">{{ orgName() }}</span>
            </div>

            <h1 class="mb-1 text-xl font-semibold text-base-content">{{ form()!.name }}</h1>
            @if (form()!.description) {
              <p class="mb-6 text-sm leading-relaxed text-base-content/60">{{ form()!.description }}</p>
            } @else {
              <div class="mb-6"></div>
            }

            <form class="flex flex-col gap-5" (submit)="$event.preventDefault(); submit()" novalidate>
              @for (field of form()!.fields; track field.key) {
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium text-base-content">
                    {{ field.label }}
                    @if (field.required) {
                      <span class="text-base-content/50"> *</span>
                    }
                  </label>

                  @switch (field.type) {
                    @case ('area') {
                      <textarea
                        class="textarea textarea-bordered min-h-[76px] w-full resize-none text-sm"
                        [class.textarea-error]="!!errors()[field.key]"
                        [placeholder]="field.placeholder ?? ''"
                        (input)="setValue(field.key, $any($event.target).value)"
                      ></textarea>
                    }
                    @case ('select') {
                      <select
                        class="select select-bordered w-full text-sm"
                        [class.select-error]="!!errors()[field.key]"
                        (change)="setValue(field.key, $any($event.target).value)"
                      >
                        <option value="">Choose…</option>
                        @for (opt of field.options ?? []; track opt) {
                          <option [value]="opt">{{ opt }}</option>
                        }
                      </select>
                    }
                    @case ('checks') {
                      <div class="flex flex-col gap-2">
                        @for (opt of field.options ?? []; track opt) {
                          <label class="flex items-center gap-2 text-sm text-base-content">
                            <input
                              type="checkbox"
                              class="checkbox checkbox-sm"
                              (change)="toggleCheck(field.key, opt)"
                            />
                            {{ opt }}
                          </label>
                        }
                      </div>
                    }
                    @default {
                      <input
                        class="input input-bordered w-full text-sm"
                        [class.input-error]="!!errors()[field.key]"
                        [type]="field.key === 'email' ? 'email' : 'text'"
                        [placeholder]="field.placeholder ?? ''"
                        (input)="setValue(field.key, $any($event.target).value)"
                      />
                    }
                  }

                  @if (errors()[field.key]) {
                    <span class="text-xs text-error">{{ errors()[field.key] }}</span>
                  } @else if (field.help) {
                    <span class="text-xs text-base-content/50">{{ field.help }}</span>
                  }
                </div>
              }

              @if (submitError()) {
                <p class="text-sm text-error">{{ submitError() }}</p>
              }

              <button class="btn btn-primary mt-1 w-full" [disabled]="submitting()" type="submit">
                @if (submitting()) {
                  <span class="loading loading-spinner loading-sm"></span>
                }
                {{ form()!.submit_label || 'Submit' }}
              </button>
            </form>

            <p class="mt-6 text-center text-xs text-base-content/40">Powered by pplCRM</p>
          </div>
        }
        @case ('thanks') {
          <div class="w-full max-w-[440px] pc-panel p-8 text-center">
            <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
              ✓
            </div>
            <h1 class="mb-2 text-xl font-semibold text-base-content">{{ form()?.thanks_title || 'Thank you!' }}</h1>
            <p class="text-sm text-base-content/60">{{ form()?.thanks_body || 'Your response has been recorded.' }}</p>
          </div>
        }
        @default {
          <div class="w-full max-w-[440px] pc-panel p-8 text-center">
            <h1 class="mb-2 text-xl font-semibold text-base-content">This form is closed</h1>
            <p class="text-sm text-base-content/60">{{ orgName() }} isn’t taking new responses here right now.</p>
          </div>
        }
      }
    </div>
  `,
})
export class PublicFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  protected readonly state = signal<PageState>('loading');
  private readonly pageMeta = inject(PublicPageMeta);
  protected readonly orgName = signal('Our organization');
  protected readonly form = signal<PublicForm | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  private readonly values = new Map<string, string>();
  private readonly checks = new Map<string, Set<string>>();

  protected readonly orgInitials = computed(() => {
    const parts = this.orgName().trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'pC';
  });

  public ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.state.set('notfound');
      this.pageMeta.setNotFound('form');
      return;
    }
    try {
      const res = await fetch(`${apiBase()}/api/forms/f/${encodeURIComponent(slug)}${tenantQuery()}`);
      if (res.status === 404) {
        this.state.set('notfound');
        this.pageMeta.setNotFound('form');
        return;
      }
      const data = await res.json();
      if (data?.orgName) this.orgName.set(String(data.orgName));
      if (data?.status === 'open' && data.form) {
        this.form.set(data.form as PublicForm);
        this.state.set('open');
      } else {
        this.state.set('closed');
      }
      // Tab title and share card, now that the org and form names are known.
      this.pageMeta.set(this.form()?.name ?? '', this.orgName(), this.form()?.description ?? undefined);
    } catch {
      this.state.set('notfound');
      this.pageMeta.setNotFound('form');
    }
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

  protected toggleCheck(key: string, opt: string): void {
    const set = this.checks.get(key) ?? new Set<string>();
    if (set.has(opt)) set.delete(opt);
    else set.add(opt);
    this.checks.set(key, set);
    this.values.set(key, Array.from(set).join(', '));
    if (this.errors()[key]) {
      this.errors.update((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
    }
  }

  protected async submit(): Promise<void> {
    const form = this.form();
    if (!form || this.submitting()) return;

    const errors: Record<string, string> = {};
    for (const field of form.fields) {
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

      const slug = this.route.snapshot.paramMap.get('slug') ?? '';
      const res = await fetch(`${apiBase()}/api/forms/submit/${encodeURIComponent(slug)}${tenantQuery()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.submitError.set(data?.error || 'Something went wrong. Please try again.');
        return;
      }
      // Assigning `window.location.href` is a raw navigation Angular's sanitizer never inspects,
      // so a `javascript:` or `data:` value coming back from the API would execute here. The
      // server filters this too; checking again at the sink is what makes the sink itself safe.
      // Anything refused falls through to the normal thank-you state rather than navigating.
      const redirect = safeRedirectUrl(data?.redirect_url);
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      this.state.set('thanks');
    } catch {
      this.submitError.set('Couldn’t reach the server. Check your connection and try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
