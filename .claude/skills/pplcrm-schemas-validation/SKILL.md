---
name: pplcrm-schemas-validation
description: "The shared Zod schemas in libs/common that validate every tRPC input and drive frontend forms. USE WHEN adding or editing a *.schema.ts file, defining an AddXObj/UpdateXObj/XObj triad, reusing core.schema helpers, or deciding between .partial() and a hand-written Update variant. EXAMPLES: 'add a Zod schema for the new invoices entity', 'why is UpdateTeamObj hand-written instead of AddTeamObj.partial()', 'what does nameSchema enforce'."
---

# pplCRM: Shared Zod Schemas & Validation

One Zod object is the single source of truth for a payload across three layers: it validates the tRPC input on the backend, it derives the TypeScript type both sides import, and it validates the Angular signal form on the frontend. Get the schema right and all three follow. Schemas live in `libs/common/src/lib/schemas/*.schema.ts`; shared field helpers live in `libs/common/src/lib/schemas/core.schema.ts`.

## The three-shape triad: `AddXObj` / `UpdateXObj` / `XObj`

These are **three different shapes for three different moments**, not redundancy:

- **`AddXObj`** — the create payload. Required fields are required; server-owned fields (`id`, `tenant_id`, `createdby_id`, timestamps) are absent because the server fills them.
- **`UpdateXObj`** — the edit payload. Fields are loosened (optional and/or nullable) so a partial edit is valid.
- **`XObj`** (e.g. `TasksObj`, `WorkflowObj`) — the full read-shape that comes back from the DB: has `id` and every column, typically as `.string()` without the strict create-time constraints.

Real example — `libs/common/src/lib/schemas/tasks.schema.ts` has all three: `AddTaskObj`, `TasksObj` (read-shape with `id`), `UpdateTaskObj`.

The triad is **not always complete**. `libs/common/src/lib/schemas/teams.schema.ts` defines only `AddTeamObj` and `UpdateTeamObj` — no `TeamsObj` read-shape, because the frontend read type is assembled elsewhere (`TeamDetail` in the teams service). Only add the read-shape `XObj` when something actually consumes it as a schema.

## `.partial()` vs. hand-writing the Update variant — both patterns are live

**Pattern A — `AddXObj.partial()`** (`libs/common/src/lib/schemas/workflows.schema.ts`):

```ts
export const UpdateWorkflowObj = AddWorkflowObj.partial();
```

Use this when "editable" means exactly "every Add field, now optional." It stays in lockstep with `AddXObj` automatically — add a field to Add and Update inherits it.

**Pattern B — hand-written field-by-field** (`libs/common/src/lib/schemas/teams.schema.ts`):

```ts
export const UpdateTeamObj = z.object({
  name: nameSchema('Name', 100).nullable(),   // AddTeamObj has it required & non-null
  description: descriptionSchema(1000),
  team_captain_id: idSchema.or(z.literal('')).nullable().optional(),
  ...
});
```

**The tradeoff:** `.partial()` can only make fields _optional_ — it cannot change per-field nullability or swap a validator. Pattern B is required when Update needs a field to differ from Add in a way `.partial()` can't express. Two verified cases:

- `UpdateTeamObj.name` is `nameSchema('Name', 100).nullable()` — nullable, which `AddTeamObj.name` (required) is not. `.partial()` would make `name` optional but still reject `null`.
- `UpdateTaskObj.details` uses `notesSchema` (nullable) whereas `AddTaskObj.details` is a plain `z.string().trim().max(10000).optional()` (non-nullable). Different validator, not just optional.

Rule of thumb: reach for `.partial()` first; hand-write only when a field's nullability or validator must diverge from Add.

## The nullable-foreign-key idiom

Optional FK fields use this exact chain (see `team_captain_id` in teams.schema.ts):

```ts
team_captain_id: idSchema.or(z.literal('')).nullable().optional(),
```

`idSchema` is `z.string().regex(/^\d+$/)` (core.schema.ts) — a numeric-string DB id, **not** a UUID (`uuidSchema` is separate). The `.or(z.literal(''))` accepts the empty string an unselected `<select>` sends, so the raw form value validates without a manual transform. `.nullable().optional()` lets the caller send `null` or omit it entirely.

## `core.schema.ts` helpers — what each actually enforces

Read the whole file; the non-obvious enforced behavior:

