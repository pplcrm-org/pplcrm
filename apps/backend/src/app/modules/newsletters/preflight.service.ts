import { createHash } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Kysely, Transaction } from 'kysely';

import {
  AiPreflightVerdictObj,
  buildAiFindings,
  buildSpamAssassinFinding,
  computeScore,
  lintNewsletterContent,
  preflightBand,
  preflightHashInput,
  type AiPreflightVerdict,
  type PreflightFinding,
  type PreflightResult,
  type RunPreflightType,
} from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../env';
import { PreconditionFailedError } from '../../errors/app-errors';
import { logger } from '../../logger';
import { checkDurableRateLimit } from '../../lib/durable-rate-limiter';
import { htmlToPlainText } from '../../lib/mail/newsletter-render';

/**
 * Newsletter preflight: assembles the deliverability score from the shared deterministic lint,
 * an optional SpamAssassin pass (Postmark spamcheck, interactive checks only), and a Claude
 * content review. Results are cached in newsletter_content_checks keyed on (tenant, content
 * hash), so the send-time gate normally reuses the composer's check instead of re-spending.
 *
 * Fail-open by design: if the Anthropic key is unset or the API errors, the score comes from the
 * lint alone and `aiStatus` is 'unavailable' — the engagement tripwires in send-guards remain the
 * backstop. Only the score itself gates sending (band 'blocked' → PreconditionFailedError).
 *
 * Every check includes the AI review, deliberately even for long-established tenants: the threat
 * it uniquely stops pre-send is a compromised account blasting semantically-clean-linked phishing
 * through shared sending infrastructure, and that risk grows (not shrinks) with tenure and list
 * size. Per-check cost is cents and bounded by the interactive rate limit + send caps.
 */

type Db = Kysely<Models> | Transaction<Models>;

/** Interactive AI checks per tenant per hour (the send-time gate is not rate limited). */
const AI_CHECKS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
/** Characters of body text handed to the AI review — enough for any real newsletter. */
const AI_TEXT_CAP = 8_000;
const AI_MAX_TOKENS = 2_048;
/** Wall-clock budget for one Claude call; beyond this the layer is skipped (fail-open). */
const AI_TIMEOUT_MS = 20_000;
const SPAMCHECK_URL = 'https://spamcheck.postmarkapp.com/filter';
const SPAMCHECK_TIMEOUT_MS = 6_000;

const AI_SYSTEM_PROMPT = `You review outbound bulk email for pplCRM, a CRM for political campaigns, nonprofits and community organizations. Their newsletters legitimately include fundraising appeals, donation asks, silent-auction and event promotion, volunteer recruitment, and advocacy — none of that counts as spam or commercial marketing here.

Classify the message and rate how spam-like the copy itself reads, independent of topic:
- contentType "pure_commercial_marketing" means selling unrelated products or services (retail promos, affiliate/crypto/MLM blasts) — NOT fundraising, auctions, merchandise or tickets for the organization's own cause.
- contentType "scam_or_phishing" means credential bait, fake invoices or receipts, impersonating another organization, or harvesting payment details.
- spamRiskScore: 0 for clean copy up to 100 for unmistakable spam patterns (deceptive urgency, too-good-to-be-true claims, bait-and-switch, disguised sender identity).
- deceptionFlags: a short label per deceptive pattern actually present.
- suggestions: up to three concrete rewrites of the worst lines.

Judge only the provided content — do not invent problems, and reserve "pure_commercial_marketing" and "scam_or_phishing" for clear cases.`;

interface NewsletterContentRow {
  id: string;
  subject: string | null;
  html_content: string | null;
  plain_text_content: string | null;
}

interface CheckOptions {
  newsletterId?: string;
  /** Postmark spamcheck runs only on interactive checks — never in the send gate (network-free). */
  includeSpamAssassin: boolean;
  /** Rate-limit the AI layer (interactive checks only). */
  rateLimitAi: boolean;
}

export function contentHashOf(subject: string, html: string, plainText: string | null | undefined): string {
  return createHash('sha256')
    .update(preflightHashInput(subject, html, plainText))
    .digest('hex');
}

export class NewsletterPreflightService {
  /**
   * Send-time content gate, called from NewslettersController.sendNewsletter after the tenant
   * guards. Reuses the cached check when the stored content hashes to a previous run (backfilling
   * newsletter_id); otherwise recomputes lint + AI. Throws when the score lands in the blocked band.
   */
  public async assertNewsletterContentSendable(
    db: Db,
    tenantId: string,
    newsletter: NewsletterContentRow,
  ): Promise<void> {
    const subject = newsletter.subject ?? '';
    const html = newsletter.html_content ?? '';
    const hash = contentHashOf(subject, html, newsletter.plain_text_content);

    const cached = await db
      .selectFrom('newsletter_content_checks')
      .select(['id', 'score', 'band', 'newsletter_id'])
      .where('tenant_id', '=', tenantId)
      .where('content_hash', '=', hash)
      .executeTakeFirst();

    let score: number;
    let band: string;
    if (cached) {
      score = cached.score;
      band = cached.band;
      if (!cached.newsletter_id) {
        await db
          .updateTable('newsletter_content_checks')
          .set({ newsletter_id: newsletter.id })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', cached.id)
          .execute();
      }
    } else {
      const result = await this.check(
        db,
        tenantId,
        { subject, html, plainText: newsletter.plain_text_content ?? undefined },
        { newsletterId: newsletter.id, includeSpamAssassin: false, rateLimitAi: false },
      );
      score = result.score;
      band = result.band;
    }

    if (band === 'blocked') {
      throw new PreconditionFailedError(
        `Deliverability score ${score} — fix the items flagged in the preflight check before sending.`,
      );
    }
  }

