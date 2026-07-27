import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal, WritableSignal } from '@angular/core';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../services/settings-service';

/** What the workspace can safely be told about its own key: never the key itself. */
interface ApiKeyInfo {
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  preview: string;
}

/**
 * Workspace API key settings.
 *
 * The section title and blurb come from the settings shell (settings-page.ts, id 'api-keys'),
 * so this renders the key itself and nothing else — repeating the heading here is what made the
 * panel read as two stacked descriptions of the same thing.
 *
 * Styling is DaisyUI utilities only. This component previously carried ~240 lines of its own CSS
 * that redefined `.btn`/`.btn-primary`/`.btn-secondary` and coloured everything with
 * `hsl(var(--base-content))` — a DaisyUI v3/v4 variable name. v5 exposes `--color-base-content`,
 * so every one of those declarations was invalid and silently dropped, while the local `.btn`
 * rules still won over the real ones. That is why the buttons looked nothing like the rest of
 * the app: they were genuinely not DaisyUI buttons.
 */
@Component({
  selector: 'pc-api-keys-settings',
  imports: [Icon, DatePipe, EmptyState],
  template: `
    @if (!loaded()) {
      <div class="skeleton h-48 w-full max-w-2xl"></div>
    } @else {
      <div class="flex max-w-2xl flex-col gap-4">
        @if (keyInfo(); as key) {
          <div class="rounded-box border-base-300 bg-base-100 border p-5">
            <div class="text-xs font-medium opacity-60">Current key</div>
            <code class="bg-base-200 mt-1.5 inline-block rounded px-2.5 py-1.5 font-mono text-xs break-all">
              {{ key.preview }}***
            </code>

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
                    <span class="opacity-60">Never</span>
                  }
                </dd>
              </div>
            </dl>

            <div class="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" class="btn btn-sm btn-secondary" [disabled]="busy()" (click)="onRegenerate()">
                <pc-icon name="arrow-path" [size]="4" />
                {{ regenerating() ? 'Regenerating…' : 'Regenerate key' }}
              </button>
              <!--
                Quiet and ghost on purpose: regenerate is the right answer to a leaked key,
                because it keeps integrations working. Revoke is the rarer "we are done with
                the API" action and must not read as the safer of the two.
              -->
              <button type="button" class="btn btn-sm btn-ghost text-error" [disabled]="busy()" (click)="onRevoke()">
                <pc-icon name="trash-forever" [size]="4" />
                {{ revoking() ? 'Revoking…' : 'Revoke key' }}
              </button>
            </div>
          </div>

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

          <p class="text-xs opacity-60">
            Treat this key like a password. It belongs on your own server — never in a public web page.
          </p>
        } @else {
          <pc-empty-state
            icon="lock-closed"
            title="No API key yet"
            hint="Generate one to submit form responses, event RSVPs and volunteer signups from your own backend, or to connect Zapier."
          >
            <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="onGenerate()">
              <pc-icon name="plus" [size]="4" />
              {{ generating() ? 'Generating…' : 'Generate key' }}
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

  protected readonly generating = signal(false);
  protected readonly keyInfo = signal<ApiKeyInfo | null>(null);
  protected readonly loaded = this._loading.loaded;
  /** The raw key, held only for as long as the page is open — see the banner above. */
  protected readonly newKey = signal('');
  protected readonly regenerating = signal(false);
  protected readonly revoking = signal(false);

  public ngOnInit(): void {
    void this.refresh();
  }

  protected busy(): boolean {
    return this.generating() || this.regenerating() || this.revoking();
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

  protected async onGenerate(): Promise<void> {
    await this.issueKey(this.generating, () => this.settingsSvc.generateApiKey(), 'API key generated');
  }

  protected async onRegenerate(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Regenerate API key',
      message:
        'The current key stops working immediately. Every integration using it will fail until you update it with the new key.',
      variant: 'danger',
      confirmText: 'Regenerate',
    });
    if (!confirmed) return;

    await this.issueKey(this.regenerating, () => this.settingsSvc.regenerateApiKey(), 'API key regenerated');
  }

  protected async onRevoke(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Revoke API key',
      message:
        'The key stops working immediately and is not replaced. Anything calling the API — including Zapier — will fail until you generate a new key.',
      variant: 'danger',
      confirmText: 'Revoke',
    });
    if (!confirmed) return;

    this.revoking.set(true);
    try {
      await this.settingsSvc.revokeApiKey();
      this.newKey.set('');
      this.keyInfo.set(null);
      this.alerts.showSuccess('API key revoked');
    } catch (err) {
      this.alerts.showError(this.messageFor(err, 'Could not revoke the API key'));
    } finally {
      this.revoking.set(false);
    }
  }

  /** Generate and regenerate differ only in which endpoint they call and what they are named. */
  private async issueKey(
    flag: WritableSignal<boolean>,
    call: () => Promise<{ key: string; preview: string }>,
    success: string,
  ): Promise<void> {
    flag.set(true);
    try {
      const result = await call();
      this.newKey.set(result.key);
      this.alerts.showSuccess(success);
      await this.refresh();
    } catch (err) {
      this.alerts.showError(this.messageFor(err, 'Could not issue the API key'));
    } finally {
      flag.set(false);
    }
  }

  private messageFor(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? `${fallback}: ${err.message}` : fallback;
  }

  private async refresh(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.keyInfo.set(await this.settingsSvc.getApiKeyPreview());
    } catch (err) {
      this.alerts.showError(this.messageFor(err, 'Could not load the API key'));
    } finally {
      end();
    }
  }
}
