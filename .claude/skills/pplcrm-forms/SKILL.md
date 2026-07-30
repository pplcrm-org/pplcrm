---
name: pplcrm-forms
description: "The 'living funnel' Forms experience — the web_forms lifecycle (draft/published/archived), the FormField model + normForm() email-identity invariant, the three-mode forms page (browse / New-form stepper / live edit), form_submissions, the public /f/:slug page, and why donation forms stay on /d/:slug. USE WHEN editing anything under experiences/forms, the web-forms backend module, web_forms / form_submissions schema, the public form page, or reconciling forms with donations. EXAMPLES: 'add a field type to forms', 'why is the email field locked', 'the public /f/:slug page 404s'."
---

# pplCRM Forms (living-funnel model)

A form is a **living page with a lifecycle**, not a static field editor. Status is the single source
of truth: `draft → published → archived` on `web_forms.status` (there is no boolean). The old
grid + form-editor model is gone; `forms-grid.ts` and `form-editor.ts` were deleted.

## The five product rules (resolve most design questions)

1. **Email is the identity key.** Every form always has an `email` field, always on + required. A
   submission upserts a person by email. Enforced server-side by `normForm()`, not just the UI.
2. **One verb per state transition.** Publish / Unpublish / Archive / Restore / Delete — five distinct
   tRPC mutations, never a status dropdown. Restore always lands in **draft** (reopening a link is a
   deliberate act).
3. **Archive, don't delete.** `deleteDraft` hard-rejects unless `status='draft' && submissions=0`;
   everything else is archived (public link → closed notice, data intact).
4. **Responses are people.** `form_submissions` (answers jsonb + `person_id` FK) is written inside the
   existing submit transaction; the Responses tab links each row to the person record.
5. **Types are chips, not nav.** `type ∈ signup|pledge|rsvp|request|survey` is a creation template +
   display chip. One Forms page.

## Where things live

- **Shared model** — `libs/common/src/lib/schemas/web-forms.schema.ts`: `FormFieldObj`
  (`{ key,label,type:'text'|'area'|'select'|'checks',options?,placeholder?,help?,on,required }`),
  `FORM_TEMPLATES`, `fieldsForTemplate(type)`, and **`normForm(rawFields)`** — the single source of
  truth that coerces stored JSON into a valid `FormField[]`, guarantees name+email exist, **forces
  email on+required**, and appends the standard optional catalog (mobile/street1/city/zip). Both API
  and editor call it, so the preview always matches what saves. New lifecycle schemas: `CreateFormObj`,
  `UpdateFormObj`, `FormSubmissionObj`. Legacy `AddWebFormObj`/`UpdateWebFormObj` still exist for the
  donation path.
- **Backend** — `apps/backend/src/app/modules/web-forms/`: `controller.ts` (lifecycle methods +
  `submitFormPublic` + `getPublicFormBySlug`). **`submitFormPublic` carries the `forms` plan gate
  (2026-07-27)** — `assertPlanFeature(db, tenantId, 'forms')` right after the published-status
  check, so BOTH the keyless embed and the keyed server-side submit are covered by one call. The
  tRPC router gates authoring only, which meant a downgraded tenant could not edit a form but every
  already-embedded form kept quietly accepting submissions. Consequence for specs: a tenant row must
  seed `subscription_plan: 'grassroots'` or every submission test fails on the gate. **List
  targeting** lives in the `map_web_forms_lists`
  join table (FK ON DELETE CASCADE — source of truth; the controller write paths sync it via
  `syncTargetLists` and the submit path reads it). The JSONB `web_forms.target_lists` column is
  legacy dual-write only, slated to drop. `target_tags` stays JSONB deliberately: it holds tag
  _names_ with get-or-create-at-submit semantics, not ids. `repositories/web-forms.repo.ts`
  (`listForms`/`getFormSubmissions`/`countSubmissions`/`slugExists`/`getBySlugPublic`),
  `trpc.router.ts` (`list`/`getForEdit`/`create`/`updateLive`/`publish`/`unpublish`/`archive`/
  `restore`/`deleteDraft`/`submissions`), `routes/web-forms-public.route.ts` (public REST, all under
  the `/api/forms` prefix and ALL tenant-scoped by slug via `lib/public-tenant.ts`:
  `GET /f/:slug` JSON config for the SPA page, `GET /d/:slug` server-rendered donation page,
  `POST /submit/:slug` for both. There are **no UUID-keyed public routes** — `/view/:formId` and
  `/submit/:formId` were removed in the tenant-subdomain URL convergence, July 2026).