| Helper                | Signature / value         | Enforces                                                                      |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `nameSchema`          | `(fieldName, maxLen=100)` | `.trim().min(1, '<field> is required').max(maxLen)` — **required by default** |
| `descriptionSchema`   | `(maxLen=1000)`           | trim, max, **`.nullable().optional()`**                                       |
| `idSchema`            | value                     | `= dbIdSchema` = numeric-string regex `/^\d+$/`                               |
| `uuidSchema`          | value                     | `.uuid()` — distinct from `idSchema`                                          |
| `emailSchema`         | value                     | trim, max 320, `.email()`                                                     |
| `nullableEmailSchema` | value                     | `emailSchema.or(z.literal('')).nullable().optional()`                         |
| `phoneSchema`         | `(fieldName)`             | trim, max 30, nullable, optional                                              |
| `notesSchema`         | value                     | trim, max 10000, nullable, optional                                           |
| `jsonSchema`          | value                     | trim, max 50000, nullable, optional (it's a **string**, not parsed JSON)      |
| `addressSchema`       | object                    | every subfield trimmed, length-capped, `.nullable().optional()`               |

Note `nameSchema` and `phoneSchema` are **factories** (take a field name for the error message); the rest are ready-made schemas. Reuse these instead of re-declaring `z.string().trim().max(...)` — consistent limits and error copy are the point.

## Where the `z.infer` types live (two conventions)

The `AddXType`/`UpdateXType` aliases are `z.infer<typeof AddXObj>`. Two places define them:

- Older entities centralize them in `libs/common/src/lib/models.ts` (e.g. `AddTeamType`, `UpdateTeamType`, the task types).
- Newer files declare them inline in the schema file (see workflows.schema.ts).
  Either way they are re-exported from `libs/common/src/index.ts`, so consumers import `{ AddTeamObj, AddTeamType, UpdateTeamType }` from the `@common` alias or, as most schema consumers currently do, via a relative path to `libs/common/src` (team-form.ts, teams/trpc.router.ts). Prefer the inline type convention for new schemas — the type sits next to the schema it mirrors.

## How the schema reaches tRPC (backend)

The Zod object is passed straight to `.input(...)`; tRPC validates before your resolver runs. Two shapes:

- Direct, per-procedure (`apps/backend/src/app/modules/teams/trpc.router.ts`):
  ```ts
  add:    authProcedure.input(AddTeamObj).mutation(...)
  update: authProcedure.input(z.object({ id: idSchema, data: UpdateTeamObj })).mutation(...)
  ```
  The update wraps the payload as `{ id, data }` so the id and the partial edit validate together.
- Via the CRUD helper (`apps/backend/src/app/modules/workflows/trpc.router.ts`):
  ```ts
  const crud = createCrudRouter(workflows, AddWorkflowObj, UpdateWorkflowObj);
  ```
  `createCrudRouter(controller, insertSchema, updateSchema)` (`apps/backend/src/app/lib/crud-router.ts`) wires the same `.input()` validation for standard `add`/`update`/`getById` procedures. Use it when the entity needs no custom procedures.

## How the schema reaches the form (frontend)

The same `AddXObj` validates the Angular signal form (`apps/frontend/src/app/experiences/teams/ui/team-form.ts`):

```ts
protected readonly form = form(this.payload, (p) => {
  validateStandardSchema(p, AddTeamObj);
});
```

`form` and `validateStandardSchema` are imported from `@angular/forms/signals`. Two things worth knowing:

- Which schema the form validates against is **not consistent across the repo** — check the experience you're mirroring. `team-form.ts` validates against `AddTeamObj` even in edit mode (the Update schema only types the wire payload, `UpdateTeamType`), but `household-form.ts` validates against `UpdateHouseholdsObj`, `person-form.ts` against `UpdatePersonsObj`, and `company-form.ts` against `CompanyInputObj` (a single shared shape). If you follow the teams pattern, design the Add schema so field-level validity works for both create and edit.
- The raw `payload` signal holds `''` for empty selects; the `.or(z.literal(''))` idiom above is what lets those raw values pass validation.

## Non-goals

- **The `form()` helper mechanics** — `[formField]` binding, `.invalid()`, `.markAsTouched()`, loading gates: owned by `pplcrm-angular-components`. This skill only shows the `validateStandardSchema(p, Schema)` connection point.
- **tRPC procedure internals** — `TRPCError`, transactions, controllers: owned by `pplcrm-trpc-backend`.
- **DB columns / Kysely `Insertable`/`Updateable`** — the schema is not the DB type; migrations and Kysely types are owned by `pplcrm-migrations` and `pplcrm-trpc-backend`.
- **Adding a whole new entity end-to-end** (schema + migration + router + experience): owned by `pplcrm-add-entity`; this skill is just the schema step of that chain.
