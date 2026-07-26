import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';

import { AuthService } from '../../auth/auth-service';
import { GoLiveService, type GoLiveStepId } from '../go-live/go-live.service';

const STEP_COPY: Record<GoLiveStepId, { label: string; why: string }> = {
  plan: { label: 'Choose a plan', why: 'Needed before the demo data can be removed' },
  organization: { label: 'Add your mailing address', why: 'Required by law in every newsletter footer' },
  phone: { label: 'Verify your mobile number', why: 'A one-time check before your first send' },
  sending: { label: 'Set up sending', why: 'Newsletters stay locked until this is done' },
  demo: { label: 'Remove the demo data', why: 'Your workspace still holds sample records' },
  people: { label: 'Bring in your people', why: 'Import a spreadsheet or add contacts one at a time' },
  team: { label: 'Invite your team', why: 'Optional' },
};

/**
 * The dashboard's setup checklist: what is still standing between this workspace and being able
 * to use it properly, and one link into the wizard for each.
 *
 * Deliberately NOT dismissible, unlike the getting-started card it replaces. Everything it lists
 * is a real blocker — a plan, the postal address the compliance footer needs, phone verification,
 * a sending identity, the demo data still sitting in the workspace. "Hide this" on "your
 * newsletters cannot send" would be suppression dressed up as tidiness. It disappears on its own
 * the moment the last item is genuinely done, which also retires the old localStorage dismissal
 * that only ever applied to one browser.
 *
 * Hidden during demo mode, where the demo card already owns this conversation.
 */
@Component({
  selector: 'pc-getting-started-card',
  imports: [Icon, RouterLink],
  template: `
    @if (visible()) {
      <div class="animate-drop card mb-5 border border-base-200 bg-base-100 shadow-sm">
        <div class="card-body gap-3 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="pc-eyebrow">Finish setting up · {{ items().length }} left</div>
            <a routerLink="/go-live" class="btn btn-primary btn-sm">Continue setup</a>
          </div>

          <ul class="flex flex-col gap-2.5">
            @for (item of items(); track item.id) {
              <li class="flex items-start gap-2.5">
                <pc-icon
                  [name]="item.deferred ? 'exclamation-triangle' : 'chevron-right'"
                  [size]="5"
                  class="mt-px shrink-0"
                  [class]="item.deferred ? 'text-warning' : 'text-primary'"
                ></pc-icon>
                <span class="min-w-0">
                  <a routerLink="/go-live" class="text-sm font-semibold text-primary hover:underline">
                    {{ item.label }}
                  </a>
                  <span class="block text-xs text-base-content/55">
                    {{ item.deferred ? 'You saved this for later. ' + item.why : item.why }}
                  </span>
                </span>
              </li>
            }
          </ul>
        </div>
      </div>
    }
  `,
})
export class GettingStartedCard {
  private readonly goLive = inject(GoLiveService);
  private readonly auth = inject(AuthService);

  private readonly user = this.auth.getUserSignal();
  private readonly isDemo = computed(() => !!this.user()?.tenant_demo_mode_at);

  protected readonly items = computed(() => {
    const deferred = this.goLive.state().deferred;
    return this.goLive.outstanding().map((id) => ({
      id,
      label: STEP_COPY[id].label,
      why: STEP_COPY[id].why,
      deferred: deferred.includes(id),
    }));
  });

  protected readonly visible = computed(() => !this.isDemo() && this.items().length > 0);

  constructor() {
    // Load outside demo mode, and again the moment the demo flag clears, so the list reflects the
    // emptied workspace rather than the seeded counts.
    effect(() => {
      if (!this.isDemo()) void this.goLive.load();
    });
  }
}
