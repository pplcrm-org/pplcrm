import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AddWebFormObj,
  FORM_EMAIL_FIELD,
  FORM_STANDARD_CATALOG,
  FORM_TEMPLATES,
  FORM_TYPES,
  REDIRECT_URL_ALLOWED_PROTOCOLS,
  UpdateFormObj,
  UpdateWebFormObj,
  fieldsForTemplate,
  isSafeRedirectUrl,
  normForm,
  safeRedirectUrl,
  type FormField,
} from './web-forms.schema';

const CATALOG_KEYS = FORM_STANDARD_CATALOG.map((f) => f.key);

function field(overrides: Partial<FormField> & { key: string }): FormField {
  return { label: overrides.key, type: 'text', on: true, required: false, ...overrides };
}

describe('normForm', () => {
  describe('malformed input', () => {
    it.each([undefined, null, 'not-an-array', 42, {}])('coerces %s into name + email + catalog', (raw) => {
      const fields = normForm(raw);

      expect(fields[0]?.key).toBe('full_name');
      expect(fields[1]?.key).toBe('email');
      expect(fields.slice(2).map((f) => f.key)).toEqual(CATALOG_KEYS);
    });

    it('silently drops legacy string entries and non-conforming objects', () => {
      const fields = normForm([
        'first_name', // legacy donation-form string entry
        { key: 'no_flags', label: 'Missing on/required', type: 'text' }, // fails FormFieldObj
        { key: '', label: 'Empty key', type: 'text', on: true, required: false }, // min(1) violation
        field({ key: 'full_name', label: 'Full name' }),
        field({ key: 'email' }),
        field({ key: 'notes', type: 'area' }),
      ]);

      const keys = fields.map((f) => f.key);
      expect(keys).toEqual(['full_name', 'email', 'notes', ...CATALOG_KEYS]);
    });
  });

  describe('the email identity invariant', () => {
    it('forces an existing email field to on + required without moving it', () => {
      const fields = normForm([
        field({ key: 'full_name' }),
        field({ key: 'notes', type: 'area' }),
        field({ key: 'email', on: false, required: false, help: 'kept' }),
      ]);

      const emailIndex = fields.findIndex((f) => f.key === 'email');
      expect(emailIndex).toBe(2); // position preserved, not re-slotted
      expect(fields[emailIndex]).toMatchObject({ on: true, required: true, help: 'kept' });
    });

    it('splices a missing email field in right after the name field', () => {
      const fields = normForm([field({ key: 'full_name' }), field({ key: 'notes', type: 'area' })]);

      expect(fields[0]?.key).toBe('full_name');
      expect(fields[1]).toEqual(FORM_EMAIL_FIELD);
    });

    it('guarantees a name field at the front when the form lacks one', () => {
      const fields = normForm([field({ key: 'email' })]);

      expect(fields[0]?.key).toBe('full_name');
      expect(fields[0]?.on).toBe(true);
      expect(fields[1]?.key).toBe('email');
    });
  });

  describe('the standard catalog', () => {
    it('appends undefined catalog fields switched off', () => {
      const fields = normForm([field({ key: 'full_name' }), field({ key: 'email' })]);

      for (const key of CATALOG_KEYS) {
        const appended = fields.find((f) => f.key === key);
        expect(appended, key).toBeDefined();
        expect(appended?.on, key).toBe(false);
        expect(appended?.required, key).toBe(false);
      }
    });

    it("keeps a form's own definition of a catalog key instead of duplicating it", () => {
      const fields = normForm([
        field({ key: 'full_name' }),
        field({ key: 'email' }),
        field({ key: 'mobile', label: 'Cell', on: true, required: true }),
      ]);

      const mobiles = fields.filter((f) => f.key === 'mobile');
      expect(mobiles).toHaveLength(1);
      expect(mobiles[0]).toMatchObject({ label: 'Cell', on: true, required: true });
    });
  });
});

