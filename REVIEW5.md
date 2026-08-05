# Fifth production-risk review — the surface the first four reviews never read

Read-only review. No code was changed by it.

`REVIEW.md`, `REVIEW2.md`, `REVIEW3.md`, and `REVIEW4.md` hold the first four reviews. All of
REVIEW4's Tier 1 and Tier 2 findings (except the two deliberately deferred: the import 1 MiB
body limit T1-6, and the Stripe webhook-secret boot guard T1-11) were fixed, verified, merged,
and deployed before this pass began. This review reads what none of the four earlier passes
opened, as listed in REVIEW4's own "Coverage after four reviews" section, plus the natural
follow-on work:

1. The workspace-settings frontend pages beyond security/boundaries (account, API keys,
   billing UI, campaigns, deliveries, domains, donations incl. the receipts-regime page,
   Gmail/Outlook connect, modules, phone, services, storage, personal settings).
2. The campaign create/edit form, the campaigns experience, fundraising/pledges, and the
   donations-experience files REVIEW4 did not read.
3. The four never-read dialogs (companion-settings, turf-vocabulary, yard-sign-standing,
   assign-volunteer) plus the volunteer-access, shifts, and events experiences.
4. The companies and tasks importers end to end, and the import-verification job handler.
5. The frontend application plumbing: routes, guards, interceptors, error handling, all
   services, layout, command palette, dashboards, navbar/sidebar, theme, tour.
6. The people-side experiences: persons, households, duplicates/merge, tags, teams, users,
   profile, activity.
7. The content-side experiences: newsletters, lists, the form builder, exports, files, tasks,
   the dashboard, go-live, the help center.
8. The marketing website (apps/website) checked claim-by-claim against the code.
9. An independent adversarial re-read of the 25 commits that fixed REVIEW4.
10. A test-coverage gap map: which load-bearing behaviors have no test at all (test internals
    stay excluded, as in all four prior reviews).

Ten focused sub-reviews ran in parallel. The orchestrator re-opened and personally confirmed
the strongest claim of each area at the cited lines before including it; the ones so verified
are marked **[verified]** below. Where a claim was carried on the sub-review's reading alone,
the finding's confidence note says so.

**Calibration, as directed by the maintainer:** this review reports what real tenants, donors,
and volunteers will plausibly hit — data loss, wrong documents, dead-end flows, silent failure.
Not military-grade security, not hostile-precision races, not polish.

**Every finding carries two risk lines:**

- **If left:** what actually happens to users if nothing is done.
- **If fixed:** what the fix touches and what could regress.

---

## Tier 1 — fix before launch

### T1-1. Pausing an account promises "billing paused" in writing, but the Stripe subscription keeps charging **[verified]**

