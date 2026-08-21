import { z } from 'zod';
import { idSchema, nameSchema, descriptionSchema } from './core.schema';

// ---------------------------------------------------------------------------
// Post-submit redirect address.
// ---------------------------------------------------------------------------

/**
 * Schemes a form's redirect address may use.
 *
 * Zod's `.url()` accepts anything `new URL()` can parse, which includes
 * `javascript:alert(document.domain)`, `data:text/html,<script>…`, `JavaScript:alert(1)` and
 * `vbscript:msgbox(1)` — all four verified against the zod installed in this repo. The public form
 * page assigns this value to `window.location.href`, a raw assignment Angular's sanitizer never
 * sees, so without this list anyone who could edit a form could store script that runs in every
 * visitor's browser on that page.
 *
 * This is deliberately NOT `apps/backend/src/app/lib/outbound-url-guard.ts`, which answers a
 * different question. That guard protects the SERVER from fetching a tenant-supplied URL, so it
 * allows `https:` only and blocks private address ranges and DNS rebinding. Here the backend never
 * fetches the value — the visitor's browser navigates to it — so plain `http:` to a customer's own
 * site is a legitimate redirect, and a private address belongs to the visitor's network rather
 * than ours. Sharing one list would reject valid redirects and add a pointless DNS lookup to every
 * public page load.
 */
export const REDIRECT_URL_ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** True when this value is safe to hand to a browser as a navigation target. */
export function isSafeRedirectUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  if (!REDIRECT_URL_ALLOWED_PROTOCOLS.includes(url.protocol)) return false;
  // Credentials let a URL read as a host it does not go to: the eye-catching part of
  // `https://accounts.example.org@evil.test/` is the username, not the site being visited.
  if (url.username || url.password) return false;
  return true;
}

/**
 * A stored redirect address that is safe to return or redirect to, or null.
 *
 * Rows written before the validation below existed are never re-validated when they are read, so
 * every path that hands a stored value to a browser calls this instead of trusting the column.
 */
export function safeRedirectUrl(value: unknown): string | null {
  return isSafeRedirectUrl(value) ? String(value).trim() : null;
}

/** The shared field validator for a form's redirect address. */
export const redirectUrlSchema = z
  .string()
  .trim()
  .url('Redirect URL must be a valid URL')
  .refine(isSafeRedirectUrl, 'Redirect URL must start with http:// or https://')
  .or(z.literal(''))
  .nullable()
  .optional();

export const AddWebFormObj = z.object({
  name: nameSchema('Web Form name', 100),
  description: descriptionSchema(500),
  redirect_url: redirectUrlSchema,
  target_tags: z.array(z.string()).nullable().optional(),
  target_lists: z.array(z.string()).nullable().optional(),
  fields: z.array(z.string()).nullable().optional(),
  // Legacy donation/standard add path. 'active' is accepted for back-compat and mapped to
  // 'published' by the controller; the lifecycle statuses pass through unchanged.
  status: z.enum(['active', 'draft', 'published', 'archived']).default('active').optional(),
  send_confirmation: z.boolean().default(true).optional(),
  send_alert: z.boolean().default(true).optional(),
  form_type: z.enum(['standard', 'donation', 'recurring_donation']).default('standard').optional(),
});

export const UpdateWebFormObj = z.object({
  name: nameSchema('Web Form name', 100).optional(),
  description: descriptionSchema(500).optional(),
  redirect_url: redirectUrlSchema,
  target_tags: z.array(z.string()).nullable().optional(),
  target_lists: z.array(z.string()).nullable().optional(),
  fields: z.array(z.string()).nullable().optional(),
  status: z.enum(['active', 'draft', 'published', 'archived']).optional(),
  send_confirmation: z.boolean().optional(),
  send_alert: z.boolean().optional(),
});

export const WebFormsObj = z.object({
  id: z.string().uuid(),
  tenant_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  redirect_url: z.string().nullable(),
  target_tags: z.array(z.string()).nullable(),
  target_lists: z.array(z.string()).nullable(),
  fields: z.array(z.string()).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']),
  send_confirmation: z.boolean().default(true),
  send_alert: z.boolean().default(true),
  form_type: z.string(),
  createdby_id: z.string(),
  updatedby_id: z.string(),
  created_at: z.union([z.date(), z.string()]),
  updated_at: z.union([z.date(), z.string()]),
});

// ---------------------------------------------------------------------------
// North Star "living funnel" lifecycle (new Forms experience).
//
// The five template types are creation presets + a display chip. Donation forms
// (form_type IN donation/recurring_donation) keep the legacy string[] `fields`
// shape and the old add/update path — they are NOT part of this model.
// ---------------------------------------------------------------------------

export const FORM_TYPES = ['signup', 'pledge', 'rsvp', 'request', 'survey'] as const;
export type FormType = (typeof FORM_TYPES)[number];
export const FormTypeEnum = z.enum(FORM_TYPES);

