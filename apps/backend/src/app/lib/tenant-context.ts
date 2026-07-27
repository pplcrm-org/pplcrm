import { AsyncLocalStorage } from 'async_hooks';

/**
 * S-1 (schema review 2026-07-06 §6): per-request tenant context for row-level
 * security.
 *
 * The tenant id for the current request/job is stored here and read by the
 * runtime pool's `onReserveConnection` hook (see base.repo.ts), which issues
 * `set_config('app.tenant_id', …)` on every connection checkout. Postgres RLS
 * policies (migration 2026-07-26) then scope every query to that tenant — a
 * defense-in-depth backstop *under* the app-level `.where('tenant_id', …)`
 * scoping, catching any query that forgets it (including the lint rule's
 * blind spots, e.g. chains broken across statements).
 *
 * When no tenant is set (pre-auth identify queries — login, refresh-token and
 * webhook/api-key resolution, public event pages — and the background-job
 * worker, some of whose jobs are intentionally cross-tenant), the GUC is left
 * empty and the RLS policy allows all rows, preserving today's behaviour.
 */
interface TenantContext {
  /** Numeric tenant id as a string (pg int8 → string), or '' for unscoped. */
  readonly tenantId: string;
  /**
   * Campaigns §15 — the campaign this request is pinned to, or null when the
   * caller may work across campaigns (admins/owners) or there is no caller
   * (background jobs, webhooks). See {@link pinnedCampaignId}.
   */
  readonly campaignId: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the given tenant bound to the async context. Every DB query
 * issued (directly or transitively) inside `fn` is RLS-scoped to this tenant.
 *
 * `campaignId` additionally pins campaign-scoped reads and writes — pass it for
 * callers who belong to exactly one campaign, and null for everyone else.
 */
export function runWithTenant<T>(tenantId: string, fn: () => T, campaignId: string | null = null): T {
  return storage.run({ tenantId, campaignId }, fn);
}

/**
 * The tenant id for the current async context, or '' when unscoped. Only the
 * connection-reserve hook should need this; application code scopes via the
 * usual `.where('tenant_id', …)`.
 */
export function currentTenantId(): string {
  return storage.getStore()?.tenantId ?? '';
}

/**
 * The campaign the current caller is pinned to, or null when unpinned.
 *
 * SECURITY: this is the server's own answer, derived from the caller's assignment
 * — never from request input. Campaign scoping used to be opt-in from the client
 * (`options.campaignId`), so a pinned Editor who simply omitted the option read
 * every campaign in the tenant. BaseRepository consults this first, so omitting
 * the option now narrows to the assigned campaign instead of widening past it.
 */
export function pinnedCampaignId(): string | null {
  return storage.getStore()?.campaignId ?? null;
}
