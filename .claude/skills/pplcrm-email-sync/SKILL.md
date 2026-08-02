---
name: pplcrm-email-sync
description: >-
  Mailbox sync (Gmail + MS Graph) — the 48-hour initial window, detachment (a message that leaves
  the synced folder is hidden via emails.detached_at, never deleted) and how it differs from
  deleted_at, re-attaching a returning message, the window-scoped reconciliation sweep, the 90-day
  retention sweep for detached rows, per-folder checkpointing, the folder-scoped attachment payload
  policy (eager / deferred / spam never), and the body storage split (blob HTML + Postgres text
  extract). USE WHEN touching modules/google-sync, modules/ms-sync, the email ingester,
  emails.detached_at, the inbox folder/count queries, email_bodies / email_attachments schema, the
  attachment download routes, or when a user reports missing mail, missing attachments, an empty
  inbox after connecting, a message that vanished after archiving it in Outlook, or a body that will
  not load. EXAMPLES 'why does connecting Gmail only bring 2 days', 'the attachment says no longer
  available', 'my emails disappeared after a re-sync', 'archiving in Outlook deleted my comments'.
---

# Mailbox sync

Two provider adapters feed one ingester:

| File                                                                      | Role                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/backend/src/app/modules/google-sync/google-sync.service.ts`         | Gmail REST list + per-message fetch                    |
| `apps/backend/src/app/modules/ms-sync/ms-sync.service.ts`                 | MS Graph `/messages/delta`                             |
| `apps/backend/src/app/modules/emails/services/email-ingester.service.ts`  | provider-agnostic writer (dedupe, bodies, attachments) |
| `apps/backend/src/app/modules/emails/services/attachment-materializer.ts` | on-demand attachment fetch                             |
| `apps/backend/src/app/modules/emails/services/email-body-text.ts`         | text extraction + inline-body threshold                |
| `libs/common/src/lib/emails.ts`                                           | the folder payload policy, shared with the frontend    |

**Plan gate (2026-08-01): the shared inbox is Grassroots+** (`GATED_FEATURES.inbox`, demo mode
exempt). Connecting, manual sync and ALL emails-module access (reads included) are refused on
Free; `schedule_sync_jobs` skips unentitled tenants at fan-out and the handlers re-check at run
time, so a downgrade stops syncing with tokens left in place (an upgrade resumes on the next cron
tick — no user action). A downgrade to Free also schedules a **30-day purge** of all synced mail +
the OAuth tokens (`tenants.inbox_purge_scheduled_at` → `purge_downgraded_inboxes` cron →
`EmailIngesterService.purgeAllTenantEmails`); upgrading within the window cancels it. See
`pplcrm-sending-guards` → plan gates for the full map.

Jobs: `google_sync` / `ms_sync`, enqueued by the `schedule_sync_jobs` cron every 10 minutes
(`lib/jobs/cron-registry.ts`) and by the OAuth callback inside the token-upsert transaction.

## The 48-hour initial window

`INITIAL_SYNC_WINDOW_HOURS = 48` in **both** adapters. Change one, change the other, and update the
help article (`libs/common/src/lib/help/articles/outreach.ts`, the `inbox` article's "What syncs"
section) plus the connect-screen copy in both `*-sync-settings.html`.

- **Gmail**: every query carries `after:`. Incremental uses `watermark - 60s`; first sync uses
  `now - 48h`. There is deliberately **no unbounded branch** — a spec asserts this.
- **Graph**: `initialDeltaUrl()` builds `$filter=receivedDateTime ge <iso>`. Because `$filter`
  support on the delta endpoint is narrow, the page loop **also** re-checks `receivedDateTime` per
  message. Keep both; the filter saves enumeration, the loop check guarantees the bound.
- A 410 Gone on an expired delta link restarts **bounded**, not full.

Before the window existed, connecting pulled the entire mailbox — a job that could not finish inside
its 1-hour timeout and restarted from zero on each of 3 attempts, plus thousands of already-handled
messages landing as `status='open'`.

## ⚠ Detachment, not deletion (the sync NEVER destroys a message)

**A message that leaves the folder we sync from is detached, never deleted.** `detachMessage` in the
ingester sets `emails.detached_at = now()` and touches nothing else. The row, its comments, its
assignee, its status and its favourite flag all survive.

This is not a nicety. A folder-scoped view reports a message as gone the moment it merely _leaves_
that folder, which ordinary use does constantly:

| Path                                                                          | Fires when                                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Graph delta marks a message `@removed` (`ms-sync.service.ts`)                 | **every sync, initial or incremental** — archiving in Outlook, dragging to a folder, or a rule filing it      |
| the reconciliation sweep in either adapter (server did not return a local id) | initial sync / expired delta link (Graph); first connection or forced re-sync (Gmail, `folderLastSync === 0`) |

Until 2026-08-01 both paths hard-deleted the `emails` row and every child table, so a user archiving
a message in Outlook destroyed the team's internal comments on it, who it was assigned to and its
triage status, with no activity-log entry and no recovery. Do not reintroduce a delete on either
path.

### `detached_at` vs `deleted_at` — two different claims, do not merge them

| Column        | Means                                                    | Written by                                             |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `deleted_at`  | the user put this in the **CRM's own Trash**             | `EmailRepo.moveToTrash`, cleared by `restoreFromTrash` |
| `detached_at` | the **provider** stopped listing it in the synced folder | `EmailIngesterService.detachMessage`                   |

Setting `deleted_at` for an archived message would file it into the user's CRM trash, which is a
different and wrong claim. Added by `_migrations/2026-08-01-emails-detached-at.ts`.

### Where a detached message does and does not show up

Decided in **one place**: `EmailRepo.buildFolderPredicate` (and mirrored, filter by filter, in
`getEmailCountsByFolder`). If you add a folder or a count, decide which side it is on.

- **Hidden**: the real folders (Inbox, Sent, Trash, Spam) and the triage views over the inbox stream
  (All open, Closed, Unassigned) — a message archived in Outlook must not still sit in the CRM inbox.
- **Still shown**: **Assigned to me** and **Favourites**, because those exist only because somebody
  in the CRM acted on the message. Archiving upstream must not quietly clear an assignee's list.
- **Always reachable by id**: `getEmailWithHeadersAndRecipients`, `getEmailBody`, `getEmailHeader`
  do not filter on `detached_at`, so an assignment notification, a mention link or an activity entry
  still opens the message and its comments.

### Returning messages re-attach — they must not duplicate

A user can move a message out of the inbox and back again. Both re-attach paths live in
`ingestEmail` and both clear `detached_at`:

1. **Same provider id** — the `preview` dedupe lookup finds the row.
2. **New provider id** — Graph reissues the id on a folder move, so only the stable `Message-ID`
   header recognises it. The `sameFolder` branch refreshes `preview` _and_ clears `detached_at`.

Drop either and the round trip leaves a hidden row behind and inserts a duplicate beside it.

### Storage growth: the retention sweep

Nothing is deleted on the sync path, so `prune_retention` (`lib/jobs/handlers/maintenance.handlers.ts`
→ `pruneDetachedEmails`) removes detached rows after **90 days** — but only those carrying nothing a
person added: no comment, no assignee, not starred, status not `closed`. Anything a person touched
is kept indefinitely. The sweep also purges the body blob and runs attachment files through
`purgeUnreferencedFiles`, because storage is not covered by the FK cascade.

### The sweep's window invariant (still load-bearing)

Gmail has no deletion tombstones, so both adapters reconcile by comparing what the server returned
against local rows. **The candidate set must be scoped to the window that was fetched** — join
`email_headers` and filter `date_sent >= windowStart`.

If you ever remove that filter, "Re-sync recent mail" (which sets `_needs_full_sync`, clearing the
watermark) will read a tenant's entire older archive as server-side disappearances. Since 2026-08-01
that hides the archive instead of destroying it, which is survivable — but a mailbox whose whole
history has vanished from the inbox is still a serious incident, so keep the filter. Covered by
`google-sync.service.spec.ts` → _"does not touch mail older than the window when the watermark is
cleared"_ and its Graph twin. Do not weaken those tests.

There is a known, separate defect the Gmail sweep still carries: it compares a **sender-supplied
`Date:` header** (what `email_headers.date_sent` holds for Gmail) against **Gmail's own
received-time** `after:` filter, so a message with a wrong or forged date is a candidate the server
query can never return. Detaching rather than destroying is what makes that survivable; fixing the
clock mismatch is its own task.

### What still genuinely destroys

Leave these hard-deleting — each one means the user asked for the data to be gone:

| Path                                                   | Trigger                                            |
| ------------------------------------------------------ | -------------------------------------------------- |
| `EmailIngesterService.removeAllLocalEmails`            | mailbox disconnect with "remove local emails"      |
| `EmailsController.deleteMany` (ids already in Trash)   | deleting from the CRM Trash                        |
| `EmailRepo.emptyTrash`                                 | Empty Trash                                        |
| `wipeTenant` in `lib/jobs/handlers/deletions.handlers` | scheduled workspace deletion                       |
| `pruneDetachedEmails`                                  | 90-day sweep of detached rows carrying no CRM data |

## Checkpointing

`saveDeltaLink` is called **inside** the folder loop, once per folder. A failure in Spam must not
discard Inbox's progress (which would send the next run back to a re-fetch).

## Attachment payload policy

Defined once in `libs/common/src/lib/emails.ts` and obeyed by ingester, download route and UI:

| Folder      | Metadata + body text | Small files fetched during sync             | Materialize on demand | Inline images |
| ----------- | -------------------- | ------------------------------------------- | --------------------- | ------------- |
| Inbox, Sent | yes                  | yes (`≤ EAGER_ATTACHMENT_MAX_BYTES`, 256KB) | yes                   | yes           |
| Trash       | yes                  | no                                          | yes                   | yes           |
| **Spam**    | yes                  | **no**                                      | **never**             | **no**        |

- `allowsEagerAttachmentFetch(folderId)` — sync-time fetch.
- `allowsAttachmentDownload(folderId)` — the spam hard block. Enforced server-side in
  `materializeAttachment`; the UI (`email-body.ts`) disables the link and explains why. There is no
  confirm-and-proceed path: spam payloads never enter the storage account. Recovery is for the user
  to move the message out of Spam in their mail client.
- `allowsInlineImages(folderId)` — the ingester skips `cid:` rewriting in Spam.

A deferred attachment row has `file_id = null` and `remote_ref` set. It still shows filename, type
and size, so the user knows what is there.

### Materialization

First download hits `materializeAttachment` (both `/:id/attachments/:attachmentId` and the inline
`/cid/:cid` route), which fetches from the provider, stores, sets `file_id`, and serves. Second
download is free, and the file then survives the message being deleted upstream.

- **Gmail** re-reads the message to get a fresh `attachmentId` — Gmail may reissue it, so
  `remote_ref` is a fallback hint, not a guarantee.
- **Graph** reads `/me/messages/{id}/attachments/{attId}`, which returns `contentBytes`. The _listing_
  call in the sync path deliberately `$select`s metadata only — without it, Graph returns every
  payload inline and "lazy" attachments would have been downloaded anyway.
- Unreachable (token revoked, message deleted) → `{status:'unavailable'}` → 404 with
  _"no longer available from the mailbox"_, never a generic 500.

## Body storage split

`email_bodies` holds three relevant columns:

- `body_html` — inline HTML, only when `≤ INLINE_BODY_MAX_BYTES` (4KB). Null otherwise.
- `storage_key` — blob key (`emails/bodies/<uuid>.html`) for everything else.
- `body_text` — plain-text extract, GIN-indexed via `to_tsvector('english', …)`.

**Never read `body_html` directly** — use `EmailBodiesRepo.getBodyHtml()`, which resolves either
location. Pre-split rows are all inline, so the fallback is load-bearing.

Body blobs are **not** deduped (one blob, one email), so deletion is unconditional — see
`purgeBodyBlobs` in both the ingester and `EmailsController`. Attachment files _are_ sha256-deduped
and go through `purgeOrphanedFiles`.

### Deleting an email must not delete another feature's file

`purgeOrphanedFiles` (both copies) now delegates to `purgeUnreferencedFiles` in
`apps/backend/src/app/lib/file-references.ts`. Do not reintroduce a local "is any email attachment
still using this?" check: that is what it used to ask, and it was wrong. Seven columns across the
schema hold a `files.id` (`email_attachments.file_id`, `profiles.avatar_file_id`,
`bug_reports.screenshot_file_id`, and `file_id` on `companies`, `households`, `persons`, `tasks`),
and only the first two have a real foreign key — so deleting an email could silently destroy an
avatar or a person photo that resolved to the same row, with nothing in Postgres objecting.
Newsletter images and team logos are worse: nothing points at them at all, they are owned only by
the `files.entity_type` / `entity_id` tag, so a column-only check deletes them too. The shared
helper covers all of it and is schema-drift-tested in `lib/file-references.spec.ts`.

Ordering rule, kept deliberately: the `files` row delete runs inside a transaction and the blob is
deleted only **after** that transaction commits. A failed blob delete leaks bytes; a blob deleted
before a rolled-back row delete leaves a permanently broken download.

No search UI consumes `body_text` yet; the column and index exist so search can be added without a
backfill.

### Blob-leak ordering (do not regress)

`storeAttachmentPayload` hashes → looks up `files` by sha256 → uploads **only on a miss**. The
original code uploaded first and deduped after, which stranded the second blob: the pre-existing
`files` row was linked and the new `storage_key` was recorded nowhere, so nothing could find it to
delete. Covered by _"reuses an identical blob instead of uploading it twice"_.

That lookup **joins `email_attachments`**, so it only ever reuses a `files` row that is itself an
email attachment. Matching any row in the tenant gave an incoming attachment part-ownership of
whatever else happened to have the same bytes (an avatar, a newsletter image), which the delete
sweep then destroyed. Storing identical bytes twice in that rare case is the cheaper mistake.
Covered by _"does not reuse a file that is not an email attachment"_. The compose-and-send path
(`saveLocalEmail` in `emails/routes/emails-api.route.ts`) carries the same join and has its own
test of the same name — keep the two in step if you change either.

One deliberate exception: the demo attachment job (`lib/jobs/handlers/demo.handlers.ts`) still
matches any `files` row in the tenant. That is safe because only rows the job newly INSERTS are
recorded in the demo manifest, so exit-demo can never delete a row that already belonged to the
user.

## Where things are stored

`emails.preview` is **not** a body snippet — it is the dedupe key, `google:<id>` / `ms:<id>`. All
provider reconciliation and the materializer's provider detection key off it. **Never render it.**
The user-facing snippet is `emails.preview_text`, added by
`2026-07-28-zzzz-emails-preview-text.ts` and written by every path that creates a message
(`previewTextFrom(extractBodyText(html))`). Until that migration the inbox list bound
`{{ email.preview }}`, so synced mail displayed `google:18f3a…` under every subject — masked in
demo workspaces because the seeder wrote snippet text into the dedupe column. Two columns, two
jobs; keep them apart.

`emails.date_sent` is a **denormalized copy** of `email_headers.date_sent` (falling back to the
row's own `created_at`), added by the 2026-07-26 sort-indexes-hot-lists migration so the inbox can
sort on one indexed column. Writers must keep the two in step. The sweep still joins
`email_headers`, which is the source of truth.

### Demo mail

`modules/demo/demo-seed.ts` writes this shape by hand rather than going through the ingester, so
the two can drift. It matches on the parts that matter:

- Bodies stay **inline** with a `body_text` extract — a few hundred bytes each, far under
  `INLINE_BODY_MAX_BYTES`, so nothing belongs in blob storage and none is written.
- `preview` is **null** (no provider owns demo mail); the snippet goes in `preview_text`.
- An `email_headers` row is written with a `<…@demo.invalid>` Message-ID. That reserved domain is
  load-bearing: demo mail is untagged, and the ingester **adopts** an untagged local message whose
  Message-ID matches a synced one. A domain no provider can emit means a real sync can never
  swallow a demo message.
- Attachments are seeded **metadata-only** (`file_id` null, `remote_ref = 'demo:<asset key>'`) and
  a `materialize_demo_attachments` job is queued in the same transaction. The job builds the
  payloads (`demo-attachment-assets.ts` — built, never bundled), uploads, links `files` rows, and
  appends their ids to the seed manifest. Do **not** move those uploads back into signup: blob I/O
  there adds latency to every signup, turns a storage outage into a signup failure, and strands
  blobs on rollback. It also hung three unrelated spec files that do not stub `StorageService`.
- `files` is not reached by the emails cascade, so exit-demo deletes the manifest-tracked ids and
  `deleteDemoData` returns the blob keys for the caller to purge **after** commit. That cleanup is
  the **last** thing `deleteDemoData` does, and each file goes through the shared reference check.
  Both details are load-bearing: exiting demo mode leaves a live paid tenant behind, so a real
  record can hold a demo file and must not lose it — but a demo person holding one is no reason to
  keep it, and running the check before the demo rows are deleted leaks a blob for every such file.
  Covered by the two `exit-demo … demo attachment file` tests in `demo-seed.spec.ts`.

## Tests

- `google-sync.service.spec.ts` — window bounds, no-unbounded-query, incremental resume, **sweep
  safety**, per-folder checkpointing. Stubs `fetch` and the OAuth service.
- `ms-sync.service.spec.ts` — the same invariants for Graph, plus the whole detachment story: an
  `@removed` message keeps its row/comment/assignee/status, leaves the Inbox listing and its badge
  counts, stays on "Assigned to me", and re-attaches (under the same id and under a new one) instead
  of duplicating. Its `graphGet` mock receives the requested URL, so a test can answer per folder —
  stored delta links must keep the real `/mailFolders/<name>/` shape or the matcher misses.
- `email-ingester.service.spec.ts` — Message-ID dedup, plus detach-vs-destroy: `detachMessage` keeps
  everything and keeps its original timestamp on repeat, `removeAllLocalEmails` still destroys.
- `maintenance.detached-emails.spec.ts` — the 90-day sweep deletes an untouched detached row and its
  body blob, and keeps anything commented on, assigned, closed or starred.
- `email-ingester.payload.spec.ts` — eager/deferred/spam/trash attachment paths, dedupe-before-upload,
  inline vs offloaded bodies.
- `email-body-text.spec.ts` — extraction (pure).
- `controller.delete-cleanup.spec.ts` — body blob purge on hard delete, untouched on soft delete,
  and the cross-feature cases: an email delete must not remove a file a profile photo, a person
  photo or a live newsletter still holds, but must still remove one with a stale entity tag.
- `lib/file-references.spec.ts` — the list of files-referencing columns is compared against
  `pg_catalog`, so a migration that adds a new one fails the suite instead of quietly reopening
  the bug.
