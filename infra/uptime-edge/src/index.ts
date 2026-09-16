/**
 * uptime-edge — external availability probe for the pplCRM backend.
 *
 * Why this exists: Azure Monitor availability web tests bill per execution and were half the Azure
 * invoice. A Cloudflare cron trigger is free, and it runs OUTSIDE Azure, so it still pages when the
 * whole region is down. See wrangler.toml for the schedule and the target list.
 *
 * Shape:
 *   scheduled()  — the cron entry point. Hands the run to the single Durable Object instance.
 *   UptimeMonitor (Durable Object, SQLite-backed) — probes every target, keeps a consecutive-failure
 *                  count + "alerted" flag per target, and sends the outage / recovery notifications.
 *                  All state lives in the DO so a run needs no KV namespace or other pre-created
 *                  resource: `wrangler deploy` is the whole setup.
 *   fetch()      — GET /status (public, read-only: per-target state as JSON, consumed by the daily
 *                  health report) and POST /test-alert (bearer UPTIME_ADMIN_KEY: sends a real SMS +
 *                  email so the channels can be verified end to end, like Azure's "Test action group").
 *
 * Paging rules:
 *   - A target must fail FAIL_THRESHOLD consecutive runs; each run retries once after RETRY_DELAY_MS.
 *     A single blip therefore never pages.
 *   - An outage pages ONCE (SMS + email). Recovery pages once. Nothing repeats while it stays down.
 *   - Every notification channel fails independently and is logged; one channel being down must not
 *     stop the other.
 */
import { DurableObject } from 'cloudflare:workers';

interface Target {
  key: string;
  url: string;
  expect: number;
}

interface Env {
  MONITOR: { idFromName(name: string): unknown; get(id: unknown): UptimeMonitorStub };
  TARGETS: string;
  FAIL_THRESHOLD: string;
  OPS_ALERT_EMAIL: string;
  OPS_ALERT_SMS_COUNTRY_CODE: string;
  ALERT_FROM_EMAIL: string;
  ALERT_FROM_NAME: string;
  // Secrets (wrangler secret put / CI `secrets:`)
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  OPS_ALERT_SMS_NUMBER?: string;
  POSTMARK_SERVER_TOKEN?: string;
  UPTIME_ADMIN_KEY?: string;
}

interface UptimeMonitorStub {
  runChecks(): Promise<RunSummary>;
  status(): Promise<StatusReport>;
  sendTestAlert(): Promise<ChannelResults>;
}

interface TargetState {
  key: string;
  url: string;
  /** Consecutive failing runs (capped at FAIL_THRESHOLD once alerted). */
  failures: number;
  /** True while an outage notification has been sent and no recovery yet. */
  alerted: boolean;
  lastCheckedAt: string | null;
  lastOk: boolean | null;
  lastDetail: string | null;
  downSince: string | null;
}

interface RunSummary {
  at: string;
  results: { key: string; ok: boolean; detail: string; failures: number; alerted: boolean }[];
}

interface StatusReport {
  lastRunAt: string | null;
  targets: TargetState[];
}

interface ChannelResults {
  sms: string;
  email: string;
}

const RETRY_DELAY_MS = 10_000;
const PROBE_TIMEOUT_MS = 15_000;
const DO_INSTANCE_NAME = 'singleton';

function parseTargets(raw: string): Target[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('TARGETS must be a JSON array');
  return parsed.map((t: unknown) => {
    if (
      typeof t !== 'object' ||
      t === null ||
      typeof (t as Target).key !== 'string' ||
      typeof (t as Target).url !== 'string' ||
      typeof (t as Target).expect !== 'number'
    ) {
      throw new Error('TARGETS entries need string key, string url, number expect');
    }
    return t as Target;
  });
}

