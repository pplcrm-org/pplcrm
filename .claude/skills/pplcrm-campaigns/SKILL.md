---
name: pplcrm-campaigns
description: How pplCRM's Campaigns feature (§15) works — office/election contexts, the shared-rolodex vs campaign-scoped-facts split, campaign_person_facts (support level + voting status), the three-layer email consent model (campaign_subscriptions / email_suppressions / persons.do_not_contact), domain scoping via options.campaignId, admin-assigned campaign membership (authusers.campaign_id) and admin-only context switching, archive read-only rules, and carry-over. USE WHEN touching anything under modules/campaigns, experiences/campaigns, the Workspace→Campaigns settings section, campaign assignment on users/invites, campaign_person_facts / campaign_subscriptions / email_suppressions schema, support level or voting status, DNC, newsletter sendability, or a campaign_id column on any table. EXAMPLES 'add a campaign-scoped concept to a person', 'why is this person not getting the newsletter', 'which campaign does a knock update', 'copy supporters into the new campaign', 'why is this editor forbidden from another campaign'.
---

# Campaigns (§15): office/election contexts

## The model in one paragraph

A campaign is a **context**. Every tenant permanently has one `kind='office'` campaign (created at
signup, cannot be archived or deleted); elections are additional `kind='election'` rows created and
later archived (`status='archived'` = read-only history; campaigns are NEVER hard-deleted — the
controller's `delete` throws). People/households/companies/tags are ONE shared tenant-wide rolodex;
what varies per campaign is the FACTS about people and the operational domains. The dividing rule:
**tags are freeform multi-valued human labels; anything with a fixed enum, a single value per
person, machine updates, or send/knock logic is a structured concept** — that rule retired the
supporter/non-supporter/undecided/subscriber/unsubscribed/do-not-contact/donor system tags, and
(2026-07-12) the last two holdouts: `volunteer`/`staff` became `persons.volunteer_status`
(prospective/active/inactive/former) and `persons.staff_status` (active/inactive/former) — global
person columns, NULL = "not one". No system tags remain; the `system-tags.ts` machinery was deleted.

## Tables

- `campaigns` — + `kind ('office'|'election')`, `status ('active'|'archived')`. Backed by
  `modules/campaigns/` (repo/controller/router registered as `campaigns` in `modules/trpc.ts`).
- `campaign_person_facts` — one row per (campaign, person): `support_level`
  (strong/leaning/neutral/leaning_against/against/undecided — **Unknown = no row/NULL, never
  stored**), `voting_status` (will_vote/voted_advance/voted_eday/not_voting/ineligible), each with
  source/recorded_by/recorded_at. Upserts touch only provided fields (a knock recording support
  must not wipe voting status). Enums live in `libs/common/src/lib/schemas/campaigns.schema.ts`.
- `campaign_subscriptions` — per-campaign email CONSENT: `status subscribed|pending|unsubscribed`;
  express-vs-implied is `consent_source (form|import|manual|copied)`, not a status.
- `email_suppressions` — GLOBAL address health per (tenant, email): hard_bounce / spam_complaint /
  manual. Fed by the SendGrid webhook route.
- `persons.do_not_contact` + `do_not_contact_channels` — global person override (null = all channels).
- `persons.campaign_id` / `households.campaign_id` are **nullable provenance only** — never filter by them.

**Sendable in campaign X** = subscribed row in X ∧ no suppression for the email ∧ not DNC(email).
The single choke point is `NewslettersController.buildRecipientQuery` — change sendability there.

## Context plumbing (admin-assigned since 2026-07-23)

- **Membership is admin-assigned.** `authusers.campaign_id` (nullable FK; NULL = office) is the
  campaign an Editor/Viewer belongs to — set by an admin on the Users page / user detail page /
  invite dialog (`InviteAuthUserObj`/`UpdateAuthUserObj.campaign_id`, validated by
  `AuthController.resolveAssignableCampaignId`: must be a live tenant campaign; office stores as
  NULL). Admins/owners are never scoped by it ("All campaigns"). Archiving a campaign clears its
  members' `campaign_id` back to NULL and closes its deliveries — cancels live routes and declines
  open yard-sign requests via `DeliveriesController.closeCampaignDeliveries` (the open-request slot
  is per-household tenant-wide; see `pplcrm-deliveries`) — all in the same transaction
  (`CampaignsController.archive`).
- No campaign in the auth token. For **admins/owners** the active context lives in
  `profiles.preferences.active_campaign_id`; `campaigns.getContext` returns every campaign + active
  id (falls back to the office), `setActiveCampaign` (admin/owner-only) persists it. For
  **Editors/Viewers** `getContext` returns exactly their assigned campaign (office when unassigned
  or the assignment is archived/dangling) — they cannot switch.
- **Enforcement**: `isAuthed` in `apps/backend/src/trpc.ts` recursively scans the raw input of every
  authed procedure for `campaignId`/`campaign_id` keys when the caller is role `user`/`viewer` and
  throws FORBIDDEN unless each id equals the caller's assigned campaign (office id when
  unassigned). The `/api/emails/send` REST route mirrors this check inline. Campaign management
  (crud + add/archive/unarchive/carryOver/getSwitcherList/setActiveCampaign) is
  `adminOrOwnerProcedure`; person-fact/subscription procedures stay `authProcedure`.
