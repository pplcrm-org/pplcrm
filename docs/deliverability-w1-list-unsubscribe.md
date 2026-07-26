# W1 — RFC 8058 one-click unsubscribe

Status: **implemented on both send paths; one live check still outstanding** (see
"Remaining verification" — the question is no longer "do we have the headers" but "does SendGrid
also add its own").

## Why this matters

Gmail and Yahoo (since Feb 2024) and Microsoft (since May 2025) require bulk senders to include
`List-Unsubscribe` (mailto and/or https) **and** `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
headers.

This became blocking rather than merely desirable once a shared platform sending domain was on the
table: a shared domain aggregates every tenant's volume under one identity, so pplCRM crosses the
5,000/day bulk-sender threshold as a platform even when no individual tenant does.

## What ships

Both outbound paths emit the RFC 8058 pair themselves, from
`apps/backend/src/app/lib/mail/newsletter-mail.service.ts`.

**The headers are per-personalization, not message-level.** The URL names a specific person, so a
message-level header would hand every recipient in a 1,000-address batch the _first_ person's
unsubscribe token. `NewsletterRecipient.listUnsubscribeUrl` carries it per recipient and the
service emits both headers on that recipient's personalization.

This differs from the earlier plan in this file, which suggested keeping the recipient-invariant
`List-Unsubscribe-Post` at message level. Both headers stay together on the personalization
instead: a message-level `List-Unsubscribe-Post` would also reach recipients who have no
`List-Unsubscribe` (a newsletter with no campaign), leaving a dangling half-pair.

**Scope comes from the token.** `UnsubscribeTokenPayload` gained an optional `campaignId`:

| Path       | Token carries       | POST /api/unsubscribe/:token stops |
| ---------- | ------------------- | ---------------------------------- |
| Newsletter | `campaignId` set    | that campaign only                 |
| Automation | `campaignId` absent | every campaign for that person     |

The newsletter case has to be campaign-scoped because the same email also contains SendGrid's
`<% unsubscribe %>` footer link, and the resulting webhook event flips only that newsletter's
campaign (`newsletters-webhook.route.ts`). Two unsubscribe controls in one message that produce
different outcomes would be a consent bug, not a UX wart.

`campaignId` is optional so tokens minted before this change still decode — an old link sitting in
an inbox keeps working and keeps its original organization-wide meaning.

The route (`modules/newsletters/routes/unsubscribe.route.ts`) already satisfied RFC 8058: GET only
renders a confirm page (mail scanners prefetch links), POST mutates, and it registers its own
formbody parser because one-click arrives as `application/x-www-form-urlencoded`.

## Remaining verification

Newsletters keep `tracking_settings.subscription_tracking` **on**, because the footer link and the
`unsubscribe` webhook event (which feeds `person_newsletter_engagements.has_unsubscribed` on the
report page) both depend on it. That revives this file's original concern from the other side:
SendGrid may inject its own `List-Unsubscribe` when subscription tracking is on, and the message
would then carry two.

1. Send a real newsletter (broadcast, not a test send) to a Gmail address you control, once from a
   tenant on the **platform key + free-tier subuser** path and once from a tenant with its own
   **whitelabel subuser**.
2. Gmail → ⋮ → **Show original**. Count the `List-Unsubscribe` headers.
3. Record the result below.

**Decision rule:**

- **Exactly one (ours)** → done. Nothing further.
- **Two** → drop SendGrid's by setting `subscriptionTracking: false` on the newsletter send and
  replacing the footer's `<% unsubscribe %>` with the same tokenized URL the header uses. Note the
  cost before doing it: the `unsubscribe` webhook event stops arriving, so
  `has_unsubscribed` on the report page must then be derived from `campaign_subscriptions` instead.

## Results

| Send path                                   | List-Unsubscribe | List-Unsubscribe-Post | Duplicate? | Checked on |
| ------------------------------------------- | ---------------- | --------------------- | ---------- | ---------- |
| Platform key + `SENDGRID_FREE_TIER_SUBUSER` | ☐                | ☐                     | ☐          | —          |
| Tenant whitelabel subuser                   | ☐                | ☐                     | ☐          | —          |

## Website claim

The marketing site deliberately does not claim one-click unsubscribe today (see
`pplcrm-website-claims` → known intentional gaps). Once the duplicate-header check above is clean,
that gap can be upgraded to a real claim.
