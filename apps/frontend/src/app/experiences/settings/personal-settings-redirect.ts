import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Bridges the retired `/settings/:section` page to the avatar-menu dialog.
 *
 * Personal settings are a dialog, not a page — but notification emails link to
 * `/settings/notifications` and people have the URL bookmarked, so those links must keep
 * landing somewhere sensible. This sends them to the dashboard with `?settings=<section>`,
 * which the navbar picks up to open the dialog on the right tab.
 */
@Component({
  selector: 'pc-personal-settings-redirect',
  template: '',
})
export class PersonalSettingsRedirect {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  constructor() {
    const section = this.route.snapshot.paramMap.get('section');
    void this.router.navigate(['/dashboard'], {
      replaceUrl: true,
      queryParams: { settings: section ?? 'notifications' },
    });
  }
}
