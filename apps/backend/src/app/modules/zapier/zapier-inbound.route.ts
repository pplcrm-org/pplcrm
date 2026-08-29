import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
// `lower(email) = ?` rather than ILIKE: `_` and `%` are LIKE wildcards and are both legal in an
// email local part, so an ILIKE lookup can match — and then overwrite — the wrong person.
// It also lets Postgres use idx_persons_tenant_email_btree, which ILIKE cannot.
import { sql } from 'kysely';
import { z } from 'zod';
import { PersonsService } from '../persons/services/persons.service';
import type { IAuthKeyPayload } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';
import { checkRateLimit } from '../../lib/rate-limiter';
import { lookupTenantByApiKey } from '../../lib/validate-api-key';
import { AppError, TooManyRequestsError } from '../../errors/app-errors';
import { pickPersonFields, ZAPIER_EVENT_TYPES, ZapierService } from './zapier.service';

const personsService = new PersonsService();
const zapierService = new ZapierService();

// The API key is the sole authenticator for these unauthenticated-by-default write
// routes, so cap requests per source IP: throttles key brute-forcing and abuse of a
// leaked key (SECURITY-REVIEW.md 2.4). Generous enough for legitimate Zapier bursts.
//
// The same numbers cap each TENANT after the key resolves (requireTenant below). The per-IP
// bucket alone was the wrong unit for authenticated traffic: Zapier sends many customers'
// requests from a shared egress-IP pool, so one busy workspace could exhaust the bucket for
// every other workspace behind that IP — and a single tenant spreading across IPs had no
// ceiling at all.
const ZAPIER_RATE_LIMIT = 120;
const ZAPIER_RATE_WINDOW_MS = 60 * 1000;

/** How many rows /persons/recent returns — sample data for Zapier's Zap editor. */
const RECENT_PERSONS_LIMIT = 10;

/** The exact person shape every trigger payload and read endpoint shares (pickPersonFields). */
const PERSON_FIELD_COLUMNS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'email2',
  'mobile',
  'home_phone',
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
  'notes',
  'created_at',
  'updated_at',
] as const;

const upsertPersonSchema = z.object({
  email: z.string().email('Valid email required for person matching').max(255),
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  mobile: z.string().trim().max(30).optional(),
  home_phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(10000).optional(),
  linkedin: z.string().trim().max(255).optional(),
  twitter: z.string().trim().max(255).optional(),
  facebook: z.string().trim().max(255).optional(),
  instagram: z.string().trim().max(255).optional(),
});

const tagActionSchema = z.object({
  email: z.string().email('Valid email required to identify the person').max(255),
  tag_name: z.string().trim().min(1, 'Tag name cannot be empty').max(50),
});

const subscribeSchema = z.object({
  event_type: z.enum(ZAPIER_EVENT_TYPES),
  hook_url: z.string().url('hook_url must be a valid URL').max(2048),
});

const searchQuerySchema = z.object({
  email: z.string().email('Valid email required').max(255),
});

