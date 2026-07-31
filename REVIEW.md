# Production-risk review — pplCRM backend

Read-only review. No code was changed.

> **Evidence-integrity note, stated first because it affected this review.** Partway through, I found that plain `grep` silently skips `apps/backend/src/trpc.ts` — the file holding the tRPC authentication middleware — because that file contains a literal NUL byte (finding 5). This produced at least one confirmed false negative in my own searching. Every "I could not find X anywhere" claim below is marked down in confidence accordingly, and I re-verified the load-bearing ones by reading files directly instead of grepping.

## Paths I traced, and why

I worked from entrypoints inward rather than reading files in order.

| Path                                                                                                       | Why I picked it                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background job worker + webhook worker (`apps/backend/src/app/lib/jobs/`)                                  | Everything expensive and irreversible in this app runs here: newsletter sends, tenant wipes, imports, Stripe event application. Two long-lived loops with locks, timers, and retries. |
| Stripe money paths (donations webhook → `webhook_events` → webhook worker → donations/billing controllers) | Moves money; at-least-once delivery; cross-tenant resolution from an untrusted payload.                                                                                               |
| Newsletter send (`newsletter.handlers.ts` → `newsletter-mail.service.ts`)                                  | Highest-churn handler; mass outbound email; an explicit at-most-once design that deserved checking against its own claims.                                                            |
| List materialization (`lists/controller.ts` → `map_lists_persons` → newsletter recipient query)            | Decides who gets mailed and who gets excluded. Delete-then-insert shape.                                                                                                              |
| Config, boot, shutdown (`env.ts`, `main.ts`, `shutdown.ts`, `.github/workflows/deploy.yml`)                | Most "works on my machine" failures live here.                                                                                                                                        |
| tRPC auth/tenant/campaign middleware (`trpc.ts`, `base.repo.ts`, `tenant-context.ts`)                      | Authorization and multi-tenant isolation.                                                                                                                                             |
| Public unauthenticated REST surface (canvass, deliveries, companion, webhooks)                             | No session; a token or a signature is the whole control.                                                                                                                              |

Churn ranking came from `git log --name-only -n 300`. The top hand-written files were `auth/controller.ts` (22 commits), `env.ts` (16), `billing/controller.ts` (14), `newsletter.handlers.ts` (13), `deliveries/controller.ts` (12), `canvassing/controller.ts` (12).

---

## Findings

### [HIGH] Refreshing a smart list deletes every member first, outside a transaction, then re-inserts unbounded — a large list is left empty