export const FORM_STATUSES = ['draft', 'published', 'archived'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

/** A single configurable field on a form. Stored as JSON in `web_forms.fields`.
 * `checkbox` (2026-08-20) is a single yes/no box — submitted as 'yes' when checked. */
export const FormFieldObj = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'area', 'select', 'checks', 'checkbox']),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  on: z.boolean(),
  required: z.boolean(),
});
export type FormField = z.infer<typeof FormFieldObj>;

/** Email is the identity key: always present, always on, always required, never editable. */
export const FORM_EMAIL_FIELD: FormField = {
  key: 'email',
  label: 'Email',
  type: 'text',
  placeholder: 'you@example.org',
  on: true,
  required: true,
};

const NAME_FIELD: FormField = {
  key: 'full_name',
  label: 'Full name',
  type: 'text',
  placeholder: 'Jordan Blake',
  on: true,
  required: true,
};

/**
 * Standard optional fields every form can turn on without schema work. `normForm` appends any of
 * these that a form's own field list doesn't already define, all `on: false`.
 */
export const FORM_STANDARD_CATALOG: FormField[] = [
  { key: 'mobile', label: 'Mobile phone', type: 'text', placeholder: '(555) 000-0000', on: false, required: false },
  { key: 'street1', label: 'Street address', type: 'text', on: false, required: false },
  { key: 'city', label: 'City', type: 'text', on: false, required: false },
  { key: 'zip', label: 'ZIP code', type: 'text', on: false, required: false },
  // Checked box → a delivery request in the Deliveries pool (status 'new', staff approve).
  // Needs an address to point a driver at, so turn the address fields on alongside it.
  { key: 'yard_sign', label: 'I’d like a yard sign', type: 'checkbox', on: false, required: false },
];

/** Creation templates — all start from name + email, then add type-specific fields. */
export const FORM_TEMPLATES: Record<FormType, { submitLabel: string; description: string; fields: FormField[] }> = {
  signup: {
    submitLabel: 'Sign me up',
    description: 'Join the team — tell us how you can help and we’ll be in touch.',
    fields: [
      NAME_FIELD,
      FORM_EMAIL_FIELD,
      {
        key: 'mobile',
        label: 'Mobile phone',
        type: 'text',
        placeholder: '(555) 000-0000',
        help: 'Only used for shift reminders',
        on: true,
        required: false,
      },
      {
        key: 'availability',
        label: 'When can you help?',
        type: 'checks',
        options: ['Weekday evenings', 'Weekend canvasses', 'Phone banking', 'Event day'],
        on: true,
        required: false,
      },
      {
        key: 'notes',
        label: 'Anything we should know?',
        type: 'area',
        placeholder: 'Languages, accessibility, interests…',
        on: true,
        required: false,
      },
    ],
  },
  pledge: {
    submitLabel: 'Make my pledge',
    description: 'Pledge your support — every contribution helps.',
    fields: [
      NAME_FIELD,
      FORM_EMAIL_FIELD,
      { key: 'amount', label: 'Pledge amount', type: 'text', placeholder: 'E.g. 50', on: true, required: true },
    ],
  },
  rsvp: {
    submitLabel: 'Reserve my spot',
    description: 'Let us know you’re coming.',
    fields: [
      NAME_FIELD,
      FORM_EMAIL_FIELD,
      { key: 'seats', label: 'How many seats?', type: 'text', placeholder: 'E.g. 2', on: true, required: true },
    ],
  },
  request: {
    submitLabel: 'Send request',
    description: 'Tell us what you need and where.',
    fields: [
      NAME_FIELD,
      FORM_EMAIL_FIELD,
      { key: 'street1', label: 'Street address', type: 'text', on: true, required: true },
      { key: 'city', label: 'City', type: 'text', on: true, required: false },
      { key: 'zip', label: 'ZIP code', type: 'text', on: true, required: false },
      { key: 'notes', label: 'Notes', type: 'area', placeholder: 'How can we help?', on: true, required: false },
    ],
  },
  survey: {
    submitLabel: 'Submit',
    description: 'Your answers help shape our priorities.',
    fields: [
      NAME_FIELD,
      FORM_EMAIL_FIELD,
      {
        key: 'issues',
        label: 'Which issues matter most?',
        type: 'checks',
        options: ['Housing', 'Transit', 'Safety', 'Parks', 'Schools'],
        on: true,
        required: false,
      },
      {
        key: 'open',
        label: 'Anything else?',
        type: 'area',
        placeholder: 'Share your thoughts…',
        on: true,
        required: false,
      },
    ],
  },
};

/**
 * Coerces a form's stored `fields` JSON into a well-formed FormField[]: keeps only object-shaped
 * fields (silently drops legacy string[] entries from donation forms), guarantees the name + email
 * identity fields exist, enforces the email invariant (always on + required), and appends any
 * standard-catalog fields the form hasn't defined. This is the single source of truth both the API
 * and the editor use so the preview always matches what will be saved.
 */