  /** Interactive preflight behind the composer's "Check deliverability" button. */
  public async runPreflight(db: Db, tenantId: string, input: RunPreflightType): Promise<PreflightResult> {
    return this.check(db, tenantId, input, { includeSpamAssassin: true, rateLimitAi: true });
  }

  /** One Claude content review; null (= skipped, fail-open) when the key is unset or the call
   * fails. Public so specs can stub the network seam. */
  public async aiReview(subject: string, bodyText: string, linkHosts: string[]): Promise<AiPreflightVerdict | null> {
    if (!env.anthropicApiKey) return null;
    try {
      const client = new Anthropic({ apiKey: env.anthropicApiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
      const content =
        `Subject line: ${subject || '(empty)'}\n` +
        (linkHosts.length ? `Link destinations: ${linkHosts.join(', ')}\n` : '') +
        `\nBody text:\n${bodyText.slice(0, AI_TEXT_CAP)}`;
      const message = await client.messages.parse({
        model: env.anthropicModel,
        max_tokens: AI_MAX_TOKENS,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: zodOutputFormat(AiPreflightVerdictObj) },
      });
      return message.parsed_output ?? null;
    } catch (error) {
      // Fail open on any API problem (rate limit, outage, network, schema mismatch) — the lint
      // score still gates, and the result is marked aiSkipped so the UI says the review was skipped.
      logger.warn({ err: error }, 'Newsletter preflight AI review skipped');
      return null;
    }
  }

  /** SpamAssassin score via Postmark's public spamcheck API; null on any failure (advisory only).
   * Public so specs can stub the network seam. */
  public async spamAssassinScore(subject: string, html: string): Promise<number | null> {
    // Minimal RFC822 message: only content rules can meaningfully fire here (no real transport
    // headers), which is exactly the advisory signal we want.
    const raw =
      `From: preflight@example.com\r\nTo: preflight@example.com\r\nSubject: ${subject.replace(/[\r\n]+/g, ' ')}\r\n` +
      `MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`;
    try {
      const response = await fetch(SPAMCHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: raw, options: 'short' }),
        signal: AbortSignal.timeout(SPAMCHECK_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { success?: boolean; score?: string };
      const score = Number.parseFloat(data.score ?? '');
      return data.success && Number.isFinite(score) ? score : null;
    } catch (error) {
      logger.warn({ err: error }, 'Newsletter preflight spamcheck skipped');
      return null;
    }
  }

  private async check(db: Db, tenantId: string, input: RunPreflightType, opts: CheckOptions): Promise<PreflightResult> {
    const subject = input.subject ?? '';
    const html = input.html ?? '';
    const bodyText = input.plainText?.trim() ? input.plainText : htmlToPlainText(html);

    const findings: PreflightFinding[] = lintNewsletterContent({ subject, html, plainText: input.plainText });

    // The limiter runs FIRST, before either outbound call. It used to sit between them,
    // which left the Postmark spamcheck fetch entirely uncapped (finding H4).
    if (opts.rateLimitAi && env.anthropicApiKey) {
      // Durable, cross-instance counter: the in-memory limiter reset on every deploy and
      // multiplied by the replica count, which is not an acceptable ceiling on a paid
      // per-call API that any authenticated tenant can reach.
      await checkDurableRateLimit(
        `newsletterPreflightAi:${tenantId}`,
        AI_CHECKS_PER_HOUR,
        HOUR_MS,
        'You have run too many content checks in the last hour. Try again shortly.',
      );
    }

    let spamAssassinScore: number | null = null;
    if (opts.includeSpamAssassin) {
      spamAssassinScore = await this.spamAssassinScore(subject, html);
      if (spamAssassinScore != null) {
        const saFinding = buildSpamAssassinFinding(spamAssassinScore);
        if (saFinding) findings.push(saFinding);
      }
    }

    const ai = await this.aiReview(subject, bodyText, linkHostsOf(html));
    if (ai) findings.push(...buildAiFindings(ai));

    const score = computeScore(findings);
    const band = preflightBand(score);
    const result: PreflightResult = {
      score,
      band,
      findings,
      spamAssassinScore,
      ai,
      aiStatus: ai ? 'reviewed' : 'unavailable',
      checkedAt: new Date().toISOString(),
    };

    await this.persist(db, tenantId, contentHashOf(subject, html, input.plainText), result, opts.newsletterId);
    return result;
  }

  private async persist(
    db: Db,
    tenantId: string,
    contentHash: string,
    result: PreflightResult,
    newsletterId: string | undefined,
  ): Promise<void> {
    const values = {
      tenant_id: tenantId,
      newsletter_id: newsletterId ?? null,
      content_hash: contentHash,
      score: result.score,
      band: result.band,
      findings: JSON.stringify(result.findings),
      ai_verdict: result.ai ? JSON.stringify(result.ai) : null,
      ai_model: result.ai ? env.anthropicModel : null,
    };
    await db
      .insertInto('newsletter_content_checks')
      .values(values)
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'content_hash']).doUpdateSet({
          score: values.score,
          band: values.band,
          findings: values.findings,
          ai_verdict: values.ai_verdict,
          ai_model: values.ai_model,
          // Keep an already-backfilled newsletter_id when this re-check didn't carry one.
          ...(newsletterId ? { newsletter_id: newsletterId } : {}),
        }),
      )
      .execute();
  }
}

/** Distinct link hosts in the HTML — cheap context that helps the AI judge link trust. */
function linkHostsOf(html: string): string[] {
  const hosts = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    try {
      const url = new URL((m[2] ?? '').trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.hostname);
    } catch {
      // relative or malformed href — not useful context
    }
  }
  return [...hosts].slice(0, 20);
}

export const newsletterPreflight = new NewsletterPreflightService();
