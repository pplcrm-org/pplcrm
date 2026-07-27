import { TRPCError } from '@trpc/server';
import type { FastifyRequest } from 'fastify';

import { planAllowsFeature } from '@common';

import { hashApiKey } from './api-key';
import { BaseRepository } from './base.repo';
import { checkRateLimit } from './rate-limiter';
import { TooManyRequestsError } from '../errors/app-errors';
import { WorkspaceApiKeysRepo } from '../modules/settings/repositories/workspace-api-keys.repo';

const repo = new WorkspaceApiKeysRepo();

// Keyed (server-side) submissions get a per-tenant cap instead of the anonymous per-IP
// one — a single integration server would exhaust an IP window immediately. Matches the
// Zapier inbound cap; generous for legitimate bursts, still a brake on a leaked key.
const KEYED_RATE_LIMIT = 120;
const KEYED_RATE_WINDOW_MS = 60 * 1000;

/**
 * Resolve the tenant owning this key, or null. Also stamps last_used_at for the audit trail.
 *
 * This is the single chokepoint every keyed request passes through — Zapier inbound and the
 * server-side form / RSVP / volunteer-signup submits alike — so the API plan gate lives here
 * rather than being repeated (and eventually forgotten) on each route. A tenant that drops below
 * the minimum plan keeps its stored keys but they stop resolving, which is what makes a downgrade
 * actually take effect instead of only blocking the issuance of new ones.
 *
 * Returns null on a plan miss, deliberately: the callers already turn null into the same generic
 * "Invalid API key" as an unknown key. Telling an unauthenticated caller "this workspace is on
 * the free plan" would leak a tenant's billing status to anyone holding a stale key.
 */
export async function lookupTenantByApiKey(providedKey: string): Promise<string | null> {
  const row = await repo.getByKeyHash(hashApiKey(providedKey));
  if (!row) return null;

  const tenantId = String(row.tenant_id);
  if (!(await tenantPlanAllowsApi(tenantId))) return null;

  await repo.updateLastUsed(tenantId, String(row.id));
  return tenantId;
}

/** Whether the owning tenant's plan still includes API access (GATED_FEATURES.api). */
async function tenantPlanAllowsApi(tenantId: string): Promise<boolean> {
  const tenant = await BaseRepository.dbInstance
    .selectFrom('tenants')
    .select('subscription_plan')
    .where('id', '=', tenantId)
    .executeTakeFirst();
  return planAllowsFeature(tenant?.subscription_plan, 'api');
}

/**
 * Optional Bearer auth for the public submission endpoints. Absent header → null (the
 * anonymous browser path, unchanged). Present but malformed/unknown → UNAUTHORIZED, so a
 * misconfigured server integration fails loudly instead of being silently treated as
 * anonymous traffic and rate-limited per IP.
 */
export async function tenantIdFromOptionalApiKey(req: FastifyRequest): Promise<string | null> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const providedKey = match?.[1]?.trim();
  if (!providedKey) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid API key format. Use "Authorization: Bearer <key>".',
    });
  }

  const tenantId = await lookupTenantByApiKey(providedKey);
  if (!tenantId) {
    // Don't distinguish unknown from revoked, to avoid key enumeration.
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid API key.' });
  }
  return tenantId;
}

/** Per-tenant limit for keyed submissions; `surface` keeps forms/RSVPs/signups in separate buckets. */
export function checkKeyedSubmissionRateLimit(tenantId: string, surface: string): void {
  try {
    checkRateLimit(`wskey:${surface}:${tenantId}`, KEYED_RATE_LIMIT, KEYED_RATE_WINDOW_MS);
  } catch (err) {
    if (err instanceof TooManyRequestsError) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Please try again in a minute.' });
    }
    throw err;
  }
}
