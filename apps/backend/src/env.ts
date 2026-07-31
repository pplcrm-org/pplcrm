import { z } from 'zod';

// Exported for env.spec.ts, which builds valid parsed-env fixtures from it.
export const envSchema = z.object({
  HOST: z.string().default('localhost'),
  PORT: z.coerce.number().default(3000),
  // Git commit SHA of the running build. Baked into the production image by the Docker build
  // (deploy.yml passes --build-arg BUILD_SHA=<github.sha>; the Dockerfile turns it into an ENV).
  // /healthz reports it so the post-deploy smoke test can verify the revision actually serving
  // traffic is the one just deployed — not an old revision left up by a failed single-revision
  // rollover. 'dev' everywhere outside a CI-built image.
  BUILD_SHA: z.string().optional().default('dev'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_PORT: z.coerce.number().default(5432),
  DB_HOST: z.string().default('localhost'),
  // S-2 (schema review 2026-07-06): least-privilege role split. DB_USER is the
  // runtime role (CRUD only, not an object owner, cannot bypass RLS). Migrations
  // need DDL and object ownership, so they connect as DB_MIGRATION_USER (the
  // owner role). When these are unset they fall back to DB_USER/DB_PASSWORD, so
  // a single-role setup keeps working unchanged.
  DB_MIGRATION_USER: z.string().optional(),
  DB_MIGRATION_PASSWORD: z.string().optional(),
  // Whether the serve process runs pending migrations at boot. Convenient in dev
  // (default true); set to false in production, where migrations are a separate
  // deploy step run as the owner role and the runtime role has no DDL rights.
  MIGRATE_ON_BOOT: z
    .string()
    .optional()
    .default('true')
    .transform((val) => val !== 'false'),
  DB_SSL: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  API_URL: z.string().url().default('http://localhost:3000'),
  APP_URL: z.string().url().default('http://localhost:4200'),
  // Public origin of the volunteer companion app (/t and /r links). Prod: https://go.pplcrm.com —
  // must match the frontend's environment.companionOrigin or emailed links 404.
  COMPANION_URL: z.string().url().default('http://localhost:4300'),
  SHARED_SECRET: z.string().min(1, 'SHARED_SECRET is required'),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_TENANT_ID: z.string().optional().default('common'),
  MS_REDIRECT_URI: z.string().optional().default('http://localhost:3000/auth/ms/callback'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional().default('http://localhost:3000/auth/google/callback'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional().default('UseDevelopmentStorage=true'),
  AZURE_STORAGE_CONTAINER: z.string().optional().default('uploads'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PLAN_GRASSROOTS_PRICE_ID: z.string().optional(),
  STRIPE_PLAN_MOVEMENT_PRICE_ID: z.string().optional(),
  // Annual (interval = year) graduated prices — unit amounts are exactly 10× the monthly ones
  // ("2 months free"; see libs/common/src/lib/billing/plans.ts → Stripe ops).
  STRIPE_PLAN_GRASSROOTS_ANNUAL_PRICE_ID: z.string().optional(),
  STRIPE_PLAN_MOVEMENT_ANNUAL_PRICE_ID: z.string().optional(),
  // Signing secret of the platform's CONNECT webhook endpoint ("Listen to events on connected
  // accounts") — routes donation events for every tenant's connected account; tenants no longer
  // hold webhook secrets of their own.
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  // Platform application fee on Stripe card donations, as a percent of the gift (decided
  // 2026-07-16: 1%; campaign pays Stripe's own processing fees directly on top). Percent-only
  // because recurring donations support only `application_fee_percent`.
  DONATIONS_PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(1),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  POSTMARK_FROM_EMAIL: z.string().email().default('hello@pplcrm.com'),
  // Display name on transactional email; without it, clients fall back to the Postmark
  // sender-signature name (a personal name), which reads wrong on product email.
  POSTMARK_FROM_NAME: z.string().min(1).default('pplCRM'),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_WEBHOOK_VERIFICATION_KEY: z.string().optional(),
  // SendGrid subuser that free-tier newsletter traffic is routed through when the platform key
  // is used and the tenant has no whitelabel subuser of its own. Isolates free-tier sending
  // reputation (IP pool) from paying customers'.
  SENDGRID_FREE_TIER_SUBUSER: z.string().optional(),
  // Platform sending domain a tenant can send from instead of authenticating its own (the
  // Gmail-user answer: you cannot DKIM-sign as gmail.com, so a From address there can never pass
  // DMARC). Tenants send as `<tenant slug>@<this domain>` with their own address as Reply-To.
  //
  // MUST NOT be the domain POSTMARK_FROM_EMAIL sends from. Reputation at Gmail/Yahoo is tracked
  // on the From domain and the DKIM d= domain regardless of which ESP carried the mail, so
  // pointing this at pplcrm.com would let a tenant's spam complaints degrade delivery of password
  // resets and email verification. It needs its own SendGrid domain authentication (its own DKIM
  // keys, d=send.pplcrm.com) and its own DMARC record. Unset = the shared-domain option is off
  // and every tenant must authenticate a domain of its own.
  SENDGRID_SHARED_SENDING_DOMAIN: z.string().optional(),
  // Shared secret Postmark is configured to send in the X-Postmark-Webhook-Token header of
  // bounce/complaint webhooks. The webhook rejects requests without it.
  POSTMARK_WEBHOOK_TOKEN: z.string().optional(),
  // Where the ops watchdog cron emails its failed-jobs/backlog digest (via Postmark, directly —
  // not through the job queue). Unset = digest is logged but not emailed. Also where the beta
  // signup approve/decline mail goes (falling back to POSTMARK_FROM_EMAIL).
  OPS_ALERT_EMAIL: z.string().email().optional(),
  // Beta gate: new tenants land in `approval_status = 'pending'` and cannot be signed into until
  // pplCRM ops approves them. Setting this to 'true' auto-approves on signup instead, which is
  // what local dev and the test suite want (nobody is there to click the ops link).
  //
  // An EXPLICIT opt-in, never merely "NODE_ENV !== production": an unset NODE_ENV must not
  // silently open a gate whose whole job is to keep strangers out (same rule as
  // ALLOW_MOCK_PAYMENTS below). The gate on the sign-in side is unconditional — this only
  // decides the status a brand-new tenant starts in.
  AUTO_APPROVE_TENANTS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  // Sentry error tracking. Unset = Sentry disabled entirely (no startup cost, no traffic).
  // NOTE: instrument.ts reads this from process.env directly (it must run before this file's
  // parse); it is declared here so the schema stays the single inventory of backend config.
  SENTRY_DSN: z.string().optional(),
  // Anthropic Claude API key for the newsletter preflight's AI content review. Optional — when
  // unset the preflight scores from the deterministic lint alone (fail-open, layer skipped).
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
  // Twilio SMS (companion verification codes). All optional — the SMS service
  // logs a dev mock instead of sending when these are unset.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  WEBAUTHN_RP_ID: z.string().optional().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().optional().default('pplCRM'),
  // Base domain that tenant subdomains hang off of (`<slug>.<baseDomain>`). Public pages (forms,
  // event RSVP, volunteer signup, donations) resolve the tenant from the Host header against this.
  // Dev default is 'localhost' so `<slug>.localhost` works.
  PUBLIC_BASE_DOMAIN: z.string().optional().default('localhost'),
  // Controls how Fastify derives `req.ip` from the X-Forwarded-For chain. Never trust the raw header
  // for security decisions (rate limiting) — a client can spoof it. Set this to your real topology:
  //   'false' (default) — trust nothing; `req.ip` is the socket address (correct for local/dev).
  //   '<n>'             — trust n proxy hops closest to the server (e.g. '1' behind a single LB).
  //   '<ip,cidr,…>'     — trust these proxy addresses/subnets.
  TRUST_PROXY: z.string().optional().default('false'),
  // How many background jobs the worker may process concurrently. One slow job (a large sync or
  // import) must not block latency-sensitive mail behind it, so we run a small bounded pool of
  // claimers (each uses `SELECT … FOR UPDATE SKIP LOCKED`, so concurrent claiming is safe). Keep
  // this comfortably below the Postgres pool size. Default 4.
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  // Max real Google Geocoding API calls per tenant per calendar day. A large voter-file import is
  // spread across days at this rate instead of geocoding the whole list in one night (see
  // lib/gis/geocode-queue.ts). Caps daily Google spend per tenant; only bites very large imports.
  GEOCODE_DAILY_BUDGET: z.coerce.number().int().min(1).default(25000),
  // Max connections in the shared pg pool. The API server, the job worker (up to
  // WORKER_CONCURRENCY concurrent claimers), the webhook worker, and LISTEN/NOTIFY
  // listeners all draw from this pool, so keep it comfortably above WORKER_CONCURRENCY
  // and well under Postgres max_connections. Default 20 (pg's own default is 10).
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  // Money-touching mock paths (unsigned donation-webhook parsing, mock donation writer) require an
  // EXPLICIT opt-in, never merely "NODE_ENV !== production" — an unset NODE_ENV must not silently
  // accept forged payment data (SECURITY-REVIEW 4.2). Only ever set this in local dev.
  ALLOW_MOCK_PAYMENTS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  // Auto-passing domain verification when no valid SendGrid key is configured requires an
  // EXPLICIT opt-in, never merely "key is missing" — a misconfigured key in a real deploy
  // must not silently mark sending domains verified and open the send guards. Only ever
  // set this in local dev.
  ALLOW_MOCK_DOMAIN_VERIFICATION: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  // S-4 (schema review 2026-07-06): key material for encrypting OAuth mailbox
  // tokens at rest (ms/google_oauth_tokens.access_token/refresh_token). Any
  // high-entropy string — a 32-byte AES key is derived from it via SHA-256. When
  // unset, tokens are stored as plaintext (the pre-encryption behavior), so this
  // MUST be set in any environment that connects real mailboxes. Rotating it
  // invalidates existing encrypted tokens (users just re-consent).
  OAUTH_TOKEN_ENC_KEY: z.string().optional(),
});

/**
 * Coerce TRUST_PROXY into the shape Fastify's `trustProxy` option accepts.
 *
 * This is a security setting, not a convenience one. We always deploy behind a proxy (Cloudflare
 * -> Azure Container Apps), so with `trustProxy: false` every request reports the proxy's address
 * as `req.ip` — which collapses every per-IP rate limit in the app (sign-in attempts, public form
 * submissions, companion token endpoints) into one shared bucket. Silently defaulting to `false`
 * in production is therefore a failure, not a safe fallback: refuse to boot instead.
 */
function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim();

  if (value === '' || value.toLowerCase() === 'false') {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'TRUST_PROXY must be set in production (e.g. TRUST_PROXY=1 for a single proxy hop). ' +
          'Without it every per-IP rate limit keys on the proxy address instead of the client.',
      );
    }
    return false;
  }
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Minimum length for a secret that signs or encrypts something. Not a strength
 * measure — just a floor that catches a placeholder or a truncated secretref.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Refuse to boot in production when a security-relevant credential is missing or
 * obviously a placeholder.
 *
 * This exists because the failure mode of an unresolved secret is *silent degradation*,
 * not an error, and that has already bitten twice:
 *
 *  - An unset STRIPE_SECRET_KEY puts billing into "mock mode" (`stripe === null`), which
 *    is what `activateMockPlan` used to gate on — so a typo'd secretref let any tenant
 *    owner self-grant the top plan (finding C3).
 *  - An unset OAUTH_TOKEN_ENC_KEY makes `encryptSecret()` a pass-through, storing every
 *    tenant's Gmail/Graph refresh token in cleartext with no warning (finding H5).
 *
 * A deploy that cannot reach its secrets must fail loudly rather than come up degraded.
 * Mirrors the long-standing TRUST_PROXY guard above.
 */
export function assertProductionSecrets(parsed: z.infer<typeof envSchema>): void {
  if (process.env['NODE_ENV'] !== 'production') return;

  const problems: string[] = [];

  if (parsed.SHARED_SECRET.trim().length < MIN_SECRET_LENGTH) {
    problems.push(
      `SHARED_SECRET must be at least ${MIN_SECRET_LENGTH} characters — it signs session JWTs and scoped download tokens.`,
    );
  }
  if (!parsed.OAUTH_TOKEN_ENC_KEY || parsed.OAUTH_TOKEN_ENC_KEY.trim().length < MIN_SECRET_LENGTH) {
    problems.push(
      `OAUTH_TOKEN_ENC_KEY must be set (at least ${MIN_SECRET_LENGTH} characters) — without it mailbox OAuth tokens are stored as plaintext.`,
    );
  }
  if (!parsed.STRIPE_SECRET_KEY?.trim() || parsed.STRIPE_SECRET_KEY.includes('MockKey')) {
    problems.push('STRIPE_SECRET_KEY must be set to a real key — an unset key silently enables billing mock mode.');
  }
  if (!parsed.STRIPE_CONNECT_WEBHOOK_SECRET?.trim()) {
    problems.push(
      'STRIPE_CONNECT_WEBHOOK_SECRET must be set — without it every donation webhook is rejected, so donations are never recorded while donors are still charged.',
    );
  }
  if (!parsed.SENDGRID_WEBHOOK_VERIFICATION_KEY?.trim()) {
    problems.push(
      'SENDGRID_WEBHOOK_VERIFICATION_KEY must be set — without it bounce/spam-complaint events are never recorded, so suppressions and the bounce tripwires go dead.',
    );
  }
  if (!parsed.POSTMARK_WEBHOOK_TOKEN?.trim()) {
    problems.push(
      'POSTMARK_WEBHOOK_TOKEN must be set — without it every inbound Postmark delivery/bounce event is rejected.',
    );
  }
  if (parsed.ALLOW_MOCK_PAYMENTS) {
    problems.push('ALLOW_MOCK_PAYMENTS must never be set in production — it accepts forged payment data.');
  }
  if (parsed.ALLOW_MOCK_DOMAIN_VERIFICATION) {
    problems.push(
      'ALLOW_MOCK_DOMAIN_VERIFICATION must never be set in production — it marks sending domains verified without checking.',
    );
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start in production with an insecure configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

const parsedEnv = envSchema.parse(process.env);
assertProductionSecrets(parsedEnv);

export const env = {
  host: parsedEnv.HOST,
  port: parsedEnv.PORT,
  buildSha: parsedEnv.BUILD_SHA,
  db: {
    user: parsedEnv.DB_USER,
    database: parsedEnv.DB_NAME,
    password: parsedEnv.DB_PASSWORD,
    port: parsedEnv.DB_PORT,
    host: parsedEnv.DB_HOST,
    ssl: parsedEnv.DB_SSL,
  },
  // Same target database, but connecting as the owner role for DDL/migrations.
  // Falls back to the runtime credentials when the migration role is unset.
  migrationDb: {
    user: parsedEnv.DB_MIGRATION_USER ?? parsedEnv.DB_USER,
    database: parsedEnv.DB_NAME,
    password: parsedEnv.DB_MIGRATION_PASSWORD ?? parsedEnv.DB_PASSWORD,
    port: parsedEnv.DB_PORT,
    host: parsedEnv.DB_HOST,
    ssl: parsedEnv.DB_SSL,
  },
  migrateOnBoot: parsedEnv.MIGRATE_ON_BOOT,
  apiUrl: parsedEnv.API_URL,
  appUrl: parsedEnv.APP_URL,
  companionUrl: parsedEnv.COMPANION_URL,
  publicBaseDomain: parsedEnv.PUBLIC_BASE_DOMAIN,
  trustProxy: parseTrustProxy(parsedEnv.TRUST_PROXY),
  workerConcurrency: parsedEnv.WORKER_CONCURRENCY,
  geocodeDailyBudget: parsedEnv.GEOCODE_DAILY_BUDGET,
  dbPoolMax: parsedEnv.DB_POOL_MAX,
  allowMockPayments: parsedEnv.ALLOW_MOCK_PAYMENTS,
  allowMockDomainVerification: parsedEnv.ALLOW_MOCK_DOMAIN_VERIFICATION,
  oauthTokenEncKey: parsedEnv.OAUTH_TOKEN_ENC_KEY,
  sharedSecret: parsedEnv.SHARED_SECRET,
  msClientId: parsedEnv.MS_CLIENT_ID,
  msClientSecret: parsedEnv.MS_CLIENT_SECRET,
  msTenantId: parsedEnv.MS_TENANT_ID,
  msRedirectUri: parsedEnv.MS_REDIRECT_URI,
  googleClientId: parsedEnv.GOOGLE_CLIENT_ID,
  googleClientSecret: parsedEnv.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: parsedEnv.GOOGLE_REDIRECT_URI,
  azureStorageConnectionString: parsedEnv.AZURE_STORAGE_CONNECTION_STRING,
  azureStorageContainer: parsedEnv.AZURE_STORAGE_CONTAINER,
  stripeSecretKey: parsedEnv.STRIPE_SECRET_KEY,
  stripeWebhookSecret: parsedEnv.STRIPE_WEBHOOK_SECRET,
  stripePlanGrassrootsPriceId: parsedEnv.STRIPE_PLAN_GRASSROOTS_PRICE_ID,
  stripePlanMovementPriceId: parsedEnv.STRIPE_PLAN_MOVEMENT_PRICE_ID,
  stripePlanGrassrootsAnnualPriceId: parsedEnv.STRIPE_PLAN_GRASSROOTS_ANNUAL_PRICE_ID,
  stripePlanMovementAnnualPriceId: parsedEnv.STRIPE_PLAN_MOVEMENT_ANNUAL_PRICE_ID,
  stripeConnectWebhookSecret: parsedEnv.STRIPE_CONNECT_WEBHOOK_SECRET,
  donationsPlatformFeePercent: parsedEnv.DONATIONS_PLATFORM_FEE_PERCENT,
  postmarkServerToken: parsedEnv.POSTMARK_SERVER_TOKEN,
  postmarkFromEmail: parsedEnv.POSTMARK_FROM_EMAIL,
  postmarkFromName: parsedEnv.POSTMARK_FROM_NAME,
  sendgridApiKey: parsedEnv.SENDGRID_API_KEY,
  sendgridWebhookVerificationKey: parsedEnv.SENDGRID_WEBHOOK_VERIFICATION_KEY,
  sendgridFreeTierSubuser: parsedEnv.SENDGRID_FREE_TIER_SUBUSER,
  sendgridSharedSendingDomain: parsedEnv.SENDGRID_SHARED_SENDING_DOMAIN,
  postmarkWebhookToken: parsedEnv.POSTMARK_WEBHOOK_TOKEN,
  opsAlertEmail: parsedEnv.OPS_ALERT_EMAIL,
  autoApproveTenants: parsedEnv.AUTO_APPROVE_TENANTS,
  sentryDsn: parsedEnv.SENTRY_DSN,
  anthropicApiKey: parsedEnv.ANTHROPIC_API_KEY,
  anthropicModel: parsedEnv.ANTHROPIC_MODEL,
  twilioAccountSid: parsedEnv.TWILIO_ACCOUNT_SID,
  twilioAuthToken: parsedEnv.TWILIO_AUTH_TOKEN,
  twilioFromNumber: parsedEnv.TWILIO_FROM_NUMBER,
  googleMapsApiKey: parsedEnv.GOOGLE_MAPS_API_KEY ?? process.env['VITE_GOOGLE_MAPS_API_KEY'] ?? '',
  webAuthnRpId: parsedEnv.WEBAUTHN_RP_ID,
  webAuthnRpName: parsedEnv.WEBAUTHN_RP_NAME,
};