- **UI surfaces**: management lives in Workspace settings → Campaigns
  (`experiences/settings/campaigns/campaigns-settings.ts`, custom section id `campaigns`;
  `/campaigns` redirects to `/workspace/campaigns`, deep pages `/campaigns/add`, `/campaigns/:id`,
  `/campaigns/:id/edit` are roleGuard-ed). There is no avatar-menu entry and no switcher for
  non-admins. The profile page shows the user's campaign; the Users list grows a Campaign column
  once an election exists.
- Frontend: `CampaignContextService` (`services/campaign-context.service.ts`) holds the
  `activeCampaignId` signal (for non-admins the backend pins it to their assignment). Scoped
  services stamp `campaignId` into getAll options and `campaign_id` into add payloads.
- Backend reads: `options.campaignId` filters generically in `BaseRepository.getAll` for tables in
  `CAMPAIGN_SCOPED_TABLES` (base.repo.ts) — `newsletters`, `donations`, `donation_pledges`,
  `donation_periods`, `web_forms`, `lists`, `events`, `turfs`, `delivery_requests`,
  `delivery_routes`. The lists and forms grids apply the filter in their own custom queries.
  Child tables (form submissions, turf households/knocks, delivery route stops, event
  registrations) inherit context via their parent and are never scoped directly.
- Inbox & mailboxes (per-campaign, §15): `ms_oauth_tokens` / `google_oauth_tokens` are
  `UNIQUE (tenant_id, campaign_id)` — one Office 365 + one Gmail connection **per campaign**, not
  per tenant. `emails` and `email_drafts` carry `campaign_id NOT NULL`. These are **not** in
  `CAMPAIGN_SCOPED_TABLES` (the inbox uses custom queries, not `BaseRepository.getAll`): the OAuth
  flow binds a connection to the campaign via the HMAC-signed `oauth-state` (`campaignId` field),
  the `ms_sync`/`google_sync` job payloads carry `campaignId`, and every sync/ingest/read/send path
  threads `campaignId` explicitly (`getValidToken`, `getConnectionStatus`, `ingestEmail`,
  `getByFolderWithAttachmentFlag`, the `/api/emails/send` REST route's `campaignId` form field).
  The child email tables (`email_bodies`, `email_recipients`, `email_headers`, `email_attachments`,
  `email_read_states`, `email_comments`, `email_trash`) inherit context via `emails.id`. Switching
  context switches both the connect UI (settings/ms-sync, settings/google-sync) and the visible mail.
- Backend writes: `CampaignsRepo.resolveForWrite({tenant_id, campaign_id?})` — validates an
  explicit id (exists, tenant-owned, ACTIVE) or falls back to the office. Campaign-scoped fact
  writes go through `assertWritable` (archived → BadRequestError). One deliberate exception:
  a double-opt-in confirmation still lands after its campaign is archived.

## Lifecycle & carry-over

`archive`/`unarchive` (office never archivable). `carryOver` (one transaction): copies
`support_level` rows as `source='carryover'` without clobbering existing target rows; **voting
status never copies**; subscriptions copy only with `copy_subscriptions: true` — the UI
(campaign-view carry-over card) puts a compliance confirmation dialog in front of that flag, and
copied rows get `consent_source='copied'` with the original `consent_at` preserved.

## Traps

- Adding a new campaign-scoped single-valued person concept = new nullable column on
  `campaign_person_facts` (+ enum in campaigns.schema.ts), NOT a new tag and NOT a new table.
- Spec cleanups must delete campaign-scoped tables BEFORE `campaigns` (FK), and every insert into a
  scoped table needs `campaign_id` — the NOT NULL constraint is the net that catches misses.
- Service specs that build services via `Object.create` must stub
  `(service as any).campaignContext = { activeCampaignId: () => null };`.
- "Donor" is derived from the donations table (statusChip in person-view); do not reintroduce a tag.
- Workflow triggers: `new_subscriber`/`new_unsubscriber` fire from
  `WorkflowsController.triggerSubscriptionChanged` on consent writes — not from tag attaches.
