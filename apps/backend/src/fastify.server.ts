import * as Sentry from '@sentry/node';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';

import fastify from 'fastify';

import jsendPlugin from './app/plugins/jsend-error-handler.plugin';
import { helmetOptions } from './app/plugins/security-headers';
import { routes } from './app/routes';
import { trpcRouter } from './app/modules/trpc';
import { createContext } from './context';
import { env } from './env';

export class FastifyServer {
  private readonly server;

  constructor(opts: object = {}) {
    // Create Fastify instance with logging and common config.
    // pino-pretty is a dev-only formatter and is expensive/blocking under load, so use it only
    // outside production; production emits plain JSON logs for log shippers (SECURITY-REVIEW 4.6).
    const isProduction = process.env['NODE_ENV'] === 'production';
    this.server = fastify({
      logger: {
        level: 'info',
        ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
      },
      // Derive req.ip from X-Forwarded-For only for the proxy hops we actually trust
      // (configurable via TRUST_PROXY). Security decisions must use req.ip, never the
      // raw header, which any client can spoof.
      trustProxy: env.trustProxy,
      routerOptions: {
        ignoreTrailingSlash: true,
        // find-my-way's default is 100 chars, silently 404ing any longer path param. The
        // unsubscribe token (base64url JSON payload + HMAC, /api/unsubscribe/:token) runs
        // ~140-490 chars depending on email length — 1024 leaves comfortable headroom.
        maxParamLength: 1024,
      },
      exposeHeadRoutes: false,
    });

    // Report unhandled route errors to Sentry (no-op when SENTRY_DSN is unset — see instrument.ts).
    // tRPC errors don't reach Fastify's error handler; those are captured in trpc.ts instead.
    Sentry.setupFastifyErrorHandler(this.server);

    // Globally serialize BigInt properties as strings in responses
    this.server.setReplySerializer((payload) =>
      JSON.stringify(payload, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
    );

    // Register core Fastify plugins.
    // Restrict cross-origin requests to the SPA origin and allow credentials so the browser sends
    // the HttpOnly refresh cookie on same-site XHR (SECURITY-REVIEW 2.1). `origin`/`credentials`
    // are forced AFTER the opts spread so a caller can't accidentally widen them to a wildcard —
    // credentialed CORS with `*` is rejected by browsers anyway, and a wildcard origin would let any
    // site drive the API on behalf of a user whose bearer token it has (SECURITY-REVIEW 4.4).
    this.server.register(cors, { ...opts, origin: env.appUrl, credentials: true });
    // Parse/serialize cookies (refresh-token cookie). Registered before routes/tRPC so req.cookies
    // and reply.setCookie are available in handlers and the tRPC context.
    this.server.register(cookie);
    // Security headers (CSP, HSTS, nosniff, frame-ancestors, referrer-policy). See
    // security-headers.ts for why each directive is set the way it is.
    this.server.register(helmet, helmetOptions);
    this.server.register(sensible);
    this.server.register(multipart, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    });
    this.server.register(jsendPlugin);

    // Register a content type parser for application/json that keeps raw body if path is webhook
    this.server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      if (
        req.url.includes('/billing/webhook') ||
        req.url.includes('/donations/webhook') ||
        req.url.includes('/newsletters/webhook')
      ) {
        done(null, body);
      } else {
        try {
          done(null, JSON.parse(body as string));
        } catch (err) {
          done(err as Error, null);
        }
      }
    });

    // Register REST routes
    this.server.register(routes);

    // Register tRPC plugin for RPC-based APIs
    this.server.register(fastifyTRPCPlugin, {
      prefix: '/',
      trpcOptions: {
        router: trpcRouter,
        createContext,
      },
    });
  }

  public async close(): Promise<void> {
    return await this.server.close();
  }

  public async serve(): Promise<void> {
    try {
      const address = await this.server.listen({ port: env.port, host: env.host });
      this.server.log.info(`[ ready ] ${address}`);
    } catch (err) {
      this.server.log.error(err);
      process.exit(1);
    }
  }
}
