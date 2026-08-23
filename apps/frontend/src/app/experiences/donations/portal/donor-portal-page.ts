import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Alerts } from '@uxcommon/components/alerts/alerts';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { PublicPageMeta } from '../../../shared/public-page-meta';
import { DonorAddressForm } from './donor-address-form';
import { DonorGetInvolved } from './donor-get-involved';
import { DonorGivingHistory } from './donor-giving-history';
import { DonorPledgeCard } from './donor-pledge-card';
import { DonorPortalApiService, DonorPortalSummary, isDeadLinkError } from './donor-portal-api';
import { DonorPreferences } from './donor-preferences';

type PageState = 'loading' | 'open' | 'dead' | 'error';

/**
 * The donor self-service portal at /g/:token — a public, tokenized page outside the auth shell
 * (like /f/:slug). Orchestrates the section components around one summary fetch; every 404 from
 * the API means the link is dead (expired, revoked, or never real — indistinguishable by design),
 * while network failures and 5xx get a Try-again error state instead.
 *
 * Renders its own <pc-alerts>: the toast host lives in the app shell, which public pages are
 * deliberately outside of.
 */
@Component({
  selector: 'pc-donor-portal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alerts,
    RouterLink,
    DonorPledgeCard,
    DonorGivingHistory,
    DonorAddressForm,
    DonorPreferences,
    DonorGetInvolved,
  ],
  templateUrl: './donor-portal-page.html',
})
export class DonorPortalPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly api = inject(DonorPortalApiService);
  private readonly alerts = inject(AlertService);
  private readonly pageMeta = inject(PublicPageMeta);

  private readonly _loading = createLoadingGate();
  protected readonly loadingVisible = this._loading.visible;

  protected readonly state = signal<PageState>('loading');
  protected readonly summary = signal<DonorPortalSummary | null>(null);
  protected readonly token = signal('');

  protected readonly orgName = computed(() => this.summary()?.org_name ?? 'Our organization');

  protected readonly orgInitials = computed(() => {
    const parts = this.orgName().trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'pC';
  });

  /** The email-preferences card earns its place only when there is something honest to show. */
  protected readonly showPreferences = computed(() => {
    const s = this.summary();
    return !!s && (s.subscriptions.length > 0 || s.email_suppressed);
  });

  public ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.token.set(token);
    if (!token) {
      this.state.set('dead');
      this.pageMeta.setNotFound('page');
      return;
    }
    void this.init(token);
  }

  /** A section component saw a 404 mid-session — the link was revoked or expired under us. */
  protected onLinkDead(): void {
    this.state.set('dead');
    this.pageMeta.setNotFound('page');
  }

  protected retry(): void {
    this.state.set('loading');
    void this.load(this.token());
  }

  private async confirmCardSessionIfPresent(token: string): Promise<void> {
    const sessionId = this.route.snapshot.queryParamMap.get('card_session_id');
    if (!sessionId) return;

    try {
      await this.api.confirmCardUpdate(token, sessionId);
      this.alerts.showSuccess('Your card has been updated.');
    } catch (err) {
      // A dead link surfaces on the summary load right after; anything else is worth a toast.
      if (!isDeadLinkError(err)) {
        this.alerts.showError('We could not confirm your card update. Try again.');
      }
    }

    // Strip the one-shot param either way (a reload must not re-confirm), keeping any other
    // query params — the dev fallback URL carries ?t=<slug>.
    const params = new URLSearchParams(window.location.search);
    params.delete('card_session_id');
    const qs = params.toString();
    this.location.replaceState(window.location.pathname + (qs ? `?${qs}` : ''));
  }

  private async init(token: string): Promise<void> {
    await this.confirmCardSessionIfPresent(token);
    await this.load(token);
  }

  private async load(token: string): Promise<void> {
    const end = this._loading.begin();
    try {
      const summary = await this.api.getSummary(token);
      this.summary.set(summary);
      this.state.set('open');
      this.pageMeta.set('Your giving', summary.org_name);
      // Personal page: never let it into a search index, even though the link is public.
      this.pageMeta.markPrivate();
    } catch (err) {
      if (isDeadLinkError(err)) {
        this.state.set('dead');
        this.pageMeta.setNotFound('page');
      } else {
        this.state.set('error');
        this.pageMeta.markPrivate();
      }
    } finally {
      end();
    }
  }
}