async function probeOnce(target: Target): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(target.url, {
      method: 'GET',
      headers: { 'user-agent': 'pplcrm-uptime/1 (+https://pplcrm.com)', 'cache-control': 'no-cache' },
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await res.text()).slice(0, 200);
    const ok = res.status === target.expect;
    return { ok, detail: `HTTP ${res.status}${ok ? '' : ` body=${JSON.stringify(body)}`}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, detail: `fetch failed: ${msg}` };
  }
}

/** One probe with a single in-run retry, so a transient blip does not count as a failing run. */
async function probeWithRetry(target: Target): Promise<{ ok: boolean; detail: string }> {
  const first = await probeOnce(target);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  const second = await probeOnce(target);
  return second.ok ? second : { ok: false, detail: `${first.detail}; retry: ${second.detail}` };
}

async function sendSms(env: Env, body: string): Promise<string> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, OPS_ALERT_SMS_NUMBER } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !OPS_ALERT_SMS_NUMBER) {
    return 'skipped: Twilio secrets or OPS_ALERT_SMS_NUMBER not set';
  }
  // OPS_ALERT_SMS_NUMBER is the same 10-digit national number the Azure action group used; the
  // country code is a separate var so the secret never needs re-entering.
  const to = OPS_ALERT_SMS_NUMBER.startsWith('+')
    ? OPS_ALERT_SMS_NUMBER
    : `+${env.OPS_ALERT_SMS_COUNTRY_CODE}${OPS_ALERT_SMS_NUMBER}`;
  const form = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: to, Body: body });
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    if (!res.ok) return `failed: Twilio HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
    return 'sent';
  } catch (err: unknown) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function sendEmail(env: Env, subject: string, text: string): Promise<string> {
  if (!env.POSTMARK_SERVER_TOKEN) return 'skipped: POSTMARK_SERVER_TOKEN not set';
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: `${env.ALERT_FROM_NAME} <${env.ALERT_FROM_EMAIL}>`,
        To: env.OPS_ALERT_EMAIL,
        Subject: subject,
        TextBody: text,
        MessageStream: 'outbound',
        Tag: 'uptime-alert',
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return `failed: Postmark HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
    return 'sent';
  } catch (err: unknown) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function notify(env: Env, subject: string, text: string): Promise<ChannelResults> {
  const [sms, email] = await Promise.all([sendSms(env, `${subject}\n${text}`), sendEmail(env, subject, text)]);
  console.log(JSON.stringify({ event: 'notify', subject, sms, email }));
  return { sms, email };
}

export class UptimeMonitor extends DurableObject<Env> {
  private get sql() {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS target_state (
      key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      failures INTEGER NOT NULL DEFAULT 0,
      alerted INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_ok INTEGER,
      last_detail TEXT,
      down_since TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
  }

  private readState(target: Target): TargetState {
    const row = this.sql
      .exec<{
        key: string;
        url: string;
        failures: number;
        alerted: number;
        last_checked_at: string | null;
        last_ok: number | null;
        last_detail: string | null;
        down_since: string | null;
      }>('SELECT * FROM target_state WHERE key = ?', target.key)
      .toArray()[0];
    if (!row) {
      return {
        key: target.key,
        url: target.url,
        failures: 0,
        alerted: false,
        lastCheckedAt: null,
        lastOk: null,
        lastDetail: null,
        downSince: null,
      };
    }
    return {
      key: row.key,
      url: row.url,
      failures: row.failures,
      alerted: row.alerted === 1,
      lastCheckedAt: row.last_checked_at,
      lastOk: row.last_ok == null ? null : row.last_ok === 1,
      lastDetail: row.last_detail,
      downSince: row.down_since,
    };
  }

  private writeState(s: TargetState): void {
    this.sql.exec(
      `INSERT INTO target_state (key, url, failures, alerted, last_checked_at, last_ok, last_detail, down_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET url = excluded.url, failures = excluded.failures,
         alerted = excluded.alerted, last_checked_at = excluded.last_checked_at, last_ok = excluded.last_ok,
         last_detail = excluded.last_detail, down_since = excluded.down_since`,
      s.key,
      s.url,
      s.failures,
      s.alerted ? 1 : 0,
      s.lastCheckedAt,
      s.lastOk == null ? null : s.lastOk ? 1 : 0,
      s.lastDetail,
      s.downSince,
    );
  }

  async runChecks(): Promise<RunSummary> {
    this.ensureSchema();
    const targets = parseTargets(this.env.TARGETS);
    const threshold = Math.max(1, Number.parseInt(this.env.FAIL_THRESHOLD, 10) || 2);
    const now = new Date().toISOString();

    const probes = await Promise.all(targets.map(async (t) => ({ target: t, result: await probeWithRetry(t) })));

    const summary: RunSummary = { at: now, results: [] };
    for (const { target, result } of probes) {
      const state = this.readState(target);
      state.url = target.url;
      state.lastCheckedAt = now;
      state.lastOk = result.ok;
      state.lastDetail = result.detail;

      if (result.ok) {
        if (state.alerted) {
          const downFor = state.downSince ? minutesBetween(state.downSince, now) : null;
          await notify(
            this.env,
            `[pplCRM] RECOVERED: ${target.key} is back`,
            `${target.url} answered ${result.detail} at ${now}.` +
              (downFor == null ? '' : ` Down since ${state.downSince} (~${downFor} min).`),
          );
        }
        state.failures = 0;
        state.alerted = false;
        state.downSince = null;
      } else {
        state.failures = Math.min(state.failures + 1, threshold);
        state.downSince = state.downSince ?? now;
        if (!state.alerted && state.failures >= threshold) {
          await notify(
            this.env,
            `[pplCRM] DOWN: ${target.key} unreachable`,
            `${target.url} failed ${state.failures} consecutive checks (each with one retry). Last: ${result.detail}. First failure ${state.downSince}. Runbook: pplcrm-observability skill.`,
          );
          state.alerted = true;
        }
      }
      this.writeState(state);
      summary.results.push({
        key: target.key,
        ok: result.ok,
        detail: result.detail,
        failures: state.failures,
        alerted: state.alerted,
      });
    }
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('last_run_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, now);
    console.log(JSON.stringify({ event: 'run', ...summary }));
    return summary;
  }

  async status(): Promise<StatusReport> {
    this.ensureSchema();
    const last = this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'last_run_at'`).toArray()[0];
    const targets = parseTargets(this.env.TARGETS).map((t) => this.readState(t));
    return { lastRunAt: last?.v ?? null, targets };
  }

  async sendTestAlert(): Promise<ChannelResults> {
    return notify(
      this.env,
      '[pplCRM] TEST alert from the uptime probe',
      `This is a test of the outage notification channels, sent at ${new Date().toISOString()}. No action needed.`,
    );
  }
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}

function monitor(env: Env): UptimeMonitorStub {
  return env.MONITOR.get(env.MONITOR.idFromName(DO_INSTANCE_NAME));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(monitor(env).runChecks());
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/status') {
      return json(await monitor(env).status());
    }

    if (request.method === 'POST' && url.pathname === '/test-alert') {
      const auth = request.headers.get('authorization') ?? '';
      if (!env.UPTIME_ADMIN_KEY || auth !== `Bearer ${env.UPTIME_ADMIN_KEY}`) {
        return json({ error: 'forbidden' }, 403);
      }
      return json(await monitor(env).sendTestAlert());
    }

    return json({ service: 'pplcrm-uptime', endpoints: ['GET /status', 'POST /test-alert'] }, 404);
  },
};
