import type { FastifyPluginCallback } from 'fastify';
import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { WebFormsController } from '../controller';
import { DonationsController } from '../../donations/controller';
import formBody from '@fastify/formbody';
import { resolveTenantById, resolveTenantFromRequest } from '../../../lib/public-tenant';
import { checkKeyedSubmissionRateLimit, tenantIdFromOptionalApiKey } from '../../../lib/validate-api-key';
import { env } from '../../../../env';
import { checkRateLimit } from '../../../lib/rate-limiter';
import { publicClientMessageOf } from '../../../lib/public-route-errors';

/** Per-IP ceiling on the read-only public pages (form config, donation page). Generous:
 *  a refresh or a slow page with several assets must never trip it. */
const PUBLIC_PAGE_MAX = 60;
const PUBLIC_PAGE_WINDOW_MS = 60 * 1000;
/** The mock-donation confirmation can WRITE, so it gets a tighter ceiling. */
const PUBLIC_WRITE_MAX = 10;

const webFormsController = new WebFormsController();
const donationsController = new DonationsController();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * HTTP status for an error thrown behind a public REST route. The controller layer throws
 * TRPCError (it also backs the tRPC router), whose string `code` carries no numeric status —
 * without the explicit mapping every BAD_REQUEST/TOO_MANY_REQUESTS surfaced as a 500 and the
 * visitor lost the actionable message. AppError `.status` and Fastify `.statusCode` still win.
 */
