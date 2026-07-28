import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../services/settings-service';

/** What the workspace can safely be told about one of its keys: never the key itself. */
interface ApiKeyInfo {
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  preview: string;
  slot: number;
}

/** Mirrors MAX_KEYS_PER_TENANT on the server, where the database constraint actually enforces it. */
const MAX_KEYS = 2;

/**
 * Workspace API key settings.
 *
 * The section title and blurb come from the settings shell (settings-page.ts, id 'api-keys'), so
 * this renders the keys and nothing else.
 *
 * Two keys, not one, because rotation used to be strictly destructive: the old "Regenerate"
 * replaced the key in place, so every integration broke the instant it was clicked and stayed
 * broken until someone pasted the new value everywhere. With two slots the flow is the standard
 * overlap — create the second key, move integrations across, revoke the first — and no request
 * ever fails. That is why there is no regenerate button any more; it was the outage.
 */
@Component({
  selector: 'pc-api-keys-settings',
  imports: [Icon, DatePipe, EmptyState],
  template: `
    @if (!loaded()) {
      <div class="skeleton h-48 w-full max-w-2xl"></div>
    } @else {
      <div class="flex max-w-2xl flex-col gap-4">
        @if (keys().length) {
          @for (key of keys(); track key.slot) {
            <div class="rounded-box border-base-300 bg-base-100 border p-5">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="text-xs font-medium opacity-60">Key {{ key.slot }}</div>
                  <code class="bg-base-200 mt-1.5 inline-block rounded px-2.5 py-1.5 font-mono text-xs break-all">
                    {{ key.preview }}***
                  </code>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost text-error"
                  [disabled]="busy()"
                  (click)="onRevoke(key)"
                  [attr.aria-label]="'Revoke key ' + key.slot"
                >
                  <pc-icon name="trash-forever" [size]="4" />
                  Revoke
                </button>
              </div>

              <dl class="border-base-300 mt-4 flex flex-col gap-2 border-t pt-4 text-xs">
                <div class="flex justify-between gap-4">
                  <dt class="opacity-60">Created</dt>
                  <dd class="font-medium">{{ key.createdAt | date: 'MMM d, y' }}</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="opacity-60">Last used</dt>
                  <dd class="font-medium">
                    @if (key.lastUsedAt) {
                      {{ key.lastUsedAt | date: 'MMM d, y · h:mm a' }}
                    } @else {
                      <!-- The single most useful fact when deciding which half of a rotation is safe to revoke. -->
                      <span class="opacity-60">Never</span>
                    }
                  </dd>
                </div>
              </dl>
            </div>
          }

          @if (newKey(); as raw) {
            <div role="alert" class="alert alert-warning items-start text-left">
              <pc-icon name="exclamation-triangle" [size]="5" />
              <div class="flex min-w-0 flex-col gap-2">
                <div>
                  <p class="text-xs font-semibold">Save your new API key</p>
                  <p class="mt-0.5 text-xs opacity-80">
                    This is the only time it will be shown. Store it somewhere safe — it cannot be retrieved again.
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <code class="bg-base-100 text-base-content rounded px-2.5 py-1.5 font-mono text-xs break-all">
                    {{ raw }}
                  </code>
                  <button type="button" class="btn btn-xs" (click)="onCopy()">
                    <pc-icon name="document-duplicate" [size]="4" />
                    Copy
                  </button>
                </div>
              </div>
            </div>
          }

          @if (canCreate()) {
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn-sm btn-secondary" [disabled]="busy()" (click)="onCreate()">
                <pc-icon name="plus" [size]="4" />
                {{ creating() ? 'Creating…' : 'Add a second key' }}
              </button>
              <span class="text-xs opacity-60">
                To rotate without downtime: add a second key, move your integrations onto it, then revoke the old one.
              </span>
            </div>
          } @else {
            <p class="text-xs opacity-60">
              A workspace can hold {{ maxKeys }} keys. Revoke one to make room for a replacement.
            </p>
          }

          <p class="text-xs opacity-60">
            Treat these like passwords. They belong on your own server — never in a public web page.
          </p>
        } @else {
          <pc-empty-state
            icon="lock-closed"
            title="No API keys yet"
            hint="Create one to submit form responses, event RSVPs and volunteer signups from your own backend, or to connect Zapier."
          >
            <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="onCreate()">
              <pc-icon name="plus" [size]="4" />
              {{ creating() ? 'Creating…' : 'Create key' }}
            </button>
          </pc-empty-state>
        }
      </div>
    }
  `,
})
export class ApiKeysSettingsComponent implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly settingsSvc = inject(SettingsService);

  private readonly _loading = createLoadingGate();

  protected readonly creating = signal(false);
  protected readonly keys = signal<ApiKeyInfo[]>([]);
  protected readonly loaded = this._loading.loaded;
  protected readonly maxKeys = MAX_KEYS;
  /** The raw key, held only for as long as the page is open — see the banner above. */
  protected readonly newKey = signal('');
  protected readonly revoking = signal(false);

  protected readonly canCreate = computed(() => this.keys().length < MAX_KEYS);

  public ngOnInit(): void {
    void this.refresh();
  }

  protected busy(): boolean {
    return this.creating() || this.revoking();
  }

  protected async onCopy(): Promise<void> {
    const key = this.newKey();
    if (!key) return;

    try {
      await navigator.clipboard.writeText(key);
      this.alerts.showSuccess('API key copied to clipboard');
    } catch {
      // Clipboard access can be denied outright; the key is on screen either way.
      this.alerts.showError('Could not copy the key — select it and copy manually');
    }
  }

  protected async onCreate(): Promise<void> {
    this.creating.set(true);
    try {
      const result = await this.settingsSvc.createApiKey();
      this.newKey.set(result.key);
      this.alerts.showSuccess('API key created');
      await this.refresh();
    } catch {
      // Swallowed on purpose: the tRPC error link (trpc-service.ts) has already shown the server's
      // message, which is more specific than anything we could add here — "API access requires the
      // Grassroots plan" beats "Could not create the API key". Re-toasting produced two alerts for
      // one failure. Caught rather than left to reject so it does not surface a third time as an
      // unhandled rejection.
    } finally {
      this.creating.set(false);
    }
  }

  protected async onRevoke(key: ApiKeyInfo): Promise<void> {
    // Name the risk precisely: revoking the key nothing has ever called is safe, revoking one in
    // active service is an outage. The component knows which is which, so it should say so.
    const stillInUse = key.lastUsedAt != null;
    const confirmed = await this.dialogs.confirm({
      title: `Revoke key ${key.slot}?`,
      message: stillInUse
        ? 'This key has been used recently and stops working immediately. Anything still calling the API with it — including Zapier — will fail. Move those integrations onto your other key first.'
        : 'This key has never been used, so revoking it should not affect anything. It stops working immediately and cannot be recovered.',
      variant: 'danger',
      confirmText: 'Revoke',
    });
    if (!confirmed) return;

    this.revoking.set(true);
    try {
      await this.settingsSvc.revokeApiKey(key.slot);
      this.newKey.set('');
      this.alerts.showSuccess('API key revoked');
      await this.refresh();
    } catch {
      // See onCreate: the tRPC error link already toasted the server's message.
    } finally {
      this.revoking.set(false);
    }
  }

  private async refresh(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.keys.set(await this.settingsSvc.listApiKeys());
    } catch {
      // See onCreate: the tRPC error link already toasted. The panel falls back to the empty
      // state, which is honest — we genuinely do not know what keys exist.
    } finally {
      end();
    }
  }
}
