# Third production-risk review — the code written since the second review, and the surface it never read

Read-only review. No code was changed by it.

`REVIEW.md` and `REVIEW2.md` at the repo root are the first two production-risk reviews.
The first worked from entrypoints inward (job workers, the Stripe money path, newsletter
sending, list membership, boot/shutdown, the tRPC auth middleware, the public REST
surface). The second read the areas the first listed as gaps (the auth controller, mailbox
sync, blob storage, the two Cloudflare Workers, parts of the frontend, both companion apps,
the marketing site, exports, web forms, the person-merge repository, the dashboard,
enrichment, notifications). Between them they hold 35 findings, almost all fixed.

This review reads two things neither of them saw: the **56 commits that landed after
`REVIEW2.md`** (`git log dcf908bf..HEAD`), and the standing surface both prior reviews
listed as never-opened — the donation-receipt system, the automation engine, the person-
and household-merge code, the campaign-jurisdiction geometry, the free-plan mail purge, and
the database schema's triggers, functions, indexes, and constraints.

Every finding below was **read in the source, and every file-and-line reference was opened
and confirmed at the line.** Where a claim rests on a provider's behaviour or on how often a
race fires rather than on the code, the confidence line says so.

Two things I checked and can close up front. **The schema baseline defines only three stored
functions and no behavioural triggers** — the single largest "changes behaviour without
appearing in application code" worry both prior reviews flagged is almost empty (clean-areas
section). And **the receipt system's gap-free serial numbering is correct** — the headline
compliance risk the task named is sound; the receipt defect is one column over (finding 4).

## Paths read, and why

| Path                                                                                                                                 | Why                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `modules/lists/controller.ts`, `modules/persons/repositories/persons.repo.ts`, `lib/paging.ts`                                       | The row-span-bounding fix (`6d3fbd78`) touched the exact query the smart-list refresh depends on.          |
| `modules/persons/` and `modules/households/` merges and delete paths                                                                 | REVIEW2 finding 4 was a high-severity merge data-loss bug; several commits claim to fix that class.        |
| `modules/donations/receipts/*`, `lib/jobs/handlers/receipts.handlers.ts`, four receipt migrations                                    | Money plus a legal numbering guarantee, entirely unreviewed — the task's first priority.                   |
| `lib/jobs/handlers/workflows.handlers.ts`, `automation-mail.handlers.ts`, `modules/workflows/automation-consent.ts`                  | The automation engine sends mail and mutates records on a schedule — the newsletter path's risk profile.   |
| `lib/jobs/handlers/inbox-purge.handlers.ts`, `modules/billing/inbox-purge.ts`, `modules/billing/controller.ts`                       | A scheduled job that permanently deletes a workspace's mail, plus the plan-state machine that arms it.     |
| `_migrations/schema.sql` — functions, triggers, indexes, FKs, checks, RLS, grants                                                    | The category that changes database behaviour invisibly to anyone reading application code.                 |
| `lib/gis/point-in-polygon.ts`, `boundary-match.ts`, `boundary-store.ts`, `geocode-queue.ts`, `2026-08-02-e-drop-legacy-geography.ts` | New geometry (point-in-polygon, boundary matching), a geocode cost control, and a destructive column-drop. |
| `apps/frontend`, `apps/companion`, `apps/website`, `libs/uxcommon` (NUL-byte scan)                                                   | The first review's NUL-byte trap was never checked in these trees.                                         |

Several focused sub-reviews ran in parallel (billing, the automation engine, the schema
baseline, persons/households). Their strongest claims I re-opened and re-confirmed at the
line myself before including them; that verification is noted per finding. Where I carried a
claim without re-reading every code path it names, the confidence line says exactly that.

---

## Findings

### 1. [HIGH] A smart list that matches more than 5,000 people is silently truncated to 5,000 on every refresh — the fix for the unbounded-read finding collided with the list-refresh path that is supposed to be unbounded