- **Where:** [account-settings.ts:51-59](apps/frontend/src/app/experiences/settings/account/account-settings.ts#L51-L59) (dialog copy), [auth/controller.ts:1114-1154](apps/backend/src/app/modules/auth/controller.ts#L1114-L1154) (`pauseTenant` — sets `paused_at`, emails "you will not be billed", makes no Stripe call). Verified: `paused_at` appears nowhere in `apps/backend/src/app/modules/billing/`.
- **Trigger:** an admin of a paid workspace pauses it — the normal between-elections action for this product's audience.
- **If left:** recurring charges continue against a written "you will not be billed" promise, with nobody signed in to notice. Refund demands and chargebacks.
- **If fixed:** either call Stripe's `pause_collection` in `pauseTenant` (check how the webhook/reconcile paths read a paused subscription) or change the dialog and email copy. The copy fix is safe and immediate; the code fix is the honest one.

### T1-2. Deleting an organization never cancels its Stripe subscription — a dead workspace is charged forever **[verified]**

- **Where:** [auth/controller.ts:1418-1474](apps/backend/src/app/modules/auth/controller.ts#L1418-L1474) (schedule; no Stripe call), [deletions.handlers.ts](apps/backend/src/app/lib/jobs/handlers/deletions.handlers.ts) (the wipe worker imports no billing module and hard-deletes the tenants row, destroying the stored Stripe ids; webhooks for the gone tenant are ignored at [billing/controller.ts:881](apps/backend/src/app/modules/billing/controller.ts#L881)).
- **Trigger:** a paid workspace deletes itself from Settings → Account.
- **If left:** the subscription outlives all data and every user; the only way to stop the charges is a bank dispute against pplCRM's Stripe account.
- **If fixed:** cancel the subscription at the top of the wipe in `deletions.handlers.ts` (before the tenant row is dropped; log-and-continue on Stripe failure so the wipe still runs). Doing it there — not at scheduling time — keeps the 24-hour cancel-link window intact.

### T1-3. Any save on the Donations settings page silently lifts the fail-closed residency compliance gate **[verified]**

- **Where:** [donations-settings.ts:743](apps/frontend/src/app/experiences/settings/donations/donations-settings.ts#L743) — the page's single Save always includes `{ key: 'donations.residency_acknowledged', value: true }`, and the same Save covers the whole receipts configuration; the gate it lifts is [donation-guards.ts:22-31](apps/backend/src/app/modules/donations/donation-guards.ts#L22-L31). This is the key's only writer in the repository.
- **Trigger:** an admin opens Workspace → Donations to fill in receipts details (the natural first task) and clicks Save without ever reading the residency card.
- **If left:** the "tenant deliberately confirmed residency rules" record the gate exists to create is untrue for any tenant whose first save was about something else.
- **If fixed:** send the acknowledgment only from an explicit control on the residency card (or when its fields changed). Frontend-only; update the paused-donations banner to point at the specific confirm.

### T1-4. Session expiry with a tab open live-locks the app instead of showing the sign-in page **[verified]**

- **Where:** the 401 handlers clear tokens but never the in-memory user ([error.service.ts:100-118](apps/frontend/src/app/services/error.service.ts#L100-L118), [trpc-refreshlink.ts:96-103](apps/frontend/src/app/services/api/trpc-refreshlink.ts#L96-L103)); the sign-in guard then bounces the stale "verified user" straight back to /dashboard ([login-guard.ts:14-16](apps/frontend/src/app/auth/login/login-guard.ts#L14-L16)), whose queries 401 again — endlessly, with error toasts muted.
- **Trigger:** the everyday case — a session or refresh cookie expires while a tab is open; also session revocation from the new session-management screen, password resets, tenant pause.
- **If left:** the most common auth event in the product produces a flashing, broken dashboard with no sign-in form; recovery only via manual reload or the navbar Sign out.
- **If fixed:** the 401 path must null the user signal before navigating (expose `AuthService.discardSession()` to ErrorService via a registered callback to avoid circular injection). Regress-test that a genuinely signed-in user still can't sit on /signin.

### T1-5. A signed-in-but-unverified user loops forever between /signin and /dashboard — at launch this hits every new signup **[verified]**

- **Where:** the sign-in page's effect navigates to /dashboard for any non-null user with no `email_verified` check ([signin-page.ts:74-79](apps/frontend/src/app/auth/signin-page/signin-page.ts#L74-L79); its suppress flag is only set mid-submission); [auth-guard.ts:14-16](apps/frontend/src/app/auth/auth-guard.ts#L14-L16) bounces unverified users back to /signin. The login guard's own comment names this exact loop but only the guard was fixed.
- **Trigger:** live today when a user changes their own email (the profile page refreshes the user signal to unverified); at launch, every successful signup once the beta hold is off (the backend issues tokens for non-pending signups).
- **If left:** the verify-your-email panel sits behind an infinite redirect loop; reloads don't help.
- **If fixed:** two lines — the effect requires `user()?.email_verified`. Regress-test that a verified user landing on /signin is still forwarded in.

### T1-6. The workflow step-edit remap shipped in the last round does not work: its "content signature" reads a column that is null for most steps **[verified]**

- **Where:** the old-step snapshot selects only `step_number, kind, config` ([workflows/controller.ts:109-115](apps/backend/src/app/modules/workflows/controller.ts#L109-L115)); email subject/body live in dedicated columns and wait delays in `delay_days`/`delay_unit` ([controller.ts:126-141](apps/backend/src/app/modules/workflows/controller.ts#L126-L141)); the editor sends `config: null` for waits and for emails without an engagement condition ([workflow-form.ts:731-750](apps/frontend/src/app/experiences/workflows/ui/workflow-form.ts#L731-L750)). So every email step's signature is the identical `send_email|null` and the remap pairs emails by position.
- **Trigger:** editing an active automation with more than one email (or wait) step — inserting or deleting one while contacts are mid-sequence.
- **If left:** the exact harms REVIEW4 T1-3 was declared fixed for survive in the common case: inserting an email above someone re-sends what they already received; deleting the first email makes people skip one and silently completes others — while the editor's new warning and the remap log both claim edits are handled.
- **If fixed:** fold `subject, preview_text, html_content, plain_text_content, delay_days, delay_unit` into the snapshot and `stepContentSignature`, normalized the way the insert normalizes. The existing two-pass structure then works as designed. One test per scenario (a test-gap row below also covers this).

### T1-7. The shared CSV parser tears any row whose quoted cell contains a line break — silent data corruption in all four importers **[verified]**

- **Where:** [csv.worker.ts:51](libs/uxcommon/src/components/csv-import/csv.worker.ts#L51) splits the file into lines before any quote handling; [csv.worker.ts:20-42](libs/uxcommon/src/components/csv-import/csv.worker.ts#L20-L42) tracks quotes only within one line. This worker parses every file for people, companies, households, and tasks imports.
- **Trigger:** any CSV cell with a line break inside quotes — which RFC 4180 allows and Excel/Sheets/CRM exports produce whenever a notes, description, or details cell has more than one line. The companies and tasks importers map exactly those fields.
- **If left:** rows are torn at the break — columns shift, phantom garbage rows appear, counts inflate — with no error at any point.
- **If fixed:** parse the text as one character stream with newline handled inside the quote state (same code shape as `splitLine`). One file. Guard the unbalanced-quote case (cap cell length or fall back to line mode) so a stray quote doesn't swallow the file.

### T1-8. The newsletter wizard's own merge-field instruction makes every recipient receive "Hi {}" **[verified]**

- **Where:** the wizard's helper text says to type `{{first_name}}` ([newsletter-add.ts:204](apps/frontend/src/app/experiences/newsletters/ui/newsletter-add.ts#L204)); the server substitutes single-brace CamelCase tokens only ([newsletter-render.ts:15](apps/backend/src/app/lib/mail/newsletter-render.ts#L15), [:179-208](apps/backend/src/app/lib/mail/newsletter-render.ts#L179-L208)) — `first_name` is an unknown field, resolves to empty string, and the outer braces remain: the literal text `{}` where the name should be.
- **Trigger:** a user does exactly what the help text shows and sends.
- **If left:** personalization written per the app's own instruction is broken at full audience scale on the flagship flow, with no error anywhere.
- **If fixed:** one-line copy change to `{FirstName|there}` (zero risk), or add underscore/double-brace aliases in the renderer. Re-check the Help Center newsletter article for the same claim.

### T1-9. The newsletter wizard requires a From name and address, then ignores both on the real send — while the test send honors them **[verified: sender fields absent from the payload builder and schema]**

- **Where:** required and validated at [newsletter-add.ts:150-155](apps/frontend/src/app/experiences/newsletters/ui/newsletter-add.ts#L150-L155); never included in `buildPayload` (:1017-1037) and absent from `AddMarketingEmailObj` ([marketing.schema.ts:44-70](libs/common/src/lib/schemas/marketing.schema.ts#L44-L70)); the send worker always uses the workspace default, falling back to the literal from-name "pplCRM Team" ([newsletter.handlers.ts:237-245](apps/backend/src/app/lib/jobs/handlers/newsletter.handlers.ts#L237-L245)); the test send prefers the caller's values ([newsletters/controller.ts:757](apps/backend/src/app/modules/newsletters/controller.ts#L757)).
- **Trigger:** any workspace with more than one verified sender picks the non-default one — and the test send falsely confirms the choice took.
- **If left:** wrong sender identity on live sends; "pplCRM Team" as the visible from-name where no default name was set.
- **If fixed:** persist the two fields (schema + column + worker read, ~4 files) or replace them with a read-only display of the workspace default plus a change link. The second is small and honest — an operator call (see Questions).

### T1-10. One click on the change-household dialog can move every address-less person in the workspace into one household **[verified: the bulk move has no placeholder guard]**

- **Where:** address-less people all share one reused blank household; the person form's "Assign household" flow asks "Everyone, or just this person?", and "Everyone" calls `moveEntireHousehold` which bulk-updates every person pointing at the old household id with no placeholder check ([person-form.ts:389-430](apps/frontend/src/app/experiences/persons/ui/person-form.ts#L389-L430), [persons/controller.ts:143-163](apps/backend/src/app/modules/persons/controller.ts#L143-L163)).
- **Trigger:** open any no-address contact, assign a household, answer "Everyone" — a natural reading of "their family".
- **If left:** hundreds of unrelated contacts silently acquire one street address; geocoding, electoral areas, and turfs inherit it; there is no record of who was moved.
- **If fixed:** skip or refuse the "Everyone" option when the current household is the placeholder (the component already has the computed); optionally add a backend guard refusing `moveEntireHousehold` from the placeholder id.

### T1-11. Editing a team silently removes members the volunteer picker didn't load **[verified: the constructor effect strips ids missing from the picker window]**

- **Where:** [team-form.ts:145-173](apps/frontend/src/app/experiences/teams/ui/team-form.ts#L145-L173) strips any member absent from the picker query (500 rows, statuses prospective/active/inactive — so every "former" volunteer, and everyone past 500); save then **replaces** the full roster ([teams/controller.ts:274-284](apps/backend/src/app/modules/teams/controller.ts#L274-L284)).
- **Trigger:** mark a team member's volunteer status "former" on their person page, then rename the team. Toast says "Team updated"; the member is gone.
- **If left:** ordinary team edits quietly shrink rosters; turf and task assignment built on membership follows.
- **If fixed:** filter only the add-choices, never already-member ids (or merge the team's own members into the options before filtering). Contained to team-form.ts — the in-file comment shows the filter was meant for the add-list only.

### T1-12. Cancelling a pledge shows success even when Stripe wasn't told — the donor keeps being charged **[verified]**

- **Where:** [donations/controller.ts:200-224](apps/backend/src/app/modules/donations/controller.ts#L200-L224) — the Stripe cancel is wrapped in a log-only catch, and is skipped entirely when the connected-account lookup returns nothing; the row is marked cancelled regardless; the UI toasts "Pledge cancelled successfully".
- **Trigger:** staff cancels a pledge during a transient Stripe failure, or after Stripe was disconnected (which any member can do — Tier 2 below).
- **If left:** the CRM says cancelled while the donor's card is charged monthly; the next webhook can even flip the row back to active, contradicting the toast.
- **If fixed:** treat "already canceled" Stripe errors as success but rethrow everything else so the UI shows the failure; decide explicitly what a missing connected account should do. One method.

---

## Tier 2 — real defects, fix soon; decide per item

Access and roles:

1. **Viewers pass the admin route guard and see the full ADMIN surface.** `role-guard.ts:17` and the sidebar/navbar test only `role === 'user'`, so Viewers — the weakest role — walk into /workspace, /users, /go-live, /campaigns, /volunteer-access and collect 403 toasts ("Unable to load users. Try refreshing" — wrong diagnosis); the shared helper `isPrivilegedRole` exists and its doc comment names this exact anti-pattern. Backend authorization holds throughout. _If fixed:_ switch both sites (guard + sidebar/navbar predicates) to the helper; add the missing viewer spec case.
2. **Stripe disconnect, Stripe dashboard login link, and donation-period CRUD have no role gate.** All six are plain plan-gated `authProcedure` ([donations/trpc.router.ts:173-221](apps/backend/src/app/modules/donations/trpc.router.ts#L173-L221)) while every sibling settings mutation is adminOrOwner: any Editor can sever the payment connection, obtain a live Stripe Express dashboard link (payouts, bank account), or rewrite legal contribution-limit windows. _If fixed:_ swap to the adminOrOwner base; all legitimate callers are on the admin-only page already.
3. **Campaign-pinned Editors and Viewers can read every campaign's donations and pledges.** The ledger and pledge queries filter tenant only; the campaigns settings page promises "everything they see and do stays in" their campaign. Same class as REVIEW4 T2-19, now on the most sensitive surface. _If fixed:_ scope reads to the pinned campaign for non-admins — several read paths in one module; needs the product call below.

Money and compliance:

4. **The billing quantity clamp blinds both reconcilers — the Stripe-side overcharge is now never corrected.** The REVIEW4 T2-10a fix stores the clamped quantity, so the daily sweep and the invoice-paid reconciler see nothing to fix and Stripe keeps billing the un-clamped number indefinitely; before the fix the overcharge self-corrected within one cycle. The log line claims the opposite. _If fixed:_ call `syncSubscriptionQuantity` when clamping (idempotent), or store the raw value and clamp only for display. (Reachability today gated on the live portal configuration — a known launch to-do.)
5. **Residency region codes apply to donors of every allowed country.** Allow Canada+Ontario plus the UK and every UK donor is refused "must reside in: ON" ([donations/controller.ts:350-358](apps/backend/src/app/modules/donations/controller.ts#L350-L358)); the UI can only produce region lists for 5 of the 11 offered countries. Also: restriction ON with zero countries enforces nothing, silently. _If fixed:_ scope region checks to the donor's country; warn on the empty-list state.
6. **Clearing the fallback donation-limit field saves a $0 limit that refuses every gift.** `Number('') === 0` ([donations-settings.ts:736](apps/frontend/src/app/experiences/settings/donations/donations-settings.ts#L736)); donors then see "exceeds the maximum limit of $0". _If fixed:_ reject ≤ 0 client-side and decide what empty means (an explicit "no limit" option would be honest).
7. **Manually recorded gifts always land in the office fund, ignoring the campaign the recorder is working in.** The record-donation dialog never sends `campaign_id` though the API accepts it; per-campaign contribution-limit accounting is quietly wrong; the settings page promises donations stay separate per campaign. _If fixed:_ send the active context id and say in the dialog which fund the gift joins — unless office-by-default was deliberate (operator question below).
8. **The public donation embed and preview hardcode "$ CAD" while the charge uses the workspace currency.** Wrong-currency labels for donors of every non-CAD workspace — the exact class the workspace-currency service was introduced to end. _If fixed:_ interpolate the currency code; already-pasted snippets keep the old label until re-copied.

Imports:

9. **A transient first-attempt failure marks the import "failed" while the job silently retries — and the offered "Try again" runs the whole import a second time.** Companies/households/tasks have no dedupe, so every row lands twice; the retry also re-inserts chunks the failed attempt already wrote. _If fixed:_ only mark `data_imports` failed on the final attempt (the worker already distinguishes it), and/or show "retrying" in the wizard.
10. **An import whose worker dies is stuck at "Processing" forever and can never be deleted.** The dead-letter path never updates `data_imports`, no stuck-import sweep exists (exports have one), and delete refuses pending/processing rows. _If fixed:_ copy the exports stale-sweep pattern or reuse the mark-failed block in the dead-letter path.
11. **One over-long cell kills an entire companies/tasks import at the last step with a raw Zod dump.** Limits exist only in the mutation schemas; the wizard checks nothing; up to 5,000 rows refused for one 1,001-character description. _If fixed:_ enforce the same limits in the wizard as row-level skips with reasons.
12. **Every import completion email's only button links to `/imports/<id>` — a route that does not exist.** Lands on the app-wide Not Found. _If fixed:_ one string (point it at `/imports`).
13. **Task due dates go through `new Date()`:** DD/MM files import silently wrong dates; unparseable ones silently vanish; date-only ISO can shift a day. _If fixed:_ parse explicit formats and report unparseable values; state the format in the wizard.
14. **Companies/tasks chunk failures discard every error detail while the import reports "completed"** — the REVIEW4 T1-5 fix covered persons+households only, and the History page's "skipped rows stay downloadable" promise is never true for these two types. _If fixed:_ extend the T1-5 pattern to all four processors.

Newsletters, lists, forms:

15. **Every list page's "Avg Open Rate"/"Avg Click Rate" cards always show 0%.** Template reads `openRate`/`clickRate`; backend returns `avgOpenRate`/`avgClickRate`; the progress bars beside them read the right keys and show the truth. _If fixed:_ two key renames.
16. **Clicking a respondent on the form Responses tab lands on Not-found.** Links to `/persons/:id`; the app's routes are `/people`. _If fixed:_ one string.
17. **The donation-page detail view deletes live published pages through the unguarded CRUD endpoint,** bypassing the draft-only, zero-response guard the Forms page uses. A printed `/d/:slug` link dies in one click-plus-confirm. _If fixed:_ point the page at the guarded verb or add the same guard to the CRUD delete.
18. **Raw-HTML edits to a newsletter draft are silently reverted** — the stale embedded block-JSON comment wins on reopen, and toggling back to visual overwrites the HTML. _If fixed:_ strip/refresh the embedded comment on raw edits, or confirm before overwriting; the round-trip logic needs care.
19. **The send confirm's "Send to N people" and the client-side allowance block use an estimate that double-counts and can floor at zero** — near the monthly cap it wrongly hard-disables "Send now" (scheduling bypasses it, proving it advisory). _If fixed:_ label it an estimate and/or expose the backend's exact pre-send count; drop household tag usage from the sum.

Volunteering:

20. **Editors are offered admin-only canvassing actions and get a swallowed 403 that says "Try again".** /canvassing has no role guard; Survey-settings save and the join-code Create/Rotate/Send-to-phone are adminOrOwner; every catch replaces the server's honest message with a false retry suggestion — at canvass-launch time. _If fixed:_ route caught errors through `getUserErrorMessage` (a few lines per catch); optionally hide the admin-only controls.
21. **The Approvals page has no way to decline a pending volunteer.** Unwanted QR-scan signups inflate the "awaiting approval" badge forever; the backend's revoke already accepts any status. _If fixed:_ add a Decline action calling the existing endpoint; no backend change.
22. **Cancelling a volunteer's shift never frees capacity.** The volunteer-events counts include cancelled rows (the sibling events module excludes them); the public page says "Event full" and refuses signups the organizer has room for. _If fixed:_ add the status filter to the two subqueries, the signup check, and the two frontend counts.
23. **Roster hours/notes typed into the shift form are silently lost when the header "Save event" is clicked** — only the small per-row check button persists them; status autosaves, making the trap likely. _If fixed:_ include dirty roster rows in the header save or save on blur; count them in the unsaved-changes guard.

Data hygiene:

24. **The duplicates merge preview claims "both records already agreed · nothing overwritten" when the two records hold different emails/phones** — the duplicate's values are permanently deleted, endorsed by the UI's own sentence (and the repo method's "both emails kept" comment is untrue). _If fixed:_ say what will be discarded (the card already shows both values); optionally park a differing email in `email2`.
25. **Renaming or merging a tag silently breaks smart lists whose rules reference it, while the dialog promises renames apply everywhere.** Propagation rewrites `definition->'tags'` but not rule-builder `advancedFilterModel` values; the list quietly shrinks to zero and newsletters targeting it follow. _If fixed:_ one more UPDATE walking the rules in the same transaction (check the older `filterModel.tags_expression` shape too).
26. **Merging people or households orphans the duplicate's activity history and the merge itself never appears on the survivor** — logged interactions (door-knocks, calls) become unreachable; the merge log entry lacks `entity_id`. _If fixed:_ repoint `user_activity` rows in the merge transaction and log with the target id.
27. **Staff "Collect donation" fabricates Canada/Ontario for donors with no address** before eligibility and contribution-limit checks ([person-view.ts:501-505](apps/frontend/src/app/experiences/persons/ui/person-view.ts#L501-L505)) — legal-adjacent gates run against an invented province in every workspace. _If fixed:_ block with "add the donor's address first" or pass the absence through.

Website copy (both fixes are copy-only):

28. **/districts still promises boundary-match counts re-run "every time you save an area … you find out immediately".** The Aug 4 change made counts run on open and on demand; the Help Center was corrected the same day, the website was not. _If fixed:_ one sentence mirroring the help wording.
29. **The security page claims "errors shown to users carry a support code"** — only background mailbox-sync failures mint one; the tRPC path (where users actually see errors) has no code. _If fixed:_ soften the sentence, or build the request-path correlation id (already a known gap) and keep it.

---

## Tier 3 — leave, or fix only when convenient

- **Failure states rendering as confident empty states** (new instances of the REVIEW4 T2-28 class): "No pledges yet", zeroed donation tiles, "No email address"/"Unknown" on the person standing card, "No connections recorded", "None requested" on the yard-sign control, "No people match that search" in the assign-volunteer dialog, "No periods defined", billing page's infinite spinner with no retry, deliveries settings silently showing engine defaults a save then writes over. One error-branch per surface whenever each is next touched.
- **Plan-gate presentation:** Donations (Grassroots+) and Deliveries (Movement) settings render fully editable to lower plans, failing only at the end or reading as false "Not connected"/"No periods" states; the tier-lock banner machinery already exists for email-sync. The yard-sign control renders dead on sub-Movement plans.
- **Settings odds and ends:** the Storage page can delete the configured receipt-signature image (its only liveness pointer is skipped by `includeEntityOwnership: false`); deleting a verified domain leaves the default From address pointing at it; /workspace has no unsaved-changes guard; the personal-settings dialog persists nothing after a failed load while claiming instant apply; sync pages toast "completed" alongside an error card; the account-deletion banner says "being permanently deleted" during the 24-hour cancel window; dead duplicate schedule/cancel procedures on the settings router; period dates and tax-tier percentages have small timezone/rounding display flaws.
- **Newsletters/forms/tasks small items:** the newsletters grid's "no audience yet" guard never fires (audience JSON is never the empty string); audience pickers cap at the first 100 lists/tags; a failed send-now leaves duplicate drafts on retry; the forms live-editor can lose the last 400 ms of typing on tab close and discards a failed patch when another form's patch is queued; form responses beyond the newest 25 are unbrowsable in-app; task comments/subtasks/attachments fail silently; the dashboard's "Email resolution this quarter" is an all-time number.
- **People-side small items:** the change-household dialog has no true Cancel (both buttons act — fix together with T1-10); merging one pair of a 3+ duplicate cluster hides the remaining pair until reload; the Users page shows archived-campaign assignees as "Office" while their pin still scopes them to the archived campaign; an admin email edit signs the target out everywhere with only a "User updated" toast; add-connection and tag/issue chips swallow failures; edit pages carry no activity log.
- **Volunteering small items:** duplicate roster signup surfaces as a generic production 500; the roster-add search covers only the first 1000 'volunteer'-tagged people with no empty-state message; capacity 0 silently becomes Unlimited; the turf-access select can keep displaying a refused value; pledges rows with no linked person show a blank donor name; the pledge-cancel dialog prints a doubled currency symbol and the "Monthly Committed" tile a hardcoded "$"; the record-donation dialog defaults the country to Canada everywhere and offers no gift date (backdated cheques get today's date — check against the receipts v1-limits list); the office context's edit form shows election copy.
- **Website small items:** "new senders warm up under caps" unqualified in two places (it is Free-plan-only; the EULA says it right); the FAQ's "volunteers see only what you hand them" understates the default roam policy that /security and /eula disclose honestly.
- **Re-read LOWs:** import delete removes blobs before its transaction (a failed transaction leaves a download button that 404s); the households importer counts duplicate-address skips without writing reasons; the PDF watermark handler resets fonts mid-text if an unguarded long paragraph ever auto-breaks.

---

## Test-coverage gap map (no test at all, by blast radius)

The full table with minimal-test sketches is the review's working file; the rows that matter:

| Behavior                                                                     | State                                     | What could silently break                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Inbox purge after downgrade (permanent mail deletion)                        | UNTESTED                                  | a sign flip or broken re-check deletes paying customers' mailboxes; CI stays green |
| Import source-file 90-day sweep (published privacy claim)                    | UNTESTED                                  | the sweep silently stops (policy false) or over-deletes                            |
| Stripe stray-subscription webhook guard                                      | UNTESTED                                  | cancelling a duplicate subscription drops a still-paying tenant to Free            |
| Household-merge cascade rescue (knocks, turf rows, districts, sign requests) | UNTESTED                                  | field history silently erased on merge; no drift canary like the persons one       |
| Workflow step-edit remap + enrollment savepoint                              | UNTESTED (changed two commits ago)        | T1-6 above; also containment inside caller transactions                            |
| Beta-approval gate on 2FA and passkey sign-in                                | UNTESTED (passkey controller has no spec) | pending workspaces sign in via the untested paths                                  |
| Statement cancel/reissue refusals                                            | UNTESTED (added last round)               | a statement gets "reissued" into a serialized document                             |
| Worker retry backoff + dead-letter side effects                              | UNTESTED                                  | a dead send job strands a newsletter in "sending" forever                          |
| Smart-list full-scan beyond one batch                                        | UNTESTED                                  | the exact truncation bug the full scan replaced returns silently                   |

Fully covered, no action: newsletter send guards/tripwires/preflight/exclude-lists; tenant-deletion completeness (inventory canary); exports and detached-email retention sweeps.

---

## Questions only the operator can answer

1. **Newsletter sender fields (T1-9):** persist the chosen From name/address through to the send, or remove the fields and display the workspace default? Persisting is ~4 files; removing is smaller and honest.
2. **Campaign-pinned staff and money (Tier 2 #3 and #7):** should pinned Editors/Viewers see only their campaign's donations/pledges, and should manually recorded gifts follow the active campaign context? The settings page currently promises both; the code does neither.
3. **The "quiet goodbye" automation (re-read finding):** the newly wired new-unsubscriber trigger enrolls people whose email steps are then consent-skipped on the full-unsubscribe path — structurally, the goodbye email can never send there. Allow exactly one final relationship-class send for this trigger (a deliberate consent carve-out), or fix the trigger card's copy to promise only tagging/tasks?
4. **Backdated offline gifts:** the record-donation dialog stamps today's date; December cheques entered in January land in the wrong tax year on receipts. Deliberate v1 limit or gap?

## Standing items from REVIEW4, unchanged

- T1-6 (import 1 MiB body limit) — deferred to its own round; the staged upload-then-reference approach is agreed.
- T1-11 (backend boots without STRIPE_WEBHOOK_SECRET) — acceptable in Stripe sandbox; required before real payments.

## Verified-clean areas worth knowing about

- 20 of the 25 REVIEW4-fix commits re-read adversarially and confirmed clean, including the entire receipts cluster, the lists transaction, retention/deletion, triggers, campaign scoping, and boundaries.
- The campaign form's jurisdiction/seat entry matches the shared schema's cross-field rules exactly; all vocabulary flows from the registry — no hidden-field dead ends.
- The list rule-builder's field contract holds on both sides (every offered field exists in the corresponding repo columnMapping, including both electoral fields).
- The newsletter backend send path (conditional claim + same-transaction outbox), the go-live wizard's derived state, the tasks board persistence, and the help center.
- Website: prices, caps, annual math, the 1% donation fee, receipts claims (correctly hedged everywhere after the external-issuance change), send-guard numbers, cookie list, retention windows, subprocessors, residency, security mechanics, jurisdiction vocabulary, every internal link. Legal `updated:` dates owe no bump.
- Import-verification, tenant scoping and transactions across the import modules, the bind-parameter math, the volunteer-access approve/revoke flow, the yard-sign 409 handling, route-reuse/stale-bundle/public-route plumbing, keyboard chords, and the UNAUTHORIZED audit (no non-auth 401 producer reachable from a signed-in page).

## Coverage after five reviews

Now reviewed at least once: every backend module, every frontend experience, the frontend
application plumbing, both companion apps, the shared UI library, the marketing website
(claim-by-claim), the demo seeder, all five REVIEW3-fix commits, all 25 REVIEW4-fix commits,
and a load-bearing-behavior test-gap map.

Still never read: test-file internals (deliberate, all five reviews); the Nx/tooling
configuration beyond what builds exercise. Not verifiable from the repository: the live Stripe
dunning and portal configuration, production env values, Azure/Cloudflare live state.