export function normForm(rawFields: unknown): FormField[] {
  const source = Array.isArray(rawFields) ? rawFields : [];
  const fields: FormField[] = [];
  for (const raw of source) {
    const parsed = FormFieldObj.safeParse(raw);
    if (parsed.success) fields.push(parsed.data);
  }

  if (!fields.some((f) => f.key === NAME_FIELD.key)) {
    fields.unshift({ ...NAME_FIELD });
  }

  const emailIndex = fields.findIndex((f) => f.key === FORM_EMAIL_FIELD.key);
  if (emailIndex === -1) {
    // Slot email right after the name field.
    fields.splice(1, 0, { ...FORM_EMAIL_FIELD });
  } else {
    const current = fields[emailIndex];
    if (current) {
      fields[emailIndex] = { ...current, on: true, required: true };
    }
  }

  for (const catalog of FORM_STANDARD_CATALOG) {
    if (!fields.some((f) => f.key === catalog.key)) {
      fields.push({ ...catalog });
    }
  }

  return fields;
}

/**
 * Build the initial field list for a newly created form of the given template type.
 *
 * `campaignIssues` seeds the survey's issue checklist from the campaign's own issue list
 * (`campaigns.canvass_issues`, edited from Canvassing or Workspace → Campaigns) so a campaign
 * states its priorities once instead of re-typing them per surface. The template literal is the
 * fallback for a campaign that has not set any. Per-form options stay editable afterwards.
 */
export function fieldsForTemplate(type: FormType, campaignIssues?: readonly string[]): FormField[] {
  const issues = (campaignIssues ?? []).map((issue) => issue.trim()).filter(Boolean);

  return normForm(
    FORM_TEMPLATES[type].fields.map((f) => {
      if (f.key !== 'issues' || issues.length === 0) return { ...f };
      return { ...f, options: [...issues] };
    }),
  );
}

export const CreateFormObj = z.object({
  name: nameSchema('Form name', 100),
  type: FormTypeEnum,
  /** Campaigns §15 — the context this form collects consent for; backend defaults to the office. */
  campaign_id: idSchema.optional(),
});

/** Live-edit patch for the new Forms editor. Every field is optional (debounced partial saves). */
export const UpdateFormObj = z.object({
  name: nameSchema('Form name', 100).optional(),
  description: descriptionSchema(2000).optional(),
  redirect_url: redirectUrlSchema,
  submit_label: z.string().trim().max(60).optional(),
  thanks_title: z.string().trim().max(120).optional(),
  thanks_body: z.string().trim().max(2000).optional(),
  confirm_email_on: z.boolean().optional(),
  confirm_subject: z.string().trim().max(200).optional(),
  confirm_body: z.string().trim().max(5000).optional(),
  notify_team_on: z.boolean().optional(),
  fields: z.array(FormFieldObj).optional(),
  target_tags: z.array(z.string()).optional(),
  target_lists: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Public submission payload (unauthenticated POST /api/forms/submit/:slug).
//
// This body arrives from anyone on the internet, so it is bounded here rather than
// trusted: a field count ceiling, a key length ceiling and a per-answer length
// ceiling. Before this schema existed the body was typed `Record<string, string>`
// as a TypeScript generic only — no runtime shape at all — and the sole ceiling was
// the server's global 1 MiB body limit.
// ---------------------------------------------------------------------------

/** Most answers a single submission may carry. Comfortably above the largest template. */
export const FORM_SUBMISSION_MAX_FIELDS = 60;
/** Longest accepted answer key. Field keys are short identifiers. */
export const FORM_SUBMISSION_MAX_KEY_LENGTH = 64;
/** Longest accepted answer value. Roomy for a long-form textarea, far short of unbounded. */
export const FORM_SUBMISSION_MAX_VALUE_LENGTH = 2000;

/**
 * One answer. Scalars are coerced to a string so a JSON integration sending
 * `{"seats": 2}` still works, while objects and arrays are rejected outright —
 * every consumer downstream treats an answer as text.
 */
const FormSubmissionValueObj = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .transform((value) => (value == null ? '' : String(value)))
  .refine((value) => value.length <= FORM_SUBMISSION_MAX_VALUE_LENGTH, {
    message: `Each answer must be ${FORM_SUBMISSION_MAX_VALUE_LENGTH} characters or fewer.`,
  });

/** The whole submission body, bounded in both directions. */
export const FormSubmissionPayloadObj = z
  .record(z.string().trim().min(1).max(FORM_SUBMISSION_MAX_KEY_LENGTH), FormSubmissionValueObj)
  .refine((body) => Object.keys(body).length <= FORM_SUBMISSION_MAX_FIELDS, {
    message: `A submission cannot contain more than ${FORM_SUBMISSION_MAX_FIELDS} fields.`,
  });

export type FormSubmissionPayloadType = z.infer<typeof FormSubmissionPayloadObj>;

/** One row in the Responses tab. */
export const FormSubmissionObj = z.object({
  id: z.string(),
  person_id: z.string(),
  person_name: z.string().nullable(),
  answers: z.record(z.string(), z.unknown()),
  created_at: z.union([z.date(), z.string()]),
});