describe('fieldsForTemplate', () => {
  it.each(FORM_TYPES)('%s: upholds the email invariant and includes the full catalog', (type) => {
    const fields = fieldsForTemplate(type);

    const email = fields.find((f) => f.key === 'email');
    expect(email).toMatchObject({ on: true, required: true });
    expect(fields[0]?.key).toBe('full_name');
    for (const key of CATALOG_KEYS) {
      expect(
        fields.some((f) => f.key === key),
        key,
      ).toBe(true);
    }
  });

  it('never mutates FORM_TEMPLATES (fresh copies every call)', () => {
    const before = JSON.parse(JSON.stringify(FORM_TEMPLATES));

    for (const type of FORM_TYPES) {
      const fields = fieldsForTemplate(type);
      // mutate the returned copies aggressively
      for (const f of fields) {
        f.on = !f.on;
        f.label = 'clobbered';
      }
    }

    expect(FORM_TEMPLATES).toEqual(before);
  });

  it('returns independent arrays on successive calls', () => {
    const a = fieldsForTemplate('signup');
    const b = fieldsForTemplate('signup');

    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------------------------
// A form's post-submit redirect address.
//
// The value is handed straight to a browser as a navigation target: the public form page assigns
// it to `window.location.href`, and the public REST route puts it in a Location header. Anyone who
// can edit a form in a workspace can set it, so the set of schemes it may use is the whole
// security boundary. These specs pin both halves — what is refused, and what must keep working,
// because a redirect that is over-refused silently breaks a customer's thank-you page.
// ---------------------------------------------------------------------------------------------

describe('isSafeRedirectUrl / safeRedirectUrl', () => {
  it('allows exactly http and https', () => {
    expect([...REDIRECT_URL_ALLOWED_PROTOCOLS]).toEqual(['http:', 'https:']);
  });

  describe('refuses', () => {
    const REFUSED: Array<[string, unknown]> = [
      ['a javascript: scheme', 'javascript:alert(1)'],
      // `new URL()` lower-cases the scheme, so a case-sensitive comparison against the allow-list
      // would let this through while still executing as script.
      ['a mixed-case javascript: scheme', 'JavaScript:alert(1)'],
      ['an upper-case JAVASCRIPT: scheme', 'JAVASCRIPT:alert(1)'],
      ['a data: URL carrying markup', 'data:text/html,<script>alert(1)</script>'],
      ['a vbscript: scheme', 'vbscript:msgbox(1)'],
      ['a file: URL', 'file:///etc/passwd'],
      // The eye-catching part of this URL is the username, not evil.test, which is where it goes.
      ['a URL carrying a username', 'https://accounts.example.org@evil.test/'],
      ['a URL carrying a password', 'https://:hunter2@evil.test/'],
      ['a URL carrying both', 'https://accounts.example.org:hunter2@evil.test/'],
      ['a plain non-URL string', 'not a url at all'],
      ['a protocol-relative URL (no scheme to check)', '//evil.test/path'],
      ['a bare hostname', 'example.org/thanks'],
      ['an empty string', ''],
      ['whitespace only', '   \t\n  '],
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['an object', { href: 'https://example.org/thanks' }],
      ['an array', ['https://example.org/thanks']],
      ['a boolean', true],
    ];

    it.each(REFUSED)('%s', (_label, value) => {
      expect(isSafeRedirectUrl(value)).toBe(false);
      expect(safeRedirectUrl(value)).toBeNull();
    });
  });

  describe('accepts', () => {
    // [label, input, the exact string safeRedirectUrl must hand back]
    const ACCEPTED: Array<[string, string, string]> = [
      ['an ordinary https URL', 'https://example.org/thanks', 'https://example.org/thanks'],
      // Plain http stays allowed on purpose: the browser navigates here, the server never fetches
      // it, so a customer's own http-only thank-you page is a legitimate destination.
      ['an ordinary http URL', 'http://example.org/thanks', 'http://example.org/thanks'],
      ['a URL with an explicit port', 'https://example.org:8443/thanks', 'https://example.org:8443/thanks'],
      ['a URL with a path', 'https://example.org/a/b/c', 'https://example.org/a/b/c'],
      [
        'a URL with a query string',
        'https://example.org/thanks?ref=form&id=7',
        'https://example.org/thanks?ref=form&id=7',
      ],
      ['a URL with a fragment', 'https://example.org/thanks#top', 'https://example.org/thanks#top'],
      [
        'a URL with a port, path, query and fragment together',
        'https://example.org:8443/a/b?ref=form#top',
        'https://example.org:8443/a/b?ref=form#top',
      ],
      // Cross-origin is the point of the field, not an attack.
      ['a cross-origin URL', 'https://someone-elses-site.example/', 'https://someone-elses-site.example/'],
      ['leading and trailing whitespace (trimmed)', '  https://example.org/thanks \n', 'https://example.org/thanks'],
    ];

    it.each(ACCEPTED)('%s', (_label, value, expected) => {
      expect(isSafeRedirectUrl(value)).toBe(true);
      expect(safeRedirectUrl(value)).toBe(expected);
    });
  });
});

describe('redirect_url on the form schemas', () => {
  // The three payload shapes that carry a redirect address: AddWebFormObj (legacy create),
  // UpdateWebFormObj (legacy update) and UpdateFormObj (the live-edit patch). `base` is the
  // minimum each schema needs before redirect_url is even reached.
  const SCHEMAS: Array<[string, z.ZodType, Record<string, unknown>]> = [
    ['AddWebFormObj', AddWebFormObj, { name: 'Signup form' }],
    ['UpdateWebFormObj', UpdateWebFormObj, {}],
    ['UpdateFormObj', UpdateFormObj, {}],
  ];

  const UNSAFE = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'https://accounts.example.org@evil.test/',
  ];

  describe.each(SCHEMAS)('%s', (_name, schema, base) => {
    it.each(UNSAFE)('rejects %s', (value) => {
      expect(schema.safeParse({ ...base, redirect_url: value }).success).toBe(false);
    });

    it('accepts an ordinary https URL', () => {
      expect(schema.safeParse({ ...base, redirect_url: 'https://example.org/thanks' }).success).toBe(true);
    });

    it('accepts an ordinary http URL', () => {
      expect(schema.safeParse({ ...base, redirect_url: 'http://example.org/thanks' }).success).toBe(true);
    });

    // "No redirect" has three spellings in this codebase and all three predate the scheme check.
    // A form without a redirect is the common case; breaking any of these breaks every such form.
    it('still accepts an empty string as "no redirect"', () => {
      expect(schema.safeParse({ ...base, redirect_url: '' }).success).toBe(true);
    });

    it('still accepts null as "no redirect"', () => {
      expect(schema.safeParse({ ...base, redirect_url: null }).success).toBe(true);
    });

    it('still accepts the field being omitted entirely', () => {
      expect(schema.safeParse({ ...base }).success).toBe(true);
    });
  });

  it('trims the accepted value it hands back', () => {
    const parsed = AddWebFormObj.safeParse({ name: 'Signup form', redirect_url: '  https://example.org/thanks  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.redirect_url).toBe('https://example.org/thanks');
  });
});
