import { Component, type OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import { getUserErrorMessage } from '../../../services/api/user-message';
import { CanvassingService } from '../services/canvassing-service';

import type { LocationPrecision } from '@common';

const MAX_ISSUES = 30;

/**
 * Companion survey settings (COMPANION-APPS-PLAN.md §5): the issue-chip
 * vocabulary and the collapsible door script every Companion survey shows —
 * campaign-scoped, stored on the write campaign.
 */
@Component({
  selector: 'pc-companion-settings-dialog',
  imports: [FormsModule, Icon],
  template: `
    <dialog class="modal" [open]="true">
      <div class="modal-box flex max-w-md flex-col gap-4">
        <h3 class="text-sm font-semibold">Companion survey settings</h3>
        @if (campaignName()) {
          <p class="text-xs text-base-content/60">
            Applies to every Companion working a turf cut for {{ campaignName() }}.
          </p>
        }

        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium">Top issues (survey chips)</span>
          <div class="flex flex-wrap gap-1.5">
            @for (issue of issues(); track issue) {
              <span class="badge badge-ghost gap-1">
                {{ issue }}
                <button
                  type="button"
                  class="opacity-60 hover:opacity-100"
                  (click)="removeIssue(issue)"
                  [attr.aria-label]="'Remove ' + issue"
                >
                  <pc-icon name="x-mark" [size]="3" />
                </button>
              </span>
            } @empty {
              <span class="text-xs text-base-content/50">No issues yet. Canvassers see no issue chips.</span>
            }
          </div>
          <input
            class="input input-bordered input-sm w-full"
            type="text"
            placeholder="Add an issue and press Enter…"
            aria-label="Add an issue"
            [ngModel]="draft()"
            (ngModelChange)="draft.set($event)"
            (keydown.enter)="addIssue($event)"
            [disabled]="issues().length >= maxIssues"
          />
        </div>

        <label class="flex flex-col gap-2">
          <span class="text-xs font-medium">Door script (shown collapsed at the top of the survey)</span>
          <textarea
            class="textarea textarea-bordered h-28 w-full text-xs"
            placeholder="Hi, I'm {name} with {campaign}. Do you have a minute to talk about the issues that matter to you?"
            [ngModel]="script()"
            (ngModelChange)="script.set($event)"
          ></textarea>
        </label>

        <label class="flex flex-col gap-2">
          <span class="text-xs font-medium">Live location detail (the Live tab)</span>
          <select
            class="select select-bordered select-sm w-full"
            [ngModel]="precision()"
            (ngModelChange)="precision.set($event)"
            aria-label="Live location detail"
          >
            <option value="street">Street level — dots and today's path on the map</option>
            <option value="turf">Turf level — who is on which turf, no positions</option>
          </select>
          <span class="text-xs text-base-content/50">
            Either way, coordinates are deleted at midnight and volunteers see a sharing banner the whole shift.
          </span>
        </label>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost btn-sm" (click)="closed.emit()">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="saving()" (click)="save()">
            @if (saving()) {
              Saving…
            } @else {
              Save settings
            }
          </button>
        </div>
      </div>
      <div class="modal-backdrop" (click)="closed.emit()"></div>
    </dialog>
  `,
})
export class CompanionSettingsDialog implements OnInit {
  public readonly closed = output<void>();

  protected readonly campaignName = signal('');
  protected readonly draft = signal('');
  protected readonly issues = signal<string[]>([]);
  protected readonly maxIssues = MAX_ISSUES;
  protected readonly precision = signal<LocationPrecision>('street');
  protected readonly saving = signal(false);

  private readonly alerts = inject(AlertService);
  private campaignId: string | undefined;
  private readonly svc = inject(CanvassingService);

  public ngOnInit(): void {
    void this.load();
  }

  protected addIssue(event: Event): void {
    event.preventDefault();
    const value = this.draft().trim();
    if (!value || this.issues().includes(value) || this.issues().length >= MAX_ISSUES) return;
    this.issues.set([...this.issues(), value]);
    this.draft.set('');
  }

  protected removeIssue(issue: string): void {
    this.issues.set(this.issues().filter((i) => i !== issue));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.svc.updateCompanionSettings({
        campaign_id: this.campaignId,
        issues: this.issues(),
        script: this.script().trim() || null,
        location_precision: this.precision(),
      });
      this.alerts.showSuccess('Saved. Companions pick this up on their next sync');
      this.closed.emit();
    } catch (err) {
      // The server's own sentence matters here: saving these settings is admin-or-owner, and
      // "Try again" is false for an editor who can never succeed (§3, fail specifically).
      this.alerts.showError(getUserErrorMessage(err, 'Could not save settings. Try again'));
    } finally {
      this.saving.set(false);
    }
  }

  protected readonly script = signal('');

  private async load(): Promise<void> {
    try {
      const settings = await this.svc.getCompanionSettings();
      this.campaignId = settings.campaign_id;
      this.campaignName.set(settings.campaign_name);
      this.issues.set(settings.issues);
      this.script.set(settings.script);
      this.precision.set(settings.location_precision);
    } catch {
      this.alerts.showError('Could not load settings');
      this.closed.emit();
    }
  }
}
