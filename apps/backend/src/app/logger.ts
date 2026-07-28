import * as pino from 'pino';

// pino-pretty is a dev-only formatter and is expensive/blocking under load, so use it only outside
// production; production emits plain JSON logs for log shippers (same rule as fastify.server.ts).
const isProduction = process.env['NODE_ENV'] === 'production';

/**
 * Fields scrubbed from every log record (finding M9).
 *
 * Logs are shipped and retained, so anything credential-shaped that reaches them is a
 * secret with a much longer life than intended. The concrete case: a failing Zapier
 * integration logged its full `webhook_url` on every attempt, and a Zapier/Make hook URL
 * is a bearer secret — anyone holding it can post into the tenant's workflows.
 *
 * This is a backstop, not permission to log secrets: prefer not passing them at all.
 * Paths are matched exactly, plus a wildcard form for nested objects.
 */
const REDACTED_PATHS = [
  'password',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'webhook_url',
  'webhookUrl',
  'sessionId',
  'session_id',
];

export const logger = pino.pino({
  level: 'info',
  redact: {
    paths: [
      ...REDACTED_PATHS,
      ...REDACTED_PATHS.map((p) => `*.${p}`),
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
  ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
});
