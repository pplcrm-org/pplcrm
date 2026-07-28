import { Component } from '@angular/core';
import { PcTabOption, TabBar } from '@uxcommon/components/tabs/tabs';

/**
 * Surface switcher for the two halves of the shared vocabulary (spec §9.1): tags
 * (`/tags`) and issues (`/issues`). Rendered in the header of both admin pages so the
 * sidebar needs only one "Tags & issues" entry and each list is always one click from
 * the other. Uses the house tab bar's `underline` variant — the same look as the People
 * grain tabs — because this pair switches surfaces; the active state is driven purely by
 * the router (no JS state). The sidebar entry stays lit on both routes via its
 * `alsoActiveFor` list (`sidebar-items.ts`).
 */
@Component({
  selector: 'pc-tags-issues-nav',
  imports: [TabBar],
  template: `<pc-tab-bar [tabs]="tabs" variant="underline" label="Tags and issues" />`,
})
export class TagsIssuesNav {
  protected readonly tabs: PcTabOption[] = [
    { id: 'tags', label: 'Tags', route: '/tags', exact: true },
    { id: 'issues', label: 'Issues', route: '/issues', exact: true },
  ];
}
