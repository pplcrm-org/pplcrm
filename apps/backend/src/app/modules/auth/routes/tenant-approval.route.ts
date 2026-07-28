import formBody from '@fastify/formbody';
import type { FastifyPluginCallback } from 'fastify';

import { TransactionalEmailService } from '../../../lib/mail/transactional-mail.service';
import { checkRateLimit } from '../../../lib/rate-limiter';
import { env } from '../../../../env';
import { escapeHtml } from '../../../lib/html-escape';
import { findTenantByApprovalToken, recordApprovalDecision } from '../tenant-approval';
import { logger } from '../../../logger';

/**
 * The ops end of the closed-beta gate: one link, mailed to the ops inbox when a workspace
 * signs up, that approves or declines it.
 *
 * The token IS the authentication — there is no session here, and ops may well be reading
 * mail on a phone. It is unguessable, single-use, and names exactly one tenant, which is the
 * same bargain the unsubscribe and companion links make.
 *
 * GET only renders the decision page; it must NOT decide anything. Link scanners and
 * prefetchers (Outlook SafeLinks, antivirus, the ops inbox's own preview) issue GETs on
 * every URL in an email, and a GET that approved would let a mail scanner silently admit
 * every signup. The decision is the POST from that page.
 */

const MIN15 = 15 * 60 * 1000;

const mailService = new TransactionalEmailService();

const PAGE_HEAD = `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           background: #f8fafc; color: #1e293b; margin: 0; padding: 40px 20px; }
    .card { max-width: 480px; margin: 40px auto; background: #fff; border: 1px solid #e2e8f0;
            border-radius: 12px; padding: 32px; text-align: center; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { color: #475569; line-height: 1.6; margin: 0 0 20px; }
    dl { text-align: left; margin: 0 0 24px; padding: 16px; background: #f8fafc;
         border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }
    dt { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    dd { margin: 2px 0 12px; color: #1e293b; font-weight: 600; word-break: break-word; }
    dd:last-of-type { margin-bottom: 0; }
    .actions { display: flex; gap: 12px; justify-content: center; }
    button { font-size: 15px; font-weight: 600; border: 0; border-radius: 8px;
             padding: 12px 24px; cursor: pointer; }
    .approve { color: #fff; background: #059669; }
    .decline { color: #475569; background: #e2e8f0; }
  </style>`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  ${PAGE_HEAD}
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </div>
</body>
</html>`;
}

function resultPage(title: string, message: string): string {
  return page(title, `<p>${escapeHtml(message)}</p>`);
}

/** The two-button decision page. Both buttons POST back to the same token URL. */
function decisionPage(
  actionPath: string,
  tenant: { tenantName: string; ownerEmail: string | null; ownerFirstName: string | null },
): string {
  return page(
    'Beta signup',
    `<p>This workspace is waiting to be let into the beta. Nobody can sign into it until you decide.</p>
    <dl>
      <dt>Organization</dt><dd>${escapeHtml(tenant.tenantName)}</dd>
      <dt>Owner</dt><dd>${escapeHtml(tenant.ownerFirstName ?? '—')}</dd>
      <dt>Email</dt><dd>${escapeHtml(tenant.ownerEmail ?? '—')}</dd>
    </dl>
    <form method="POST" action="${escapeHtml(actionPath)}" class="actions">
      <button type="submit" name="decision" value="approve" class="approve">Approve</button>
      <button type="submit" name="decision" value="decline" class="decline">Decline</button>
    </form>`,
  );
}

/**
 * Tell the owner their workspace is open.
 *
 * Sent directly rather than through the outbox: this runs in a plain request handler with no
 * surrounding transaction, so there is nothing to be atomic with. Best-effort — a mail
 * failure must not make ops believe the approval itself failed, because it did not.
 */
async function notifyOwnerApproved(tenantId: string, email: string, firstName: string | null): Promise<void> {
  try {
    await mailService.sendMail({
      to: email,
      tenant_id: tenantId,
      audience: 'account',
      subject: 'Your pplCRM workspace is ready',
      text: `Hi ${firstName ?? 'there'},\n\nGood news: your pplCRM workspace has been approved and is open. Sign in at ${env.appUrl}/signin.\n\nThanks for your patience while we let beta workspaces in gradually.`,
      html: `<h2>Your workspace is ready</h2>
<p>Hi ${escapeHtml(firstName ?? 'there')},</p>
<p>Good news: your pplCRM workspace has been approved and is open for business.</p>
<div class="btn-container">
  <a href="${env.appUrl}/signin" class="btn">Sign in to pplCRM</a>
</div>
<p>Thanks for your patience while we let beta workspaces in gradually.</p>`,
    });
  } catch (err) {
    logger.error({ err, tenantId }, '[tenant-approval] Approved, but the owner notification failed to send');
  }
}

const tenantApprovalRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // The decision page posts application/x-www-form-urlencoded; the server only parses JSON
  // globally, so without this the POST would 415 before the handler ran.
  void fastify.register(formBody);

  fastify.get<{ Params: { token: string } }>('/:token', async (request, reply) => {
    // Tokens are unguessable, so a burst of misses is someone probing.
    checkRateLimit(`tenant-approval:${request.ip}`, 30, MIN15);

    const tenant = await findTenantByApprovalToken(request.params.token);
    if (!tenant) {
      return reply
        .code(404)
        .type('text/html')
        .send(
          resultPage(
            'Link not valid',
            'This approval link is not valid, or it has already been used. Each signup gets one.',
          ),
        );
    }

    if (tenant.status !== 'pending') {
      return reply
        .code(200)
        .type('text/html')
        .send(resultPage('Already decided', `${tenant.tenantName} has already been ${tenant.status}.`));
    }

    return reply.code(200).type('text/html').send(decisionPage(request.url, tenant));
  });

  fastify.post<{ Params: { token: string }; Body: { decision?: string } }>('/:token', async (request, reply) => {
    checkRateLimit(`tenant-approval:${request.ip}`, 30, MIN15);

    const decision = request.body?.decision === 'approve' ? 'approved' : 'declined';

    const tenant = await findTenantByApprovalToken(request.params.token);
    if (!tenant) {
      return reply
        .code(404)
        .type('text/html')
        .send(
          resultPage(
            'Link not valid',
            'This approval link is not valid, or it has already been used. Each signup gets one.',
          ),
        );
    }

    // Spends the token and refuses anything already decided, so a double-submit or a replayed
    // link reports the truth instead of claiming a change it did not make.
    const decided = await recordApprovalDecision(tenant.tenantId, decision);
    if (!decided) {
      return reply
        .code(200)
        .type('text/html')
        .send(resultPage('Already decided', `${tenant.tenantName} has already been decided.`));
    }

    logger.info({ tenantId: tenant.tenantId, decision }, '[tenant-approval] Beta signup decided from the ops link');

    if (decision === 'approved' && tenant.ownerEmail) {
      await notifyOwnerApproved(tenant.tenantId, tenant.ownerEmail, tenant.ownerFirstName);
    }

    return reply
      .code(200)
      .type('text/html')
      .send(
        decision === 'approved'
          ? resultPage('Approved', `${tenant.tenantName} can now sign in. The owner has been emailed.`)
          : resultPage(
              'Declined',
              `${tenant.tenantName} stays on the waitlist. They keep seeing the "waiting for approval" message; no email was sent.`,
            ),
      );
  });

  done();
};

export default tenantApprovalRoute;