- **Where:** [lists/controller.ts:355-380](apps/backend/src/app/modules/lists/controller.ts#L355-L380), with the row cap at [persons.repo.ts:433-435](apps/backend/src/app/modules/persons/repositories/persons.repo.ts#L433-L435) and the insert at [base.repo.ts:137-139](apps/backend/src/app/lib/base.repo.ts#L137-L139)
- **Trigger:** Any dynamic ("smart") list whose definition matches more than roughly 13,000 people is refreshed — or the process dies between the delete and the insert (deploy, out-of-memory kill).
- **What breaks:** `executeListRefresh` issues a bare `deleteFrom('map_lists_persons')` with no surrounding transaction, then selects the new membership, then inserts it as one multi-row `INSERT`. The select applies a `LIMIT` **only** when both `startRow` and `endRow` are numbers, so a stored list definition without paging keys returns every matching row. The insert is never chunked; `map_lists_persons` writes 5 columns per row, and PostgreSQL's extended protocol caps a statement at 65535 bind parameters, so past roughly 13,107 rows the `INSERT` fails outright. The `DELETE` has already committed.
- **Symptom on-call sees:** The job dead-letters after 3 attempts, so the ops digest does report `refresh_list: 3 failed`. What nobody sees is the consequence: the list now has zero members and status `failed`. A newsletter using it as an **include** list mails nobody. A newsletter using it as an **exclude** list mails everyone it was supposed to suppress — including people who unsubscribed via that list.
- **Blast radius:** One tenant per occurrence, but on the exclude path it is a consent failure, not just a delivery gap.
- **Evidence:**

  `lists/controller.ts:355-380` — delete, then unbounded select, then unchunked insert, no transaction:

  ```ts
        if (list.object === 'people') {
          // Clear current mappings
          await this.mapListsPersonsRepo.db
            .deleteFrom('map_lists_persons')
            .where('tenant_id', '=', tenant_id)
            .where('list_id', '=', id)
            .execute();

          // Resolve and insert new mappings
          const result = await this.personsController.getAllWithAddress(auth, definition);
          const rows = result.rows.map((p) => ({ ... }));
          if (rows.length) {
            await this.mapListsPersonsRepo.addMany({
              rows: rows as OperationDataType<'map_lists_persons', 'insert'>[],
            });
          }
  ```

  `persons.repo.ts:433-435` — the limit is conditional, so no paging keys means no limit at all:

  ```ts
        .$if(typeof options.startRow === 'number' && typeof options.endRow === 'number', (qb) =>
          qb.offset(options.startRow ?? 0).limit((options.endRow ?? 100) - (options.startRow ?? 0)),
        )
  ```

  `base.repo.ts:137-139` — one statement, no chunking, and `returningAll()` pulls every inserted row back into memory:

  ```ts
    public async addMany(input: { rows: OperationDataType<T, 'insert'>[] }, trx?: Transaction<Models>) {
      return this.getInsert(trx).values(input.rows).returningAll().execute();
    }
  ```

  Consumption path: [newsletters/controller.ts:379-383](apps/backend/src/app/modules/newsletters/controller.ts#L379-L383) (include) and [:412-416](apps/backend/src/app/modules/newsletters/controller.ts#L412-L416) (exclude) both read `map_lists_persons` directly, so an emptied or truncated table changes who receives mail.

  Note the contrast: `base.repo.ts:437-441` documents a `MAX_PAGE_SIZE` backstop precisely because "a request that derives no limit at all used to select every row in the tenant into memory" — but `getAllWithAddress` is a hand-written query that never reaches that code.

- **Confidence:** High on the mechanism (all three files read directly). Medium on whether a stored list definition ever carries `startRow`/`endRow` — I did not read the frontend rule-builder that writes `lists.definition`. If it always writes paging keys, the unbounded-select half goes away, but the non-atomic delete and the unchunked insert remain.
- **Fix sketch:** Wrap the delete and insert in one `db.transaction()`, and chunk the insert at 500–1000 rows per statement. Separately, make the row cap unconditional in `getAllWithAddress` so an absent paging window can never mean "everything".

---

### [HIGH] One transient SendGrid error silently drops 500 recipients, and the newsletter still finishes as "sent"

- **Where:** [newsletter.handlers.ts:390-437](apps/backend/src/app/lib/jobs/handlers/newsletter.handlers.ts#L390-L437); the throw is at [newsletter-mail.service.ts:174-181](apps/backend/src/app/lib/mail/newsletter-mail.service.ts#L174-L181)
- **Trigger:** SendGrid returns any non-2xx for one batch — a 429 rate limit, a 500, a connection reset. Routine at volume.
- **What breaks:** The handler deliberately persists the advanced keyset cursor into the job payload **before** calling SendGrid, an at-most-once design. That policy was chosen for _crashes_. A SendGrid HTTP error is not a crash: it throws, the job fails, the worker reschedules the _same job row_ without touching the payload, and the retry resumes at `email > nextCursor` — permanently past the 500 recipients that were never sent. `logNewsletterBatch` also never runs, so those 500 are not even metered against the tenant's allowance. The retry then completes normally and the newsletter is marked `sent`.
- **Symptom on-call sees:** Nothing. The job succeeds on retry. `delivered_count` is quietly 500 low. Weeks later a campaign manager asks why a particular supporter never got the email.
- **Blast radius:** Up to `NEWSLETTER_BATCH_SIZE` (500) recipients per transient error, per send, per tenant. Silent.
- **Evidence:**

  `newsletter.handlers.ts:390-412` — the cursor is committed to the job payload first:

  ```ts
      const nextCursor = recipients[recipients.length - 1]!.email;
      const nextOffset = offset + chunkRows.length;
      if (jobId) {
        await db
          .updateTable('background_jobs')
          .set({
            payload: sendNewsletterPayload({ tenantId, newsletterId, userId, offset: nextOffset, cursor: nextCursor, deliveredCount }),
  ```

  then `:414` calls `newsletterMailSvc.sendNewsletter(...)`, and `newsletter-mail.service.ts:174-181`:

  ```ts
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`SendGrid API responded with status ${response.status}: ${errorText}`);
          }
          deliveredCount += chunk.length;
        } catch (error) {
          throw new InternalError('Failed to send newsletter via SendGrid', undefined, { cause: error });
        }
  ```

  The worker's retry path ([worker.ts:277-288](apps/backend/src/app/lib/jobs/worker.ts#L277-L288)) sets `status: 'pending'` and a new `run_at` but never rewrites `payload`, so the advanced cursor survives the retry.

- **Confidence:** High. All three legs read directly. I checked and ruled out a related worry: `NEWSLETTER_BATCH_SIZE` is 500 and `CHUNK_SIZE` in the mail service is 1000, so one batch is always exactly one HTTP request — there is no partial-batch case stacked on top of this.
- **Fix sketch:** Retry the SendGrid call itself with backoff and jitter before letting the batch fail, and treat an HTTP error differently from a process crash — on a 4xx/5xx, do not let the pre-advanced cursor stand: roll the payload back to the pre-batch cursor and accept the duplicate risk, or record the skipped address range so it can be re-sent deliberately.

---

### [HIGH] Three webhook secrets fail closed and silently, and the production boot guard checks none of them

- **Where:** [donations-webhook.route.ts:24-34](apps/backend/src/app/modules/donations/routes/donations-webhook.route.ts#L24-L34); [newsletters-webhook.route.ts:74-78](apps/backend/src/app/modules/newsletters/routes/newsletters-webhook.route.ts#L74-L78) and [:185-187](apps/backend/src/app/modules/newsletters/routes/newsletters-webhook.route.ts#L185-L187); [postmark-webhook.route.ts:23-29](apps/backend/src/app/modules/mail/routes/postmark-webhook.route.ts#L23-L29) and [:40-42](apps/backend/src/app/modules/mail/routes/postmark-webhook.route.ts#L40-L42); contrasted with [env.ts:214-244](apps/backend/src/env.ts#L214-L244)
- **Trigger:** `STRIPE_CONNECT_WEBHOOK_SECRET`, `SENDGRID_WEBHOOK_VERIFICATION_KEY`, or `POSTMARK_WEBHOOK_TOKEN` is unset, mistyped, or its secret reference fails to resolve in production.
- **What breaks:** Each endpoint rejects every delivery, and nothing logs a configuration problem — the SendGrid and Postmark paths return 401 with no log line at all. Consequences by secret: a missing Stripe Connect secret means every donation event 400s, Stripe retries for about a day and gives up, and **donors are charged while no donation row is ever written**. A missing SendGrid verification key means no bounce or spam-complaint event is ever recorded, so `email_suppressions` never fills, the bounce and complaint tripwires never fire, and tenants keep mailing dead addresses while the platform's sending reputation degrades.
- **Symptom on-call sees:** Nothing, for days. Then a support ticket ("I donated and it isn't showing"), or a deliverability collapse with no alert attached to it.
- **Blast radius:** Platform-wide — every tenant's donations, or every tenant's suppression list.
- **Evidence:**

  `env.ts:214-244` already implements exactly the right guard, for a different set of secrets, and says why:

  ```
   * This exists because the failure mode of an unresolved secret is *silent degradation*,
   * not an error, and that has already bitten twice:
  ```

  It checks `SHARED_SECRET`, `OAUTH_TOKEN_ENC_KEY`, `STRIPE_SECRET_KEY`, `ALLOW_MOCK_PAYMENTS`, and `ALLOW_MOCK_DOMAIN_VERIFICATION`. It does not mention the three webhook secrets.

  `donations-webhook.route.ts:30-32`:

  ```ts
  if (!env.stripeConnectWebhookSecret) {
    throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET is not configured.');
  }
  ```

  `newsletters-webhook.route.ts:74-78`:

  ```ts
  function verifySendGridSignature(rawBody: string, signature?: string, timestamp?: string): boolean {
    const verificationKey = env.sendgridWebhookVerificationKey;
    if (!verificationKey || !signature || !timestamp) {
      return false;
    }
  ```

  `postmark-webhook.route.ts:23-25`:

  ```ts
  function tokenMatches(header: string | undefined): boolean {
    const expected = env.postmarkWebhookToken;
    if (!expected || !header) return false;
  ```

- **Confidence:** High. Failing closed is the right choice; failing closed _without anyone noticing_ is the finding.
- **Fix sketch:** Add the three to `assertProductionSecrets` so a deploy without them refuses to boot. As a second layer, log at error level the first time a webhook is rejected because the secret is absent, as distinct from a genuine signature mismatch.

---

### [MEDIUM-HIGH] The webhook worker's poll loop permanently multiplies itself

- **Where:** [webhook-worker.ts:137-177](apps/backend/src/app/lib/jobs/webhook-worker.ts#L137-L177)
- **Trigger:** A Postgres `NOTIFY` on `webhook_events_channel` arrives while a poll cycle is already in flight — any moderately busy period.
- **What breaks:** `pollWithDelay` assigns `this.timer` without clearing the previous handle, and `wakeUp` starts a fresh cycle even though one is already running. Once two cycles are concurrent, each one's `finally` schedules its own follow-up timer, both fire, and the loop count is preserved rather than merged back to one. Each additional overlapping NOTIFY adds another permanent loop. The count only ever goes up, until the process restarts.
- **Symptom on-call sees:** Slowly rising Postgres connection churn and `SELECT ... FOR UPDATE SKIP LOCKED` transaction rate from `pplcrm-api`, unexplained by traffic. A restart "fixes" it, which makes it look like a leak somewhere else.
- **Blast radius:** One process, growing with uptime. Worse if replicas are ever added.
- **Evidence:**

  ```ts
    private wakeUp() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.poll();
    }

    private poll() {
      if (!this.isRunning) return;
      this.timer = setTimeout(() => { void this.runPollCycle(); }, 0);
    }
    ...
    private pollWithDelay(ms: number) {
      if (!this.isRunning) return;
      this.timer = setTimeout(() => this.poll(), ms);   // previous handle never cleared
    }
  ```

  The sibling `BackgroundJobWorker` gets this right, which is good evidence it is a mistake rather than a design choice — [worker.ts:154-165](apps/backend/src/app/lib/jobs/worker.ts#L154-L165):

  ```ts
    private scheduleDrain(ms: number) {
      if (!this.isRunning) return;
      const fireAt = Date.now() + ms;
      if (this.timer && this.nextDrainAt <= fireAt) return; // a sooner (or equal) drain is already queued
      if (this.timer) clearTimeout(this.timer);
  ```

- **Confidence:** High on the timer-overwrite mechanism. Medium on the growth rate in production, which depends on how often a NOTIFY lands mid-cycle — I did not measure that.
- **Fix sketch:** Port `BackgroundJobWorker.scheduleDrain`'s coalescing logic (clear the old timer, keep the soonest fire time) into the webhook worker, and guard `runPollCycle` so at most one cycle is in flight.

---

### [MEDIUM-HIGH] The file containing the auth middleware is invisible to grep — it has a literal NUL byte in it

- **Where:** [trpc.ts:132](apps/backend/src/trpc.ts#L132)
- **Trigger:** Any repo-wide `grep`, `git grep`, `ripgrep`, codemod, or secret scan.
- **What breaks:** The campaign-scope sentinel is written with an embedded `U+0000` — the character shown as a space below is a raw NUL byte in the source, not an escape sequence:
  ```ts
  const UNCOMPARABLE_CAMPAIGN_ID = ' uncomparable';
  ```
  A NUL byte makes every standard text tool classify the file as binary and skip it **silently**: no match, exit status 1, no warning. `file` reports `apps/backend/src/trpc.ts: data`. TypeScript compiles it without complaint. The file being skipped is the one holding `isAuthed` — session revocation, the viewer write-block, the campaign pin, and the RLS tenant binding.
- **Symptom on-call sees:** Nothing, ever — until an audit, migration, or security sweep reports "no occurrences" for something that is in fact in the auth middleware. That is exactly what happened during this review: `grep -rn "runWithTenant" apps/backend/src` reported the function was never called. It is called twice, at `trpc.ts:187` and `trpc.ts:284`.
- **Blast radius:** Every grep-driven process in the repo, including CI checks and any future automated audit.
- **Evidence:**
  ```
  $ grep -c  "import" apps/backend/src/trpc.ts   ->  (no output, exit 1)
  $ grep -ac "import" apps/backend/src/trpc.ts   ->  11
  $ file apps/backend/src/trpc.ts                ->  apps/backend/src/trpc.ts: data
  $ node -e "...charCodeAt before 'uncomparable'..."
        char before uncomparable = U+0000
        control chars in file: 1
  ```
  `apps/backend/src/app/lib/storage-key.spec.ts` has the same property (a control character in a test fixture at line 30).
- **Confidence:** High — reproduced directly, and it caused a confirmed false negative in this review.
- **Fix sketch:** Write the sentinel as an escape (`' uncomparable'`) or pick a value that cannot collide with a bigint id without needing a control character at all. Separately, PostgreSQL rejects NUL in text values (`invalid byte sequence for encoding "UTF8": 0x00`), so this constant would throw if it ever reached a query parameter. Today it is only compared, but that is a live trap.

---

### [MEDIUM] Outbound calls to SendGrid, Postmark, Twilio, Google Maps, and Gmail have no timeout

- **Where:** [newsletter-mail.service.ts:169](apps/backend/src/app/lib/mail/newsletter-mail.service.ts#L169); [transactional-mail.service.ts:240](apps/backend/src/app/lib/mail/transactional-mail.service.ts#L240); [sms.service.ts:41](apps/backend/src/app/lib/sms/sms.service.ts#L41); [geocode-address.ts:44](apps/backend/src/app/lib/gis/geocode-address.ts#L44); [companies-enrichment.service.ts:48](apps/backend/src/app/modules/companies/services/companies-enrichment.service.ts#L48) and [:61](apps/backend/src/app/modules/companies/services/companies-enrichment.service.ts#L61); [google-oauth.service.ts:44](apps/backend/src/app/modules/google-sync/google-oauth.service.ts#L44), [:70](apps/backend/src/app/modules/google-sync/google-oauth.service.ts#L70), [:171](apps/backend/src/app/modules/google-sync/google-oauth.service.ts#L171); [attachment-materializer.ts:48](apps/backend/src/app/modules/emails/services/attachment-materializer.ts#L48) and [:74](apps/backend/src/app/modules/emails/services/attachment-materializer.ts#L74)
- **Trigger:** A provider hangs rather than erroring — a stalled TLS handshake, a black-holed connection, a provider incident.
- **What breaks:** Node's `fetch` has no total-request deadline; a hung call waits on undici's default header and body timeouts. Inside the newsletter batch loop, a stalled SendGrid call holds a worker slot and the send stops advancing. In `handleOpsWatchdog` the Postmark call is made directly and inline, so a Postmark hang can push the watchdog past its 15-minute job timeout — which then stops the heartbeat and pages you (see the next finding).
- **Symptom on-call sees:** Jobs "stuck", a rising queue backlog, and a worker that looks alive because it is still heartbeating.
- **Blast radius:** Worker throughput, platform-wide.
- **Evidence:** The pattern is a bare `fetch` with headers and body and no `signal`, e.g. `transactional-mail.service.ts:240`:
  ```ts
        const response = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { ... },
  ```
  The codebase already knows the idiom: `hibp.ts:11` uses `signal: AbortSignal.timeout(3000)`, `zapier.service.ts:117` uses `AbortSignal.timeout(15000)`, `preflight.service.ts:185` uses `AbortSignal.timeout(SPAMCHECK_TIMEOUT_MS)`. It is applied to the optional dependencies and omitted on the ones that carry mail and money.
- **Confidence:** High that the timeouts are absent (each line read). Medium on the exact hang duration, which depends on the undici defaults in the deployed Node version — I did not verify that against the container image.
- **Fix sketch:** Add `signal: AbortSignal.timeout(...)` to each, sized per call (10–15 s for a single API POST, longer for attachment downloads). A small shared `fetchWithTimeout` helper would make the next call site inherit it.

---

### [MEDIUM] The whole import file is parsed into memory before any row is processed

- **Where:** [import.handlers.ts:111-112](apps/backend/src/app/lib/jobs/handlers/import.handlers.ts#L111-L112)
- **Trigger:** A large CSV import. The codebase itself talks about "a 200k-household import" ([geocode-queue.ts:44](apps/backend/src/app/lib/gis/geocode-queue.ts#L44)) and defaults `GEOCODE_DAILY_BUDGET` to 25,000 per day, so files of that size are expected.
- **What breaks:**
  ```ts
  const buffer = await storageService.download(payload.storage_key);
  const rows = JSON.parse(buffer.toString('utf8'));
  ```
  The mapped payload is downloaded whole, converted to a UTF-8 string, and `JSON.parse`d into an array of objects — three full copies at peak, then a long-lived array of hundreds of thousands of objects. Downstream processing is correctly chunked at 100 ([persons.service.ts:787-789](apps/backend/src/app/modules/persons/services/persons.service.ts#L787-L789)), but that chunking happens after everything is already resident.
- **Symptom on-call sees:** The container is killed for exceeding memory. The job never reaches its `catch`, so `data_imports` is never marked failed — it sits in `processing`. Thirty minutes later `recoverStaleJobs` requeues it, it dies again, and after three attempts it dead-letters. The user sees an import stuck at "processing" for roughly an hour and a half.
- **Blast radius:** Kills the process, so every other in-flight job on that instance dies with it.
- **Confidence:** High on the code. Medium on which file size actually triggers it — I did not read the container memory limit (it is set on the hand-created Container App, not in `infra/azure/main.bicep` as far as I read).
- **Fix sketch:** Stream the payload and process it in chunks without materializing the whole array; the repo already has `lib/csv-stream.ts` and uses `pg-cursor`. Failing that, cap the accepted row count at upload time and reject with a clear message.

---

### [MEDIUM] Deploys force-exit after 25 seconds while jobs are allowed to run for up to 60 minutes

- **Where:** [shutdown.ts:11](apps/backend/src/shutdown.ts#L11) and [:25-28](apps/backend/src/shutdown.ts#L25-L28); job caps at [cron-registry.ts:46-47](apps/backend/src/app/lib/jobs/cron-registry.ts#L46-L47); recovery window at [worker.ts:24](apps/backend/src/app/lib/jobs/worker.ts#L24)
- **Trigger:** Every deploy, and any SIGTERM, that lands while a job has been running longer than 25 seconds.
- **What breaks:** `onShutdown` waits for in-flight jobs but arms a hard `process.exit(1)` at 25 s:
  ```ts
  const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;
  ...
          const timer = setTimeout(() => {
            logger.error(`Shutdown drain exceeded ${timeout}ms; forcing exit.`);
            process.exit(1);
          }, timeout);
  ```
  Meanwhile `DEFAULT_JOB_TIMEOUT_MS` is 15 minutes and `LONG_JOB_TIMEOUT_MS` is 60 minutes (newsletter sends, exports, mailbox syncs, tenant wipes). Any such job is killed mid-flight, stays at `status = 'processing'`, and is invisible until `recoverStaleJobs` reclaims it after `STALE_JOB_THRESHOLD_MS` of 30 minutes.
- **Symptom on-call sees:** After a deploy, a newsletter or export "pauses" for half an hour with no error anywhere, then resumes. Deploy three times against the same job and it dead-letters instead.
- **Blast radius:** Whichever tenants had long jobs running at deploy time.
- **Confidence:** High on the constants and the code path. Medium on whether the orchestrator's own grace period even allows the full 25 s — the comment reasons about a Kubernetes 30 s default, but this deploys to Azure Container Apps, whose grace period I did not verify.
- **Fix sketch:** Shorten the stale-recovery window so an abandoned job is reclaimed in minutes rather than 30. Longer term, checkpoint long jobs so a mid-flight kill resumes instead of restarting.

---

### [MEDIUM] Stale-job recovery can dead-letter a recurring job without re-seeding its chain

- **Where:** [worker.ts:422-434](apps/backend/src/app/lib/jobs/worker.ts#L422-L434), versus the protection at [:486-500](apps/backend/src/app/lib/jobs/worker.ts#L486-L500)
- **Trigger:** A recurring job is claimed and then the worker process dies before finishing — three times, so `attempts >= max_attempts`. The previous finding makes that plausible: every deploy that kills an in-flight job counts as one attempt.
- **What breaks:** `processNextJob`'s failure path calls `rescheduleCronJobOnFailure` precisely so a dead-lettered recurring job still gets its next run queued. `recoverStaleJobs` has its own dead-letter branch and does not:
  ```ts
  await this.db
    .updateTable('background_jobs')
    .set({
      status: 'failed',
      locked_at: null,
      locked_by: null,
      updated_at: new Date(),
      error: 'Job processing timed out after maximum attempts',
    })
    .where('status', '=', 'processing')
    .where('locked_at', '<', staleTime)
    .where(sql<boolean>`attempts >= coalesce(max_attempts, 3)`)
    .execute();
  ```
  No `scheduleNextRun` follows. The chain stops until the next process restart re-seeds it via `worker.start()`.
- **Symptom on-call sees:** Depends which job dies. If it is `ops_watchdog`, `/healthz/worker` goes stale and the availability alert fires — loud, and the code comments predict exactly this. If it is `prune_retention` or `perform_scheduled_deletions`, nothing fires and a data-retention obligation quietly stops being met.
- **Blast radius:** Platform-wide for that one job type.
- **Evidence:** The in-process path's own comment states the stakes, at `worker.ts:486-491`:
  ```
   * A dead-lettered cron job must still get its next run queued, or the chain stops until the next
   * deploy — silent breakage, since nothing else re-seeds it while the process lives.
  ```
- **Confidence:** High that the recovery path omits the reschedule (both branches read). Medium that it fires in practice — it needs three process deaths while the same recurring job is claimed.
- **Fix sketch:** After the dead-letter update in `recoverStaleJobs`, select the affected rows' `payload->>'type'` and call `rescheduleCronJobOnFailure` for each, reusing the existing helper.

---

### [MEDIUM] A Postmark outage makes the worker report itself dead

- **Where:** [ops.handlers.ts:157-181](apps/backend/src/app/lib/jobs/handlers/ops.handlers.ts#L157-L181), read by [routes.ts:132-144](apps/backend/src/app/routes.ts#L132-L144)
- **Trigger:** The watchdog finds something to report **and** the Postmark send fails or hangs.
- **What breaks:** The heartbeat upsert sits after the alert email in the same function:
  ```ts
        await mailService.sendMail({ to: env.opsAlertEmail, ... });   // :157
        ...
    await db.insertInto('ops_heartbeats')                            // :175
      .values({ name: HEARTBEAT_NAME, beat_at: now, details: newDetails })
  ```
  If `sendMail` throws, the heartbeat is never written. `/healthz/worker` returns 503 once the beat is older than 20 minutes. So a mail-provider incident, occurring during a period when something is already going wrong, produces a page saying the job worker is wedged — when it is fine.
- **Symptom on-call sees:** A worker-down alert at 3am pointing at the wrong subsystem, during an incident that already has your attention elsewhere.
- **Blast radius:** Alerting fidelity, not data.
- **Confidence:** High on the ordering. Medium on frequency — it needs the watchdog to have findings and Postmark to fail in the same window.
- **Fix sketch:** Write the heartbeat before attempting the alert email, and let a failed alert fail the job (so the ops digest reports it) without also suppressing the liveness beat.

---

### [MEDIUM] Stripe events are applied in arrival order, not in `created` order

- **Where:** [webhook-worker.ts:188-199](apps/backend/src/app/lib/jobs/webhook-worker.ts#L188-L199) (claim ordered by `id`) and [:440-467](apps/backend/src/app/lib/jobs/webhook-worker.ts#L440-L467); [billing/controller.ts:551-593](apps/backend/src/app/modules/billing/controller.ts#L551-L593)
- **Trigger:** Stripe delivers an older event after a newer one — for example a `customer.subscription.updated` retried after a later one already succeeded.
- **What breaks:** Events are claimed `ORDER BY id ASC` (insertion order at our end) and applied unconditionally. Neither the donation-pledge branch nor the billing branch compares the event's `created` timestamp against what is already stored, so a stale event overwrites current state:
  ```ts
              await this.db
                .updateTable('donation_pledges')
                .set({ status: mappedStatus, next_billing_date: nextBillingDate, ... })
                .where('stripe_subscription_id', '=', subscriptionId)
                .execute();
  ```
  On the billing side, `tenantsRepo.update` writes `subscription_plan`, `subscription_status`, and `subscription_ends_at` with no ordering guard.
- **Symptom on-call sees:** A tenant reports being on the wrong plan, or a monthly donor shows `past_due` after they already paid. It reconciles itself only if another event arrives.
- **Blast radius:** One tenant or one donor per occurrence, with wrong data in financial records.
- **Confidence:** Medium-High. The absence of an ordering guard is confirmed by reading. I did not verify Stripe's current delivery-ordering guarantees for Connect endpoints, which determines how often this bites.
- **Fix sketch:** Store the event's `created` on `webhook_events` and, in each state-mutating branch, skip the write when the target row was last updated by a newer event — a `last_stripe_event_at` column compared in the `WHERE`.

---

### [MEDIUM] SMS throttles use the process-local limiter that this codebase's own documentation forbids for SMS

- **Where:** [settings/controller.ts:268-269](apps/backend/src/app/modules/settings/controller.ts#L268-L269); [companion-access/controller.ts:236](apps/backend/src/app/modules/companion-access/controller.ts#L236); contrasted with [durable-rate-limiter.ts:10-14](apps/backend/src/app/lib/durable-rate-limiter.ts#L10-L14) and [rate-limiter.ts:3-7](apps/backend/src/app/lib/rate-limiter.ts#L3-L7)
- **Trigger:** Any process restart (every deploy), or ever running more than one replica.
- **What breaks:** `requestPhoneVerification` sends a Twilio SMS and is throttled by `checkRateLimit`, whose counters live in a per-process `Map`:

  ```ts
  checkRateLimit(`phoneVerifyRequest:${auth.tenant_id}`, 3, 60 * 60 * 1000);
  checkRateLimit(`phoneVerifyRequest:${normalized}`, 3, 60 * 60 * 1000);
  ```

  `durable-rate-limiter.ts:10-14` states the rule this violates:

  > Use this — not the in-memory `rate-limiter.ts` — whenever exceeding the limit costs real money or reputation: paid API calls, SMS, and outbound mail.

  Today `consumeRateLimit` (the durable one) is used for failed sign-in attempts and transactional mail, but not for SMS.

- **Symptom on-call sees:** A Twilio bill higher than expected, or a complaint that someone's phone was flooded with verification codes. Nothing alerts.
- **Blast radius:** Money (Twilio) and a third party's phone.
- **Evidence:** `rate-limiter.ts:3-7` is explicit that this is known:
  ```
  // SECURITY-REVIEW 4.1 — single-instance assumption: this limiter keeps counters in a per-process
  // in-memory Map. It resets on deploy/restart and does NOT coordinate across instances, so running
  // more than one backend replica effectively multiplies every limit by the replica count.
  ```
  And `deploy/GO-LIVE-CHECKLIST.md:197-198` treats scaling out as a supported, one-flag operation. Nothing in code or infrastructure prevents it.
- **Confidence:** High for the phone-verification call sites (read directly). Medium for the claim that no other durable limiter also guards these paths — my `grep` for `consumeRateLimit` is subject to the NUL-byte caveat in finding 5, though the affected files are not on this path.
- **Fix sketch:** Switch the SMS call sites to `consumeRateLimit`. Separately, log a warning at startup (or refuse to start) if the process is one of several replicas while the in-memory limiter is still in use.

---

### [MEDIUM-LOW] Public unauthenticated routes return raw internal error messages

- **Where:** [canvass-public.route.ts:30-44](apps/backend/src/app/modules/canvassing/routes/canvass-public.route.ts#L30-L44) and every handler in that file ([:60-63](apps/backend/src/app/modules/canvassing/routes/canvass-public.route.ts#L60-L63), [:74-78](apps/backend/src/app/modules/canvassing/routes/canvass-public.route.ts#L74-L78), [:91-95](apps/backend/src/app/modules/canvassing/routes/canvass-public.route.ts#L91-L95), and so on); same shape at [canvassing/controller.ts:1271-1277](apps/backend/src/app/modules/canvassing/controller.ts#L1271-L1277)
- **Trigger:** Any unexpected error — a Kysely/Postgres error, a `TypeError` — on a public companion endpoint.
- **What breaks:**
  ```ts
  function messageOf(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }
  ```
  `statusOf` returns 500 for anything unrecognized, and `messageOf` then returns the raw `Error.message` in the response body. A Postgres error leaks constraint, table, and column names to an unauthenticated caller. This is the exact leak the tRPC layer takes trouble to prevent — [trpc.ts:30-32](apps/backend/src/trpc.ts#L30-L32) redacts any `INTERNAL_SERVER_ERROR` message in production.
- **Symptom on-call sees:** Nothing. It surfaces in someone else's reconnaissance notes.
- **Blast radius:** Information disclosure on the public surface; no data loss.
- **Confidence:** High on the code path. Medium on how much actually reaches the wire, since it depends on which errors the controller lets escape unwrapped — I read `postCompanionResults` and `applyCompanionOps` but not every controller method these routes call.
- **Fix sketch:** Return the fallback string for any error that is not a known `AppError` subclass carrying a client-safe message, mirroring `to-trpc-errors.ts`, and log the real one server-side.

---

### [MEDIUM-LOW] The deploy smoke test can pass against the revision it was supposed to replace

- **Where:** `.github/workflows/deploy.yml`, the "Smoke test backend /healthz" step
- **Trigger:** The new container image fails to start — a bad environment variable, a failed `assertProductionSecrets`, a crash on boot.
- **What breaks:** The smoke test curls `https://api.pplcrm.com/healthz`, the public ingress, not the new revision. In Azure Container Apps single-revision mode, a new revision that never becomes healthy leaves the old one serving traffic. The old revision answers 200 and the step passes.
  ```bash
              code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://api.pplcrm.com/healthz || true)
              if [ "$code" = "200" ]; then
                echo "healthz OK after $i attempt(s)"
                exit 0
              fi
  ```
  `/healthz` also caches its result for 5 seconds ([routes.ts:31-41](apps/backend/src/app/routes.ts#L31-L41)), so early polls can return a pre-deploy answer.
- **Symptom on-call sees:** A green deploy, with production still running the previous build. Discovered when a shipped fix "isn't there".
- **Blast radius:** Deploy confidence.
- **Confidence:** Medium. The step's behaviour is read directly; whether the old revision keeps serving depends on the Container App's revision mode, which is configured by hand (`deploy/PROD-CHECKLIST.md:103` specifies single revision, min 1 / max 1) and which I did not read from live infrastructure.
- **Fix sketch:** Have the step read the active revision name back from `az containerapp show` and assert it matches the SHA just deployed, then smoke-test. Optionally expose the build SHA on `/healthz` and compare it.

---

### [LOW-MEDIUM] The multi-tenant lint rule does not cover the code that writes donations, sends newsletters, or wipes tenants

- **Where:** [apps/backend/eslint.config.cjs:45-51](apps/backend/eslint.config.cjs#L45-L51) (rule scope) versus [webhook-worker.ts:457-481](apps/backend/src/app/lib/jobs/webhook-worker.ts#L457-L481)
- **Trigger:** Any new query written under `apps/backend/src/app/lib/`.
- **What breaks:** The rule is registered for `files: ['**/src/app/modules/**/*.ts']` only. Everything in `lib/` — both workers, every job handler, the mail services — is outside it. And because the workers never bind an async tenant context (`isAuthed` at [trpc.ts:187](apps/backend/src/trpc.ts#L187) is the only place `runWithTenant` is called on a request path), the Postgres row-level-security backstop is also inert there by design ([tenant-context.ts:14-18](apps/backend/src/app/lib/tenant-context.ts#L14-L18) says so explicitly). Both tenant-safety layers are off in the same directory. The webhook worker already has unscoped writes there:
  ```ts
                await this.db
                  .updateTable('donation_pledges')
                  .set({ status: mappedStatus, next_billing_date: nextBillingDate, ... })
                  .where('stripe_subscription_id', '=', subscriptionId)
                  .execute();
  ```
  Stripe subscription ids are globally unique, so this specific query is safe today. The point is that nothing would have stopped it if it were keyed on something tenant-local.
- **Symptom on-call sees:** Nothing, until a cross-tenant leak.
- **Blast radius:** Potentially cross-tenant, if a future query in `lib/` is keyed on a non-unique value.
- **Confidence:** High on the rule scope and on the absence of `runWithTenant` in the two worker files (both read end to end). Medium on "no handler binds tenant context anywhere" — I read `worker.ts`, `webhook-worker.ts`, `ops.handlers.ts`, `deletions.handlers.ts`, `newsletter.handlers.ts`, `import.handlers.ts`, and `workflows.handlers.ts`, but not `notifications.handlers.ts`, `maintenance.handlers.ts`, `export.handlers.ts`, `sync.handlers.ts`, `demo.handlers.ts`, or `billing.handlers.ts`.
- **Fix sketch:** Extend the rule's `files` glob to `**/src/app/lib/**/*.ts` and work through what it flags, adding the deliberate cross-tenant queries to the documented exception list rather than leaving the directory unscanned.

---

## Categories that turned up nothing worth reporting

- **Float for money:** nothing found. Amounts are integer cents throughout; `stripe-processor.ts:96` uses `Math.max(0, Math.round((amountCents * feePercent) / 100))`.
- **Idempotency of the offline canvassing sync:** nothing found. `canvassing/controller.ts:1249-1257` claims an operation id in `companion_ops` inside the same transaction as the effect, with `onConflict(...).doNothing()`. Correct.
- **Recurring-job chain forking across replicas:** nothing found. `reschedule.ts:35-58` and `:74-99` take a transaction-scoped `pg_advisory_xact_lock(hashtext(type))` before the check-then-insert, and the comments show the failure mode was reasoned through.
- **Job claim races:** nothing found. `job-claim.ts:49` uses `FOR UPDATE SKIP LOCKED` inside a transaction with the status flip.
- **Tenant-wipe foreign-key ordering:** nothing found. `deletions.handlers.ts:27-110` is a maintained topological ordering with a spec asserting it stays in sync with live `tenant_id` tables.
- **Webhook signature verification:** nothing found. All three verify correctly and fail closed. The problem is the silence, not the check — see finding 3.

---

## Uncertainty register

Ordered by how much it would matter if I am right.

1. **Does a stored smart-list definition carry `startRow`/`endRow`?** If it does, finding 1's unbounded-select half disappears, though the non-atomic delete and the unchunked insert remain. If it does not, every large tenant's smart list is one refresh away from being emptied. _Question for the maintainer:_ what exactly does the list rule-builder persist into `lists.definition`, and does it ever include paging keys?

2. **Can `pinnedCampaignId` legitimately resolve to `null` for a non-privileged user?** `trpc.ts:253-274` falls back to the tenant's `kind = 'office'` campaign when `authusers.campaign_id` is null, and sets the pin to `null` if no office campaign exists. The comment at `tenant-context.ts:54-60` says an unpinned caller reads across campaigns — the exact widening the pin was added to prevent. _Question:_ is every tenant guaranteed to have an `office` campaign row, and is that enforced at signup or only by convention?

3. **What is the container memory limit?** It decides whether finding 7 is a 200,000-row problem or a 20,000-row problem. I did not find a memory setting in `infra/azure/main.bicep`; the Container App is created by hand per `deploy/PROD-CHECKLIST.md:103`.

4. **Is `metadata.amount` always present on a donation Checkout Session?** `webhook-worker.ts:356` does `Number(stripeObj.metadata.amount)` with no guard; a missing value yields `NaN`, which an integer column will reject. The donation would then retry three times and dead-letter with the donor already charged. Our own `stripe-processor.ts` always sets it, so this only bites if a session is ever created outside that path. _Question:_ is any Checkout Session for donations ever created outside `stripe-processor.ts`?

5. **Are there other source files containing NUL bytes?** I scanned `apps/backend/src` and `libs/common/src` and found two (`trpc.ts`, `storage-key.spec.ts`). I did not scan `apps/frontend`, `apps/companion`, `apps/website`, or `libs/uxcommon`. Any file there with the same property is invisible to every grep-based check in CI.

6. **Does Azure Container Apps grant the full 25-second termination grace period?** `shutdown.ts:8-9` reasons about a Kubernetes 30-second default, but this deploys to Container Apps. If the real grace period is shorter, finding 8 is worse than described.

---

## Coverage gaps

What I did not read, honestly.

**Not read at all:**

- `apps/frontend/` — everything except `src/app/services/api/trpc-refreshlink.ts`. That is the whole CRM user interface.
- `apps/companion/` — the entire mobile volunteer app.
- `apps/website/` — the entire marketing site.
- `libs/uxcommon/` — the shared component library.
- `libs/common/` — only fragments of `schemas/core.schema.ts`. Did not read `billing/plans.ts`, the help content, or `kysely.models.ts`.
- `apps/backend/src/app/_migrations/` — including `schema.sql` and `0001_baseline.ts`. I therefore verified no claim about column types, NOT NULL constraints, indexes, or RLS policies. Several findings above would be sharpened by knowing them — for example whether `donations.amount` is `integer` or `bigint`.
- `infra/azure/*.bicep`, `infra/pplforms-edge/`, `infra/go-edge/` — the Cloudflare Workers that sit in front of the API.
- `apps/backend/Dockerfile`.

**Backend modules not read:** `emails` (except the two route fragments quoted), `google-sync`, `ms-sync`, `exports`, `files`, `storage.service.ts`, `duplicates`, `tasks`, `teams`, `events`, `volunteer-events`, `web-forms`, `zapier`, `person-connections`, `dashboard`, `activity`, `notifications`, `userprofiles`, `demo`, `bug-reports`, `companies`.

**Backend modules read only partially:** `auth` (its tRPC router rate-limit lines and the `trpc.ts` middleware, but essentially none of the 6,216-line module body), `billing/controller.ts` (the webhook handler and two case branches out of ~959 lines), `donations/controller.ts` (recording and pledge helpers only), `companion-access/controller.ts` (rate-limit call sites only), `canvassing/controller.ts` (the companion sync path only), `lists/controller.ts` (add and refresh only), `persons/services/persons.service.ts` (import chunking only).

**Highest-risk unreviewed, in order:**

1. **`apps/backend/src/app/modules/auth/controller.ts`** — 22 commits, the highest churn of any hand-written file, and it owns `signIn`, `signUp`, `verify2FA`, `resetPassword`, and session issuance. I read none of its body. If there is a session-fixation, token-reuse, or two-factor-bypass bug in this codebase, this is where it is.
2. **`apps/backend/src/app/_migrations/`** — I asserted nothing about the schema, so every finding above that reasons about column types or constraints (findings 1 and 11, and uncertainty 4) is one schema read away from being either sharper or wrong.
3. **The mailbox sync ingesters (`google-sync`, `ms-sync`)** — the project's own skill documentation describes a window-scoped deletion sweep whose invariant is what prevents wiping a tenant's email archive. That is a data-destruction path with a stated invariant, and I did not verify the invariant holds.
4. **`storage.service.ts` and the signed-download routes** — blob access authenticated by a query token, on the path of every export and attachment download.
5. **The Cloudflare Workers in `infra/`** — they terminate every public request before the backend sees it, including the `/api` proxy for `*.pplforms.com`. Anything they get wrong about headers, host routing, or caching is invisible from the backend code I read.
