import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicFormComponent } from './public-form';

/**
 * The public form page is the one place in the product that assigns an API-supplied string to
 * `window.location.href` — a raw navigation Angular's sanitizer never inspects. A `javascript:`
 * value arriving in the submit response would execute as script on the workspace's own public
 * form origin, so the component re-checks the value at the sink even though the server filters it
 * too. These specs pin that check.
 *
 * **How navigation is observed, and its one limit.** `window.location` cannot be replaced in the
 * jsdom this repo runs — `Object.defineProperty`, `vi.spyOn(window, 'location', 'get')` and
 * `vi.stubGlobal('location', …)` all throw `Cannot redefine property` — and `public-form.ts` has no
 * `redirectTo()` seam of the kind `billing-settings.ts` uses. What jsdom does perform for real is a
 * same-document fragment navigation, so the accept case redirects to a `#fragment` on the current
 * document and asserts `window.location.href` actually changed.
 *
 * The refuse case cannot be asserted that way, because jsdom never performs a `javascript:`
 * navigation either. It is asserted two ways instead: `window.location.href` is unchanged, and the
 * page lands on the thank-you state — which is the branch the component only reaches by refusing
 * the value, and which goes red if the check is removed.
 */

const FIELDS = [{ key: 'email', label: 'Email', type: 'text', on: true, required: true }];

const FORM_CONFIG = {
  status: 'open',
  orgName: 'Spec Org',
  form: {
    id: 'form-1',
    name: 'Join us',
    description: null,
    submit_label: 'Send',
    thanks_title: 'Thanks!',
    thanks_body: 'Your response has been recorded.',
    redirect_url: null,
    fields: FIELDS,
  },
};

function jsonResponse(body: unknown): unknown {
  return { ok: true, status: 200, json: (): Promise<unknown> => Promise.resolve(body) };
}

/** Lets every pending promise in the component's fetch chain settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PublicFormComponent — post-submit redirect', () => {
  let fixture: ComponentFixture<PublicFormComponent>;
  let component: any;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicFormComponent],
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (): string => 'join-us' } } } }],
    }).compileComponents();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Renders the page, fills in the one required field, and submits — with the submit response
   * carrying `redirectUrl`. Reports the page state the component settled on and the browser
   * address before and after, so a caller can assert on either.
   */
  async function submitWithRedirect(
    redirectUrl: unknown,
  ): Promise<{ state: string; hrefBefore: string; hrefAfter: string }> {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(FORM_CONFIG))
      .mockResolvedValueOnce(jsonResponse({ success: true, redirect_url: redirectUrl }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fixture = TestBed.createComponent(PublicFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // `ngOnInit` fires `void this.load()`, a bare promise chain the fixture does not track, so
    // `whenStable()` alone returns before the config has landed.
    await flushMicrotasks();
    fixture.detectChanges();

    // The config must have loaded, or the submit below would be a no-op and every assertion
    // downstream would pass for the wrong reason.
    expect(component.state()).toBe('open');

    component.setValue('email', 'visitor@example.com');
    const hrefBefore = window.location.href;
    await component.submit();

    // No branch here goes through the error path; if one did, "not thanks" would be meaningless.
    expect(component.submitError()).toBeNull();
    return { state: component.state(), hrefBefore, hrefAfter: window.location.href };
  }

  const REFUSED = [
    'javascript:alert(document.domain)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'https://accounts.example.org@evil.test/',
    'not a url at all',
  ];

  it.each(REFUSED)('does not navigate to %s — it shows the thank-you state instead', async (value) => {
    const res = await submitWithRedirect(value);

    expect(res.state).toBe('thanks');
    expect(res.hrefAfter).toBe(res.hrefBefore);
  });

  it('shows the thank-you state when there is no redirect at all', async () => {
    const res = await submitWithRedirect(null);

    expect(res.state).toBe('thanks');
    expect(res.hrefAfter).toBe(res.hrefBefore);
  });

  it('navigates when the value is an ordinary http URL', async () => {
    // jsdom refuses cross-document navigation, so a real destination could only ever be asserted
    // indirectly. A same-document fragment URL is the one navigation jsdom performs for real, and
    // it is an ordinary `http:` URL as far as the guard is concerned — so this asserts the browser
    // address actually changed, not merely that a branch was taken. The full set of schemes and
    // URL shapes the guard accepts is covered where the guard itself lives, in
    // libs/common/src/lib/schemas/web-forms.schema.spec.ts; both callers run the same function.
    const target = `${window.location.origin}${window.location.pathname}#redirected`;

    const res = await submitWithRedirect(target);

    expect(res.hrefAfter).toBe(target);
    expect(res.hrefAfter).not.toBe(res.hrefBefore);
    // The thank-you state is never reached: the component navigates and returns.
    expect(res.state).toBe('open');
  });
});
