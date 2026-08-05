import { z } from 'zod';

import { idSchema } from './core.schema';

export const marketingEmailTopLinkObj = z.object({
  url: z.string(),
  clicks: z.number().int().nonnegative(),
});

export const MarketingEmailObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  status: z.enum(['draft', 'scheduled', 'paused', 'sent', 'archived']).default('sent'),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  audience_description: z.string().nullable().optional(),
  target_lists: z.string().nullable().optional(),
  segments: z.string().nullable().optional(),
  total_recipients: z.number().int().nonnegative(),
  delivered_count: z.number().int().nonnegative(),
  bounce_count: z.number().int().nonnegative(),
  open_rate: z.number(),
  click_rate: z.number(),
  unique_opens: z.number().int().nonnegative(),
  unique_clicks: z.number().int().nonnegative(),
  unsubscribe_count: z.number().int().nonnegative(),
  spam_complaint_count: z.number().int().nonnegative(),
  reply_count: z.number().int().nonnegative(),
  send_date: z.coerce.date().nullable(),
  last_engagement_at: z.coerce.date().nullable().optional(),
  summary: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
  top_links: z.array(marketingEmailTopLinkObj).nullable().optional(),
  /** The sent newsletter this row is a non-opener follow-up of; null for originals. */
  resend_of_id: z.string().nullable().optional(),
  /** From name chosen in the composer; null means "use the workspace default". */
  from_name: z.string().nullable().optional(),
  /** From address chosen in the composer; null means "use the workspace default". */
  from_email: z.string().nullable().optional(),
  updated_at: z.coerce.date(),
  created_at: z.coerce.date(),
  createdby_id: z.string(),
  updatedby_id: z.string(),
});

export const AddMarketingEmailObj = z.object({
  /** Campaigns §15 — the context this newsletter sends within; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: z.string(),
  status: z.enum(['draft', 'scheduled', 'paused', 'sent', 'archived']).default('draft').optional(),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  audience_description: z.string().nullable().optional(),
  target_lists: z.string().nullable().optional(),
  segments: z.string().nullable().optional(),
  total_recipients: z.number().int().nonnegative().default(0).optional(),
  delivered_count: z.number().int().nonnegative().default(0).optional(),
  bounce_count: z.number().int().nonnegative().default(0).optional(),
  open_rate: z.number().min(0).max(100).default(0).optional(),
  click_rate: z.number().min(0).max(100).default(0).optional(),
  unique_opens: z.number().int().nonnegative().default(0).optional(),
  unique_clicks: z.number().int().nonnegative().default(0).optional(),
  unsubscribe_count: z.number().int().nonnegative().default(0).optional(),
  spam_complaint_count: z.number().int().nonnegative().default(0).optional(),
  reply_count: z.number().int().nonnegative().default(0).optional(),
  send_date: z.coerce.date().nullable().optional(),
  last_engagement_at: z.coerce.date().nullable().optional(),
  summary: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
  top_links: z.array(marketingEmailTopLinkObj).nullable().optional(),
  /** From name to send under; null/absent means "use the workspace default". */
  from_name: z.string().max(200).nullable().optional(),
  /** From address to send from; null/absent means "use the workspace default". Must be one of
   * the workspace's verified senders — re-checked at send time, not trusted from the client. */
  from_email: z.email().nullable().optional(),
});

export const UpdateMarketingEmailObj = AddMarketingEmailObj.partial();

/* ------------------------------------------------------------------ */
/* Newsletter report — the shape of newsletters.getReport             */
/* ------------------------------------------------------------------ */

/** A CRM person matched by email — enough to render a link to their record. */
export const NewsletterReportPersonObj = z.object({
  id: z.string(),
  /** Opaque public id — the canonical /people/:id route key. */
  public_id: z.string().nullable(),
  name: z.string(),
});

export const NewsletterReportBounceObj = z.object({
  email: z.string(),
  /** hard = permanent, soft = provider deferral ('blocked'), dropped = never attempted. */
  kind: z.enum(['hard', 'soft', 'dropped']),
  reason: z.string().nullable(),
  occurred_at: z.coerce.date().nullable(),
  person: NewsletterReportPersonObj.nullable(),
});

export const NewsletterReportEngagedObj = z.object({
  email: z.string(),
  opens: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  /** Distinct links clicked — 0 when unknown (raw events already pruned). */
  links: z.number().int().nonnegative(),
  person: NewsletterReportPersonObj.nullable(),
});

export const NewsletterReportLinkObj = z.object({
  url: z.string(),
  clicks: z.number().int().nonnegative(),
  /** Unique clickers of this link — null when unknown (raw events already pruned). */
  people: z.number().int().nonnegative().nullable(),
});

export const NewsletterReportPreviousSendObj = z.object({
  id: z.string(),
  name: z.string(),
  send_date: z.coerce.date().nullable(),
  open_rate: z.number(),
  click_rate: z.number(),
  unsubscribe_rate: z.number(),
  bounce_rate: z.number(),
});

export const NewsletterReportObj = z.object({
  /** Hourly opens/clicks buckets from raw events (empty once events are pruned). */
  timeline: z.array(
    z.object({
      time: z.string(),
      opens: z.number().int().nonnegative(),
      clicks: z.number().int().nonnegative(),
    }),
  ),
  /** Share of all opens that landed within 24h of send — null when not computable. */
  opens_in_24h_pct: z.number().nullable(),
  bounces: z.object({
    total: z.number().int().nonnegative(),
    hard: z.number().int().nonnegative(),
    soft: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    rows: z.array(NewsletterReportBounceObj),
  }),
  top_links: z.array(NewsletterReportLinkObj),
  tracked_links: z.number().int().nonnegative(),
  total_clicks: z.number().int().nonnegative(),
  unique_clickers: z.number().int().nonnegative(),
  most_engaged: z.array(NewsletterReportEngagedObj),
  unsubscribes: z.object({
    total: z.number().int().nonnegative(),
    /** Reason buckets; null reason = "No reason given" (no unsubscribe survey exists yet). */
    reasons: z.array(z.object({ reason: z.string().nullable(), count: z.number().int().nonnegative() })),
  }),
  spam_reports: z.object({
    total: z.number().int().nonnegative(),
    rows: z.array(z.object({ email: z.string().nullable(), occurred_at: z.coerce.date().nullable() })),
  }),
  audience: z.object({
    lists: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mode: z.enum(['include', 'exclude']),
        members: z.number().int().nonnegative(),
      }),
    ),
    /** Members in more than one included list, counted once. */
    overlap_removed: z.number().int().nonnegative(),
    /** Included members whose address is on the suppression list. */
    suppressed_skipped: z.number().int().nonnegative(),
  }),
  /** Up to the last 5 sent newsletters in this campaign, oldest → newest, ending with this send. */
  previous_sends: z.array(NewsletterReportPreviousSendObj),
  from: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
});

export const CreateClickersListResultObj = z.object({
  id: z.string(),
  name: z.string(),
  members: z.number().int().nonnegative(),
});
