import formBody from '@fastify/formbody';
import type { FastifyPluginCallback } from 'fastify';

import { BaseRepository } from '../../../lib/base.repo';
import { checkRateLimit } from '../../../lib/rate-limiter';
import { logger } from '../../../logger';
import { decodeUnsubscribeToken } from '../unsubscribe-token';

const db = new BaseRepository('campaign_subscriptions').db;

// One-click unsubscribe for automation emails (the SendGrid newsletter path has its own
// <% unsubscribe %> substitution — this route only serves the Postmark automation path).
// The token authenticates the request: it names exactly one (tenant, person, email) and is
// HMAC-signed, so there is no session and no enumeration surface. Unsubscribing flips every
// campaign_subscriptions row for the person — an automation isn't campaign-scoped, so the
// only honest reading of "unsubscribe" here is "stop all of this organization's email".
// Deliberately NOT an email_suppressions insert: suppressions record address health
// (bounces/complaints), not consent, and a suppression would also be irreversible by the
// person re-subscribing through a form.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PAGE_HEAD = `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           background: #f8fafc; color: #1e293b; margin: 0; padding: 40px 20px; }
    .card { max-width: 480px; margin: 40px auto; background: #fff; border: 1px solid #e2e8f0;
            border-radius: 12px; padding: 32px; text-align: center; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { color: #475569; line-height: 1.6; margin: 0 0 20px; }
    button { font-size: 15px; font-weight: 600; color: #fff; background: #dc2626; border: 0;
             border-radius: 8px; padding: 12px 24px; cursor: pointer; }
  </style>`;

function resultPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  ${PAGE_HEAD}
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

// GET is safe/idempotent: it must NOT unsubscribe (mail scanners and link prefetchers — Outlook
// SafeLinks, antivirus — issue GETs on links in email bodies, which would silently unsubscribe a
// recipient who never clicked). It renders a one-button form that POSTs back to the same token URL.
function confirmPromptPage(email: string, actionPath: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  ${PAGE_HEAD}
  <title>Unsubscribe</title>
</head>
<body>
  <div class="card">
    <h1>Unsubscribe</h1>
    <p>Click below to stop receiving emails at ${escapeHtml(email)} from this organization.</p>
    <form method="POST" action="${escapeHtml(actionPath)}">
      <button type="submit">Unsubscribe</button>
    </form>
  </div>
</body>
</html>`;
}

const unsubscribeRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // Both the confirm page's <form method="POST"> and an RFC 8058 one-click arrive as
  // application/x-www-form-urlencoded; the global server only parses JSON, so without this
  // parser Fastify replies 415 before the POST handler ever runs.
  void fastify.register(formBody);

  // GET only confirms — it never mutates (see confirmPromptPage). The actual unsubscribe is the POST
  // below, which also satisfies RFC 8058 one-click (mail clients POST `List-Unsubscribe=One-Click`).
  fastify.get<{ Params: { token: string } }>('/:token', async (request, reply) => {
    // Tokens are unguessable, so a burst of misses is someone probing — throttle by IP.
    checkRateLimit(`unsubscribe:${request.ip}`, 30, 60 * 1000);

    const payload = decodeUnsubscribeToken(request.params.token);
    if (!payload) {
      return reply
        .code(404)
        .type('text/html')
        .send(resultPage('Link not valid', 'This unsubscribe link is not valid.'));
    }

    return reply.code(200).type('text/html').send(confirmPromptPage(payload.email, request.url));
  });

  fastify.post<{ Params: { token: string } }>('/:token', async (request, reply) => {
    checkRateLimit(`unsubscribe:${request.ip}`, 30, 60 * 1000);

    const payload = decodeUnsubscribeToken(request.params.token);
    if (!payload) {
      return reply
        .code(404)
        .type('text/html')
        .send(resultPage('Link not valid', 'This unsubscribe link is not valid.'));
    }

    await db
      .updateTable('campaign_subscriptions')
      .set({ status: 'unsubscribed', unsubscribed_at: new Date() })
      .where('tenant_id', '=', payload.tenantId)
      .where('person_id', '=', payload.personId)
      .where('status', '!=', 'unsubscribed')
      .execute();

    logger.info(
      { tenantId: payload.tenantId, personId: payload.personId },
      '[unsubscribe] Automation-email unsubscribe processed',
    );

    return reply
      .code(200)
      .type('text/html')
      .send(
        resultPage("You're unsubscribed", `${payload.email} will no longer receive emails from this organization.`),
      );
  });

  done();
};

export default unsubscribeRoute;
