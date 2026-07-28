import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Marketing site root. Unlike the CRM (user-selectable theme) and the companion
 * (follows the phone), the public site is light-only — the theme is pinned once
 * on `<html data-theme="light">` in index.html so the dark navy bands always read
 * against a light page.
 *
 * This wrapper deliberately carries neither `data-theme` nor a background: DaisyUI
 * paints `base-100` onto every `[data-theme]` element, and an opaque surface here
 * would cover the home page's `.hero-canvas`, which sits at a negative z-index so
 * it can pass behind the sticky header. The page surface comes from `<body>`.
 */
@Component({
  selector: 'pc-website-root',
  imports: [RouterOutlet],
  template: `
    <div class="min-h-screen text-base-content">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class AppComponent {}