- **Frontend** — `apps/frontend/src/app/experiences/forms/ui/`: `forms-page.ts/html` (the three-mode
  shell: browse, in-page New-form flow — a 2-step stepper of template cards then a name, no dialog —
  and live edit), `form-render.ts` (read-only preview card, reused in the pane),
  `public-form.ts` (the unauthenticated `/f/:slug` page, registered in `app.routes.ts` — NOT the
  dashboard shell). `services/forms-service.ts` carries both the legacy grid contract and the new
  lifecycle methods.

## Non-obvious traps

- **Two field shapes coexist.** New forms store `FormField[]` objects; donation/older forms store the
  legacy `string[]` (`"mobile:required"`). Any code reading `web_forms.fields` must handle both — see
  the required-field validation in `submitFormPublic` and `normForm` (which silently drops non-object
  entries).
- **Donations are separate, on purpose.** `form_type ∈ donation|recurring_donation` keeps the legacy
  `add`/`update` path, the Stripe checkout in `submitFormPublic`, and the `/donation-pages`
  (fundraising) UI. `listForms` **now includes donation types** (the old `form_type not in (...)`
  filter was removed) so every form shows in one list. Selecting a donation form previews it
  **inline in the same pane** as every other form — a read-only card rendered by `pc-donation-render`
  (`donation-render.ts`), which mirrors the fixed `/d/:slug` shape (amount + contact + address) rather
  than the normalized standard-form `fields`. The pane's chrome is donation-aware: no Form/Responses
  tab (donations don't write `form_submissions`), the public-link row points at `/d/:slug`
  (`publicUrl()` branches on `isDonationForm`), the embed button is hidden, and an **Edit donation
  form** button (`openDonationEditor()`) hands off to the Stripe-backed fundraising editor at
  `/donation-pages/:id/edit`. `typeChip()`/`isDonationForm()` still render a **Donation** chip and the
  list card shows "Donation form" instead of a `form_submissions` count. `form_submissions` is
  still **not** written for them, and their public page is still `/d/:slug`. `type` (the template
  chip) is NULL for donation forms. Don't merge the two field/type sets — the editor and public
  rendering stay separate.
  Every form (donation included) now has a NOT NULL per-tenant-unique `slug` (legacy `addForm`
  generates one via `uniqueSlug`; NULLs were backfilled by `2026-07-29-b-web-forms-slug-backfill`).
  Donation forms render only on the server-rendered `GET /api/forms/d/:slug` page (it has the amount
  field + Stripe); `getPublicFormBySlug` deliberately 404s them so they never render on the /f/ SPA
  page without an amount field.
- **`status` mapping.** The legacy add/update path accepts `active` and maps it to `published`
  (`mapLegacyStatus`), because the fundraising UI still sends `active`. The DB CHECK only allows
  `draft|published|archived`; the column default is `draft`.
- **Every public route resolves the tenant from the subdomain, then scopes the lookup.** Form slug
  is unique **per tenant**; the tenant is identified by the Host (`<tenantSlug>.<baseDomain>`, base from
  `env.publicBaseDomain` / `environment.publicBaseDomain`, default `localhost` in dev). Routes read
  `?t=<tenantSlug>` (the SPA passes its own subdomain — robust across hosts) or fall back to the Host,
  via the shared **`apps/backend/src/app/lib/public-tenant.ts`** (`resolveTenantFromRequest`,
  `tenantSlugFromHost`, `publicOrgName`; the `tenants` table is tenant-safety allow-listed), then call
  the **tenant-scoped** `getBySlugPublic(tenantId, slug)`. There is no cross-tenant form query — do not
  reintroduce one. Tenant slugs are DNS-safe, globally unique, generated at signup (`createTenant` →
  `generateTenantSlug`, `@common/slugifyHandle` + `RESERVED_SUBDOMAINS`), exposed to the SPA via
  `currentUser.tenant_slug`, and used to build public URLs via the shared frontend helper
  `apps/frontend/src/app/shared/public-pages.ts` (`publicPageUrl` → `https://<tenantSlug>.<base>/f/<formSlug>`;
  event pages use `/e/<slug>`, volunteer pages `/volunteer` + `/v/<slug>` — same model, see the
  events/volunteer-events modules). Ships behind wildcard DNS + cert; in dev, `<slug>.localhost` works
  in Chrome.
- **`full_name` split.** New forms collect one `full_name`; `submitFormPublic` splits it on the last
  space into first/last so the person record still gets a name. The person model has no full_name.
- **Live edit has no Save.** `forms-page` debounces `forms.updateLive`; every control mutates
  immediately and the preview re-renders. The confirmation-email + embed dialogs are the exceptions
  (explicit Save / Copy).

## Donation-forms convergence — decided, deferred (2026-07-08)

Spec §12 (Fig. 15) describes donations as folding into the Forms living-funnel model — a
"donation" template alongside signup/pledge/rsvp/request/survey. The app deliberately does **not**
do this today; the tradeoff was re-examined and the decision was to **keep them separate for now**
rather than converge in the same change that shipped the Donations page/dialog work. Concrete
reasons, so the next agent doesn't have to re-derive them:

- **Two field shapes are incompatible today.** Living-funnel forms store `FormField[]` objects;
  donation forms store the legacy `string[]` (`"mobile:required"`). Converging means either
  migrating every donation form's stored fields or teaching `normForm()`/the editor to branch on
  form_type forever — either way it's a real migration, not a template addition.
- **Donation forms carry Stripe checkout logic baked into `submitFormPublic`** and render via a
  **server-rendered** page (`GET /api/forms/d/:slug`) because they need an amount field + Stripe
  Elements that the SPA's `/f/:slug` client page doesn't support. `getPublicFormBySlug`
  deliberately 404s donation types so they never hit the SPA page without an amount field.
  Converging requires either bringing Stripe Elements into the SPA form renderer or keeping a
  parallel render path forever — both are their own design/build effort.
- **`form_submissions` isn't written for donations** — the donation ledger is
  `donations`/`donation_pledges`, not `form_submissions`. (Donation forms now appear in the Forms
  _list_, but their card shows "Donation form" rather than a submission count, and their responses
  are not reconciled into the Responses tab.) Fully unifying the response view still means reconciling
  two different response models, not just two field shapes.
- **The donation-collection UX changed underneath this decision.** The Donations work added the Fig. 15
  "Record donation" dialog (`record-donation-dialog.ts`) for offline gifts and rebuilt the
  Donations page stats/table to match spec — i.e. the _product_ gap the spec cared about (no way
  to record a gift by hand) is now closed without touching the forms model at all. That lowers the
  urgency of convergence: the spec's donation-recording story works today via `/donation-pages`
  (fundraising) for public giving pages and the new dialog for offline gifts.

**What shipped instead:** the Donations page's "New donation form" button links to the existing
`/donation-pages/add` (fundraising) creation flow — the one true "create a donation form" path
today. No dead end, no new UI invented.

**Partially shipped (light surfacing, 2026-07-15; inline preview added 2026-07-20):** donation forms
_appear_ in the Forms list (`listForms` no longer filters them; **Donation** chip; card reads
"Donation form") and now **preview inline** in the same pane as every other form via
`pc-donation-render`. They remain **not** editable inline (the **Edit donation form** button opens the
fundraising editor at `/donation-pages/:id/edit`) and still do **not** render on `/f/:slug` (their
public page stays `/d/:slug`). This closes the "see and preview all my forms in one place" gap without
touching the field model, Stripe, or the public render path.

**Full convergence is still deferred.** Revisit when the Forms field model natively supports a
payment-type field (amount + a Stripe Elements-equivalent widget) AND the public page architecture can
serve both the SPA (`/f/:slug`) and payment (`/d/:slug`) cases from one route. Until then, treat
"donation forms are _edited/rendered_ like living-funnel forms" as **won't-fix by design**, not a bug —
the non-obvious traps below explain the mechanics.

## Campaigns (§15) — how forms interact with contexts

- `web_forms.campaign_id` (NOT NULL): every form belongs to one campaign context. `createForm`
  stamps the caller's active context (frontend `FormsService.createForm`); backend falls back to
  the office via `CampaignsRepo.resolveForWrite`.
- **Submissions write consent into `campaign_subscriptions` for the FORM's campaign**, not the
  legacy `persons.opt_in_status` (dropped 2026-07-15 migration). Double opt-in → `status='pending'`;
  the confirm link flips every pending row for the person to `subscribed` (allowed even if the
  campaign was archived meanwhile). An existing row — including a deliberate `unsubscribed` —
  wins over a re-submit (`ON CONFLICT DO NOTHING`).
- Donation-form submits no longer apply a `donor` tag: donor is DERIVED from the donations table.
- The forms grid filters by the active context (`options.campaignId` → web-forms repo).
  See `pplcrm-campaigns` for the full contexts model.

## After changes

Update the Forms Help Center article (`libs/common/src/lib/help/articles/engagement.ts`, id `forms`) and
run `npx nx test common`. Then the `pplcrm-quality-gate` pipeline. Schema changes
go through `pplcrm-migrations`; new queries through `pplcrm-tenant-safety`.
