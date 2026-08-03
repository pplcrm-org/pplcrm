import { logger } from './app/logger';

type ShutdownCause = NodeJS.Signals | 'unhandledRejection' | 'uncaughtException';
type ShutdownHandler = (ctx: { signal: ShutdownCause }) => Promise<void> | void;

// How long to let in-flight work drain before force-exiting. The handler stops the job
// workers (which await their in-flight jobs) and closes the HTTP server + DB pool, so this
// must be generous enough for a running job/request to finish. Keep it comfortably under the
// orchestrator's own termination grace period (Kubernetes default is 30s). This timer is a
// fallback for a hung drain, not the normal path — a clean drain clears it and exits 0.
// (The previous 500ms default force-killed every deploy mid-drain.)
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export function onShutdown(
  handler: ShutdownHandler,
  { timeout = DEFAULT_SHUTDOWN_TIMEOUT_MS }: { timeout?: number } = {},
): void {
  let shuttingDown = false;

  const runDrain = (cause: ShutdownCause, exitCode: number): void => {
    // A second signal (or an error thrown mid-drain) must not restart the handler or
    // re-arm the kill timer.
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      const timer = setTimeout(() => {
        logger.error(`Shutdown drain exceeded ${timeout}ms; forcing exit.`);
        process.exit(1);
      }, timeout);
      try {
        await handler({ signal: cause });
        clearTimeout(timer);
        process.exit(exitCode);
      } catch (err) {
        clearTimeout(timer);
        logger.error(err, 'Shutdown handler failed');
        process.exit(1);
      }
    })();
  };

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => runDrain(signal, 0));
  }

  // An escaping rejection or exception used to take Node's default path: die with no structured
  // log line and no worker drain, leaving claimed jobs in 'processing' until stale recovery
  // reclaimed them ~30 minutes later. Log it, then exit through the same drain as a signal so
  // in-flight jobs are handed back while the process can still reach the database. (When Sentry
  // is enabled, its own global integrations capture these events; nothing extra to send here.)
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection; draining and exiting');
    runDrain('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception; draining and exiting');
    runDrain('uncaughtException', 1);
  });
}
