import { createHmac, timingSafeEqual } from 'crypto';

import { env } from '../../../env';

// Automation emails are marketing-content mail, so each one carries a per-recipient
// unsubscribe link. The link must be unforgeable (it flips consent for a specific person)
// and must keep working indefinitely — an email can sit in an inbox for months — so unlike
// oauth-state tokens (lib/oauth-state.ts, same HMAC shape) it deliberately has NO TTL.
// Compromise requires the server secret; the token grants nothing but "unsubscribe me".

export interface UnsubscribeTokenPayload {
  tenantId: string;
  personId: string;
  email: string;
  /**
   * Scope of the opt-out. A newsletter belongs to exactly one campaign, so its one-click
   * unsubscribe must stop only that campaign — the same thing the footer link does (SendGrid's
   * unsubscribe event flips just that campaign, see newsletters-webhook.route). An automation is
   * not campaign-scoped, so it omits this and the route falls back to stopping every campaign.
   *
   * Optional so tokens minted before this field still decode: an old link in an inbox keeps
   * working and keeps its original organization-wide meaning.
   */
  campaignId?: string;
}

function sign(data: string): string {
  return createHmac('sha256', env.sharedSecret).update(`unsubscribe:${data}`).digest('base64url');
}

/** Produce a signed unsubscribe token for one recipient of one tenant's automation email. */
export function encodeUnsubscribeToken(payload: UnsubscribeTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

/** Verify and decode an unsubscribe token. Null on any tamper/malformation — callers MUST 404. */
export function decodeUnsubscribeToken(raw: string | undefined | null): UnsubscribeTokenPayload | null {
  if (!raw || typeof raw !== 'string' || raw.length > 2048) return null;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const data = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  const expectedSig = sign(data);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: UnsubscribeTokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.tenantId || !parsed.personId || !parsed.email) return null;

  return {
    tenantId: String(parsed.tenantId),
    personId: String(parsed.personId),
    email: String(parsed.email),
    ...(parsed.campaignId ? { campaignId: String(parsed.campaignId) } : {}),
  };
}
