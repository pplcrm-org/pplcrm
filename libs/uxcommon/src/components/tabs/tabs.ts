import { Component, computed, input, model } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface PcTabOption {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
  tooltip?: string;
  /** When set, the pill renders as a router link (page-level tabs that navigate) instead of a stateful button. */
  route?: string;
  /** Match the route exactly for the active state (default false). */
  exact?: boolean;
}

/** Which of the two house tab looks a bar renders in. */
export type PcTabVariant = 'pill' | 'underline';

const PILL_ROW = 'flex flex-wrap gap-2';
const PILL_BASE =
  'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors focus:outline-none';
const PILL_ACTIVE = 'border-primary/30 bg-primary/10 text-primary';
const PILL_INACTIVE = 'border-base-200 bg-base-100 text-base-content/70';
const PILL_BADGE_ACTIVE = 'rounded-full px-1.5 text-xs font-semibold tabular-nums bg-primary/20 text-primary';
const PILL_BADGE_INACTIVE = 'rounded-full px-1.5 text-xs font-semibold tabular-nums bg-base-200 text-base-content/50';

const UNDERLINE_ROW = 'flex flex-wrap items-center gap-1 border-b border-base-300';
// The base carries no border/text color: those come from the state classes below, because two
// competing color utilities on one element resolve by stylesheet order, not by class order.
const UNDERLINE_BASE =
  '-mb-px flex items-center gap-1.5 border-b-2 bg-transparent px-3 py-2 text-[13px] tracking-[0.03em] transition-colors focus:outline-none';
const UNDERLINE_ACTIVE = 'border-primary font-semibold text-primary';
const UNDERLINE_INACTIVE = 'border-transparent text-base-content/70 hover:text-primary';
const UNDERLINE_BADGE = 'text-xs tabular-nums opacity-70';

/**
 * The house tab bar (design §4) in its two looks, with count badges ("numbers before
 * clicks", §1). Stateful tabs bind `[(activeTab)]`; tabs that navigate set `route` on the
 * option instead.
 *
 * - `variant="underline"` (the grain-tabs look) is for **surface switching** — the tabs that
 *   swap which dataset or page you are looking at (People / Households / Companies,
 *   Forms / Responses, Requests / Routes).
 * - `variant="pill"` (the default) is for tabs **within** one record or view — the person
 *   view's sections, a status filter row over a list.
 */
@Component({
  selector: 'pc-tab-bar',
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'block' },
  template: `
    <div role="tablist" [class]="rowClass()" [attr.aria-label]="label() || null">
      @for (tab of tabs(); track tab.id) {
        @if (tab.route) {
          <a
            role="tab"
            [routerLink]="tab.route"
            [routerLinkActive]="activeLinkClass()"
            [routerLinkActiveOptions]="{ exact: tab.exact ?? false }"
            [class]="linkClass()"
          >
            <span>{{ tab.label }}</span>
            @if (tab.badge !== undefined && tab.badge !== null) {
              <span [class]="badgeClass(false)">{{ tab.badge }}</span>
            }
          </a>
        } @else {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="activeTab() === tab.id"
            [attr.aria-disabled]="tab.disabled || null"
            [class]="tabClass(tab)"
            [class.tooltip]="tab.disabled && tab.tooltip"
            [attr.data-tip]="tab.disabled && tab.tooltip ? tab.tooltip : null"
            (click)="!tab.disabled && selectTab(tab.id)"
          >
            <span>{{ tab.label }}</span>
            @if (tab.badge !== undefined && tab.badge !== null) {
              <span [class]="badgeClass(activeTab() === tab.id)">{{ tab.badge }}</span>
            }
          </button>
        }
      }
    </div>
  `,
})
export class TabBar {
  public tabs = input.required<PcTabOption[]>();
  public activeTab = model<string>('');
  public variant = input<PcTabVariant>('pill');
  /** Accessible name for the tablist (what this row switches between). */
  public label = input<string>('');

  protected readonly rowClass = computed(() => (this.variant() === 'underline' ? UNDERLINE_ROW : PILL_ROW));

  /** Classes routerLinkActive adds on the matching route; `!` so they beat the base state. */
  protected readonly activeLinkClass = computed(() =>
    this.variant() === 'underline'
      ? '!border-primary !font-semibold !text-primary'
      : '!border-primary/30 !bg-primary/10 !text-primary',
  );

  protected readonly linkClass = computed(() =>
    this.variant() === 'underline'
      ? `${UNDERLINE_BASE} ${UNDERLINE_INACTIVE} cursor-pointer`
      : `${PILL_BASE} ${PILL_INACTIVE} cursor-pointer hover:bg-base-200/60`,
  );

  protected badgeClass(active: boolean): string {
    if (this.variant() === 'underline') return UNDERLINE_BADGE;
    return active ? PILL_BADGE_ACTIVE : PILL_BADGE_INACTIVE;
  }

  protected selectTab(id: string): void {
    this.activeTab.set(id);
  }

  protected tabClass(tab: PcTabOption): string {
    const active = this.activeTab() === tab.id;
    const cursor = tab.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer';
    if (this.variant() === 'underline') {
      return `${UNDERLINE_BASE} ${active ? UNDERLINE_ACTIVE : UNDERLINE_INACTIVE} ${cursor}`;
    }
    const hover = !tab.disabled && !active ? 'hover:bg-base-200/60' : '';
    return `${PILL_BASE} ${active ? PILL_ACTIVE : PILL_INACTIVE} ${cursor} ${hover}`;
  }
}

/** Pill tab bar + the standard content card (the person-view composition) with projected pc-tab-panels. */
@Component({
  selector: 'pc-tabs',
  imports: [TabBar],
  host: { class: 'flex flex-grow flex-col gap-6' },
  template: `
    <pc-tab-bar [tabs]="tabs()" [(activeTab)]="activeTab" [variant]="variant()" />
    <div class="card rounded-2xl border border-base-200 bg-base-100 p-6 shadow-sm">
      <ng-content></ng-content>
    </div>
  `,
})
export class Tabs {
  public tabs = input.required<PcTabOption[]>();
  public activeTab = model.required<string>();
  public variant = input<PcTabVariant>('pill');
}

@Component({
  selector: 'pc-tab-panel',
  template: `
    @if (isActive()) {
      <div class="space-y-4">
        <ng-content></ng-content>
      </div>
    }
  `,
})
export class TabPanel {
  public id = input.required<string>();
  public activeTab = input.required<string>();

  protected isActive = computed(() => this.activeTab() === this.id());
}
