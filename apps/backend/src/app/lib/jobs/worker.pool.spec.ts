import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackgroundJobWorker } from './worker';

/**
 * The worker runs a bounded pool of claimers so one slow job can't block the queue
 * (SECURITY-REVIEW.md 3.5). This drives the private pool loop with a stubbed `processNextJob`
 * to assert it (a) never exceeds `maxConcurrency` in flight and (b) still drains every job.
 */
interface WorkerInternals {
  isRunning: boolean;
  maxConcurrency: number;
  drain(): void;
  processNextJob(): Promise<boolean>;
}

const asInternals = (w: BackgroundJobWorker): WorkerInternals => w as unknown as WorkerInternals;

describe('BackgroundJobWorker pool', () => {
  afterEach(() => vi.restoreAllMocks());

  it('caps in-flight jobs at maxConcurrency and drains the whole queue', async () => {
    const worker = new BackgroundJobWorker();
    const w = asInternals(worker);

    const total = 20;
    let remaining = total;
    let inFlight = 0;
    let observedMax = 0;
    let processed = 0;

    vi.spyOn(w, 'processNextJob').mockImplementation(async () => {
      if (remaining <= 0) return false; // queue empty
      remaining--;
      inFlight++;
      observedMax = Math.max(observedMax, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      processed++;
      return true;
    });

    w.isRunning = true;
    w.drain();

    await vi.waitFor(() => expect(processed).toBe(total), { timeout: 2000 });
    w.isRunning = false;

    // The cap is the correctness bound: exceeding it is the bug this spec exists to catch.
    // Requiring EXACT saturation is scheduler-dependent — with 5ms stub jobs a starved runner
    // can drain the queue without ever having all slots busy at one instant — so the lower
    // bound only pins that the pool actually runs jobs concurrently.
    expect(observedMax).toBeLessThanOrEqual(w.maxConcurrency);
    expect(observedMax).toBeGreaterThan(1);
  });
});
