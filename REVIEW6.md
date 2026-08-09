# Sixth production-risk review — the 109 commits after REVIEW5, plus the operator's three pre-ship questions

Read-only review. No code was changed by it.

`REVIEW.md` through `REVIEW5.md` hold the first five reviews. This pass covers the **109 commits
(~20,900 added lines, 301 files) that landed after `REVIEW5.md` was committed** (`1488ef6f..HEAD`,
HEAD = `5d1416a4`) — roughly 70 commits fixing REVIEW5 findings and 35 commits of new feature work
(electoral boundary maps, canvassing coverage/handover, campaign multi-ward seats, imports
hardening) — and answers three questions the operator asked directly before shipping:

1. Is there a memory leak or performance problem that will make the backend run poorly?
2. Is there a database problem, especially one that causes bloat?
3. Is there a major bug that causes user data loss?

Plus an audit of `deploy/GO-LIVE-CHECKLIST.md` and `deploy/PROD-CHECKLIST.md` against the code.

**Method.** Seven parallel read-only sub-reviews: (1) adversarial re-read of the REVIEW5-fix
commits, (2) the electoral-geography feature cluster, (3) the canvassing feature cluster, (4) a
whole-backend memory/performance sweep, (5) a database growth/churn/index sweep, (6) a data-loss
sweep over every changed write path, (7) the checklist audit. The orchestrator personally re-opened
and confirmed the strongest claims of each sub-review at the cited lines before including them; the
findings so confirmed are marked **[verified]**. Findings carried on a sub-review's reading alone
say so in their confidence note. No builds or tests were run.

---

## The three questions, answered directly

**1. Memory leak / performance: no leak; two growth-shaped performance problems, one of them
inherited from REVIEW2 and never fixed.** Every timer, event listener, Postgres LISTEN client, and
in-process cache in the backend was checked: all are cleaned up or capped (details in
"Verified clean"). The two things that will actually make the backend run worse over time on the
0.5 CPU / 1 GiB single-process container are the **dashboard's whole-table reads** (T1-3 — reads
every inbox email, every task, and every sent-email recipient the tenant has ever had, on every
dashboard load; the only REVIEW2 finding in this class that was never fixed) and the
**automations page's unbounded read of the run-history table** (T1-2 — reads every run row the
tenant ever produced, and nothing ever deletes those rows). Secondary: boundary-map files are
parsed synchronously on the request path on every cache miss (T2-1), and the boundary cache is
allowed 256 MB of estimated heap in a container with no explicit Node heap cap (T2-2).

**2. Database: no corruption-class problem; real bloat sources exist and are all fixable
cheaply.** Three tables grow forever with no retention job: `workflow_runs` (automation run
history — also read unboundedly, see T1-2), `notifications`, and `companion_ops` (the volunteer
offline-sync idempotency ledger, roughly one row per door knock, kept forever). Two mechanisms
generate dead-row churn a Burstable B1ms will feel: the nightly address-fingerprint job **deletes
and rebuilds the entire duplicates table for every tenant every night even when nothing changed**
(T2-4), and every boundary re-match pass rewrites every household-district row unconditionally,
with map-drawing sessions triggering repeated full-workspace passes (T2-5). The new boundary
tables are missing the delete-path indexes the 2026-08-04 index migration added everywhere else
(T2-6). Full table-by-table inventory below. Gift-date and country-code storage conventions were
checked and are consistent (country codes are mixed name/code only in pre-launch dev rows — moot
if test data is wiped).

**3. Data loss: nothing found that silently destroys user data on a routine path.** The import
crash-resume design is sound **[verified]**: the resume cursor is advanced by compare-and-set as
the first statement inside each chunk's transaction ([persons.service.ts:924-946](apps/backend/src/app/modules/persons/services/persons.service.ts#L924-L946)),
so chunk inserts and the cursor commit or roll back together, and a concurrent second run rolls
back instead of double-writing. The one high-consequence data-deletion path found is
low-likelihood: a corrupt-but-checksum-valid published map file erases that map's district
assignments (T1-4, one-line fix). Everything else in this class is duplication, an honestly
recorded skip, or a labeling issue — listed in Tier 2/3.

**REVIEW5-fix re-read: 13 of 15 priority fixes held up fully.** The two that did not: the
newsletter send worker re-checks the composer's chosen From address against the wrong list (T2-9),
and two donation read paths were left out of the campaign-scoping fix (T2-10).

---

## Tier 1 — fix before accepting real users

### T1-1. The production boot guard still does not check the Stripe billing webhook secret — an unset secret silently discards every billing event **[verified]**

