import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/**
 * Titles and share cards for the public, unauthenticated pages (/f/:slug, /e/:slug, /v/:slug).
 *
 * These are the only surfaces a voter or donor ever sees, and they are shared on social far more
 * often than any other page in the product. Two problems this fixes:
 *
 * 1. **The tab title.** No route sets `title`, so `AppTitleStrategy` fell back to title-casing the
 *    first URL segment — a public form literally read "F — pplCRM", an event "E — pplCRM".
 * 2. **The share card.** Nothing touched `Meta`, so a form pasted into Facebook previewed as the
 *    generic pplCRM brand card from index.html rather than as the organization's own form.
 *
 * The org name is only known after the page fetches its config, so callers invoke this once their
 * data lands. Routes still carry a static fallback title for the pre-load frame.
 */
@Injectable({ providedIn: 'root' })
export class PublicPageMeta {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  /**
   * @param pageName the form/event name, e.g. "Volunteer sign-up"
   * @param orgName the tenant's public name, e.g. "Amira for Ward 7"
   * @param description optional blurb; falls back to a sentence built from the two names
   */
  public set(pageName: string, orgName: string, description?: string): void {
    const heading = pageName.trim() || orgName.trim();
    const org = orgName.trim();
    // "Volunteer sign-up · Amira for Ward 7" reads as the org's page, not as ours. pplCRM is
    // deliberately absent: to a voter this page belongs to the campaign, not to the vendor.
    const fullTitle = org && heading !== org ? `${heading} · ${org}` : heading;
    const blurb = description?.trim() || (org ? `${heading} — ${org}` : heading);

    this.title.setTitle(fullTitle);

    for (const [attr, name, content] of [
      ['name', 'description', blurb],
      ['property', 'og:title', fullTitle],
      ['property', 'og:description', blurb],
      ['property', 'og:site_name', org || 'pplCRM'],
      ['name', 'twitter:title', fullTitle],
      ['name', 'twitter:description', blurb],
    ] as const) {
      this.meta.updateTag({ [attr]: name, content }, `${attr}='${name}'`);
    }

    // The public page IS the destination for a shared link, so give scrapers the real URL rather
    // than the shell's deliberately-omitted one.
    if (typeof window !== 'undefined') {
      this.meta.updateTag({ property: 'og:url', content: window.location.href }, "property='og:url'");
    }
  }

  /** A page that resolved to nothing. Keeps the tab honest and keeps the miss out of indexes. */
  public setNotFound(kind: 'form' | 'event' | 'page'): void {
    this.title.setTitle(kind === 'page' ? 'Page not found' : `This ${kind} is not available`);
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' }, "name='robots'");
  }
}