async function resolveAuth(tenantId: string, db: Kysely<Models>): Promise<IAuthKeyPayload | null> {
  const owner = await db
    .selectFrom('authusers')
    .select(['id', 'first_name', 'last_name', 'role'])
    .where('tenant_id', '=', tenantId)
    .where('role', 'in', ['owner', 'admin'])
    .orderBy('id', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (!owner) return null;

  const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || 'Zapier';

  return {
    user_id: String(owner.id),
    tenant_id: tenantId,
    session_id: 'zapier',
    name,
    role: owner.role ?? 'admin',
    source: 'api',
  } as IAuthKeyPayload;
}

async function extractTenantId(req: FastifyRequest): Promise<string | null> {
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return null;
  return lookupTenantByApiKey(apiKey);
}

/**
 * Resolve the workspace API key to a tenant and spend one unit of that tenant's own
 * per-minute budget. Sends the 401/429 itself and returns null, so every handler starts
 * with `const tenantId = await requireTenant(req, reply); if (!tenantId) return;`.
 */
async function requireTenant(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const tenantId = await extractTenantId(req);
  if (!tenantId) {
    reply.code(401).send({ error: 'Invalid or missing API key' });
    return null;
  }
  try {
    checkRateLimit(`zapier:tenant:${tenantId}`, ZAPIER_RATE_LIMIT, ZAPIER_RATE_WINDOW_MS);
  } catch (err) {
    if (err instanceof TooManyRequestsError) {
      reply.code(429).send({ error: err.message });
      return null;
    }
    throw err;
  }
  return tenantId;
}

const zapierInboundRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // Rate-limit every inbound Zapier route by source IP before the handler runs.
  fastify.addHook('onRequest', async (req, reply) => {
    try {
      checkRateLimit(`zapier:${req.ip}`, ZAPIER_RATE_LIMIT, ZAPIER_RATE_WINDOW_MS);
    } catch (err) {
      if (err instanceof TooManyRequestsError) {
        return reply.code(429).send({ error: err.message });
      }
      throw err;
    }
  });

  fastify.post('/persons/upsert', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    const parsed = upsertPersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    const { email, ...fields } = parsed.data;

    try {
      const db = (await import('../../lib/base.repo')).BaseRepository.dbInstance;
      const auth = await resolveAuth(tenantId, db);
      if (!auth) {
        return reply.code(500).send({ error: 'Tenant has no admin user configured' });
      }

      const existing = await db
        .selectFrom('persons')
        .select(['id', 'email'])
        .where('tenant_id', '=', tenantId)
        .where(sql`lower(email)`, '=', email.trim().toLowerCase())
        .executeTakeFirst();

      if (existing) {
        const result = await personsService.updatePerson(String(existing.id), { email, ...fields }, auth);
        return reply.code(200).send({ action: 'updated', person: result });
      } else {
        const result = await personsService.addPerson({ email, ...fields }, auth);
        return reply.code(201).send({ action: 'created', person: result });
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /persons/upsert error');
      return reply.code(500).send({ error: 'Failed to upsert person' });
    }
  });

  fastify.post('/persons/tag', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    const parsed = tagActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    const { email, tag_name } = parsed.data;

    try {
      const db = (await import('../../lib/base.repo')).BaseRepository.dbInstance;
      const auth = await resolveAuth(tenantId, db);
      if (!auth) {
        return reply.code(500).send({ error: 'Tenant has no admin user configured' });
      }

      const person = await db
        .selectFrom('persons')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql`lower(email)`, '=', email.trim().toLowerCase())
        .executeTakeFirst();

      if (!person) {
        return reply.code(404).send({ error: 'No person found with that email' });
      }

      await personsService.attachTag(String(person.id), tag_name, 'tag', auth);
      return reply.code(200).send({ success: true });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /persons/tag error');
      return reply.code(500).send({ error: 'Failed to add tag' });
    }
  });

  fastify.post('/persons/untag', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    const parsed = tagActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    const { email, tag_name } = parsed.data;

    try {
      const db = (await import('../../lib/base.repo')).BaseRepository.dbInstance;
      const auth = await resolveAuth(tenantId, db);
      if (!auth) {
        return reply.code(500).send({ error: 'Tenant has no admin user configured' });
      }

      const person = await db
        .selectFrom('persons')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql`lower(email)`, '=', email.trim().toLowerCase())
        .executeTakeFirst();

      if (!person) {
        return reply.code(404).send({ error: 'No person found with that email' });
      }

      await personsService.detachTag({
        tenant_id: tenantId,
        person_id: String(person.id),
        name: tag_name,
        type: 'tag',
        user_id: auth.user_id,
        source: auth.source,
      });

      return reply.code(200).send({ success: true });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /persons/untag error');
      return reply.code(500).send({ error: 'Failed to remove tag' });
    }
  });

  // Connection test: names the workspace behind the key. Zapier calls this when a user
  // connects their account and uses the answer as the connection label.
  fastify.get('/me', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    try {
      const db = (await import('../../lib/base.repo')).BaseRepository.dbInstance;
      const tenant = await db.selectFrom('tenants').select(['name']).where('id', '=', tenantId).executeTakeFirst();
      if (!tenant) {
        return reply.code(500).send({ error: 'Workspace not found' });
      }
      return reply.send({ workspace: tenant.name });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /me error');
      return reply.code(500).send({ error: 'Failed to look up workspace' });
    }
  });

  // REST-hooks subscribe: Zapier calls this when a Zap is switched on, with the hook URL it
  // generated for that Zap. The returned id is stored by Zapier and sent back on unsubscribe.
  fastify.post('/subscribe', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    try {
      const { id } = await zapierService.subscribe(tenantId, parsed.data.event_type, parsed.data.hook_url);
      return reply.code(201).send({ id });
    } catch (err) {
      // The outbound-URL guard rejects private/internal targets with a client-safe message.
      if (err instanceof AppError && err.status < 500) {
        return reply.code(err.status).send({ error: err.message });
      }
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /subscribe error');
      return reply.code(500).send({ error: 'Failed to subscribe' });
    }
  });

  // REST-hooks unsubscribe: Zapier calls this when a Zap is switched off. Idempotent — an id
  // that is already gone (or belongs to another workspace) deletes nothing and still returns
  // success, so a retried unsubscribe never wedges the Zap.
  fastify.delete('/subscribe/:id', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    const { id } = req.params as { id: string };
    if (!/^\d+$/.test(id)) {
      return reply.code(400).send({ error: 'Invalid subscription id' });
    }

    try {
      await zapierService.unsubscribeById(tenantId, id);
      return reply.send({ success: true });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /unsubscribe error');
      return reply.code(500).send({ error: 'Failed to unsubscribe' });
    }
  });

  // Read endpoint: find people by email. Returns an array (usually 0 or 1 rows; duplicates are
  // possible and all returned). An empty array — not a 404 — means no match, which is what
  // Zapier's search actions expect.
  fastify.get('/persons/search', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    try {
      const db = (await import('../../lib/base.repo')).BaseRepository.dbInstance;
      const rows = await db
        .selectFrom('persons')
        .select(PERSON_FIELD_COLUMNS)
        .where('tenant_id', '=', tenantId)
        .where(sql`lower(email)`, '=', parsed.data.email.trim().toLowerCase())
        .execute();
      return reply.send(rows.map((row) => pickPersonFields(row as Record<string, unknown>)));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /persons/search error');
      return reply.code(500).send({ error: 'Failed to search' });
    }
  });

  // Most recently added people, newest first — Zapier's performList: real rows the Zap editor
  // shows as samples while a hook trigger has not fired yet.
  fastify.get('/persons/recent', async (req, reply) => {
    const tenantId = await requireTenant(req, reply);
    if (!tenantId) return;

    try {
      const db = (await import('../../lib/base.repo')).BaseRepository.dbInstance;
      const rows = await db
        .selectFrom('persons')
        .select(PERSON_FIELD_COLUMNS)
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'desc')
        .limit(RECENT_PERSONS_LIMIT)
        .execute();
      return reply.send(rows.map((row) => pickPersonFields(row as Record<string, unknown>)));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Zapier Inbound] /persons/recent error');
      return reply.code(500).send({ error: 'Failed to list recent people' });
    }
  });

  done();
};

export default zapierInboundRoute;
