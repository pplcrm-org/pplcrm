---
name: pplcrm-email-sync
description: >-
  Mailbox sync (Gmail + MS Graph) — the 48-hour initial window, the window-scoped deletion sweep
  (the invariant that prevents wiping a tenant's archive), per-folder checkpointing, the
  folder-scoped attachment payload policy (eager / deferred / spam never), and the body storage
  split (blob HTML + Postgres text extract). USE WHEN touching modules/google-sync, modules/ms-sync,
  the email ingester, email_bodies / email_attachments schema, the attachment download routes, or
  when a user reports missing mail, missing attachments, an empty inbox after connecting, or a body
  that will not load. EXAMPLES 'why does connecting Gmail only bring 2 days', 'the attachment says
  no longer available', 'my emails disappeared after a re-sync'.
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

## ⚠ The sweep invariant

Gmail has no deletion tombstones, so both adapters reconcile deletions by comparing what the server
returned against local rows. **The candidate set must be scoped to the window that was fetched** —
join `email_headers` and filter `date_sent >= windowStart`.

If you ever remove that filter, "Re-sync recent mail" (which sets `_needs_full_sync`, clearing the
watermark) will read a tenant's entire older archive as server-side deletions and destroy it. This
is covered by `google-sync.service.spec.ts` → _"does not delete mail older than the window when the
watermark is cleared"_. Do not weaken that test.

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

No search UI consumes `body_text` yet; the column and index exist so search can be added without a
backfill.

### Blob-leak ordering (do not regress)

`storeAttachmentPayload` hashes → looks up `files` by sha256 → uploads **only on a miss**. The
original code uploaded first and deduped after, which stranded the second blob: the pre-existing
`files` row was linked and the new `storage_key` was recorded nowhere, so nothing could find it to
delete. Covered by _"reuses an identical blob instead of uploading it twice"_.

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
  `deleteDemoData` returns the blob keys for the caller to purge **after** commit.

## Tests

- `google-sync.service.spec.ts` — window bounds, no-unbounded-query, incremental resume, **sweep
  safety**, per-folder checkpointing. Stubs `fetch` and the OAuth service.
- `email-ingester.payload.spec.ts` — eager/deferred/spam/trash attachment paths, dedupe-before-upload,
  inline vs offloaded bodies.
- `email-body-text.spec.ts` — extraction (pure).
- `controller.delete-cleanup.spec.ts` — body blob purge on hard delete, untouched on soft delete.