function httpStatusOf(err: unknown): number | undefined {
  if (isRecord(err) && typeof err['status'] === 'number') return err['status'];
  if (isRecord(err) && typeof err['statusCode'] === 'number') return err['statusCode'];
  if (err instanceof TRPCError) return getHTTPStatusCodeFromError(err);
  return undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SUCCESS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Submission Successful</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
      --accent: #0ea5e9;
      --accent-hover: #0284c7;
      --accent-glow: rgba(14, 165, 233, 0.15);
      --card-bg: rgba(255, 255, 255, 0.8);
      --card-border: #cbd5e1;
      --card-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.08), 0 20px 40px -15px rgba(0, 0, 0, 0.05);
      --text-primary: #1f2937;
      --text-secondary: #6b7280;
      --success: #2dd4bf;
      --success-glow: rgba(45, 212, 191, 0.15);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-gradient: linear-gradient(135deg, #0b1220 0%, #0e1726 50%, #060a12 100%);
        --accent: #3ea6ff;
        --accent-hover: #1a8cff;
        --accent-glow: rgba(62, 166, 255, 0.2);
        --card-bg: rgba(19, 30, 49, 0.85);
        --card-border: #1a2b45;
        --card-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
        --text-primary: #f8fafc;
        --text-secondary: #c7d1e5;
        --success: #22c55e;
        --success-glow: rgba(34, 197, 94, 0.15);
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Roboto', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 400;
      background: var(--bg-gradient);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: hidden;
      position: relative;
    }

    body::before, body::after {
      content: "";
      position: absolute;
      width: 300px;
      height: 300px;
      border-radius: 50%;
      background: var(--accent);
      filter: blur(120px);
      opacity: 0.08;
      z-index: 0;
    }
    body::before { top: 10%; left: 15%; }
    body::after { bottom: 10%; right: 15%; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 48px 32px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      box-shadow: var(--card-shadow);
      z-index: 10;
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }

    .icon-container {
      width: 80px;
      height: 80px;
      background: var(--success-glow);
      border: 2px solid var(--success);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 28px;
      position: relative;
      animation: popIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    .icon-container svg {
      width: 38px;
      height: 38px;
      stroke: var(--success);
      stroke-dasharray: 100;
      stroke-dashoffset: 100;
      stroke-width: 3px;
      fill: none;
      animation: drawCheck 0.6s 0.3s ease-out forwards;
    }

    h1 {
      font-size: 24px;
      font-weight: 500;
      margin-bottom: 12px;
      letter-spacing: -0.01em;
    }

    p {
      color: var(--text-secondary);
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .btn {
      display: inline-block;
      width: 100%;
      padding: 14px 28px;
      background: var(--accent);
      color: #ffffff;
      font-size: 15px;
      font-weight: 500;
      text-decoration: none;
      border-radius: 12px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px var(--accent-glow);
    }

    .btn:hover {
      background: var(--accent-hover);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px var(--accent-glow);
    }

    .btn:active {
      transform: translateY(0);
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes popIn {
      0% {
        opacity: 0;
        transform: scale(0.6);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes drawCheck {
      to {
        stroke-dashoffset: 0;
      }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-container">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 6L9 17L4 12" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Submission Successful</h1>
    <p>Thank you! Your information has been successfully received and processed.</p>
  </div>
</body>
</html>
`;

const errorHtml = (message: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Submission Error</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
      --accent: #0ea5e9;
      --accent-hover: #0284c7;
      --accent-glow: rgba(14, 165, 233, 0.15);
      --card-bg: rgba(255, 255, 255, 0.8);
      --card-border: #cbd5e1;
      --card-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.08), 0 20px 40px -15px rgba(0, 0, 0, 0.05);
      --text-primary: #1f2937;
      --text-secondary: #6b7280;
      --error: #f37373;
      --error-glow: rgba(243, 115, 115, 0.15);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-gradient: linear-gradient(135deg, #0b1220 0%, #0e1726 50%, #060a12 100%);
        --accent: #3ea6ff;
        --accent-hover: #1a8cff;
        --accent-glow: rgba(62, 166, 255, 0.2);
        --card-bg: rgba(19, 30, 49, 0.85);
        --card-border: #1a2b45;
        --card-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
        --text-primary: #f8fafc;
        --text-secondary: #c7d1e5;
        --error: #ef4444;
        --error-glow: rgba(239, 68, 68, 0.15);
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Roboto', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 400;
      background: var(--bg-gradient);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: hidden;
      position: relative;
    }

    body::before, body::after {
      content: "";
      position: absolute;
      width: 300px;
      height: 300px;
      border-radius: 50%;
      background: var(--error);
      filter: blur(120px);
      opacity: 0.08;
      z-index: 0;
    }
    body::before { top: 10%; left: 15%; }
    body::after { bottom: 10%; right: 15%; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 48px 32px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      box-shadow: var(--card-shadow);
      z-index: 10;
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--error), transparent);
    }

    .icon-container {
      width: 80px;
      height: 80px;
      background: var(--error-glow);
      border: 2px solid var(--error);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 28px;
      position: relative;
      animation: popIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    .icon-container svg {
      width: 38px;
      height: 38px;
      stroke: var(--error);
      stroke-width: 3px;
      fill: none;
    }

    h1 {
      font-size: 24px;
      font-weight: 500;
      margin-bottom: 12px;
      letter-spacing: -0.01em;
    }

    p {
      color: var(--text-secondary);
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .btn {
      display: inline-block;
      width: 100%;
      padding: 14px 28px;
      background: var(--accent);
      color: #ffffff;
      font-size: 15px;
      font-weight: 500;
      text-decoration: none;
      border-radius: 12px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px var(--accent-glow);
    }

    .btn:hover {
      background: var(--accent-hover);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px var(--accent-glow);
    }

    .btn:active {
      transform: translateY(0);
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes popIn {
      0% {
        opacity: 0;
        transform: scale(0.6);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-container">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 9v4M12 17h.01M12 3a9 9 0 110 18 9 9 0 010-18z" stroke-linecap="round" stroke-linejoin="round" stroke="var(--error)"/>
      </svg>
    </div>
    <h1>Submission Failed</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>
`;

const webFormsPublicRoute: FastifyPluginCallback = (fastify, _, done) => {
  // Register form URL-encoded parser
  fastify.register(formBody);

  // These are per-tenant, transactional public pages (donation forms, submit
  // endpoints, success/error confirmations) — thin and not search content, so
  // keep them all out of search-engine indexes.
  fastify.addHook('onRequest', (_req, reply, hookDone) => {
    reply.header('X-Robots-Tag', 'noindex');
    hookDone();
  });

  fastify.get<{
    Querystring: {
      checkout_session_id?: string;
      is_mock?: string;
      person_id?: string;
      amount_cents?: string;
      province?: string;
      country?: string;
      tenant_id?: string;
      user_id?: string;
    };
  }>('/success', async (req, reply) => {
    // Unauthenticated and it can WRITE a donation row in mock mode, so it is throttled
    // harder than the read-only pages (finding M3).
    checkRateLimit(`public-donation-success:${req.ip}`, PUBLIC_WRITE_MAX, PUBLIC_PAGE_WINDOW_MS);
    const { checkout_session_id, is_mock, person_id, amount_cents, province, country, tenant_id, user_id } = req.query;
    // Mock-donation confirmation is a local/dev convenience only. This endpoint is
    // unauthenticated and every parameter (tenant_id, person_id, amount) is
    // attacker-controlled, so it must NEVER record donations unless mock payments are EXPLICITLY
    // enabled (ALLOW_MOCK_PAYMENTS=true) — an unset NODE_ENV must not fail open (SECURITY-REVIEW 4.2).
    // Real payments are confirmed via the signed Stripe webhook / authenticated tRPC path.
    if (env.allowMockPayments && is_mock === 'true' && checkout_session_id && person_id && tenant_id) {
      try {
        const { DonationsController } = await import('../../donations/controller');
        const donationsController = new DonationsController();
        await donationsController.confirmMockDonation(
          tenant_id,
          user_id || '1',
          person_id,
          Number(amount_cents),
          checkout_session_id,
          province || '',
          country || '',
        );
      } catch (err) {
        fastify.log.error(err as Error, 'Failed to confirm mock donation on public success page:');
      }
    }
    reply.type('text/html');
    return reply.send(SUCCESS_HTML);
  });

  // JSON config for the SPA public page (/f/:slug). The tenant is identified by its subdomain — from
  // the explicit `?t=` param (the SPA passes its own subdomain, robust across hosts) or the Host
  // header. Published forms return their render config; unpublished/archived slugs return a "closed"
  // status; unknown tenant/slug 404s.
  fastify.get<{ Params: { slug: string } }>('/f/:slug', async (req, reply) => {
    const { slug } = req.params;
    try {
      // Throttled like every sibling public surface (finding M3): this resolves a tenant
      // from the subdomain and then looks up the form, so it was an unauthenticated way to
      // make the backend do two DB queries per request. Generous enough that a refresh
      // never trips it.
      checkRateLimit(`public-form-config:${req.ip}`, PUBLIC_PAGE_MAX, PUBLIC_PAGE_WINDOW_MS);

      const tenant = await resolveTenantFromRequest(req);
      if (!tenant) {
        return reply.status(404).send({ error: 'Form not found.' });
      }
      const result = await webFormsController.getPublicFormBySlug(String(slug), tenant.id);
      return reply.status(200).send(result);
    } catch (err) {
      const statusCode = httpStatusOf(err) ?? 404;
      return reply.status(statusCode).send({ error: 'Form not found.' });
    }
  });

  // Server-rendered public donation page. Donation forms deliberately stay off the /f/:slug SPA
  // page (they carry the amount field + Stripe checkout); the lookup is tenant-scoped by slug like
  // every other public surface.
  fastify.get<{ Params: { slug: string } }>('/d/:slug', async (req, reply) => {
    const { slug } = req.params;
    try {
      checkRateLimit(`public-donation-page:${req.ip}`, PUBLIC_PAGE_MAX, PUBLIC_PAGE_WINDOW_MS);

      const tenant = await resolveTenantFromRequest(req);
      const form = tenant ? await webFormsController.getDonationFormPublic(tenant.id, String(slug)) : undefined;
      if (!tenant || !form || form.status !== 'published') {
        reply.status(404).type('text/html');
        return reply.send(errorHtml('Web form not found or inactive.'));
      }

      // Fail-closed residency gate: don't render a live donation form for an org that hasn't
      // confirmed its residency settings. Friendly copy, not the generic 404.
      if (!(await donationsController.mayAcceptDonations(tenant.id))) {
        reply.status(403).type('text/html');
        return reply.send(errorHtml('This organization isn’t accepting online donations yet. Please check back soon.'));
      }

      const formName = form.name;
      const formDescription = form.description || '';

      // Extract fields configuration, default to all fields if null/empty
      const fields: string[] = form.fields
        ? Array.isArray(form.fields)
          ? (form.fields as string[])
          : JSON.parse(String(form.fields))
        : ['first_name', 'last_name', 'email', 'mobile', 'notes'];

      const submitAction = `/api/forms/submit/${encodeURIComponent(String(slug))}?t=${encodeURIComponent(tenant.slug)}`;
      reply.type('text/html');
      return reply.send(renderFormHtml(submitAction, formName, formDescription, fields, form.form_type));
    } catch (err) {
      // Never surface internal error detail to an unauthenticated visitor — log it, show generic
      // copy (SECURITY-REVIEW 5.2, consistent with the tRPC sanitization boundary).
      fastify.log.error(err, 'Failed to render public form');
      reply.status(500).type('text/html');
      return reply.send(errorHtml('Failed to load form.'));
    }
  });

  fastify.post<{ Params: { slug: string }; Body: Record<string, string> }>('/submit/:slug', async (req, reply) => {
    const { slug } = req.params;
    // req.ip is derived from X-Forwarded-For per the trusted-proxy config; never
    // read the raw header, which a client can spoof to defeat rate limiting.
    const clientIp = req.ip;
    const isJsonExpected =
      req.headers.accept?.includes('application/json') || req.headers['content-type'] === 'application/json';

    try {
      // Optional workspace API key (server-side "bring your own form" integrations): the key
      // identifies the tenant and swaps the anonymous per-IP limit for a per-tenant one.
      // Anonymous browser/embed submissions carry no key and take the subdomain/?t= path.
      const keyTenantId = await tenantIdFromOptionalApiKey(req);
      if (keyTenantId) checkKeyedSubmissionRateLimit(keyTenantId, 'forms');

      const tenant = keyTenantId ? await resolveTenantById(keyTenantId) : await resolveTenantFromRequest(req);
      if (!tenant) {
        if (isJsonExpected) return reply.status(404).send({ error: 'Web form not found or inactive.' });
        reply.status(404).type('text/html');
        return reply.send(errorHtml('Web form not found or inactive.'));
      }
      const body = req.body || {};
      const result = await webFormsController.submitFormPublic(tenant, String(slug), body, clientIp, {
        skipIpRateLimit: keyTenantId != null,
      });

      if (isJsonExpected) {
        // The SPA/JSON caller follows `redirect_url` (Stripe hosted checkout / plain form redirect).
        return reply.status(200).send({
          success: true,
          redirect_url: result.redirect_url ?? null,
        });
      }

      if (result.redirect_url) {
        return reply.redirect(result.redirect_url);
      }

      return reply.redirect('/api/forms/success');
    } catch (err) {
      fastify.log.error(err);
      const statusCode = httpStatusOf(err) ?? 500;
      // Client errors (4xx: validation, rate limit) carry user-actionable copy; anything 5xx is an
      // unexpected internal failure whose detail must not leak to the public (SECURITY-REVIEW 5.2).
      // Gate on the error's TYPE, not just its status: a framework error with a sub-500
      // statusCode is not client copy.
      const fallback = 'An unexpected error occurred during submission.';
      const message = statusCode < 500 ? publicClientMessageOf(err, fallback) : fallback;

      if (isJsonExpected) {
        return reply.status(statusCode).send({ error: message });
      }

      reply.status(statusCode).type('text/html');
      return reply.send(errorHtml(message));
    }
  });

  done();
};

export default webFormsPublicRoute;

const renderFormHtml = (
  submitAction: string,
  formName: string,
  formDescription: string,
  fields: string[],
  formType: string,
) => {
  const isFieldEnabled = (name: string): boolean => {
    if (formType === 'donation') {
      const alwaysEnabled = ['first_name', 'last_name', 'street1', 'city', 'state', 'zip', 'country'];
      if (alwaysEnabled.includes(name)) return true;
    }
    return fields.includes(name) || fields.includes(`${name}:required`);
  };

  const isFieldRequired = (name: string): boolean => {
    if (formType === 'donation') {
      const alwaysRequired = ['first_name', 'last_name', 'street1', 'city', 'state', 'zip', 'country'];
      if (alwaysRequired.includes(name)) return true;
    }
    return fields.includes(`${name}:required`);
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(formName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
      --accent: #0ea5e9;
      --accent-hover: #0284c7;
      --accent-glow: rgba(14, 165, 233, 0.15);
      --card-bg: rgba(255, 255, 255, 0.8);
      --card-border: #cbd5e1;
      --card-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.08), 0 20px 40px -15px rgba(0, 0, 0, 0.05);
      --text-primary: #1f2937;
      --text-secondary: #6b7280;
      --input-bg: #ffffff;
      --input-border: #cbd5e1;
      --input-focus-border: #0ea5e9;
      --input-focus-ring: rgba(14, 165, 233, 0.15);
      --label-color: #374151;
      --placeholder-color: #9ca3af;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-gradient: linear-gradient(135deg, #0b1220 0%, #0e1726 50%, #060a12 100%);
        --accent: #3ea6ff;
        --accent-hover: #1a8cff;
        --accent-glow: rgba(62, 166, 255, 0.2);
        --card-bg: rgba(19, 30, 49, 0.85);
        --card-border: #1a2b45;
        --card-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
        --text-primary: #f8fafc;
        --text-secondary: #c7d1e5;
        --input-bg: #0b1220;
        --input-border: #1a2b45;
        --input-focus-border: #3ea6ff;
        --input-focus-ring: rgba(62, 166, 255, 0.25);
        --label-color: #cbd5e1;
        --placeholder-color: #4b5563;
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Roboto', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 400;
      background: var(--bg-gradient);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
      position: relative;
      overflow-x: hidden;
    }

    body::before, body::after {
      content: "";
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: var(--accent);
      filter: blur(150px);
      opacity: 0.08;
      z-index: 0;
      pointer-events: none;
    }
    body::before { top: 15%; left: 10%; }
    body::after { bottom: 15%; right: 10%; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-radius: 24px;
      padding: 40px;
      width: 100%;
      max-width: 480px;
      box-shadow: var(--card-shadow);
      z-index: 10;
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }

    .header {
      text-align: center;
      margin-bottom: 32px;
    }

    h1 {
      font-size: 26px;
      font-weight: 500;
      letter-spacing: -0.015em;
      margin-bottom: 8px;
      background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .description {
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.5;
    }

    .form-group {
      margin-bottom: 20px;
      position: relative;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 8px;
      color: var(--label-color);
      letter-spacing: 0.01em;
    }

    input, textarea, select {
      width: 100%;
      padding: 12px 16px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 12px;
      color: var(--text-primary);
      font-size: 14px;
      font-family: inherit;
      transition: all 0.2s ease;
      min-height: 46px;
    }

    input::placeholder, textarea::placeholder {
      color: var(--placeholder-color);
    }

    input:hover, textarea:hover, select:hover {
      border-color: var(--accent);
      opacity: 0.95;
    }

    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--input-focus-border);
      box-shadow: 0 0 0 4px var(--input-focus-ring);
    }

    textarea {
      resize: vertical;
      min-height: 90px;
    }

    button {
      width: 100%;
      padding: 14px 28px;
      background: var(--accent);
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px var(--accent-glow);
      margin-top: 8px;
      min-height: 48px;
    }

    button:hover {
      background: var(--accent-hover);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px var(--accent-glow);
    }

    button:active {
      transform: translateY(0);
    }

    .hp-field {
      display: none !important;
    }

    .footer-note {
      text-align: center;
      margin-top: 24px;
      font-size: 11px;
      color: var(--text-secondary);
      opacity: 0.6;
    }

    .footer-note a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }

    .footer-note a:hover {
      text-decoration: underline;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${escapeHtml(formName)}</h1>
      <p class="description">${escapeHtml(formDescription)}</p>
    </div>

    <form action="${escapeHtml(submitAction)}" method="POST">
      <!-- Honeypot Bot Field (leave empty!) -->
      <input type="text" name="_hp" class="hp-field" tabindex="-1" autocomplete="off" />

      ${
        formType === 'donation'
          ? `
      <div class="form-group">
        <label for="amount">Donation Amount ($ CAD) *</label>
        <input type="number" id="amount" name="amount" min="1" step="any" placeholder="E.g. 50.00" required />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('first_name')
          ? `
      <div class="form-group">
        <label for="first_name">First Name ${isFieldRequired('first_name') ? '*' : ''}</label>
        <input type="text" id="first_name" name="first_name" placeholder="E.g. John" ${isFieldRequired('first_name') ? 'required' : ''} />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('last_name')
          ? `
      <div class="form-group">
        <label for="last_name">Last Name ${isFieldRequired('last_name') ? '*' : ''}</label>
        <input type="text" id="last_name" name="last_name" placeholder="E.g. Doe" ${isFieldRequired('last_name') ? 'required' : ''} />
      </div>`
          : ''
      }

      <div class="form-group">
        <label for="email">Email Address *</label>
        <input type="email" id="email" name="email" placeholder="john@example.com" required />
      </div>

      ${
        isFieldEnabled('street1')
          ? `
      <div class="form-group">
        <label for="street1">Street Address ${isFieldRequired('street1') ? '*' : ''}</label>
        <input type="text" id="street1" name="street1" placeholder="E.g. 123 Main St" ${isFieldRequired('street1') ? 'required' : ''} />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('city')
          ? `
      <div class="form-group">
        <label for="city">City ${isFieldRequired('city') ? '*' : ''}</label>
        <input type="text" id="city" name="city" placeholder="E.g. Toronto" ${isFieldRequired('city') ? 'required' : ''} />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('country')
          ? `
      <div class="form-group">
        <label for="country">Country ${isFieldRequired('country') ? '*' : ''}</label>
        <select id="country" name="country" ${isFieldRequired('country') ? 'required' : ''}>
          <option value="CA">Canada</option>
          <option value="US">United States</option>
          <option value="GB">United Kingdom</option>
          <option value="AU">Australia</option>
        </select>
      </div>`
          : ''
      }

      ${
        isFieldEnabled('state')
          ? `
      <div class="form-group">
        <label for="state">State / Province ${isFieldRequired('state') ? '*' : ''}</label>
        <input type="text" id="state" name="state" placeholder="E.g. ON or NY" ${isFieldRequired('state') ? 'required' : ''} />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('zip')
          ? `
      <div class="form-group">
        <label for="zip">Zip / Postal Code ${isFieldRequired('zip') ? '*' : ''}</label>
        <input type="text" id="zip" name="zip" placeholder="E.g. M5V 2T6" ${isFieldRequired('zip') ? 'required' : ''} />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('mobile')
          ? `
      <div class="form-group">
        <label for="mobile">Mobile / Phone ${isFieldRequired('mobile') ? '*' : ''}</label>
        <input type="text" id="mobile" name="mobile" placeholder="E.g. 555-0199" ${isFieldRequired('mobile') ? 'required' : ''} />
      </div>`
          : ''
      }

      ${
        isFieldEnabled('notes')
          ? `
      <div class="form-group">
        <label for="notes">Notes / Message ${isFieldRequired('notes') ? '*' : ''}</label>
        <textarea id="notes" name="notes" placeholder="How can we help you?" ${isFieldRequired('notes') ? 'required' : ''}></textarea>
      </div>`
          : ''
      }

      <button type="submit">${formType === 'donation' ? 'Next' : 'Submit'}</button>
    </form>

    <div class="footer-note">
      Powered by <a href="#" target="_blank">pplCRM</a>
    </div>
  </div>
</body>
</html>
`;
};