- **Where:** the clamp is at [persons.repo.ts#L253](apps/backend/src/app/modules/persons/repositories/persons.repo.ts#L253) (`const page = resolvePageWindow(options)`) applied unconditionally at [#L529-L530](apps/backend/src/app/modules/persons/repositories/persons.repo.ts#L529-L530); the default it resolves to is `MAX_PAGE_SIZE` at [paging.ts#L59](apps/backend/src/app/lib/paging.ts#L59) and [#L64-L65](apps/backend/src/app/lib/paging.ts#L64-L65); `MAX_PAGE_SIZE = 5000` at [core.schema.ts#L72](libs/common/src/lib/schemas/core.schema.ts#L72); the household twin is `getAllWithPeopleCount` at [households.repo.ts#L731](apps/backend/src/app/modules/households/repositories/households.repo.ts#L731). The callers that pass no paging on purpose are the smart-list build and refresh at [lists/controller.ts#L361](apps/backend/src/app/modules/lists/controller.ts#L361) and [#L391](apps/backend/src/app/modules/lists/controller.ts#L391), and `getCurrentMembers` at [#L558](apps/backend/src/app/modules/lists/controller.ts#L558)/[#L562](apps/backend/src/app/modules/lists/controller.ts#L562).
- **Trigger:** any tenant whose smart-list rule matches more than 5,000 people (or households) has that list refreshed — a routine event.
- **What breaks, traced:** commit `6d3fbd78` (which closed REVIEW2 finding 6, the unbounded read) changed `getAllWithAddress` from a `$if`-gated limit to an **always-applied** `LIMIT` via `resolvePageWindow`, whose own comment ([paging.ts#L55-L57](apps/backend/src/app/lib/paging.ts#L55-L57)) states that a caller sending no paging now falls back to `defaultLimit = MAX_PAGE_SIZE` "and is the reason such a caller can no longer read a whole table." That is correct for a grid request and wrong for the list refresh, which calls the same method with the rule definition and **no** paging precisely because "a refresh wants every matching row" ([lists/controller.ts#L358-L360](apps/backend/src/app/modules/lists/controller.ts#L358-L360)). The refresh then deletes the old membership and inserts the (now ≤5,000-row) new membership in one transaction ([#L376-L388](apps/backend/src/app/modules/lists/controller.ts#L376-L388)). So a 12,000-person list is refreshed down to its first 5,000, and `getCurrentMembers` returns 5,000 ids while its `count` field reports the true 12,000.
- **What an operator sees:** a smart list that "loses" 7,000 members after an edit, with no error. Worse on the mailing side: the refresh code's own comment ([#L372-L374](apps/backend/src/app/modules/lists/controller.ts#L372-L374)) notes these lists are used as newsletter **exclude** lists — a truncated exclude list mails the 7,000 suppressed people it was supposed to hold back, including anyone who unsubscribed via that list. `getCurrentMembers` also feeds turf cutting, automations, and CSV import ([canvassing/controller.ts#L2222](apps/backend/src/app/modules/canvassing/controller.ts#L2222)), so those all silently operate on a 5,000-row slice.
- **Blast radius:** every large-list tenant, every refresh. Membership correctness and — on the exclude path — email consent.
- **Confidence:** high, fully verified. `resolvePageWindow(undefined)` returns `{ offset: 0, limit: 5000 }`; `getAllWithAddress` at line 253 uses it unconditionally; the list controller calls it with the rule definition and no paging. This is a regression of the first review's finding 1, reintroduced from the other direction by the fix for the second review's finding 6.
- **Fix sketch:** give the list-membership resolution an explicit "no limit" path (a keyset-paged full scan, or a `resolvePageWindow` override that the internal list callers pass), keeping the 5,000 clamp only on the client-facing grid/feed callers. The unbounded read the clamp was added to stop is a _client_ request; the list refresh is an _internal_ one and needs the whole result.

---

### 2. [HIGH] Merging two households permanently destroys the source household's door-knock history, turf membership, and yard-sign requests

- **Where:** `HouseholdRepo.mergeHouseholds` at [households.repo.ts#L820-L969](apps/backend/src/app/modules/households/repositories/households.repo.ts#L820-L969) re-points fields, tags, list memberships, persons, and `household_districts`, then deletes the source at [#L965](apps/backend/src/app/modules/households/repositories/households.repo.ts#L965). The three tables it never re-points, all `ON DELETE CASCADE` on `households(id)`: `delivery_requests.household_id` ([schema.sql#L7029](apps/backend/src/app/_migrations/schema.sql#L7029)), `turf_households.household_id` ([schema.sql#L8093](apps/backend/src/app/_migrations/schema.sql#L8093)), `turf_knocks.household_id` ([schema.sql#L8133](apps/backend/src/app/_migrations/schema.sql#L8133)).
- **Trigger:** any household merge where the source household has been canvassed, is a member of a turf, or has a yard-sign request.
- **What breaks:** the source-household delete cascades those three tables to nothing. Door-knock history (`turf_knocks` — the field record of who was contacted and what they said, including do-not-contact and support level captured at the door), turf membership (`turf_households`), and delivery requests (`delivery_requests`) are erased with no warning and no undo. The **person** merge was explicitly fixed for exactly this class — it re-points `turf_knocks`, `delivery_requests` and the rest before deleting the source, with a comment naming them ([persons.repo.ts#L987-L1049](apps/backend/src/app/modules/persons/repositories/persons.repo.ts#L987-L1049)) — but the household merge got that treatment only for `household_districts` ([households.repo.ts#L952-L962](apps/backend/src/app/modules/households/repositories/households.repo.ts#L952-L962)).
- **What an operator sees:** nothing at merge time. Later, a turf's knock count drops, a canvassed address shows as never-contacted, or a yard-sign request vanishes — with no error trail.
- **Blast radius:** per household merge, unrecoverable without a database restore. Merges are common when deduping an imported voter file.
- **Confidence:** high, fully verified. The merge function read end to end (it does not touch those three tables); all three `ON DELETE CASCADE` constraints read at the quoted lines.
- **Fix sketch:** re-point `turf_knocks`, `turf_households` and `delivery_requests` from source to target inside the merge transaction before the delete, mirroring the person merge — with the same collision handling `turf_households` needs if the target is already in the same turf.

---

### 3. [HIGH] A recipient with no newsletter subscription cannot actually unsubscribe from automation email, though the page tells them they did

- **Where:** the consent rule at [automation-consent.ts#L50-L52](apps/backend/src/app/modules/workflows/automation-consent.ts#L50-L52) (and the deliberate allowance at [#L18-L19](apps/backend/src/app/modules/workflows/automation-consent.ts#L18-L19)); the unsubscribe POST at [unsubscribe.route.ts#L166-L175](apps/backend/src/app/modules/newsletters/routes/unsubscribe.route.ts#L166-L175); the confirmation copy at [#L192-L198](apps/backend/src/app/modules/newsletters/routes/unsubscribe.route.ts#L192-L198); the footer/one-click link built without a campaign at [workflows.handlers.ts#L704-L708](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L704-L708).
- **Trigger:** a person with **zero** rows in `campaign_subscriptions` receives an automation email — the class the consent module deliberately allows ("never joined the newsletter … relationship mail triggered by their own action, e.g. a volunteer shift"). This is exactly whom automations target: volunteers enrolled by `volunteer_signup`, people enrolled by `tag_added`, `task_sla_breach`, or manual enrollment. The person clicks the footer Unsubscribe link or their mail client fires the RFC-8058 one-click POST.
- **What breaks:** the unsubscribe POST is an `UPDATE … SET status='unsubscribed' WHERE person_id = …` with no insert. With zero subscription rows it updates nothing and records nothing. On the next `send_email` step, `resolveAutomationSendConsent` runs its three checks; the only unsubscribe signal it reads is `subscriptions.length > 0 && !subscriptions.some(subscribed)` — false when the length is zero — so the send is allowed. The person keeps receiving every remaining email in the sequence and any future automation, after seeing a page that said "you will no longer receive emails from this organization." The delivery-time consent re-check ([automation-mail.handlers.ts#L97-L108](apps/backend/src/app/lib/jobs/handlers/automation-mail.handlers.ts#L97-L108)) runs the same function, so it does not help.
- **What an operator sees:** the recipient's likely next move is a spam complaint, which suppresses the address and feeds the automation spam tripwire — which can suspend the tenant's sending.
- **Blast radius:** the whole population automations are designed to reach without newsletter consent. A CAN-SPAM/CASL exposure (an honoured opt-out is mandatory), not just an annoyance.
- **Confidence:** high, fully verified. All three sites read directly; the automation unsubscribe token carries no `campaignId`, so `payload.campaignId` is undefined and the UPDATE simply matches nothing for a zero-row person. What I did not check: whether some other flow (a form submission) creates subscription rows for these people in practice, which would shrink — not close — the gap.
- **Fix sketch:** on an automation-scope unsubscribe (token with no campaignId) whose UPDATE matched zero rows, write a durable opt-out the consent check reads — either insert `campaign_subscriptions` rows at status `unsubscribed`, or add a person-level email opt-out that becomes a fourth check in `resolveAutomationSendConsent`. The route's own comment rules out `email_suppressions` for good reasons; this needs a consent-shaped record, not a deliverability-health one.

---

### 4. [MEDIUM] Cumulative tax receipts are stamped with the year they are issued, but the year-end batch's "already done" and "still to email" checks filter on the gift year — so a rerun mails every tax-receipt donor a redundant summary, and a cap-interrupted tax receipt is never re-sent

- **Where:** the receipt row's year is set at [receipts/controller.ts#L690](apps/backend/src/app/modules/donations/receipts/controller.ts#L690) (`year: torontoYear(new Date())`) with the serial drawn from the same issue-year counter at [#L674](apps/backend/src/app/modules/donations/receipts/controller.ts#L674); statements instead store the gift year at [#L1264](apps/backend/src/app/modules/donations/receipts/controller.ts#L1264); the idempotency exclusion is at [receipts.repo.ts#L405-L408](apps/backend/src/app/modules/donations/repositories/receipts.repo.ts#L405-L408) (`dr.kind IN ('statement','cumulative') … dr.year = year`); the heal query is at [receipts.handlers.ts#L327-L329](apps/backend/src/app/lib/jobs/handlers/receipts.handlers.ts#L327-L329).
- **Trigger:** any year-end statement run for a _past_ year — the only kind that exists, because a year-end document for 2025 is produced in 2026. `job.year` is 2025; `torontoYear(new Date())` is 2026.
- **What breaks:** a cumulative receipt is written with `year = 2026` (it must match the counter its serial came from); a statement for the same donor-year is written with `year = 2025`. `listStatementDonors` excludes a donor only if they hold a live statement or cumulative receipt with `year = job.year (2025)`, so a cumulative receipt (2026) never matches and the donor is not excluded **on a rerun** — the guard the comment says exists "so a donor who already holds a tax receipt is not handed a redundant summary" is defeated by the mismatch. The reprocessed donor's `getUnreceiptedSucceededDonations` returns zero (gifts already covered), throws `ConflictError`, and the code falls through to `generateStatementForDonor`, which creates and emails a giving summary the donor did not need. The same mismatch breaks `emailPendingStatements` (the cap-recovery pass), which filters `year = 2025` and so never re-emails a cumulative receipt (2026) whose donor email was blocked by the hourly cap — leaving the donor's **official tax receipt** stored but unsent. (The standalone `render-receipt-pdf` job is only a partial backstop: `handleRenderReceiptPdf` _drops_ rather than defers a cap-blocked non-acknowledgement email at [receipts.handlers.ts#L260-L262](apps/backend/src/app/lib/jobs/handlers/receipts.handlers.ts#L260-L262).)
- **What an operator sees:** a donor asks why they got a "giving summary" after already receiving their tax receipt; or a donor never receives a tax receipt the ledger shows as "issued."
- **Blast radius:** per workspace that issues cumulative tax receipts, on any rerun or any cap-hitting run. The gap-free serial guarantee is **not** violated — the rolled-back `ConflictError` returns the serial, which I traced. The harm is redundant donor mail plus a tax receipt that silently is not delivered.
- **Confidence:** high on the code (all sites read; both the on-demand and batch entry points reach the same issue-year write). Medium on rerun frequency: `runYearEndStatements` only refuses a _concurrently running_ batch ([controller.ts#L1333-L1342](apps/backend/src/app/modules/donations/receipts/controller.ts#L1333-L1342)), and the schema comment names the year an "idempotency key on rerun," so rerun is intended.
- **Fix sketch:** separate the two meanings of `year` — add a gift-year column distinct from the issue-year used for the counter and serial index, and filter `listStatementDonors`/`emailPendingStatements`/the statement idempotency index on it; or resolve the covered gift year through `donation_receipt_items`. Do not simply store the gift year on the receipt: the serial came from the issue-year counter and the unique index would then place it in the wrong year's sequence.

---

### 5. [MEDIUM] The nightly mail purge re-checks a plan value read at the start of the run, so a paying customer who upgrades while the job is working can still have all their synced mail permanently deleted

- **Where:** [inbox-purge.handlers.ts#L23-L27](apps/backend/src/app/lib/jobs/handlers/inbox-purge.handlers.ts#L23-L27) (the one-shot select of due tenants, carrying `subscription_plan`), [#L34](apps/backend/src/app/lib/jobs/handlers/inbox-purge.handlers.ts#L34) (the "defense in depth" re-check that reads that snapshot), [#L42](apps/backend/src/app/lib/jobs/handlers/inbox-purge.handlers.ts#L42) (the destructive `purgeAllTenantEmails`).
- **Trigger:** a workspace whose 30-day purge deadline has passed (so it appears in the due list) upgrades **after** the due-list select but before the loop reaches its row. An upgrade calls `syncInboxPurgeSchedule`, which nulls `inbox_purge_scheduled_at` — but the loop never re-reads that column and re-reads the plan only from its own stale snapshot.
- **What breaks:** the guard `if (planAllowsFeature(tenant.subscription_plan, 'inbox') …)` reads the row captured at [#L23](apps/backend/src/app/lib/jobs/handlers/inbox-purge.handlers.ts#L23); it cannot see an upgrade that landed after that select. The just-upgraded, now-paying workspace fails the guard on stale data and its entire synced inbox — messages, internal comments, assignments, drafts — is permanently deleted, after which [#L46](apps/backend/src/app/lib/jobs/handlers/inbox-purge.handlers.ts#L46) re-nulls the already-null schedule. The window widens with mailbox size: `purgeAllTenantEmails` chunks and can take minutes for one tenant, during which any _other_ due tenant can upgrade and still be purged. The handler's own comment states the opposite intent ("a stale schedule row must not destroy an entitled workspace's inbox"), and the downgrade email promises "Upgrading before then restores the inbox intact."
- **What an operator sees:** a support ticket from a customer who paid to keep their inbox and lost it, with no error — the purge "succeeded."
- **Blast radius:** one workspace's entire synced mail plus all CRM-side annotations, unrecoverable. The trigger is narrow (an upgrade during the nightly purge on day 30+) but lands on the customer you least want it to.
- **Confidence:** high on the code path (the select, the re-check, and the destructive call read directly; the re-check demonstrably reads the snapshot, not the database). Medium on real-world frequency.
- **Fix sketch:** inside the per-tenant loop, re-read `subscription_plan`, `demo_mode_at` and `inbox_purge_scheduled_at` fresh, and make the delete conditional on `inbox_purge_scheduled_at IS NOT NULL` (ideally re-asserted in SQL on each chunk). The re-check exists for this race; it has to read live state to win it.

---

### 6. [MEDIUM] Automation email runs are written as `status='success'` at enqueue and never corrected, so the automations UI reports success for mail that was dropped or failed — and the "did they open the previous email?" logic reads a dropped email as sent

- **Where:** the run row inserted `status: 'success'` before the delivery job is enqueued at [workflows.handlers.ts#L713-L726](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L713-L726); the two delivery-time drop paths that `return` without touching the run row at [automation-mail.handlers.ts#L84-L90](apps/backend/src/app/lib/jobs/handlers/automation-mail.handlers.ts#L84-L90) (tenant blocked) and [#L97-L108](apps/backend/src/app/lib/jobs/handlers/automation-mail.handlers.ts#L97-L108) (consent gone); the send-condition read that trusts the row at [#L655-L667](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L655-L667).
- **Trigger:** the tenant is paused/suspended/payment-held, or the recipient unsubscribed/was suppressed, between enqueue and delivery; or the delivery job exhausts its 5 attempts (SendGrid outage). In each case the email is not delivered and nothing updates the run row.
- **What breaks:** two things. The automations list "LAST RUN" and the editor "RECENT RUNS" show a green success for an email that never went out — the one place this engine's "honestly narrated" run recording is not honest. And the engagement gate is driven off these rows: a `previous_opened`/`previous_not_opened` step reads the most recent `status='success'` email run, so a dropped email counts as "sent but not opened," and a `previous_opened` follow-up is then skipped — silently ending a person's sequence over an email they never received.
- **What an operator sees:** "the automation says it emailed them but they got nothing," with no failed run to find.
- **Blast radius:** per recipient, systematic during any tenant pause or provider outage window.
- **Confidence:** high on the mechanism — the enqueue-time `status: 'success'` insert and both silent-`return` drop paths read directly; the webhook stamps opens/clicks but no status. I did not exhaustively prove no other code path updates `workflow_runs.status`, but none appears on these handlers.
- **Fix sketch:** record the run in a distinct pending state and let the delivery handler flip it to success/failed/skipped (the payload already carries `workflowRunId`), or have the two drop paths and the job-failure path update the run row.

---

### 7. [MEDIUM] Deleting a person or household sequential-scans several large child tables, because their foreign-key columns are indexed only behind `tenant_id`

- **Where:** the FK columns lack a leading-column index — `donation_pledges.person_id` (only `idx_donation_pledges_tenant_campaign` at [schema.sql#L5324](apps/backend/src/app/_migrations/schema.sql#L5324)), `turf_knocks.person_id`/`household_id` (only `(tenant_id, household_id)` at [#L6010](apps/backend/src/app/_migrations/schema.sql#L6010)), `delivery_requests.person_id`/`household_id` (only `(tenant_id, household_id)` at [#L5268](apps/backend/src/app/_migrations/schema.sql#L5268)), `donations.person_id`, `campaign_subscriptions.person_id`, `persons.household_id`. The pattern the codebase already knows: `volunteer_shifts` carries single-column `idx_volunteer_shifts_person_ri` and `_event_ri` indexes ([#L6108](apps/backend/src/app/_migrations/schema.sql#L6108), [#L6122](apps/backend/src/app/_migrations/schema.sql#L6122)) that exist only to serve FK enforcement.
- **Trigger:** any single-row delete of a `persons` or `households` row — which the merge flows do to the source, and which ordinary delete does.
- **What breaks:** Postgres enforces a `SET NULL`/`CASCADE` FK with `WHERE <fkcol> = $1` and no tenant filter, so a btree on `(tenant_id, <fkcol>)` cannot be used (Postgres 16 has no skip scan). Each such delete scans the whole child table and holds row locks for the duration. No wrong data, no errors — it degrades as those tables grow.
- **Blast radius:** merge and delete latency, proportional to `donations`/`turf_knocks`/`campaign_person_facts` size. A later problem, not a now problem.
- **Confidence:** high on the schema facts (every cited FK and index read at the line; `donation_pledges` confirmed to have no `person_id` index, `volunteer_shifts` confirmed to have the `_ri` indexes the others lack). Medium on present impact given pre-ship data volumes.
- **Fix sketch:** one migration adding plain indexes on the child FK columns (`person_id`/`household_id`/`volunteer_person_id`/`request_id`), mirroring the `_ri` naming already used.

---

### 8. [MEDIUM] The tenant's permanent placeholder household can be deleted through two unguarded paths, and losing it breaks household deletion for the whole workspace

- **Where:** `mergeHouseholds` has no placeholder guard ([households.repo.ts#L820](apps/backend/src/app/modules/households/repositories/households.repo.ts#L820)); the households router spreads `createCrudRouter` and never overrides `delete`, routing to the base controller's plain delete ([households/trpc.router.ts#L19-L22](apps/backend/src/app/modules/households/trpc.router.ts#L19-L22)); `tenants.placeholder_household_id` is `ON DELETE SET NULL` ([schema.sql#L8573](apps/backend/src/app/_migrations/schema.sql#L8573)); the member-reassignment step it protects is guarded by `if (placeholderId != null)`.
- **Trigger:** merging with the placeholder household as the _source_, or calling the base `households.delete` on the (empty) placeholder. The placeholder is created once at signup and nothing recreates it.
- **What breaks:** deleting the placeholder nulls `tenants.placeholder_household_id` silently. After that, `deleteManyReassigningPersons` skips its "move members to the placeholder" step (the null guard), so every subsequent household delete that still has members hits a raw foreign-key violation (`persons.household_id` has no `ON DELETE` action — [schema.sql#L7469](apps/backend/src/app/_migrations/schema.sql#L7469)) and surfaces as a generic 500, and `getUnhoused` returns nothing. Household deletion is broken workspace-wide with no way to recreate the placeholder.
- **Blast radius:** one workspace, permanent until a manual DB fix.
- **Confidence:** high on the schema facts (the `SET NULL` FK and the un-actioned `persons.household_id` FK read at the line) and on the router spreading the base delete. I confirmed the schema and the router shape; I did not exercise the base-controller delete against a live placeholder row.
- **Fix sketch:** refuse a merge or delete whose source/target is the tenant's `placeholder_household_id`, and override the crud `delete` on the households router to route through the member-reassigning delete.

---

### 9. [MEDIUM] Single-column foreign keys on `persons` let a signed-in user point their own records at another tenant's household, company, or campaign

- **Where:** `persons.household_id` → `households(id)` ([schema.sql#L7469](apps/backend/src/app/_migrations/schema.sql#L7469)), `persons.company_id` → `companies(id)` ([#L7765](apps/backend/src/app/_migrations/schema.sql#L7765)), `persons.campaign_id` → `campaigns(id)` ([#L6809](apps/backend/src/app/_migrations/schema.sql#L6809)) are all single-column (no `(id, tenant_id)` pairing). The write paths that accept these ids from the client without an ownership check: `moveEntireHousehold` ([persons/controller.ts#L108-L121](apps/backend/src/app/modules/persons/controller.ts#L108-L121)) and `addPerson`/`updatePerson` via `UpdatePersonsObj` ([persons.service.ts#L48-L101](apps/backend/src/app/modules/persons/services/persons.service.ts#L48-L101), [#L193-L224](apps/backend/src/app/modules/persons/services/persons.service.ts#L193-L224)).
- **Trigger:** a signed-in non-viewer sends a `household_id`/`company_id`/`campaign_id` belonging to another tenant (ids are sequential) on a person write.
- **What breaks:** row-level security stops cross-tenant _reads_, but FK validation runs at the system level and accepts a row RLS would hide, so the write lands. The writer's own person then disappears from their grid (the list requires the joined household to be in-tenant), and — the concrete cross-tenant harm — the _other_ tenant can no longer delete that household/company/campaign, because the FK check sees the foreign persons row and rejects the delete with a 500. A nonexistent id yields the same generic 500 (the schema admits values the database rejects).
- **Blast radius:** an existence oracle plus a cross-tenant delete-block; not a data read. Same class as REVIEW2's task-parent-id item, on a different set of columns.
- **Confidence:** high on the schema facts (all three FKs read and confirmed single-column). I confirmed the write paths accept the ids from the diff the parallel review cited; I did not re-read every branch of `updatePerson`.
- **Fix sketch:** validate that a supplied `household_id`/`company_id`/`campaign_id` exists under the caller's tenant before writing it, and return a clear 400 rather than a 500 on an unknown id.

---

### 10. [MEDIUM] Deleting a person does not revoke that person's volunteer companion access

- **Where:** `companion_volunteers.person_id` and `turf_assignments.volunteer_person_id` have no foreign key to `persons` (confirmed: no `companion_volunteers`…`FOREIGN KEY (person_id)` exists in the schema); `deleteMany` deletes shifts, mappings, and the person only ([persons/controller.ts#L123-L205](apps/backend/src/app/modules/persons/controller.ts#L123-L205)); the session guard checks only that the volunteer row exists, matches, and is approved ([companion-access/controller.ts#L412-L430](apps/backend/src/app/modules/companion-access/controller.ts#L412-L430)).
- **Trigger:** deleting a person who is also an approved companion volunteer.
- **What breaks:** the delete leaves the `companion_volunteers` row, its live 30-day device sessions, and its turf assignments intact, and nothing in the session guard references the person row — so the volunteer keeps opening the canvass/deliveries app and reading voter names, addresses, and support levels after the person is "deleted." The **merge** path handles these tables carefully ([persons.repo.ts#L1172-L1229](apps/backend/src/app/modules/persons/repositories/persons.repo.ts#L1172-L1229)); the delete path does not touch them.
- **Blast radius:** one device per deleted-but-volunteering person; a whole turf's voter records.
- **Confidence:** high on the schema (no FK) and the merge-vs-delete asymmetry. I confirmed `companion_volunteers.person_id` has no FK and read the merge's handling; I did not re-read the full `deleteMany` body beyond the tables the parallel review cited.
- **Fix sketch:** on person delete, apply the merge's companion-access cleanup — delete the `companion_volunteers` row, its sessions, and its approval tokens.

---

### 11. [MEDIUM] Automation email has no postal-address gate, and its footer silently omits the address when it is unset — while the newsletter path refuses to send without one

- **Where:** the automation `send_email` gate list (verified domain, phone, pause, caps — but no address check) at [workflows.handlers.ts#L676-L702](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L676-L702); the newsletter equivalent that _does_ require it (`hasOrganizationAddress`, documented "CAN-SPAM/CASL … may not send until an administrator has set it") in `send-guards.ts`; the automation footer builder's `if (addr)` block that drops the address when blank at [automation-mail.handlers.ts#L114-L118](apps/backend/src/app/lib/jobs/handlers/automation-mail.handlers.ts#L114-L118).
- **Trigger:** a tenant that never set `organization.address` activates any automation with a `send_email` step (automation sequences include donation asks — the `donated` exit condition exists for them).
- **What breaks:** the newsletter path blocks the send; the automation path enforces domain, phone, pause and caps but not the address, and the footer builder omits the block, so mail goes out missing a legally required element with no error.
- **Blast radius:** every automation email from a tenant without the address set — a compliance/deliverability exposure, not data loss.
- **Confidence:** high that the gate is absent (the full gate sequence and footer builder read); the legal weight rests on the project's own stated rationale on the newsletter path — the finding is the inconsistency between the two paths.
- **Fix sketch:** add the same `hasOrganizationAddress` check to the `send_email` gate, failing the run with a named fix like the verified-domain error alongside it.

---

### 12. [MEDIUM] A `task_sla_breach` automation that contains a `create_task` step re-triggers itself indefinitely

- **Where:** `create_task` links the new task to the enrolled person "so a later SLA breach can enroll them" at [workflows.handlers.ts#L783-L804](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L783-L804); the breach scan's only damping is the once-per-task `sla_breached_at` stamp at [#L493-L501](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L493-L501); enrollment blocks only an _active_ enrollment.
- **Trigger:** an admin builds "when a task breaches SLA → create a follow-up task (± email the contact)." Nothing in the schema, the step schema, or the engine forbids it.
- **What breaks:** task T1 breaches → person enrolled → workflow creates task T2 linked to the same person → enrollment completes → T2 later breaches → the completed enrollment no longer blocks → re-enroll → T3… one new task and one full sequence run (including emails) per SLA window, forever, per originally-breached task. The `supporter_lapsed` trigger got an explicit two-window re-enrollment cooldown for exactly this shape ([#L300-L305](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L300-L305)); `task_sla_breach` has none.
- **Blast radius:** one tenant's task list and one contact's inbox per instance; sends are still capped, so it cannot run away at provider scale.
- **Confidence:** high on the mechanics; medium on whether any shipped recipe suggests this combination (the engine allows it regardless).
- **Fix sketch:** exclude automation-created tasks from the breach scan (a marker), add a per-person cooldown to the `task_sla_breach` trigger like the lapsed one, or block `create_task` under this trigger at save time.

---

### 13. [MEDIUM-LOW] Every `customer.subscription.updated` event sends a "Welcome to the {Plan} plan" email and wipes the billing-alert dedup flags

- **Where:** the webhook calls the handler unconditionally at [billing/controller.ts#L757](apps/backend/src/app/modules/billing/controller.ts#L757); the handler always deletes the dedup row at [#L1098-L1102](apps/backend/src/app/modules/billing/controller.ts#L1098-L1102) and, for any non-Free plan, always sends the welcome email at [#L1130-L1148](apps/backend/src/app/modules/billing/controller.ts#L1130-L1148), with no comparison to the previous state.
- **Trigger:** any `customer.subscription.updated`, which Stripe fires for more than a plan change: setting `cancel_at_period_end` (in-app cancel), clearing it (resume), and changing item quantity (the automatic seat-bracket bump) all raise it with the plan unchanged.
- **What breaks:** an in-app cancel emails the customer a welcome to the plan they just cancelled; a seat-bracket bump double-emails (its own dedicated email plus this generic one) and wipes `billing.limit_alerts_sent`, so 90%/100% and "outgrown top bracket" dedup flags re-fire; a plan switch double-emails (direct send plus webhook).
- **Blast radius:** any workspace that cancels, resumes, switches plan, or crosses a bracket. Cosmetic-to-annoying, on the billing surface. No data or money effect.
- **Confidence:** high on the two legs read directly (the unconditional handler call, and the handler's unconditional email + flag delete). The Stripe events that raise `subscription.updated` are documented provider behaviour.
- **Fix sketch:** read the tenant row before writing it in each webhook branch, pass the previous plan/quantity/status into the handler, and send the email / reset flags only when the plan changed. Keep a single email source.

---

### Smaller findings, grouped

Each read in the source; narrow, latent, or needing a product decision.

- **Adding a household through the UI silently discards the typed address when any same-street household exists.** `findByFingerprint` falls back to a street-only fingerprint (street number + street lines, no apartment/city/state/zip — [address-normalize.ts#L36-L44](apps/backend/src/app/lib/address-normalize.ts#L36-L44)), so creating "12 Main St Apt 2, Springfield" when "12 Main St Apt 1" — or "12 Main St" in a _different city_ — exists returns the existing id and throws away the apartment, city, phone and notes the user typed ([households/controller.ts#L64-L110](apps/backend/src/app/modules/households/controller.ts#L64-L110)).
- **A workflow "goal: donated" exits on any non-refunded donation row, including a disputed one.** [workflows.handlers.ts#L923-L934](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L923-L934) matches `created_at > enrolled_at AND refunded_at IS NULL` with no `status='succeeded'` filter, so a chargeback (`status='disputed'`, `refunded_at` null) counts as "they donated, stop asking."
- **`add_tag` step config's `tag_id` is never validated as the tenant's own.** [workflows.handlers.ts#L758-L778](apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts#L758-L778) inserts `config['tag_id']` directly; `map_peoples_tags.tag_id` references `tags(id)` globally, and person-tag reads join `tags` without a `tags.tenant_id` filter — so a hand-crafted step can attach and then read another tenant's tag name. Deliberate-misuse only; a small cross-tenant metadata leak.
- **Duplicate concurrent enrollment is possible.** The "already enrolled" guard is a check-then-insert with only a plain (non-unique) index behind it ([schema.sql#L6168-L6171](apps/backend/src/app/_migrations/schema.sql#L6168-L6171)); two triggers firing for the same person at once enroll them twice, and the drip worker runs both — duplicate emails/tasks/notifications. Fix: a partial unique index on `(tenant_id, workflow_id, person_id) WHERE status='active'`.
- **The automations list loads every `workflow_runs` row the tenant ever produced.** [workflows/controller.ts#L523-L538](apps/backend/src/app/modules/workflows/controller.ts#L523-L538) counts 30-day rows in JS and loads all-time rows to keep the first per workflow, with no `limit`; `workflow_runs` has no retention sweep (`newsletter_events` does). Degrades linearly on a hot page.
- **14 tables have an `updated_at` column but no `set_updated_at` trigger, and `BaseRepository.update` does not set it.** Correct today only because each update site sets it by hand; the delivery-requests admin list is ordered by `updated_at` ([delivery-requests.repo.ts#L173](apps/backend/src/app/modules/deliveries/repositories/delivery-requests.repo.ts#L173)), so a future update through the base method that forgets the column would sort wrong. The four receipt tables added by migration are in the same position.
- **Person hard-delete leaves dangling references.** `donation_receipts.person_id` is `NOT NULL` with no FK (confirmed — no `donation_receipts` FK exists), and `workflow_runs.person_id`/`turf_segment_claims.volunteer_person_id` have none either, so all keep pointing at a deleted person; `form_submissions` are CASCADE-deleted, which the merge code itself labels "silent data loss."
- **Renaming a person no longer regenerates their display slug.** The slug-regeneration override in `PersonsController.update` is dead code — the `persons.update` endpoint calls `PersonsService.updatePerson`, which writes through the repo directly. Old links still resolve (lookup by `public_id`); newly shared URLs carry the stale name.
- **The enrollment activity-log's transaction detection is inverted.** [workflows/controller.ts#L243](apps/backend/src/app/modules/workflows/controller.ts#L243) tests `typeof …transaction === 'undefined'`, but Kysely's `Transaction` extends `Kysely`, so `.transaction` exists on both and the log write always runs outside the enclosing transaction — a rollback of an outer volunteer-signup transaction leaves a ghost "assigned to workflow" row.

---

## Planned change — two classes of automation email (relationship vs marketing)

Decided with the maintainer. This resolves finding 3 (no-subscription recipients cannot
opt out of automation email) and the marketing half of finding 11 (missing postal-address
gate). Option A was chosen: both classes live inside the automation engine, and the
marketing class reuses the existing newsletter consent gate rather than a second one. The
automatic person-level opt-out record is **deferred** — relationship-mail opt-outs are
handled by hand for now (see "Left open" below).

Files named below by what they do:

- **the automation send-consent check** — `apps/backend/src/app/modules/workflows/automation-consent.ts`, `resolveAutomationSendConsent`.
- **the automation execution handler** — `apps/backend/src/app/lib/jobs/handlers/workflows.handlers.ts`, the `send_email` case of `executeActionStep` and its gate list.
- **the automation delivery handler** — `apps/backend/src/app/lib/jobs/handlers/automation-mail.handlers.ts`, which re-checks consent at delivery.
- **the newsletter consent and sending gate** — `apps/backend/src/app/modules/newsletters/send-guards.ts` (`hasVerifiedSendingDomain`, `needsPhoneVerification`, `remainingSendAllowance`, `hasOrganizationAddress`).
- **the workflow schema** — `libs/common/src/lib/schemas/workflows.schema.ts`.
- **the workflows controller** — `apps/backend/src/app/modules/workflows/controller.ts` (create/save workflow).
- **the workflow editor form** — the frontend workflow create/edit UI.

### The two classes and the rules that attach to each

| Rule                                                            | Relationship (operational)                                  | Marketing (commercial)                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Newsletter subscription required to send                        | No — a recipient with no subscription rows is still allowed | Yes — recipient must have at least one subscribed row                                                |
| Suppression (bounce/complaint) and do-not-contact honoured      | Yes                                                         | Yes                                                                                                  |
| Postal address required in the footer before sending            | No (transactional mail)                                     | Yes                                                                                                  |
| Verified sending domain, phone (Free), pause/suspend, send caps | Yes                                                         | Yes                                                                                                  |
| Working unsubscribe                                             | Manual for now (see "Left open")                            | Yes — recipients are subscription-gated, so the existing unsubscribe endpoint already works for them |

### Step 1 — store the class on each automation

- Migration: add `workflows.message_class text NOT NULL DEFAULT 'marketing'` with a check constraint `message_class IN ('relationship','marketing')`. Default to `marketing` because it is the safe side for a value nobody set.
- Backfill existing rows **from the trigger**, not to the blanket default — otherwise existing volunteer automations would suddenly require a subscription and stop emailing volunteers. Backfill: operational triggers (volunteer signup, event registration, form submission, donation-driven, task SLA breach) → `relationship`; the "supporter goes quiet" win-back trigger → `marketing`; ambiguous triggers (tag added, manual enrollment) → `marketing`.

### Step 2 — set the class when an automation is created or edited

- Derive a default from the trigger type in the workflow schema and the workflows controller's save path:
  - Operational triggers default to `relationship`.
  - The "supporter goes quiet" win-back trigger is **forced** to `marketing` and cannot be set to `relationship` — it is re-solicitation, not a response to the recipient's own recent action.
  - Ambiguous triggers default to `marketing`; the author may change them to `relationship` and takes responsibility for that choice.
- The workflow editor form gains a class selector for ambiguous triggers, hidden/locked where the trigger determines the class.
- Note: the exact trigger names above must be reconciled against the real trigger enum in the workflow schema — that file was not read in full during the review.

### Step 3 — branch the consent check on the class

- `resolveAutomationSendConsent` gains a `messageClass` parameter. Both callers pass it: the automation execution handler at enqueue time, and the automation delivery handler at delivery time. Carry the class in the `send-automation-email` job payload (set where the `send_email` step enqueues it) so the delivery handler does not need an extra join.
- Relationship class: keep the current three checks unchanged — suppression, do-not-contact, and "has subscription rows and none subscribed"; a recipient with zero subscription rows stays allowed.
- Marketing class: require a positive subscription. A recipient with zero subscription rows, or with rows but none subscribed, is skipped. This is the single behavioural difference that stops automation being used as a consent-free newsletter channel.

### Step 4 — branch the send-step gates on the class

- Marketing class additionally requires the postal-address gate (`hasOrganizationAddress`) that the newsletter path already enforces, failing the run with a named fix — this closes finding 11 for marketing mail.
- Relationship class does not require the postal address (transactional mail).
- Both classes keep the existing gates: verified sending domain, phone verification on Free, pause/suspend, and send caps.

### Left open (accepted for now)

- **The automatic durable opt-out is deferred.** A relationship-mail recipient with no subscription rows who clicks unsubscribe still triggers an UPDATE that matches nothing, so the system records no opt-out. Two consequences the maintainer accepts for now, both worth a follow-up:
  - The unsubscribe confirmation page tells that recipient they are unsubscribed while nothing is stored. At minimum the relationship-mail path should either omit the unsubscribe link, or route the click to a staff-visible request (a notification or a simple opt-out-requests list) so there is something to action by hand — otherwise "manual" has no input to work from.
  - Until the durable record exists, honouring a relationship-mail opt-out depends on a staff member marking that person do-not-contact.
- **Send caps for relationship mail** are left metered exactly as today; whether operational mail should be metered differently is a separate decision and is not part of this change.

## Areas checked that turned up nothing worth reporting

- **The schema baseline's triggers and stored functions — the top-ranked unreviewed risk in both prior reviews.** Three functions ([schema.sql#L63-L105](apps/backend/src/app/_migrations/schema.sql#L63-L105)): two `pg_notify` with an **empty** payload (no 8000-byte NOTIFY trap; Postgres also de-duplicates identical notifies per transaction, so a 10,000-job enqueue emits one wake-up), and `set_updated_at` which sets `NEW.updated_at = now()`. All 57 triggers are one of those three; the only `AFTER INSERT` ones are the two notifies. No dated migration creates any function or trigger. There is no cascade logic, no computed-column trigger, no invariant enforced behind the application's back. The category is genuinely close to empty.

- **The receipt gap-free serial numbering — the compliance risk the task named.** `nextSerial` ([receipts.repo.ts#L41-L57](apps/backend/src/app/modules/donations/repositories/receipts.repo.ts#L41-L57)) uses `INSERT … ON CONFLICT (tenant_id, year, kind) DO UPDATE SET n = n + 1 RETURNING n` inside the issuance transaction: the counter row lock serializes concurrent issuers, a rolled-back issuance returns its number, and acknowledgements draw a separate counter kind so they never advance the audited tax run. Two partial unique indexes keep the sequences from colliding. The counter spec races five concurrent transactions and asserts `[1,2,3,4,5]` against a real Postgres. Cancel-and-replace retains the cancelled serial and references it from the successor. This part is correct; finding 4 is a different column.

- **The person-merge data-loss bug (REVIEW2 finding 4) is properly fixed.** The merge now re-points `tasks`, `workflow_runs`, `turf_assignments`, `turf_segment_claims`, `delivery_routes`, `form_submissions` and the rest, and handles the two unique-keyed access rows correctly — `companion_volunteers` keeps the target's row and deletes the source's (with its sessions and approval tokens), reasoned out as the safe direction for an access grant ([persons.repo.ts#L1172-L1229](apps/backend/src/app/modules/persons/repositories/persons.repo.ts#L1172-L1229)). (The _household_ merge did not get the same completeness — finding 2.)

- **Point-in-polygon and boundary matching.** The ray cast is the standard even-odd PNPOLY with hole subtraction and multipolygon support ([point-in-polygon.ts](apps/backend/src/app/lib/gis/point-in-polygon.ts)); the lat/lng argument order is consistent end to end — `featureContainsPoint(lat, lng, …)` converts to GeoJSON lng-first for both the bbox test and the ray cast ([boundary-store.ts#L360-L366](apps/backend/src/app/lib/gis/boundary-store.ts#L360-L366)) — so no coordinate swap places households in the wrong district. A bbox pre-filter fronts the ray cast, the per-layer cache is version-guarded by `updated_at` + feature count and re-read every load, and area order within a layer is a stable code-point sort. Re-matching is pure CPU, as the "drawing a map costs nothing" promise requires.

- **The free-plan mail-purge scheduling state machine, apart from finding 5.** `syncInboxPurgeSchedule` is called from every writer of `subscription_plan`; upgrade clears the schedule, downgrade sets it 30 days out and never extends an existing one, demo workspaces are never scheduled. Downgrade → upgrade → downgrade grants a fresh 30-day window each cycle, deliberately. A failed payment / `past_due` does not arm the purge; only an actual landing on Free does. Every delete in `purgeAllTenantEmails` is tenant-scoped, and the seven tables with an FK to `emails.id` are exactly the ones the purge removes.

- **The geocode cost control.** `enqueueGeocodeJobs` is the single choke point: mock/test geocoding is free and enqueued immediately, a real Google key is Movement-only (demo exempt) with lower tiers marked `skipped` and never sent, and allowed tenants have work spread across days at the per-tenant daily budget, stacking after the backlog. Households enqueue in import-sized chunks, so the multi-row job insert stays under Postgres's parameter limit.

- **The destructive geography migration.** `2026-08-02-e-drop-legacy-geography.ts` drops four free-text columns only after `household_districts` and `turfs.boundary_*` fully replaced them, and its `down()` is honest: it restores `turfs.ward` exactly and recreates the three `households` columns empty, refusing to invent which district belongs in `ward`.

- **The rest of the schema baseline** (per the parallel schema sub-review, which I did not re-run in full): all 58 CHECK constraints match the value sets the modules write (the hard-coded folder-id checks match `libs/common` emails), all 180 baseline indexes and the FORCE-RLS `tenant_isolation` policies on 81 tables follow the same NULLIF-escape shape, the grants cover every table, and `0001_baseline.ts`/`seedRows()` are sound. The one performance gap in that surface is finding 7.

- **NUL bytes in the frontends.** Scanned `apps/frontend`, `apps/companion`, `apps/website` and `libs/uxcommon` for source files a NUL byte would hide from grep (the first review's trap). None found — the only binary-classified files are two empty `.gitkeep` placeholders. This closes the first review's open uncertainty 5 for the trees the second review did not scan.

---

## Uncertainty register

Ordered by how much it would matter if I am right. Each names the question I would put to the maintainer.

1. **Do any large-list tenants exist today whose smart lists have already been truncated by finding 1?** The clamp has been live since commit `6d3fbd78`. _Question:_ has any tenant refreshed a smart list matching more than 5,000 people since that deploy, and if so, is its `map_lists_persons` membership now capped at 5,000?

2. **Is `runYearEndStatements` reachable as a rerun from the product UI, and does anyone re-run a completed year?** Finding 4's rerun consequence needs an admin to run a past-year batch a second time; the router permits it. _Question:_ does the receipts screen expose "run again," and is that an expected operator action?

3. **Can a `boundary_features` reshape leave the layer cache serving stale geometry?** The cache version is `boundary_sets.updated_at` + `feature_count` ([boundary-store.ts#L193-L196](apps/backend/src/app/lib/gis/boundary-store.ts#L193-L196)); editing a feature's shape changes neither unless the write path bumps the parent set. I did not read the boundaries controller's write paths. _Question:_ does every polygon edit bump the parent `boundary_sets.updated_at`?

4. **What is the Stripe dunning setting — cancel after retries, or mark unpaid?** The billing reconciliation path (`syncSubscriptionFromStripe`) treats only `active`/`trialing`/`past_due` as live and would arm the purge with no education email for an `unpaid`/`paused` subscription, while the webhook path keeps the paid plan for `unpaid`. The default (cancel after retries) is handled correctly; the inconsistency only fires under mark-unpaid. _Question:_ which is configured?

5. **Were any Stripe accounts left with two live subscriptions before the switch-plan fix (`22c3ade6`)?** The updated/deleted webhook handlers match by customer, and the ordering guard is per-subscription-object only. _Question:_ has anyone audited for tenants that acquired a second live subscription under the old Checkout-based switch, whose stray events could overwrite the tenant row?

6. **Is production guaranteed a single background-worker process?** Several small races (the enrollment double-insert, the send-allowance overshoot) are theoretical only under one worker; the `SKIP LOCKED` usage suggests multi-worker was contemplated. _Question:_ is the worker pinned to one replica?

---

## Coverage gaps after three reviews

Cumulative — what none of the three passes has read, highest-risk first.

**Highest-risk unreviewed:**

1. **The receipt PDF renderers and their mail body** — `lib/pdf/receipt-pdf.ts`, `statement-pdf.ts`, `acknowledgement-pdf.ts`, `pdf-common.ts`. These draw the legal document a donor keeps for taxes; I verified the data flowing _into_ them and the numbering, not that the rendered receipt carries every field its regime requires, nor the Toronto-timezone date arithmetic that decides which year a late-December gift is receipted in.
2. **The workflows _controller_** (`triggerWorkflow`, `enrollPerson`, the "only enroll if" condition evaluation, and the step-renumbering behaviour under active enrollments) — I read the execution handler, not the enrollment and trigger-matching logic, where a wrong condition would enroll the wrong people.
3. **The rest of `billing/controller.ts`** — checkout, portal, and the `syncSubscriptionFromStripe` reconciliation path (the `unpaid`/`paused` inconsistency in uncertainty 4 lives here).
4. **`modules/imports/` and the household CSV import path**, and `modules/settings/` and `modules/campaigns/` controllers — largely unread across all three reviews.
5. **The boundaries controller write paths** (upload, draw, reshape, delete) and `turf-boundary.ts` — I read the matching engine, not the code that writes the polygons it matches against (uncertainty 3).
6. **Most of `apps/frontend/src/app/experiences/`** (donations detail, receipts tab, campaigns, canvassing, deliveries, imports, settings), the new session-management screen under `settings/security/`, the companion apps beyond the NUL scan, and most of `libs/uxcommon/src/components/`.
7. **All test files, in every project**, and `demo/demo-seed.ts` (~900 lines, plus the receipt seeding added by `a778c6ad`).

**Read this pass but not exhaustively:** `receipts/controller.ts` (settings-status and preview helpers skimmed), `persons.repo.ts`/`households.repo.ts` (the merges and list queries read end to end; the rest partially), the schema baseline's constraints/indexes/RLS (read by the parallel schema sub-review, spot-verified by me at the load-bearing lines, not re-read in full).

**Not verifiable from the repository at all:** the live Azure Container App sizing, the live Cloudflare/DNS proxy state, and the Stripe dunning configuration — findings and uncertainties that depend on live state are marked as such above.
