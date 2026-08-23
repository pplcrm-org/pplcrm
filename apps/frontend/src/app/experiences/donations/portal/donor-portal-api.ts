import { Injectable } from '@angular/core';

import { apiBase, tenantQuery } from '../../../shared/public-pages';

/**
 * The donor giving-portal REST client (public, tokenized — never tRPC, modeled on the companion
 * app's `companion-api.ts`). Every call is a plain fetch to `/api/donor-portal/*` with the `?t=`
 * tenant hint public pages always carry.
 *
 * Error contract: the backend answers HTTP 404 with one uniform body for every dead token —
 * missing, expired, and revoked look identical by design. Callers treat EVERY 404 as the
 * dead-link state; a network failure or 5xx is a transient error (status 0 / 5xx here), never
 * proof the link is dead.
 */

export type DonorPortalPledgeStatus = 'active' | 'past_due' | 'cancelled' | 'unpaid';
export type DonorPortalReceiptKind = 'acknowledgement' | 'per_gift' | 'cumulative' | 'statement';
export type DonorPortalSubscriptionStatus = 'subscribed' | 'unsubscribed' | 'pending';
export type DonorPortalYardSignStatus = 'new' | 'approved' | 'declined' | 'delivered';

export interface DonorPortalDonation {
  id: string;
  amount_cents: number;
  date: string;
  method: string;
  status: string;
  refunded_at: string | null;
}

export interface DonorPortalPledge {
  id: string;
  monthly_amount_cents: number;
  status: DonorPortalPledgeStatus;
  started_at: string;
  next_billing_date: string | null;
  cancelled_at: string | null;
  can_manage_card: boolean;
}

export interface DonorPortalReceipt {
  id: string;
  kind: DonorPortalReceiptKind;
  number: string | null;
  year: number | null;
  pdf_ready: boolean;
}

export interface DonorPortalAddress {
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface DonorPortalSubscription {
  campaign_id: string;
  campaign_name: string;
  status: DonorPortalSubscriptionStatus;
}

export interface DonorPortalSummary {
  org_name: string;
  first_name: string | null;
  donations: DonorPortalDonation[];
  pledges: DonorPortalPledge[];
  receipts: DonorPortalReceipt[];
  address: DonorPortalAddress | null;
  address_shared: boolean;
  subscriptions: DonorPortalSubscription[];
  email_suppressed: boolean;
  volunteer_interest: boolean;
  yard_sign: { status: DonorPortalYardSignStatus } | null;
}

export type DonorPortalReceiptDownload = { url: string } | { status: 'not_ready' };

export class DonorPortalApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 means the request never reached the server. */
    public readonly status: number,
  ) {
    super(message);
  }
}

/** True when this failure means the link itself is dead, not that the network hiccuped. */
export function isDeadLinkError(err: unknown): boolean {
  return err instanceof DonorPortalApiError && err.status === 404;
}

@Injectable({ providedIn: 'root' })
export class DonorPortalApiService {
  public cancelPledge(token: string, pledgeId: string): Promise<{ status: 'cancelled' }> {
    return this.post(`/${encodeURIComponent(token)}/pledges/${encodeURIComponent(pledgeId)}/cancel`);
  }

  /**
   * Confirm a finished Stripe card-update session. Not nested under a pledge: the return URL only
   * carries the session id, and the backend derives the pledge from the session's own metadata.
   */
  public confirmCardUpdate(token: string, sessionId: string): Promise<{ status: 'ok' }> {
    return this.post(`/${encodeURIComponent(token)}/card/confirm`, { session_id: sessionId });
  }

  public getReceiptDownload(token: string, receiptId: string): Promise<DonorPortalReceiptDownload> {
    return this.request(`/${encodeURIComponent(token)}/receipts/${encodeURIComponent(receiptId)}/download`);
  }

  public getSummary(token: string): Promise<DonorPortalSummary> {
    return this.request(`/${encodeURIComponent(token)}`);
  }

  /** Always answers `{ok:true}` on 200 whether or not the email matched anyone; 429 throws. */
  public requestLink(email: string): Promise<{ ok: true }> {
    return this.post('/request-link', { email });
  }

  public requestYardSign(token: string): Promise<{ status: 'requested' | 'already_open' | 'unavailable' }> {
    return this.post(`/${encodeURIComponent(token)}/yard-sign`);
  }

  public saveAddress(token: string, address: DonorPortalAddress): Promise<{ status: 'ok' }> {
    return this.post(`/${encodeURIComponent(token)}/address`, address);
  }

  public setPledgeAmount(
    token: string,
    pledgeId: string,
    monthlyAmountCents: number,
  ): Promise<{ status: 'ok'; monthly_amount_cents: number }> {
    return this.post(`/${encodeURIComponent(token)}/pledges/${encodeURIComponent(pledgeId)}/amount`, {
      monthly_amount_cents: monthlyAmountCents,
    });
  }

  public setSubscription(
    token: string,
    campaignId: string,
    status: 'subscribed' | 'unsubscribed',
  ): Promise<{ status: DonorPortalSubscriptionStatus }> {
    return this.post(`/${encodeURIComponent(token)}/subscriptions/${encodeURIComponent(campaignId)}`, { status });
  }

  /** Returns the absolute Stripe URL to hand to the redirect sink (after `safeRedirectUrl`). */
  public startCardUpdate(token: string, pledgeId: string): Promise<{ url: string }> {
    return this.post(`/${encodeURIComponent(token)}/pledges/${encodeURIComponent(pledgeId)}/card`);
  }

  public volunteerInterest(token: string): Promise<{ volunteer_interest: true }> {
    return this.post(`/${encodeURIComponent(token)}/volunteer-interest`);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/donor-portal${path}${tenantQuery()}`, init);
    } catch {
      throw new DonorPortalApiError('Could not reach the server', 0);
    }
    if (!res.ok) {
      throw new DonorPortalApiError('Request failed', res.status);
    }
    return (await res.json().catch(() => ({}))) as T;
  }
}
