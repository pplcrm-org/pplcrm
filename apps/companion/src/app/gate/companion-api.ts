import { Injectable, signal } from '@angular/core';

import type {
  CompanionAccessKind,
  CompanionAccessPayload,
  CompanionApprovalPayload,
  CompanionJoinStartResult,
  CompanionJoinStartType,
  CompanionOrganizerPayload,
  CompanionVerifyChannel,
  CompanionVerifyConfirmResult,
  CompanionVerifyKind,
} from '@common';

/**
 * The companion device session + access-gate API client. All calls are
 * relative `/api` REST (dev proxy / same-domain prod) — this app never uses
 * tRPC. The session token lives in localStorage so the volunteer stays
 * verified across visits on the same phone; it is sent on every companion
 * data request via the X-Companion-Session header.
 */

const SESSION_KEY = 'pc-companion-session';

export class CompanionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Client-side marker for "couldn't reach the server". Distinct from the
 * backend's authoritative 'dead': the access endpoint answers 200 for every
 * resolved outcome (including `{ state: 'dead' }`), so a non-ok response (edge
 * 503 during a deploy, 429 rate limit, proxy 5xx) or a network throw is a
 * transient failure on a phone with poor signal, never proof the link is dead.
 */
export interface CompanionAccessUnreachable {
  state: 'unreachable';
}

export type CompanionAccessResult = CompanionAccessPayload | CompanionAccessUnreachable;

interface StoredSession {
  token: string;
  expiresAt: string;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    if (new Date(parsed.expiresAt) <= new Date()) return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Something went wrong. Try again.';
    throw new CompanionApiError(message, res.status);
  }
  return payload as T;
}

@Injectable({ providedIn: 'root' })
export class CompanionSessionService {
  /** Current device-session token (null until verified on this device). */
  public readonly sessionToken = signal<string | null>(readStoredSession()?.token ?? null);

  public clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
    this.sessionToken.set(null);
  }

  /**
   * Resolve what the gate should render for this link. Only a 200 body may
   * declare a link dead; any non-ok response or network failure comes back as
   * the transient 'unreachable' state so the gate can retry instead of showing
   * the dead-link screen.
   */
  public async getAccess(kind: CompanionAccessKind, token: string | null): Promise<CompanionAccessResult> {
    // 'session' carries no token — the X-Companion-Session header is the whole request.
    const params = new URLSearchParams(token ? { kind, token } : { kind });
    try {
      const res = await fetch(`/api/companion/access?${params}`, { headers: this.headers() });
      if (!res.ok) return { state: 'unreachable' };
      return (await res.json()) as CompanionAccessPayload;
    } catch {
      return { state: 'unreachable' };
    }
  }

  /**
   * Introduce yourself after scanning a join QR.
   *
   * Returns a one-shot `claim` that stands in for the capability link this path never
   * had — the code names an organization, the claim names the person we just matched or
   * created. Verification then runs exactly as it does for a link.
   */
  public joinStart(input: CompanionJoinStartType): Promise<CompanionJoinStartResult> {
    return post<CompanionJoinStartResult>('/api/companion/join/start', input);
  }

  /** What an admin sees before tapping approve, straight from an SMS with no session. */
  public async getApproval(token: string): Promise<CompanionApprovalPayload> {
    const res = await fetch(`/api/companion/approve/${encodeURIComponent(token)}`);
    if (!res.ok) return { state: 'dead' };
    return (await res.json()) as CompanionApprovalPayload;
  }

  public actOnApproval(token: string, decision: 'approve' | 'decline'): Promise<CompanionApprovalPayload> {
    return post<CompanionApprovalPayload>(`/api/companion/approve/${encodeURIComponent(token)}`, { decision });
  }

  /**
   * The organizer's launch page — the join QR plus everyone who has scanned it.
   *
   * Like `getApproval`, a non-ok response is treated as dead rather than retried: the
   * endpoint answers 200 for every resolved outcome, so anything else is not an answer
   * about this link. The page polls, so a transient blip corrects itself on the next tick.
   */
  public async getOrganizerPage(token: string): Promise<CompanionOrganizerPayload> {
    const res = await fetch(`/api/companion/organizer/${encodeURIComponent(token)}`);
    if (!res.ok) return { state: 'dead' };
    return (await res.json()) as CompanionOrganizerPayload;
  }

  public decideOnOrganizerPage(
    token: string,
    volunteerId: string,
    decision: 'approve' | 'decline',
  ): Promise<CompanionOrganizerPayload> {
    return post<CompanionOrganizerPayload>(`/api/companion/organizer/${encodeURIComponent(token)}/decide`, {
      volunteer_id: volunteerId,
      decision,
    });
  }

  /** Headers to attach to every companion data request. */
  public headers(): Record<string, string> {
    const token = this.sessionToken();
    return token ? { 'X-Companion-Session': token } : {};
  }

  public saveSession(token: string, expiresAt: string): void {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt } satisfies StoredSession));
    this.sessionToken.set(token);
  }

  public async verifyConfirm(
    kind: CompanionVerifyKind,
    token: string,
    code: string,
  ): Promise<CompanionVerifyConfirmResult> {
    const result = await post<CompanionVerifyConfirmResult>('/api/companion/verify/confirm', { kind, token, code });
    this.saveSession(result.sessionToken, result.expiresAt);
    return result;
  }

  public async verifyStart(
    kind: CompanionVerifyKind,
    token: string,
    channel: CompanionVerifyChannel,
  ): Promise<{ masked: string }> {
    return post<{ masked: string }>('/api/companion/verify/start', { kind, token, channel });
  }
}
