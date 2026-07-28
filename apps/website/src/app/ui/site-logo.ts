import { Component } from '@angular/core';

/**
 * The pplCRM logo. Renders the real brand mark (`logo.png`), the same asset the
 * CRM ships in its sidebar and auth screens — kept as a single source of truth
 * and copied into the website build via the frontend-assets glob in project.json.
 */
@Component({
  selector: 'pc-site-logo',
  template: ` <img src="assets/logo.png" alt="pplCRM" class="h-7 w-auto select-none" /> `,
})
export class SiteLogo {}