- **Where:** `assertProductionSecrets` ([env.ts:221-266](apps/backend/src/env.ts#L221-L266)) checks
  the Connect, SendGrid, and Postmark webhook secrets but not `STRIPE_WEBHOOK_SECRET`. With it
  unset, the billing webhook handler returns early ([billing/controller.ts:763-766](apps/backend/src/app/modules/billing/controller.ts#L763-L766))
  and the route replies 200 ([billing-webhook.route.ts:13-14](apps/backend/src/app/modules/billing/routes/billing-webhook.route.ts#L13-L14)),
  so Stripe records success and never retries.
- **If left:** a deploy that loses or mistypes this one secret freezes all billing state —
  plan activations, cancellations, payment failures — permanently and silently. This is REVIEW4
  T1-11, deferred twice, and REVIEW5 already marked it "required before real payments."
- **If fixed:** one clause in `assertProductionSecrets`. Confirm the production value is set
  before deploying the check, or the deploy will (correctly) refuse to boot.

### T1-2. The automations page reads every run row the workspace ever produced, and no job ever deletes run rows **[verified]**

- **Where:** the query that finds each automation's most recent run has no LIMIT and no date bound
  ([workflows/controller.ts:697-703](apps/backend/src/app/modules/workflows/controller.ts#L697-L703));
  the sibling 30-day count also loads full rows just to count them in JS. `workflow_runs` appears
  in no retention sweep ([maintenance.handlers.ts](apps/backend/src/app/lib/jobs/handlers/maintenance.handlers.ts)
  prunes seven other tables). One row is written per person per executed step — a 4-step drip over
  100 signups/day is 400 rows/day; an import-triggered enrollment writes tens of thousands.
- **If left:** the `/automations` page gets slower every week, loading hundreds of thousands of
  rows through one query — seconds of I/O and a memory spike per visit — and the table grows on
  disk forever. This is REVIEW3's §"smaller findings" item, still unfixed on both halves.
- **If fixed:** replace the last-run query with `DISTINCT ON (workflow_id) … ORDER BY workflow_id,
created_at DESC` (the index `idx_workflow_runs_tenant_workflow_created` already serves it) and
  the count with `count(*) GROUP BY workflow_id`; add a `workflow_runs` sweep (90 days suggested —
  the UI shows nothing older) to `handlePruneRetention` following its documented pattern. Verify
  the enrollment-stepping reads ("did they open the previous email") stay inside the window before
  choosing the number.

### T1-3. The dashboard reads whole tables on every page load — the only REVIEW2 memory finding never fixed **[verified]**

- **Where:** [dashboard/controller.ts:26-88](apps/backend/src/app/modules/dashboard/controller.ts#L26-L88)
  fetches all inbox emails, all tasks, all email-close activity rows, and **every recipient of
  every email the workspace has ever sent** (no LIMIT, no date bound), then computes SLA breaches
  in JavaScript loops. `getBreachedEmails`/`getBreachedTasks` (same file) repeat the shape and
  paginate in memory after reading everything.
- **If left:** dashboard latency grows with mailbox age; a year-old busy mailbox-sync tenant puts
  this at 50k–200k rows → tens of MB of allocations and seconds of CPU per page view on 0.5 vCPU.
  Under memory pressure this is the allocation most likely to push the 1 GiB container into an
  out-of-memory kill — which also kills every in-flight background job, because API and worker
  share the process.
- **If fixed:** push the aggregation into SQL with a bounded window (e.g. sent rows from the last
  90 days), or read the `sla_breached_at` stamps the automation sweep already writes instead of
  recomputing. Medium-sized change confined to the dashboard/tasks controllers.

### T1-4. A corrupt-but-checksum-valid published map file erases every household's district rows for that map **[verified]**

- **Where:** the loader's own contract ([boundary-store.ts:411-416](apps/backend/src/app/lib/gis/boundary-store.ts#L411-L416))
  states `null` must mean "map could not be consulted — leave existing rows alone", and every
  writer honors that. But `parsePublishedFeatures` ([boundary-store.ts:363-376](apps/backend/src/app/lib/gis/boundary-store.ts#L363-L376))
  returns an **empty list** — a cacheable, real "no areas" answer — when the bytes pass their
  SHA-256 check but are not valid JSON or not a FeatureCollection. The next re-match then deletes
  every household's rows for that map, across every workspace holding it.
- **If left:** one bad output from the map-preparation script (`scripts/boundary-catalog.ts`
  computes the checksum from whatever it produced) silently wipes district assignments platform-
  wide for that map. Unlikely trigger; exactly the failure class the null contract was built for.
- **If fixed:** return `null` from the two parse-failure branches; for editable sets, treat
  "feature_count > 0 but zero loadable features" the same way. A few lines.

### T1-5. OPERATOR — the six published electoral maps are offered to every workspace, but their map files are not in production storage **[verified]**

- **Where:** the catalog lists six maps ([catalog.entries.ts:13-128](libs/common/src/lib/boundaries/catalog/catalog.entries.ts#L13-L128))
  and the settings page offers all of them; the GeoJSON files are in neither the repo nor the
  image (`apps/backend/src/app/lib/gis/boundary-data/` holds only a README; the build directory is
  gitignored). At runtime the backend downloads them from blob storage under the reserved
  `catalog/boundaries/` prefix ([boundary-store.ts:57](apps/backend/src/app/lib/gis/boundary-store.ts#L57)).
- **If left:** every attempt to add any of the six advertised maps fails, in every workspace.
- **To do:** run `npm run boundary-catalog -- build` then `-- upload` against the **production**
  storage account. Not on any checklist — added to the gap table below. (The
  `published-boundary-catalog` memory note "catalog ships empty" and the stale comment at
  boundary-store.ts:69 are both out of date.)

### T1-6. OPERATOR — passkeys are configured for `localhost` unless `WEBAUTHN_RP_ID` is set in production **[verified]**

- **Where:** `WEBAUTHN_RP_ID` defaults to `'localhost'` ([env.ts:123](apps/backend/src/env.ts#L123))
  and is the relying-party ID for passkey registration and sign-in. It appears in neither
  `.env.production.example` nor either checklist nor `deploy.yml`. Passkey UI is live on the
  sign-in page and settings.
- **If left (and unset on the live Container App — not verifiable from the repository):** passkey
  registration and sign-in are broken on the real domain.
- **To do:** verify/set the Container App secret (`webauthn-rp-id`, value `pplcrm.com` or the app
  host — decide once, it cannot change later without re-registering passkeys), and document the
  var in `.env.production.example`.

---

## Tier 2 — real defects, fix soon; decide per item

### Backend performance (owner question 1)

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | If left                                                                                                                                                                                                                 | If fixed                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2-1 | **Whole-map parse + per-feature validation runs synchronously on the shared event loop on every cache miss** — `JSON.parse` of up to 8.2 MB, per-feature (per-vertex, for editable sets) Zod validation, then a full `JSON.stringify` of all features just to size the cache entry ([boundary-store.ts:363-399](apps/backend/src/app/lib/gis/boundary-store.ts#L363-L399), [:136-138](apps/backend/src/app/lib/gis/boundary-store.ts#L136-L138)). Request-path callers: listing a published set's areas, validate, campaign area suggestions, the household address-edit inline match. The six shipped maps sum to ~146 MB estimated heap against a 96 MB cache budget, so a fleet holding all six evicts and re-parses continuously. **[verified: parse-inline and stringify-sizing; the eviction arithmetic is carried]** | The event loop blocks for hundreds of ms to seconds — for every tenant and the job worker — on each cold or evicted layer; transient multi-copy memory spikes inside 1 GiB. REVIEW4 T2-25's re-parse half, still alive. | Skip Zod for checksum-verified catalog files (the checksum already vouches for the script's output); size cache entries as `bytes.length × factor` instead of re-stringifying; optionally pre-warm layers from the match job. |
| T2-2 | **Boundary caches are budgeted 256 MB of estimated heap in a 1 GiB container with no explicit Node heap cap**, and one 20 MB uploaded layer legitimately estimates ~120 MB ([boundary-store.ts:195-223](apps/backend/src/app/lib/gis/boundary-store.ts#L195-L223)); a match pass can additionally hold all of a tenant's up-to-50 sets at once (carried).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Cache + baseline app + one dashboard request is a plausible OOM; V8 only learns the real limit when the container killer fires.                                                                                         | Shrink the two budgets (e.g. 48 MB + 48 MB) until the container grows; set `--max-old-space-size≈768` in the Dockerfile; consider a per-tenant summed-size cap at upload time.                                                |
| T2-3 | **Five outbound calls still have no timeout**: Gmail send ([emails-api.route.ts:712](apps/backend/src/app/modules/emails/routes/emails-api.route.ts#L712)), Microsoft Graph send and sync (`Client.init` with no timeout), Gmail sync's `fetchWithRetry`, SendGrid domain setup ([sendgrid-whitelabel.service.ts:102](apps/backend/src/app/lib/mail/sendgrid-whitelabel.service.ts#L102)). All other provider calls carry `AbortSignal.timeout` (verified list in the sweep). (carried)                                                                                                                                                                                                                                                                                                                                     | A hung provider call holds the user's send request (with its up-to-25 MB buffered message) or one of the four worker slots for up to undici's ~300 s defaults. Degradation, not a leak.                                 | ~30 minutes: `AbortSignal.timeout(30_000)` on the fetches; `fetchOptions: { signal }` for the Graph client.                                                                                                                   |

### Database growth and churn (owner question 2)

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | If left                                                                                                                                                  | If fixed                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2-4 | **The nightly address-fingerprint job rebuilds the duplicates table for every tenant every night, even when nothing changed** — its tail calls the rebuild unconditionally ([maintenance.handlers.ts:594-595](apps/backend/src/app/lib/jobs/handlers/maintenance.handlers.ts#L594-L595)) and the rebuild starts with a full per-tenant delete ([duplicate-maintenance.service.ts:24](apps/backend/src/app/modules/persons/services/duplicate-maintenance.service.ts#L24)); the sibling duplicates cron already has the change gate this path lacks. **[verified]** | 1–2× the whole table in dead tuples per night across all tenants plus churn in its 7 indexes — steady I/O the B1ms pays at idle.                         | One-line gate: only rebuild when the fingerprint pass actually changed rows (it already counts them).                                                                                                                 |
| T2-5 | **Every boundary re-match rewrites every row unconditionally** — delete + insert per household per map with no diff ([boundary-match.ts:148-188](apps/backend/src/app/lib/gis/boundary-match.ts#L148-L188)) **[verified]**, plus a full-row `households.boundary_checked_at` update per examined household; every area add/edit/delete during map drawing queues another full-workspace pass, and coalescing only merges jobs queued while one is pending (carried).                                                                                               | An afternoon of drawing a 40-ward map at 100k households = millions of dead tuples in `household_districts` — the table every grid and smart list reads. | Diff before writing (upsert with `IS DISTINCT FROM` guard + delete only vanished rows); delay feature-edit enqueues (`run_at = now()+60s`) so a drawing session coalesces; skip the checked-stamp when already newer. |
| T2-6 | **The new boundary tables are missing delete-path indexes** — `household_districts.set_id`, `boundary_features.set_id`, `boundary_sets.file_id`, `campaign_areas.set_id` have no leading index, so deleting or re-uploading one boundary set sequential-scans up to hundreds of thousands of rows inside the user's request; the 2026-08-04 index migration fixed exactly this class for persons/households and documents the reasoning. (carried; DDL cites checked in migration files)                                                                           | Multi-second in-request deletes at scale; the routine "re-upload to fix a bad parse" action is the trigger.                                              | One migration, three or four single-column indexes, `_ri` naming per the existing pattern.                                                                                                                            |
| T2-7 | **Two more tables grow forever with no retention**: `notifications` (reads are capped at 20, so growth only) and `companion_ops` (one row per door knock, forever; replay is only meaningful within a session's 30-day life). `background_jobs`'s nightly prune and the 5-minute watchdog also scan it with no usable index (all three existing indexes are partial on pending/processing or led by tenant_id). (carried)                                                                                                                                          | Slow disk/backup creep; constant background scan I/O on the busiest table.                                                                               | Fold both into the next `handlePruneRetention` edit (read ≤20 / 90d for notifications; 30d for companion_ops); one partial index `(status, updated_at) WHERE status IN ('completed','failed')`.                       |
| T2-8 | **Autovacuum defaults are wrong for the three churn tables** — `background_jobs` (every row updated 2-3×, never HOT because `status` is in three partial-index predicates), `potential_duplicates`, `map_lists_persons`/`map_lists_households` (full delete+reinsert per smart-list refresh). Azure's default 20% scale factor lets them carry a fifth of the table as dead rows before vacuum starts, on the tiniest I/O budget. (carried)                                                                                                                        | Vacuum forever chasing churn, competing with the workload for B1ms I/O.                                                                                  | `ALTER TABLE … SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_delay = 1)` on the four tables — plus T2-4, which removes about half the churn outright.                                            |

### REVIEW5-fix regressions and leftovers

| #     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | If left                                                                                                                                                                                            | If fixed                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T2-9  | **The newsletter send worker re-checks the composer's chosen From address against the click-verified list only** ([newsletter.handlers.ts:243-256](apps/backend/src/app/lib/jobs/handlers/newsletter.handlers.ts#L243-L256)) **[verified]** — the platform sending address (`<slug>@send.pplcrm.com`), which the composer offers whenever that option is on, can never be in that list, so the send silently falls back to the workspace default with a log line. The test send applies a third, stricter rule and refuses the same address outright. Latent until the platform sending domain (a go-live step) is enabled. | The REVIEW5 T1-9 defect class reopens on launch day for exactly the tenants the shared domain exists to serve: live sends go out from a different identity than the one chosen and test-confirmed. | Replace the list check with the shared `isSendableFromAddress` policy in the worker and in `sendTestEmail`. Do this together with the SendGrid platform-domain launch step. Also purge `verified_emails` entries when their domain is deleted (closes the deleted-domain mid-send window). |
| T2-10 | **Campaign pinning on donations misses the person page and the by-id read** — `getPersonDonationsList` ([donations.repo.ts:173-184](apps/backend/src/app/modules/donations/repositories/donations.repo.ts#L173-L184)) and `getForPerson` ([pledges.repo.ts:43-51](apps/backend/src/app/modules/donations/repositories/pledges.repo.ts#L43-L51)) filter by tenant only; the pin was added to exactly three other queries in the module. **[verified]** (`getDonationDetail` likewise, carried.) The cumulative-total query must stay cross-campaign for contribution-limit math — leave it.                                  | A campaign-pinned Editor/Viewer opening any donor's page sees every campaign's gifts and pledges — the promise the campaigns settings page makes is still not kept on the most sensitive surface.  | The same one-line `campaignPin()` `$if` the ledger now uses, on the three queries.                                                                                                                                                                                                         |
| T2-11 | **A Stripe failure while wiping a deleted workspace is only a log line** — the wipe correctly cancels before deleting the tenants row and proceeds on failure ([deletions.handlers.ts:204-216](apps/backend/src/app/lib/jobs/handlers/deletions.handlers.ts#L204-L216)), but the catch writes Pino only; the job completes, so no Sentry event or ops alert fires, and minutes later the only copy of the subscription id is destroyed. (carried)                                                                                                                                                                           | A Stripe hiccup during the nightly deletion pass leaves a subscription billing a nonexistent workspace, discoverable only by log grep.                                                             | `captureException` in the catch, or park the id in a pending-cancellations row retried by cron.                                                                                                                                                                                            |
| T2-12 | **The Stripe webhook stores an unclamped seat quantity** — the billing-page sync clamps and pushes back to Stripe, but the `customer.subscription.updated` branch stores the raw value (carried; [billing/controller.ts:891-908](apps/backend/src/app/modules/billing/controller.ts#L891-L908)).                                                                                                                                                                                                                                                                                                                            | After a portal price-switch, the email-allowance bracket is inflated until the next billing-page visit or cycle boundary. Money self-corrects.                                                     | Apply the same clamp-and-push in the webhook branch.                                                                                                                                                                                                                                       |
| T2-13 | **Cloning a team still drops members the volunteer picker didn't load** — the edit path was fixed (options merge in current members) but the clone path copies members while the stripping filter still runs against the 500-row picker window (carried; [team-form.ts](apps/frontend/src/app/experiences/teams/ui/team-form.ts)).                                                                                                                                                                                                                                                                                          | A cloned team silently loses 'former'-status and past-500 members.                                                                                                                                 | Merge the clone source's members into the options the same way the edit path does.                                                                                                                                                                                                         |

### Canvassing (before the first real canvass launch)

| #     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | If left                                                                                                                                                                      | If fixed                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T2-14 | **"Undo" on a delivered yard sign undoes anyone's delivery at any age, and can restore a to-do stop onto a canceled route** — any door whose payload says a sign was ever delivered shows Undo; the server restores the most recent delivered request and its stop with no check on the route's status, and canceled routes keep their delivered stops **[verified: route-cancel leaves delivered stops; undo has no route-status filter]** ([deliveries/controller.ts](apps/backend/src/app/modules/deliveries/controller.ts) `undoHouseholdSignDelivery`, `cancelRouteInTrx`). | A volunteer's tap-then-undo (believing it net-zero) reverts a driver's real delivery; worst case leaves a pending stop on a route nobody will drive, excluded from planning. | Refuse or skip the stop-restore when its route is canceled; on the phone, offer Undo only for a delivery made on this device this session (the local op queue knows), or confirm with the consequence named. |
| T2-15 | **A handover at a door whose sign request belongs to another campaign records nothing — deliberately — but the volunteer's phone shows success all shift** — the server no-op is a commented decision ([deliveries/controller.ts](apps/backend/src/app/modules/deliveries/controller.ts) `resolveSignRequestForDelivery`, `onConflict doNothing`) **[verified]**; the ack still reads `applied`, the toast says delivered, and the local overlay repaints "delivered" over every refresh.                                                                                        | The delivery is recorded nowhere; a driver is routed to the house later; the canvasser is contradicted by every other surface.                                               | Return a `rejected` ack with the server's wording (the phone already routes those to its held-results list).                                                                                                 |
| T2-16 | Smaller canvassing items (carried): an offline queue larger than 200 operations for one turf re-sends the same over-limit batch forever (the request schema caps at 200, the phone never slices — pre-existing, the new op type only adds volume; fix: slice `sendableBatch` to 200); a handover racing a concurrent staff route-commit can pair a pending stop with a delivered request (row-lock the request in both paths); wide-zoom coverage pans materialize every in-view door row server-side just to count them (add `LIMIT cap+1`).                                    | Rare wedges and one wasted driver trip.                                                                                                                                      | Each is a few lines, listed for the next canvassing pass.                                                                                                                                                    |

### Other

| #     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                            | If left                                                                                      | If fixed                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| T2-17 | **The campaign seat-areas "cannot delete what it never loaded" guard is frontend-only** — the server treats an empty list as "delete all" (legitimate for at-large offices) and cannot distinguish deliberate clearing from a failed load; the protection is that the form omits the field unless the read succeeded (carried; [campaigns/controller.ts:342-384](apps/backend/src/app/modules/campaigns/controller.ts#L342-L384)). | A future frontend regression silently deletes seat-area rows. Loss is small and re-typeable. | Acceptable as-is; a `seat_areas_loaded: true` echo field would make it structural. |
| T2-18 | **Import chunk failure on a transient DB error permanently skips up to 100 rows** — designed and honest (rows counted, reasons recorded, resumable history), but a one-off deadlock converts into skipped rows rather than a retry (carried; [persons.service.ts:1476-1527](apps/backend/src/app/modules/persons/services/persons.service.ts#L1476-L1527) and the three siblings).                                                 | A transient blip costs an importer up to a chunk of rows, with an honest report.             | Optional: retry a failed chunk once before recording it as errors.                 |
| T2-19 | **The boundary sweep stamps households "checked" even when a layer failed to load** — stored rows are correctly preserved, but the global `boundary_checked_at` stamp makes a household never actually tested against the unloadable map read as `outside` instead of `unknown` until the set changes (carried; [boundaries.handlers.ts:182-209](apps/backend/src/app/lib/jobs/handlers/boundaries.handlers.ts#L182-L209)).        | Wrong "outside my riding" labels during a storage hiccup; no data destroyed.                 | Stamp only households whose full required-set list actually loaded.                |

---

## Tier 3 — leave, or fix when convenient

- **Import resume double-read race** (carried): the job handler and the entity processor read the
  resume offset separately; a timed-out-but-still-running prior job committing between the two
  reads can duplicate (not lose) the rows between the offsets. Millisecond window; persons and
  households dedupe anyway. Fix by passing the handler's offset into the processor.
- **Household merge writes no merge entry in the activity log** (the person merge does, with the
  survivor's id; the household merge repoints history but never records that a merge happened).
- **Workflow step remap residual**: a single save that both deletes one step and rewrites
  another's content can still mis-pair them positionally — inherent to matching without step ids;
  the REVIEW5-prescribed design. Future: persist step ids through the editor.
- **Residency region semantics**: configured region codes apply across all allowed countries
  (deliberate fail-closed, pinned by tests), so "Canada limited to Ontario, UK unrestricted" is
  not expressible and the in-code comment claims otherwise. Product decision + comment fix.
- **Deleting an import-sourced boundary map cascades away voter-file district assignments** —
  explicit user action on that map, but the rows are not recomputable (no polygons); check the
  delete dialog names the consequence. Recovery: re-import the CSV (kept 90 days).
- **Dead-lettered import status can flap back to "processing"** if stale-recovery re-delivers the
  job; data ends correct either way.
- **A coordinates-less address edit leaves the old map answers on the household** until geocoding
  succeeds — indefinitely on plans below Movement (geocoding is Movement-gated). The status chip
  is the only hint. Decide: clear derived rows on address change, or render area cells as stale.
- **Turf-cut mutation does ~3 queries per turf in one transaction** (~2,600 round trips for a
  35k-door riding) — admin-rare; batch the inserts when next touched.
- **`person_newsletter_engagements`** grows one row per recipient per newsletter, permanently, by
  design (~50–100 MB/year for a large tenant) — set a policy later.
- **13 baseline + 8 new tables have `updated_at` but no trigger** (REVIEW3 §209 extended):
  correct only because every update site sets it by hand; `boundary_sets.updated_at` is also the
  layer-cache version key, which raises the stakes of a future miss. One migration attaching the
  existing `set_updated_at` trigger closes the class.
- **Mixed country storage in pre-launch rows** (names vs ISO codes after commit `1dbe2842`) —
  moot if test data is wiped; otherwise one-time backfill.
- **Outlook reconnect edge**: reconnecting a _different_ provider account while the OAuth cache
  yields no refresh token would pair the old account's token with the new address — unlikely;
  noted by the sweep, not flagged.

---

## Deployment checklist audit

### A. On a checklist, still open (operator actions)

| Item                                                                                                                             | Where                | Blocks real money/mail?                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Stripe key + live price IDs into Container App secrets                                                                      | GO-LIVE §2           | **Yes**                                                                                                                                                 |
| Stripe Tax origin address on the live account                                                                                    | GO-LIVE §2 / PROD §6 | **Yes** — live checkout creation fails without it                                                                                                       |
| Register live billing + Connect webhooks; swap both signing secrets                                                              | GO-LIVE §2/§7        | **Yes**                                                                                                                                                 |
| Postmark bounce/complaint webhook                                                                                                | GO-LIVE §3/§7        | **Yes for mail** — suppressions never recorded                                                                                                          |
| SendGrid live key; free-tier subuser (`sendgrid-free-tier-subuser` is empty)                                                     | GO-LIVE §4           | **Yes for newsletters**                                                                                                                                 |
| Platform sending domain `send.pplcrm.com`: authenticate, associate with subuser, DMARC, live free-tenant send test, website copy | PROD §4              | **Yes** — Gmail/Outlook-only tenants cannot pass DMARC without it. **Genuinely undone** despite PROD's "unchecked = historical" header. Pair with T2-9. |
| Twilio end-to-end companion SMS test                                                                                             | GO-LIVE §5           | Before canvassing volunteers rely on it                                                                                                                 |
| Google Maps key restrictions + billing; Google OAuth consent screen published; Microsoft publisher verification                  | GO-LIVE §6           | No, but unrestricted keys are financial exposure; OAuth items block mailbox sync for real users                                                         |
| `OPS_ALERT_SMS_NUMBER` GitHub secret                                                                                             | GO-LIVE §1           | Every monitoring-infra deploy fails until set — which also blocks the already-committed worker-probe enablement from taking effect                      |
| Postgres scale-up from Burstable B1ms                                                                                            | GO-LIVE §10          | Not day one; undersized for real load (and several Tier-2 items above bite it early)                                                                    |
| Test-data wipe decision                                                                                                          | GO-LIVE §8           | Yes before real money (also moots the mixed country-code rows)                                                                                          |
| `api.pplcrm.com` behind Cloudflare proxy — decide together with the TRUST_PROXY measurement below                                | GO-LIVE §10          | See B.                                                                                                                                                  |

### B. Required, but on NO checklist

| Item                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                      | Code or operator                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Add `STRIPE_WEBHOOK_SECRET` to the production boot guard                                                                                                                                                                                                                                                                        | T1-1                                                                                          | **Code** (one clause)                                            |
| Set `WEBAUTHN_RP_ID` (+`RP_NAME`) in production; document in `.env.production.example`                                                                                                                                                                                                                                          | T1-6                                                                                          | **Operator** + doc edit                                          |
| Upload the six boundary-catalog map files to production blob storage                                                                                                                                                                                                                                                            | T1-5                                                                                          | **Operator** (`npm run boundary-catalog -- build` / `-- upload`) |
| Stripe dunning decision: set live failed-payment handling to "cancel subscription" — the reconcile path assumes it; under "mark unpaid" a paying tenant fixing a card is silently dropped to Free with the mail purge armed (REVIEW4 question 1, still undecided)                                                               | [billing/controller.ts:673-698](apps/backend/src/app/modules/billing/controller.ts#L673-L698) | **Operator** (Dashboard)                                         |
| Stripe Customer-Portal **live** configuration — `createPortalSession` fails without a saved live config; decide cancel + plan-switch exposure (plan-switch tolerated by clamping, T2-12)                                                                                                                                        | [billing/controller.ts:608-636](apps/backend/src/app/modules/billing/controller.ts#L608-L636) | **Operator**                                                     |
| Annual price IDs (`STRIPE_PLAN_*_ANNUAL_PRICE_ID`) in prod secrets + example file + checklist (GO-LIVE §2 lists only the monthly pair)                                                                                                                                                                                          | [env.ts:58-59](apps/backend/src/env.ts#L58-L59)                                               | **Operator** + doc edit                                          |
| Beta-approval gate: verify `AUTO_APPROVE_TENANTS` is absent in prod; know the emailed approve/decline flow; decide whether the gate stays on at launch (GO-LIVE §11's signup smoke test doesn't mention the pending-approval hold)                                                                                              | [env.ts:105-108](apps/backend/src/env.ts#L105-L108)                                           | **Operator**                                                     |
| Measure the proxy hop count behind `TRUST_PROXY=1` (REVIEW2 finding 16, never resolved): log `req.ip` / `x-forwarded-for` / `cf-connecting-ip` for one request through a Worker and one direct; if Worker-path requests carry two hops, every per-IP limit on the public donation/form/companion endpoints is one shared bucket | [env.ts:174-197](apps/backend/src/env.ts#L174-L197)                                           | **Operator** (one measurement, then adjust)                      |
| Declare the Container App in bicep (sizing + probes are still manual-only; a re-create silently loses them)                                                                                                                                                                                                                     | REVIEW2 finding 17, unchanged                                                                 | **Code** (infra), optional hardening                             |

### C. Checklist statements now stale or wrong

- **PROD-CHECKLIST header** ("unchecked boxes are historical — they were done") is wrong for the
  §4 platform-sending-domain block, which postdates bring-up and is genuinely not done.
- **PROD-CHECKLIST §4 GitHub-secrets list** names `DB_HOST/DB_PORT/DB_NAME/…/SHARED_SECRET`; the
  workflow actually reads `PROD_DB_HOST/PROD_DB_NAME/PROD_DB_MIGRATION_USER/PROD_DB_MIGRATION_PASSWORD`
  and no SHARED_SECRET or DB_PORT (GO-LIVE §1's table is correct). §4 also still carries the
  long-done "add a Worker deploy step" items, and omits `CF_APP_PAGES_PROJECT`.
- **[boundary-store.ts:69](apps/backend/src/app/lib/gis/boundary-store.ts#L69)** says "THE CATALOG
  IS EMPTY IN THIS RELEASE" — false since the six entries landed; it misled one of this review's
  own sub-reviews.
- **GO-LIVE §11 step 1** omits the beta-approval hold (signup stalls at pending until ops approves
  via the emailed link).
- **Fixed since last checked, for the record:** the deploy smoke test now asserts the new
  revision's build SHA on `/healthz` (`deploy.yml`), closing REVIEW.md's pass-against-old-revision
  hole. The import wizard no longer sends CSVs through the 1 MiB API body limit — files go straight
  to blob storage via a SAS URL with server-side size enforcement, making REVIEW4 T1-6 moot.

---

## REVIEW5-fix re-read scorecard

13 of 15 priority fixes verified correct at HEAD, including: Stripe pause uses
`pause_collection` and cannot arm the mail purge; tenant wipe cancels the subscription before the
row is destroyed; duplicate checkout cancels only the superseded id and stray-subscription
webhooks are ignored; the goodbye-email carve-out sends exactly one relationship-class email,
respects suppressions absolutely, and is locked to its trigger server-side; the step-remap
signature now covers all content columns with symmetric normalization and real regression tests;
both 401 handlers null the in-memory user and all guards require verified email (no redirect loop
remains); tag rename/merge rewrites both stored rule shapes in-transaction; merges repoint
activity history in-transaction; the CSV tokenizer handles RFC-4180 quoted newlines and rewinds
unbalanced quotes exactly; the placeholder-household bulk-move guard exists server-side; the
picker-window team-edit fix holds for edits (not clones — T2-13); the residency acknowledgment has
its own confirm control; admin routes/sidebar/navbar all use the shared privileged-role check,
failing closed. The two that did not hold: T2-9 (newsletter From re-check) and T2-10 (donations
person-page scoping).

## Verified clean — worth knowing before launch

- **Job workers**: single timer chain in both workers (the REVIEW.md timer-multiplication class is
  still fixed); exactly two persistent LISTEN clients with correct reconnect; pool 20 vs 4+1
  worker slots; per-tenant slot reservation; every heavy handler batched with self-requeue.
- **In-process caches**: every module-level Map/Set is either a constant table, swept on an
  interval, or LRU-bounded (rate limiters, WebAuthn challenges, settings throttles).
- **Imports**: streaming two-pass reads, 20k rows per execution with durable continuation,
  compare-and-set cursor in-transaction **[verified]**, blob deleted only after commit, dead-letter
  terminality, honest per-row skip reasons.
- **Boundary data protection**: all three district writers scope deletes to the layers actually
  loaded; import-sourced rows are excluded from every delete; turfs survive map deletion
  (`SET NULL` + explicit missing-map state); area renames propagate to turfs in-transaction;
  campaign-area ownership is asserted server-side; RLS forced on all three boundary tables;
  tenant-safety and reserved-storage-prefix checks hold.
- **Canvassing companion**: the new yard-sign handover op is idempotent through the ledger,
  transactional with route advancement, dependency-safe in the offline queue (a lost response
  drains as `duplicate` acks), and the service worker still refuses to cache error pages.
- **Grid area columns**: one lateral join per query (not per map), count-query attaches it only
  when referenced, frontend column cache is invalidated on map changes, sign-out, and 401.
- **Paging clamp** (`resolvePageWindow`) still applied on all 33 call sites including the two
  heaviest repos; full scans batch at 5k.
- **Coverage/pan queries**: SQL-aggregated, bbox-validated, hard-capped at 2,000 doors and honest
  about dropping (not sampling) beyond the cap.

## Coverage and verification notes

Sub-review claims marked **[verified]** were re-read by the orchestrator at the cited lines at
HEAD (`5d1416a4`); "carried" findings rest on the sub-review's reading, each of which cited lines
it personally opened. Not read: test-file internals (deliberate, all six reviews), the Nx/tooling
configuration. Not verifiable from the repository: live Container App env values (including
whether `WEBAUTHN_RP_ID` and `STRIPE_WEBHOOK_SECRET` are set), Stripe dashboard state (dunning,
portal, live webhooks), Cloudflare/Azure live state, and the real proxy hop count behind
`TRUST_PROXY=1`.

### Suggested order of work

1. **Code, small, before launch:** T1-1 (boot guard), T1-4 (null-vs-empty), T2-4 (one-line churn
   gate), T2-6 (three indexes), T2-10 (three `$if` clauses), T2-7's `handlePruneRetention` batch.
2. **Code, medium, before real load:** T1-2 (automations query + retention), T1-3 (dashboard),
   T2-1/T2-2 (parse off the hot path + heap cap), T2-9 (From policy — with the platform-domain
   launch step), T2-5 (re-match diffing).
3. **Operator, before real users:** T1-5 (map upload), T1-6 (WEBAUTHN_RP_ID), then checklist
   tables A and B top-to-bottom.
