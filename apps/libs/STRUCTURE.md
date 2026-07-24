This file is a merged representation of a subset of the codebase, containing specifically included files and files not matching ignore patterns, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: libs/**/*, apps/**/*, scriptis/**/*, libs/common/src/**/*, libs/uxcommon/src/**/*
- Files matching these patterns are excluded: **/*.test.ts, **/*.spec.ts, **/dist/**, **/build/**, **/node_modules/**, **/.git/**, **/package-lock.json, **/yarn.lock, **/*.picture, **/*.png, **/*.jpg, **/*.jpeg, **/*.svg, **/*.ico, apps/**, **/STRUCTURE.md, **/*.spec.ts
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
````
libs/
  common/
    src/
      lib/
        billing/
          currency.ts
          plans.ts
        help/
          articles/
            administration.ts
            contacts.ts
            data-management.ts
            engagement.ts
            getting-started.ts
            grids.ts
            outreach.ts
            productivity.ts
            segmentation.ts
          help-content.ts
          help-links.ts
          help-markdown.ts
          help-search.ts
          help-types.ts
        schemas/
          activity.schema.ts
          auth.schema.ts
          bug-reports.schema.ts
          campaigns.schema.ts
          canvassing.schema.ts
          companies.schema.ts
          companion-access.schema.ts
          connections.schema.ts
          content-check.schema.ts
          core.schema.ts
          deliveries.schema.ts
          donations.schema.ts
          emails.schema.ts
          events.schema.ts
          lists.schema.ts
          marketing.schema.ts
          newsletter-templates.schema.ts
          persons.schema.ts
          settings.schema.ts
          tags.schema.ts
          tasks.schema.ts
          teams.schema.ts
          volunteer.schema.ts
          web-forms.schema.ts
          workflows.schema.ts
        auth.ts
        emails.ts
        jsend.ts
        kysely.models.ts
        models.ts
        preflight-lint.ts
        public-id.ts
        schema.ts
        sla.ts
        utils.ts
      index.ts
    eslint.config.cjs
    project.json
    tsconfig.json
    tsconfig.lib.json
    vite.config.ts
  uxcommon/
    src/
      components/
        address-autocomplete/
          address-autocomplete.ts
          googlePlacesAddressMapper.ts
        address-form-group/
          address-form-group.ts
        alerts/
          alert-service.ts
          alerts.html
          alerts.ts
        autocomplete/
          autocomplete.ts
        breadcrumbs/
          breadcrumbs.service.ts
          breadcrumbs.ts
        card/
          card.ts
        csv-import/
          csv.worker.ts
          persons-field-mapping.ts
        detail-header/
          detail-header.ts
        detail-item/
          detail-item.ts
        detail-layout/
          detail-layout.ts
        detail-row/
          detail-row.ts
        empty-state/
          empty-state.ts
        entity-overview/
          entity-overview.ts
        fields-selector/
          fields-selector.html
          fields-selector.ts
        form-actions/
          form-actions.html
          form-actions.ts
        geocode-chip/
          geocode-chip.ts
        grid-header/
          grid-header.ts
        icons/
          attachment-icon.ts
          icon.ts
          icons.index.ts
        input/
          input.ts
        map/
          map-types.ts
          map.ts
        modal-shell/
          modal-shell.ts
        not-found/
          not-found.ts
        profile-card/
          profile-card.ts
        public-link-panel/
          public-link-panel.html
          public-link-panel.ts
        row-actions/
          row-actions.ts
        select/
          select.ts
        side-drawer/
          side-drawer.ts
        stat-card/
          stat-card.ts
        status-badge/
          status-badge.ts
        swap/
          swap.ts
        system-metadata/
          system-metadata.ts
        table/
          table.ts
        tabs/
          tabs.ts
        tags/
          tagitem.css
          tagitem.ts
        textarea/
          textarea.ts
        toggle/
          toggle.ts
        user-avatar/
          user-avatar.ts
        confirm-dialog-host.html
        confirm-dialog-host.ts
        confirm-dialog.service.ts
      directives/
        animate-if.directive.ts
        spin-on-click.directive.ts
      mentions/
        mention-controller.ts
      pipes/
        file-icon.pipe.ts
        file-icon.util.ts
        filesize.pipe.ts
        mention.pipe.ts
        sanitize-html.pipe.ts
        svg-html-pipe.ts
        timeago.pipe.ts
      styles/
        themes.css
      index.ts
      loading-gate.ts
      request-guard.ts
      test-setup.ts
    eslint.config.cjs
    project.json
    README.md
    tsconfig.json
    tsconfig.lib.json
    tsconfig.spec.json
    vite.config.mts
````

# Files

## File: libs/common/src/lib/help/articles/data-management.ts
````typescript
import type { HelpArticle } from '../help-types';

export const DATA_ARTICLES: HelpArticle[] = [
  {
    id: 'import',
    category: 'data',
    title: 'Import from CSV',
    summary:
      'One guided wizard imports people, companies, households, or tasks from a spreadsheet in four steps. Matched, tagged, and deduplicated.',
    keywords: [
      'import',
      'csv',
      'spreadsheet',
      'upload data',
      'migrate',
      'bulk add',
      'excel',
      'wizard',
      'companies',
      'households',
      'tasks',
    ],
    related: ['duplicates', 'export', 'tags-issues', 'add-people'],
    blocks: [
      {
        kind: 'p',
        text: '**Import / export** in the DATA section of the sidebar is history for both directions. To start an import, use **Import CSV** at the top of that page, or **Import CSV** in the People, Companies, Households, or Tasks toolbars. Either opens the wizard at [/imports/new](/imports/new): Upload → Map columns → Review → Import. The upload step asks **what you are importing** (people, companies, households, or tasks); coming from a grid preselects its type. Nothing is written to your database until the last step.',
      },
      { kind: 'h2', id: 'prepare', text: 'Prepare the file' },
      {
        kind: 'list',
        items: [
          'Use a CSV with a header row. Column names like “First name”, “Email”, “Phone”, “Company”, or “Tags” are preselected automatically on the mapping step.',
          'For people: a **Company** column links each person to a company, creating the company if no existing one matches its name. Addresses do the same for households. A **Tags** column applies its comma-separated tags to just that person.',
          'For companies and tasks the wizard needs a mapped **name** column. Rows without one are skipped. For households, rows matching an address you already have (or repeated in the file) are skipped, and new addresses are queued for geocoding.',
          'Both UTF-8 and Excel-exported CSVs work as-is.',
        ],
      },
      { kind: 'h2', id: 'steps', text: 'The four steps' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Upload',
            detail: 'Drop the file or browse to it. You’ll see the row and column counts before anything else happens.',
          },
          {
            title: 'Map columns',
            detail:
              'Each column gets a best-guess field match. Review and correct it. Anything left unmapped shows a “Skipped” chip and is left out.',
          },
          {
            title: 'Review',
            detail:
              'For people, duplicates are matched by email, the same identity rule used everywhere in pplCRM. Rows that match an existing person let you **merge** (fills blank fields, never overwrites), **skip**, or **import as new anyway**. Rows with a broken email address get their own choice: skip them or import without an email. Add a comma-separated tag list and/or a list here too (tags also apply to household imports). Other types show a plain recap: how many rows will import and how many will be skipped, and why.',
          },
          {
            title: 'Import',
            detail:
              'Confirm the recap and click **Import N people** (or companies, households, tasks). The import runs in the background, so you can navigate away while it works. It lands in import history and the Activity log either way. If you stay, the done screen offers **View imported records**, **Import another file**, or **Back to import history**.',
          },
        ],
      },
      { kind: 'h2', id: 'after', text: 'After the import' },
      {
        kind: 'list',
        items: [
          'Spot-check a few records against the source file.',
          'If you chose "import as new anyway" for any matched duplicates, run the [Duplicates](/duplicates) finder to reconcile them when convenient.',
          'The import history row shows what type each import was and keeps the original file downloadable for 90 days; for people imports, skipped rows are downloadable with the reason each was skipped.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Test with a small file first',
        text: 'Run a ten-row slice through the wizard before the full file. If the column mapping is off you fix ten records, not ten thousand.',
      },
    ],
  },
  {
    id: 'export',
    category: 'data',
    title: 'Export your data',
    summary: 'Download any grid (or just your selection) as CSV, and collect finished exports from one page.',
    keywords: ['export', 'csv', 'download', 'backup', 'report', 'extract', 'spreadsheet'],
    related: ['import', 'bulk-actions', 'filters'],
    blocks: [
      {
        kind: 'p',
        text: 'Your data is yours. Every grid has **Export CSV** in its toolbar, and the file reflects the grid as you see it, filters applied. For a subset, select rows first and use **Export** in the bulk action bar: exactly those rows, nothing more.',
      },
      { kind: 'h2', id: 'exports-page', text: 'The Exports tab' },
      {
        kind: 'p',
        text: 'Large exports are prepared in the background. **Import / export** in the sidebar has an **Exports** tab listing every export with its status and a download link when ready. The export-ready notification tells you the moment it is done, so there is no need to wait around. Files stay downloadable for 30 days, and every export lands in the Activity log. Clicking **New export** there is a signpost, not a wizard: it points you back to the People grid or Donations, because that’s where the filters live.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Filter first, export second',
        text: 'Need “donors in Springfield since January”? Build the filter in the grid, confirm the match count, then export. The CSV is your report, no spreadsheet surgery required. See [Filters and the query builder](/help/filters).',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Exports leave the safety of the app',
        text: 'A CSV on a laptop has none of the CRM’s access controls. Share exports deliberately and delete stale copies.',
      },
    ],
  },
  {
    id: 'duplicates',
    category: 'data',
    title: 'Find and merge duplicates',
    summary:
      'Review likely duplicate people, households, and companies side by side, and merge each pair in one confirmed click.',
    keywords: ['duplicate', 'merge', 'dedupe', 'clean up', 'data quality', 'double entry'],
    related: ['import', 'bulk-actions', 'households', 'companies'],
    blocks: [
      {
        kind: 'p',
        text: 'Duplicates creep in through imports, forms, and honest retyping. They split a person’s history across two half-records. A nightly sweep hunts them down across people, households, and companies (imports catch most on the way in; this queue is for what slips through), and the [Duplicates](/duplicates) page is where you review what it found.',
      },
      { kind: 'h2', id: 'review', text: 'Review and merge' },
      {
        kind: 'steps',
        items: [
          { title: 'Open [Duplicates](/duplicates)', detail: 'Choose people, households, or companies.' },
          {
            title: 'Read the confidence and the why-flagged reason',
            detail:
              'Each pair is labeled High confidence or Possible match, with a sentence naming what matched (same email, same name at the same address, and so on) and a side-by-side comparison of the fields that differ.',
          },
          {
            title: 'Merge into one, or Not duplicates',
            detail:
              'Merging fills blanks on the record you keep from the one you remove (it never overwrites a value that is already there), and you confirm before anything happens. Genuinely two different people? Choose Not duplicates and the sweep will not flag that pair again.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Merges are permanent',
        text: 'The duplicate record is removed for good. The confirmation names both records so you know exactly what is merging into what. When unsure, open both profiles first.',
      },
      {
        kind: 'p',
        text: 'Caught a pair in a grid instead? Select exactly two rows and use **Merge** in the bulk action bar. Same result, no trip to the finder. See [Selection, bulk actions, and merging](/help/bulk-actions).',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Make it a habit',
        text: 'A five-minute duplicates pass after every import keeps the database trustworthy, far cheaper than a heroic annual cleanup.',
      },
    ],
  },
];
````

## File: libs/common/src/lib/help/articles/segmentation.ts
````typescript
import type { HelpArticle } from '../help-types';

export const SEGMENTATION_ARTICLES: HelpArticle[] = [
  {
    id: 'tags-issues',
    category: 'segmentation',
    title: 'Tags and issues',
    summary:
      'Tags describe who people are; issues capture what they care about. Both filter every grid and target every newsletter.',
    keywords: ['tag', 'label', 'issue', 'interest', 'categorize', 'organize', 'bulk tag', 'remove tag'],
    related: ['lists', 'filters', 'bulk-actions', 'newsletters'],
    blocks: [
      {
        kind: 'p',
        text: 'Tags are free-form labels (**community-leader**, **major-donor**, **lawn-sign**) that describe a record. Issues work the same way but capture policy interests: what a supporter cares about, not what they are. Keeping the two apart keeps both useful. (Volunteer and staff are not tags. They are first-class status fields on the person; set them from the person’s standing card.)',
      },
      { kind: 'h2', id: 'apply', text: 'Apply tags' },
      {
        kind: 'list',
        items: [
          'On a profile: add or remove tags directly on the record.',
          'In bulk: select rows in a grid and use **Add tag** to label hundreds at once; see [Selection, bulk actions, and merging](/help/bulk-actions).',
          'On import: tag an incoming CSV so you can always find that cohort again; see [Import data from CSV](/help/import).',
        ],
      },
      { kind: 'h2', id: 'use', text: 'Put them to work' },
      {
        kind: 'p',
        text: 'Every grid has a tag filter and an issue filter. Check several and they combine with OR (match any), landing as one removable chip. Newsletters target audiences by including and excluding tags, so disciplined tagging pays off directly in [Create and send a newsletter](/help/newsletters).',
      },
      { kind: 'h2', id: 'manage', text: 'Manage the vocabulary (administrators)' },
      {
        kind: 'p',
        text: 'Administrators curate the shared vocabulary under [Tags](/tags) and [Issues](/issues) in the Data section. Both pages open with a sentence naming the whole vocabulary: how many tags/issues exist, how many applications, and (on Tags) how many have not been used in 90 days.',
      },
      {
        kind: 'list',
        items: [
          '**Rename** updates the label everywhere it is referenced: on people, in saved lists, and on forms. One rename, one pass.',
          '**Merge into another tag/issue** ("Move everyone to…") folds a duplicate label into the one you pick; everyone carrying the old label ends up carrying the new one, and the old label is deleted.',
          '**Delete**: the confirmation names how many applications would be affected, so you never delete a label blind.',
          'The PEOPLE / PEOPLE INTERESTED count on each row is a door. Click it to open the People grid pre-filtered to that exact tag or issue.',
        ],
      },
      {
        kind: 'p',
        text: 'The [Issues](/issues) page additionally ranks by interest with a trend (new applications in the last 30 days) and a top ward, since issues exist to tell the policy team what people care about, not to describe who someone is, which is what tags are for.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'A tag taxonomy that stays useful',
        text: 'Prefer a handful of well-known tags over dozens of near-synonyms. If donor, Donors, and dnr-2024 all exist, filters and audiences quietly miss people. Merge the stragglers into one instead of deleting and re-tagging.',
      },
    ],
  },
  {
    id: 'lists',
    category: 'segmentation',
    title: 'Smart and static lists',
    summary:
      'Lists are reusable audiences: smart lists that refresh themselves from a rule, or static snapshots you curate by hand.',
    keywords: [
      'list',
      'audience',
      'segment',
      'static list',
      'smart list',
      'dynamic list',
      'snapshot',
      'membership',
      'rule',
      'query',
    ],
    related: ['tags-issues', 'filters', 'newsletters'],
    blocks: [
      {
        kind: 'p',
        text: 'A list is a saved group of people or households you can reuse anywhere: as a grid filter, a newsletter audience, a canvassing universe, or a form’s follow-up. Lists come in two types, and choosing the right one saves hours later.',
      },
      { kind: 'h2', id: 'smart', text: 'Smart lists: a rule that refreshes itself' },
      {
        kind: 'p',
        text: 'A smart list is defined by rules in the query builder: “everyone tagged lawn-sign in Springfield”. Membership updates itself automatically as people and households change: new matches join, non-matches drop out. Nobody maintains it, and it is never stale. Its count keeps changing on its own.',
      },
      { kind: 'h2', id: 'static', text: 'Static lists: a snapshot you control' },
      {
        kind: 'p',
        text: 'A static list runs its rules once, at creation, and saves the result as a fixed snapshot. Today’s matches become the members and stay put. New matching people are not added later; membership changes only when you edit it by hand. Use one for a curated invite list, a board roster, or the attendees of a specific event.',
      },
      { kind: 'h2', id: 'create', text: 'Create a list' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Lists](/lists) and click +',
            detail: 'Name the list something your teammates will recognize in a dropdown.',
          },
          {
            title: 'Pick Smart or Static',
            detail:
              'Ask: should this group maintain itself? If yes, choose Smart; if it should stay frozen, choose Static.',
          },
          {
            title: 'Choose People or Households',
            detail: 'A list targets one or the other. Pick what you are grouping.',
          },
          {
            title: 'Build the rule',
            detail:
              'Compose conditions in the query builder: match all or any, with nested groups. The live preview does the math in public: “Matches 1,284 people right now”, with a note reminding you whether that count will keep moving (Smart) or freeze on save (Static).',
          },
          {
            title: 'Create it',
            detail:
              'The button carries the scale it will act on: “Create smart list (1,284 now)” or “Create static list (snapshot 1,284)”.',
          },
        ],
      },
      { kind: 'h2', id: 'table', text: 'Read the Lists table' },
      {
        kind: 'list',
        items: [
          '**List**: the name is a door. Click it to open People or Households with that list applied as a removable filter chip.',
          '**Type**: a Smart or Static chip.',
          '**Of**: People or Households.',
          '**Definition**: the rule written as a plain sentence.',
          '**Members**: how many records are in the list right now.',
          '**Last used in**: the most recent newsletter, form, or turf that used this list.',
          '**Updated**: when the list last changed.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Deleting a list names what it will affect',
        text: 'If a list is in use, the delete confirmation names its consumers (the newsletters, forms, and turfs that reference it), so you never break an audience by surprise. The people and households themselves are never touched; only the list is removed.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Lists are how good newsletters start',
        text: 'A newsletter audience built on a smart list is accurate on send day by definition. See [Create and send a newsletter](/help/newsletters).',
      },
    ],
  },
];
````

## File: libs/common/src/lib/help/help-content.ts
````typescript
import { ADMIN_ARTICLES } from './articles/administration';
import { CONTACTS_ARTICLES } from './articles/contacts';
import { DATA_ARTICLES } from './articles/data-management';
import { ENGAGEMENT_ARTICLES } from './articles/engagement';
import { GETTING_STARTED_ARTICLES } from './articles/getting-started';
import { GRIDS_ARTICLES } from './articles/grids';
import { OUTREACH_ARTICLES } from './articles/outreach';
import { PRODUCTIVITY_ARTICLES } from './articles/productivity';
import { SEGMENTATION_ARTICLES } from './articles/segmentation';

import type { HelpArticle, HelpCategory, HelpCategoryId } from './help-types';

/** Display order of the help center's categories. */
export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting started',
    blurb: 'Your first session: the tour, navigation habits, search, and shortcuts.',
    icon: 'map',
  },
  {
    id: 'contacts',
    label: 'People & relationships',
    blurb: 'People, households, companies, and teams: the heart of the CRM.',
    icon: 'identification',
  },
  {
    id: 'grids',
    label: 'Grids & data entry',
    blurb: 'One grid everywhere: filters, inline editing, selection, and bulk work.',
    icon: 'table-cells',
  },
  {
    id: 'segmentation',
    label: 'Tags, issues & lists',
    blurb: 'Describe people, capture what they care about, and build reusable audiences.',
    icon: 'label',
  },
  {
    id: 'outreach',
    label: 'Newsletters & email',
    blurb: 'Campaigns, the shared inbox, and automations that follow through for you.',
    icon: 'megaphone',
  },
  {
    id: 'engagement',
    label: 'Donations, events & forms',
    blurb: 'Raise money, run events and shifts, and collect signups from the web.',
    icon: 'currency-dollar',
  },
  {
    id: 'productivity',
    label: 'Tasks & files',
    blurb: 'Track the work on a board and keep shared documents one search away.',
    icon: 'task',
  },
  {
    id: 'data',
    label: 'Import, export & data quality',
    blurb: 'Move data in and out by CSV and keep the database free of duplicates.',
    icon: 'arrow-up-tray',
  },
  {
    id: 'admin',
    label: 'Account & administration',
    blurb: 'Profiles, roles and access, workspace configuration, and the audit trail.',
    icon: 'cog-6-tooth',
  },
];

/** Every article, in category display order. */
export const HELP_ARTICLES: HelpArticle[] = [
  ...GETTING_STARTED_ARTICLES,
  ...CONTACTS_ARTICLES,
  ...GRIDS_ARTICLES,
  ...SEGMENTATION_ARTICLES,
  ...OUTREACH_ARTICLES,
  ...ENGAGEMENT_ARTICLES,
  ...PRODUCTIVITY_ARTICLES,
  ...DATA_ARTICLES,
  ...ADMIN_ARTICLES,
];

/** Shown as quick links under the search box on the help home page. */
export const POPULAR_ARTICLE_IDS: string[] = [
  'welcome',
  'grid-basics',
  'filters',
  'newsletters',
  'import',
  'shortcuts',
];

const ARTICLES_BY_ID: ReadonlyMap<string, HelpArticle> = new Map(HELP_ARTICLES.map((a) => [a.id, a]));
const CATEGORIES_BY_ID: ReadonlyMap<HelpCategoryId, HelpCategory> = new Map(HELP_CATEGORIES.map((c) => [c.id, c]));

export function getHelpArticle(id: string): HelpArticle | undefined {
  return ARTICLES_BY_ID.get(id);
}

export function getHelpCategory(id: HelpCategoryId): HelpCategory | undefined {
  return CATEGORIES_BY_ID.get(id);
}

export function articlesInCategory(id: HelpCategoryId): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === id);
}

/**
 * Related reading for an article: its hand-picked `related` ids first,
 * topped up with neighbors from the same category, capped at `limit`.
 */
export function relatedArticles(article: HelpArticle, limit = 3): HelpArticle[] {
  const picked: HelpArticle[] = [];
  const seen = new Set<string>([article.id]);

  for (const id of article.related ?? []) {
    const found = ARTICLES_BY_ID.get(id);
    if (found && !seen.has(found.id)) {
      picked.push(found);
      seen.add(found.id);
    }
  }
  for (const neighbor of articlesInCategory(article.category)) {
    if (picked.length >= limit) break;
    if (!seen.has(neighbor.id)) {
      picked.push(neighbor);
      seen.add(neighbor.id);
    }
  }
  return picked.slice(0, limit);
}

/** Previous/next article within the same category, in display order. */
export function categoryNeighbors(article: HelpArticle): { next?: HelpArticle; prev?: HelpArticle } {
  const siblings = articlesInCategory(article.category);
  const index = siblings.findIndex((a) => a.id === article.id);
  if (index === -1) return {};
  return {
    prev: index > 0 ? siblings[index - 1] : undefined,
    next: index < siblings.length - 1 ? siblings[index + 1] : undefined,
  };
}
````

## File: libs/common/src/lib/help/help-links.ts
````typescript
/**
 * Route classification shared by both apps' rich-text renderers.
 *
 * `parseHelpInline` only emits links whose target starts with `/`, so every
 * route reaching `classifyHelpRoute` is an internal one. This splits those
 * into in-help article links versus any other in-app route, letting each app
 * route them through its own navigation (in-help router vs. cross-app link).
 */

export type HelpRouteTarget =
  | { kind: 'help'; id: string } // an in-help article link, e.g. /help/dashboard -> id 'dashboard'
  | { kind: 'app'; path: string }; // any other internal app route, e.g. /people

const HELP_ROUTE = /^\/help\/(.+)$/;

/**
 * Classifies an internal route (always starting with `/`): `/help/:id` links
 * become `{ kind: 'help', id }`, everything else `{ kind: 'app', path }`.
 */
export function classifyHelpRoute(route: string): HelpRouteTarget {
  const id = HELP_ROUTE.exec(route)?.[1];
  if (id !== undefined) {
    return { kind: 'help', id };
  }
  return { kind: 'app', path: route };
}
````

## File: libs/common/src/lib/help/help-markdown.ts
````typescript
import type { HelpArticle, HelpBlock } from './help-types';

/**
 * GitHub-flavored Markdown serialization of the typed help content, for the
 * website's AI-agent surface. Unlike `blockToPlainText`, the inline mini-markup
 * (`**bold**`, `` `code` ``, `[label](/route)`) is preserved verbatim — agents
 * benefit from the links and emphasis, so nothing is stripped.
 */

const KEYS_TABLE_HEADER = ['| Keys | Action |', '| --- | --- |'];

/** One content block as a Markdown fragment. */
export function blockToMarkdown(block: HelpBlock): string {
  switch (block.kind) {
    case 'p':
      return block.text;
    case 'h2':
      return `## ${block.text}`;
    case 'list':
      return block.items.map((item, index) => (block.ordered ? `${index + 1}. ${item}` : `- ${item}`)).join('\n');
    case 'steps':
      return block.items
        .map((step, index) => `${index + 1}. **${step.title}**${step.detail ? ` — ${step.detail}` : ''}`)
        .join('\n');
    case 'callout':
      return `> **${block.title}** — ${block.text}`;
    case 'keys':
      return [
        ...KEYS_TABLE_HEADER,
        ...block.rows.map((row) => `| ${row.keys.map((key) => `\`${key}\``).join(' ')} | ${row.action} |`),
      ].join('\n');
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

/** A whole article as Markdown: `# title`, the summary intro, then each block. */
export function articleToMarkdown(article: HelpArticle): string {
  return [`# ${article.title}`, article.summary, ...article.blocks.map(blockToMarkdown)].join('\n\n');
}
````

## File: libs/common/src/lib/help/help-search.ts
````typescript
import { getHelpCategory, HELP_ARTICLES } from './help-content';
import { articleToPlainText } from './help-types';

import type { HelpArticle } from './help-types';

/**
 * Client-side search over the static help content. The corpus is ~30
 * articles, so a straightforward scored scan is instant and dependency-free.
 */

/** A run of text, flagged when it matched a search term (for highlighting). */
export interface HelpHighlightSegment {
  hit: boolean;
  text: string;
}

export interface HelpSearchResult {
  article: HelpArticle;
  score: number;
  /** Summary or body excerpt around the first match, ready to highlight. */
  snippet: HelpHighlightSegment[];
  title: HelpHighlightSegment[];
}

const SCORE_TITLE = 40;
const SCORE_TITLE_WORD_START = 10;
const SCORE_KEYWORD = 25;
const SCORE_SUMMARY = 15;
const SCORE_CATEGORY = 10;
const SCORE_BODY = 8;
const SCORE_PHRASE_IN_TITLE = 30;
const SNIPPET_RADIUS = 90;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function termsOf(query: string): string[] {
  return normalize(query).split(' ').filter(Boolean);
}

/** Does `haystack` contain `term` starting at a word boundary? */
function hasWordStart(haystack: string, term: string): boolean {
  const at = haystack.indexOf(term);
  if (at === -1) return false;
  if (at === 0) return true;
  return !/[a-z0-9]/.test(haystack.charAt(at - 1));
}

/** Splits `text` into plain/hit segments for every occurrence of any term. */
export function highlightTerms(text: string, terms: string[]): HelpHighlightSegment[] {
  if (terms.length === 0 || text.length === 0) return [{ hit: false, text }];

  const lower = text.toLowerCase();
  const segments: HelpHighlightSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let hitStart = -1;
    let hitLength = 0;
    for (const term of terms) {
      const at = lower.indexOf(term, cursor);
      if (at !== -1 && (hitStart === -1 || at < hitStart || (at === hitStart && term.length > hitLength))) {
        hitStart = at;
        hitLength = term.length;
      }
    }
    if (hitStart === -1) {
      segments.push({ hit: false, text: text.slice(cursor) });
      break;
    }
    if (hitStart > cursor) {
      segments.push({ hit: false, text: text.slice(cursor, hitStart) });
    }
    segments.push({ hit: true, text: text.slice(hitStart, hitStart + hitLength) });
    cursor = hitStart + hitLength;
  }
  return segments;
}

/** A short window of `text` around the first occurrence of any term. */
function excerptAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  if (first === -1) return text.slice(0, SNIPPET_RADIUS * 2);

  let start = Math.max(0, first - SNIPPET_RADIUS);
  let end = Math.min(text.length, first + SNIPPET_RADIUS);
  // Snap to word boundaries so the excerpt doesn't shear words in half.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < first) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > first) end = space;
  }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/**
 * Ranked search: every term must match somewhere in an article (title,
 * keywords, summary, category label, or body) for it to be a result.
 */
export function searchHelp(query: string, articles: HelpArticle[] = HELP_ARTICLES): HelpSearchResult[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const phrase = normalize(query);

  const results: HelpSearchResult[] = [];

  for (const article of articles) {
    const title = normalize(article.title);
    const summary = normalize(article.summary);
    const keywords = article.keywords.map(normalize);
    const category = normalize(getHelpCategory(article.category)?.label ?? '');
    const body = normalize(articleToPlainText(article));

    let score = 0;
    let everyTermMatched = true;

    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) {
        termScore = SCORE_TITLE + (hasWordStart(title, term) ? SCORE_TITLE_WORD_START : 0);
      } else if (keywords.some((k) => k.includes(term))) {
        termScore = SCORE_KEYWORD;
      } else if (summary.includes(term)) {
        termScore = SCORE_SUMMARY;
      } else if (category.includes(term)) {
        termScore = SCORE_CATEGORY;
      } else if (body.includes(term)) {
        termScore = SCORE_BODY;
      }
      if (termScore === 0) {
        everyTermMatched = false;
        break;
      }
      score += termScore;
    }
    if (!everyTermMatched) continue;
    if (terms.length > 1 && title.includes(phrase)) score += SCORE_PHRASE_IN_TITLE;

    // Prefer the summary; fall back to a body excerpt around the first hit.
    // Keyword/category-only matches keep the summary (no arbitrary body slice).
    const summaryHasTerm = terms.some((t) => summary.includes(t));
    const bodyHasTerm = terms.some((t) => body.includes(t));
    const snippetSource = summaryHasTerm
      ? article.summary
      : bodyHasTerm
        ? excerptAround(articleToPlainText(article), terms)
        : article.summary;

    results.push({
      article,
      score,
      snippet: highlightTerms(snippetSource, terms),
      title: highlightTerms(article.title, terms),
    });
  }

  return results.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));
}
````

## File: libs/common/src/lib/help/help-types.ts
````typescript
/**
 * Content model for the in-app help center.
 *
 * Articles are plain data (no HTML) rendered through typed blocks, so the
 * help content is searchable, type-checked, and immune to XSS by design.
 */

export type HelpCategoryId =
  | 'getting-started'
  | 'contacts'
  | 'grids'
  | 'segmentation'
  | 'outreach'
  | 'engagement'
  | 'productivity'
  | 'data'
  | 'admin';

export interface HelpCategory {
  /** One-sentence description shown on the category card. */
  blurb: string;
  /** Heroicon name; each consuming app maps this to its own icon component. */
  icon: string;
  id: HelpCategoryId;
  label: string;
}

export interface HelpStep {
  detail?: string;
  title: string;
}

export interface HelpKeyRow {
  action: string;
  keys: string[];
}

/**
 * A single content block. Inline text in `text`, `items`, and step fields
 * supports the mini-markup parsed by `parseHelpInline`:
 * `**bold**`, `` `code` `` and `[label](/internal/route)`.
 */
export type HelpBlock =
  | { kind: 'callout'; tone: 'info' | 'tip' | 'warning'; title: string; text: string }
  | { kind: 'h2'; id: string; text: string }
  | { kind: 'keys'; rows: HelpKeyRow[] }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'p'; text: string }
  | { kind: 'steps'; items: HelpStep[] };

export interface HelpArticle {
  blocks: HelpBlock[];
  category: HelpCategoryId;
  /** Stable slug used in the /help/:id route. */
  id: string;
  /** Extra search terms that don't appear verbatim in the copy. */
  keywords: string[];
  /** Ids of hand-picked related articles. */
  related?: string[];
  summary: string;
  title: string;
}

export interface HelpInlineSegment {
  kind: 'bold' | 'code' | 'link' | 'text';
  /** Internal route, present only when kind === 'link'. */
  route?: string;
  text: string;
}

const INLINE_TOKEN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Parses the help mini-markup into typed segments. Unknown or unterminated
 * markers are left as plain text; only internal routes (starting with `/`)
 * become links, anything else stays literal text.
 */
export function parseHelpInline(text: string): HelpInlineSegment[] {
  const segments: HelpInlineSegment[] = [];
  let cursor = 0;

  INLINE_TOKEN.lastIndex = 0;
  for (let match = INLINE_TOKEN.exec(text); match !== null; match = INLINE_TOKEN.exec(text)) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }

    const [, bold, code, linkLabel, linkTarget] = match;
    if (bold !== undefined) {
      segments.push({ kind: 'bold', text: bold });
    } else if (code !== undefined) {
      segments.push({ kind: 'code', text: code });
    } else if (linkLabel !== undefined && linkTarget !== undefined && linkTarget.startsWith('/')) {
      segments.push({ kind: 'link', route: linkTarget, text: linkLabel });
    } else {
      // Non-internal link targets are rendered as-is so nothing silently 404s.
      segments.push({ kind: 'text', text: match[0] });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

/** Plain text of one inline-markup string (markers stripped) for search. */
export function stripHelpInline(text: string): string {
  return parseHelpInline(text)
    .map((s) => s.text)
    .join('');
}

/** All searchable plain text of a block, headings included. */
export function blockToPlainText(block: HelpBlock): string {
  switch (block.kind) {
    case 'p':
    case 'h2':
      return stripHelpInline(block.text);
    case 'list':
      return block.items.map(stripHelpInline).join(' ');
    case 'steps':
      return block.items.map((s) => [s.title, s.detail ?? ''].map(stripHelpInline).join(' ')).join(' ');
    case 'callout':
      return `${stripHelpInline(block.title)} ${stripHelpInline(block.text)}`;
    case 'keys':
      return block.rows.map((r) => `${r.keys.join(' ')} ${stripHelpInline(r.action)}`).join(' ');
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

/** Whole-article plain text used for search indexing. */
export function articleToPlainText(article: HelpArticle): string {
  return article.blocks.map(blockToPlainText).join(' ');
}

const WORDS_PER_MINUTE = 200;

/** Estimated reading time in whole minutes (always at least 1). */
export function readingMinutes(article: HelpArticle): number {
  const words = `${article.title} ${article.summary} ${articleToPlainText(article)}`
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
````

## File: libs/common/src/lib/schemas/activity.schema.ts
````typescript
import { z } from 'zod';

/**
 * Interaction types a user can log by hand from a record page ("Log an
 * interaction"). These are stored in `user_activity.activity` alongside the
 * auto-generated audit types (create/update/…); they are the human-authored
 * subset. Keep in sync with the `UserActivityType` union in
 * `apps/backend/src/app/lib/user-activity.repo.ts`.
 */
export const INTERACTION_TYPES = ['call', 'door_knock', 'note', 'meeting'] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call: 'Call',
  door_knock: 'Door knock',
  note: 'Email / note',
  meeting: 'Meeting',
};

export const interactionTypeSchema = z.enum(INTERACTION_TYPES);

/** Longest note we accept for a logged interaction. */
export const INTERACTION_NOTE_MAX = 2000;

/**
 * Payload for the `activity.logInteraction` mutation. `entity` is the DB table
 * name the record lives in (`persons` / `households` / `companies`), `entityId`
 * the record id. `note` is optional free text; `occurredAt` lets the user
 * back-date the interaction (defaults to now server-side).
 */
export const LogInteractionObj = z.object({
  entity: z.string().min(1),
  entityId: z.string().min(1),
  type: interactionTypeSchema,
  note: z.string().trim().max(INTERACTION_NOTE_MAX).optional(),
  occurredAt: z.coerce.date().optional(),
});

export type LogInteractionType = z.infer<typeof LogInteractionObj>;
````

## File: libs/common/src/lib/schemas/bug-reports.schema.ts
````typescript
import { z } from 'zod';
import { idSchema } from './core.schema';

/**
 * A user-submitted bug report (fire-and-forget). `description` is the only field the
 * user types; the rest is context the dialog captures automatically. Server-derived
 * facts (tenant, reporter, campaign, timestamp) never come from the client.
 */
export const AddBugReportObj = z.object({
  description: z.string().trim().min(1, 'Please describe what happened').max(5000, 'Description is too long'),
  page_url: z.string().trim().max(2000, 'URL is too long').nullable().optional(),
  user_agent: z.string().trim().max(1000, 'User agent is too long').nullable().optional(),
  viewport: z.string().trim().max(50, 'Viewport is too long').nullable().optional(),
  screenshot_file_id: idSchema.nullable().optional(),
});
````

## File: libs/common/src/lib/schemas/campaigns.schema.ts
````typescript
import { z } from 'zod';
import { descriptionSchema, idSchema, nameSchema, notesSchema } from './core.schema';

/**
 * Campaigns §15 — a campaign is a *context*: the permanent constituency office
 * ('office') or a time-bounded election run ('election'). Several can be active at
 * once; users pick the one they're working in via the header switcher. Archived
 * campaigns are read-only history.
 */
export const CAMPAIGN_KINDS = ['office', 'election'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const CAMPAIGN_STATUSES = ['active', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Plain calendar date (campaigns.startdate/enddate are Postgres `date` columns). */
const campaignDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional();

export const AddCampaignObj = z.object({
  name: nameSchema('Name', 100),
  description: descriptionSchema(1000),
  notes: notesSchema,
  kind: z.enum(CAMPAIGN_KINDS).default('election'),
  startdate: campaignDateSchema,
  enddate: campaignDateSchema,
});

export const UpdateCampaignObj = z.object({
  name: nameSchema('Name', 100).optional(),
  description: descriptionSchema(1000),
  notes: notesSchema,
  startdate: campaignDateSchema,
  enddate: campaignDateSchema,
});

/**
 * Campaign-scoped person facts (Campaigns §15) — structured concepts, not tags.
 * One row per (campaign, person); a missing row / NULL field is "Unknown".
 * UI copy: Neutral = engaged but indifferent; Undecided = engaged, hasn't
 * decided; Unknown = never asked.
 */
export const SUPPORT_LEVELS = ['strong', 'leaning', 'neutral', 'leaning_against', 'against', 'undecided'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const SUPPORT_LEVEL_LABELS: Record<SupportLevel, string> = {
  strong: 'Strong',
  leaning: 'Leaning',
  neutral: 'Neutral',
  leaning_against: 'Leaning against',
  against: 'Against',
  undecided: 'Undecided',
};

/** GOTV voting status. Advance voters are struck from later call/knock lists. */
export const VOTING_STATUSES = ['will_vote', 'voted_advance', 'voted_eday', 'not_voting', 'ineligible'] as const;
export type VotingStatus = (typeof VOTING_STATUSES)[number];

export const VOTING_STATUS_LABELS: Record<VotingStatus, string> = {
  will_vote: 'Will vote',
  voted_advance: 'Voted — advance',
  voted_eday: 'Voted — election day',
  not_voting: 'Not voting',
  ineligible: 'Ineligible',
};

export const FACT_SOURCES = ['manual', 'canvass', 'form', 'import', 'carryover'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/** Upsert one person's facts in one campaign. Omitted field = leave unchanged; explicit null = back to Unknown. */
export const UpsertCampaignPersonFactObj = z.object({
  campaign_id: idSchema,
  person_id: idSchema,
  support_level: z.enum(SUPPORT_LEVELS).nullable().optional(),
  voting_status: z.enum(VOTING_STATUSES).nullable().optional(),
});

/**
 * Per-campaign email consent (§15, layer 1 of 3). 'pending' is double opt-in
 * awaiting confirmation. Layers 2 & 3 (address suppressions, person DNC) are
 * global and live elsewhere; sendable = subscribed ∧ not suppressed ∧ not DNC.
 */
export const SUBSCRIPTION_STATUSES = ['subscribed', 'pending', 'unsubscribed'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const CONSENT_SOURCES = ['form', 'import', 'manual', 'copied'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Staff-set subscription change; 'pending' is machine-only (double opt-in flow). */
export const SetCampaignSubscriptionObj = z.object({
  campaign_id: idSchema,
  person_id: idSchema,
  status: z.enum(['subscribed', 'unsubscribed']),
});

/**
 * Carry-over (§15): seed a campaign from a prior one. Support levels copy as a
 * starting assumption (source='carryover'); voting status NEVER copies (it is
 * election-specific by definition); subscriptions copy only when the caller has
 * explicitly confirmed the compliance warning (consent_source='copied',
 * original consent_at preserved).
 */
export const CarryOverCampaignObj = z.object({
  source_campaign_id: idSchema,
  target_campaign_id: idSchema,
  copy_support: z.boolean().default(true),
  copy_subscriptions: z.boolean().default(false),
});
````

## File: libs/common/src/lib/schemas/canvassing.schema.ts
````typescript
import { z } from 'zod';

import { idSchema, nameSchema, notesSchema } from './core.schema';

/**
 * Canvassing §13 schemas. The turf/knock status vocabularies are `as const` so
 * they drive both Zod validation and exhaustive discriminated-union switches on
 * the frontend and in the controller.
 */

/** Stored turf lifecycle. Display state ("In field now") is derived from knocks. */
export const TURF_STATUSES = ['draft', 'active', 'retired'] as const;
export type TurfStatus = (typeof TURF_STATUSES)[number];

/**
 * What happened at the door. "attempted" = any knock except `cleared`;
 * "conversation" = a talk. `moved` is a person-level no-conversation code;
 * `cleared` is the append-only "door outcome toggled off" marker — the latest
 * outcome knock wins, and `cleared` means the door is back on the list.
 */
export const KNOCK_OUTCOMES = [
  'conversation',
  'no_answer',
  'not_home',
  'moved',
  'refused',
  'inaccessible',
  'cleared',
] as const;
export type KnockOutcome = (typeof KNOCK_OUTCOMES)[number];

/**
 * The voter's stance, when a conversation happened — the spec §3.5 five-option
 * support scale. `not_voting`/`already_voted` feed `voting_status` rather than
 * `support_level` on campaign_person_facts.
 */
export const KNOCK_RESPONSES = ['supporter', 'undecided', 'non_supporter', 'not_voting', 'already_voted'] as const;
export type KnockResponse = (typeof KNOCK_RESPONSES)[number];

/** Survey labels for the five support options (sentence case, spec §3.5). */
export const KNOCK_RESPONSE_LABELS: Record<KnockResponse, string> = {
  supporter: 'Supporter',
  undecided: 'Undecided',
  non_supporter: 'Non-supporter',
  not_voting: 'Not voting',
  already_voted: 'Already voted',
};

/** Doors-per-turf presets from the Cut-new-turfs dialog. */
export const DOORS_PER_TURF_PRESETS = [30, 40, 50, 60] as const;

export const turfStatusSchema = z.enum(TURF_STATUSES);
export const knockOutcomeSchema = z.enum(KNOCK_OUTCOMES);
export const knockResponseSchema = z.enum(KNOCK_RESPONSES);

export const AddTurfObj = z.object({
  /** Campaigns §15 — the context this turf is knocked for; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: nameSchema('Name', 120),
  list_id: idSchema.nullable().optional(),
  notes: notesSchema,
});

export const UpdateTurfObj = z.object({
  name: nameSchema('Name', 120).optional(),
  status: turfStatusSchema.optional(),
  notes: notesSchema,
});

/** Preview and Cut share this input; preview never writes. */
export const CutTurfsObj = z.object({
  list_id: idSchema,
  doors_per_turf: z.number().int().min(5).max(500),
});

export const AssignTurfObj = z.object({
  turf_id: idSchema,
  team_id: idSchema.nullable().optional(),
  /**
   * The person this Companion link belongs to. Required: the companion access
   * layer verifies the holder against this person's email/mobile on file, so
   * an assignment without a person produces a link nobody can open.
   */
  volunteer_person_id: idSchema,
});

export const FieldReportRangeObj = z.object({
  range: z.enum(['today', 'yesterday', 'week', 'month', 'campaign', 'custom']).default('week'),
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
});

/**
 * Companion knock payload. Arrives over the tokenised public route (no account),
 * so the token authorises the turf and `client_knock_id` de-dupes offline
 * re-sends. Parsed from `unknown` at the REST boundary.
 */
export const LogKnockObj = z.object({
  token: z.string().min(10).max(200),
  client_knock_id: z.string().min(1).max(200),
  household_id: idSchema,
  person_id: idSchema.nullable().optional(),
  outcome: knockOutcomeSchema,
  response: knockResponseSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  canvasser_name: z.string().trim().max(120).nullable().optional(),
  knocked_at: z.string().datetime().nullable().optional(),
});

export function isTurfStatus(v: unknown): v is TurfStatus {
  return typeof v === 'string' && (TURF_STATUSES as readonly string[]).includes(v);
}

export function isKnockOutcome(v: unknown): v is KnockOutcome {
  return typeof v === 'string' && (KNOCK_OUTCOMES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Companion batched results (spec §3.5/§5) — POST /api/canvass/t/:token/results
// ---------------------------------------------------------------------------

/**
 * A full survey (spec §3.5). `person_id` null = the anonymous household-level
 * survey. `support` is the one required field — EXCEPT that toggling
 * "Do not contact" alone is saveable, which the refine below encodes.
 */
export const CompanionSurveyObj = z
  .object({
    household_id: idSchema,
    person_id: idSchema.nullable().optional(),
    support: knockResponseSchema.nullable().optional(),
    issues: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    wants_volunteer: z.boolean().default(false),
    wants_yard_sign: z.boolean().default(false),
    set_dnc: z.boolean().default(false),
    contact_phone: z.string().trim().max(40).nullable().optional(),
    contact_email: z.string().trim().email().max(200).nullable().optional(),
    subscribe: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.support != null || v.set_dnc, { message: 'Pick a support level to save' });

/** One-tap no-conversation codes for a person (spec §3.5). */
export const CompanionPersonResultObj = z.object({
  household_id: idSchema,
  person_id: idSchema,
  result: z.enum(['not_home', 'moved', 'refused']),
});

/** Door-level outcome (spec §3.4 quick actions). */
export const CompanionDoorOutcomeObj = z.object({
  household_id: idSchema,
  outcome: z.enum(['no_answer', 'inaccessible', 'refused']),
});

export const CompanionClearOutcomeObj = z.object({
  household_id: idSchema,
});

/** "+ Add someone at this door" (spec §3.4). */
export const CompanionPersonCreateObj = z.object({
  household_id: idSchema,
  name: z.string().trim().min(1).max(120),
});

const companionOpBase = {
  /** Client-generated UUID — the idempotency key (companion_ops ledger). */
  op_id: z.string().min(8).max(100),
  /** On-device timestamp so offline results keep their true door time. */
  recorded_at: z.string().datetime().nullable().optional(),
};

export const CompanionOpObj = z.discriminatedUnion('type', [
  z.object({ ...companionOpBase, type: z.literal('survey'), payload: CompanionSurveyObj }),
  z.object({ ...companionOpBase, type: z.literal('person_result'), payload: CompanionPersonResultObj }),
  z.object({ ...companionOpBase, type: z.literal('door_outcome'), payload: CompanionDoorOutcomeObj }),
  z.object({ ...companionOpBase, type: z.literal('clear_outcome'), payload: CompanionClearOutcomeObj }),
  z.object({ ...companionOpBase, type: z.literal('person_create'), payload: CompanionPersonCreateObj }),
]);

export const CompanionResultsObj = z.object({
  ops: z.array(CompanionOpObj).min(1).max(200),
});

export type CompanionSurveyType = z.infer<typeof CompanionSurveyObj>;
export type CompanionOpType = z.infer<typeof CompanionOpObj>;
export type CompanionResultsType = z.infer<typeof CompanionResultsObj>;

/** Per-op server acknowledgement — `duplicate` means "already applied, treat as success". */
export interface CompanionOpAck {
  op_id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
  /** For person_create: the real id to swap in for the client's temp person. */
  person_id?: string;
}

// ------------------------------------------------------------------------
// Companion GET payload (spec §3, §5) — shared by backend + apps/companion.
// Payload minimization is an acceptance criterion: names, walk data and prior
// door RESULTS only — never emails, phones, donation history, or notes.
// ------------------------------------------------------------------------

/** Pre-fill for re-editing a surveyed person/door. Deliberately excludes notes + contact info. */
export interface CompanionSurveyPrefill {
  support: KnockResponse | null;
  issues: string[];
  wants_volunteer: boolean;
  wants_yard_sign: boolean;
  set_dnc: boolean;
  subscribe: boolean;
}

export type CompanionPersonResult = 'canvassed' | 'not_home' | 'moved' | 'refused';

export interface CompanionPerson {
  id: string;
  name: string;
  /** Suppressed from all outreach — card renders dimmed and non-interactive. */
  dnc: boolean;
  result: CompanionPersonResult | null;
  survey: CompanionSurveyPrefill | null;
}

export type CompanionDoorOutcome = 'no_answer' | 'inaccessible' | 'refused';

export interface CompanionHousehold {
  id: string;
  walk_order: number;
  address: string;
  lat: number | null;
  lng: number | null;
  /** Whole-door do-not-contact (every resident is DNC) — skip, but it still counts. */
  dnc: boolean;
  door_outcome: CompanionDoorOutcome | null;
  /** The anonymous household-level survey, when one was recorded. */
  hh_survey: CompanionSurveyPrefill | null;
  people: CompanionPerson[];
}

export interface CompanionTurfPayload {
  campaign_name: string;
  turf_name: string;
  /** Whose name results save under — the assignment's volunteer. */
  canvasser_name: string;
  /** Collapsible door script (campaign-configured; empty string = none). */
  script: string;
  /** Issue-chip vocabulary (campaign-configured). */
  issues: string[];
  expires_at: string | null;
  households: CompanionHousehold[];
}

/** Staff-configured survey vocabulary (campaigns.canvass_issues/script). */
export const UpdateCompanionSettingsObj = z.object({
  campaign_id: idSchema.optional(),
  issues: z.array(z.string().trim().min(1).max(80)).max(30),
  script: z.string().trim().max(4000).nullable(),
});
export type UpdateCompanionSettingsType = z.infer<typeof UpdateCompanionSettingsObj>;
````

## File: libs/common/src/lib/schemas/companies.schema.ts
````typescript
import { z } from 'zod';

/**
 * Shape of the companies.enrichment jsonb column (formerly the untyped
 * companies.json grab-bag) — the Google Places enrichment payload.
 * `place_details` is the raw Places API result and deliberately unmodeled.
 */
export const CompanyEnrichmentObj = z
  .object({
    google_enriched: z.boolean().optional(),
    place_details: z.unknown().optional(),
  })
  .catchall(z.unknown());

export const CompanyInputObj = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().trim().max(1000).optional().nullable(),
  website: z.string().trim().max(255).optional().nullable().or(z.literal('')),
  email: z.string().trim().max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
});
````

## File: libs/common/src/lib/schemas/companion-access.schema.ts
````typescript
import { z } from 'zod';

/**
 * Companion access layer (COMPANION-APPS-PLAN.md §2). A companion capability
 * link (/t/:token canvass turf, /r/:token delivery route) is not enough on its
 * own: the volunteer must verify a one-time code sent to their email/SMS on
 * file, be approved once by an admin, and then hold a device session that
 * accompanies every companion request.
 */

export const COMPANION_LINK_KINDS = ['turf', 'route'] as const;
export type CompanionLinkKind = (typeof COMPANION_LINK_KINDS)[number];

export const COMPANION_VERIFY_CHANNELS = ['email', 'sms'] as const;
export type CompanionVerifyChannel = (typeof COMPANION_VERIFY_CHANNELS)[number];

export const COMPANION_VOLUNTEER_STATUSES = ['invited', 'verified', 'approved', 'revoked'] as const;
export type CompanionVolunteerStatus = (typeof COMPANION_VOLUNTEER_STATUSES)[number];

/**
 * What the gate UI renders:
 * - dead: unknown/expired/revoked link — friendly dead-link page
 * - unassigned: link has no volunteer person attached — ask the organizer to re-send
 * - need_verification: pick a channel, get a code
 * - pending_approval: verified, waiting for an admin — the page polls
 * - ready: approved with a valid device session — load the app
 */
export const COMPANION_ACCESS_STATES = [
  'dead',
  'unassigned',
  'need_verification',
  'pending_approval',
  'ready',
] as const;
export type CompanionAccessState = (typeof COMPANION_ACCESS_STATES)[number];

export const CompanionAccessQueryObj = z.object({
  kind: z.enum(COMPANION_LINK_KINDS),
  token: z.string().min(8).max(200),
});

export const CompanionVerifyStartObj = CompanionAccessQueryObj.extend({
  channel: z.enum(COMPANION_VERIFY_CHANNELS),
});

export const CompanionVerifyConfirmObj = CompanionAccessQueryObj.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export type CompanionAccessQueryType = z.infer<typeof CompanionAccessQueryObj>;
export type CompanionVerifyStartType = z.infer<typeof CompanionVerifyStartObj>;
export type CompanionVerifyConfirmType = z.infer<typeof CompanionVerifyConfirmObj>;

/** A verifiable contact on file, masked for display — never the raw value. */
export interface CompanionContact {
  channel: CompanionVerifyChannel;
  masked: string;
}

/** Response of GET /api/companion/access. */
export interface CompanionAccessPayload {
  state: CompanionAccessState;
  /** Volunteer first name — identity card ("Walking as Jordan"). */
  volunteerName?: string;
  /** Who to contact about a dead/unassigned link. */
  organizerName?: string;
  /** Organization name for the gate header. */
  organizationName?: string;
  contacts?: CompanionContact[];
}

/** Response of POST /api/companion/verify/confirm. */
export interface CompanionVerifyConfirmResult {
  status: 'ready' | 'pending_approval';
  sessionToken: string;
  expiresAt: string;
}

/** One row of the admin Volunteer access page. */
export interface CompanionVolunteerRow {
  id: string;
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  status: CompanionVolunteerStatus;
  verify_channel: CompanionVerifyChannel | null;
  verified_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  created_at: string;
}
````

## File: libs/common/src/lib/schemas/core.schema.ts
````typescript
import { z } from 'zod';

export const sortModelItem = z.object({
  colId: z.string(),
  sort: z.enum(['asc', 'desc']),
});

export interface QueryBuilderRuleNode {
  kind: 'rule';
  id: string;
  field: string;
  op: string;
  value?: any;
}

export interface QueryBuilderGroupNode {
  kind: 'group';
  id: string;
  conjunction: 'AND' | 'OR';
  rules: QueryBuilderNode[];
}

export type QueryBuilderNode = QueryBuilderRuleNode | QueryBuilderGroupNode;

export function cloneQueryBuilderNode(node: QueryBuilderNode): QueryBuilderNode {
  if (node.kind === 'rule') {
    return { ...node };
  } else {
    return {
      ...node,
      rules: node.rules.map(cloneQueryBuilderNode),
    };
  }
}

export const queryBuilderNodeSchema: z.ZodType<QueryBuilderNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('rule'),
      id: z.string(),
      field: z.string(),
      op: z.string(),
      value: z.unknown().optional(),
    }),
    z.object({
      kind: z.literal('group'),
      id: z.string(),
      conjunction: z.enum(['AND', 'OR']),
      rules: z.array(queryBuilderNodeSchema),
    }),
  ]),
);

export const oldAdvancedFilterModelSchema = z.object({
  conjunction: z.enum(['AND', 'OR']),
  rules: z.array(
    z.object({
      field: z.string(),
      op: z.string(),
      value: z.unknown(),
    }),
  ),
});

export const getAllOptions = z
  .object({
    searchStr: z.string().optional(),
    startRow: z.number().optional(),
    endRow: z.number().optional(),
    sortModel: z.array(sortModelItem).optional(),
    filterModel: z.record(z.string(), z.unknown()).optional(),
    includeArchived: z.boolean().optional(),
    columns: z.array(z.string()).optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    orderBy: z.array(z.string()).optional(),
    groupBy: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    issues: z.array(z.string()).optional(),
    type: z.enum(['tag', 'issue']).optional(),
    userId: z.string().optional(),
    entity: z.string().optional(),
    activity: z.string().optional(),
    advancedFilterModel: queryBuilderNodeSchema.or(oldAdvancedFilterModelSchema).optional(),
    listId: z.string().optional(),
    /** Campaigns §15 — the active context; scopes campaign-specific columns/rows (e.g. support level). */
    campaignId: z.string().optional(),
    /**
     * Volunteer/staff status filters (§15) — first-class replacements for the
     * old `tags: ['volunteer']` filter. Plain string arrays here to avoid a
     * circular import with persons.schema; the enum is validated at the column.
     */
    volunteerStatus: z.array(z.string()).optional(),
    staffStatus: z.array(z.string()).optional(),
  })
  .optional();

export const exportCsvInput = z
  .object({
    options: getAllOptions,
    columns: z.array(z.string()).optional(),
    fileName: z.string().optional(),
  })
  .optional();

export const exportCsvResponse = z.union([
  z.object({
    status: z.literal('processing'),
  }),
  z.object({
    csv: z.string(),
    fileName: z.string(),
    columns: z.array(z.string()),
    rowCount: z.number(),
    status: z.literal('completed').optional(),
  }),
]);

export const exportEntitySchema = z.enum([
  'persons',
  'households',
  'companies',
  'tags',
  'issues',
  'tasks',
  'lists',
  'newsletters',
  'teams',
  'users',
  'volunteer',
  'forms',
  'workflows',
]);

export const queueExportInput = z.object({
  entity: exportEntitySchema,
  options: getAllOptions,
  columns: z.array(z.string()).optional(),
  fileName: z.string().optional(),
});

/** Logs an export that already downloaded straight to the browser (small/displayed-rows path)
 * so it still shows up in the Exports history — see pplcrm-datagrid. No file is stored server-side,
 * so the resulting record is not re-downloadable. */
export const logInstantExportInput = z.object({
  entity: exportEntitySchema,
  fileName: z.string(),
  rowCount: z.number().int().nonnegative(),
});

export const dataExportRecord = z.object({
  id: z.string(),
  entity: z.string(),
  file_name: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  row_count: z.number().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  downloadable: z.boolean(),
  createdBy: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export const dbIdSchema = z.string().regex(/^\d+$/, 'Invalid ID format');
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const idSchema = dbIdSchema;

export const addressSchema = z.object({
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  formatted_address: z.string().trim().max(500, 'Address is too long').nullable().optional(),
  type: z.string().trim().max(50, 'Type is too long').nullable().optional(),
  apt: z.string().trim().max(30, 'Apt is too long').nullable().optional(),
  street_num: z.string().trim().max(30, 'Street number is too long').nullable().optional(),
  street1: z.string().trim().max(150, 'Street 1 is too long').nullable().optional(),
  street2: z.string().trim().max(150, 'Street 2 is too long').nullable().optional(),
  city: z.string().trim().max(100, 'City is too long').nullable().optional(),
  state: z.string().trim().max(100, 'State is too long').nullable().optional(),
  zip: z.string().trim().max(20, 'Zip is too long').nullable().optional(),
  country: z.string().trim().max(100, 'Country is too long').nullable().optional(),
});

/**
 * One column's server-side filter as the datagrid posts it inside `filterModel`:
 * an optional comparison `op` (contains/equals/startsWith/isEmpty/…) and the
 * `value` to match. Consumed by BaseRepository.applyColumnFilter /
 * applyCastColumnFilter. `value` is `unknown` because the grid sends strings,
 * numbers, and booleans — coerce with String(...) at the point of use. Matches
 * the wire shape validated by getAllOptions' `filterModel: z.record(z.unknown())`.
 */
export interface GridColumnFilter {
  op?: string;
  value?: unknown;
}

/** The datagrid's per-column filter bag: column id → its filter. */
export type GridFilterModel = Record<string, GridColumnFilter>;

export const nameSchema = (fieldName: string, maxLen = 100) =>
  z.string().trim().min(1, `${fieldName} is required`).max(maxLen, `${fieldName} is too long`);

export const descriptionSchema = (maxLen = 1000) =>
  z.string().trim().max(maxLen, 'Description is too long').nullable().optional();

export const emailSchema = z.string().trim().max(320, 'Email is too long').email('Invalid email address');

export const nullableEmailSchema = emailSchema.or(z.literal('')).nullable().optional();
export const phoneSchema = (fieldName: string) =>
  z.string().trim().max(30, `${fieldName} is too long`).nullable().optional();

export const notesSchema = z.string().trim().max(10000, 'Notes are too long').nullable().optional();
````

## File: libs/common/src/lib/schemas/donations.schema.ts
````typescript
import { z } from 'zod';
import { idSchema } from './core.schema';

/**
 * Offline gift entry (spec §12, Fig. 15 "Record donation" dialog). Distinct from the Stripe
 * checkout path (`createCheckout`/`confirmDonation`) — this is for gifts collected outside the
 * public donation form (cash at a fundraiser, a mailed check, a bank transfer).
 */
export const DONATION_METHODS = ['card', 'check', 'cash', 'bank_transfer'] as const;
export const DONATION_METHOD_LABELS: Record<(typeof DONATION_METHODS)[number], string> = {
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};

export const donationMethodSchema = z.enum(DONATION_METHODS);
export type DonationMethod = z.infer<typeof donationMethodSchema>;

export const RecordDonationObj = z.object({
  personId: idSchema,
  amountCents: z.number().int().positive('Enter an amount above zero, like 50'),
  method: donationMethodSchema,
  /** Campaigns §15 — which fund this gift belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
});
export type RecordDonationType = z.infer<typeof RecordDonationObj>;

/**
 * Countries a campaign can pick when connecting Stripe for donations (Stripe Connect hosted
 * onboarding). A curated subset of Stripe-supported countries — extend freely; onboarding handles
 * country-specific requirements. Shared so the settings UI select and the backend z.enum agree.
 */
export const STRIPE_CONNECT_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
] as const;

export const STRIPE_CONNECT_COUNTRY_CODES = STRIPE_CONNECT_COUNTRIES.map((c) => c.code) as [
  (typeof STRIPE_CONNECT_COUNTRIES)[number]['code'],
  ...(typeof STRIPE_CONNECT_COUNTRIES)[number]['code'][],
];
export const stripeConnectCountrySchema = z.enum(STRIPE_CONNECT_COUNTRY_CODES);
export type StripeConnectCountry = z.infer<typeof stripeConnectCountrySchema>;
````

## File: libs/common/src/lib/schemas/emails.schema.ts
````typescript
import { z } from 'zod';
import { isRegularFolderId, isSpecialFolderId } from '../emails';

/**
 * The six storable folder ids (Sent/Spam/Trash/Drafts/Outbox/Inbox). The only
 * valid write targets for emails.folder_id — enforced here at the tRPC
 * boundary and by the chk_emails_folder_id CHECK constraint in the DB (there
 * is no email_folders table; folders are code-defined in EMAIL_FOLDERS).
 */
export const regularFolderIdSchema = z.string().refine(isRegularFolderId, 'Unknown folder');

/** Any folder id, including the virtual query-filter folders — valid for reads. */
export const folderIdSchema = z.string().refine((v) => isRegularFolderId(v) || isSpecialFolderId(v), 'Unknown folder');

export const EmailCommentObj = z.object({
  id: z.string(),
  email_id: z.string(),
  author_id: z.string(),
  comment: z.string(),
  created_at: z.date(),
});

export const EmailDraftObj = z.object({
  id: z.string(),
  to_list: z.array(z.string()),
  cc_list: z.array(z.string()),
  bcc_list: z.array(z.string()),
  subject: z.string().optional(),
  body_html: z.string().optional(),
  body_delta: z.unknown().optional(),
  updated_at: z.date(),
});

export const EmailFolderObj = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  sort_order: z.number(),
  is_default: z.boolean(),
  is_virtual: z.boolean(),
});

export const EmailObj = z.object({
  id: z.string(),
  folder_id: z.string(),
  from_email: z.string().optional(),
  from_name: z.string().optional(),
  to_email: z.string().optional(),
  subject: z.string().optional(),
  preview: z.string().optional(),
  assigned_to: z.string().optional(),
  updated_at: z.date(),
  date_sent: z.date().nullable().optional(),
  is_favourite: z.boolean(),
  attachment_count: z.number(),
  has_attachment: z.boolean(),
  status: z.enum(['open', 'closed']).nullable().default('open'),
  is_read: z.boolean().optional(),
  sender_first_name: z.string().nullish(),
  sender_last_name: z.string().nullish(),
});
````

## File: libs/common/src/lib/schemas/lists.schema.ts
````typescript
import { z } from 'zod';
import { getAllOptions, nameSchema, descriptionSchema, idSchema } from './core.schema';

export const AddListObj = z.object({
  /** Campaigns §15 — the context this segment belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: nameSchema('List name', 100),
  description: descriptionSchema(1000),
  object: z.enum(['people', 'households']),
  is_dynamic: z.boolean().optional(),
  definition: z
    .lazy(() => getAllOptions)
    .nullable()
    .optional(),
  member_ids: z.array(idSchema).optional(),
});

export const ListsObj = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  object: z.enum(['people', 'households']),
  is_dynamic: z.boolean().optional(),
  definition: z
    .lazy(() => getAllOptions)
    .nullable()
    .optional(),
  last_refreshed_at: z.coerce.date().nullable().optional(),
  status: z.enum(['idle', 'refreshing', 'failed']).optional(),
});

export const UpdateListObj = z.object({
  name: nameSchema('List name', 100).optional(),
  description: descriptionSchema(1000).optional(),
  object: z.enum(['people', 'households']).optional(),
  is_dynamic: z.boolean().optional(),
  definition: z
    .lazy(() => getAllOptions)
    .nullable()
    .optional(),
  last_refreshed_at: z.coerce.date().nullable().optional(),
  status: z.enum(['idle', 'refreshing', 'failed']).optional(),
});

export const ImportListItemObj = z.object({
  id: idSchema,
  fileName: z.string(),
  source: z.string(),
  tagName: z.string().nullable(),
  tagMissing: z.boolean(),
  createdAt: z.coerce.date(),
  processedAt: z.coerce.date(),
  createdBy: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
  insertedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  tagsApplied: z.array(z.string()),
  rowCount: z.number().int().nonnegative(),
  householdsCreated: z.number().int().nonnegative(),
  contactCount: z.number().int().nonnegative(),
  householdCount: z.number().int().nonnegative(),
  companyCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  status: z.string(),
  errorMessage: z.string().nullable().optional(),
  canDeleteContacts: z.boolean(),
  /** File size in bytes, when the original upload is still retained (90 days, spec §17). */
  sourceFileSize: z.number().int().nonnegative().nullable(),
  canDownloadSource: z.boolean(),
  canDownloadSkipped: z.boolean(),
});
````

## File: libs/common/src/lib/schemas/persons.schema.ts
````typescript
import { z } from 'zod';
import { phoneSchema, notesSchema, idSchema, nullableEmailSchema, addressSchema } from './core.schema';

/**
 * Do-not-contact channels (Campaigns §15). The flag lives on the person — it is a
 * global compliance override, never a per-campaign preference. A null/absent
 * channel list means "no contact on any channel".
 */
export const DNC_CHANNELS = ['email', 'phone', 'door'] as const;
export type DncChannel = (typeof DNC_CHANNELS)[number];

/**
 * Volunteer & staff standing (Campaigns §15) — first-class person status, not a
 * tag. Global (tenant-wide), single-valued, and read by team-membership logic,
 * so it is a structured concept. NULL/absent = "not a volunteer / not staff".
 * Volunteer carries a recruiting pipeline (prospective → active → inactive →
 * former); staff has no "prospective" — a person either is staff or has left.
 */
export const VOLUNTEER_STATUSES = ['prospective', 'active', 'inactive', 'former'] as const;
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number];

export const VOLUNTEER_STATUS_LABELS: Record<VolunteerStatus, string> = {
  prospective: 'Prospective',
  active: 'Active',
  inactive: 'Inactive',
  former: 'Former',
};

export const STAFF_STATUSES = ['active', 'inactive', 'former'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  former: 'Former',
};

export const PersonsObj = z.object({
  id: z.string(),
  household_id: z.string(),
  email: z.string(),
  email2: z.string(),
  first_name: z.string(),
  middle_names: z.string(),
  last_name: z.string(),
  home_phone: z.string(),
  mobile: z.string(),
  notes: z.string(),
  linkedin: z.string().nullable().optional(),
  twitter: z.string().nullable().optional(),
  facebook: z.string().nullable().optional(),
  instagram: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  preferred_contact: z.string().nullable().optional(),
  volunteer_status: z.string().nullable().optional(),
  staff_status: z.string().nullable().optional(),
});

export const UpdateHouseholdsObj = addressSchema.extend({
  home_phone: phoneSchema('Home phone'),
  notes: notesSchema,
});

export const UpdatePersonsObj = z.object({
  campaign_id: idSchema.optional(),
  household_id: idSchema.optional(),
  company_id: idSchema.or(z.literal('')).nullable().optional(),
  email: nullableEmailSchema,
  email2: nullableEmailSchema,
  first_name: z.string().trim().max(100, 'First name is too long').nullable().optional(),
  middle_names: z.string().trim().max(100, 'Middle names are too long').nullable().optional(),
  last_name: z.string().trim().max(100, 'Last name is too long').nullable().optional(),
  home_phone: phoneSchema('Home phone'),
  mobile: phoneSchema('Mobile phone'),
  notes: notesSchema,
  linkedin: z.string().trim().max(255, 'LinkedIn URL is too long').nullable().optional(),
  twitter: z.string().trim().max(255, 'Twitter URL is too long').nullable().optional(),
  facebook: z.string().trim().max(255, 'Facebook URL is too long').nullable().optional(),
  instagram: z.string().trim().max(255, 'Instagram URL is too long').nullable().optional(),
  assigned_to: idSchema.or(z.literal('')).nullable().optional(),
  preferred_contact: z.string().trim().max(20, 'Preferred contact is too long').nullable().optional(),
  do_not_contact: z.boolean().optional(),
  do_not_contact_channels: z.array(z.enum(DNC_CHANNELS)).nullable().optional(),
  volunteer_status: z.enum(VOLUNTEER_STATUSES).nullable().optional(),
  staff_status: z.enum(STAFF_STATUSES).nullable().optional(),
});
````

## File: libs/common/src/lib/schemas/settings.schema.ts
````typescript
import { z } from 'zod';

export const SettingsObj = z.object({
  id: z.string().optional(),
  tenant_id: z.string().optional(),
  campaign_id: z.string().optional(),
  createdby_id: z.string().optional(),
  updatedby_id: z.string().optional(),
  key: z.string().optional(),
  value: z.unknown().optional(),
});

export const SettingsEntryObj = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

export const UpsertSettingsInputObj = z.object({
  entries: z.array(SettingsEntryObj).min(1),
});
````

## File: libs/common/src/lib/schemas/tags.schema.ts
````typescript
import { z } from 'zod';
import { nameSchema, descriptionSchema } from './core.schema';

export const AddTagObj = z.object({
  name: nameSchema('Tag name', 50),
  description: descriptionSchema(500),
  color: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/, 'Colour must be a hex value like #ff0000')
    .nullable()
    .optional(),
  type: z.enum(['tag', 'issue']).default('tag').optional(),
});

export const UpdateTagObj = z.object({
  name: nameSchema('Tag name', 50).optional(),
  description: descriptionSchema(500).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/, 'Colour must be a hex value like #ff0000')
    .nullable()
    .optional(),
  type: z.enum(['tag', 'issue']).optional(),
});
````

## File: libs/common/src/lib/schemas/teams.schema.ts
````typescript
import { z } from 'zod';
import { nameSchema, descriptionSchema, idSchema } from './core.schema';

export const AddTeamObj = z.object({
  name: nameSchema('Name', 100),
  description: descriptionSchema(1000),
  team_captain_id: idSchema.or(z.literal('')).nullable().optional(),
  team_lead_user_id: idSchema.or(z.literal('')).nullable().optional(),
  volunteer_ids: z.array(idSchema).optional(),
  list_ids: z.array(idSchema).optional(),
});

export const UpdateTeamObj = z.object({
  name: nameSchema('Name', 100).nullable(),
  description: descriptionSchema(1000),
  team_captain_id: idSchema.or(z.literal('')).nullable().optional(),
  team_lead_user_id: idSchema.or(z.literal('')).nullable().optional(),
  volunteer_ids: z.array(idSchema).optional(),
  list_ids: z.array(idSchema).optional(),
});
````

## File: libs/common/src/lib/schemas/volunteer.schema.ts
````typescript
import { z } from 'zod';
import { nameSchema, idSchema, descriptionSchema, notesSchema } from './core.schema';

export const AddVolunteerEventObj = z.object({
  name: nameSchema('Event name', 200),
  description: descriptionSchema(2000),
  location_address: z.string().trim().max(500, 'Location address is too long').nullable().optional(),
  start_time: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.coerce.date({ error: 'Start date & time is required' }),
  ),
  end_time: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.coerce.date({ error: 'End date & time is required' }),
  ),
  capacity: z.number().int().positive().nullable().optional().or(z.literal('')),
  contact_email: z.string().trim().max(255).nullable().optional(),
  contact_phone: z.string().trim().max(50).nullable().optional(),
  is_private: z.boolean().default(false).optional(),
  send_reminder: z.boolean().default(true).optional(),
  send_signup_confirmation: z.boolean().default(true).optional(),
  send_volunteer_alert: z.boolean().default(true).optional(),
  fields: z.array(z.string()).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(
      /^(?=.*[a-z])[a-z0-9-]+$/,
      'Slug must contain at least one letter and can only contain lowercase letters, numbers, and hyphens',
    ),
});

export const VolunteerEventsObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  location_address: z.string().nullable().optional(),
  start_time: z.coerce.date(),
  end_time: z.coerce.date(),
  capacity: z.number().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  is_private: z.boolean(),
  send_reminder: z.boolean(),
  send_signup_confirmation: z.boolean().default(true),
  send_volunteer_alert: z.boolean().default(true),
  slug: z.string(),
});

export const UpdateVolunteerEventObj = z.object({
  name: nameSchema('Event name', 200).optional(),
  description: descriptionSchema(2000),
  location_address: z.string().trim().max(500, 'Location address is too long').nullable().optional(),
  start_time: z
    .preprocess(
      (val) => (val === '' || val === null ? undefined : val),
      z.coerce.date({ error: 'Start date & time is required' }),
    )
    .optional(),
  end_time: z
    .preprocess(
      (val) => (val === '' || val === null ? undefined : val),
      z.coerce.date({ error: 'End date & time is required' }),
    )
    .optional(),
  capacity: z.number().int().positive().nullable().optional().or(z.literal('')),
  contact_email: z.string().trim().max(255).nullable().optional(),
  contact_phone: z.string().trim().max(50).nullable().optional(),
  is_private: z.boolean().optional(),
  send_reminder: z.boolean().optional(),
  send_signup_confirmation: z.boolean().optional(),
  send_volunteer_alert: z.boolean().optional(),
  fields: z.array(z.string()).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(
      /^(?=.*[a-z])[a-z0-9-]+$/,
      'Slug must contain at least one letter and can only contain lowercase letters, numbers, and hyphens',
    )
    .optional(),
});

export const AddVolunteerShiftObj = z.object({
  event_id: idSchema,
  person_id: idSchema,
  status: z.enum(['signed_up', 'attended', 'no_show', 'cancelled']).default('signed_up').optional(),
  hours_worked: z.number().min(0).max(24).nullable().optional(),
  notes: notesSchema,
});

export const VolunteerShiftsObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  event_id: z.string(),
  person_id: z.string(),
  status: z.enum(['signed_up', 'attended', 'no_show', 'cancelled']),
  hours_worked: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const UpdateVolunteerShiftObj = z.object({
  status: z.enum(['signed_up', 'attended', 'no_show', 'cancelled']).optional(),
  hours_worked: z.number().min(0).max(24).nullable().optional(),
  notes: notesSchema,
});
````

## File: libs/common/src/lib/schemas/web-forms.schema.ts
````typescript
import { z } from 'zod';
import { idSchema, nameSchema, descriptionSchema } from './core.schema';

export const AddWebFormObj = z.object({
  name: nameSchema('Web Form name', 100),
  description: descriptionSchema(500),
  redirect_url: z.string().trim().url('Redirect URL must be a valid URL').or(z.literal('')).nullable().optional(),
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
  redirect_url: z.string().trim().url('Redirect URL must be a valid URL').or(z.literal('')).nullable().optional(),
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

/** A single configurable field on a form. Stored as JSON in `web_forms.fields`. */
export const FormFieldObj = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'area', 'select', 'checks']),
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

/** Build the initial field list for a newly created form of the given template type. */
export function fieldsForTemplate(type: FormType): FormField[] {
  return normForm(FORM_TEMPLATES[type].fields.map((f) => ({ ...f })));
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
  redirect_url: z.string().trim().url('Redirect URL must be a valid URL').or(z.literal('')).nullable().optional(),
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

/** One row in the Responses tab. */
export const FormSubmissionObj = z.object({
  id: z.string(),
  person_id: z.string(),
  person_name: z.string().nullable(),
  answers: z.record(z.string(), z.unknown()),
  created_at: z.union([z.date(), z.string()]),
});
````

## File: libs/common/src/lib/emails.ts
````typescript
// ---------- Public compatibility interface (loose) ----------
// ---------- Strict types for compile-time guarantees ----------
interface EmailFolderBase {
  icon: string;
  id: string;
  is_default: boolean;
  name: string;
  sort_order: number;
  is_hidden?: boolean;
}

export interface EmailFolderConfig {
  code?: string; // optional/loose for compatibility
  icon: string;
  id: string;
  is_default: boolean;
  is_virtual: boolean;
  name: string;
  sort_order: number;
  is_hidden?: boolean;
}

export interface RealEmailFolder extends EmailFolderBase {
  code?: never; // forbidden on real folders
  is_virtual: false;
}

export interface VirtualEmailFolder extends EmailFolderBase {
  code: string; // required when virtual
  is_virtual: true;
}

// ---------- Derived types ----------
type Folder = (typeof EMAIL_FOLDERS)[number];

type OnlyReal = Extract<Folder, { is_virtual: false }>;

type OnlyVirtual = Extract<Folder, { is_virtual: true }>;

// All folders (merged, exact keys/ids)
export type AllFolderKey = keyof typeof SPECIAL_FOLDERS | keyof typeof REGULAR_FOLDERS;

export type AllFoldersMap = typeof SPECIAL_FOLDERS & typeof REGULAR_FOLDERS;

export type EmailStatus = 'open' | 'closed';

export type HasRow = {
  email_id: string;
  has: boolean;
};

export type RegularFolderId = OnlyReal['id']; // '7' | '3' | '4' | '5'

export type RegularFolderKey = Uppercase<RegularFolderName>; // 'DRAFTS' | 'SENT' | 'SPAM' | 'TRASH'

export type RegularFolderName = OnlyReal['name']; // 'Drafts' | 'Sent' | 'Spam' | 'Trash'

export type ServerEmail = {
  assigned_to?: string | null;
  attachment_count?: number | string | bigint | null;
  folder_id: string | number;
  from_email?: string | null;
  is_read?: boolean;

  // any of these might be present depending on endpoint:
  has_attachment?: boolean | null;
  id: string | number;
  is_favourite: boolean;
  preview?: string | null;
  status?: string;
  subject?: string | null;
  to_email?: string | null;
  updated_at: string | Date;
  date_sent?: string | Date | null;
  sender_first_name?: string | null;
  sender_last_name?: string | null;
};

export type SpecialFolderId = OnlyVirtual['id'];

export type SpecialFolderKey = OnlyVirtual['code'];

export type StrictEmailFolderConfig = VirtualEmailFolder | RealEmailFolder;

function createRegularFolders<const F extends readonly StrictEmailFolderConfig[]>(folders: F) {
  type RegularFolder = Extract<F[number], { is_virtual: false }>;
  type FolderKey = Uppercase<RegularFolder['name'] & string>;
  type FolderId<K extends FolderKey> = Extract<RegularFolder, { name: Capitalize<Lowercase<K>> }>['id'];

  const entries = folders
    .filter((f): f is RegularFolder => !f.is_virtual)
    .map((f) => [f.name.toUpperCase() as FolderKey, f.id] as const);

  return Object.freeze(Object.fromEntries(entries)) as { readonly [K in FolderKey]: FolderId<K> };
}

function createSpecialFolders<const F extends readonly StrictEmailFolderConfig[]>(folders: F) {
  type VirtualFolder = Extract<F[number], { is_virtual: true }>;
  type FolderCode = VirtualFolder extends { code: infer C extends string } ? C : never;
  type FolderId<Code extends string> = Extract<VirtualFolder, { code: Code }>['id'];

  const entries = folders.filter((f): f is VirtualFolder => f.is_virtual).map((f) => [f.code, f.id] as const);

  return Object.freeze(Object.fromEntries(entries)) as { readonly [P in FolderCode]: FolderId<P> };
}

export const isRegularFolderId = (id: string): id is RegularFolderId =>
  Object.values(REGULAR_FOLDERS).includes(id as RegularFolderId);

// Optional runtime type guards
export const isSpecialFolderId = (id: string): id is SpecialFolderId =>
  Object.values(SPECIAL_FOLDERS).includes(id as SpecialFolderId);

// ---------- Configuration (validated against STRICT type) ----------
export const EMAIL_FOLDERS = [
  // Virtual
  { id: '9', name: 'Starred', icon: 'star', sort_order: 1, is_default: false, is_virtual: true, code: 'FAVOURITES' },
  {
    id: '8',
    name: 'Unassigned',
    icon: 'inbox',
    sort_order: 2,
    is_default: false,
    is_virtual: true,
    code: 'UNASSIGNED',
  },
  {
    id: '6',
    name: 'Mine',
    icon: 'user-circle',
    sort_order: 3,
    is_default: true,
    is_virtual: true,
    code: 'ASSIGNED_TO_ME',
  },
  {
    id: '1',
    name: 'Open',
    icon: 'document-duplicate',
    sort_order: 4,
    is_default: false,
    is_virtual: true,
    code: 'ALL_OPEN',
  },
  {
    id: '2',
    name: 'Closed',
    icon: 'document-check',
    sort_order: 5,
    is_default: false,
    is_virtual: true,
    code: 'CLOSED',
  },

  // Real
  { id: '11', name: 'Inbox', icon: 'inbox', sort_order: 6, is_default: false, is_virtual: false },
  { id: '7', name: 'Drafts', icon: 'document', sort_order: 7, is_default: false, is_virtual: false },
  { id: '10', name: 'Outbox', icon: 'clock', sort_order: 8, is_default: false, is_virtual: false },
  { id: '3', name: 'Sent', icon: 'paper-airplane', sort_order: 9, is_default: false, is_virtual: false },
  { id: '5', name: 'Trash', icon: 'trash', sort_order: 10, is_default: false, is_virtual: false },
  { id: '4', name: 'Spam', icon: 'exclamation-triangle', sort_order: 11, is_default: false, is_virtual: false },
] as const satisfies StrictEmailFolderConfig[];

// Real-only (exact keys/ids)
export const REGULAR_FOLDERS = createRegularFolders(EMAIL_FOLDERS);

// ---------- Exposed constants ----------

// Virtual-only (exact keys/ids)
export const SPECIAL_FOLDERS = createSpecialFolders(EMAIL_FOLDERS);
export const ALL_FOLDERS: AllFoldersMap = { ...SPECIAL_FOLDERS, ...REGULAR_FOLDERS } as const;

// Useful helpers
export const ALL_FOLDER_IDS = EMAIL_FOLDERS.map((f) => f.id) as ReadonlyArray<Folder['id']>;
export const FOLDER_BY_ID = Object.freeze(Object.fromEntries(EMAIL_FOLDERS.map((f) => [f.id, f]))) as Readonly<
  Record<Folder['id'], Folder>
>;
````

## File: libs/common/src/lib/jsend.ts
````typescript
export interface JSendErrorInterface {
  code?: string | number;
  message: string;
  status: 'error';
}

export interface JSendFailInterface<E extends object = Record<string, unknown>> {
  data: E;
  status: 'fail';
}

export interface JSendSuccessInterface<T> {
  data: T;
  status: 'success';
}

export class JSendError extends Error {
  public override name = 'JSendServerError';

  constructor(
    public readonly messageText: string,
    public readonly code?: string | number,
    public readonly statusCode: number = 500,
  ) {
    super(messageText || 'Server error');
  }
}

export class JSendFail<E extends object = Record<string, unknown>> extends Error {
  public override name = 'JSendFailError';

  constructor(
    public readonly data: E,
    public readonly statusCode: number = 400,
  ) {
    super('Request failed');
  }
}

export type JSend<T = unknown, E extends object = Record<string, unknown>> =
  | JSendSuccessInterface<T>
  | JSendFailInterface<E>
  | JSendErrorInterface;

export type JSendStatus = 'success' | 'fail' | 'error';

// Helpful status mapping (useful in backend)
export function httpStatusForJSend(obj: JSend): number {
  if (jsend.isSuccess(obj)) return 200;
  if (jsend.isFail(obj)) return 400; // choose per-case if needed
  return 500;
}

export const jsend = {
  success<T>(data: T): JSendSuccessInterface<T> {
    return { status: 'success', data };
  },
  fail<E extends object = Record<string, unknown>>(data: E): JSendFailInterface<E> {
    return { status: 'fail', data };
  },
  error(message: string, code?: string | number): JSendErrorInterface {
    return {
      status: 'error',
      message,
      ...(code !== undefined ? { code } : {}),
    };
  },

  isSuccess<T = unknown>(x: unknown): x is JSendSuccessInterface<T> {
    return (
      typeof x === 'object' &&
      x !== null &&
      'status' in x &&
      (x as Record<string, unknown>)['status'] === 'success' &&
      'data' in x
    );
  },
  isFail<E extends object = Record<string, unknown>>(x: unknown): x is JSendFailInterface<E> {
    return (
      typeof x === 'object' &&
      x !== null &&
      'status' in x &&
      (x as Record<string, unknown>)['status'] === 'fail' &&
      'data' in x
    );
  },
  isError(x: unknown): x is JSendErrorInterface {
    return (
      typeof x === 'object' &&
      x !== null &&
      'status' in x &&
      (x as Record<string, unknown>)['status'] === 'error' &&
      'message' in x
    );
  },

  unwrap<T>(res: JSend<T>): T {
    if (res.status === 'success') return res.data;
    if (res.status === 'fail') throw new JSendFail(res.data, 400);
    if (res.status === 'error') throw new JSendError(res.message, res.code, 500);
    throw new Error('Unknown JSend shape');
  },
};
````

## File: libs/common/src/lib/public-id.ts
````typescript
import { slugifyRecordName } from './utils';

/**
 * Opaque public identifiers for person records (spec §1 security surface).
 *
 * Unlike households/companies, persons do NOT use a name slug: at 100k+ people
 * name slugs collide (`amira-hassan-4787`), leak counts, and put real names in
 * URLs and logs — bad for a political CRM. Instead each person carries an
 * opaque `public_id`: 8 Crockford Base32 characters encoding 40 bits from a
 * CSPRNG (`crypto.randomBytes(5)` on the backend), stored uppercase-canonical
 * (e.g. `4T9K2XPM`).
 *
 * The URL display form (what the browser shows) is `{name}-{XXXX}-{XXXX}`, e.g.
 * `/people/joseph-4t9k-2xpm`: a decorative slugified first/last name followed by
 * the public_id split 4-4. The name is cosmetic — resolution strips it and looks
 * up by public_id only, so a stale name in an old URL still resolves.
 *
 * These helpers are shared by the frontend resolver and the backend so decode
 * and slug-building stay identical on both sides. Generation (randomBytes +
 * retry-on-collision) is backend-only — see
 * `apps/backend/src/app/lib/person-public-id.ts`.
 */

/** Crockford Base32 alphabet — excludes I, L, O, U to avoid visual/spoken ambiguity. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Canonical public_id length in characters (40 bits / 5 bits-per-char = 8). */
export const PUBLIC_ID_LENGTH = 8;

const CROCKFORD_SET = new Set(CROCKFORD_ALPHABET);

/**
 * Encode raw bytes to Crockford Base32 (big-endian, no padding). 5 bytes
 * (40 bits) produce exactly 8 characters. Bit accumulation is masked to stay
 * within JS's 32-bit bitwise range, so this is correct for any byte length.
 */
export function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_ALPHABET[(value >>> bits) & 31];
    }
    // Keep only the bits not yet emitted so `value` never exceeds ~12 bits.
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Normalize a Crockford string to canonical form: uppercase, map the
 * confusable letters back to digits (I/L → 1, O → 0), and drop any character
 * outside the alphabet (hyphens, spaces, etc.). The result contains only
 * canonical alphabet characters.
 */
export function normalizeCrockford(input: string): string {
  let output = '';
  for (const raw of input.toUpperCase()) {
    let ch = raw;
    if (ch === 'O') ch = '0';
    else if (ch === 'I' || ch === 'L') ch = '1';
    if (CROCKFORD_SET.has(ch)) output += ch;
  }
  return output;
}

/**
 * Decode a URL segment to a canonical person public_id, or `null` when it does
 * not contain one. Strips all hyphens, takes the last {@link PUBLIC_ID_LENGTH}
 * characters (the public_id is always appended last), then Crockford-normalizes.
 * Robust to a decorative name that itself contains hyphens (`mary-jane-4t9k-2xpm`
 * → `4T9K2XPM`), a bare id (`4t9k2xpm`), and a hyphenated bare id (`4T9K-2XPM`).
 */
export function extractPublicIdFromSlug(segment: string): string | null {
  const stripped = segment.replace(/-/g, '');
  const tail = stripped.slice(-PUBLIC_ID_LENGTH);
  const normalized = normalizeCrockford(tail);
  return normalized.length === PUBLIC_ID_LENGTH ? normalized : null;
}

/**
 * Build the person URL display slug `{name}-{xxxx}-{xxxx}` from a canonical
 * public_id. The decorative name is the slugified first name, else last name,
 * else the literal `person`. The id is lowercased and split 4-4 for readability
 * (e.g. `joseph-4t9k-2xpm`). Resolution ignores the name entirely.
 */
export function buildPersonSlug(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  publicId: string,
): string {
  const source = (firstName ?? '').trim() || (lastName ?? '').trim();
  const name = slugifyRecordName(source, 'person');
  const id = publicId.toLowerCase();
  return `${name}-${id.slice(0, 4)}-${id.slice(4, PUBLIC_ID_LENGTH)}`;
}
````

## File: libs/common/src/lib/sla.ts
````typescript
export function calculateWorkingTimeMs(
  startDate: Date,
  endDate: Date,
  workingDays: number[],
  workingHoursStart: string,
  workingHoursEnd: string,
): number {
  if (startDate.getTime() >= endDate.getTime()) {
    return 0;
  }

  // Parse start hour/minute
  const [startHour = NaN, startMin = NaN] = workingHoursStart.split(':').map(Number);
  // Parse end hour/minute
  const [endHour = NaN, endMin = NaN] = workingHoursEnd.split(':').map(Number);

  if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin) || workingDays.length === 0) {
    // Return standard elapsed time as fallback if settings are malformed
    return endDate.getTime() - startDate.getTime();
  }

  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const endLimit = new Date(endDate);
  endLimit.setHours(23, 59, 59, 999);

  let totalMs = 0;

  while (current.getTime() <= endLimit.getTime()) {
    const dayOfWeek = current.getDay();

    if (workingDays.includes(dayOfWeek)) {
      const workStart = new Date(current);
      workStart.setHours(startHour, startMin, 0, 0);

      const workEnd = new Date(current);
      workEnd.setHours(endHour, endMin, 0, 0);

      const actualStart = Math.max(startDate.getTime(), workStart.getTime());
      const actualEnd = Math.min(endDate.getTime(), workEnd.getTime());

      const overlap = actualEnd - actualStart;
      if (overlap > 0) {
        totalMs += overlap;
      }
    }

    // Step to the next day
    current.setDate(current.getDate() + 1);
  }

  return totalMs;
}
````

## File: libs/common/src/lib/utils.ts
````typescript
export function debounce<F extends (...args: any[]) => void>(fn: F, delay = 300) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Subdomain labels that must never be assigned to a tenant — they collide with app/infra hosts.
 * A tenant's slug becomes `<slug>.<baseDomain>`, so the public form page can resolve the tenant
 * from the Host header; these labels are reserved so a tenant can't shadow `app`, `api`, etc.
 */
export const RESERVED_SUBDOMAINS = new Set<string>([
  'app',
  'www',
  'api',
  'admin',
  'mail',
  'email',
  'ftp',
  'smtp',
  'imap',
  'pop',
  'ns',
  'ns1',
  'ns2',
  'dns',
  'mx',
  'static',
  'assets',
  'cdn',
  'media',
  'files',
  'download',
  'downloads',
  'status',
  'help',
  'support',
  'docs',
  'blog',
  'dev',
  'staging',
  'stage',
  'test',
  'demo',
  'sandbox',
  'portal',
  'dashboard',
  'account',
  'accounts',
  'billing',
  'pay',
  'payments',
  'auth',
  'login',
  'logout',
  'signup',
  'signin',
  'register',
  'public',
  'forms',
  'f',
  'localhost',
  'root',
  'system',
]);

/**
 * Turn a name into a DNS-safe subdomain label: lowercase, ASCII alphanumerics + single hyphens,
 * no leading/trailing hyphen, capped at 40 chars. Returns '' when nothing usable remains — callers
 * must fall back (e.g. `t-<id>`) and check {@link RESERVED_SUBDOMAINS}.
 */
export function slugifyHandle(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * Slugify a record's display name for slug-based record routing
 * (`/people/amira-hassan` \u2014 spec \u00a71: URLs carry slugs, never internal IDs).
 * Lowercase, accent-stripped, non-alphanumerics collapsed to single hyphens,
 * capped at 80 chars. Falls back to `fallback` (e.g. "person") when nothing
 * usable remains, and prefixes the fallback when the result is all digits so a
 * slug can never be mistaken for a numeric record-ID URL. Per-tenant
 * uniqueness is the caller's job \u2014 see `apps/backend/src/app/lib/slug.ts`.
 */
export function slugifyRecordName(value: string, fallback: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  if (!base) return fallback;
  if (/^\d+$/.test(base)) return `${fallback}-${base}`;
  return base;
}

/**
 * Escape a string for safe interpolation into HTML markup (element text or
 * double/single-quoted attribute values).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
````

## File: libs/common/eslint.config.cjs
````javascript
/* ---------------------------------------------------------------
 *  libs/common/eslint.config.cjs
 *  Universal shared library rules (used by frontend + backend)
 * -------------------------------------------------------------- */

const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  /* Compose the root config so `nx lint common` enforces the same
   * workspace-wide rules (no-floating-promises, no-misused-promises, etc.)
   * as the pre-commit `eslint` invocation. Confirmed zero new violations. */
  ...require('../../eslint.config.cjs'),

  /* JavaScript/TypeScript base rules */
  ...compat
    .config({
      extends: [
        'plugin:@nx/javascript',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/stylistic',
      ],
      parserOptions: {
        project: [
          require('path').resolve(__dirname, 'tsconfig.lib.json'),
          require('path').resolve(__dirname, '../../tsconfig.base.json'),
        ],
        sourceType: 'module',
      },
    })
    .map((cfg) => ({
      ...cfg,
      files: ['**/*.{ts,tsx,js,jsx}'],
      rules: {
        /* Shared TypeScript rules */
        '@typescript-eslint/consistent-type-imports': 'warn',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',

        /* General JS/TS best practices */
        'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
        'prefer-const': 'error',
        'no-var': 'error',
        'no-empty': ['warn', { allowEmptyCatch: true }],
      },
    })),
];
````

## File: libs/common/project.json
````json
{
  "name": "common",
  "$schema": "../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/common/src",
  "projectType": "library",
  "targets": {
    "lint": {
      "executor": "@nx/eslint:lint",
      "outputs": ["{options.outputFile}"],
      "options": {
        "lintFilePatterns": ["libs/common/**/*.ts"]
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "cache": true,
      "outputs": ["{workspaceRoot}/coverage/libs/common"],
      "options": {
        "cwd": "libs/common",
        "command": "vitest run"
      }
    }
  },
  "tags": []
}
````

## File: libs/common/tsconfig.json
````json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "es2022",
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "files": [],
  "include": [],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    }
  ]
}
````

## File: libs/common/tsconfig.lib.json
````json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/out-tsc",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.test.ts"]
}
````

## File: libs/uxcommon/src/components/address-autocomplete/address-autocomplete.ts
````typescript
import { Component, ElementRef, OnInit, effect, inject, input, output, viewChild } from '@angular/core';
import { Loader } from '@googlemaps/js-api-loader';
import { AddressType } from '../../../../common/src/lib/kysely.models';
import { parseAddress } from './googlePlacesAddressMapper';

/**
 * `<pc-address-autocomplete>` — a text input that upgrades into a Google Places
 * Autocomplete field (§6 / §13 / §14 maps ruling: Google Maps Platform only).
 *
 * Two shapes of consumer:
 * - **Search box** (household form): ignore `value`/`textChange`, listen to
 *   `addressSelected` to fan a structured `AddressType` into other fields.
 * - **Field of record** (plan-routes start address): seed with `value`, keep a
 *   signal in sync via `textChange` (freeform typing) *and* `addressSelected`
 *   (picking a suggestion).
 *
 * The `Loader` is injected **optionally** — mirroring `<pc-map>` — so unit tests
 * and any host without an API key keep a plain, fully-functional text input and
 * never touch the network.
 */
@Component({
  selector: 'pc-address-autocomplete',
  standalone: true,
  template: `
    <div class="relative w-full">
      <input
        #inputEl
        type="text"
        class="input w-full"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [value]="value()"
        (input)="onInput($event)"
        autocomplete="one-time-code"
      />
    </div>
  `,
})
export class AddressAutocomplete implements OnInit {
  /** Optional so unit tests (and any host without the SDK key) keep a plain text input. */
  private readonly loader = inject(Loader, { optional: true });

  public readonly disabled = input<boolean>(false);
  public readonly placeholder = input<string>('Start typing an address…');
  public readonly regionCodes = input<string[]>(['ca']);
  /** Seeds the field and reflects programmatic changes (for field-of-record use). */
  public readonly value = input<string>('');

  public readonly addressSelected = output<AddressType>();
  /** Raw text on every keystroke — for consumers that treat this as the field of record. */
  public readonly textChange = output<string>();

  private inputElement: HTMLInputElement | null = null;
  private isLibraryLoaded = false;
  private isAutocompleteInitialized = false;

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    effect(() => {
      const elRef = this.inputEl();
      if (elRef) {
        this.inputElement = elRef.nativeElement;
        this.tryInitAutocomplete();
      }
    });
  }

  public ngOnInit() {
    void this.initialize();
  }

  protected onInput(event: Event): void {
    this.textChange.emit((event.target as HTMLInputElement).value);
  }

  private async initialize() {
    if (!this.loader) return;
    try {
      await this.loader.importLibrary('places');
      this.isLibraryLoaded = true;
      this.tryInitAutocomplete();
    } catch (err) {
      // Bad key / offline / blocked — stay on the honest plain input.
      console.error('Failed to load Google Maps Places library', err);
    }
  }

  private tryInitAutocomplete() {
    if (
      this.isAutocompleteInitialized ||
      !this.inputElement ||
      !this.isLibraryLoaded ||
      typeof google === 'undefined' ||
      !google.maps ||
      !google.maps.places
    ) {
      return;
    }

    const options: google.maps.places.AutocompleteOptions = {
      componentRestrictions: { country: this.regionCodes() },
      types: ['geocode'],
    };

    const autocomplete = new google.maps.places.Autocomplete(this.inputElement, options);
    this.isAutocompleteInitialized = true;

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place) {
        const address = parseAddress(place);
        // Keep field-of-record consumers in sync with the picked formatted address.
        if (place.formatted_address) this.textChange.emit(place.formatted_address);
        this.addressSelected.emit(address);
      }
    });
  }
}
````

## File: libs/uxcommon/src/components/address-autocomplete/googlePlacesAddressMapper.ts
````typescript
import type { AddressType } from '../../../../common/src/lib/kysely.models';

type AddressTypeMapInterface = {
  [key in keyof AddressType]: string[];
};

export function parseAddress(place: google.maps.places.PlaceResult): AddressType {
  const address: AddressType = {};

  if (!place.address_components || place.address_components.length === 0) {
    return address;
  }

  const address_components: google.maps.GeocoderAddressComponent[] = place.address_components;

  address_components.forEach((component) => {
    for (const mapKey in googleAddressToAddressTypeMap) {
      const key = mapKey as keyof typeof googleAddressToAddressTypeMap;
      if (googleAddressToAddressTypeMap[key]?.indexOf(component.types[0]!) !== -1) {
        (address[key] as string) = key === 'country' ? component.short_name : component.long_name;
      }
    }
  });

  address.formatted_address = place.formatted_address;
  address.lat = place.geometry?.location?.lat();
  address.lng = place.geometry?.location?.lng();
  address.type = place.types && place.types[0];

  return address;
}

export function parsePlace(place: google.maps.places.Place): AddressType {
  const address: AddressType = {};

  const addressComponents = place.addressComponents;
  if (!addressComponents || addressComponents.length === 0) {
    return address;
  }

  addressComponents.forEach((component: any) => {
    for (const mapKey in googleAddressToAddressTypeMap) {
      const key = mapKey as keyof typeof googleAddressToAddressTypeMap;
      if (component.types && googleAddressToAddressTypeMap[key]?.indexOf(component.types[0]) !== -1) {
        (address[key] as string) = key === 'country' ? component.shortText : component.longText;
      }
    }
  });

  address.formatted_address = place.formattedAddress ?? undefined;
  address.lat = place.location?.lat() ?? undefined;
  address.lng = place.location?.lng() ?? undefined;
  address.type = (place.types && place.types[0]) ?? undefined;

  return address;
}

const googleAddressToAddressTypeMap: Partial<AddressTypeMapInterface> = {
  apt: ['subpremise'],
  street_num: ['street_number'],
  zip: ['postal_code'],
  street1: ['street_address', 'route'],
  city: [
    'locality',
    'sublocality',
    'sublocality_level_1',
    'sublocality_level_2',
    'sublocality_level_3',
    'sublocality_level_4',
  ],
  state: [
    'administrative_area_level_1',
    'administrative_area_level_2',
    'administrative_area_level_3',
    'administrative_area_level_4',
    'administrative_area_level_5',
  ],
  country: ['country'],
};
````

## File: libs/uxcommon/src/components/address-form-group/address-form-group.ts
````typescript
import { Component, input } from '@angular/core';
import { Input as PcInput } from '../input/input';

@Component({
  selector: 'pc-address-form-group',
  imports: [PcInput],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-col md:flex-row gap-3">
        <pc-input class="flex-1" placeholder="Unit / Apt" [formField]="form().apt"></pc-input>
        <pc-input class="flex-1" placeholder="Street Number" [formField]="form().street_num"></pc-input>
        <pc-input class="flex-2" placeholder="Street Name" [formField]="form().street1"></pc-input>
      </div>
      <div class="flex flex-col md:flex-row gap-3">
        <pc-input class="flex-1" placeholder="City" [formField]="form().city"></pc-input>
        <pc-input class="flex-1" placeholder="State / Province" [formField]="form().state"></pc-input>
        <pc-input class="flex-1" placeholder="Country" [formField]="form().country"></pc-input>
      </div>
      <div class="flex flex-col md:flex-row gap-3">
        <pc-input class="flex-1" placeholder="Zip / Postal Code" [formField]="form().zip"></pc-input>
        <pc-input class="flex-1" type="tel" placeholder="Home Phone" [formField]="form().home_phone"></pc-input>
        <div class="flex-1"></div>
      </div>
    </div>
  `,
})
export class AddressFormGroup {
  public form = input.required<any>();
}
````

## File: libs/uxcommon/src/components/alerts/alerts.html
````html
<div
  class="pointer-events-none z-50 flex w-full flex-col items-center gap-2 px-4"
  [class.absolute]="!isPositionRelative()"
  [class.left-0]="!isPositionRelative()"
  [class.top-4]="isPositionTop()"
  [class.bottom-4]="isPositionBottom()"
>
  @for (alert of alerts(); track alert.id) {
  <div
    class="pointer-events-auto relative flex max-w-[520px] cursor-pointer items-start gap-3 overflow-hidden rounded-[12px] border border-base-300 bg-base-100 py-3 pl-4 pr-3.5 shadow-[0_8px_30px_rgba(0,0,0,.16)]"
    role="alert"
    *pcAnimateIf="alert.visible; enter: getEnterAnim(); exit: getExitAnim()"
    (click)="dismiss(alert.id)"
  >
    <span aria-hidden="true" class="absolute inset-y-0 left-0 w-[5px] {{ barToneClass(alert.type) }}"></span>
    <span
      aria-hidden="true"
      class="mt-px flex shrink-0 items-center justify-center rounded-[8px] p-1.5 {{ chipToneClass(alert.type) }}"
    >
      <pc-icon [name]="icon(alert.type)" [size]="4" class="{{ toneClass(alert.type) }}"></pc-icon>
    </span>
    <div class="line-clamp-3 text-[12.5px] leading-[1.45] text-base-content [overflow-wrap:anywhere]">
      {{ alert.text }}
    </div>
    @if (alert.count() > 1) {
    <span
      class="mt-px shrink-0 rounded-full bg-base-content/10 px-[7px] py-px text-[10.5px] font-semibold tabular-nums text-base-content"
    >
      ×{{ alert.count() }}
    </span>
    }
  </div>
  }
</div>
````

## File: libs/uxcommon/src/components/alerts/alerts.ts
````typescript
import { Component, computed, inject, input } from '@angular/core';
import { Icon } from '@icons/icon';
import type { PcIconNameType } from '@icons/icons.index';
import { AnimateIfDirective } from '@uxcommon/directives/animate-if.directive';

import { ALERTTYPE, AlertService } from './alert-service';

@Component({
  selector: 'pc-alerts',
  imports: [Icon, AnimateIfDirective],
  templateUrl: './alerts.html',
})
export class Alerts {
  protected alertSvc = inject(AlertService);

  public position = input<'top' | 'bottom' | 'relative'>('bottom');

  protected readonly alerts = computed(() => {
    const list = this.alertSvc.alertList();
    // Service list is newest-first; render newest nearest the pinned edge
    // (bottom of the stack when pinned bottom — spec §2).
    return this.isPositionBottom() ? list.slice().reverse() : list;
  });

  protected dismiss(id: string): void {
    this.alertSvc.dismiss(id);
  }

  protected getEnterAnim(): string {
    return this.isPositionTop() || this.isPositionRelative() ? 'animate-down' : 'animate-up';
  }

  protected getExitAnim(): string {
    return this.isPositionTop() || this.isPositionRelative() ? 'animate-exit-up' : 'animate-exit-down';
  }

  protected icon(type?: ALERTTYPE): PcIconNameType {
    return type === 'success'
      ? 'check-circle'
      : type === 'warning'
        ? 'exclamation-triangle'
        : type === 'error'
          ? 'exclamation-circle'
          : 'information-circle';
  }

  protected isPositionBottom() {
    return this.position() === 'bottom';
  }

  protected isPositionRelative() {
    return this.position() === 'relative';
  }

  protected isPositionTop() {
    return this.position() === 'top';
  }

  /** Tone accent bar hugging the card's left edge — the card surface and text stay neutral. */
  protected barToneClass(type?: ALERTTYPE): string {
    return type === 'success'
      ? 'bg-success'
      : type === 'warning'
        ? 'bg-warning'
        : type === 'error'
          ? 'bg-error'
          : 'bg-info';
  }

  /** Soft tinted background for the icon chip — echoes the accent bar without shouting. */
  protected chipToneClass(type?: ALERTTYPE): string {
    return type === 'success'
      ? 'bg-success/10'
      : type === 'warning'
        ? 'bg-warning/10'
        : type === 'error'
          ? 'bg-error/10'
          : 'bg-info/10';
  }

  /** Tone lives on the icon and the left accent bar — the card surface and text stay neutral. */
  protected toneClass(type?: ALERTTYPE): string {
    return type === 'success'
      ? 'text-success'
      : type === 'warning'
        ? 'text-warning'
        : type === 'error'
          ? 'text-error'
          : 'text-info';
  }
}
````

## File: libs/uxcommon/src/components/autocomplete/autocomplete.ts
````typescript
import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { debounce } from '../../../../common/src';

@Component({
  selector: 'pc-autocomplete',
  template: ` <div
      class="input w-full flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5 cursor-text"
      (click)="focusInput()"
    >
      <ng-content></ng-content>
      <input
        #inputEl
        type="text"
        class="grow basis-0 min-w-0 border-none bg-transparent p-0 focus:outline-none"
        [placeholder]="placeholder()"
        (keyup)="onKey($event)"
        (keydown)="onKeyDown($event)"
        (input)="onInput($event)"
        (focus)="showAutoCompleteList()"
        (blur)="hideAutoCompleteList()"
      />
    </div>
    @if (matches().length && !hideAutoComplete()) {
      <ul class="w-full rounded-none bordered card shadow-lg text-gray-500 font-light">
        @for (match of matches(); track match) {
          <li class="tet-xs cursor-pointer hover:bg-gray-200 pl-4" (click)="reset(match)">
            {{ match.charAt(0).toUpperCase() + match.slice(1) }}
          </li>
        }
      </ul>
    }`,
})
export class AutoComplete {
  protected readonly matches = signal<string[]>([]);

  protected hideAutoComplete = signal(true);

  public readonly valueChange = output<string>();

  /** Emitted when Backspace is pressed while the text field is empty — lets the host pop the last chip. */
  public readonly backspaceEmpty = output<void>();

  public filterSvc = input<TFILTER | null>(null);
  public readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('inputEl');

  public placeholder = input('');

  private readonly debouncedFilter = debounce(async (key: string) => {
    const filterSvc = this.filterSvc();
    if (!filterSvc || !key?.length) {
      this.matches.set([]);
      return;
    }
    const matches = await filterSvc.filter(key);
    this.matches.set(matches);
  }, 250);

  protected onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.debouncedFilter(target.value || '');
  }

  protected hideAutoCompleteList() {
    setTimeout(() => this.hideAutoComplete.set(true), 200);
  }

  protected onKey(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Enter' || event.key === ',') {
      this.reset(target.value);
    }
  }

  protected onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Backspace' && target.value.length === 0) {
      this.backspaceEmpty.emit();
    }
  }

  protected focusInput() {
    this.inputRef()?.nativeElement.focus();
  }

  protected reset(key: string) {
    this.valueChange.emit(key);
    this.matches.set([]);
    if (this.inputRef()?.nativeElement) {
      this.inputRef().nativeElement.value = '';
    }
  }

  protected showAutoCompleteList() {
    this.hideAutoComplete.set(false);
  }
}

type TFILTER = {
  filter: (arg0: string) => Promise<string[]>;
};
````

## File: libs/uxcommon/src/components/breadcrumbs/breadcrumbs.service.ts
````typescript
import { Injectable, signal } from '@angular/core';

import { PcBreadcrumb } from './breadcrumbs';

/**
 * The full breadcrumb strip published by the current page: the crumb trail plus
 * the optional "N of M filtered" record pager. Pages set this; the navbar renders it.
 * The pager's prev/next are callbacks (not outputs) so they can route back to the
 * page that owns the record-navigation handle from wherever the strip is rendered.
 */
export interface BreadcrumbTrail {
  crumbs: PcBreadcrumb[];
  positionLabel: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Hoists the breadcrumb trail out of the page body and into the navbar.
 *
 * Every navigation gets a route-driven default trail (built from `data.breadcrumb`
 * by the frontend's BreadcrumbDefaultsService on NavigationEnd), so the strip is
 * never empty or stale. Pages that own a richer trail (detail views via
 * `pc-detail-header`, tabbed pages) `set()` theirs afterwards — their effects flush
 * after NavigationEnd, so the page's trail wins. No page needs to clear on destroy
 * anymore; the next navigation's default replaces whatever was published.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbsService {
  private readonly _trail = signal<BreadcrumbTrail | null>(null);
  public readonly trail = this._trail.asReadonly();

  public set(trail: BreadcrumbTrail): void {
    this._trail.set(trail);
  }

  /** Publish a plain crumb trail with no record pager — the common case. */
  public setCrumbs(crumbs: PcBreadcrumb[]): void {
    this._trail.set({
      crumbs,
      positionLabel: null,
      hasPrev: false,
      hasNext: false,
      prevLabel: 'Previous record',
      nextLabel: 'Next record',
      onPrev: () => undefined,
      onNext: () => undefined,
    });
  }

  public clear(): void {
    this._trail.set(null);
  }
}
````

## File: libs/uxcommon/src/components/breadcrumbs/breadcrumbs.ts
````typescript
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';

/**
 * A single breadcrumb entry. Crumbs with a `route` render as links;
 * the last crumb (the current page) renders as plain text.
 */
export interface PcBreadcrumb {
  label: string;
  route?: string | readonly unknown[];
}

@Component({
  selector: 'pc-breadcrumbs',
  imports: [RouterLink, Icon],
  template: `
    <div class="flex min-w-0 items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" class="min-w-0 text-xs text-base-content/50">
        <ol class="flex flex-wrap items-center gap-1.5">
          @for (crumb of crumbs(); track $index; let last = $last; let first = $first) {
            <li class="flex min-w-0 items-center gap-1.5">
              <!-- The first crumb doubles as the page title (pages no longer repeat it
                   in-body), so it renders larger and in full-contrast ink. -->
              @if (!last && crumb.route) {
                <a
                  [routerLink]="crumb.route"
                  class="max-w-48 truncate font-medium hover:underline"
                  [class]="first ? 'text-sm font-semibold text-base-content' : 'text-primary'"
                >
                  {{ crumb.label }}
                </a>
              } @else {
                <span
                  class="max-w-48 truncate font-medium"
                  [class]="first ? 'text-sm font-semibold text-base-content' : 'text-base-content/60'"
                  [attr.aria-current]="last ? 'page' : null"
                >
                  {{ crumb.label }}
                </span>
              }
              @if (!last) {
                <span class="select-none opacity-60" aria-hidden="true">/</span>
              }
            </li>
          }
        </ol>
      </nav>
      @if (positionLabel()) {
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-xs"
            [attr.aria-label]="prevLabel()"
            [disabled]="!hasPrev()"
            (click)="prev.emit()"
          >
            <pc-icon name="chevron-left" [size]="4"></pc-icon>
          </button>
          <span class="whitespace-nowrap px-1 text-xs tabular-nums text-base-content/50">{{ positionLabel() }}</span>
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-xs"
            [attr.aria-label]="nextLabel()"
            [disabled]="!hasNext()"
            (click)="next.emit()"
          >
            <pc-icon name="chevron-right" [size]="4"></pc-icon>
          </button>
        </div>
      }
    </div>
  `,
})
export class Breadcrumbs {
  public readonly crumbs = input.required<PcBreadcrumb[]>();

  /** Optional "N of M filtered" walk-the-list pager, rendered inline with the crumb trail. */
  public readonly positionLabel = input<string | null>(null);
  public readonly hasPrev = input<boolean>(false);
  public readonly hasNext = input<boolean>(false);
  public readonly prevLabel = input<string>('Previous record');
  public readonly nextLabel = input<string>('Next record');

  public readonly prev = output<void>();
  public readonly next = output<void>();
}
````

## File: libs/uxcommon/src/components/card/card.ts
````typescript
import { Component, input } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

@Component({
  selector: 'pc-card',
  imports: [Icon],
  template: `
    <div class="card bg-base-100 border border-base-300 shadow-md overflow-hidden w-full">
      <div class="card-body p-6 space-y-4">
        @if (title() || icon() || subtitle()) {
          <div class="flex items-start justify-between gap-4 pb-2">
            <div class="flex items-start gap-2.5">
              @if (icon()) {
                <pc-icon [name]="icon()!" class="text-primary mt-0.5" [size]="5"></pc-icon>
              }
              <div>
                @if (title()) {
                  <h3 class="font-bold text-lg text-base-content leading-tight">{{ title() }}</h3>
                }
                @if (subtitle()) {
                  <p class="text-xs text-base-content/60 mt-0.5 leading-normal">{{ subtitle() }}</p>
                }
              </div>
            </div>
            <div class="flex items-center gap-2">
              <ng-content select="[pc-card-actions]"></ng-content>
            </div>
          </div>
          <div class="border-b border-base-200 -mt-2"></div>
        }

        <div class="space-y-4">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class Card {
  public title = input<string>();
  public subtitle = input<string>();
  public icon = input<PcIconNameType>();
}
````

## File: libs/uxcommon/src/components/csv-import/csv.worker.ts
````typescript
// CSV/TSV parsing web worker (shared)
// Receives: { type: 'parse', text: string }
// Posts: { type: 'result', headers: string[], rows: Array<Record<string,string>> } or { type: 'error', message }

function detectDelimiter(sample: string[]) {
  const candidates = [',', '\t', ';'];
  let best: { ch: string; score: number } = { ch: ',', score: -1 };
  for (const ch of candidates) {
    let score = 0;
    for (let i = 0; i < Math.min(sample.length, 5); i++) {
      const line = sample[i] ?? '';
      if (/^\s*Page\s+\d+\s+of\s+\d+\s*$/i.test(line)) continue;
      score += line.split(ch).length - 1 || 0;
    }
    if (score > best.score) best = { ch, score };
  }
  return best.ch;
}

function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

const ctx: any = self as unknown;

ctx.onmessage = (e: MessageEvent) => {
  try {
    const { type, text } = e.data || {};
    if (type !== 'parse' || typeof text !== 'string') return;

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const delimiter = detectDelimiter(lines);
    const headerLine = lines.find((l) => !!l && !/^\s*Page\s+\d+\s+of\s+\d+\s*$/i.test(l)) || '';
    const headers = splitLine(headerLine, delimiter);
    const rows: Array<Record<string, string>> = [];

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!rawLine) continue;
      if (rawLine === headerLine) continue;
      if (/^\s*Page\s+\d+\s+of\s+\d+\s*$/i.test(rawLine)) continue;
      const cols = splitLine(rawLine, delimiter);
      if (cols.every((c) => !c || c.trim().length === 0)) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => (row[h] = cols[idx] ?? ''));
      rows.push(row);
    }

    ctx.postMessage({ type: 'result', headers, rows });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Parse failed' });
  }
};
````

## File: libs/uxcommon/src/components/csv-import/persons-field-mapping.ts
````typescript
/**
 * Shared header-to-field auto-mapping heuristic for importing people from a
 * CSV/TSV file. Originally lived inline in `persons-grid.ts` (the legacy
 * modal importer); the CSV import wizard (spec §17, `/imports/new`) reuses it
 * verbatim rather than re-deriving a second mapping table.
 */
export const PERSONS_MAPPABLE_FIELDS: string[] = [
  'first_name',
  'middle_names',
  'last_name',
  'email',
  'email2',
  'mobile',
  'home_phone',
  'street_num',
  'street1',
  'street2',
  'apt',
  'city',
  'state',
  'zip',
  'country',
  'company',
  'tags',
  'notes',
];

const HEADER_TO_FIELD: Record<string, string> = {
  firstname: 'first_name',
  fname: 'first_name',
  givenname: 'first_name',
  middlename: 'middle_names',
  middlenames: 'middle_names',
  middleinitial: 'middle_names',
  lastname: 'last_name',
  lname: 'last_name',
  surname: 'last_name',
  familyname: 'last_name',
  name: 'first_name',
  email: 'email',
  emailaddress: 'email',
  email1: 'email',
  email1address: 'email',
  primaryemail: 'email',
  email2: 'email2',
  email2address: 'email2',
  secondaryemail: 'email2',
  mobile: 'mobile',
  mobilephone: 'mobile',
  cellphone: 'mobile',
  cell: 'mobile',
  phone: 'mobile',
  phonenumber: 'mobile',
  telephone: 'mobile',
  primaryphone: 'mobile',
  businessphone: 'mobile',
  homephone: 'home_phone',
  streetnum: 'street_num',
  streetnumber: 'street_num',
  homestreet: 'street1',
  homestreet1: 'street1',
  homestreet2: 'street2',
  homestreet3: 'street2',
  homeaddress: 'street1',
  homeaddresspobox: 'street2',
  homecity: 'city',
  homestate: 'state',
  homepostalcode: 'zip',
  homecountry: 'country',
  businessstreet: 'street1',
  businessstreet1: 'street1',
  businessstreet2: 'street2',
  businessstreet3: 'street2',
  businessaddress: 'street1',
  businessaddresspobox: 'street2',
  businesscity: 'city',
  businessstate: 'state',
  businesspostalcode: 'zip',
  businesscountry: 'country',
  address: 'street1',
  address1: 'street1',
  address2: 'street2',
  addressline1: 'street1',
  addressline2: 'street2',
  street: 'street1',
  streetaddress: 'street1',
  street1: 'street1',
  street2: 'street2',
  apt: 'apt',
  apartment: 'apt',
  unit: 'apt',
  suite: 'apt',
  city: 'city',
  town: 'city',
  state: 'state',
  province: 'state',
  stateprovince: 'state',
  region: 'state',
  zip: 'zip',
  zipcode: 'zip',
  postal: 'zip',
  postalcode: 'zip',
  postcode: 'zip',
  country: 'country',
  company: 'company',
  companyname: 'company',
  organization: 'company',
  organisation: 'company',
  employer: 'company',
  business: 'company',
  tag: 'tags',
  tags: 'tags',
  label: 'tags',
  labels: 'tags',
  groups: 'tags',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

/** Best-effort guess of which persons field a CSV header maps to, or '' (skip) if unknown. */
export function autoMapPersonsHeader(header: string): string {
  const raw = (header || '').toLowerCase().trim();
  const key = raw.replace(/[^a-z0-9]/g, '');
  return HEADER_TO_FIELD[key] || '';
}
````

## File: libs/uxcommon/src/components/detail-item/detail-item.ts
````typescript
import { Component, inject, input, output } from '@angular/core';
import { AlertService } from '../alerts/alert-service';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

@Component({
  selector: 'pc-detail-item',
  imports: [Icon],
  template: `
    <div class="flex flex-col gap-1 mb-4">
      <span class="pc-eyebrow">
        {{ label() }}
      </span>
      <div class="flex items-center gap-2">
        @if (icon()) {
          <pc-icon [name]="icon()!" [size]="4" class="text-base-content/40 flex-shrink-0"></pc-icon>
        }
        @if (value() && link()) {
          <button
            type="button"
            class="cursor-pointer text-left text-sm font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary break-words"
            (click)="linkClicked.emit()"
          >
            {{ value() }}
          </button>
        } @else {
          <span class="text-sm font-medium text-base-content break-words">
            @if (value()) {
              {{ value() }}
            } @else {
              <span class="italic text-base-content/30">Not provided</span>
            }
          </span>
        }
        @if (value() && copyable()) {
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle text-base-content/50 hover:text-primary tooltip flex-shrink-0"
            [attr.data-tip]="'Copy ' + label()"
            (click)="copyToClipboard($event)"
          >
            <pc-icon name="document-duplicate" [size]="4"></pc-icon>
          </button>
        }
      </div>
    </div>
  `,
})
export class DetailItem {
  public label = input.required<string>();
  public value = input<string | null | undefined>();
  public icon = input<PcIconNameType | null | undefined>();
  public copyable = input<boolean>(false);
  /** Render the value as a clickable link that emits `linkClicked` (e.g. Address → Household). */
  public link = input<boolean>(false);
  public readonly linkClicked = output<void>();

  private readonly alertSvc = inject(AlertService);

  protected copyToClipboard(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    const val = this.value();
    if (!val) return;

    navigator.clipboard
      .writeText(val)
      .then(() => {
        this.alertSvc.showSuccess(`${this.label()} copied to clipboard`);
      })
      .catch(() => {
        this.alertSvc.showError(`Failed to copy ${this.label()}`);
      });
  }
}
````

## File: libs/uxcommon/src/components/detail-layout/detail-layout.ts
````typescript
import { Component, input, output } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';
import { PcBreadcrumb } from '../breadcrumbs/breadcrumbs';
import { DetailHeader } from '../detail-header/detail-header';

@Component({
  selector: 'pc-detail-layout',
  imports: [Icon, DetailHeader],
  host: {
    '(document:keydown)': 'handleKeydown($event)',
  },
  template: `
    <div class="flex min-h-full flex-col bg-base-200/50 p-6">
      <div class="flex w-full max-w-7xl flex-col gap-6">
        <!-- Header -->
        <pc-detail-header
          [title]="title()"
          [subtitle]="subtitle()"
          [crumbs]="crumbs()"
          [eyebrow]="eyebrow()"
          [statusChip]="statusChip()"
          [icon]="icon()"
          [iconSize]="iconSize()"
          [avatarText]="avatarText()"
          [isLoading]="isLoading()"
          [disabled]="disabled()"
          [showActions]="showActions()"
          [showDelete]="showDelete()"
          [showCancel]="showCancel()"
          [deleteText]="deleteText()"
          [btn1Text]="btn1Text()"
          [btn1Icon]="btn1Icon()"
          [positionLabel]="positionLabel()"
          [hasPrev]="hasPrev()"
          [hasNext]="hasNext()"
          [prevLabel]="prevLabel()"
          [nextLabel]="nextLabel()"
          (save)="save.emit($event)"
          (delete)="delete.emit()"
          (prevRecord)="prevRecord.emit()"
          (nextRecord)="nextRecord.emit()"
        >
          <ng-content select="[pc-title-suffix]" pc-title-suffix></ng-content>
          <ng-content select="[pc-actions-prefix]" pc-actions-prefix></ng-content>
          <ng-content select="[pc-actions-suffix]" pc-actions-suffix></ng-content>
          <ng-content select="[pc-overflow-extra]" pc-overflow-extra></ng-content>
        </pc-detail-header>

        <!-- Body/Content Area -->
        @if (isLoading()) {
          <div class="flex justify-center items-center py-20">
            <progress class="progress w-56"></progress>
          </div>
        } @else if (error()) {
          <div class="alert alert-error shadow-md border-error/20 flex items-center gap-3">
            <pc-icon name="exclamation-triangle" [size]="6"></pc-icon>
            <span>{{ error() }}</span>
          </div>
        } @else if (!hasRecord()) {
          <div class="alert alert-error shadow-md border-error/20 flex items-center gap-3">
            <pc-icon name="exclamation-triangle" [size]="6"></pc-icon>
            <span>{{ notFoundText() }}</span>
          </div>
        } @else {
          <!-- Main Content Slot -->
          <ng-content></ng-content>
        }
      </div>
    </div>
  `,
})
export class DetailLayout {
  public title = input.required<string>();
  public subtitle = input<string | null | undefined>();
  public crumbs = input<PcBreadcrumb[]>([]);
  public eyebrow = input<string>('');
  /** Optional success-tinted status chip beside the title (§3). */
  public statusChip = input<string | null>(null);
  public icon = input<PcIconNameType | null | undefined>();
  public iconSize = input<number>(6);
  /** Optional initials for a circular avatar left of the title (forwarded to the header). */
  public avatarText = input<string | null>(null);
  public isLoading = input.required<boolean>();
  public error = input<string | null | undefined>();
  public hasRecord = input<boolean>(true);
  public notFoundText = input<string>('Record not found or failed to load.');

  public showActions = input<boolean>(true);
  public showDelete = input<boolean>(false);
  /** A read/detail view has no edit to cancel — the header action is a navigation
   * "Edit". Off by default; edit forms use pc-detail-header directly and keep it. */
  public showCancel = input<boolean>(false);
  public deleteText = input<string>('Delete');
  public btn1Text = input<string>('Edit');
  public btn1Icon = input<PcIconNameType>('pencil-square');
  public disabled = input<boolean>(false);

  /** Optional "N of M filtered" pager; also drives J/K keyboard navigation while this page is open. */
  public positionLabel = input<string | null>(null);
  public hasPrev = input<boolean>(false);
  public hasNext = input<boolean>(false);
  public prevLabel = input<string>('Previous record');
  public nextLabel = input<string>('Next record');

  public readonly save = output<any>();
  public readonly delete = output<void>();
  public readonly prevRecord = output<void>();
  public readonly nextRecord = output<void>();

  protected handleKeydown(event: KeyboardEvent): void {
    if (!this.positionLabel()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === 'j' && this.hasNext()) {
      event.preventDefault();
      this.nextRecord.emit();
    } else if (key === 'k' && this.hasPrev()) {
      event.preventDefault();
      this.prevRecord.emit();
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}
````

## File: libs/uxcommon/src/components/detail-row/detail-row.ts
````typescript
import { Component, input, output } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

@Component({
  selector: 'pc-detail-row',
  imports: [Icon],
  template: `
    <div
      class="flex items-center justify-between p-2 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors text-sm w-full min-w-0 gap-3"
    >
      <div class="flex items-center gap-2 overflow-hidden min-w-0">
        @if (icon()) {
          <pc-icon [name]="icon()!" [size]="4" [class]="iconClass() + ' flex-shrink-0'"></pc-icon>
        }
        <div class="truncate text-base-content min-w-0">
          <ng-content></ng-content>
        </div>
      </div>

      @if (actionIcon()) {
        <button
          class="btn btn-ghost btn-xs btn-circle text-base-content/50 hover:text-primary tooltip flex-shrink-0"
          [attr.data-tip]="actionTip()"
          (click)="onActionClick($event)"
        >
          <pc-icon [name]="actionIcon()!" [size]="4"></pc-icon>
        </button>
      } @else {
        <ng-content select="[pc-row-action]"></ng-content>
      }
    </div>
  `,
})
export class DetailRow {
  public icon = input<PcIconNameType | null | undefined>();
  public iconClass = input<string | null | undefined>('');
  public actionIcon = input<PcIconNameType | null | undefined>();
  public actionTip = input<string | null | undefined>('');

  public actionClick = output<MouseEvent>();

  protected onActionClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.actionClick.emit(event);
  }
}
````

## File: libs/uxcommon/src/components/empty-state/empty-state.ts
````typescript
import { Component, input } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

/**
 * The one empty-state idiom (design §3): icon + sentence naming the cause +
 * ONE projected action button. Never italic grey placeholder text.
 *
 * `bordered` (default) draws the dashed full-surface container; turn it off
 * when the surrounding surface (a table cell, a card body) already frames it.
 */
@Component({
  selector: 'pc-empty-state',
  imports: [Icon],
  template: `
    <div
      class="flex flex-col items-center gap-3 py-16 text-center"
      [class.rounded-xl]="bordered()"
      [class.border]="bordered()"
      [class.border-dashed]="bordered()"
      [class.border-base-300]="bordered()"
    >
      <pc-icon [name]="icon()" [size]="8" class="opacity-30" />
      <span class="text-base font-medium">{{ title() }}</span>
      @if (hint(); as h) {
        <span class="text-sm opacity-70">{{ h }}</span>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  public readonly bordered = input<boolean>(true);
  public readonly hint = input<string>();
  public readonly icon = input.required<PcIconNameType>();
  public readonly title = input.required<string>();
}
````

## File: libs/uxcommon/src/components/entity-overview/entity-overview.ts
````typescript
import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'pc-entity-overview',
  imports: [DatePipe],
  template: `
    <div class="card bg-base-200/50 border border-base-300 shadow-md">
      <div class="card-body p-5 space-y-3">
        <h4 class="font-bold text-sm text-base-content uppercase tracking-wider">{{ title() }}</h4>
        <div class="text-xs text-base-content/75 space-y-2">
          <ng-content select="[pc-overview-prefix]"></ng-content>

          @if (createdAt()) {
            <div class="flex justify-between">
              <span>Created:</span>
              <span class="font-semibold">{{ createdAt() | date: 'medium' }}</span>
            </div>
          }
          @if (updatedAt()) {
            <div class="flex justify-between">
              <span>Last Updated:</span>
              <span class="font-semibold">{{ updatedAt() | date: 'medium' }}</span>
            </div>
          }
          @if (createdBy()) {
            <div class="flex justify-between">
              <span>Created By:</span>
              <span class="font-semibold">{{ createdBy() }}</span>
            </div>
          }

          <ng-content select="[pc-overview-suffix]"></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class EntityOverview {
  public title = input<string>('Overview');
  public createdAt = input<any>();
  public updatedAt = input<any>();
  public createdBy = input<string | null | undefined>();
}
````

## File: libs/uxcommon/src/components/fields-selector/fields-selector.html
````html
<div class="space-y-0.5">
  <!-- Email is always required and locked -->
  <div class="flex items-center justify-between py-1 px-2 hover:bg-base-200/50 rounded-lg transition-colors">
    <label class="flex items-center gap-2.5 cursor-not-allowed select-none">
      <input type="checkbox" checked disabled class="checkbox checkbox-sm checkbox-primary" />
      <span class="text-sm font-bold text-primary">Email Address</span>
    </label>
    <span class="badge badge-sm badge-outline text-[10px] font-bold">Required</span>
  </div>

  @for (field of allFields; track field.key) {
  <div class="flex items-center justify-between py-1 px-2 hover:bg-base-200/50 rounded-lg transition-colors">
    <label class="flex items-center gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        [checked]="isEnabled(field.key)"
        (change)="toggleField(field.key)"
        class="checkbox checkbox-sm checkbox-primary"
      />
      <span class="text-sm font-medium text-base-content/85">{{ field.label }}</span>
    </label>
    @if (isEnabled(field.key)) {
    <button
      type="button"
      (click)="toggleRequired(field.key)"
      class="btn btn-xs rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-all"
      [class.btn-primary]="isRequired(field.key)"
      [class.btn-outline]="!isRequired(field.key)"
      [class.btn-accent]="!isRequired(field.key)"
    >
      {{ isRequired(field.key) ? 'Required' : 'Optional' }}
    </button>
    }
  </div>
  }
</div>
````

## File: libs/uxcommon/src/components/fields-selector/fields-selector.ts
````typescript
import { Component, input, output } from '@angular/core';

const ALL_FIELDS: { key: string; label: string }[] = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'mobile', label: 'Mobile / Phone' },
  { key: 'notes', label: 'Notes' },
  { key: 'street1', label: 'Street Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / Province' },
  { key: 'zip', label: 'Zip / Postal Code' },
  { key: 'country', label: 'Country' },
];

@Component({
  selector: 'pc-fields-selector',
  templateUrl: './fields-selector.html',
})
export class FieldsSelector {
  readonly selectedFields = input.required<string[]>();
  readonly fieldsChange = output<string[]>();

  protected readonly allFields = ALL_FIELDS;

  protected isEnabled(field: string): boolean {
    const list = this.selectedFields();
    return list.includes(field) || list.includes(`${field}:required`);
  }

  protected isRequired(field: string): boolean {
    return this.selectedFields().includes(`${field}:required`);
  }

  protected toggleField(field: string): void {
    const current = this.selectedFields();
    const enabled = current.includes(field) || current.includes(`${field}:required`);
    if (enabled) {
      this.fieldsChange.emit(current.filter((f) => f !== field && f !== `${field}:required`));
    } else {
      this.fieldsChange.emit([...current, field]);
    }
  }

  protected toggleRequired(field: string): void {
    const current = this.selectedFields();
    if (current.includes(field)) {
      this.fieldsChange.emit([...current.filter((f) => f !== field), `${field}:required`]);
    } else if (current.includes(`${field}:required`)) {
      this.fieldsChange.emit([...current.filter((f) => f !== `${field}:required`), field]);
    }
  }
}
````

## File: libs/uxcommon/src/components/form-actions/form-actions.html
````html
<div class="flex gap-2 justify-center">
  <button
    type="button"
    class="btn btn-primary gap-2"
    [class.btn-xs]="size() === 'xs'"
    [class.btn-sm]="size() === 'sm'"
    (click)="handleBtn1Clicked()"
    [disabled]="isSaveDisabled"
  >
    @if (isLoading()) {
    <span class="loading loading-spinner loading-xs text-primary-content"></span>
    } @else {
    <pc-icon [name]="btn1Icon()" [size]="4" />
    } {{ btn1Text() }}
  </button>

  @if (showDelete()) {
  <button
    type="button"
    class="btn btn-error btn-outline gap-2"
    [class.btn-xs]="size() === 'xs'"
    [class.btn-sm]="size() === 'sm'"
    (click)="handleDeleteClicked()"
    [disabled]="isLoading()"
  >
    <pc-icon name="trash" [size]="4" />
    {{ deleteText() }}
  </button>
  } @if (buttonsToShow() === 'three' && !showDelete()) {
  <button
    type="button"
    class="btn btn-primary"
    [class.btn-xs]="size() === 'xs'"
    [class.btn-sm]="size() === 'sm'"
    (click)="handleBtn2Clicked()"
    [disabled]="isSaveDisabled"
  >
    @if (isLoading()) {
    <span class="loading loading-spinner loading-xs text-primary-content"></span>
    } @else { {{ btn2Text() }} }
  </button>
  } @if (showCancel()) {
  <button
    type="button"
    class="btn btn-outline btn-accent gap-2"
    [class.btn-xs]="size() === 'xs'"
    [class.btn-sm]="size() === 'sm'"
    (click)="cancel()"
    [disabled]="isLoading()"
  >
    <pc-icon name="x-mark" [size]="4" />
    Cancel
  </button>
  }
</div>
````

## File: libs/uxcommon/src/components/form-actions/form-actions.ts
````typescript
import { Component, inject, input, output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

/**
 * Minimal structural view of a signal-forms root (the object returned by
 * `form()` from '@angular/forms/signals'): calling it yields the root field
 * state. Kept structural so this shared control does not depend on the
 * experimental signal-forms types directly.
 */
export type SignalFormRoot = () => {
  dirty(): boolean;
  invalid(): boolean;
  reset(): void;
};

@Component({
  selector: 'pc-form-actions',
  imports: [Icon],
  templateUrl: './form-actions.html',
})
export class FormActions {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private stay = false;

  public signalForm = input<SignalFormRoot>();

  public disabled = input<boolean>(false);

  /**
   * §4 "Save never disables": when true, the primary button stays enabled
   * regardless of validity/dirtiness (only `isLoading`/`disabled` gate it). The
   * consuming form is expected to guide on click (markAsTouched + focus the
   * first invalid field) rather than block via a dead button.
   */
  public saveAlwaysEnabled = input<boolean>(false);

  public showDelete = input<boolean>(false);

  /** Whether to render the Cancel button. Read/detail views turn this off — a
   * read view has no edit to cancel; the header's action is a navigation "Edit". */
  public showCancel = input<boolean>(true);

  public deleteText = input<string>('Delete');

  public readonly deleteClicked = output<void>();

  public readonly btn1Clicked = output<() => void>();

  public btn1Icon = input<PcIconNameType>('save');

  public btn1Text = input<string>('Save');

  public btn2Text = input<string>('Save & add more');

  public buttonsToShow = input<'two' | 'three'>('three');

  /** Button size; detail-header uses 'xs' to sit inline with the compact record pager. */
  public size = input<'xs' | 'sm'>('sm');

  public isLoading = input.required<boolean>();

  protected get isSaveDisabled(): boolean {
    if (this.isLoading()) return true;
    if (this.disabled()) return true;
    // Save never disables on validity/dirtiness — the form guides on click.
    if (this.saveAlwaysEnabled()) return false;
    const sigF = this.signalForm();
    if (sigF) {
      return sigF().invalid() || !sigF().dirty();
    }
    // No form at all: plain button bar (e.g. list-view) — never gate Save.
    return false;
  }

  public cancel(): void {
    void this.router.navigate(['../'], { relativeTo: this.route });
  }

  public handleDeleteClicked(): void {
    this.deleteClicked.emit();
  }

  public handleBtn1Clicked(): void {
    this.stay = false;
    this.btn1Clicked.emit(this.stayOrCancel);
  }

  public handleBtn2Clicked(): void {
    this.stay = true;
    this.btn1Clicked.emit(this.stayOrCancel);
  }

  public stayOrCancel = (): void => {
    if (this.stay) {
      this.signalForm()?.().reset();
    } else {
      this.cancel();
    }
  };
}
````

## File: libs/uxcommon/src/components/grid-header/grid-header.ts
````typescript
import { Component, computed, input, signal } from '@angular/core';
import { Icon } from '@icons/icon';

@Component({
  selector: 'pc-grid-header',
  imports: [Icon],
  template: `
    <header class="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <!-- The visible page title is the navbar breadcrumb's first crumb; keep an
             sr-only h1 so the page still has an accessible heading. -->
        <h1 class="sr-only">{{ title() }}</h1>
        <div class="flex items-center gap-1.5">
          @if (countText(); as text) {
            <p class="text-xs tabular-nums text-base-content/60" aria-live="polite">{{ text }}</p>
          }
          @if (description()) {
            <button
              type="button"
              class="btn btn-circle btn-ghost btn-xs text-base-content/40 hover:text-primary"
              aria-label="About this page"
              [attr.aria-expanded]="descriptionOpen()"
              (click)="toggleDescription()"
            >
              <pc-icon name="information-circle" [size]="4"></pc-icon>
            </button>
          }
        </div>
        @if (descriptionOpen() && description()) {
          <p class="mt-1 max-w-2xl text-xs leading-relaxed text-base-content/60">{{ description() }}</p>
        }
      </div>
      <div class="flex items-center gap-2">
        <ng-content></ng-content>
      </div>
    </header>
  `,
})
export class GridHeaderComponent {
  public readonly title = input.required<string>();
  public readonly description = input<string>('');
  public readonly eyebrow = input<string>('');

  /** Initial expanded state of the description; the ⓘ button toggles it afterwards. */
  public readonly open = input<boolean>(false);

  /** Total row count for the current query; null while unknown (before the first load). */
  public readonly totalCount = input<number | null>(null);

  /** Whether any user-applied filter is narrowing the results. */
  public readonly filtered = input<boolean>(false);

  /**
   * Optional caller-provided sentence for the unfiltered total, e.g. "5,012 people total"
   * or "1,890 households across 8 wards". When filters are active it is appended after the
   * matched count: "43 match your filters · 5,012 people total".
   */
  public readonly totalSentence = input<string | null>(null);

  private readonly descToggled = signal<boolean | null>(null);
  protected readonly descriptionOpen = computed(() => this.descToggled() ?? this.open());

  private readonly countFormatter = new Intl.NumberFormat();

  protected readonly countText = computed<string | null>(() => {
    const count = this.totalCount();
    const sentence = this.totalSentence();
    if (count !== null && this.filtered()) {
      const matched =
        count === 1 ? '1 matches your filters' : `${this.countFormatter.format(count)} match your filters`;
      return sentence ? `${matched} · ${sentence}` : matched;
    }
    if (sentence) return sentence;
    if (count === null) return null;
    return count === 1 ? '1 total' : `${this.countFormatter.format(count)} total`;
  });

  protected toggleDescription(): void {
    this.descToggled.set(!this.descriptionOpen());
  }
}
````

## File: libs/uxcommon/src/components/icons/attachment-icon.ts
````typescript
// attachment-icon.component.ts
import { Component, computed, input } from '@angular/core';
import { ICON_FOR_KEY, iconKeyForFilename } from '@uxcommon/pipes/file-icon.util';

import { Icon } from './icon';

@Component({
  selector: 'pc-attachment-icon',
  imports: [Icon],
  template: ` <pc-icon [name]="icon()" [size]="size()" [class]="className()" [attr.title]="title()"></pc-icon> `,
})
export class AttachmentIconComponent {
  public className = input<string>('');

  // Inputs (signals API)
  public filename = input.required<string>();
  public icon = computed(() => {
    const key = iconKeyForFilename(this.filename());
    return ICON_FOR_KEY[key] ?? ICON_FOR_KEY.unknown;
  });
  public size = input<number>(6);
  public title = input<string | undefined>(undefined);
}
````

## File: libs/uxcommon/src/components/icons/icon.ts
````typescript
import { Component, WritableSignal, effect, input, signal } from '@angular/core';
import { BypassHtmlSanitizerPipe } from '@uxcommon/pipes/svg-html-pipe';

import { PcIconNameType, loadIconSvg } from './icons.index';

@Component({
  selector: 'pc-icon',
  imports: [BypassHtmlSanitizerPipe],
  template: `
    <div [class]="class()" (mouseenter)="hovering.set(true)" (mouseleave)="hovering.set(false)">
      @if (!hover() || !hovering()) {
        <div [innerHTML]="svgHtml() | bypassHtmlSanitizer"></div>
      } @else {
        <div [innerHTML]="hoverSvgHtml() | bypassHtmlSanitizer"></div>
      }
    </div>
  `,
})
export class Icon {
  private _hoverSvgHtml = signal<string>('');

  private _svgHtml = signal<string>('');

  public class = input<string>('');
  public hover = input<PcIconNameType | null>();
  public hoverSvgHtml = this._hoverSvgHtml.asReadonly();
  public hovering = signal(false);

  public name = input.required<PcIconNameType>();

  public size = input<number>(6);
  public svgHtml = this._svgHtml.asReadonly();

  constructor() {
    // Re-load whenever name or size changes
    effect(() => {
      void this.loadSvg(this.name(), this.size(), this._svgHtml);
    });

    effect(() => {
      const hoverName = this.hover();
      const size = this.size();
      if (!hoverName) {
        this._hoverSvgHtml.set('');
        return;
      }
      void this.loadSvg(hoverName, size, this._hoverSvgHtml);
    });
  }

  private injectClassOnSvg(svg: string, cls: string): string {
    // Normalize whitespace on the opening tag
    const openTagMatch = svg.match(/<svg\b[^>]*>/i);
    if (!openTagMatch) return svg; // not an SVG? bail

    const openTag = openTagMatch[0];

    // If class already exists, merge; otherwise add new class attribute
    if (/\bclass=/.test(openTag)) {
      const merged = openTag.replace(/\bclass=(["'])(.*?)\1/i, (_m, q, existing) => {
        // Remove existing sizing classes to prevent override conflicts (e.g. w-6, h-6, size-6)
        const cleaned = existing
          .split(/\s+/)
          .filter((c: string) => !/^(w-\d+(\.\d+)?|h-\d+(\.\d+)?|size-\d+(\.\d+)?)$/.test(c))
          .join(' ');
        return `class=${q}${cleaned} ${cls}${q}`.trim();
      });
      return svg.replace(openTag, merged);
    } else {
      const augmented = openTag.replace(/^<svg\b/i, `<svg class="${cls}"`);
      return svg.replace(openTag, augmented);
    }
  }

  private async loadSvg(name: PcIconNameType, size: number, target: WritableSignal<string>) {
    if (name === 'none') {
      target.set('');
    } else {
      // Fetch raw SVG text from /assets
      const raw = await loadIconSvg(name);
      // Inject Tailwind classes into the <svg> element
      const withClass = this.injectClassOnSvg(raw, `w-${size} h-${size}`);
      target.set(withClass);
    }
  }
}
````

## File: libs/uxcommon/src/components/icons/icons.index.ts
````typescript
/****************************************************** */
/*
/* Look at https://heroicons.com for icons. Most of these
/* are from the Heroicons set, some are custom.
/*
/****************************************************** */
export type PcIconNameType = keyof typeof icons;

export async function loadIconSvg(name: PcIconNameType): Promise<string> {
  let cached = _cache.get(name);
  if (!cached) {
    cached = resolveIconSvg(name);
    _cache.set(name, cached);
  }
  return cached;
}

async function resolveIconSvg(name: PcIconNameType): Promise<string> {
  const svg = await fetchSvg(icons[name]);
  if (svg != null) return svg;
  // Fall back to the generic unknown glyph — but only if it itself is a real SVG.
  if (name !== UNKNOWN) {
    const fallback = await loadIconSvg(UNKNOWN);
    if (fallback) return fallback;
  }
  // Nothing usable (e.g. the assets aren't being served): render nothing rather than
  // injecting a dev-server 404 page ("Cannot GET /assets/icons/unknown.svg") as markup.
  return '';
}

/** Fetch an icon and return its text only if it is actually an SVG, else null. */
async function fetchSvg(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const text = await r.text();
    return text.trimStart().startsWith('<svg') ? text : null;
  } catch {
    return null;
  }
}

const UNKNOWN: PcIconNameType = 'unknown';

/** Optional: load SVG text when you need to inline it (works with Tailwind/DaisyUI) */
const _cache = new Map<PcIconNameType, Promise<string>>();

export const icons = {
  none: 'none',
  'add-company': 'assets/icons/add-company.svg',
  'add-form': 'assets/icons/add-form.svg',
  'add-group': 'assets/icons/add-group.svg',
  'add-home': 'assets/icons/add-home.svg',
  'add-issue': 'assets/icons/add-issue.svg',
  'add-label': 'assets/icons/add-label.svg',
  'add-list': 'assets/icons/add-list.svg',
  'add-newsletter': 'assets/icons/add-newsletter.svg',
  'add-notes': 'assets/icons/add-notes.svg',
  'add-schedule': 'assets/icons/add-schedule.svg',
  'add-task': 'assets/icons/add-task.svg',
  'add-ticket': 'assets/icons/add-ticket.svg',
  'add-users': 'assets/icons/add-users.svg',
  'add-volunteer': 'assets/icons/add-volunteer.svg',
  'add-fundraising': 'assets/icons/add-fundraising.svg',
  'adjustments-horizontal': 'assets/icons/adjustments-horizontal.svg',
  'archive-box': 'assets/icons/archive-box.svg',
  'archive-box-arrow-down': 'assets/icons/archive-box-arrow-down.svg',
  'arrow-down-tray': 'assets/icons/arrow-down-tray.svg',
  'arrow-left': 'assets/icons/arrow-left.svg',
  'arrow-left-start-on-rectangle': 'assets/icons/arrow-left-start-on-rectangle.svg',
  'arrow-menu-open': 'assets/icons/arrow-menu-open.svg',
  'arrow-menu-close': 'assets/icons/arrow-menu-close.svg',
  'arrow-path': 'assets/icons/arrow-path.svg',
  'arrow-right-end-on-rectangle': 'assets/icons/arrow-right-end-on-rectangle.svg',
  'arrow-right-start-on-rectangle': 'assets/icons/arrow-right-start-on-rectangle.svg',
  'arrow-top-right-on-square': 'assets/icons/arrow-top-right-on-square.svg',
  'arrow-up-tray': 'assets/icons/arrow-up-tray.svg',
  'arrow-uturn-left': 'assets/icons/arrow-uturn-left.svg',
  'arrow-uturn-right': 'assets/icons/arrow-uturn-right.svg',
  'arrows-pointing-in': 'assets/icons/arrows-pointing-in.svg',
  'arrows-pointing-out': 'assets/icons/arrows-pointing-out.svg',
  'arrows-up-down-tray': 'assets/icons/arrows-up-down-tray.svg',
  'at-symbol': 'assets/icons/at-symbol.svg',
  'attach-fat': 'assets/icons/attach-fat.svg',
  'attach-file-off': 'assets/icons/attach-file-off.svg',
  banknotes: 'assets/icons/banknotes.svg',
  'bars-3': 'assets/icons/bars-3.svg',
  'bars-4': 'assets/icons/bars-4.svg',
  bell: 'assets/icons/bell.svg',
  bookmark: 'assets/icons/bookmark.svg',
  'bookmark-plus': 'assets/icons/bookmark-plus.svg',
  'bookmark-filled': 'assets/icons/bookmark-filled.svg',
  'bookmark-slash': 'assets/icons/bookmark-slash.svg',
  'bug-ant': 'assets/icons/bug-ant.svg',
  briefcase: 'assets/icons/briefcase.svg',
  calendar: 'assets/icons/calendar.svg',
  'chart-pie': 'assets/icons/chart-pie.svg',
  'check-circle': 'assets/icons/check-circle.svg',
  'chat-bubble-bottom-center-text': 'assets/icons/chat-bubble-bottom-center-text.svg',
  'chevron-double-left': 'assets/icons/chevron-double-left.svg',
  'chevron-double-right': 'assets/icons/chevron-double-right.svg',
  'chevron-down': 'assets/icons/chevron-down.svg',
  'chevron-left': 'assets/icons/chevron-left.svg',
  'chevron-right': 'assets/icons/chevron-right.svg',
  'chevron-up': 'assets/icons/chevron-up.svg',
  'clipboard-document-list': 'assets/icons/clipboard-document-list.svg',
  clock: 'assets/icons/clock.svg',
  'cloud-arrow-up': 'assets/icons/cloud-arrow-up.svg',
  cog: 'assets/icons/cog.svg',
  'cog-6-tooth': 'assets/icons/cog-6-tooth.svg',
  'collapse-content': 'assets/icons/collapse-content.svg',
  'credit-card': 'assets/icons/credit-card.svg',
  'currency-dollar': 'assets/icons/currency-dollar.svg',
  document: 'assets/icons/document.svg',
  'document-check': 'assets/icons/document-check.svg',
  'document-currency-dollar': 'assets/icons/document-currency-dollar.svg',
  'document-duplicate': 'assets/icons/document-duplicate.svg',
  'document-text': 'assets/icons/document-text.svg',
  'ellipsis-vertical': 'assets/icons/ellipsis-vertical.svg',
  envelope: 'assets/icons/envelope.svg',
  'exclamation-circle': 'assets/icons/exclamation-circle.svg',
  'exclamation-triangle': 'assets/icons/exclamation-triangle.svg',
  'expand-content': 'assets/icons/expand-content.svg',
  eye: 'assets/icons/eye.svg',
  'eye-slash': 'assets/icons/eye-slash.svg',
  facebook: 'assets/icons/facebook.svg',
  file: 'assets/icons/file.svg',
  'file-archive': 'assets/icons/file-archive.svg',
  'file-audio': 'assets/icons/file-audio.svg',
  'file-calendar': 'assets/icons/file-calendar.svg',
  'file-code': 'assets/icons/file-code.svg',
  'file-contact': 'assets/icons/file-contact.svg',
  'file-db': 'assets/icons/file-db.svg',
  'file-design': 'assets/icons/file-design.svg',
  'file-disk': 'assets/icons/file-disk.svg',
  'file-doc': 'assets/icons/file-doc.svg',
  'file-ebook': 'assets/icons/file-ebook.svg',
  'file-email': 'assets/icons/file-email.svg',
  'file-exe': 'assets/icons/file-exe.svg',
  'file-font': 'assets/icons/file-font.svg',
  'file-image': 'assets/icons/file-image.svg',
  'file-pdf': 'assets/icons/file-pdf.svg',
  'file-sheet': 'assets/icons/file-sheet.svg',
  'file-slides': 'assets/icons/file-slides.svg',
  'file-text': 'assets/icons/file-text.svg',
  'file-video': 'assets/icons/file-video.svg',
  filter: 'assets/icons/funnel.svg',
  forward: 'assets/icons/forward.svg',
  funnel: 'assets/icons/funnel.svg',
  'globe-americas': 'assets/icons/globe-americas.svg',
  hashtag: 'assets/icons/hashtag.svg',
  home: 'assets/icons/home.svg',
  'house-modern': 'assets/icons/house-modern.svg',
  identification: 'assets/icons/identification.svg',
  inbox: 'assets/icons/inbox.svg',
  'inbox-stack': 'assets/icons/inbox-stack.svg',
  'information-circle': 'assets/icons/information-circle.svg',
  instagram: 'assets/icons/instagram.svg',
  label: 'assets/icons/label.svg',
  linkedin: 'assets/icons/linkedin.svg',
  'lock-closed': 'assets/icons/lock-closed.svg',
  'magnifying-glass': 'assets/icons/magnifying-glass.svg',
  mailbox: 'assets/icons/mailbox.svg',
  map: 'assets/icons/map.svg',
  'map-pin': 'assets/icons/map-pin.svg',
  megaphone: 'assets/icons/megaphone.svg',
  message: 'assets/icons/message.svg',
  'menu-open': 'assets/icons/menu-open.svg',
  merge: 'assets/icons/merge.svg',
  moon: 'assets/icons/moon.svg',
  notification: 'assets/icons/notification.svg',
  'paper-airplane': 'assets/icons/paper-airplane.svg',
  'paper-clip': 'assets/icons/paper-clip.svg',
  'pencil-square': 'assets/icons/pencil-square.svg',
  plus: 'assets/icons/plus.svg',
  'presentation-chart-line': 'assets/icons/presentation-chart-line.svg',
  print: 'assets/icons/print.svg',
  'queue-list': 'assets/icons/queue-list.svg',
  'rectangle-stack': 'assets/icons/rectangle-stack.svg',
  'redo-fat': 'assets/icons/redo-fat.svg',
  route: 'assets/icons/route.svg',
  reply: 'assets/icons/reply.svg',
  'reply-all': 'assets/icons/reply-all.svg',
  'restore-from-trash': 'assets/icons/restore-from-trash.svg',
  save: 'assets/icons/save.svg',
  'shield-exclamation': 'assets/icons/shield-exclamation.svg',
  'square-3-stack-3d': 'assets/icons/square-3-stack-3d.svg',
  star: 'assets/icons/star.svg',
  'star-filled': 'assets/icons/star-filled.svg',
  sun: 'assets/icons/sun.svg',
  'table-cells': 'assets/icons/table-cells.svg',
  phone: 'assets/icons/phone.svg',
  tag: 'assets/icons/tag.svg',
  task: 'assets/icons/task.svg',
  ticket: 'assets/icons/ticket.svg',
  trash: 'assets/icons/trash.svg',
  'trash-forever': 'assets/icons/trash-forever.svg',
  'undo-fat': 'assets/icons/undo-fat.svg',
  unknown: 'assets/icons/unknown.svg',
  'user-circle': 'assets/icons/user-circle.svg',
  'user-group': 'assets/icons/user-group.svg',
  'user-plus': 'assets/icons/user-plus.svg',
  users: 'assets/icons/users.svg',
  'view-column': 'assets/icons/view-column.svg',
  'view-kanban': 'assets/icons/view-kanban.svg',
  volunteer: 'assets/icons/volunteer.svg',
  'wrench-screwdriver': 'assets/icons/wrench-screwdriver.svg',
  'x-circle': 'assets/icons/x-circle.svg',
  x: 'assets/icons/x.svg',
  'x-mark': 'assets/icons/x-mark.svg',
} as const;
````

## File: libs/uxcommon/src/components/input/input.ts
````typescript
import { Component, input, output } from '@angular/core';
import { FormField } from '@angular/forms/signals';

@Component({
  selector: 'pc-input',
  imports: [FormField],
  template: `
    <div class="flex flex-col gap-1 w-full">
      @if (label()) {
        <label class="label py-0 pl-1">
          <span class="label-text text-xs font-semibold text-base-content/70">{{ label() }}</span>
        </label>
      }

      <label
        class="input w-full flex items-center gap-2"
        [class.input-error]="
          hasError() || (formField()().invalid() && (formField()().dirty() || formField()().touched()))
        "
      >
        <ng-content select="[pc-prefix]"></ng-content>
        <input
          [type]="type()"
          [placeholder]="placeholder()"
          [formField]="formField()"
          class="grow"
          (blur)="blurred.emit()"
        />
        <ng-content select="[pc-suffix]"></ng-content>
      </label>

      @if ((hasError() || formField()().invalid()) && (formField()().dirty() || formField()().touched())) {
        @for (err of formField()().errors(); track err) {
          <p class="text-[11px] text-error pl-1">{{ err.message }}</p>
        }
      }
    </div>
  `,
})
export class Input {
  public label = input<string>();
  public type = input<string>('text');
  public placeholder = input<string>('');
  public formField = input.required<any>();
  public hasError = input<boolean>(false);
  public blurred = output<void>();
}
````

## File: libs/uxcommon/src/components/map/map-types.ts
````typescript
/**
 * Shared value types for the single Google Maps primitive, `<pc-map>`.
 *
 * These are the binding contract consumed by §6 (household card), §13
 * (canvassing turf polygons) and §14 (delivery routes / per-door dots). Keep
 * them free of any Google Maps SDK types so consumers and unit tests can build
 * marker/polygon inputs without loading the SDK.
 */

/** A plain latitude/longitude pair (never a `google.maps.LatLng`). */
export interface PcLatLng {
  lat: number;
  lng: number;
}

/**
 * Semantic colour bucket. Maps 1:1 to a DaisyUI `--color-*` token, resolved at
 * runtime so overlays stay correct across a light/dark theme flip. `muted`
 * resolves to `base-content` at reduced opacity.
 */
export type PcMapVariant = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'muted';

/** One point marker. `payload` is echoed back on `markerClicked`. */
export interface PcMapMarker<T = unknown> {
  position: PcLatLng;
  variant?: PcMapVariant;
  tooltip?: string;
  id?: string;
  payload?: T;
}

/** One filled polygon (a turf boundary). `payload` is echoed on `polygonClicked`. */
export interface PcMapPolygon<T = unknown> {
  path: PcLatLng[];
  variant?: PcMapVariant;
  label?: string;
  dashed?: boolean;
  id?: string;
  payload?: T;
}
````

## File: libs/uxcommon/src/components/map/map.ts
````typescript
import { Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Loader } from '@googlemaps/js-api-loader';
import { Icon } from '../icons/icon';
import type { PcLatLng, PcMapMarker, PcMapPolygon, PcMapVariant } from './map-types';

const DEFAULT_ZOOM = 14;
const DEFAULT_MAP_ID = 'DEMO_MAP_ID';
const FILL_OPACITY = 0.18;
const MUTED_OPACITY = 0.55;

/**
 * `<pc-map>` — the single Google Maps primitive for the whole app (§13 maps
 * ruling: Google Maps Platform only, no mixed providers).
 *
 * - **Real browser + a provided `Loader`** → lazy-loads the `maps` + `marker`
 *   libraries and draws markers/polygons tinted by DaisyUI semantic tokens.
 * - **No `Loader` (unit tests) / offline / a load failure** → renders a
 *   deterministic placeholder (a pin icon + label) and never touches the
 *   network. This mirrors the geocoding mock's degrade-don't-crash approach, so
 *   the app never crashes and never fakes a pin.
 *
 * See `docs/spec/pc-map-usage.md` for the three consumption patterns and the
 * binding input/output contract.
 */
@Component({
  selector: 'pc-map',
  imports: [Icon],
  template: `
    @if (ready()) {
      <div #mapHost class="h-full w-full min-h-40"></div>
    } @else {
      <div
        class="flex h-full w-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-base-200 text-base-content/40 select-none"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        <pc-icon name="map-pin" [size]="8" class="text-base-content/25"></pc-icon>
        <span class="text-xs font-medium text-base-content/50">{{ placeholderLabel() }}</span>
      </div>
    }
  `,
})
export class PcMap {
  /** Optional so unit tests (and any host without the SDK key) fall back to the placeholder. */
  private readonly loader = inject(Loader, { optional: true });

  public readonly markers = input<PcMapMarker[]>([]);
  public readonly polygons = input<PcMapPolygon[]>([]);
  public readonly center = input<PcLatLng | null>(null);
  public readonly zoom = input<number>(DEFAULT_ZOOM);
  public readonly fitBounds = input<boolean>(true);
  public readonly interactive = input<boolean>(true);
  public readonly deepLink = input<boolean>(false);
  public readonly mapId = input<string>(DEFAULT_MAP_ID);
  public readonly ariaLabel = input<string>('Map');

  public readonly markerClicked = output<PcMapMarker>();
  public readonly polygonClicked = output<PcMapPolygon>();

  protected readonly ready = signal(false);

  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');

  private map: google.maps.Map | null = null;
  private drawnMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
  private drawnPolygons: google.maps.Polygon[] = [];
  private themeObserver: MutationObserver | null = null;

  protected readonly placeholderLabel = signal('Map unavailable');

  constructor() {
    // Kick off the SDK load once. If there is no Loader we stay a placeholder.
    void this.tryLoad();

    // Redraw whenever inputs change and the map is live.
    effect(() => {
      const markers = this.markers();
      const polygons = this.polygons();
      // Recompute the placeholder caption from current content.
      this.placeholderLabel.set(this.computePlaceholderLabel(markers, polygons));
      if (this.map) {
        this.redraw(markers, polygons);
      }
    });

    // Once the host element materialises (after `ready` flips), build the map.
    effect(() => {
      const host = this.mapHost();
      if (host && !this.map) {
        this.buildMap(host.nativeElement);
      }
    });
  }

  private async tryLoad(): Promise<void> {
    if (!this.loader) return;
    try {
      await this.loader.importLibrary('maps');
      await this.loader.importLibrary('marker');
      this.ready.set(true);
    } catch {
      // Bad key / offline / blocked — stay on the honest placeholder.
      this.ready.set(false);
    }
  }

  private buildMap(hostEl: HTMLElement): void {
    try {
      const explicitCenter = this.center();
      this.map = new google.maps.Map(hostEl, {
        center: explicitCenter ?? { lat: 0, lng: 0 },
        zoom: this.zoom(),
        mapId: this.mapId(),
        disableDefaultUI: !this.interactive(),
        gestureHandling: this.interactive() ? 'greedy' : 'none',
        scrollwheel: false, // §13.3 — keep the page scrolling
        streetViewControl: false,
        mapTypeControl: false,
        keyboardShortcuts: this.interactive(),
      });

      if (this.deepLink()) {
        this.map.addListener('click', () => this.openInMapsApp());
        hostEl.style.cursor = 'pointer';
      }

      this.observeTheme();
      this.redraw(this.markers(), this.polygons());
    } catch {
      // A partial/broken SDK (or an offline draw failure) degrades to the
      // honest placeholder rather than crashing the host page.
      this.map = null;
      this.ready.set(false);
    }
  }

  private redraw(markers: PcMapMarker[], polygons: PcMapPolygon[]): void {
    if (!this.map) return;
    this.clearOverlays();

    for (const poly of polygons) {
      this.drawPolygon(poly);
    }
    for (const marker of markers) {
      this.drawMarker(marker);
    }

    if (!this.center()) {
      this.fitToContent(markers, polygons);
    }
  }

  private drawMarker(marker: PcMapMarker): void {
    if (!this.map) return;
    const color = this.resolveColor(marker.variant ?? 'primary');
    const pin = document.createElement('div');
    pin.style.width = '14px';
    pin.style.height = '14px';
    pin.style.borderRadius = '9999px';
    pin.style.background = color;
    pin.style.border = '2px solid var(--color-base-100, #fff)';
    pin.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
    if (marker.tooltip) pin.title = marker.tooltip;

    const advanced = new google.maps.marker.AdvancedMarkerElement({
      map: this.map,
      position: marker.position,
      content: pin,
      title: marker.tooltip ?? '',
      gmpClickable: true,
    });
    advanced.addListener('gmp-click', () => {
      this.markerClicked.emit(marker);
      if (this.deepLink()) this.openInMapsApp(marker.position);
    });
    this.drawnMarkers.push(advanced);
  }

  private drawPolygon(poly: PcMapPolygon): void {
    if (!this.map) return;
    const color = this.resolveColor(poly.variant ?? 'neutral');
    const shape = new google.maps.Polygon({
      map: this.map,
      paths: poly.path,
      strokeColor: color,
      // Polygons can't render a dashed outline (that's a Polyline feature); a
      // dashed turf uses a thinner, lower-opacity solid stroke for now.
      // TODO(Wave 2F turf boundaries): overlay a dashed Polyline for `poly.dashed`.
      strokeWeight: poly.dashed ? 1.5 : 2,
      strokeOpacity: poly.dashed ? 0.6 : 0.9,
      fillColor: color,
      fillOpacity: FILL_OPACITY,
      clickable: true,
    });
    shape.addListener('click', () => this.polygonClicked.emit(poly));
    this.drawnPolygons.push(shape);
  }

  private fitToContent(markers: PcMapMarker[], polygons: PcMapPolygon[]): void {
    if (!this.map || !this.fitBounds()) return;
    const bounds = new google.maps.LatLngBounds();
    let has = false;
    for (const m of markers) {
      bounds.extend(m.position);
      has = true;
    }
    for (const p of polygons) {
      for (const pt of p.path) {
        bounds.extend(pt);
        has = true;
      }
    }
    if (!has) return;
    const soleMarker = markers.length === 1 && polygons.length === 0 ? markers[0] : undefined;
    if (soleMarker) {
      // A single door reads better centred at a street zoom than fit-to-point.
      this.map.setCenter(soleMarker.position);
      this.map.setZoom(this.zoom());
      return;
    }
    this.map.fitBounds(bounds);
  }

  private clearOverlays(): void {
    for (const m of this.drawnMarkers) m.map = null;
    for (const p of this.drawnPolygons) p.setMap(null);
    this.drawnMarkers = [];
    this.drawnPolygons = [];
  }

  private observeTheme(): void {
    if (this.themeObserver || typeof MutationObserver === 'undefined') return;
    this.themeObserver = new MutationObserver(() => this.redraw(this.markers(), this.polygons()));
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  private openInMapsApp(position?: PcLatLng): void {
    const target = position ?? this.center() ?? this.markers()[0]?.position;
    if (!target) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${target.lat},${target.lng}`;
    window.open(url, '_blank', 'noopener');
  }

  /**
   * Resolve a semantic variant to a concrete CSS colour string Google's canvas
   * renderer accepts. Reads the live DaisyUI `--color-*` token through a probe
   * element so the value survives a theme flip.
   */
  private resolveColor(variant: PcMapVariant): string {
    const token = variant === 'muted' ? 'base-content' : variant;
    const host = this.mapHost()?.nativeElement ?? document.body;
    const probe = document.createElement('span');
    probe.style.color = `var(--color-${token})`;
    probe.style.display = 'none';
    host.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    host.removeChild(probe);
    if (variant === 'muted' && resolved.startsWith('rgb')) {
      return resolved.replace('rgb(', 'rgba(').replace(')', `, ${MUTED_OPACITY})`);
    }
    return resolved || '#3b82f6';
  }

  private computePlaceholderLabel(markers: PcMapMarker[], polygons: PcMapPolygon[]): string {
    if (markers.length === 0 && polygons.length === 0) return this.ariaLabel();
    const parts: string[] = [];
    if (markers.length) parts.push(`${markers.length} ${markers.length === 1 ? 'location' : 'locations'}`);
    if (polygons.length) parts.push(`${polygons.length} ${polygons.length === 1 ? 'area' : 'areas'}`);
    return parts.join(' · ');
  }
}
````

## File: libs/uxcommon/src/components/modal-shell/modal-shell.ts
````typescript
import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

/**
 * The one modal chrome for form/tool dialogs: native <dialog> + DaisyUI modal
 * with the house header (primary icon, bold title, ghost-circle close) and a
 * `[pc-modal-footer]` slot for actions. Blocking yes/no decisions stay on
 * ConfirmDialogService — this shell is for dialogs with real content.
 *
 * Drive it either declaratively (`[open]="someSignal()"`) or imperatively via
 * a template ref (`#dlg` → `dlg.show()` / `dlg.close()`). `closed` fires on
 * every close path (X button, ESC, backdrop, programmatic).
 */
@Component({
  selector: 'pc-modal-shell',
  imports: [Icon],
  template: `
    <dialog #dlg class="modal" (close)="closed.emit()" (cancel)="onCancel($event)">
      <div class="modal-box" [class]="boxClass()">
        <div class="mb-5 flex items-center justify-between">
          <h3 class="flex items-center gap-2 text-lg font-bold">
            @if (icon(); as ic) {
              <pc-icon [name]="ic" [size]="5" class="text-primary" />
            }
            {{ title() }}
          </h3>
          <button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Close" (click)="close()">
            <pc-icon name="x-mark" [size]="4" />
          </button>
        </div>
        <ng-content />
        <div class="modal-action empty:hidden">
          <ng-content select="[pc-modal-footer]" />
        </div>
      </div>
      @if (dismissible()) {
        <form method="dialog" class="modal-backdrop">
          <button type="submit" aria-label="Close">close</button>
        </form>
      }
    </dialog>
  `,
})
export class ModalShell {
  /** Extra classes for the modal box — width overrides only (e.g. 'max-w-3xl'). */
  public readonly boxClass = input<string>('');
  /** Allow ESC / backdrop-click to dismiss. Turn off for dialogs holding unsaved work. */
  public readonly dismissible = input<boolean>(true);
  public readonly icon = input<PcIconNameType | null>(null);
  /** Declarative visibility; leave unset to drive imperatively via show()/close(). */
  public readonly open = input<boolean | undefined>(undefined);
  public readonly title = input.required<string>();

  public readonly closed = output<void>();

  private readonly dlgRef = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const open = this.open();
      if (open === undefined) return;
      const dlg = this.dlgRef().nativeElement;
      try {
        if (open && !dlg.open) dlg.showModal();
        else if (!open && dlg.open) dlg.close();
      } catch {
        /* dialog not connected yet — the next effect run settles it */
      }
    });
  }

  public close(): void {
    const dlg = this.dlgRef().nativeElement;
    if (dlg.open) dlg.close();
  }

  public show(): void {
    const dlg = this.dlgRef().nativeElement;
    if (!dlg.open) dlg.showModal();
  }

  protected onCancel(e: Event): void {
    if (!this.dismissible()) e.preventDefault();
  }
}
````

## File: libs/uxcommon/src/components/not-found/not-found.ts
````typescript
import { Component } from '@angular/core';

@Component({
  selector: 'pc-not-found',
  imports: [],
  template: `<section class="min-h-full">
    <div class="md:px-12 lg:px-0">
      <div class="max-auto w-full justify-center text-center lg:p-10">
        <div class="mx-auto w-full justify-center">
          <p class="text-5xl tracking-tight lg:text-9xl">404</p>
          <p class="mx-auto mt-4 max-w-xl text-lg font-light">Please check the URL in the address bar and try again.</p>
        </div>
        <div class="mt-10 flex justify-center gap-3">
          <a href="/" class="link link-hover">Home&nbsp; → </a>
        </div>
      </div>
    </div>
  </section>`,
})
export class NotFound {}
````

## File: libs/uxcommon/src/components/profile-card/profile-card.ts
````typescript
import { Component, input } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

@Component({
  selector: 'pc-profile-card',
  imports: [Icon],
  template: `
    <div class="card bg-base-100 shadow-xl overflow-hidden border border-base-300 w-full">
      <!-- Decorative Card Header Gradient -->
      <div class="h-24 bg-gradient-to-r from-primary/20 via-primary/30 to-secondary/20"></div>

      <div class="px-6 pb-6 relative flex flex-col items-center">
        <!-- Avatar / Placeholder -->
        @if (avatarUrl() || avatarText() || iconName()) {
          <div class="avatar placeholder -mt-12 mb-3">
            <div
              class="bg-gradient-to-tr from-primary to-secondary text-primary-content rounded-full w-24 h-24 ring ring-base-100 ring-offset-4 text-3xl font-bold flex items-center justify-center shadow-lg overflow-hidden"
            >
              @if (avatarUrl()) {
                <img [src]="avatarUrl()!" alt="Avatar" class="w-full h-full object-cover" />
              } @else if (avatarText()) {
                {{ avatarText() }}
              } @else if (iconName()) {
                <pc-icon [name]="iconName()!" [size]="10"></pc-icon>
              }
            </div>
          </div>
        }

        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class ProfileCard {
  public avatarUrl = input<string | null | undefined>();
  public avatarText = input<string | null | undefined>();
  public iconName = input<PcIconNameType | null | undefined>();
}
````

## File: libs/uxcommon/src/components/public-link-panel/public-link-panel.html
````html
<pc-card [title]="label()" [subtitle]="subtitle()">
  <div class="space-y-3">
    <div class="flex gap-2">
      <input type="text" [value]="url()" readonly class="input input-bordered input-sm flex-1 font-mono text-xs" />
      <a
        [href]="url()"
        target="_blank"
        class="btn btn-sm btn-outline btn-secondary px-3 flex items-center justify-center"
        title="Open public page"
      >
        <pc-icon name="arrow-top-right-on-square"></pc-icon>
      </a>
      <button type="button" class="btn btn-sm btn-outline btn-secondary px-3" (click)="copyUrl()" title="Copy link">
        <pc-icon name="document-duplicate"></pc-icon>
      </button>
    </div>
  </div>
</pc-card>
````

## File: libs/uxcommon/src/components/public-link-panel/public-link-panel.ts
````typescript
import { Component, inject, input } from '@angular/core';
import { AlertService } from '../alerts/alert-service';
import { Card as PcCard } from '../card/card';
import { Icon } from '../icons/icon';

@Component({
  selector: 'pc-public-link-panel',
  imports: [Icon, PcCard],
  templateUrl: './public-link-panel.html',
})
export class PublicLinkPanel {
  readonly url = input.required<string>();
  readonly label = input<string>('Public Link');
  readonly subtitle = input<string>('Share this link so people can sign up.');

  private readonly alertSvc = inject(AlertService);

  protected copyUrl(): void {
    navigator.clipboard
      .writeText(this.url())
      .then(() => {
        this.alertSvc.showSuccess('Link copied to clipboard!');
      })
      .catch((_e) => this.alertSvc.showError('Could not copy link to clipboard'));
  }
}
````

## File: libs/uxcommon/src/components/select/select.ts
````typescript
import { Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

@Component({
  selector: 'pc-select',
  imports: [FormField],
  template: `
    <div class="flex flex-col gap-1 w-full">
      @if (label()) {
        <label class="label py-0 pl-1">
          <span class="label-text text-xs font-semibold text-base-content/70">{{ label() }}</span>
        </label>
      }

      <select
        [formField]="formField()"
        class="select select-bordered w-full"
        [class.select-error]="formField()().invalid() && (formField()().dirty() || formField()().touched())"
      >
        @if (placeholder()) {
          <option value="">{{ placeholder() }}</option>
        }
        <ng-content></ng-content>
      </select>

      @if (formField()().invalid() && (formField()().dirty() || formField()().touched())) {
        @for (err of formField()().errors(); track err) {
          <p class="text-[11px] text-error pl-1">{{ err.message }}</p>
        }
      }
    </div>
  `,
})
export class Select {
  public label = input<string>();
  public placeholder = input<string>('');
  public formField = input.required<any>();
}
````

## File: libs/uxcommon/src/components/side-drawer/side-drawer.ts
````typescript
import { Component, input, output } from '@angular/core';
import { Icon } from '@icons/icon';

@Component({
  selector: 'pc-side-drawer',
  imports: [Icon],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-30 flex justify-end">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/30 transition-opacity duration-300" (click)="onClose()"></div>
        <!-- Panel -->
        <div
          class="relative h-full w-full max-w-[90vw] bg-base-100 shadow-xl border-l border-base-300 flex flex-col z-10 transition-transform duration-300"
          [class]="widthClass()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-base-300">
            <div class="font-semibold text-base-content text-lg">
              {{ title() }}
            </div>
            <button class="btn btn-ghost btn-sm btn-circle" (click)="onClose()" aria-label="Close drawer">
              <pc-icon name="x-mark" [size]="4"></pc-icon>
            </button>
          </div>
          <!-- Body -->
          <div class="p-4 flex flex-col gap-3 overflow-y-auto flex-grow">
            <ng-content></ng-content>
          </div>
          <!-- Footer -->
          <ng-content select="[pc-drawer-footer]"></ng-content>
        </div>
      </div>
    }
  `,
})
export class SideDrawer {
  public isOpen = input.required<boolean>();
  public title = input<string>('');
  public size = input<'sm' | 'md' | 'lg'>('sm');
  public close = output<void>();

  protected onClose() {
    this.close.emit();
  }

  protected widthClass() {
    const s = this.size();
    if (s === 'lg') return 'sm:w-[700px]';
    if (s === 'md') return 'sm:w-[540px]';
    return 'sm:w-[420px]';
  }
}
````

## File: libs/uxcommon/src/components/stat-card/stat-card.ts
````typescript
import { Component, input } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

@Component({
  selector: 'pc-stat-card',
  imports: [Icon],
  template: `
    <div
      class="stats border border-base-200 bg-base-100 shadow-sm transition-all duration-200 hover:shadow-md flex flex-row items-center justify-between p-4 rounded w-full"
    >
      <div class="stat p-0 leading-normal">
        @if (title()) {
          <div class="stat-title pc-eyebrow">
            {{ title() }}
          </div>
        }
        @if (loading()) {
          <!-- Known-shape placeholder for the value: a skeleton block, never a spinner (§3). -->
          <div class="skeleton mt-1 h-6 w-16 rounded"></div>
        } @else {
          <div class="stat-value text-xl font-extrabold mt-1 sm:text-2xl tabular-nums" [class]="valueColorClass()">
            {{ value() }}
          </div>
        }
        <div class="stat-desc text-[10px] text-base-content/40 mt-1">
          @if (description()) {
            <span>{{ description() }}</span>
          }
          <ng-content select="[pc-stat-desc]"></ng-content>
        </div>
      </div>

      <div class="flex-shrink-0 flex items-center justify-center gap-2">
        @if (icon()) {
          <div class="w-12 h-12 rounded-xl flex items-center justify-center" [class]="iconBgClass()">
            <pc-icon [name]="icon()!" [size]="6" [class]="iconColorClass()"></pc-icon>
          </div>
        }
        <ng-content select="[pc-stat-extra]"></ng-content>
      </div>
    </div>
  `,
})
export class StatCard {
  public title = input<string>();
  public value = input<string | number>();
  /** When true, the value renders as a skeleton block instead of a number/spinner. */
  public loading = input<boolean>(false);
  public description = input<string>();
  public icon = input<PcIconNameType>();
  public valueColorClass = input<string>('text-base-content');
  public iconBgClass = input<string>('bg-base-200/50');
  public iconColorClass = input<string>('text-base-content/70');
}
````

## File: libs/uxcommon/src/components/swap/swap.ts
````typescript
import { Component, input, output } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

@Component({
  selector: 'pc-swap',
  imports: [Icon],
  template: `<label
    class="swap ml-auto flex-none cursor-pointer p-2"
    [class.swap-flip]="animation() === 'flip'"
    [class.swap-rotate]="animation() === 'rotate'"
    [class.swap-active]="checked()"
    (click)="emitClick($event)"
  >
    <pc-icon [name]="swapOnIcon()!" class="swap-on" [size]="size()" />

    <pc-icon [name]="swapOffIcon()!" [hover]="hoverIcon()" class="swap-off" [size]="size()" />
  </label> `,
})
export class Swap {
  // eslint-disable-next-line @angular-eslint/no-output-native -- pre-existing public API; renaming `click` breaks every pc-swap consumer and is out of scope here
  public readonly click = output<void>();

  public animation = input<'flip' | 'rotate'>('rotate');

  public checked = input<boolean>(false);
  public hoverIcon = input<PcIconNameType | null>(null);
  public size = input(6);

  public swapOffIcon = input.required<PcIconNameType>();

  public swapOnIcon = input.required<PcIconNameType>();

  public emitClick(event: Event) {
    event.stopPropagation();
    this.click.emit();
  }
}
````

## File: libs/uxcommon/src/components/system-metadata/system-metadata.ts
````typescript
import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'pc-system-metadata',
  imports: [DatePipe],
  template: `
    <div
      class="w-full mt-6 pt-4 border-t border-base-200 text-[10px] text-base-content/40 flex gap-4 leading-normal"
      [class.justify-between]="layout() === 'row'"
      [class.flex-col]="layout() === 'col'"
      [class.gap-1]="layout() === 'col'"
    >
      @if (createdAt()) {
        <span
          >Created
          @if (createdBy() && createdBy() !== '?') {
            by {{ createdBy() }}
          }
          on {{ createdAt() | date: dateFormat() }}</span
        >
      }
      @if (updatedAt()) {
        <span
          >Updated {{ updatedAt() | date: dateFormat() }}
          @if (updatedBy() && updatedBy() !== '?') {
            by {{ updatedBy() }}
          }
        </span>
      }
    </div>
  `,
})
export class SystemMetadata {
  public createdAt = input<any>();
  public updatedAt = input<any>();
  public createdBy = input<string | null | undefined>();
  public updatedBy = input<string | null | undefined>();
  public layout = input<'row' | 'col'>('row');
  public dateFormat = input<string>('M/d/yyyy');
}
````

## File: libs/uxcommon/src/components/table/table.ts
````typescript
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * `pc-table` — the lightweight presentational table shell.
 *
 * The counterpart to the house `pc-datagrid`: where the datagrid owns data
 * fetching, sorting, filtering, selection and inline editing, `pc-table` owns
 * only the *chrome* — the bordered shell, the micro-caps header row, cell
 * density and the shared skeleton-loading idiom. It exists so bespoke tables
 * (Tags, Issues, Donations) stay visually identical to the datagrid without
 * inheriting its machinery. See the `pplcrm-table` skill.
 *
 * All visual styling comes from the shared, global `.pc-table-shell` / `.pc-table`
 * contract in `apps/frontend/src/styles.css` — the single source of truth both
 * this component and the datagrid consume. This component ships no styles of its
 * own (emulated encapsulation could not reach the projected rows anyway).
 *
 * Consumers keep full control of every cell and of the empty state (which is
 * per-entity by design — see design principles §3), projecting:
 *   - `[pcTableHead]` — the `<th>` cells for the header row
 *   - the default slot — the body rows *and* the page's own empty-state row,
 *     rendered only when not loading
 *   - `[pcTableFooter]` — optional caption/pagination hint rendered inside the
 *     shell, below the table (e.g. "Showing the latest 25 of 312")
 *
 * ```html
 * <pc-table [loading]="loading()" [columns]="5">
 *   <ng-container pcTableHead>
 *     <th>Tag</th><th>People</th><th>Last applied</th><th class="w-10"></th>
 *   </ng-container>
 *
 *   @if (rows().length === 0) {
 *     <tr><td colspan="5">…guided empty state…</td></tr>
 *   } @else {
 *     @for (row of rows(); track row.id) {
 *       <tr [class.animate-saved-flash]="highlightId() === row.id">…</tr>
 *     }
 *   }
 * </pc-table>
 * ```
 */
@Component({
  selector: 'pc-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pc-table-shell">
      <table class="table pc-table w-full">
        <thead>
          <tr>
            <ng-content select="[pcTableHead]"></ng-content>
          </tr>
        </thead>
        <tbody>
          @if (loading()) {
            @for (row of skeletonList(); track row) {
              <tr>
                <td [attr.colspan]="columns()">
                  <div class="skeleton h-6 w-full"></div>
                </td>
              </tr>
            }
          } @else {
            <ng-content></ng-content>
          }
        </tbody>
      </table>
      <ng-content select="[pcTableFooter]"></ng-content>
    </div>
  `,
})
export class Table {
  /** Number of columns — drives the skeleton row's colspan so it spans the table. */
  public readonly columns = input.required<number>();

  /** When true, render placeholder skeleton rows instead of the projected body. */
  public readonly loading = input<boolean>(false);

  /** How many skeleton rows to show while loading. */
  public readonly skeletonRows = input<number>(5);

  protected readonly skeletonList = computed<number[]>(() => Array.from({ length: this.skeletonRows() }, (_, i) => i));
}
````

## File: libs/uxcommon/src/components/tabs/tabs.ts
````typescript
import { Component, computed, input, model } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface PcTabOption {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
  tooltip?: string;
  /** When set, the pill renders as a router link (page-level tabs that navigate) instead of a stateful button. */
  route?: string;
  /** Match the route exactly for the active state (default false). */
  exact?: boolean;
}

const PILL_BASE =
  'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors focus:outline-none';
const PILL_ACTIVE = 'border-primary/30 bg-primary/10 text-primary';
const PILL_INACTIVE = 'border-base-200 bg-base-100 text-base-content/70';

/**
 * The one tab idiom (design §4): the pill tab bar from the person view, with count
 * badges ("numbers before clicks", §1). Stateful tabs bind `[(activeTab)]`; tabs that
 * navigate set `route` on the option instead. The only sanctioned exception is the
 * grain-tabs row on the People / Households / Companies grids.
 */
@Component({
  selector: 'pc-tab-bar',
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'block' },
  template: `
    <div role="tablist" class="flex flex-wrap gap-2">
      @for (tab of tabs(); track tab.id) {
        @if (tab.route) {
          <a
            role="tab"
            [routerLink]="tab.route"
            routerLinkActive="!border-primary/30 !bg-primary/10 !text-primary"
            [routerLinkActiveOptions]="{ exact: tab.exact ?? false }"
            class="{{ pillBase }} {{ pillInactive }} cursor-pointer hover:bg-base-200/60"
          >
            <span>{{ tab.label }}</span>
            @if (tab.badge !== undefined && tab.badge !== null) {
              <span class="rounded-full bg-base-200 px-1.5 text-xs font-semibold tabular-nums text-base-content/50">{{
                tab.badge
              }}</span>
            }
          </a>
        } @else {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="activeTab() === tab.id"
            [attr.aria-disabled]="tab.disabled || null"
            [class]="pillClass(tab)"
            [class.tooltip]="tab.disabled && tab.tooltip"
            [attr.data-tip]="tab.disabled && tab.tooltip ? tab.tooltip : null"
            (click)="!tab.disabled && selectTab(tab.id)"
          >
            <span>{{ tab.label }}</span>
            @if (tab.badge !== undefined && tab.badge !== null) {
              <span
                class="rounded-full px-1.5 text-xs font-semibold tabular-nums"
                [class]="activeTab() === tab.id ? 'bg-primary/20 text-primary' : 'bg-base-200 text-base-content/50'"
                >{{ tab.badge }}</span
              >
            }
          </button>
        }
      }
    </div>
  `,
})
export class TabBar {
  public tabs = input.required<PcTabOption[]>();
  public activeTab = model<string>('');

  protected readonly pillBase = PILL_BASE;
  protected readonly pillInactive = PILL_INACTIVE;

  protected pillClass(tab: PcTabOption): string {
    const state = this.activeTab() === tab.id ? PILL_ACTIVE : PILL_INACTIVE;
    const cursor = tab.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer';
    const hover = !tab.disabled && this.activeTab() !== tab.id ? 'hover:bg-base-200/60' : '';
    return `${PILL_BASE} ${state} ${cursor} ${hover}`;
  }

  protected selectTab(id: string): void {
    this.activeTab.set(id);
  }
}

/** Pill tab bar + the standard content card (the person-view composition) with projected pc-tab-panels. */
@Component({
  selector: 'pc-tabs',
  imports: [TabBar],
  host: { class: 'flex flex-grow flex-col gap-6' },
  template: `
    <pc-tab-bar [tabs]="tabs()" [(activeTab)]="activeTab" />
    <div class="card rounded-2xl border border-base-200 bg-base-100 p-6 shadow-sm">
      <ng-content></ng-content>
    </div>
  `,
})
export class Tabs {
  public tabs = input.required<PcTabOption[]>();
  public activeTab = model.required<string>();
}

@Component({
  selector: 'pc-tab-panel',
  template: `
    @if (isActive()) {
      <div class="space-y-4">
        <ng-content></ng-content>
      </div>
    }
  `,
})
export class TabPanel {
  public id = input.required<string>();
  public activeTab = input.required<string>();

  protected isActive = computed(() => this.activeTab() === this.id());
}
````

## File: libs/uxcommon/src/components/tags/tagitem.ts
````typescript
import { Component, Signal, computed, input, output, signal } from '@angular/core';
import { Icon } from '@icons/icon';

@Component({
  selector: 'pc-tagitem',
  imports: [Icon],
  styleUrl: './tagitem.css',
  template: `<div
    class="badge rounded-lg px-0 gap-1 pl-2 bordered"
    [class.badge-compact]="compact()"
    [style.background]="background() || null"
    [style.color]="textColor()"
    [style.borderColor]="borderColor()"
  >
    <span
      (click)="emitClick()"
      class="tag-label cursor-pointer font-light pr-1"
      [class.pr-2]="!canDelete()"
      [style.color]="textColor()"
    >
      {{ displayName() }}</span
    >
    <pc-icon
      name="x-mark"
      [size]="3"
      class="tag-remove hover:text-error cursor-pointer pr-1 mr-0"
      [style.color]="textColor()"
      [class.hidden]="!canDelete()"
      (click)="emitClose()"
    />
  </div> `,
})
export class TagItem {
  protected readonly background = computed(() => this.normalizeColor(this.color()));
  protected readonly borderColor = computed(() => this.background() ?? null);
  protected readonly displayName = computed(() => {
    const n = this.name();
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  });
  protected readonly textColor = computed(() => this.computeTextColor(this.background()));

  public readonly click = output<string>();
  public readonly close = output<string>();

  public canDelete = input<boolean>(true);
  public color = input<string | null | undefined>(null);
  public compact = input<boolean>(false);
  public invisible = input<Signal<boolean>>(signal(false));
  public name = input.required<string>();

  public emitClick() {
    this.click.emit(this.name());
  }

  public emitClose() {
    this.close.emit(this.name());
  }

  private computeTextColor(hex: string | null): string | null {
    if (!hex) return null;
    const rgb = this.hexToRgb(hex);
    if (!rgb) return '#f9fafb';
    const [r = 0, g = 0, b = 0] = rgb.map((v) => v / 255);
    const [rLin = 0, gLin = 0, bLin = 0] = [r, g, b].map((v) =>
      v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
    );
    const luminance = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    return luminance > 0.5 ? '#111827' : '#f9fafb';
  }

  private hexToRgb(hex: string): [number, number, number] | null {
    const normalized = hex.replace('#', '');
    const int = parseInt(normalized, 16);
    if (Number.isNaN(int)) return null;
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  private normalizeColor(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return null;
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
}
````

## File: libs/uxcommon/src/components/textarea/textarea.ts
````typescript
import { Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

@Component({
  selector: 'pc-textarea',
  imports: [FormField],
  template: `
    <div class="flex flex-col gap-1 w-full">
      @if (label()) {
        <label class="label py-0 pl-1">
          <span class="label-text text-xs font-semibold text-base-content/70">{{ label() }}</span>
        </label>
      }

      <textarea
        [placeholder]="placeholder()"
        [formField]="formField()"
        [rows]="rows()"
        class="textarea textarea-bordered w-full"
        [class.textarea-error]="
          hasError() || (formField()().invalid() && (formField()().dirty() || formField()().touched()))
        "
      ></textarea>

      @if ((hasError() || formField()().invalid()) && (formField()().dirty() || formField()().touched())) {
        @for (err of formField()().errors(); track err) {
          <p class="text-[11px] text-error pl-1">{{ err.message }}</p>
        }
      }
    </div>
  `,
})
export class Textarea {
  public label = input<string>();
  public placeholder = input<string>('');
  public rows = input<number>(3);
  public formField = input.required<any>();
  public hasError = input<boolean>(false);
}
````

## File: libs/uxcommon/src/components/toggle/toggle.ts
````typescript
import { Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

@Component({
  selector: 'pc-toggle',
  imports: [FormField],
  template: `
    <div class="flex flex-col gap-1 w-full">
      <label class="label cursor-pointer justify-between gap-4 py-1">
        @if (label()) {
          <span class="label-text text-sm font-medium text-base-content">{{ label() }}</span>
        }
        <input
          type="checkbox"
          class="toggle toggle-primary shrink-0"
          [formField]="formField()"
          [class.toggle-error]="formField()().invalid() && (formField()().dirty() || formField()().touched())"
        />
      </label>

      @if (formField()().invalid() && (formField()().dirty() || formField()().touched())) {
        @for (err of formField()().errors(); track err) {
          <p class="text-[11px] text-error pl-1">{{ err.message }}</p>
        }
      }
    </div>
  `,
})
export class Toggle {
  public label = input<string>();
  public formField = input.required<any>();
}
````

## File: libs/uxcommon/src/components/user-avatar/user-avatar.ts
````typescript
import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'pc-user-avatar',
  template: `
    <div class="avatar" [class.placeholder]="!avatarUrl()">
      @if (avatarUrl()) {
        <div
          class="rounded-full overflow-hidden ring ring-base-100 ring-offset-1"
          [style.width.rem]="sizeRem()"
          [style.height.rem]="sizeRem()"
        >
          <img
            [src]="avatarUrl()!"
            [alt]="name() + ' avatar'"
            class="w-full h-full object-cover"
            referrerpolicy="no-referrer"
          />
        </div>
      } @else {
        <div
          class="rounded-full grid place-items-center font-bold ring ring-base-100 ring-offset-1 bg-primary/15 text-primary"
          [style.width.rem]="sizeRem()"
          [style.height.rem]="sizeRem()"
          [style.font-size.rem]="fontSizeRem()"
        >
          <span>{{ initials() }}</span>
        </div>
      }
    </div>
  `,
  host: { class: 'contents' },
})
export class UserAvatarComponent {
  readonly avatarUrl = input<string | null | undefined>(null);

  readonly name = input.required<string>();

  readonly size = input<number>(8);

  protected readonly sizeRem = computed(() => this.size() * 0.25);
  protected readonly fontSizeRem = computed(() => Math.max(0.5, this.size() * 0.25 * 0.4));

  protected readonly initials = computed(() => {
    const n = (this.name() ?? '').trim();
    if (!n) return '?';
    const parts = n.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    }
    return n[0]!.toUpperCase();
  });
}
````

## File: libs/uxcommon/src/components/confirm-dialog-host.html
````html
<dialog #dlg class="modal">
  @if (state()) {
  <div class="modal-box">
    <div class="flex items-center gap-2">
      <pc-icon [name]="icon()" class="text-xl" />
      <h3 class="text-lg font-bold">{{ state()!.title }}</h3>
    </div>

    @if (state()!.message) {
    <p class="pt-4 pb-6 font-light whitespace-pre-line">{{ state()!.message }}</p>
    } @if (state()!.type === 'prompt') {
    <input
      [placeholder]="state()!.inputPlaceholder || ''"
      class="input input-bordered w-full mb-4"
      [value]="promptValue()"
      (input)="onPromptInput($event)"
    />
    } @if (state()!.type === 'choose') {
    <div class="flex flex-col gap-2 w-full mt-4">
      @for (choice of state()!.choices; track choice.label) {
      <button class="btn w-full" [class]="choiceBtnClass(choice.variant)" (click)="onChoice(choice.value)">
        {{ choice.label }}
      </button>
      } @if (showCancel()) {
      <button class="btn w-full font-normal" (click)="onCancel()">{{ state()!.cancelText }}</button>
      }
    </div>
    } @else {
    <div class="flex justify-end gap-2">
      @if (showCancel()) {
      <button class="btn" [class]="cancelBtnClass()" (click)="onCancel()">{{ state()!.cancelText }}</button>
      }
      <button class="btn" [class]="confirmBtnClass()" (click)="onConfirm()">{{ state()!.confirmText }}</button>
    </div>
    }
  </div>

  <form method="dialog" class="modal-backdrop" (submit)="onBackdrop()">
    <button>close</button>
  </form>
  }
</dialog>
````

## File: libs/uxcommon/src/components/confirm-dialog-host.ts
````typescript
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Icon } from '@uxcommon/components/icons/icon';
import { ConfirmDialogService, DialogVariant } from './confirm-dialog.service';

@Component({
  selector: 'pc-dialog-host',
  imports: [Icon],
  templateUrl: './confirm-dialog-host.html',
})
export class ConfirmDialogHost {
  private readonly svc = inject(ConfirmDialogService);

  public readonly promptValue = signal(''); // bound via [value] + (input) in the template

  private readonly stateSignal = this.svc.stateSignal;
  private readonly openSignal = this.svc.isOpenSignal;
  public state = this.stateSignal;
  // §7.4: destructive dialogs style the SAFE action as primary. Danger variants
  // default to emphasizing the cancel/keep button unless a caller opts out, and
  // only when a cancel button is actually shown.
  public readonly effectiveEmphasizeCancel = computed(() => {
    const st = this.state();
    if (!st) return false;
    const explicit = st.emphasizeCancel;
    const wants = explicit ?? st.variant === 'danger';
    return wants && this.showCancel();
  });
  public confirmBtnClass = computed(() => {
    const v = (this.state()?.variant ?? 'neutral') as DialogVariant;
    if (this.effectiveEmphasizeCancel()) {
      switch (v) {
        case 'danger':
          return 'btn-ghost text-error';
        case 'warning':
          return 'btn-ghost text-warning';
        case 'info':
          return 'btn-ghost text-info';
        case 'success':
          return 'btn-ghost text-success';
        default:
          return 'btn-ghost';
      }
    }
    // UX-GUIDELINES §4b: destructive/archive confirms wear the outline role classes;
    // affirmative confirms (info/success/neutral) are the surface's main action.
    switch (v) {
      case 'danger':
        return 'btn-outline btn-error';
      case 'warning':
        return 'btn-outline btn-warning';
      case 'info':
      case 'success':
      default:
        return 'btn-primary';
    }
  });

  // Mirror the confirm side: whenever the destructive/confirm action is de-emphasized
  // (danger variants by default, or any explicit emphasizeCancel), style the safe
  // cancel/keep action as the primary default so there is always a clear safe default (§7.4).
  // Default cancel wears the house cancel style (UX-GUIDELINES "Buttons"): outline accent.
  public cancelBtnClass = computed(() => (this.effectiveEmphasizeCancel() ? 'btn-primary' : 'btn-outline btn-accent'));

  public choiceBtnClass(v?: DialogVariant): string {
    if (!v) return '';
    switch (v) {
      case 'danger':
        return 'btn-outline btn-error';
      case 'warning':
        return 'btn-outline btn-warning';
      case 'info':
      case 'success':
        return 'btn-primary';
      default:
        return '';
    }
  }

  public readonly dlgRef = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  public icon = computed(() => this.state()?.icon ?? this.svc.defaultIconFor('neutral'));
  public showCancel = computed(() => {
    const st = this.state();
    if (!st) return false;
    if (st.type === 'choose') {
      return !!st.cancelText;
    }
    return !!st.cancelText && st.type !== 'alert';
  });

  constructor() {
    effect(() => {
      const open = this.openSignal();
      const dlg = this.dlgRef()?.nativeElement;
      if (!dlg) return;

      if (open) {
        this.promptValue.set(this.stateSignal()?.defaultValue ?? '');
        if (!dlg.open) {
          try {
            dlg.showModal();
          } catch {}
        }
      } else if (dlg.open) {
        try {
          dlg.close();
        } catch {}
      }
    });
  }

  public onPromptInput(event: Event): void {
    this.promptValue.set((event.target as HTMLInputElement).value);
  }

  public onBackdrop(): void {
    const st = this.state();
    if (st?.allowBackdropClose) this.svc.cancel();
  }

  public onCancel(): void {
    this.svc.cancel();
  }

  public onConfirm(): void {
    const st = this.state();
    if (!st) return;
    if (st.type === 'prompt') this.svc.ok(this.promptValue());
    else if (st.type === 'alert') this.svc.ok();
    else this.svc.ok(true);
  }

  public onChoice(value: unknown): void {
    this.svc.ok(value);
  }
}
````

## File: libs/uxcommon/src/components/confirm-dialog.service.ts
````typescript
import { signal, computed, Service } from '@angular/core';
import type { PcIconNameType } from '@icons/icons.index';

export interface DialogChoice<T = any> {
  label: string;
  value: T;
  variant?: DialogVariant;
}

export interface ChooseOptions<T = any> {
  allowBackdropClose?: boolean;
  cancelText?: string;
  choices: DialogChoice<T>[];
  icon?: PcIconNameType;
  message?: string;
  title: string;
  variant?: DialogVariant;
}

export interface BaseDialogOptions {
  allowBackdropClose?: boolean; // default true for alert/prompt, false for danger confirm
  cancelText?: string; // default per type
  confirmText?: string; // default per type
  /** Style cancel as the primary/safe-default button and confirm as a plain variant-colored one (e.g. "Keep editing" vs. "Discard changes"). */
  emphasizeCancel?: boolean;
  icon?: PcIconNameType; // optional icon name for <pc-icon>
  message?: string;
  title: string;
  variant?: DialogVariant;
}

export interface DialogState {
  allowBackdropClose: boolean;
  cancelText: string;
  confirmText: string;
  defaultValue?: string;
  emphasizeCancel?: boolean;
  icon?: PcIconNameType;

  // prompt
  inputPlaceholder?: string;
  message?: string;
  title: string;
  type: DialogType;
  variant: DialogVariant;

  // choose
  choices?: DialogChoice[];
}

export interface PromptOptions extends BaseDialogOptions {
  defaultValue?: string;
  inputPlaceholder?: string;
}

@Service()
export class ConfirmDialogService {
  private _resolve: ((value?: any) => void) | null = null;

  public readonly stateSignal = signal<DialogState | null>(null);

  public readonly isOpenSignal = computed(() => this.stateSignal() !== null);

  public alert(opts: BaseDialogOptions): Promise<void> {
    this.open({
      type: 'alert',
      title: opts.title,
      message: opts.message,
      variant: opts.variant ?? 'info',
      icon: opts.icon ?? this.defaultIconFor(opts.variant ?? 'info'),
      allowBackdropClose: opts.allowBackdropClose ?? true,
      confirmText: 'OK',
      cancelText: '',
    });
    return new Promise<void>((resolve) => (this._resolve = resolve));
  }

  public cancel(): void {
    // Normalize cancel values per dialog type
    const st = this.stateSignal();
    if (st?.type === 'confirm') this._resolve?.(false);
    else if (st?.type === 'alert') this._resolve?.();
    else if (st?.type === 'prompt') this._resolve?.(null);
    else if (st?.type === 'choose') this._resolve?.(null);
    this.close();
  }

  public confirm(opts: BaseDialogOptions): Promise<boolean> {
    const v = opts.variant ?? 'neutral';
    const allowBackdropClose = opts.allowBackdropClose ?? v !== 'danger';
    const confirmText = opts.confirmText ?? (v === 'danger' ? 'Delete' : 'OK');
    const cancelText = opts.cancelText ?? 'Cancel';

    this.open({
      type: 'confirm',
      title: opts.title,
      message: opts.message,
      variant: v,
      icon: opts.icon ?? this.defaultIconFor(v),
      allowBackdropClose,
      confirmText,
      cancelText,
      emphasizeCancel: opts.emphasizeCancel,
    });

    return new Promise<boolean>((resolve) => (this._resolve = resolve));
  }

  public choose<T>(opts: ChooseOptions<T>): Promise<T | null> {
    const v = opts.variant ?? 'neutral';
    this.open({
      type: 'choose',
      title: opts.title,
      message: opts.message,
      variant: v,
      icon: opts.icon ?? this.defaultIconFor(v),
      allowBackdropClose: opts.allowBackdropClose ?? true,
      confirmText: '',
      cancelText: opts.cancelText ?? 'Cancel',
      choices: opts.choices,
    });

    return new Promise<T | null>((resolve) => (this._resolve = resolve));
  }

  public defaultIconFor(variant: DialogVariant): PcIconNameType {
    switch (variant) {
      case 'danger':
        return 'exclamation-triangle';
      case 'warning':
        return 'exclamation-circle';
      case 'info':
        return 'information-circle';
      case 'success':
        return 'check-circle';
      default:
        return 'x-mark';
    }
  }

  public ok(payload?: unknown): void {
    this._resolve?.(payload ?? true);
    this.close();
  }

  public prompt(opts: PromptOptions): Promise<string | null> {
    this.open({
      type: 'prompt',
      title: opts.title,
      message: opts.message,
      variant: opts.variant ?? 'neutral',
      icon: opts.icon ?? ('pencil-square' as PcIconNameType),
      allowBackdropClose: opts.allowBackdropClose ?? true,
      confirmText: opts.confirmText ?? 'OK',
      cancelText: opts.cancelText ?? 'Cancel',
      inputPlaceholder: opts.inputPlaceholder,
      defaultValue: opts.defaultValue,
    });
    return new Promise<string | null>((resolve) => (this._resolve = resolve));
  }

  private close(): void {
    this.stateSignal.set(null);
    this._resolve = null;
  }

  private open(st: DialogState): void {
    this.stateSignal.set(st);
  }
}

export type DialogType = 'confirm' | 'alert' | 'prompt' | 'choose';

export type DialogVariant = 'danger' | 'warning' | 'info' | 'success' | 'neutral';
````

## File: libs/uxcommon/src/directives/animate-if.directive.ts
````typescript
import {
  Directive,
  DestroyRef,
  EmbeddedViewRef,
  Signal,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  input,
} from '@angular/core';

@Directive({
  selector: '[pcAnimateIf]',
})
export class AnimateIfDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  public readonly duration = input(300, { alias: 'pcAnimateIfDuration' });

  public readonly pcAnimateIfEnter = input('animate-left');

  public readonly pcAnimateIfExit = input('animate-exit-right');

  public readonly pcAnimateIf = input.required<Signal<boolean>>();

  private condition = false;
  private timeoutId: NodeJS.Timeout | undefined;
  private view: EmbeddedViewRef<unknown> | null = null;

  constructor() {
    effect(() => {
      const conditionSignal = this.pcAnimateIf();
      if (conditionSignal) {
        this.toggle(conditionSignal());
      }
    });

    this.destroyRef.onDestroy(() => {
      clearTimeout(this.timeoutId);

      if (this.view?.rootNodes[0]) {
        const el = this.view.rootNodes[0] as HTMLElement;
        el?.classList.remove(this.pcAnimateIfEnter(), this.pcAnimateIfExit());
      }
    });
  }

  private animatedEntry() {
    this.vcr.clear();
    this.view = this.vcr.createEmbeddedView(this.template);
    const enterClass = this.pcAnimateIfEnter();
    const el = this.view.rootNodes[0] as HTMLElement;
    requestAnimationFrame(() => el?.classList.add(enterClass));
  }

  private animatedExit() {
    if (!this.view?.rootNodes[0]) return;

    const el = this.view.rootNodes[0] as HTMLElement;
    const enterClass = this.pcAnimateIfEnter();
    const exitClass = this.pcAnimateIfExit();

    // Remove entry animation in case it's still applied
    el.classList.remove(enterClass);

    // If exit animation is 'animate-none', clear the view immediately without delay
    if (exitClass === 'animate-none') {
      this.vcr.clear();
      this.view = null;
      return;
    }

    // Add exit animation
    el.classList.add(exitClass);

    this.timeoutId = setTimeout(() => {
      // Cleanup all animation classes before removal
      el.classList.remove(enterClass, exitClass);
      this.vcr.clear();
      this.view = null;
    }, this.duration());
  }

  private toggle(condition: boolean) {
    if (condition === this.condition) return;

    this.condition = condition;

    if (condition) this.animatedEntry();
    else if (this.view) this.animatedExit();
  }
}
````

## File: libs/uxcommon/src/directives/spin-on-click.directive.ts
````typescript
import { Directive, DestroyRef, ElementRef, inject, input } from '@angular/core';

@Directive({
  selector: 'button[pcSpinOnClick]',
  exportAs: 'pcSpinOnClick',
  host: { '(click)': 'onButtonClick()' },
})
export class SpinOnClickDirective {
  private readonly el = inject(ElementRef<HTMLButtonElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly minMs = input(700);

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  protected onButtonClick(): void {
    const icon = this.el.nativeElement.querySelector('pc-icon') as HTMLElement | null;
    if (!icon) return;

    icon.classList.add('animate-spin', 'inline-block');
    this.clearTimer();

    this.timer = setTimeout(() => {
      icon.classList.remove('animate-spin', 'inline-block');
      this.timer = null;
    }, this.minMs());
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
````

## File: libs/uxcommon/src/mentions/mention-controller.ts
````typescript
import { computed, signal } from '@angular/core';
import type { IAuthUser } from '../../../common/src/lib/auth';

export class MentionController {
  private getUsers: () => IAuthUser[];

  // reactive state
  public readonly open = signal(false);
  public readonly index = signal(0);
  public readonly query = signal('');

  // ephemeral caret/selection details
  private start = -1; // position of '@'
  private caretPos = 0;

  public readonly candidates = computed<IAuthUser[]>(() => {
    const q = this.query().toLowerCase();
    if (!this.open() || !q) return [];
    const users = this.getUsers() || [];
    const uniq = new Map<string, IAuthUser>();
    for (const u of users) {
      if (!u) continue;
      const name = (u.first_name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const local = email.split('@')[0] || '';
      if ((name && name.includes(q)) || (local && local.includes(q)) || (email && email.includes(q))) {
        if (!uniq.has(u.id)) uniq.set(u.id, u);
      }
    }
    return Array.from(uniq.values()).slice(0, 8);
  });

  constructor(getUsers: () => IAuthUser[]) {
    this.getUsers = getUsers;
  }

  public updateFromInput(text: string, caretPos: number): void {
    this.caretPos = caretPos;
    const res = this.findMentionAt(text, caretPos);
    if (!res) {
      this.open.set(false);
      this.query.set('');
      this.start = -1;
    } else {
      this.start = res.start;
      this.query.set(res.token);
      this.open.set(true);
      this.index.set(0);
    }
  }

  public handleKeydown(ev: KeyboardEvent, onSelect: (u: IAuthUser) => void): void {
    if (!this.open()) return;
    const list = this.candidates();
    if (!list.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.index.set((this.index() + 1) % list.length);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.index.set((this.index() - 1 + list.length) % list.length);
    } else if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      onSelect(list[this.index()]!);
    } else if (ev.key === 'Escape') {
      this.open.set(false);
    }
  }

  public select(user: IAuthUser, text: string): { text: string; caret: number } {
    if (this.start < 0) return { text, caret: this.caretPos };
    const display = user.first_name || user.email.split('@')[0]!;
    let before = text.slice(0, this.start);
    // Collapse any trailing whitespace/newlines immediately before '@' into a single space to keep inline
    before = before.replace(/\s+$/g, ' ');
    const after = text.slice(this.caretPos);
    const inserted = `@${display} `;
    const newText = before + inserted + after;
    const newCaret = before.length + inserted.length;
    this.open.set(false);
    this.index.set(0);
    return { text: newText, caret: newCaret };
  }

  public getStartIndex(): number {
    return this.start;
  }

  public getCaretIndex(): number {
    return this.caretPos;
  }

  private findMentionAt(text: string, pos: number): { start: number; token: string } | null {
    let i = pos - 1;
    while (i >= 0) {
      const ch = text[i]!;
      if (ch === '@') break;
      if (!/[-A-Za-z0-9_.]/.test(ch)) return null; // hit a separator before '@'
      i--;
    }
    if (i < 0 || text[i]! !== '@') return null;
    const start = i;
    if (start > 0) {
      const prev = text[start - 1]!;
      if (/[@A-Za-z0-9_]/.test(prev)) return null;
    }
    const token = text.slice(start + 1, pos);
    if (!token) return null;
    return { start, token };
  }
}

export function userDisplay(u: IAuthUser): string {
  return u.first_name || u.email.split('@')[0]!;
}
````

## File: libs/uxcommon/src/pipes/file-icon.pipe.ts
````typescript
// file-icon.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

import { ICON_FOR_KEY, iconKeyForFilename } from './file-icon.util';

@Pipe({
  name: 'fileIcon',
})
export class FileIconPipe implements PipeTransform {
  public transform(filename: string | null | undefined): string {
    const key = iconKeyForFilename(filename ?? '');
    return ICON_FOR_KEY[key] ?? ICON_FOR_KEY.unknown;
  }
}
````

## File: libs/uxcommon/src/pipes/file-icon.util.ts
````typescript
import type { PcIconNameType } from '@icons/icons.index';

// file-icon.util.ts
export type FileIconKey =
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'code'
  | 'design'
  | 'font'
  | 'ebook'
  | 'email'
  | 'calendar'
  | 'contact'
  | 'db'
  | 'disk'
  | 'exe'
  | 'unknown';

function cleanName(name: string): string {
  // strip query/hash (e.g., foo.pdf?dl=1#x)
  return name.split('#')[0]!.split('?')[0]!.trim();
}

export function iconKeyForFilename(filename: string): FileIconKey {
  if (!filename) return 'unknown';
  const name = cleanName(filename.toLowerCase());

  // multi-part extensions first (e.g., .tar.gz)
  for (const mex of MULTI_EXT) {
    if (name.endsWith(`.${mex}`)) return 'archive';
  }

  // single extension
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1 || lastDot === name.length - 1) return 'unknown';
  const ext = name.slice(lastDot + 1);
  return EXT_TO_KEY[ext] ?? 'unknown';
}

const EXT_MAP: Record<FileIconKey, string[]> = {
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'rtf', 'odt', 'pages'],
  sheet: ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'],
  slides: ['ppt', 'pptx', 'key', 'odp'],
  text: ['txt', 'md', 'markdown', 'rst', 'log'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga'],
  video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'],
  code: [
    'js',
    'ts',
    'jsx',
    'tsx',
    'json',
    'jsonl',
    'html',
    'css',
    'scss',
    'xml',
    'yml',
    'yaml',
    'sql',
    'py',
    'java',
    'c',
    'cpp',
    'h',
    'cs',
    'go',
    'rs',
    'php',
    'rb',
    'kt',
    'swift',
    'sh',
    'ps1',
  ],
  design: ['psd', 'ai', 'fig', 'xd', 'sketch'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  ebook: ['epub', 'mobi', 'azw', 'djvu'],
  email: ['eml', 'msg'],
  calendar: ['ics'],
  contact: ['vcf'],
  db: ['sqlite', 'sqlite3', 'db', 'mdb', 'accdb', 'parquet'],
  disk: ['iso', 'dmg', 'img'],
  exe: ['exe', 'msi', 'apk', 'pkg', 'appimage'],
  unknown: [],
};

// reverse lookup
const EXT_TO_KEY: Record<string, FileIconKey> = Object.entries(EXT_MAP).reduce(
  (acc, [key, exts]) => {
    for (const e of exts) acc[e] = key as FileIconKey;
    return acc;
  },
  {} as Record<string, FileIconKey>,
);
const MULTI_EXT = ['tar.gz', 'tar.bz2', 'tar.xz', 'tgz'] as const;

// Map to your <pc-icon> names (assume these exist in your icon set)
export const ICON_FOR_KEY: Record<FileIconKey, PcIconNameType> = {
  pdf: 'file-pdf',
  doc: 'file-doc',
  sheet: 'file-sheet',
  slides: 'file-slides',
  text: 'file-text',
  image: 'file-image',
  audio: 'file-audio',
  video: 'file-video',
  archive: 'file-archive',
  code: 'file-code',
  design: 'file-design',
  font: 'file-font',
  ebook: 'file-ebook',
  email: 'file-email',
  calendar: 'file-calendar',
  contact: 'file-contact',
  db: 'file-db',
  disk: 'file-disk',
  exe: 'file-exe',
  unknown: 'unknown',
};
````

## File: libs/uxcommon/src/pipes/filesize.pipe.ts
````typescript
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'fileSize',
})
export class FileSizePipe implements PipeTransform {
  public transform(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}
````

## File: libs/uxcommon/src/pipes/mention.pipe.ts
````typescript
import { Pipe, PipeTransform } from '@angular/core';

import type { IAuthUser } from '../../../common/src/lib/auth';

@Pipe({ name: 'mentionify', standalone: true })
export class MentionifyPipe implements PipeTransform {
  public transform(text: string | null | undefined, users: IAuthUser[] | null | undefined): string {
    if (!text) return '';
    const list = users ?? [];

    const byFirst = new Map<string, IAuthUser>();
    const byEmail = new Map<string, IAuthUser>();
    const byLocal = new Map<string, IAuthUser>();

    for (const u of list) {
      if (!u) continue;
      if (u.first_name) byFirst.set(u.first_name.toLowerCase(), u);
      if (u.email) {
        const em = u.email.toLowerCase();
        byEmail.set(em, u);
        const local = em.split('@')[0] ?? '';
        if (local) byLocal.set(local, u);
      }
    }

    // Normalize Windows newlines and collapse any whitespace/newlines immediately before a mention into a single space
    // This prevents mentions from starting on a new line when users select from autocomplete
    const normalized = text
      .replace(/\r\n?/g, '\n')
      // collapse runs like "  \n   @john" -> " @john"
      .replace(/[^\S\r\n]*\n+[^\S\r\n]*(?=@[A-Za-z0-9._-]+)/g, ' ')
      // also collapse leading newlines before a mention at the very start
      .replace(/^\s*\n+\s*(?=@[A-Za-z0-9._-]+)/, '');

    // Replace @mentions while preserving preceding character (so we don't match email domains)
    const replaced = normalized.replace(/(^|[^\w@])@([A-Za-z0-9._-]+)/g, (_m, pre: string, token: string) => {
      const key = token.toLowerCase();
      const u = byFirst.get(key) || byEmail.get(key) || byLocal.get(key);
      if (!u) return `${pre}@${token}`; // leave as-is if no match

      // Display prefers first_name; fallback to email local part
      const display = u.first_name || u.email.split('@')[0]!;
      // Use utility classes for styling; sanitized later by sanitizeHtml pipe
      // Mark with data-mention for CSS targeting to enforce inline layout
      return `${pre}<span data-mention="1" class="inline font-bold hover:cursor-pointer">@${this.escapeHtml(display)}</span>`;
    });

    // Convert newlines to <br>
    return replaced.replace(/\n/g, '<br>');
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
````

## File: libs/uxcommon/src/pipes/sanitize-html.pipe.ts
````typescript
// sanitize-html.pipe.ts
import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import DOMPurify from 'dompurify';

@Pipe({ name: 'sanitizeHtml' })
export class SanitizeHtmlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  public transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    const clean = DOMPurify.sanitize(value, {
      ALLOWED_TAGS: [
        'a',
        'p',
        'br',
        'strong',
        'em',
        'ul',
        'ol',
        'li',
        'img',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'td',
        'th',
        'colgroup',
        'col',
        'span',
        'div',
        'hr',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'pre',
        'code',
        'sub',
        'sup',
        'b',
        'i',
        'u',
      ],
      ALLOWED_ATTR: [
        'href',
        'target',
        'rel',
        'src',
        'alt',
        'title',
        'style',
        'class',
        'data-mention',
        'width',
        'height',
        'colspan',
        'rowspan',
        'align',
        'valign',
        'cellpadding',
        'cellspacing',
        'border',
      ],
      RETURN_TRUSTED_TYPE: false,
    });
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
````

## File: libs/uxcommon/src/pipes/svg-html-pipe.ts
````typescript
import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ standalone: true, name: 'bypassHtmlSanitizer' })
export class BypassHtmlSanitizerPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  public transform(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
````

## File: libs/uxcommon/src/pipes/timeago.pipe.ts
````typescript
import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform, inject } from '@angular/core';

export interface TimeAgoOptions {
  thresholdDays?: number;
  style?: 'long' | 'short' | 'compact' | string;
  compact?: boolean;
  hideSuffix?: boolean;
  // Index signature ensures any other existing options in your codebase are accepted
  [key: string]: any;
}

@Pipe({
  name: 'timeAgo', // Matched to your template casing
  pure: false, // Must be false to update the UI over time
})
export class TimeAgoPipe implements PipeTransform, OnDestroy {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private lastValue?: string | number | Date | null;
  private lastOptsJson?: string;
  private lastResult = '';

  private readonly cdr = inject(ChangeDetectorRef);

  public transform(value: string | number | Date | null | undefined, opts?: TimeAgoOptions): string {
    // Stringify options to avoid pure:false memory reference loops
    const optsJson = opts ? JSON.stringify(opts) : '';

    // Only recalculate if the date OR the options have actually changed
    if (this.lastValue === value && this.lastOptsJson === optsJson && this.timerId) {
      return this.lastResult;
    }

    this.lastValue = value;
    this.lastOptsJson = optsJson;
    this.clearTimer();

    if (!value) {
      this.lastResult = '';
      return this.lastResult;
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
      this.lastResult = String(value);
      return this.lastResult;
    }

    const diffMs = new Date().getTime() - date.getTime();

    // Calculate and cache the result
    this.lastResult = this.formatTimeAgo(date, diffMs, opts);
    this.setupTimer(diffMs);

    return this.lastResult;
  }

  private formatTimeAgo(date: Date, diffMs: number, opts?: TimeAgoOptions): string {
    const seconds = Math.floor(Math.abs(diffMs) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    // If a threshold is set and exceeded, fallback to a standard date string
    if (opts?.thresholdDays !== undefined && days >= opts.thresholdDays) {
      return date.toLocaleDateString(undefined, {
        month: opts.style === 'short' ? 'short' : 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const suffix = opts?.hideSuffix ? '' : ' ago';

    // Handle compact/short styles
    if (opts?.compact || opts?.style === 'compact' || opts?.style === 'short') {
      if (seconds < 60) return 'now';
      if (minutes < 60) return `${minutes}m`;
      if (hours < 24) return `${hours}h`;
      return `${days}d`;
    }

    // Default long style
    if (seconds < 60) return 'just now';
    if (minutes === 1) return `a minute${suffix}`;
    if (minutes < 60) return `${minutes} minutes${suffix}`;
    if (hours === 1) return `an hour${suffix}`;
    if (hours < 24) return `${hours} hours${suffix}`;
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days${suffix}`;

    const months = Math.floor(days / 30);
    if (months === 1) return `a month${suffix}`;
    if (months < 12) return `${months} months${suffix}`;

    const years = Math.floor(days / 365);
    if (years === 1) return `a year${suffix}`;
    return `${years} years${suffix}`;
  }

  private setupTimer(diffMs: number): void {
    const seconds = Math.floor(Math.abs(diffMs) / 1000);
    const minutes = Math.floor(seconds / 60);

    let timeoutMs = 60000;

    // Scale update frequency based on age to save CPU
    if (seconds < 60) {
      timeoutMs = 10000; // 10 seconds
    } else if (minutes < 60) {
      timeoutMs = 60000; // 1 minute
    } else if (minutes < 1440) {
      timeoutMs = 3600000; // 1 hour
    } else {
      timeoutMs = 86400000; // 1 day
    }

    // Native setTimeout triggers Angular's zoneless scheduler internally
    // when markForCheck is called inside it.
    this.timerId = setTimeout(() => {
      this.cdr.markForCheck();
    }, timeoutMs);
  }

  private clearTimer(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  public ngOnDestroy(): void {
    this.clearTimer();
  }
}
````

## File: libs/uxcommon/src/request-guard.ts
````typescript
export type RequestGuard = {
  /**
   * Marks the start of a new request and returns a checker for it. After each
   * `await`, bail out unless the checker still returns true — a newer request
   * has superseded this one and its (stale) response must not land.
   */
  begin(): () => boolean;
};

/**
 * Guards a reloadable async data source against out-of-order responses: when a
 * component reloads on an input change (e.g. prev/next record navigation), a
 * slow earlier response must not overwrite the newer record.
 *
 * ```ts
 * private readonly guard = createRequestGuard();
 *
 * async load(id: string) {
 *   const isCurrent = this.guard.begin();
 *   const data = await this.svc.getById(id);
 *   if (!isCurrent()) return;
 *   this.detail.set(data);
 * }
 * ```
 */
export function createRequestGuard(): RequestGuard {
  let sequence = 0;
  return {
    begin(): () => boolean {
      const requestId = ++sequence;
      return () => requestId === sequence;
    },
  };
}
````

## File: libs/uxcommon/src/test-setup.ts
````typescript
import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';

import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { getTestBed } from '@angular/core/testing';
import { vi } from 'vitest';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

(globalThis as any).jest = vi;
(globalThis as any).fetch = vi.fn().mockResolvedValue({
  ok: true,
  text: () => Promise.resolve('<svg></svg>'),
});
````

## File: libs/uxcommon/eslint.config.cjs
````javascript
const { FlatCompat } = require('@eslint/eslintrc');
const path = require('path');

const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  ...compat
    .config({
      extends: ['plugin:@nx/angular', 'plugin:@angular-eslint/template/process-inline-templates'],
      parserOptions: {
        project: [
          path.resolve(__dirname, 'tsconfig.lib.json'),
          path.resolve(__dirname, 'tsconfig.spec.json'),
          path.resolve(__dirname, '../../tsconfig.base.json'),
        ],
        sourceType: 'module',
      },
    })
    .map((cfg) => ({
      ...cfg,
      files: ['**/*.ts'],
      rules: {
        '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'pc', style: 'camelCase' }],
        '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'pc', style: 'kebab-case' }],
      },
    })),

  ...compat
    .config({
      extends: ['plugin:@nx/angular-template', 'plugin:@angular-eslint/template/recommended'],
    })
    .map((cfg) => ({
      ...cfg,
      files: ['**/*.html'],
      rules: {},
    })),
];
````

## File: libs/uxcommon/project.json
````json
{
  "name": "uxcommon",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/uxcommon/src",
  "prefix": "lib",
  "projectType": "library",
  "tags": [],
  "targets": {
    "test": {
      "executor": "nx:run-commands",
      "cache": true,
      "outputs": ["{workspaceRoot}/coverage/libs/uxcommon"],
      "options": {
        "cwd": "libs/uxcommon",
        "command": "vitest run"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
````

## File: libs/uxcommon/README.md
````markdown
# uxcommon

This library was generated with [Nx](https://nx.dev).

## Running unit tests

Run `nx test uxcommon` to execute the unit tests.
````

## File: libs/uxcommon/tsconfig.json
````json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "module": "preserve"
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "typeCheckHostBindings": true,
    "strictTemplates": true
  },
  "files": [],
  "include": [],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    },
    {
      "path": "./tsconfig.spec.json"
    }
  ]
}
````

## File: libs/uxcommon/tsconfig.lib.json
````json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "declaration": true,
    "declarationMap": true,
    "inlineSources": true,
    "types": []
  },
  "exclude": [
    "src/**/*.spec.ts",
    "src/test-setup.ts",
    "jest.config.ts",
    "src/**/*.test.ts",
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.tsx",
    "src/**/*.spec.tsx",
    "src/**/*.test.js",
    "src/**/*.spec.js",
    "src/**/*.test.jsx",
    "src/**/*.spec.jsx"
  ],
  "include": ["src/**/*.ts"]
}
````

## File: libs/uxcommon/tsconfig.spec.json
````json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "types": ["vitest/globals", "vitest/importMeta", "vite/client", "node", "vitest"]
  },
  "include": [
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.test.tsx",
    "src/**/*.spec.tsx",
    "src/**/*.test.js",
    "src/**/*.spec.js",
    "src/**/*.test.jsx",
    "src/**/*.spec.jsx",
    "src/**/*.d.ts"
  ],
  "files": ["src/test-setup.ts"]
}
````

## File: libs/common/src/lib/help/articles/grids.ts
````typescript
import type { HelpArticle } from '../help-types';

export const GRIDS_ARTICLES: HelpArticle[] = [
  {
    id: 'grid-basics',
    category: 'grids',
    title: 'Working in grids',
    summary: 'Every list in pplCRM is the same powerful grid. Learn it once and you know it everywhere.',
    keywords: ['grid', 'table', 'columns', 'rows', 'inline edit', 'undo', 'redo', 'refresh', 'resize', 'archive'],
    related: ['filters', 'bulk-actions', 'import', 'export'],
    blocks: [
      {
        kind: 'p',
        text: 'People, companies, tasks, donations. Every collection in pplCRM lives in the same grid, with the same toolbar in the same order. The habits below transfer to all of them.',
      },
      { kind: 'h2', id: 'toolbar', text: 'The toolbar, left to right' },
      {
        kind: 'list',
        items: [
          '**Refresh**: reload the grid without touching your filters.',
          '**Undo / Redo**: step your inline edits backward and forward.',
          '**Import CSV / Export CSV**: see [Import from CSV](/help/import) and [Export your data](/help/export).',
          '**Tag, issue, and list filters**: narrow to matching rows; see [Filters and the query builder](/help/filters).',
          '**Advanced filters and the query builder**: per-column conditions or full and/or logic.',
          '**Columns**: choose which columns are visible.',
          '**Archive** (where offered): flip between active and archived records.',
          '**New {record}** ("New person", "New household", …): the solid button at the far right creates a record of this type.',
        ],
      },
      { kind: 'h2', id: 'open-detail', text: 'Opening records' },
      {
        kind: 'p',
        text: 'The first column is always a link. Click the name to open the full record. The grid remembers your filters, page, and scroll position, so the breadcrumb back returns you exactly where you left off, and the record page gains previous/next arrows for the same filtered set.',
      },
      { kind: 'h2', id: 'inline-edit', text: 'Edit without leaving the grid' },
      {
        kind: 'steps',
        items: [
          { title: 'Double-click an editable cell', detail: 'Or move to it with the arrow keys and press `Enter`.' },
          {
            title: 'Change the value and confirm',
            detail: 'The cell saves immediately and flashes green so you know it landed.',
          },
          {
            title: 'Change your mind?',
            detail: 'The toolbar’s undo arrow reverses your last inline edit; redo brings it back.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Cell not editable?',
        text: 'Some columns are read-only on purpose: computed values, or fields that need the full form. Open the record to change those.',
      },
      { kind: 'h2', id: 'columns', text: 'Make the grid yours' },
      {
        kind: 'list',
        items: [
          'Hide columns you never use from the **Columns** menu: fewer columns, faster scanning.',
          'Drag a column edge to resize it.',
          'An empty grid always tells you why it is empty and what to do next. For example, “No results match these filters” with a one-click **Clear all filters**.',
        ],
      },
    ],
  },
  {
    id: 'filters',
    category: 'grids',
    title: 'Filters and the query builder',
    summary:
      'From one-click tag filters to full and/or queries, and how active filters always stay visible as removable chips.',
    keywords: ['filter', 'query builder', 'advanced filter', 'chips', 'conditions', 'segment', 'and or', 'narrow'],
    related: ['grid-basics', 'lists', 'tags-issues', 'search'],
    blocks: [
      {
        kind: 'p',
        text: 'Filters narrow a grid to the rows you care about, and pplCRM never hides what it is doing: a small funnel marks the filter row above the grid, every active filter appears as a chip there with a count of how many rows match, and dashed entry pills sit inline. Remove one chip, or **Clear all** at once.',
      },
      { kind: 'h2', id: 'quick-filters', text: 'Quick filters: the dashed pills' },
      {
        kind: 'list',
        items: [
          '**+ Add filter**: pick a field, an operator, and a value; the condition lands as one removable chip.',
          '**Tags**: check one or more tags; checked tags combine with OR (match any) and land as a single removable chip.',
          '**Issues**: same mechanics as tags, for issue interests.',
          '**Lists**: show only the members of one [list](/help/lists).',
        ],
      },
      { kind: 'h2', id: 'advanced', text: 'Per-column filters' },
      {
        kind: 'p',
        text: '**Advanced Filters** opens a filter row under the column headers: type a condition per column (a name fragment here, a city there), and the grid narrows to rows matching all of them.',
      },
      { kind: 'h2', id: 'builder', text: 'The query builder' },
      {
        kind: 'p',
        text: 'When per-column matching is not expressive enough, the **Advanced query builder** composes full conditions with and/or groups: “city is Springfield AND (donated this year OR volunteers)”. It is the same builder that powers dynamic lists, so a query you like can become a [list](/help/lists) that maintains itself.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Why is one of the filter buttons disabled?',
        text: 'Per-column filters and the query builder are mutually exclusive. Mixing both would make the result impossible to reason about. Clear one to use the other.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Filters follow you into records',
        text: 'Open a record from a filtered grid and the pager reads “N of M filtered”. `J`/`K` walk exactly the set you filtered, in order.',
      },
    ],
  },
  {
    id: 'bulk-actions',
    category: 'grids',
    title: 'Selection, bulk actions, and merging',
    summary:
      'Select rows to reveal the bulk action bar: tag, export, delete, clone, or merge many records in one motion.',
    keywords: ['bulk', 'selection', 'select all', 'mass update', 'batch', 'clone', 'merge', 'delete many', 'bulk tag'],
    related: ['grid-basics', 'duplicates', 'export', 'tags-issues'],
    blocks: [
      {
        kind: 'p',
        text: 'Tick the checkbox on one or more rows and a bulk action bar appears, always stating how many rows it will affect. No action is ever a mystery about scale.',
      },
      { kind: 'h2', id: 'select-all', text: 'Selecting beyond one page' },
      {
        kind: 'p',
        text: 'The header checkbox selects the visible page. If more rows match your filters, the grid offers **Select all N rows**. One click extends the selection to every match, and the bar confirms “All N rows are selected.”',
      },
      { kind: 'h2', id: 'actions', text: 'What you can do with a selection' },
      {
        kind: 'list',
        items: [
          '**Add tag**: type a tag name and apply it to every selected row at once.',
          '**Export**: download the selected rows as CSV.',
          '**Delete**: remove the selected rows, after a confirmation that states the count.',
          '**Clone**: available with exactly one row selected; duplicates it as a starting point.',
          '**Merge**: available with exactly two rows selected; combines them into one record.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Bulk delete is permanent',
        text: 'The confirmation dialog tells you exactly how many records are about to go. Read the number. There is no undo for delete.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Merging more than a pair?',
        text: 'The [Duplicates](/duplicates) finder reviews likely duplicates side by side across your whole database, better than hunting pairs by hand. See [Find and merge duplicates](/help/duplicates).',
      },
    ],
  },
];
````

## File: libs/common/src/lib/help/articles/productivity.ts
````typescript
import type { HelpArticle } from '../help-types';

export const PRODUCTIVITY_ARTICLES: HelpArticle[] = [
  {
    id: 'tasks',
    category: 'productivity',
    title: 'Tasks: list and board',
    summary:
      'Track the work: assign it, date it, and move it from to do to done, in whichever of the two views you prefer.',
    keywords: ['task', 'todo', 'board', 'kanban', 'assign', 'due date', 'priority', 'status', 'waiting', 'sla'],
    related: ['dashboard', 'teams', 'automations'],
    blocks: [
      {
        kind: 'p',
        text: 'Tasks capture commitments: call this donor back, print the signs, book the room. Every task carries a status, an optional priority, an assignee, and a due date, and it is the same data whichever of the two views you work from.',
      },
      { kind: 'h2', id: 'views', text: 'List or board: one dataset, two views' },
      {
        kind: 'list',
        items: [
          '[Tasks](/tasks) is the list view: tabs for All, Mine, Unassigned, and Done, grouped under Overdue/Today/Upcoming/No due date headings. Check a task off, or hand an unowned one to yourself with its Unassigned pill.',
          '[Task board](/tasks/board) shows one column per status: To do, In progress, Waiting, Done. Drag a card to another column to change its status, or drag it up and down within a column to set the order you want; the order sticks. Prefer the keyboard? The ‹ › buttons on a card still move it one column and dim at either end of the row. Jump to the board anytime with `g` then `b`.',
          'Every header carries a swap button (Open board / Open list), so you never have to hunt for the sidebar to switch.',
        ],
      },
      {
        kind: 'p',
        text: 'Statuses run **to do → in progress → waiting → done**. "Waiting" is worth using honestly. A card with a waiting reason attached (shown with a clock icon) is a meeting agenda that writes itself. Tasks nobody is coming back to are archived, not left cluttering the board.',
      },
      {
        kind: 'p',
        text: 'Opening a task shows its full record: subtasks, discussion, attachments, and the activity history. Break the work into subtasks and drag them by the handle on the left of each row to reorder them. The header carries Archive and a ⋯ menu with **Rename task**, **Open task board**, and **Delete task**; the breadcrumb takes you back to the list, and opening from the list adds previous/next arrows (`J`/`K`) through the same filtered set.',
      },
      { kind: 'h2', id: 'accountability', text: 'Assignment, due dates, and SLAs' },
      {
        kind: 'list',
        items: [
          'A task with no assignee shows a dashed Unassigned pill. One click takes it and assigns it to you. Assigning a task notifies the assignee; due-today and overdue reminders follow automatically. Everyone tunes their own notifications on their [Profile](/profile).',
          "If your workspace sets a task SLA, every open task shows an honest SLA pill (due-in or overdue, in working hours) and the sidebar's Tasks badge is the live breach count. The [Dashboard](/dashboard) shows the rollup. See [The dashboard and SLA health](/help/dashboard).",
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Tasks come from everywhere',
        text: 'Create one directly, turn an inbox thread into one from [Inbox](/inbox), or let an automation open one; "new major donor" can open a personal-call task for the right person automatically. See [Automations](/help/automations).',
      },
    ],
  },
  {
    id: 'files',
    category: 'productivity',
    title: 'Storage & attachments',
    summary: 'Files live attached to the record they belong to; track total usage from Workspace settings.',
    keywords: ['file', 'upload', 'document', 'attachment', 'storage', 'pdf', 'quota'],
    related: ['grid-basics', 'newsletters'],
    blocks: [
      {
        kind: 'p',
        text: 'Files no longer live in their own standalone library. A file is attached directly to the record it belongs to (for example, a PDF flyer attached to a newsletter). This keeps every upload tied to why it was added, instead of sitting in an unsorted pile.',
      },
      { kind: 'h2', id: 'attach', text: 'Attach a file' },
      {
        kind: 'p',
        text: 'Open the record that should carry the file (e.g. a draft or scheduled newsletter) and use its "Attach file" button. Attachments can only be added or removed before the record has sent.',
      },
      { kind: 'h2', id: 'storage', text: 'Check total usage' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Workspace settings → Storage](/workspace/storage)',
            detail: 'Shows how much of your plan quota is used, and which files are the largest.',
          },
          {
            title: 'Delete a large file',
            detail:
              'Removing it from the Storage tab detaches it from whatever it was attached to and frees the space.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Quota affects newsletter sending',
        text: 'If your workspace is at 100% of its storage quota, newsletters still send but skip their attachments. Free up space first if attachments matter for that send.',
      },
    ],
  },
];
````

## File: libs/common/src/lib/schemas/connections.schema.ts
````typescript
import { z } from 'zod';
import { idSchema, notesSchema } from './core.schema';

export const RELATION_TYPES = [
  'referred_by',
  'referred_to',
  'close_friend',
  'family_member',
  'spouse',
  'colleague',
  'org_affiliation',
  'introduced_by',
  'introduced_to',
  'custom',
] as const;

export const RELATION_TYPE_LABELS: Record<(typeof RELATION_TYPES)[number], string> = {
  referred_by: 'Referred By',
  referred_to: 'Referred To',
  close_friend: 'Close Friend',
  family_member: 'Family Member',
  spouse: 'Spouse / Partner',
  colleague: 'Colleague',
  org_affiliation: 'Org. Affiliation',
  introduced_by: 'Introduced By',
  introduced_to: 'Introduced To',
  custom: 'Custom',
};

export const relationTypeSchema = z.enum(RELATION_TYPES);

export const AddConnectionObj = z.object({
  to_person_id: idSchema,
  relation_type: relationTypeSchema,
  custom_label: z.string().trim().min(1).max(100).nullable().optional(),
  is_mutual: z.boolean().default(false).optional(),
  notes: notesSchema,
});

export type AddConnectionType = z.infer<typeof AddConnectionObj>;
````

## File: libs/common/src/lib/schemas/deliveries.schema.ts
````typescript
import { z } from 'zod';

import { idSchema, notesSchema } from './core.schema';

// Deliveries (spec §14). Enums mirror the binding spec (docs/spec/Deliveries Spec.dc.html §2) —
// the spec's strings win, including the American spelling "canceled" for route status.
export const DELIVERY_REQUEST_STATUSES = ['new', 'approved', 'declined', 'delivered'] as const;
export const DELIVERY_ROUTE_STATUSES = ['draft', 'assigned', 'in_progress', 'completed', 'canceled'] as const;
export const DELIVERY_STOP_STATUSES = ['pending', 'delivered', 'skipped'] as const;
export const DELIVERY_SOURCES = ['web_form', 'manual'] as const;

// The four failure reasons a volunteer can pick (spec §4.4). "Skip for now" (defer) is NOT a
// reason — it keeps the stop pending and moves it to the end of the route.
export const DELIVERY_SKIP_REASONS = ['No safe spot', 'Wrong address', 'Resident declined', 'Other'] as const;

export type DeliveryRequestStatus = (typeof DELIVERY_REQUEST_STATUSES)[number];

/** Display labels for a request's standing on person/household pages ('new' reads as "Requested"). */
export const DELIVERY_REQUEST_STATUS_LABELS: Record<DeliveryRequestStatus, string> = {
  new: 'Requested',
  approved: 'Approved',
  declined: 'Declined',
  delivered: 'Delivered',
};
export type DeliveryRouteStatus = (typeof DELIVERY_ROUTE_STATUSES)[number];
export type DeliveryStopStatus = (typeof DELIVERY_STOP_STATUSES)[number];
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];
export type DeliverySkipReason = (typeof DELIVERY_SKIP_REASONS)[number];

// ---- Requests --------------------------------------------------------------
export const AddDeliveryRequestObj = z.object({
  /** Campaigns §15 — the context this yard-sign request belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  household_id: idSchema,
  person_id: idSchema.or(z.literal('')).nullable().optional(),
  notes: notesSchema,
});

export const UpdateDeliveryRequestObj = z.object({
  notes: notesSchema,
});

// Bulk approve/decline from the selection bar (spec §4.1), plus the manual standing flips from the
// household/person "Yard sign" control — 'delivered' covers signs installed without the app.
export const SetDeliveryRequestStatusObj = z.object({
  ids: z.array(idSchema).min(1, 'Select at least one request'),
  status: z.enum(DELIVERY_REQUEST_STATUSES),
});

// The yard-sign standing lookup for one household in one campaign context.
export const GetSignStatusObj = z.object({
  household_id: idSchema,
  campaign_id: idSchema,
});

// ---- Planning --------------------------------------------------------------
// Advanced params default to the spec's inline summary (60 min/driver · 5 min/stop · 30 km/h · no
// return trip). Preview is pure — it writes nothing.
export const PlanDeliveriesObj = z.object({
  start_address: z.string().trim().min(1, 'Start address is required').max(500, 'Address is too long'),
  drivers: z.number().int().min(1).max(50).nullable().optional(),
  service_minutes: z.number().min(0).max(60).nullable().optional(),
  avg_speed_kmh: z.number().min(1).max(120).nullable().optional(),
  include_return_leg: z.boolean().nullable().optional(),
});

export const CommitDeliveriesObj = PlanDeliveriesObj.extend({
  routes: z
    .array(
      z.object({
        request_ids: z.array(idSchema).min(1, 'A route needs at least one stop'),
      }),
    )
    .min(1, 'Nothing to commit'),
});

// ---- Routes ----------------------------------------------------------------
export const UpdateDeliveryRouteObj = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150, 'Name is too long').optional(),
  scheduled_for: z.string().datetime().nullable().optional(),
});

export const AssignVolunteerObj = z.object({
  route_id: idSchema,
  person_id: idSchema.nullable(),
});

export const SetDeliveryRouteStatusObj = z.object({
  route_id: idSchema,
  status: z.enum(['in_progress', 'completed', 'canceled']),
});

export const ReorderStopObj = z.object({
  route_id: idSchema,
  stop_id: idSchema,
  direction: z.enum(['up', 'down']),
});

// Drag-to-reorder: the full new order of a route's PENDING stops. Delivered/skipped stops are not
// movable and keep their seq; the backend reassigns only the pending slots to this order.
export const ReorderStopsObj = z.object({
  route_id: idSchema,
  ordered_stop_ids: z.array(idSchema).min(1, 'Provide the new stop order'),
});

// Staff act on a stop from the route detail page. Same transitions as the public path.
export const StopActionObj = z.object({
  route_id: idSchema,
  stop_id: idSchema,
  action: z.enum(['deliver', 'skip', 'remove']),
  reason: z.enum(DELIVERY_SKIP_REASONS).nullable().optional(),
});

export const RouteIdObj = z.object({ route_id: idSchema });

export const MintShareLinkObj = z.object({
  route_id: idSchema,
  regenerate: z.boolean().optional(),
});

// ---- Public volunteer path (token is the only credential) ------------------
// defer = "Skip for now": moves the stop to the end and renumbers (stays pending, not a failure).
export const PublicStopActionObj = z.object({
  action: z.enum(['deliver', 'skip', 'defer', 'undo']),
  reason: z.enum(DELIVERY_SKIP_REASONS).nullable().optional(),
});

export type AddDeliveryRequestType = z.infer<typeof AddDeliveryRequestObj>;
export type UpdateDeliveryRequestType = z.infer<typeof UpdateDeliveryRequestObj>;
export type SetDeliveryRequestStatusType = z.infer<typeof SetDeliveryRequestStatusObj>;
export type GetSignStatusType = z.infer<typeof GetSignStatusObj>;
export type PlanDeliveriesType = z.infer<typeof PlanDeliveriesObj>;
export type CommitDeliveriesType = z.infer<typeof CommitDeliveriesObj>;
export type UpdateDeliveryRouteType = z.infer<typeof UpdateDeliveryRouteObj>;
export type AssignVolunteerType = z.infer<typeof AssignVolunteerObj>;
export type SetDeliveryRouteStatusType = z.infer<typeof SetDeliveryRouteStatusObj>;
export type ReorderStopType = z.infer<typeof ReorderStopObj>;
export type ReorderStopsType = z.infer<typeof ReorderStopsObj>;
export type StopActionType = z.infer<typeof StopActionObj>;
export type MintShareLinkType = z.infer<typeof MintShareLinkObj>;
export type PublicStopActionType = z.infer<typeof PublicStopActionObj>;
````

## File: libs/common/src/lib/schemas/events.schema.ts
````typescript
import { z } from 'zod';
import { nameSchema, idSchema, descriptionSchema, notesSchema } from './core.schema';

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(?=.*[a-z])[a-z0-9-]+$/,
    'Slug must contain at least one letter and can only contain lowercase letters, numbers, and hyphens',
  );

export const AddEventObj = z.object({
  /** Campaigns §15 — the context this event belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: nameSchema('Event name', 200),
  description: descriptionSchema(2000),
  location_address: z.string().trim().max(500, 'Location address is too long').nullable().optional(),
  start_time: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.coerce.date({ error: 'Start date & time is required' }),
  ),
  end_time: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.coerce.date({ error: 'End date & time is required' }),
  ),
  capacity: z.number().int().positive().nullable().optional().or(z.literal('')),
  contact_email: z.string().trim().max(255).nullable().optional(),
  contact_phone: z.string().trim().max(50).nullable().optional(),
  slug: slugSchema,
  is_published: z.boolean().default(false).optional(),
  send_reminder: z.boolean().default(true).optional(),
  send_registration_confirmation: z.boolean().default(true).optional(),
  fields: z.array(z.string()).optional(),
});

export const EventObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  location_address: z.string().nullable().optional(),
  start_time: z.coerce.date(),
  end_time: z.coerce.date(),
  capacity: z.number().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  slug: z.string(),
  is_published: z.boolean(),
  send_reminder: z.boolean(),
  send_registration_confirmation: z.boolean(),
});

export const UpdateEventObj = z.object({
  name: nameSchema('Event name', 200).optional(),
  description: descriptionSchema(2000),
  location_address: z.string().trim().max(500, 'Location address is too long').nullable().optional(),
  start_time: z
    .preprocess(
      (val) => (val === '' || val === null ? undefined : val),
      z.coerce.date({ error: 'Start date & time is required' }),
    )
    .optional(),
  end_time: z
    .preprocess(
      (val) => (val === '' || val === null ? undefined : val),
      z.coerce.date({ error: 'End date & time is required' }),
    )
    .optional(),
  capacity: z.number().int().positive().nullable().optional().or(z.literal('')),
  contact_email: z.string().trim().max(255).nullable().optional(),
  contact_phone: z.string().trim().max(50).nullable().optional(),
  slug: slugSchema.optional(),
  is_published: z.boolean().optional(),
  send_reminder: z.boolean().optional(),
  send_registration_confirmation: z.boolean().optional(),
  fields: z.array(z.string()).optional(),
});

export const AddTicketTypeObj = z.object({
  event_id: idSchema,
  name: nameSchema('Ticket type name', 100),
  description: descriptionSchema(500),
  price_cents: z.number().int().min(0, 'Price cannot be negative').default(0),
  capacity: z.number().int().positive().nullable().optional(),
  sort_order: z.number().int().min(0).default(0).optional(),
});

export const TicketTypeObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  event_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  price_cents: z.number(),
  capacity: z.number().nullable().optional(),
  sort_order: z.number(),
});

export const UpdateTicketTypeObj = z.object({
  name: nameSchema('Ticket type name', 100).optional(),
  description: descriptionSchema(500),
  price_cents: z.number().int().min(0, 'Price cannot be negative').optional(),
  capacity: z.number().int().positive().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

// Drag-to-reorder ticket types: the full new order of an event's ticket type ids. The backend
// writes each id's sort_order to its index, so the order shown to attendees matches the form.
export const ReorderTicketTypesObj = z.object({
  event_id: idSchema,
  ordered_ids: z.array(idSchema).min(1, 'Provide the new ticket order'),
});

const registrationStatusEnum = z.enum(['registered', 'attended', 'no_show', 'cancelled']);

export const AddRegistrationObj = z.object({
  event_id: idSchema,
  person_id: idSchema,
  ticket_type_id: idSchema.nullable().optional(),
  status: registrationStatusEnum.default('registered').optional(),
  notes: notesSchema,
});

export const RegistrationObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  event_id: z.string(),
  person_id: z.string(),
  ticket_type_id: z.string().nullable().optional(),
  status: registrationStatusEnum,
  checked_in_at: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const UpdateRegistrationObj = z.object({
  ticket_type_id: idSchema.nullable().optional(),
  status: registrationStatusEnum.optional(),
  checked_in_at: z.coerce.date().nullable().optional(),
  notes: notesSchema,
});
````

## File: libs/common/src/lib/schemas/marketing.schema.ts
````typescript
import { z } from 'zod';

import { idSchema } from './core.schema';

export const marketingEmailTopLinkObj = z.object({
  url: z.string(),
  clicks: z.number().int().nonnegative(),
});

export const MarketingEmailObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  status: z.enum(['draft', 'scheduled', 'paused', 'sent', 'archived']).default('sent'),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  audience_description: z.string().nullable().optional(),
  target_lists: z.string().nullable().optional(),
  segments: z.string().nullable().optional(),
  total_recipients: z.number().int().nonnegative(),
  delivered_count: z.number().int().nonnegative(),
  bounce_count: z.number().int().nonnegative(),
  open_rate: z.number(),
  click_rate: z.number(),
  unique_opens: z.number().int().nonnegative(),
  unique_clicks: z.number().int().nonnegative(),
  unsubscribe_count: z.number().int().nonnegative(),
  spam_complaint_count: z.number().int().nonnegative(),
  reply_count: z.number().int().nonnegative(),
  send_date: z.coerce.date().nullable(),
  last_engagement_at: z.coerce.date().nullable().optional(),
  summary: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
  top_links: z.array(marketingEmailTopLinkObj).nullable().optional(),
  /** The sent newsletter this row is a non-opener follow-up of; null for originals. */
  resend_of_id: z.string().nullable().optional(),
  updated_at: z.coerce.date(),
  created_at: z.coerce.date(),
  createdby_id: z.string(),
  updatedby_id: z.string(),
});

export const AddMarketingEmailObj = z.object({
  /** Campaigns §15 — the context this newsletter sends within; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: z.string(),
  status: z.enum(['draft', 'scheduled', 'paused', 'sent', 'archived']).default('draft').optional(),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  audience_description: z.string().nullable().optional(),
  target_lists: z.string().nullable().optional(),
  segments: z.string().nullable().optional(),
  total_recipients: z.number().int().nonnegative().default(0).optional(),
  delivered_count: z.number().int().nonnegative().default(0).optional(),
  bounce_count: z.number().int().nonnegative().default(0).optional(),
  open_rate: z.number().min(0).max(100).default(0).optional(),
  click_rate: z.number().min(0).max(100).default(0).optional(),
  unique_opens: z.number().int().nonnegative().default(0).optional(),
  unique_clicks: z.number().int().nonnegative().default(0).optional(),
  unsubscribe_count: z.number().int().nonnegative().default(0).optional(),
  spam_complaint_count: z.number().int().nonnegative().default(0).optional(),
  reply_count: z.number().int().nonnegative().default(0).optional(),
  send_date: z.coerce.date().nullable().optional(),
  last_engagement_at: z.coerce.date().nullable().optional(),
  summary: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
  top_links: z.array(marketingEmailTopLinkObj).nullable().optional(),
});

export const UpdateMarketingEmailObj = AddMarketingEmailObj.partial();

/* ------------------------------------------------------------------ */
/* Newsletter report — the shape of newsletters.getReport             */
/* ------------------------------------------------------------------ */

/** A CRM person matched by email — enough to render a link to their record. */
export const NewsletterReportPersonObj = z.object({
  id: z.string(),
  /** Opaque public id — the canonical /people/:id route key. */
  public_id: z.string().nullable(),
  name: z.string(),
});

export const NewsletterReportBounceObj = z.object({
  email: z.string(),
  /** hard = permanent, soft = provider deferral ('blocked'), dropped = never attempted. */
  kind: z.enum(['hard', 'soft', 'dropped']),
  reason: z.string().nullable(),
  occurred_at: z.coerce.date().nullable(),
  person: NewsletterReportPersonObj.nullable(),
});

export const NewsletterReportEngagedObj = z.object({
  email: z.string(),
  opens: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  /** Distinct links clicked — 0 when unknown (raw events already pruned). */
  links: z.number().int().nonnegative(),
  person: NewsletterReportPersonObj.nullable(),
});

export const NewsletterReportLinkObj = z.object({
  url: z.string(),
  clicks: z.number().int().nonnegative(),
  /** Unique clickers of this link — null when unknown (raw events already pruned). */
  people: z.number().int().nonnegative().nullable(),
});

export const NewsletterReportPreviousSendObj = z.object({
  id: z.string(),
  name: z.string(),
  send_date: z.coerce.date().nullable(),
  open_rate: z.number(),
  click_rate: z.number(),
  unsubscribe_rate: z.number(),
  bounce_rate: z.number(),
});

export const NewsletterReportObj = z.object({
  /** Hourly opens/clicks buckets from raw events (empty once events are pruned). */
  timeline: z.array(
    z.object({
      time: z.string(),
      opens: z.number().int().nonnegative(),
      clicks: z.number().int().nonnegative(),
    }),
  ),
  /** Share of all opens that landed within 24h of send — null when not computable. */
  opens_in_24h_pct: z.number().nullable(),
  bounces: z.object({
    total: z.number().int().nonnegative(),
    hard: z.number().int().nonnegative(),
    soft: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    rows: z.array(NewsletterReportBounceObj),
  }),
  top_links: z.array(NewsletterReportLinkObj),
  tracked_links: z.number().int().nonnegative(),
  total_clicks: z.number().int().nonnegative(),
  unique_clickers: z.number().int().nonnegative(),
  most_engaged: z.array(NewsletterReportEngagedObj),
  unsubscribes: z.object({
    total: z.number().int().nonnegative(),
    /** Reason buckets; null reason = "No reason given" (no unsubscribe survey exists yet). */
    reasons: z.array(z.object({ reason: z.string().nullable(), count: z.number().int().nonnegative() })),
  }),
  spam_reports: z.object({
    total: z.number().int().nonnegative(),
    rows: z.array(z.object({ email: z.string().nullable(), occurred_at: z.coerce.date().nullable() })),
  }),
  audience: z.object({
    lists: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mode: z.enum(['include', 'exclude']),
        members: z.number().int().nonnegative(),
      }),
    ),
    /** Members in more than one included list, counted once. */
    overlap_removed: z.number().int().nonnegative(),
    /** Included members whose address is on the suppression list. */
    suppressed_skipped: z.number().int().nonnegative(),
  }),
  /** Up to the last 5 sent newsletters in this campaign, oldest → newest, ending with this send. */
  previous_sends: z.array(NewsletterReportPreviousSendObj),
  from: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
});

export const CreateClickersListResultObj = z.object({
  id: z.string(),
  name: z.string(),
  members: z.number().int().nonnegative(),
});
````

## File: libs/common/src/lib/schemas/newsletter-templates.schema.ts
````typescript
import { z } from 'zod';

import { nameSchema } from './core.schema';

/** Generous ceiling for a compiled email document (the presets are ~15 KB). */
const MAX_TEMPLATE_HTML_LENGTH = 500_000;
const MAX_TEMPLATE_TEXT_LENGTH = 200_000;

/**
 * Create payload for a user-saved newsletter template.
 *
 * html_content is deliberately NOT trimmed or transformed: the wizard stores the
 * compiled document verbatim so the PPLCRM_VISUAL_BLOCKS_DATA comment survives
 * the round-trip back into the visual editor. Emptiness is checked on the
 * trimmed view only.
 */
export const AddNewsletterTemplateObj = z.object({
  name: nameSchema('Name', 120),
  html_content: z
    .string()
    .max(MAX_TEMPLATE_HTML_LENGTH)
    .refine((value) => value.trim().length > 0, 'Template content is required'),
  plain_text_content: z.string().max(MAX_TEMPLATE_TEXT_LENGTH).optional(),
});

/** Rename-only edit payload; the content of a saved template is immutable. */
export const UpdateNewsletterTemplateObj = z.object({
  name: nameSchema('Name', 120),
});

/** Read shape returned by newsletters.templates.getAll. */
export const NewsletterTemplateObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  html_content: z.string(),
  plain_text_content: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  createdby_id: z.string(),
  updatedby_id: z.string(),
});

export type AddNewsletterTemplateType = z.infer<typeof AddNewsletterTemplateObj>;
export type UpdateNewsletterTemplateType = z.infer<typeof UpdateNewsletterTemplateObj>;
export type NewsletterTemplateType = z.infer<typeof NewsletterTemplateObj>;
````

## File: libs/common/src/lib/auth.ts
````typescript
import { z } from 'zod';

export interface IAuthKeyPayload {
  name?: string;

  session_id: string;

  tenant_id: string;

  user_id: string;

  role?: string | null;

  source?: string;
}

export interface IAuthUser {
  email: string;

  first_name: string;

  last_name?: string;

  id: string;

  role?: string | null;

  avatar_url?: string | null;

  email_verified: boolean;

  passkey_setup_dismissed_at?: Date | null;

  tenant_deletion_scheduled_at?: Date | null;

  tenant_paused_at?: Date | null;

  /** Set while the tenant still has the seeded demo data (drives the demo-mode banner). */
  tenant_demo_mode_at?: Date | null;

  /** The tenant's public subdomain label — used to build public form URLs (`<slug>.<baseDomain>`). */
  tenant_slug?: string | null;
}

export interface IUserStatsSnapshot {
  emails_assigned: {
    total: number;
    open: number;
    closed: number;
  };
  contacts_added: {
    total: number;
    last_created_at: Date | null;
  };
  files_imported: {
    count: number;
    total_rows: number;
    last_activity_at: Date | null;
  };
  files_exported: {
    count: number;
    total_rows: number;
    last_activity_at: Date | null;
  };
}

export interface IAuthUserRecord extends IAuthUser {
  last_name: string;
  role: string | null;
  /** Campaigns §15 — admin-assigned campaign; null = office. Not enforced for admins/owners. */
  campaign_id: string | null;
  verified: boolean;
  two_factor_enabled: boolean;
  deletion_scheduled_at: Date | null;
  /** Admin deactivation: set = can't sign in until an admin/owner reactivates. */
  deactivated_at?: Date | null;
  /** Most recent session activity; null until the user has signed in at least once. */
  last_active_at?: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  previous_email?: string | null;
  previous_role?: string | null;
  avatar_url?: string | null;
  notification_preferences?: {
    mention_in_comment: boolean;
    mention_in_comment_in_app: boolean;
    task_assigned: boolean;
    task_assigned_in_app: boolean;
    task_due: boolean;
    task_due_in_app: boolean;
    person_assigned: boolean;
    person_assigned_in_app: boolean;
    export_ready: boolean;
    export_ready_in_app: boolean;
    import_summary: boolean;
    import_summary_in_app: boolean;
  };
}

export interface IAuthUserDetail extends IAuthUserRecord {
  stats: IUserStatsSnapshot;
}

export interface IToken {
  auth_token: string | null;
  refresh_token: string | null;
}

/**
 * The one generic message shown for any failed sign-in attempt, regardless of
 * whether the email or the password was wrong — never reveal which, so that
 * sign-in cannot be used to probe which emails have accounts. Shared by the
 * backend error formatter and the frontend so the copy never drifts.
 */
export const GENERIC_SIGNIN_ERROR = 'Please check your email and password and try again.';

/**
 * Product names for the stored role values — the working role 'user' is shown as
 * "Editor" everywhere (Users list, user page, Profile). Shared so the label never drifts.
 */
export const AUTH_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  user: 'Editor',
  viewer: 'Viewer',
};

export function authRoleLabel(role: string | null | undefined): string {
  return role ? (AUTH_ROLE_LABELS[role] ?? role) : '—';
}

export type signInInputType = z.infer<typeof signInInputObj>;

export type signUpInputType = z.infer<typeof signUpInputObj>;

export const signInInputObj = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  rememberMe: z.boolean().optional(),
});

export const signUpInputObj = z.object({
  organization: z.string(),
  email: z.string().max(100),
  password: z.string().min(8).max(72),
  first_name: z.string().max(100),
});
````

## File: libs/common/src/lib/models.ts
````typescript
import type { z } from 'zod';

import type {
  AddCampaignObj,
  UpdateCampaignObj,
  UpsertCampaignPersonFactObj,
  SetCampaignSubscriptionObj,
  CarryOverCampaignObj,
  AddTagObj,
  AddListObj,
  AddMarketingEmailObj,
  AddTaskObj,
  AddTeamObj,
  AddBugReportObj,
  AddTurfObj,
  UpdateTurfObj,
  CutTurfsObj,
  AssignTurfObj,
  FieldReportRangeObj,
  LogKnockObj,
  EmailCommentObj,
  EmailFolderObj,
  EmailObj,
  MarketingEmailObj,
  marketingEmailTopLinkObj,
  NewsletterReportObj,
  NewsletterReportBounceObj,
  NewsletterReportEngagedObj,
  NewsletterReportLinkObj,
  NewsletterReportPreviousSendObj,
  CreateClickersListResultObj,
  EmailDraftObj,
  PersonsObj,
  SettingsEntryObj,
  SettingsObj,
  UpsertSettingsInputObj,
  UpdateHouseholdsObj,
  UpdatePersonsObj,
  UpdateTagObj,
  ListsObj,
  UpdateMarketingEmailObj,
  UpdateListObj,
  UpdateTaskObj,
  UpdateTeamObj,
  TasksObj,
  getAllOptions,
  exportCsvInput,
  exportCsvResponse,
  queueExportInput,
  logInstantExportInput,
  dataExportRecord,
  sortModelItem,
  InviteAuthUserObj,
  ProfilePreferencesObj,
  UpdateAuthUserObj,
  Verify2FAObj,
  ImportListItemObj,
  AddVolunteerEventObj,
  VolunteerEventsObj,
  UpdateVolunteerEventObj,
  AddVolunteerShiftObj,
  VolunteerShiftsObj,
  UpdateVolunteerShiftObj,
  AddWebFormObj,
  UpdateWebFormObj,
  WebFormsObj,
  CreateFormObj,
  UpdateFormObj,
  FormSubmissionObj,
  QueryBuilderRuleNode,
  QueryBuilderGroupNode,
  QueryBuilderNode,
  WorkflowObj,
  AddWorkflowObj,
  UpdateWorkflowObj,
  WorkflowStepObj,
  AddWorkflowStepObj,
  UpdateWorkflowStepObj,
  WorkflowEnrollmentObj,
  AddEventObj,
  EventObj,
  UpdateEventObj,
  AddTicketTypeObj,
  TicketTypeObj,
  UpdateTicketTypeObj,
  ReorderTicketTypesObj,
  AddRegistrationObj,
  RegistrationObj,
  UpdateRegistrationObj,
  AddConnectionObj,
} from './schema';

export interface INow {
  now: string;
}

export type AddTagType = z.infer<typeof AddTagObj>;

export type EmailCommentType = z.infer<typeof EmailCommentObj>;

export type EmailFolderType = z.infer<typeof EmailFolderObj>;

export type EmailType = z.infer<typeof EmailObj>;

export type MarketingEmailType = z.infer<typeof MarketingEmailObj>;

export type AddMarketingEmailType = z.infer<typeof AddMarketingEmailObj>;

export type UpdateMarketingEmailType = z.infer<typeof UpdateMarketingEmailObj>;

export type MarketingEmailTopLinkType = z.infer<typeof marketingEmailTopLinkObj>;

export type NewsletterReportType = z.infer<typeof NewsletterReportObj>;

export type NewsletterReportBounceType = z.infer<typeof NewsletterReportBounceObj>;

export type NewsletterReportEngagedType = z.infer<typeof NewsletterReportEngagedObj>;

export type NewsletterReportLinkType = z.infer<typeof NewsletterReportLinkObj>;

export type NewsletterReportPreviousSendType = z.infer<typeof NewsletterReportPreviousSendObj>;

export type CreateClickersListResultType = z.infer<typeof CreateClickersListResultObj>;

export type EmailDraftType = z.infer<typeof EmailDraftObj>;

export type ImportListItem = z.infer<typeof ImportListItemObj>;

export type PERSONINHOUSEHOLDTYPE = {
  first_name: string;
  full_name: string;
  id: string;
  last_name: string;
  middle_names: string;
};

export type PersonsType = z.infer<typeof PersonsObj>;

export type SettingsType = z.infer<typeof SettingsObj>;

export type SettingsEntryType = z.infer<typeof SettingsEntryObj>;

export type UpsertSettingsInputType = z.infer<typeof UpsertSettingsInputObj>;

export type SortModelType = z.infer<typeof sortModelItem>;

export type UpdateHouseholdsType = z.infer<typeof UpdateHouseholdsObj>;

export type UpdatePersonsType = z.infer<typeof UpdatePersonsObj>;

export type UpdateTagType = z.infer<typeof UpdateTagObj>;

export type getAllOptionsType = z.infer<typeof getAllOptions>;

export type AddListType = z.infer<typeof AddListObj>;

export type AddCampaignType = z.infer<typeof AddCampaignObj>;

export type UpdateCampaignType = z.infer<typeof UpdateCampaignObj>;

export type UpsertCampaignPersonFactType = z.infer<typeof UpsertCampaignPersonFactObj>;

export type SetCampaignSubscriptionType = z.infer<typeof SetCampaignSubscriptionObj>;

export type CarryOverCampaignType = z.infer<typeof CarryOverCampaignObj>;

export type AddTeamType = z.infer<typeof AddTeamObj>;

export type AddBugReportType = z.infer<typeof AddBugReportObj>;

export type InviteAuthUserType = z.infer<typeof InviteAuthUserObj>;

export type Verify2FAType = z.infer<typeof Verify2FAObj>;

export type ListsType = z.infer<typeof ListsObj>;

export type UpdateListType = z.infer<typeof UpdateListObj>;

export type UpdateTeamType = z.infer<typeof UpdateTeamObj>;

export type AddTurfType = z.infer<typeof AddTurfObj>;

export type UpdateTurfType = z.infer<typeof UpdateTurfObj>;

export type CutTurfsType = z.infer<typeof CutTurfsObj>;

export type AssignTurfType = z.infer<typeof AssignTurfObj>;

export type FieldReportRangeType = z.infer<typeof FieldReportRangeObj>;

export type LogKnockType = z.infer<typeof LogKnockObj>;

export type UpdateAuthUserType = z.infer<typeof UpdateAuthUserObj>;

export type ProfilePreferencesType = z.infer<typeof ProfilePreferencesObj>;

export type AddTaskType = z.infer<typeof AddTaskObj>;
export type TasksType = z.infer<typeof TasksObj>;
export type UpdateTaskType = z.infer<typeof UpdateTaskObj>;
export type ExportCsvInputType = z.infer<typeof exportCsvInput>;
export type ExportCsvResponseType = z.infer<typeof exportCsvResponse>;
export type QueueExportInputType = z.infer<typeof queueExportInput>;
export type LogInstantExportInputType = z.infer<typeof logInstantExportInput>;
export type DataExportRecordType = z.infer<typeof dataExportRecord>;

export type AddVolunteerEventType = z.infer<typeof AddVolunteerEventObj>;
export type VolunteerEventsType = z.infer<typeof VolunteerEventsObj>;
export type UpdateVolunteerEventType = z.infer<typeof UpdateVolunteerEventObj>;

export type AddVolunteerShiftType = z.infer<typeof AddVolunteerShiftObj>;
export type VolunteerShiftsType = z.infer<typeof VolunteerShiftsObj>;
export type UpdateVolunteerShiftType = z.infer<typeof UpdateVolunteerShiftObj>;

export type AddWebFormType = z.infer<typeof AddWebFormObj>;
export type UpdateWebFormType = z.infer<typeof UpdateWebFormObj>;
export type WebFormsType = z.infer<typeof WebFormsObj>;
export type CreateFormType = z.infer<typeof CreateFormObj>;
export type UpdateFormType = z.infer<typeof UpdateFormObj>;
export type FormSubmissionType = z.infer<typeof FormSubmissionObj>;

export type WorkflowsType = z.infer<typeof WorkflowObj>;
export type AddWorkflowType = z.infer<typeof AddWorkflowObj>;
export type UpdateWorkflowType = z.infer<typeof UpdateWorkflowObj>;
export type WorkflowStepsType = z.infer<typeof WorkflowStepObj>;
export type AddWorkflowStepType = z.infer<typeof AddWorkflowStepObj>;
export type UpdateWorkflowStepType = z.infer<typeof UpdateWorkflowStepObj>;
export type WorkflowEnrollmentsType = z.infer<typeof WorkflowEnrollmentObj>;

export type AddEventType = z.infer<typeof AddEventObj>;
export type EventType = z.infer<typeof EventObj>;
export type UpdateEventType = z.infer<typeof UpdateEventObj>;

export type AddTicketTypeType = z.infer<typeof AddTicketTypeObj>;
export type TicketTypeType = z.infer<typeof TicketTypeObj>;
export type UpdateTicketTypeType = z.infer<typeof UpdateTicketTypeObj>;
export type ReorderTicketTypesType = z.infer<typeof ReorderTicketTypesObj>;

export type AddRegistrationType = z.infer<typeof AddRegistrationObj>;
export type RegistrationType = z.infer<typeof RegistrationObj>;
export type UpdateRegistrationType = z.infer<typeof UpdateRegistrationObj>;

export type AddConnectionType = z.infer<typeof AddConnectionObj>;

export type { QueryBuilderRuleNode, QueryBuilderGroupNode, QueryBuilderNode };
````

## File: libs/common/src/lib/preflight-lint.ts
````typescript
import type { AiPreflightVerdict, PreflightFinding, PreflightSeverity } from './schemas/content-check.schema';

/**
 * Deterministic newsletter lint + scoring. Pure and isomorphic (no Node/browser-only APIs) so the
 * composer runs it live while the backend runs the identical checks authoritatively at send time.
 * Every check yields a PreflightFinding whose deduction is subtracted from a 100-point score; the
 * builders at the bottom convert the SpamAssassin score and the AI verdict into the same finding
 * shape so the UI renders one list and the score stays a single explainable mechanism.
 */

export interface PreflightInput {
  subject: string;
  html: string;
  plainText?: string;
}

// Point deductions per finding. Sized so any single "block"-severity pattern (phishing-shaped
// links, base64 payloads) pulls the score below PREFLIGHT_BLOCK on its own or nearly so, while
// style nits stay advisory. Tuning one of these is deliberately a one-line change.
const DEDUCT = {
  subjectEmpty: 30,
  subjectTooLong: 5,
  subjectCaps: 10,
  subjectExclamations: 8,
  subjectMoneySymbols: 8,
  subjectFakeReply: 15,
  htmlOversize: 15,
  imageOnlyBody: 15,
  imagesMissingAlt: 3,
  insecureUrls: 5,
  base64Image: 25,
  tooManyLinks: 8,
  urlShortener: 12,
  anchorDomainMismatch: 30,
  rawIpLink: 25,
  suspiciousProtocol: 25,
  aiDeceptionFlags: 10,
  aiDisallowedContent: 90,
} as const;

const SUBJECT_MAX_CHARS = 70;
const SUBJECT_CAPS_RATIO = 0.3;
const SUBJECT_MIN_LETTERS_FOR_CAPS = 8;
// Gmail clips messages around 102KB of HTML; warn with margin before that.
const HTML_SIZE_WARN_BYTES = 100_000;
const IMAGE_ONLY_MIN_TEXT_CHARS = 200;
const MAX_LINKS = 25;
// SpamAssassin's conventional spam threshold is 5; we start surfacing at 3.
const SPAMASSASSIN_INFO_AT = 3;
const SPAMASSASSIN_WARN_AT = 5;
const SPAMASSASSIN_DEDUCTION_PER_POINT = 2;
const SPAMASSASSIN_MAX_DEDUCTION = 30;
// The AI risk score contributes at most this many points, scaled by its confidence.
const AI_RISK_MAX_DEDUCTION = 40;
const AI_RISK_WARN_AT = 60;
// Below this confidence a disallowed-content verdict is advisory, not score-capping.
const AI_DISALLOWED_MIN_CONFIDENCE = 0.6;

// Widely-abused URL shorteners. Curated and small on purpose — extend it, don't import a huge list.
const URL_SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  't.co',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'rb.gy',
  'tiny.cc',
  'lnkd.in',
  's.id',
  'snip.ly',
]);

/**
 * Canonical string the content hash is computed over (raw stored fields, never rendered output),
 * so the composer's pre-save check and the send-time row-loaded check hash identically. The server
 * hashes this with sha256; hashing itself is not isomorphic so it stays out of this module.
 */
export function preflightHashInput(subject: string, html: string, plainText: string | null | undefined): string {
  return `${subject}\u0000${html}\u0000${plainText ?? ''}`;
}

function finding(
  code: string,
  severity: PreflightSeverity,
  deduction: number,
  message: string,
  hint: string,
): PreflightFinding {
  return { code, severity, message, hint, deduction };
}

/** Strips tags/styles and decodes the common entities — just enough text to measure, not render. */
function visibleTextOf(html: string): string {
  return html
    .replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** True when the two hosts are the same registrable site (one is the other or a subdomain). */
function sameSite(a: string, b: string): boolean {
  const ha = a.toLowerCase().replace(/^www\./, '');
  const hb = b.toLowerCase().replace(/^www\./, '');
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

interface AnchorRef {
  href: string;
  text: string;
}

function extractAnchors(html: string): AnchorRef[] {
  const anchors: AnchorRef[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    anchors.push({ href: (m[2] ?? '').trim(), text: (m[3] ?? '').replace(/<[^>]+>/g, ' ').trim() });
  }
  return anchors;
}

interface ImgRef {
  src: string;
  hasAlt: boolean;
}

function extractImages(html: string): ImgRef[] {
  const imgs: ImgRef[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] ?? '';
    const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] ?? '';
    imgs.push({ src: src.trim(), hasAlt: alt.trim().length > 0 });
  }
  return imgs;
}

function lintSubject(subject: string, out: PreflightFinding[]): void {
  const trimmed = subject.trim();
  if (!trimmed) {
    out.push(
      finding(
        'subject-empty',
        'block',
        DEDUCT.subjectEmpty,
        'The subject line is empty.',
        'Write a short, specific subject — it is the single biggest factor in whether people open the email.',
      ),
    );
    return;
  }
  if (trimmed.length > SUBJECT_MAX_CHARS) {
    out.push(
      finding(
        'subject-too-long',
        'info',
        DEDUCT.subjectTooLong,
        `The subject is ${trimmed.length} characters — inboxes truncate around ${SUBJECT_MAX_CHARS}.`,
        'Front-load the message so the part people see carries the meaning.',
      ),
    );
  }
  const letters = trimmed.replace(/[^a-z]/gi, '');
  const upper = trimmed.replace(/[^A-Z]/g, '');
  if (letters.length >= SUBJECT_MIN_LETTERS_FOR_CAPS && upper.length / letters.length > SUBJECT_CAPS_RATIO) {
    out.push(
      finding(
        'subject-caps',
        'warn',
        DEDUCT.subjectCaps,
        'The subject shouts — a large share of it is in capitals.',
        'Use sentence case. ALL-CAPS subjects correlate strongly with spam complaints.',
      ),
    );
  }
  if (/!{2,}/.test(trimmed) || (trimmed.match(/!/g) ?? []).length > 2) {
    out.push(
      finding(
        'subject-exclamations',
        'warn',
        DEDUCT.subjectExclamations,
        'The subject leans on exclamation marks.',
        'One is plenty — stacked "!!" reads as spam to filters and to people.',
      ),
    );
  }
  if (/[$€£]{2,}/.test(trimmed) || (trimmed.match(/[$€£]/g) ?? []).length >= 3) {
    out.push(
      finding(
        'subject-money-symbols',
        'warn',
        DEDUCT.subjectMoneySymbols,
        'The subject repeats currency symbols.',
        'Spell amounts out ("Help us raise $5,000") instead of stacking symbols.',
      ),
    );
  }
  if (/^(re|fwd?)\s*:/i.test(trimmed)) {
    out.push(
      finding(
        'subject-fake-reply',
        'warn',
        DEDUCT.subjectFakeReply,
        'The subject starts with "Re:" or "Fwd:" on a broadcast.',
        'Faking a reply thread is deceptive (and a CAN-SPAM problem) — drop the prefix.',
      ),
    );
  }
}

function lintBody(html: string, out: PreflightFinding[]): void {
  const bytes = new TextEncoder().encode(html).length;
  if (bytes >= HTML_SIZE_WARN_BYTES) {
    out.push(
      finding(
        'html-oversize',
        'warn',
        DEDUCT.htmlOversize,
        `The email HTML is ${Math.round(bytes / 1024)}KB — Gmail clips messages near 102KB.`,
        'A clipped message hides your unsubscribe link and footer. Trim content or split into two sends.',
      ),
    );
  }

  const text = visibleTextOf(html);
  const images = extractImages(html);

  if (images.length > 0 && text.length < IMAGE_ONLY_MIN_TEXT_CHARS) {
    out.push(
      finding(
        'image-only-body',
        'warn',
        DEDUCT.imageOnlyBody,
        'The email is nearly all image with very little text.',
        'Filters distrust image-only mail, and image-blocking clients show nothing. Add real text.',
      ),
    );
  }

  const missingAlt = images.filter((i) => !i.hasAlt && !i.src.startsWith('data:')).length;
  if (missingAlt > 0) {
    out.push(
      finding(
        'images-missing-alt',
        'info',
        DEDUCT.imagesMissingAlt,
        `${missingAlt} image${missingAlt === 1 ? '' : 's'} ha${missingAlt === 1 ? 's' : 've'} no alt text.`,
        'Alt text is what people see while images load (or stay blocked) — describe each image briefly.',
      ),
    );
  }

  const base64Count = images.filter((i) => i.src.startsWith('data:')).length;
  if (base64Count > 0) {
    out.push(
      finding(
        'base64-image',
        'block',
        DEDUCT.base64Image,
        `${base64Count} image${base64Count === 1 ? ' is' : 's are'} embedded as base64 data.`,
        'Embedded images balloon the HTML past clipping limits and are a spam signal — host images on an https URL instead.',
      ),
    );
  }

  const anchors = extractAnchors(html);
  const httpAnchors = anchors
    .map((a) => ({ ...a, url: parseUrl(a.href) }))
    .filter((a): a is AnchorRef & { url: URL } => a.url != null);

  if (anchors.length > MAX_LINKS) {
    out.push(
      finding(
        'too-many-links',
        'warn',
        DEDUCT.tooManyLinks,
        `The email contains ${anchors.length} links.`,
        `Heavily link-stuffed mail scores worse. Keep it under ${MAX_LINKS} and make each link count.`,
      ),
    );
  }

  const shorteners = httpAnchors.filter((a) => URL_SHORTENER_HOSTS.has(a.url.hostname.replace(/^www\./, '')));
  if (shorteners.length > 0) {
    out.push(
      finding(
        'url-shortener',
        'warn',
        DEDUCT.urlShortener,
        `Links use URL shorteners (${[...new Set(shorteners.map((s) => s.url.hostname))].join(', ')}).`,
        'Shortener domains are heavily abused by spammers — link the real destination instead.',
      ),
    );
  }

  const insecure = [
    ...httpAnchors.filter((a) => a.url.protocol === 'http:'),
    ...images.filter((i) => i.src.toLowerCase().startsWith('http://')),
  ].length;
  if (insecure > 0) {
    out.push(
      finding(
        'insecure-urls',
        'warn',
        DEDUCT.insecureUrls,
        `${insecure} link${insecure === 1 ? '' : 's'}/image${insecure === 1 ? '' : 's'} use plain http://.`,
        'Serve every link and image over https — mixed content looks unsafe to filters and clients.',
      ),
    );
  }

  const rawIp = httpAnchors.filter((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a.url.hostname));
  if (rawIp.length > 0) {
    out.push(
      finding(
        'raw-ip-link',
        'block',
        DEDUCT.rawIpLink,
        'A link points at a bare IP address.',
        'Legitimate mail links to domains, not IPs — this is a classic phishing pattern.',
      ),
    );
  }

  const suspicious = anchors.filter((a) => /^(javascript|data|vbscript):/i.test(a.href));
  if (suspicious.length > 0) {
    out.push(
      finding(
        'suspicious-protocol',
        'block',
        DEDUCT.suspiciousProtocol,
        'A link uses a script/data protocol.',
        'Email clients strip these and filters flag them — use https links only.',
      ),
    );
  }

  // Anchor text that names one site while the href goes to another is the signature phishing shape.
  const DOMAIN_IN_TEXT_RE = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;
  const mismatched = httpAnchors.filter((a) => {
    const m = DOMAIN_IN_TEXT_RE.exec(a.text);
    if (!m?.[1]) return false;
    const claimed = m[1];
    // Only treat it as a domain claim when it has a plausible TLD (avoids "e.g" style false hits).
    if (!/\.[a-z]{2,}$/i.test(claimed)) return false;
    return !sameSite(claimed, a.url.hostname);
  });
  if (mismatched.length > 0) {
    out.push(
      finding(
        'anchor-domain-mismatch',
        'block',
        DEDUCT.anchorDomainMismatch,
        `Link text claims one site but points to another (e.g. "${mismatched[0]?.text.slice(0, 60)}").`,
        'Make the visible text match the real destination — mismatches are the signature phishing pattern.',
      ),
    );
  }
}

/** Runs every deterministic check. Pure — same result in the composer and on the server. */
export function lintNewsletterContent(input: PreflightInput): PreflightFinding[] {
  const out: PreflightFinding[] = [];
  lintSubject(input.subject, out);
  lintBody(input.html, out);
  return out;
}

/** Converts a SpamAssassin score (Postmark spamcheck) into a finding, or null when unremarkable. */
export function buildSpamAssassinFinding(saScore: number): PreflightFinding | null {
  if (saScore < SPAMASSASSIN_INFO_AT) return null;
  const deduction = Math.min(
    SPAMASSASSIN_MAX_DEDUCTION,
    Math.max(0, Math.round(SPAMASSASSIN_DEDUCTION_PER_POINT * (saScore - SPAMASSASSIN_INFO_AT))),
  );
  return finding(
    'spamassassin-score',
    saScore >= SPAMASSASSIN_WARN_AT ? 'warn' : 'info',
    deduction,
    `SpamAssassin scores this email ${saScore.toFixed(1)} (5+ is typically filtered).`,
    'Review the flagged wording and structure — small copy changes usually drop this fast.',
  );
}

/** Converts the AI verdict into findings (risk contribution, deception flags, disallowed content). */
export function buildAiFindings(verdict: AiPreflightVerdict): PreflightFinding[] {
  const out: PreflightFinding[] = [];

  const disallowed = verdict.contentType === 'pure_commercial_marketing' || verdict.contentType === 'scam_or_phishing';
  if (disallowed && verdict.confidence >= AI_DISALLOWED_MIN_CONFIDENCE) {
    const isScam = verdict.contentType === 'scam_or_phishing';
    out.push(
      finding(
        isScam ? 'ai-scam-phishing' : 'ai-commercial-marketing',
        'block',
        DEDUCT.aiDisallowedContent,
        isScam
          ? 'The content review flagged this as a possible scam or phishing message.'
          : 'The content review reads this as commercial marketing, which pplCRM newsletters do not cover.',
        isScam
          ? 'If this is a mistake, adjust the wording that resembles credential or payment bait and re-run the check.'
          : 'pplCRM sending is for community, political and nonprofit updates — including fundraising and auctions. Product-sales blasts are outside the acceptable-use policy.',
      ),
    );
  }

  const riskDeduction = Math.round((verdict.spamRiskScore / 100) * AI_RISK_MAX_DEDUCTION * verdict.confidence);
  if (riskDeduction > 0) {
    const reasons = verdict.reasons.slice(0, 3).join('; ');
    out.push(
      finding(
        'ai-spam-risk',
        verdict.spamRiskScore >= AI_RISK_WARN_AT ? 'warn' : 'info',
        riskDeduction,
        `The content review rates the copy ${verdict.spamRiskScore}/100 for spam-like patterns${reasons ? ` — ${reasons}` : ''}.`,
        'See the suggestions below for the specific lines to soften.',
      ),
    );
  }

  if (verdict.deceptionFlags.length > 0) {
    out.push(
      finding(
        'ai-deception-flags',
        'warn',
        DEDUCT.aiDeceptionFlags,
        `The copy uses pressure patterns: ${verdict.deceptionFlags.slice(0, 4).join(', ')}.`,
        'Manufactured urgency and misleading claims drive spam reports — state the real ask plainly.',
      ),
    );
  }

  return out;
}

/** 100 minus every deduction, clamped to 0–100 and rounded. */
export function computeScore(findings: PreflightFinding[]): number {
  const total = findings.reduce((sum, f) => sum + f.deduction, 0);
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}
````

## File: libs/common/vite.config.ts
````typescript
/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/common',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [],
  test: {
    name: 'common',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/common',
      provider: 'v8' as const,
      // Coverage ratchet: set just under the measured baseline (2026-07-17:
      // 98.04% stmts / 90.31% branch / 100% funcs / 98.41% lines); held slightly
      // below so one new helper file doesn't instantly break the build, but keep
      // raising it as the lib grows. Never lower these — add tests instead.
      thresholds: {
        statements: 96,
        branches: 90,
        functions: 98,
        lines: 96,
      },
    },
  },
}));
````

## File: libs/uxcommon/src/components/alerts/alert-service.ts
````typescript
import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

export class AlertMessage {
  public readonly visible = signal(true);
  /** How many identical (same text+type) toasts have coalesced into this one (§2). */
  public readonly count = signal(1);

  public duration = 3000;
  public id: string;
  public text: string;
  public timeoutId: NodeJS.Timeout | undefined;
  public type?: ALERTTYPE;

  constructor(init?: Partial<AlertMessage>) {
    Object.assign(this, init);
    this.id = init?.id ?? crypto.randomUUID();
    this.duration = init?.duration || 3000;
    this.text = init?.text ?? 'Alert';
  }
}

/** Max simultaneous toasts; oldest drops when a new one arrives (§2). */
const MAX_TOAST_STACK = 3;

@Injectable({
  providedIn: 'root',
})
export class AlertService {
  private readonly alertsSignal = signal<AlertMessage[]>([]);

  /**
   * Epoch-ms deadline until which {@link showError} drops error toasts. Armed by the app on a
   * sign-out redirect: a dead session makes every in-flight query fail with UNAUTHORIZED at once,
   * and each caller would otherwise raise its own misleading "Failed to load …" error — noise that
   * is both wrong (the real cause is the expired session) and redundant with the sign-in redirect.
   * Only errors are muted; info/success toasts (e.g. the "please sign in again" nudge) still show.
   */
  private errorsMutedUntil = 0;

  public readonly alertList = this.alertsSignal.asReadonly();
  public readonly alerts$ = toObservable(this.alertsSignal);

  public dismiss(id: string): void {
    const alert = this.findById(id);

    if (!alert) return;

    // Clear any pending removal timeout
    clearTimeout(alert.timeoutId);
    alert.timeoutId = undefined;

    alert.visible.set(false);

    // Have to let the animation do its thing first
    setTimeout(() => {
      const next = this.alertsSignal().filter((msg) => msg.id !== id);
      this.alertsSignal.set(next);
    }, 300);
  }

  public getAlerts(): AlertMessage[] {
    return this.alertsSignal();
  }

  /** Suppress error toasts for the next `ms` (see {@link errorsMutedUntil}). Used on sign-out. */
  public muteErrorsFor(ms: number): void {
    this.errorsMutedUntil = Date.now() + ms;
  }

  public show(alert: Partial<AlertMessage>): void {
    // Coalesce an identical (same text + type) toast into a ×N count with a
    // refreshed timer instead of stacking duplicates (§2).
    const existing = this.alertsSignal().find((m) => m.text === alert.text && m.type === alert.type);

    if (existing) {
      existing.count.update((c) => c + 1);
      clearTimeout(existing.timeoutId);
      existing.timeoutId = setTimeout(() => this.dismiss(existing.id), existing.duration || 3000);
      return;
    }

    const messageWithMeta: AlertMessage = new AlertMessage({ ...alert });
    // Cap the stack at MAX_TOAST_STACK, dropping the oldest (list is newest-first).
    this.alertsSignal.update((list) => {
      const next = [messageWithMeta, ...list];
      const dropped = next.slice(MAX_TOAST_STACK);
      dropped.forEach((m) => clearTimeout(m.timeoutId));
      return next.slice(0, MAX_TOAST_STACK);
    });

    const duration = messageWithMeta.duration || 3000;
    messageWithMeta.timeoutId = setTimeout(() => this.dismiss(messageWithMeta.id), duration);
  }

  public showError(text: string): void {
    // A sign-out in progress mutes the burst of "Failed to load …" toasts its 401s would raise.
    if (Date.now() < this.errorsMutedUntil) return;
    this.show(new AlertMessage({ text, type: 'error' }));
  }

  public showInfo(text: string): void {
    this.show(new AlertMessage({ text, type: 'info' }));
  }

  public showSuccess(text: string): void {
    this.show(new AlertMessage({ text, type: 'success' }));
  }

  public showWarn(text: string): void {
    this.show(new AlertMessage({ text, type: 'warning' }));
  }

  private findById(id: string) {
    return this.alertsSignal().find((m) => m.id === id);
  }
}

export type ALERTTYPE = 'info' | 'error' | 'warning' | 'success';
````

## File: libs/uxcommon/src/components/geocode-chip/geocode-chip.ts
````typescript
import { Component, computed, input } from '@angular/core';
import { StatusBadge } from '../status-badge/status-badge';
import type { PcStatusType } from '../status-badge/status-badge';

/** The household geocoding lifecycle as stored in `households.geocoding_status`. */
export type PcGeocodeStatus = 'success' | 'pending' | 'failed' | 'skipped' | null | undefined;

interface GeocodeChipSpec {
  label: string;
  type: PcStatusType;
}

/**
 * The single, binding surface for a household's geocode state (§6 consumers):
 * "Located / Locating… / Address problem / Not geocoded" — never a hidden row.
 * Wave 2 (canvassing readiness, delivery coverage) reads the same states.
 *
 * DB status → chip:
 *  - `success`            → **Located** (success — done)
 *  - `pending` / `null`   → **Locating…** (info — in progress)
 *  - `failed`             → **Address problem** (warning — needs attention)
 *  - `skipped`            → **Not geocoded** (neutral — geocoding is a Movement feature; the
 *                           address is fine, it just wasn't sent to the geocoder on this plan)
 */
export function geocodeChipSpec(status: PcGeocodeStatus | string): GeocodeChipSpec {
  switch (status) {
    case 'success':
      return { label: 'Located', type: 'success' };
    case 'failed':
      return { label: 'Address problem', type: 'warning' };
    case 'skipped':
      return { label: 'Not geocoded', type: 'neutral' };
    default:
      return { label: 'Locating…', type: 'info' };
  }
}

@Component({
  selector: 'pc-geocode-chip',
  imports: [StatusBadge],
  template: ` <pc-status-badge [type]="spec().type" [size]="size()">{{ spec().label }}</pc-status-badge> `,
})
export class GeocodeChip {
  public readonly status = input<PcGeocodeStatus | string>(null);
  public readonly size = input<'sm' | 'md' | 'lg'>('sm');

  protected readonly spec = computed(() => geocodeChipSpec(this.status()));
}
````

## File: libs/uxcommon/src/components/status-badge/status-badge.ts
````typescript
import { Component, computed, input } from '@angular/core';

export type PcStatusType = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'ghost';

@Component({
  selector: 'pc-status-badge',
  template: `
    <span class="badge whitespace-nowrap font-semibold uppercase" [class]="badgeClass()">
      <ng-content></ng-content>
    </span>
  `,
})
export class StatusBadge {
  public type = input<PcStatusType>('ghost');
  public size = input<'xs' | 'sm' | 'md' | 'lg'>('xs');

  protected badgeClass = computed(() => {
    const t = this.type();
    let cls = '';
    if (this.size() === 'xs') cls += 'badge-xs ';
    else if (this.size() === 'sm') cls += 'badge-sm ';
    else if (this.size() === 'md') cls += 'badge-md ';
    else if (this.size() === 'lg') cls += 'badge-lg ';

    switch (t) {
      case 'success':
        return cls + 'badge-success text-success-content';
      case 'warning':
        return cls + 'badge-warning text-warning-content';
      case 'error':
        return cls + 'badge-error text-error-content';
      case 'info':
        return cls + 'badge-info text-info-content';
      case 'neutral':
        return cls + 'badge-neutral text-neutral-content';
      default:
        return cls + 'badge-ghost';
    }
  });
}
````

## File: libs/uxcommon/src/components/tags/tagitem.css
````css
:host {
  display: inline-block;
  max-width: 100%;
}

.badge {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.25rem;
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
  min-height: 1.5rem;
  height: auto;
  line-height: 1.2;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.tag-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.2;
}

.tag-remove {
  align-self: flex-start;
  margin-top: 0.125rem;
}

.badge-compact {
  font-size: 0.7rem !important;
  font-weight: 500 !important;
  min-height: 1.25rem !important;
  height: auto !important;
  align-items: center !important;
  padding-top: 0.125rem !important;
  padding-bottom: 0.125rem !important;
  padding-left: 0.375rem !important;
  padding-right: 0.375rem !important;
}

.badge-compact .tag-label {
  font-size: 0.7rem !important;
  line-height: 1.15 !important;
  padding-right: 0 !important;
}

.badge-compact .tag-remove {
  margin-top: 0 !important;
  align-self: center !important;
}
````

## File: libs/uxcommon/src/styles/themes.css
````css
/*
 * Shared DaisyUI theme tokens — the single source of truth for the pplCRM
 * palette, consumed by every app (apps/frontend, apps/companion). Import this
 * from each app's styles.css right after `@plugin "daisyui";`. Do not fork
 * these values into an app-local theme block; change them here.
 */

/* base-50: the sub-base-200 "card wash" tint. Registered here so Tailwind generates
   bg-base-50 (incl. /NN opacity modifiers); the real value is set per theme in the
   DaisyUI blocks below, same as --color-line. */
@theme {
  --color-base-50: #fbfbfc;
}

/* pc-icon builds `w-${size} h-${size}` at runtime (icon.ts), which Tailwind's static
   scanner cannot see — without this safelist an icon size only works if some other
   file happens to use the same w-/h- class literally. Covers every [size] in use. */
@source inline("{w,h}-{2,3,4,5,6,7,8,10,12,16}");

@plugin "daisyui/theme" {
  name: 'light';
  default: true;
  --color-primary: #3498db;
  --color-primary-content: #ffffff;
  --color-secondary: #22a6b3;
  --color-secondary-content: #ffffff;
  --color-accent: #818789;
  --color-accent-content: #f0f0f0;
  --color-neutral: #cbd5e1;
  --color-neutral-content: #1f2937;
  --color-base-50: #fbfbfc; /* card wash — between base-100 and base-200 */
  --color-base-100: #ffffff;
  --color-base-200: #f8f8f8ff;
  --color-base-300: rgb(226, 226, 226);
  --color-base-content: #1f2937;
  --color-info: #38bdf8;
  --color-success: #2dd4bf;
  --color-success-content: #053a34;
  --color-warning: #e3d6a7;
  --color-warning-content: #342c0b;
  --color-error: #eb4d4b;
  --color-error-content: #ffffff;

  /* Hairline border token — one line color app-wide, per theme (design §5). */
  --color-line: #e7e5e4;

  /* Button/input rounding — the app-wide "slight rounded edge". Pinned explicitly so the
     look survives DaisyUI default changes; per-button rounded-* utilities are forbidden
     (UX-GUIDELINES "Buttons"). */
  --radius-field: 0.25rem;

  --tooltip-bg: #333333;
  --tooltip-color: #eeeeee;
  --color-placeholder: #9ca3af;
}

@plugin "daisyui/theme" {
  name: 'dark';

  /* Brand / accent */
  --color-primary: #3ea6ff; /* bright azure */
  --color-secondary: #20d7a7; /* teal pop (optional) */
  --color-accent: #3ea6ff;
  --color-accent-content: #0b1220; /* dark text on bright azure */

  /* Text + neutrals */
  --color-neutral: #0e182b; /* chrome / panels */
  --color-neutral-content: #c7d1e5; /* default text on dark */

  /* Surfaces */
  --color-base-50: #0f1729; /* card wash — between base-100 and base-200 */
  --color-base-100: #0b1220; /* app/page background */
  --color-base-200: #131e31; /* row alt / subtle surface */
  --color-base-300: #1a2b45; /* headers / raised surface */

  /* Hairline border token — one line color app-wide, per theme (design §5). */
  --color-line: #1a2b45;

  /* Button/input rounding — keep identical to the light theme (UX-GUIDELINES "Buttons"). */
  --radius-field: 0.25rem;

  /* Feedback */
  --color-info: #3ea6ff;
  --color-success: #22c55e;
  --color-success-content: #052e12;
  --color-warning: #f59e0b;
  --color-warning-content: #3d2a05;
  --color-error: #ef4444;
  --color-error-content: #2b0505;

  /* Tooltips */
  --tooltip-bg: #0e1626;
  --tooltip-color: #e6edf7;
}
````

## File: libs/uxcommon/src/index.ts
````typescript
export * from './loading-gate';
export * from './request-guard';

// Components
export * from './components/alerts/alert-service';
export * from './components/alerts/alerts';
export * from './components/icons/icon';
export * from './components/icons/icons.index';
export * from './components/confirm-dialog-host';
export * from './components/confirm-dialog.service';
export * from './components/user-avatar/user-avatar';
export * from './components/tags/tagitem';
export * from './components/input/input';
export * from './components/textarea/textarea';
export * from './components/select/select';
export * from './components/toggle/toggle';
export * from './components/detail-header/detail-header';
export * from './components/detail-layout/detail-layout';
export * from './components/entity-overview/entity-overview';
export * from './components/address-form-group/address-form-group';
export * from './components/card/card';
export * from './components/stat-card/stat-card';
export * from './components/table/table';
export * from './components/row-actions/row-actions';
export * from './components/side-drawer/side-drawer';
export * from './components/tabs/tabs';
export * from './components/status-badge/status-badge';
export * from './components/profile-card/profile-card';
export * from './components/detail-row/detail-row';
export * from './components/detail-item/detail-item';
export * from './components/system-metadata/system-metadata';
export * from './components/fields-selector/fields-selector';
export * from './components/public-link-panel/public-link-panel';
export * from './components/map/map';
export * from './components/map/map-types';
export * from './components/geocode-chip/geocode-chip';

// Directives
export * from './directives/animate-if.directive';
export * from './directives/spin-on-click.directive';

// Pipes
export * from './pipes/file-icon.pipe';
export * from './pipes/filesize.pipe';
export * from './pipes/sanitize-html.pipe';
export * from './pipes/svg-html-pipe';
export * from './pipes/timeago.pipe';
````

## File: libs/uxcommon/src/loading-gate.ts
````typescript
// _loading-gate.ts
import { type Signal, signal } from '@angular/core';

export type loadingGate = {
  /**
   * Spinner visibility — intentionally delayed by `delay` ms and held for
   * `minDuration` ms to suppress flicker. Bind this to spinners ONLY; it can stay
   * false for a whole sub-`delay` operation, so it is not a truthful "did work
   * happen" signal.
   */
  visible: ReturnType<typeof signal<boolean>>;

  /**
   * True once the first operation has COMPLETED — ungated, so it flips even for a
   * fast operation that never trips `visible`. Set when a load finishes (not when
   * it begins), so the data it produced is already in place. Use this for
   * "has loaded at least once" state (first-load gating, skeleton-vs-empty)
   * instead of watching `visible`.
   */
  loaded: Signal<boolean>;

  /**
   * True while at least one operation is in flight — immediate and ungated,
   * unlike `visible`. Use it to choose skeleton-vs-empty on surfaces that
   * refetch after their first load (an empty list only means "no data" when
   * nothing is fetching). Never bind it to spinners; that is what the
   * delayed `visible` is for.
   */
  active: Signal<boolean>;

  begin(): () => void;
};

export function createLoadingGate(options?: { delay?: number; minDuration?: number }): loadingGate {
  const delay = options?.delay ?? 300; // ms before showing
  const minDuration = options?.minDuration ?? 300; // ms the _loading stays once visible

  const visible = signal(false);
  const loaded = signal(false);
  const active = signal(false);
  let pendingCount = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownAt = 0;

  const clearShowTimer = () => {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };
  const clearHideTimer = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  function scheduleShow() {
    clearShowTimer();
    showTimer = setTimeout(() => {
      showTimer = null;
      if (pendingCount > 0 && !visible()) {
        visible.set(true);
        shownAt = performance.now();
      }
    }, delay);
  }

  function scheduleHide() {
    clearHideTimer();
    if (!visible()) return; // never shown → nothing to hide

    const remaining = Math.max(0, minDuration - (performance.now() - shownAt));
    hideTimer = setTimeout(() => {
      if (pendingCount === 0) visible.set(false);
    }, remaining);
  }

  function begin() {
    pendingCount++;
    active.set(true);
    if (pendingCount === 1) {
      // First operation: start the delayed show
      scheduleShow();
    }
    // Return disposer
    let done = false;
    return () => {
      if (done) return;
      done = true;
      pendingCount--;
      loaded.set(true); // an operation has completed — its result is now in place
      if (pendingCount <= 0) {
        pendingCount = 0;
        active.set(false);
        // If we never showed, cancel the show timer so _loading never appears
        clearShowTimer();
        scheduleHide(); // hides now or after minDuration
      }
    };
  }

  return { begin, visible, loaded, active };
}
````

## File: libs/uxcommon/vite.config.mts
````typescript
/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/uxcommon',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [angular()],
  test: {
    name: 'uxcommon',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/uxcommon',
      provider: 'v8' as const,
      // Coverage ratchet: set just under the measured baseline (2026-07-17:
      // 81.67% stmts / 64.37% branch / 82.97% funcs / 81.48% lines). These may
      // only ever be raised, never lowered — if your change drops coverage
      // below them, add tests rather than editing the thresholds.
      thresholds: {
        statements: 80,
        branches: 63,
        functions: 80,
        lines: 81,
      },
    },
  },
}));
````

## File: libs/common/src/lib/billing/currency.ts
````typescript
/**
 * Display-currency helpers for the marketing website.
 *
 * The single source of truth for prices is USD ({@link ./plans.ts}). These helpers let the
 * marketing site *show* those USD prices converted to a handful of local currencies at live
 * exchange rates, purely for the visitor's convenience. Billing is always in USD — the pricing
 * page carries that disclaimer whenever a non-USD currency is shown.
 *
 * Everything here is framework-agnostic (no Angular): the Angular service that fetches rates and
 * detects the visitor's region lives in the website app (ui/currency.service.ts). Conversion is
 * rounded to whole currency units — these are estimates, and whole numbers read cleanly next to
 * the "billed in USD" note.
 */

/** The currencies the marketing site can display prices in. USD is the billing currency. */
export const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyDef {
  readonly code: CurrencyCode;
  /** The symbol shown in the switcher trigger, disambiguated across currencies (CA$ vs $). */
  readonly symbol: string;
  /** Human label for the switcher menu. */
  readonly label: string;
}

/** Per-currency display metadata, keyed by code. The symbol is the plain currency glyph; the
 * ISO code disambiguates the shared `$` (USD vs CAD), shown alongside the symbol. */
export const SUPPORTED_CURRENCIES: Readonly<Record<CurrencyCode, CurrencyDef>> = {
  USD: { code: 'USD', symbol: '$', label: 'US dollar' },
  EUR: { code: 'EUR', symbol: '€', label: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', label: 'British pound' },
  CAD: { code: 'CAD', symbol: '$', label: 'Canadian dollar' },
};

/** Locale used for number grouping in formatted prices (fixed for consistent English
 * presentation on the marketing site). */
const FORMAT_LOCALE = 'en-US';

/** Symbols used when formatting a *price* (e.g. `C$41` in the pricing table). CAD uses `C$` to
 * distinguish it from USD's `$`. This is separate from `SUPPORTED_CURRENCIES[code].symbol`, which
 * is the switcher-menu symbol paired with the ISO code there (`$ CAD`). */
const PRICE_SYMBOLS: Readonly<Record<CurrencyCode, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
};

/** Rates relative to USD (USD is always 1). Absent codes mean "rate not loaded yet". */
export type ExchangeRates = Partial<Record<CurrencyCode, number>>;

/** Type guard: is a string one of our supported currency codes? */
export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * ISO-3166 alpha-2 country codes that map to a non-USD display currency. Eurozone members map to
 * EUR; GB → GBP; CA → CAD. Every country not listed falls back to USD (see `currencyForCountry`).
 */
export const COUNTRY_TO_CURRENCY: Readonly<Record<string, CurrencyCode>> = {
  GB: 'GBP',
  CA: 'CAD',
  // Eurozone (the 20 EUR members).
  AT: 'EUR',
  BE: 'EUR',
  HR: 'EUR',
  CY: 'EUR',
  EE: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  DE: 'EUR',
  GR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  ES: 'EUR',
};

/** Resolve a country code (from geo-IP or a locale region) to a display currency; default USD. */
export function currencyForCountry(country: string | null | undefined): CurrencyCode {
  if (!country) return 'USD';
  return COUNTRY_TO_CURRENCY[country.toUpperCase()] ?? 'USD';
}

/**
 * Convert a whole-dollar USD amount to `code` at the given rates, rounded to whole units.
 * Falls back to the original amount when the rate for `code` is missing (treated as USD).
 */
export function convertFromUsd(usd: number, code: CurrencyCode, rates: ExchangeRates): number {
  const rate = code === 'USD' ? 1 : rates[code];
  if (rate == null) return Math.round(usd);
  return Math.round(usd * rate);
}

/** The price symbol for a currency (e.g. `C$` for CAD), for copy that references the currency
 * inline — kept consistent with `formatCurrency`'s output. */
export function currencyPriceSymbol(code: CurrencyCode): string {
  return PRICE_SYMBOLS[code];
}

/** Format a whole-unit amount as a price with a disambiguated symbol and no fractional part
 * (e.g. `$69`, `C$95`, `€65`, `£55`). */
export function formatCurrency(amount: number, code: CurrencyCode): string {
  const number = new Intl.NumberFormat(FORMAT_LOCALE, { maximumFractionDigits: 0 }).format(amount);
  return `${currencyPriceSymbol(code)}${number}`;
}
````

## File: libs/common/src/lib/help/articles/contacts.ts
````typescript
import type { HelpArticle } from '../help-types';

export const CONTACTS_ARTICLES: HelpArticle[] = [
  {
    id: 'add-people',
    category: 'contacts',
    title: 'Add and edit people',
    summary: 'Create person records one at a time, edit them safely, and understand what happens to unsaved changes.',
    keywords: ['add person', 'create contact', 'new person', 'edit person', 'contact details', 'unsaved changes'],
    related: ['person-profile', 'import', 'tags-issues', 'households'],
    blocks: [
      { kind: 'h2', id: 'add-one', text: 'Add a person' },
      {
        kind: 'steps',
        items: [
          { title: 'Open [People](/people)', detail: 'Everything about individual contacts starts in this grid.' },
          { title: 'Click the + button in the toolbar', detail: 'The new-person form opens.' },
          {
            title: 'Fill in what you know',
            detail:
              'Fields validate as you type. Problems are explained right under the field, so you can fix them before saving.',
          },
          { title: 'Save', detail: 'You land on the new profile, ready for tags, a household, or a follow-up task.' },
        ],
      },
      {
        kind: 'p',
        text: 'The new-person form also carries the **Campaign standing** card, so you can set a **support level**, **voting status**, **email subscription**, and the global **do-not-contact** flag right as you create the person. Support, voting, and the subscription apply to the campaign context you are working in (shown on the card); do-not-contact is global. You do not have to. Leave them alone and the person is created with everything “Unknown”, then set standing later from their profile.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Have a spreadsheet?',
        text: 'Do not type hundreds of rows by hand. [Import data from CSV](/help/import) brings them in at once, and the [Duplicates](/help/duplicates) finder cleans up any overlap afterwards.',
      },
      { kind: 'h2', id: 'editing', text: 'Edit an existing person' },
      {
        kind: 'p',
        text: 'Open the profile and use its edit action for the full form, or edit simple fields straight in the grid. Double-click a cell, change the value, and it saves on the spot with a brief green flash to confirm. Grid edits can be undone with the undo arrow in the toolbar.',
      },
      {
        kind: 'p',
        text: 'In the form, tags and issues offer suggestion chips drawn from values already in use. Click one to apply it instead of retyping. The address is not edited here: because addresses belong to households, the form shows it read-only with an “Edit on household” link, so everyone at that address stays in sync.',
      },
      {
        kind: 'p',
        text: 'If you try to leave a form with unsaved changes, pplCRM asks before discarding them. It names exactly which fields would be lost, so nothing disappears silently.',
      },
      { kind: 'h2', id: 'deleting', text: 'Delete with care' },
      {
        kind: 'p',
        text: 'Delete lives in the record menu (and in the grid, appears once you select rows). You will always be asked to confirm, because deleting a person also removes them from the lists and histories that reference them.',
      },
    ],
  },
  {
    id: 'person-profile',
    category: 'contacts',
    title: 'Inside a person profile',
    summary:
      'The profile gathers everything about one person. Here is what each tab shows and where the numbers come from.',
    keywords: ['profile', 'person view', 'detail page', 'tabs', 'history', 'activity', 'donations tab', 'emails tab'],
    related: ['add-people', 'activity-log', 'donations', 'events-shifts'],
    blocks: [
      {
        kind: 'p',
        text: 'Open any person from the [People](/people) grid by clicking their name in the first column. The header answers the essentials (who this is and their status) and the tabs below collect their entire history. Tab labels carry counts, so you can see at a glance where the substance is before you click.',
      },
      {
        kind: 'p',
        text: 'The contact card on the left carries the essentials: email, phone, address (which links to the household), preferred contact channel, tags, and issues of interest. The record’s notes sit just below it.',
      },
      {
        kind: 'p',
        text: 'Below it, the **Campaign standing** card holds what varies per campaign: this person’s **support level** (Strong through Against; “Unknown” just means never asked), their **voting status** during an election, their **yard sign** (whether their household requested one and whether it has been delivered; see [Deliveries](/help/deliveries)), their **email consent** for the context you are working in, and the global **do-not-contact** override. The card always shows the campaign you are working in — your assigned campaign, or, for admins, the context selected under **Workspace → Campaigns**.',
      },
      {
        kind: 'p',
        text: 'Use **Log an interaction** in the header to record a real-world touch (a **call**, **door knock**, **email or note**, or **meeting**) with an optional note. It is saved to this person’s history and shows up in the Activity tab immediately. The same button lives in the header on household and company pages, which carry the identical Activity tab.',
      },
      { kind: 'h2', id: 'tabs', text: 'What each tab holds' },
      {
        kind: 'list',
        items: [
          '**Household**: everyone at the same address.',
          '**Connections**: the people this person is linked to (referrals, relationships, and other ties), separate from who they live with.',
          '**Emails**: messages exchanged with this person through the [Inbox](/inbox), followed by their newsletter engagement (opens, clicks, bounces).',
          '**Donations**: every gift on record, showing date, amount, method (card or manual, with a “· monthly” note for pledge-linked gifts), and receipt status. An active monthly pledge also lights up a “Monthly donor” chip beside the name.',
          '**Volunteer**: their shift history and hours.',
          '**Events**: event registrations and attendance.',
          '**Activity**: the running history of this record, pairing the interactions you log (calls, door knocks, notes, meetings) with the audit trail of edits, newest first. It sits last, as it does on every record.',
        ],
      },
      { kind: 'h2', id: 'navigating', text: 'Working through many profiles' },
      {
        kind: 'p',
        text: 'Arriving from a filtered grid, the header shows “N of M filtered” with previous/next arrows. Use `J` and `K` to walk the whole set hands-on-keyboard. See [Finding your way around](/help/getting-around).',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Empty tab? That is a prompt, not a dead end',
        text: 'Empty states name the cause and offer the next step. For example, a person with no household shows an assign action right there.',
      },
    ],
  },
  {
    id: 'households',
    category: 'contacts',
    title: 'Households',
    summary: 'Group people who live together so mailings, door-knocks, and donation asks treat them as one unit.',
    keywords: [
      'household',
      'family',
      'address',
      'members',
      'assign household',
      'home',
      'map',
      'ward',
      'district',
      'precinct',
      'geocode',
      'door notes',
    ],
    related: ['add-people', 'person-profile', 'duplicates'],
    blocks: [
      {
        kind: 'p',
        text: 'A household groups the people at one address. Use households to avoid mailing the same home twice, to canvass efficiently, and to understand giving at the family level.',
      },
      { kind: 'h2', id: 'create', text: 'Create a household' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Households](/households)',
            detail:
              'From [People](/people), click the **Households** tab under the header. People, Households, and Companies are three views of the same contacts. The grid lists every household with its members.',
          },
          { title: 'Click the + button', detail: 'Name the household and give it an address.' },
          { title: 'Add members', detail: 'Assign people from their profiles, or from the household page itself.' },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Start from the person',
        text: 'On a profile with no household yet, the household area offers **Assign household** directly, often the fastest route.',
      },
      { kind: 'h2', id: 'address-map', text: 'The address, the map, and electoral boundaries' },
      {
        kind: 'p',
        text: 'Editing a household, search for an address and pick a suggestion. It fills every field below and geocodes the household, so ward, district, and precinct update automatically. Prefer to type it yourself? Open **Enter address manually**; manual edits save as typed, geocode in the background, and the map pin appears once the address verifies.',
      },
      {
        kind: 'p',
        text: 'The household page shows a map card. Clicking it opens the location in your maps app, with the ward and address labelled on top. A status chip always tells you where geocoding stands: **Located** (the pin is set), **Locating…** (still working in the background), **Address problem** (the address could not be found; open Edit and fix it), or **Not geocoded** (geocoding is a Movement feature and your plan is below it — the address is saved and fine, it just wasn’t placed on the map). Geocoded households power canvassing turfs and delivery coverage, so a clean address pays off downstream. Below the details you’ll also find a **Yard sign** card showing this home’s sign request in the campaign you are working in. Set it right there if a sign went up outside the app (see [Deliveries](/help/deliveries)).',
      },
      { kind: 'h2', id: 'dedupe', text: 'Keep households clean' },
      {
        kind: 'p',
        text: 'Imports sometimes create near-identical households. The [Duplicates](/duplicates) finder has a dedicated households view for merging them. See [Find and merge duplicates](/help/duplicates).',
      },
    ],
  },
  {
    id: 'companies',
    category: 'contacts',
    title: 'Companies',
    summary: 'Track employers, sponsors, and partner organizations, and connect people to them.',
    keywords: [
      'company',
      'organization',
      'employer',
      'business',
      'sponsor',
      'corporate',
      'enrich',
      'google',
      'google places',
    ],
    related: ['person-profile', 'duplicates', 'grid-basics'],
    blocks: [
      {
        kind: 'p',
        text: 'Companies hold the organizations in your world: employers of your supporters, sponsors, vendors, and institutional partners. Each company page shows its details and the people connected to it, with counts on every tab.',
      },
      { kind: 'h2', id: 'create', text: 'Add a company' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Companies](/companies)',
            detail:
              'From [People](/people), click the **Companies** tab under the header. Browse or search existing companies first to avoid creating a twin.',
          },
          { title: 'Click the + button', detail: 'Fill in the name and any contact details you have.' },
          { title: 'Connect people', detail: 'Link people to the company so both sides show the relationship.' },
        ],
      },
      { kind: 'h2', id: 'enrichment', text: 'Fill the gaps with Google' },
      {
        kind: 'p',
        text: 'While adding a company, tab out of the **Company Name** field and pplCRM looks it up on Google Places right away, filling the website, phone, industry, and description **only where they are blank**. The values appear in the form so you can review and edit them before you press **Create**. Nothing is saved until you do, and anything you typed is never touched. If a company with that name already exists, a hint appears under the name so you can catch a duplicate before saving; you can still save if it is genuinely a separate record.',
      },
      {
        kind: 'p',
        text: 'For companies that already exist, press **Enrich** on the company page to run the same lookup in the background. Once a company has been enriched the button reads **Re-check Google** so you can refresh it later.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Deleting a company keeps the people',
        text: 'Companies are grouped from each person’s employer. Deleting a company clears only the grouping. Everyone keeps their person record, they just lose the employer link.',
      },
      {
        kind: 'p',
        text: 'Companies get the full grid toolkit (filters, tags, CSV import and export, and inline editing) plus their own view in the [Duplicates](/duplicates) finder.',
      },
    ],
  },
  {
    id: 'teams',
    category: 'contacts',
    title: 'Teams',
    summary: 'Organize volunteers and staff into teams with their own members, lists, and tasks.',
    keywords: ['team', 'volunteers', 'staff', 'group', 'organizing', 'crew'],
    related: ['events-shifts', 'tasks', 'lists'],
    blocks: [
      {
        kind: 'p',
        text: 'Teams turn a crowd of volunteers into working units: a canvassing crew, a phone-bank team, an events committee. Each team page carries its own tabs for activity, volunteers, lists, and tasks, so the team’s whole world lives in one place.',
      },
      {
        kind: 'p',
        text: 'The [Teams](/teams) page shows each team as a card with its volunteer count and its **lead**: the person who fields shift questions and escalations. A team with no lead shows a **No lead** warning (“Shift questions and escalations have nowhere to go. Pick a lead.”); open the team and set a lead to clear it.',
      },
      { kind: 'h2', id: 'create', text: 'Set up a team' },
      {
        kind: 'steps',
        items: [
          { title: 'Open [Teams](/teams)', detail: 'Every team shows as a card with its lead and volunteer count.' },
          { title: 'Click New team', detail: 'Name the team and describe its purpose.' },
          { title: 'Add volunteers', detail: 'Build the roster from your existing people.' },
          {
            title: 'Give it work',
            detail: 'Attach lists to call through and tasks to complete. The team page tracks both.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Teams pair well with shifts',
        text: 'Schedule a team’s work as volunteer shifts and attendance flows back to each member’s profile. See [Events and volunteer shifts](/help/events-shifts).',
      },
    ],
  },
];
````

## File: libs/common/src/lib/schemas/auth.schema.ts
````typescript
import { z } from 'zod';
import { emailSchema, nameSchema } from './core.schema';

export const InviteAuthUserObj = z.object({
  email: emailSchema,
  first_name: nameSchema('First name'),
  last_name: nameSchema('Last name').nullable().optional(),
  role: z.string().max(100).nullable().optional(),
  /** Campaigns §15 — assign the invitee to a campaign; null/absent = the office context. */
  campaign_id: z.string().nullable().optional(),
});

export const NotificationPreferencesObj = z.object({
  mention_in_comment: z.boolean().default(true),
  mention_in_comment_in_app: z.boolean().default(true),
  task_assigned: z.boolean().default(true),
  task_assigned_in_app: z.boolean().default(true),
  task_due: z.boolean().default(true),
  task_due_in_app: z.boolean().default(true),
  person_assigned: z.boolean().default(true),
  person_assigned_in_app: z.boolean().default(true),
  email_assigned: z.boolean().default(true),
  email_assigned_in_app: z.boolean().default(true),
  export_ready: z.boolean().default(true),
  export_ready_in_app: z.boolean().default(true),
  import_summary: z.boolean().default(true),
  import_summary_in_app: z.boolean().default(true),
});

/**
 * Shape of the profiles.preferences jsonb column (formerly the untyped
 * profiles.json grab-bag). Only `notifications` is written today; unknown
 * keys from older rows are preserved rather than rejected.
 */
export const ProfilePreferencesObj = z
  .object({
    notifications: NotificationPreferencesObj.partial().optional(),
    /** Campaigns §15 — the context (campaign id) this user is working in; per-user, cross-device. */
    active_campaign_id: z.string().optional(),
  })
  .catchall(z.unknown());

export const UpdateAuthUserObj = z.object({
  email: emailSchema.optional(),
  first_name: nameSchema('First name').optional(),
  last_name: nameSchema('Last name').nullable().optional(),
  role: z.string().max(100).nullable().optional(),
  verified: z.boolean().optional(),
  two_factor_enabled: z.boolean().optional(),
  notification_preferences: NotificationPreferencesObj.optional(),
  /** Campaigns §15 — admin-assigned campaign; null = the office context. Admin/owner callers only. */
  campaign_id: z.string().nullable().optional(),
});

export const Verify2FAObj = z.object({
  email: emailSchema,
  code: z.string().length(6),
  rememberMe: z.boolean().optional(),
});
````

## File: libs/common/src/lib/schemas/content-check.schema.ts
````typescript
import { z } from 'zod';

/**
 * Newsletter preflight ("deliverability check") shared contracts.
 *
 * One number drives the whole feature: a 0–100 deliverability score (higher is better) assembled
 * from explainable per-finding deductions. The band thresholds live here — not in backend
 * send-guards — because the composer gauge and the server-side send gate must agree on where the
 * bands sit. The score is a best-practices measure, not a literal spam probability: inbox placement
 * is mostly sender reputation + engagement, which no pre-send check can compute.
 */

/** Scores at or above this are "good — ready to send". */
export const PREFLIGHT_GOOD = 80;
/** Scores below this block sending (all plans). Between the two bounds: "fix before sending". */
export const PREFLIGHT_BLOCK = 50;

export const PREFLIGHT_BANDS = ['good', 'fix', 'blocked'] as const;
export type PreflightBand = (typeof PREFLIGHT_BANDS)[number];

/** Maps a score to its band. Single source of truth for the gauge and the send gate. */
export function preflightBand(score: number): PreflightBand {
  if (score < PREFLIGHT_BLOCK) return 'blocked';
  return score >= PREFLIGHT_GOOD ? 'good' : 'fix';
}

export const PREFLIGHT_SEVERITIES = ['info', 'warn', 'block'] as const;
export type PreflightSeverity = (typeof PREFLIGHT_SEVERITIES)[number];

export const PreflightFindingObj = z.object({
  /** Stable machine code, e.g. "subject-caps", "base64-image". */
  code: z.string(),
  severity: z.enum(PREFLIGHT_SEVERITIES),
  /** What was found, user-facing. */
  message: z.string(),
  /** How to fix it, user-facing. */
  hint: z.string(),
  /** Points subtracted from the 100-point score. 0 for purely informational rows. */
  deduction: z.number(),
});
export type PreflightFinding = z.infer<typeof PreflightFindingObj>;

/**
 * Content classes the AI reviewer sorts a newsletter into. Fundraising, donations, auctions,
 * events and advocacy are all legitimate for this product (campaigns and nonprofits); only pure
 * commercial marketing and scam/phishing patterns are out of scope per EULA §7.
 */
export const AI_CONTENT_TYPES = [
  'newsletter_update',
  'fundraising_appeal',
  'event_promotion',
  'auction_or_sale',
  'advocacy',
  'pure_commercial_marketing',
  'scam_or_phishing',
  'other',
] as const;
export type AiContentType = (typeof AI_CONTENT_TYPES)[number];

/** Structured verdict returned by the Claude content review (also its output-format schema). */
export const AiPreflightVerdictObj = z.object({
  contentType: z.enum(AI_CONTENT_TYPES),
  /** 0 (clean) to 100 (reads like spam). */
  spamRiskScore: z.number().min(0).max(100),
  /** Short reasons behind the risk score, user-facing. */
  reasons: z.array(z.string()),
  /** Deceptive-pattern flags: fake urgency, misleading claims, impersonation, credential-bait. */
  deceptionFlags: z.array(z.string()),
  /** Concrete copy rewrites for the worst offenders, user-facing. */
  suggestions: z.array(z.string()),
  /** The model's confidence in this verdict, 0–1. */
  confidence: z.number().min(0).max(1),
});
export type AiPreflightVerdict = z.infer<typeof AiPreflightVerdictObj>;

/** Input to the preflight check — raw composer content (no newsletter row needs to exist yet). */
export const RunPreflightObj = z.object({
  subject: z.string().max(500),
  html: z.string().max(500_000),
  plainText: z.string().max(200_000).optional(),
});
export type RunPreflightType = z.infer<typeof RunPreflightObj>;

/**
 * How the AI review figured in a result: it ran ('reviewed'); it was wanted but couldn't run —
 * no API key or the API errored — so the score is partial ('unavailable'); or the check didn't
 * include an AI review by design ('not_required' — today only the composer's local quick check;
 * every server-side check, interactive or send-time, includes the AI review).
 */
export const AI_REVIEW_STATUSES = ['reviewed', 'unavailable', 'not_required'] as const;
export type AiReviewStatus = (typeof AI_REVIEW_STATUSES)[number];

/** Full preflight outcome: the score, its band, and every finding that shaped it. */
export const PreflightResultObj = z.object({
  score: z.number(),
  band: z.enum(PREFLIGHT_BANDS),
  findings: z.array(PreflightFindingObj),
  /** SpamAssassin score from the Postmark spamcheck API, when that layer ran. */
  spamAssassinScore: z.number().nullable(),
  ai: AiPreflightVerdictObj.nullable(),
  aiStatus: z.enum(AI_REVIEW_STATUSES),
  checkedAt: z.string(),
});
export type PreflightResult = z.infer<typeof PreflightResultObj>;
````

## File: libs/common/src/lib/schemas/tasks.schema.ts
````typescript
import { z } from 'zod';
import { nameSchema, notesSchema, idSchema } from './core.schema';

/**
 * Canonical task status vocabulary (spec §4). This is the single source of truth —
 * every layer (DB check constraint, Zod schemas, backend queries, frontend board/list)
 * derives from this list. Do not hand-roll a parallel status array anywhere.
 *
 * `waiting` replaces the old `blocked` name (board column is "Waiting", with an
 * optional waiting-reason line on the card/row). `archived` absorbs the old `canceled`
 * state — a canceled task is, in practice, a task nobody is coming back to, which is
 * exactly what "archived" already means in this app (hidden from the active views,
 * reachable via the grid's Archived toggle). See the 2026-07-07 migration that
 * normalizes existing rows to this vocabulary.
 */
export const TASK_STATUSES = ['todo', 'in_progress', 'waiting', 'done', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The four board columns (spec §4) — `archived` sits outside the active workflow. */
export const TASK_BOARD_STATUSES = ['todo', 'in_progress', 'waiting', 'done'] as const;
export type TaskBoardStatus = (typeof TASK_BOARD_STATUSES)[number];

/** Statuses that count as "open" for SLA-breach and count-sentence purposes. */
export const TASK_OPEN_STATUSES = ['todo', 'in_progress', 'waiting'] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  waiting: 'Waiting',
  done: 'Done',
  archived: 'Archived',
};

/** Type guard — narrows an unknown/loosely-typed status string to the canonical vocabulary. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/** Type guard for the four board columns specifically (excludes `archived`). */
export function isTaskBoardStatus(value: unknown): value is TaskBoardStatus {
  return typeof value === 'string' && (TASK_BOARD_STATUSES as readonly string[]).includes(value);
}

const taskStatusEnum = z.enum(TASK_STATUSES);
const taskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);

export const AddTaskObj = z.object({
  name: nameSchema('Task name', 200),
  details: z.string().trim().max(10000, 'Details too long').optional(),
  due_at: z.preprocess((val) => (val === '' || val === null ? undefined : val), z.coerce.date().optional()),
  status: taskStatusEnum.default('todo').optional(),
  priority: taskPriorityEnum.optional(),
  completed_at: z.preprocess((val) => (val === '' || val === null ? undefined : val), z.coerce.date().optional()),
  position: z.number().int().optional(),
  assigned_to: idSchema.or(z.literal('')).nullable().optional(),
  team_id: idSchema.or(z.literal('')).nullable().optional(),
  person_id: idSchema.or(z.literal('')).nullable().optional(),
});

export const TasksObj = z.object({
  id: z.string(),
  name: z.string(),
  details: z.string().optional(),
  due_at: z.coerce.date().optional(),
  status: taskStatusEnum.nullable().optional(),
  priority: taskPriorityEnum.nullable().optional(),
  completed_at: z.coerce.date().optional(),
  position: z.number().int().optional(),
  assigned_to: z.string().nullable().optional(),
  team_id: z.string().nullable().optional(),
  person_id: z.string().nullable().optional(),
});

export const UpdateTaskObj = z.object({
  name: nameSchema('Task name', 200).optional(),
  details: notesSchema,
  due_at: z.preprocess((val) => (val === '' || val === null ? undefined : val), z.coerce.date().optional()),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  completed_at: z.preprocess((val) => (val === '' || val === null ? undefined : val), z.coerce.date().optional()),
  position: z.number().int().optional(),
  assigned_to: idSchema.or(z.literal('')).nullable().optional(),
  team_id: idSchema.or(z.literal('')).nullable().optional(),
  person_id: idSchema.or(z.literal('')).nullable().optional(),
});

/**
 * Board drag-and-drop persistence (spec §4). One drop touches one or two board
 * columns: dragging within a column re-seats that single column; dragging across
 * two columns re-seats the source and target. Each column lists its cards in the
 * new top-to-bottom order — the backend writes `position = index` per id and sets
 * every id's `status` to its column, all in one transaction. `archived` is not a
 * board column, so only the four `TASK_BOARD_STATUSES` are accepted.
 */
export const ReorderTasksObj = z.object({
  columns: z
    .array(
      z.object({
        status: z.enum(TASK_BOARD_STATUSES),
        ids: z.array(idSchema).min(1, 'A column must list at least one task').max(1000, 'Too many tasks in one column'),
      }),
    )
    .min(1, 'At least one column is required')
    .max(2, 'A single drop touches at most two columns'),
});

/** Subtask drag-to-reorder (task detail): the full ordered id list for one task. */
export const ReorderSubtasksObj = z.object({
  task_id: idSchema,
  ids: z.array(idSchema).min(1, 'At least one subtask is required').max(1000, 'Too many subtasks'),
});

export type ReorderTasksType = z.infer<typeof ReorderTasksObj>;
export type ReorderSubtasksType = z.infer<typeof ReorderSubtasksObj>;
````

## File: libs/common/src/lib/schemas/workflows.schema.ts
````typescript
import { z } from 'zod';
import { queryBuilderNodeSchema } from './core.schema';

// Spec §16 Automations — the trigger picker's cards. `volunteer_signup` is kept for
// backward compatibility with the pre-rebuild volunteer onboarding trigger (fired from the
// volunteer-events controller) but is not offered as a card. `date_arrives` stays in the
// enum for saved-row back-compat but has no picker card: no backend fires it yet, and a
// dead card is dishonest UI. `task_sla_breach` is fired by the hourly
// detect_task_sla_breaches cron (spec §4 → §16), which enrolls the breached task's linked
// person. `supporter_lapsed` is fired by the daily detect_lapsed_supporters cron; its
// trigger_event_id holds the inactivity threshold in days (default 90).
export const WORKFLOW_TRIGGER_TYPES = [
  'manual',
  'web_form_submitted',
  'contact_created',
  'tag_added',
  'list_joined',
  'donation_recorded',
  'payment_event',
  'volunteer_shift_status',
  'task_sla_breach',
  'new_subscriber',
  'new_unsubscriber',
  'supporter_lapsed',
  'date_arrives',
  'volunteer_signup',
] as const;

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

const triggerTypeSchema = z.enum(WORKFLOW_TRIGGER_TYPES);

// Spec §16 sequence editor — the five step kinds offered by the ADD A STEP menu.
export const WORKFLOW_STEP_KINDS = ['wait', 'send_email', 'add_tag', 'create_task', 'notify_team'] as const;

export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

const stepKindSchema = z.enum(WORKFLOW_STEP_KINDS);

// Engagement condition on a send_email step: gate the send on what the recipient did with the
// PREVIOUS email in this sequence (the industry-standard delay-then-check drip shape — pair it
// with a wait step so people have time to engage). Absent/null = always send. A click also
// stamps an open, so "not opened" implies "not clicked" was true as well.
export const WORKFLOW_SEND_CONDITIONS = [
  'previous_not_opened',
  'previous_not_clicked',
  'previous_opened',
  'previous_clicked',
] as const;

export type WorkflowSendCondition = (typeof WORKFLOW_SEND_CONDITIONS)[number];

// Sequence-level goals: an enrollment ends early ('exited') the moment one is met. Evaluated
// each time the enrollment comes due, before any step runs.
export const WORKFLOW_EXIT_CONDITIONS = ['donated', 'opened_any_email', 'clicked_any_email'] as const;

export type WorkflowExitCondition = (typeof WORKFLOW_EXIT_CONDITIONS)[number];

// Per-kind config payload (persisted to workflow_steps.config as jsonb). Every field is optional
// at the schema boundary; the controller maps each kind's meaningful fields when executing.
export const WorkflowStepConfigObj = z
  .object({
    // add_tag
    tag_id: z.string().nullable().optional(),
    tag_name: z.string().nullable().optional(),
    // create_task
    task_title: z.string().nullable().optional(),
    // notify_team
    notify_user_id: z.string().nullable().optional(),
    notify_user_name: z.string().nullable().optional(),
    notify_message: z.string().nullable().optional(),
    // send_email
    send_condition: z.enum(WORKFLOW_SEND_CONDITIONS).nullable().optional(),
  })
  .strict();

export type WorkflowStepConfigType = z.infer<typeof WorkflowStepConfigObj>;

export const WorkflowObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  trigger_type: triggerTypeSchema.default('manual'),
  trigger_event_id: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
  conditions: queryBuilderNodeSchema.nullable().optional(),
  exit_conditions: z.array(z.enum(WORKFLOW_EXIT_CONDITIONS)).nullable().optional(),
  createdby_id: z.string(),
  updatedby_id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const AddWorkflowObj = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().nullable().optional(),
  trigger_type: triggerTypeSchema.default('manual'),
  trigger_event_id: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused']).default('draft').optional(),
  conditions: queryBuilderNodeSchema.nullable().optional(),
  exit_conditions: z.array(z.enum(WORKFLOW_EXIT_CONDITIONS)).nullable().optional(),
});

export const UpdateWorkflowObj = AddWorkflowObj.partial();

export type AddWorkflowType = z.infer<typeof AddWorkflowObj>;
export type UpdateWorkflowType = z.infer<typeof UpdateWorkflowObj>;

export const WorkflowStepObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  step_number: z.number().int().positive(),
  kind: stepKindSchema,
  config: WorkflowStepConfigObj.nullable().optional(),
  delay_days: z.number().int().nonnegative(),
  delay_unit: z.enum(['days', 'hours']).default('days'),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

// Input shape for saveSteps — order is implied by array position, so no step_number here.
export const AddWorkflowStepObj = z.object({
  kind: stepKindSchema,
  config: WorkflowStepConfigObj.nullable().optional(),
  delay_days: z.number().int().nonnegative().default(0),
  delay_unit: z.enum(['days', 'hours']).default('days'),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
});

export const UpdateWorkflowStepObj = AddWorkflowStepObj.partial();

export type AddWorkflowStepType = z.infer<typeof AddWorkflowStepObj>;
export type UpdateWorkflowStepType = z.infer<typeof UpdateWorkflowStepObj>;

export const WorkflowEnrollmentObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  person_id: z.string(),
  status: z.enum(['active', 'completed', 'cancelled', 'exited']).default('active'),
  current_step_number: z.number().int().nonnegative(),
  next_run_at: z.coerce.date().nullable().optional(),
  enrolled_at: z.coerce.date(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const WorkflowRunObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  enrollment_id: z.string().nullable().optional(),
  person_id: z.string().nullable().optional(),
  step_number: z.number().int().nullable().optional(),
  step_kind: z.string().nullable().optional(),
  status: z.enum(['success', 'failed', 'skipped']),
  error: z.string().nullable().optional(),
  opened_at: z.coerce.date().nullable().optional(),
  clicked_at: z.coerce.date().nullable().optional(),
  created_at: z.coerce.date(),
});

export type WorkflowRunType = z.infer<typeof WorkflowRunObj>;
````

## File: libs/common/src/lib/schema.ts
````typescript
export * from './schemas/core.schema';
export * from './schemas/activity.schema';
export * from './schemas/auth.schema';
export * from './schemas/tags.schema';
export * from './schemas/lists.schema';
export * from './schemas/teams.schema';
export * from './schemas/emails.schema';
export * from './schemas/marketing.schema';
export * from './schemas/newsletter-templates.schema';
export * from './schemas/persons.schema';
export * from './schemas/settings.schema';
export * from './schemas/tasks.schema';
export * from './schemas/volunteer.schema';
export * from './schemas/web-forms.schema';
export * from './schemas/workflows.schema';
export * from './schemas/companies.schema';
export * from './schemas/events.schema';
export * from './schemas/connections.schema';
export * from './schemas/campaigns.schema';
export * from './schemas/canvassing.schema';
export * from './schemas/deliveries.schema';
export * from './schemas/donations.schema';
export * from './schemas/companion-access.schema';
export * from './schemas/bug-reports.schema';
export * from './schemas/content-check.schema';
````

## File: libs/uxcommon/src/components/detail-header/detail-header.ts
````typescript
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

import { PcBreadcrumb } from '../breadcrumbs/breadcrumbs';
import { BreadcrumbsService } from '../breadcrumbs/breadcrumbs.service';
import { FormActions } from '../form-actions/form-actions';

/** Below Tailwind `sm` (640px) the header stacks and has no room for inline action buttons. */
const MOBILE_ACTIONS_QUERY = '(max-width: 639.98px)';

@Component({
  selector: 'pc-detail-header',
  imports: [Icon, FormActions, NgTemplateOutlet],
  template: `
    <div class="flex flex-col gap-2 rounded-xl border border-base-200 bg-base-100 p-5 shadow-sm">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-center gap-3">
          @if (avatarText()) {
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
              aria-hidden="true"
              >{{ avatarText() }}</span
            >
          } @else if (icon()) {
            <pc-icon [name]="icon()!" class="text-primary" [size]="iconSize()"></pc-icon>
          }
          <div class="min-w-0">
            @if (eyebrow()) {
              <p class="pc-eyebrow">{{ eyebrow() }}</p>
            }
            <div class="flex min-w-0 items-center gap-2">
              <h1 class="truncate text-xl font-bold">{{ title() }}</h1>
              @if (statusChip()) {
                <span
                  class="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success whitespace-nowrap"
                  >{{ statusChip() }}</span
                >
              }
              <!-- Tone-colored badges the fixed success statusChip can't express (e.g. pc-status-badge) -->
              <ng-content select="[pc-title-suffix]"></ng-content>
            </div>
            @if (dirtyFieldCount() > 0) {
              <p class="mt-0.5 flex items-center gap-1.5 text-sm text-warning">
                <span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true"></span>
                Unsaved changes · {{ dirtyFieldCount() }} field{{ dirtyFieldCount() === 1 ? '' : 's' }}
              </p>
            } @else if (subtitle()) {
              <p class="mt-0.5 text-sm text-base-content/60">{{ subtitle() }}</p>
            }
          </div>
        </div>

        <!-- justify-end below sm keeps the ⋮ trigger on the right so its menu opens on-screen -->
        <div class="flex items-center gap-2 max-sm:justify-end">
          <!-- "N of M filtered" walk-the-list pager — lives in the header card (design source),
               so J/K navigation is visible next to the actions. Self-hides with no grid context. -->
          @if (positionLabel()) {
            <div class="mr-1 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                class="btn btn-circle btn-ghost btn-xs"
                [attr.aria-label]="prevLabel()"
                [disabled]="!hasPrev()"
                [class.btn-ghost]="!hasPrev()"
                (click)="prevRecord.emit()"
              >
                <pc-icon name="chevron-left" [size]="4"></pc-icon>
              </button>
              <span class="whitespace-nowrap px-1 text-xs tabular-nums text-base-content/50">{{
                positionLabel()
              }}</span>
              <button
                type="button"
                class="btn btn-circle btn-xs"
                [attr.aria-label]="nextLabel()"
                [disabled]="!hasNext()"
                [class.btn-ghost]="!hasNext()"
                (click)="nextRecord.emit()"
              >
                <pc-icon name="chevron-right" [size]="4"></pc-icon>
              </button>
            </div>
          }
          <!-- Single source for the action cluster: stamped inline on ≥sm, or inside
               the overflow menu on mobile where the header has no room for buttons.
               includeForm lets the mobile branch pull pc-form-actions OUT of the menu:
               Save/Cancel must stay visible (§2 — never hide the critical path). -->
          <ng-template #actionCluster let-includeForm="includeForm">
            <ng-content select="[pc-actions-prefix]"></ng-content>
            @if (includeForm && showActions()) {
              <pc-form-actions
                size="sm"
                [isLoading]="isLoading()"
                [signalForm]="form()"
                [disabled]="disabled()"
                [saveAlwaysEnabled]="saveAlwaysEnabled()"
                [buttonsToShow]="formActionsButtons()"
                [btn1Text]="btn1Text()"
                [btn1Icon]="btn1Icon()"
                [showDelete]="false"
                [showCancel]="showCancel()"
                (btn1Clicked)="save.emit($event)"
              ></pc-form-actions>
            }
            <ng-content select="[pc-actions-suffix]"></ng-content>
          </ng-template>

          @if (!isMobile()) {
            <ng-container [ngTemplateOutlet]="actionCluster" [ngTemplateOutletContext]="{ includeForm: true }" />
          } @else if (showActions()) {
            <!-- Mobile: Save/Cancel stay inline — a user must never have to discover
                 the overflow menu to save their edits. -->
            <pc-form-actions
              size="sm"
              [isLoading]="isLoading()"
              [signalForm]="form()"
              [disabled]="disabled()"
              [saveAlwaysEnabled]="saveAlwaysEnabled()"
              [buttonsToShow]="formActionsButtons()"
              [btn1Text]="btn1Text()"
              [btn1Icon]="btn1Icon()"
              [showDelete]="false"
              [showCancel]="showCancel()"
              (btn1Clicked)="save.emit($event)"
            ></pc-form-actions>
          }
          @if (isMobile() || showDelete()) {
            <!-- Self-hides when the menu would be empty (a page with no actions at all). -->
            <div class="dropdown dropdown-end [&:not(:has(.dropdown-content_li,.dropdown-content_.btn))]:hidden">
              @if (isMobile()) {
                <!-- Labeled trigger on phones: a bare ⋮ does not read as a menu. -->
                <button
                  type="button"
                  tabindex="0"
                  class="btn btn-outline btn-secondary btn-sm gap-1"
                  aria-label="More actions"
                >
                  <pc-icon name="ellipsis-vertical" [size]="4"></pc-icon>
                  Actions
                </button>
              } @else {
                <button type="button" tabindex="0" class="btn btn-circle btn-ghost btn-sm" aria-label="More actions">
                  <pc-icon name="ellipsis-vertical" [size]="5"></pc-icon>
                </button>
              }
              <div
                tabindex="0"
                class="dropdown-content pc-dropdown-sheet z-30 border border-base-200 bg-base-100 p-2 shadow-lg sm:w-56 sm:rounded-box"
              >
                @if (isMobile()) {
                  <!-- The inline action cluster, restacked as full-width rows. The div[…] rules
                       unroll pages' own row wrappers (e.g. <div pc-actions-suffix class="flex …">).
                       min-h-11 + text-sm match the 44px/14px menu rows below so the sheet reads
                       as one action sheet, not a pile of toolbar buttons. -->
                  <div
                    class="flex flex-col items-stretch gap-2 empty:hidden [&_.btn]:w-full [&_.btn]:justify-start [&_.btn]:min-h-11 [&_.btn]:text-sm [&_.dropdown]:w-full [&_pc-form-actions>div]:flex-col [&_div[pc-actions-prefix]]:flex-col [&_div[pc-actions-prefix]]:items-stretch [&_div[pc-actions-suffix]]:flex-col [&_div[pc-actions-suffix]]:items-stretch"
                  >
                    <ng-container
                      [ngTemplateOutlet]="actionCluster"
                      [ngTemplateOutletContext]="{ includeForm: false }"
                    />
                  </div>
                }
                <ul class="menu w-full p-0 max-sm:mt-1 max-sm:border-t max-sm:border-base-200 max-sm:pt-1">
                  <!-- Page-supplied overflow items (e.g. Export vCard, Merge…) render above Delete (§3) -->
                  <ng-content select="[pc-overflow-extra]"></ng-content>
                  @if (showDelete()) {
                    <li>
                      <button type="button" class="text-error" [disabled]="isLoading()" (click)="delete.emit()">
                        <pc-icon name="trash" [size]="4"></pc-icon>
                        {{ deleteText() }}
                      </button>
                    </li>
                  }
                </ul>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class DetailHeader {
  private readonly breadcrumbs = inject(BreadcrumbsService);

  public readonly delete = output<void>();
  public readonly save = output<any>();
  public readonly prevRecord = output<void>();
  public readonly nextRecord = output<void>();

  public btn1Icon = input<PcIconNameType>('save');
  public btn1Text = input<string>('Save');
  public buttonsToShow = input<'two' | 'three'>('three');
  public crumbs = input<PcBreadcrumb[]>([]);
  public deleteText = input<string>('Delete');
  public disabled = input<boolean>(false);
  /** §4: keep the primary button enabled regardless of validity/dirtiness. */
  public saveAlwaysEnabled = input<boolean>(false);
  public eyebrow = input<string>('');
  /** Optional success-tinted status chip beside the title, e.g. "Monthly donor" (§3). */
  public statusChip = input<string | null>(null);
  public form = input<any>();
  public icon = input<PcIconNameType | null | undefined>();
  public iconSize = input<number>(5);
  /** Optional initials shown in a circular avatar left of the title (e.g. "JB"). Takes precedence over icon(). */
  public avatarText = input<string | null>(null);
  public isLoading = input.required<boolean>();
  public showActions = input<boolean>(true);
  public showDelete = input<boolean>(false);
  /** Forwarded to form-actions. Defaults on for edit forms (used directly);
   * detail-layout overrides it to false for read views. */
  public showCancel = input<boolean>(true);
  public subtitle = input<string | null | undefined>();
  public title = input.required<string>();

  /** Optional "N of M filtered" pager, rendered inline with the breadcrumb trail. */
  public positionLabel = input<string | null>(null);
  public hasPrev = input<boolean>(false);
  public hasNext = input<boolean>(false);
  public prevLabel = input<string>('Previous record');
  public nextLabel = input<string>('Next record');

  /** When > 0, replaces the subtitle with an amber "Unsaved changes · N fields" line. */
  public dirtyFieldCount = input<number>(0);

  // Delete moved to the overflow menu. Suppressing the third button whenever
  // Delete is offered preserves the layout form-actions previously produced
  // when it rendered the Delete button inline.
  protected readonly formActionsButtons = computed<'two' | 'three'>(() =>
    this.showDelete() ? 'two' : this.buttonsToShow(),
  );

  /** True below Tailwind `sm`: the action cluster collapses into the overflow menu. */
  protected readonly isMobile = signal(false);

  constructor() {
    // The breadcrumb trail renders in the navbar; the record pager now lives in
    // this header card (design source), so publish the trail only and leave the
    // navbar pager empty to avoid a duplicate. Clear on destroy so the strip
    // empties when navigating to a page (e.g. a grid) that owns no trail.
    effect(() => {
      this.breadcrumbs.set({
        crumbs: this.crumbs(),
        positionLabel: null,
        hasPrev: false,
        hasNext: false,
        prevLabel: this.prevLabel(),
        nextLabel: this.nextLabel(),
        onPrev: () => this.prevRecord.emit(),
        onNext: () => this.nextRecord.emit(),
      });
    });

    const destroyRef = inject(DestroyRef);

    // matchMedia is guarded for non-browser test environments; without it the
    // header stays in the desktop (inline actions) layout.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia(MOBILE_ACTIONS_QUERY);
      this.isMobile.set(mediaQuery.matches);
      const onChange = (event: MediaQueryListEvent): void => this.isMobile.set(event.matches);
      mediaQuery.addEventListener('change', onChange);
      destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onChange));
    }

    destroyRef.onDestroy(() => this.breadcrumbs.clear());
  }
}
````

## File: libs/uxcommon/src/components/row-actions/row-actions.ts
````typescript
import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';

import { Icon } from '../icons/icon';

/** Feeds the unique `id`/`anchor-name` pair each instance needs to anchor its popover. */
let nextRowActionsId = 0;

/**
 * `pc-row-actions` — the house ⋯ overflow menu for a table row.
 *
 * The one idiom for per-row actions (design principles §4: destructive actions are
 * demoted to the ⋯ menu). Before this existed, five pages hand-rolled the same
 * DaisyUI dropdown and drifted apart on width, z-index, trigger element and border.
 *
 * It renders as a **popover-mode DaisyUI dropdown**: the menu carries the native
 * `popover` attribute, so an open menu is promoted to the browser's top layer and
 * placed against the trigger via CSS anchor positioning (`anchor-name` on the
 * button, `position-anchor` on the menu). This is what makes it usable inside a
 * table at all — `.pc-table-shell` sets `overflow-x: auto`, which per spec forces
 * `overflow-y: auto` too, so a normal absolutely-positioned `.dropdown-content` is
 * clipped by the shell's scroll box. No z-index can defeat ancestor clipping; only
 * leaving the shell's clipping context can, and the top layer does exactly that.
 *
 * Everything else — placement, open/close, Esc, light-dismiss, focus — is the
 * platform's (design §6, rung 1: DaisyUI + CSS, no JS positioning). The only
 * TypeScript here is the one bit of genuine state logic: closing the menu after an
 * action is chosen.
 *
 * Browsers without CSS anchor positioning (Safari < 26, Firefox < 144) fall back to
 * DaisyUI's own centered top-layer menu with a backdrop — unanchored, but never
 * clipped or truncated.
 *
 * Projected content is the menu body: `<li>` items, exactly as DaisyUI's `menu`
 * expects. Keep destructive items last and mark them `class="text-error"`.
 *
 * ```html
 * <td class="text-right">
 *   <pc-row-actions label="Route actions">
 *     <li><button type="button" (click)="openAssign(row)">Assign volunteer</button></li>
 *     <li><button type="button" class="text-error" (click)="deleteRoute(row)">Delete route</button></li>
 *   </pc-row-actions>
 * </td>
 * ```
 */
@Component({
  selector: 'pc-row-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-circle"
      [attr.popovertarget]="menuId"
      [style.anchor-name]="anchorName"
      [attr.aria-label]="label()"
    >
      <pc-icon name="ellipsis-vertical" [size]="4" />
    </button>

    <!-- popover promotes the open menu to the top layer, escaping the table
         shell's scroll box; position-anchor pins it back to the button. -->
    <ul
      #menu
      popover
      [id]="menuId"
      [style.position-anchor]="anchorName"
      class="dropdown dropdown-end pc-dropdown-sheet menu sm:w-56 sm:rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
      (click)="closeMenu()"
    >
      <ng-content></ng-content>
    </ul>
  `,
  styles: `
    :host {
      display: inline-block;
    }

    /* Near the bottom of the viewport, drop the menu above the trigger instead of
       off-screen. position-area alone does not reposition itself. Scoped to sm+
       because below sm the menu is a pc-dropdown-sheet, and this unlayered
       component style would otherwise beat the utility's fallback reset. */
    @media (width >= 40rem) {
      ul[popover] {
        position-try-fallbacks: flip-block;
      }
    }
  `,
})
export class RowActions {
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  protected readonly anchorName = `--pc-row-actions-${nextRowActionsId}`;
  protected readonly menuId = `pc-row-actions-${nextRowActionsId++}`;

  /** Accessible name for the ⋯ trigger. Name the record where you can: "Actions for Amira Hassan". */
  public readonly label = input<string>('Row actions');

  /**
   * Dismiss once an item is chosen. `popover="auto"` light-dismisses on outside
   * clicks and Esc, but a click *inside* the menu is not a dismissal to the
   * platform — and every item here is a terminal action, so it is to us.
   */
  protected closeMenu(): void {
    this.menu().nativeElement.hidePopover();
  }
}
````

## File: libs/common/src/lib/help/articles/getting-started.ts
````typescript
import type { HelpArticle } from '../help-types';

export const GETTING_STARTED_ARTICLES: HelpArticle[] = [
  {
    id: 'welcome',
    category: 'getting-started',
    title: 'Welcome to pplCRM',
    summary: 'What pplCRM is for and a five-minute tour of the main areas.',
    keywords: ['introduction', 'overview', 'tour', 'start', 'basics', 'new user', 'onboarding'],
    related: ['demo-mode', 'getting-around', 'add-people', 'grid-basics'],
    blocks: [
      {
        kind: 'p',
        text: 'pplCRM keeps every relationship your organization cares about (supporters, donors, volunteers, households, and companies) in one place, together with the conversations, donations, events, and tasks attached to them.',
      },
      { kind: 'h2', id: 'sidebar-map', text: 'The sidebar, section by section' },
      {
        kind: 'list',
        items: [
          '**Dashboard**: your landing page, with key numbers and service-level health at a glance. See [The dashboard and SLA health](/help/dashboard).',
          '**Work**: [Inbox](/inbox) for incoming email, [Tasks](/tasks) (the board lives at [/tasks/board](/tasks/board)), and [People](/people). People, Households, and Companies are three views of the same contacts; tabs under the People header switch between them.',
          '**Outreach**: [Newsletters](/newsletters) for outbound campaigns, [Lists](/lists) for reusable audiences, [Donations](/donations), and public-facing [Forms](/forms) (fundraising forms, event pages, and volunteer shifts are all created from here too).',
          '**Field**: [Canvassing](/canvassing), [Deliveries](/deliveries), and [Teams](/teams).',
          '**Data**: [Import / export](/imports) (Imports and Exports tabs, plus the CSV import wizard), the [Duplicates](/duplicates) finder, [Tags](/tags), [Issues](/issues), and [Automations](/automations).',
          '**Admin** (administrators only): [Users](/users), the [Activity log](/activity), the [Workspace](/workspace) settings, and this [Help center](/help).',
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Not seeing a section?',
        text: 'The Admin section only appears for administrators. If you need access to users or configuration, ask a workspace admin. See [Users and roles](/help/users-roles).',
      },
      { kind: 'h2', id: 'first-steps', text: 'A good first session' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [People](/people)',
            detail:
              'This grid is the heart of the app. Add a person with the + button, or bring your existing data in via [Import data from CSV](/help/import).',
          },
          {
            title: 'Open a profile',
            detail:
              'Click the name in the first column to see everything about one person: activity, emails, newsletters, donations, events, and volunteer history.',
          },
          {
            title: 'Organize with tags and lists',
            detail:
              'Tags describe people; lists group them for action. See [Tags and issues](/help/tags-issues) and [Static and dynamic lists](/help/lists).',
          },
          {
            title: 'Send your first newsletter',
            detail:
              'Pick a template, choose an audience, and send. [Create and send a newsletter](/help/newsletters) walks through it.',
          },
        ],
      },
      {
        kind: 'p',
        text: 'Every page in this help center is searchable. Head back to [Help](/help) and start typing.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Your workspace starts in demo mode',
        text: 'New workspaces come pre-loaded with realistic sample contacts so every page has something to show. See [Demo mode and sample data](/help/demo-mode) for what is included and how to clear it.',
      },
    ],
  },
  {
    id: 'demo-mode',
    category: 'getting-started',
    title: 'Demo mode and sample data',
    summary: 'What the pre-loaded demo data includes, why it exists, and how to remove it when you are ready.',
    keywords: ['demo', 'sample data', 'test drive', 'seed', 'exit demo', 'remove demo data', 'example contacts'],
    related: ['welcome', 'add-people', 'import'],
    blocks: [
      {
        kind: 'p',
        text: 'Every new workspace starts in **demo mode**: it is pre-loaded with a realistic, fully connected sample dataset so you can try every part of pplCRM before adding your own contacts. A banner at the top of the app reminds you that you are looking at demo data, and the [Dashboard](/dashboard) shows a demo-mode card with the exit button.',
      },
      { kind: 'h2', id: 'whats-included', text: 'What the demo data includes' },
      {
        kind: 'list',
        items: [
          '**60 people in 24 households** with real Ottawa street addresses, so the household map pins, geocoding chips, and ward-based canvassing turfs all work.',
          '**10 companies**, with several people linked to them.',
          '**Tags, issues, support levels, and newsletter consent** spread across the contacts, plus three lists, a team, and two volunteer events with sign-ups.',
          '**Canvassing turfs** cut across the wards (one complete, one being knocked right now, one just assigned, and one still a draft) with real door knocks so the field report and coverage map have something to show.',
          '**Yard-sign deliveries**: sign requests waiting to be triaged, approved requests ready to route, and two driving routes (one finished, one in progress) so the requests, planner, and routes pages are all populated.',
          '**Three demo teammates** on the [Users](/users) page, with tasks and inbox emails assigned to them. They cannot sign in; their accounts exist so assignment and triage look real.',
          '**Tasks** in every state: overdue, due this week, waiting, and done.',
          '**A working inbox**: a handful of emails from demo contacts, some open, some closed, some assigned.',
          '**Three newsletters**, including a sent one with a full engagement report: opens over time, top links, bounces, and unsubscribes.',
          '**Sample form responses** on two of the starter forms, so the Forms page shows what collected submissions look like.',
          '**A donations ledger**: recorded one-time gifts across this month and last, plus a few active monthly pledges, so the [Donations](/donations) page shows real totals and trends. The two fundraising forms live on that page too, not on the Forms page.',
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Why draft forms show responses',
        text: 'The six starter forms are drafts (a draft form does not accept new submissions), but two of them carry sample responses so you can see how submissions appear. Publishing a form gives it a live public link. See [Forms](/help/forms).',
      },
      { kind: 'h2', id: 'safe-to-touch', text: 'Everything is safe to touch' },
      {
        kind: 'p',
        text: 'The demo contacts use reserved example.com addresses that cannot receive real email, so nothing you do here can reach a real person. Edit, delete, merge, tag, and explore freely.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'What stays locked during the demo',
        text: 'Demo mode is the free test drive before you pick a plan, so outward-facing setup is disabled: sending newsletters, inviting teammates on the [Users](/users) page, verifying sender emails and domains, connecting a mailbox, and connecting a Stripe account for donations. Everything else works, including workspace settings; update your organization details, service levels, and defaults at any time and they carry over when you exit the demo. Choose a plan on the [Billing](/workspace/billing) page to unlock the rest.',
      },
      { kind: 'h2', id: 'exit', text: 'Exiting demo mode' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Choose a plan',
            detail:
              'Exiting the demo requires an active subscription. Pick one on the [Billing](/workspace/billing) page.',
          },
          { title: 'Open the [Dashboard](/dashboard)', detail: 'The demo-mode card sits at the top of the page.' },
          {
            title: 'Choose Exit demo mode',
            detail: 'A confirmation explains exactly what will be removed. This cannot be undone.',
          },
          {
            title: 'Start fresh',
            detail:
              'A Getting started checklist appears on the [Dashboard](/dashboard) once the demo is gone. Add your first real contact on [People](/people) or bring everything in at once with [Import data from CSV](/help/import).',
          },
        ],
      },
      { kind: 'h2', id: 'what-stays', text: 'What is kept' },
      {
        kind: 'list',
        items: [
          '**Your six draft forms**: volunteer signup, newsletter sign-up, one-time and recurring donations, yard sign request, and the issues survey. Their sample responses are removed with the demo people.',
          '**The starter tags and issues**: the tag labels (community leader, lawn sign location, and so on) and the issues list stay as a ready-made vocabulary for your real contacts. They lose their demo attachments and are fully yours to rename, recolor, merge, or delete on the [Tags](/tags) and [Issues](/issues) pages.',
          '**Anything you created yourself** while exploring: your own contacts, tasks, notes, and settings survive. A contact you added to a demo household keeps its record; it just loses that address. Tags you applied to your own contacts stay applied.',
        ],
      },
    ],
  },
  {
    id: 'getting-around',
    category: 'getting-started',
    title: 'Finding your way around',
    summary:
      'Breadcrumbs, record-to-record navigation, pinned pages, themes, and the other navigation habits worth learning early.',
    keywords: [
      'navigation',
      'breadcrumbs',
      'sidebar',
      'pins',
      'bookmarks',
      'favourites',
      'favorites',
      'theme',
      'dark mode',
      'fullscreen',
      'next record',
      'previous record',
    ],
    related: ['welcome', 'search', 'shortcuts'],
    blocks: [
      { kind: 'h2', id: 'orientation', text: 'Always know where you are' },
      {
        kind: 'p',
        text: 'Every page shows a breadcrumb trail in the top bar. The bold first crumb is the page title (for example **People**, or **People / Amira Hassan** on a record). On a record, the first crumb takes you back to the grid you came from, with your filters, page, and scroll position exactly as you left them. On tabbed pages like Import / export, the trail follows the tab you have open.',
      },
      {
        kind: 'p',
        text: 'When you open a record from a grid, the header also shows your position in the filtered set (“4 of 43 filtered”) with previous/next arrows. Press `K` and `J` to move between records without going back to the grid.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'No pager on a record?',
        text: 'The position label and J/K keys only appear when you arrived from a grid. If you opened the record from a direct link, there is no filtered set to step through.',
      },
      { kind: 'h2', id: 'pins', text: 'Pin the pages you live in' },
      {
        kind: 'p',
        text: 'The bookmark icon in the top bar pins the main page you are on (a grid like People, or the dashboard) to a Pins section at the top of the sidebar. Click it again to unpin. On a record page the pin button explains that only main pages can be pinned; open the section itself to pin it.',
      },
      { kind: 'h2', id: 'sidebar-habits', text: 'Tune the sidebar' },
      {
        kind: 'list',
        items: [
          'Collapse any section by clicking its heading (useful for areas you rarely use). Collapsing applies to the full-width sidebar only; the icon-only rail always shows every icon.',
          'On a narrow window the sidebar shrinks to an icon-only rail and the expand control is hidden; hover an icon to see its name. Widen the window past roughly 1024px to get the labels and the toggle back.',
          'On a phone the sidebar tucks away: tap the ☰ menu button in the top-left to slide it open, and tap it again (now an ✕) to close.',
          'The logo takes you back to the [Dashboard](/dashboard) from anywhere.',
          'Jump without the mouse: press `g` then a section letter (the hints appear beside the items). Press `?` anytime for the full list. See [Keyboard shortcuts](/help/shortcuts).',
        ],
      },
      { kind: 'h2', id: 'appearance', text: 'Theme and focus' },
      {
        kind: 'list',
        items: [
          'Toggle light or dark theme with the sun/moon button in the top bar. Administrators can set the workspace default under **Workspace → Appearance**.',
          'The arrows button in the top bar switches full-screen mode on and off when you want the grid to use every pixel.',
        ],
      },
    ],
  },
  {
    id: 'search',
    category: 'getting-started',
    title: 'Search with ⌘K',
    summary: 'The top-bar search filters the page you are on as you type. Here is how to get the most from it.',
    keywords: ['search', 'find', 'command k', 'cmd k', 'ctrl k', 'quick find', 'filter text'],
    related: ['filters', 'shortcuts', 'grid-basics'],
    blocks: [
      {
        kind: 'p',
        text: 'Press `⌘K` (or `Ctrl K` on Windows and Linux), or click the magnifying glass in the top bar, and start typing. Search applies to the view you are on: in a grid like [People](/people), rows narrow live as you type.',
      },
      {
        kind: 'list',
        items: [
          'Results update a moment after you stop typing; press `Enter` to apply the search immediately.',
          'Search is case-insensitive and ignores extra spaces.',
          'Clear the search box to bring every row back.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Search and filters stack',
        text: 'Text search combines with any tag, issue, or list filters you have applied. The grid states how many rows match the combination, so you always know what you are looking at.',
      },
      {
        kind: 'p',
        text: 'There is also a command palette on `⌘⇧K` for jumping around by keyboard, and `g`-then-a-letter chords for the sidebar sections. The full map is in [Keyboard shortcuts](/help/shortcuts).',
      },
      {
        kind: 'p',
        text: 'Need something more precise than text matching (say, everyone in a city with a certain tag)? Use the grid filters and the query builder instead: [Filters and the query builder](/help/filters).',
      },
    ],
  },
  {
    id: 'dashboard',
    category: 'getting-started',
    title: 'The dashboard and SLA health',
    summary:
      'What the numbers and status indicators on your landing page mean, and where to change the thresholds behind them.',
    keywords: ['dashboard', 'summary', 'sla', 'service level', 'metrics', 'stats', 'health', 'warning', 'critical'],
    related: ['welcome', 'inbox', 'tasks', 'settings'],
    blocks: [
      {
        kind: 'p',
        text: 'The [Dashboard](/dashboard) is your daily starting point. A one-line **briefing** at the top names what needs you right now (unassigned conversations, tasks past SLA, new contacts this month, and any newsletter draft), and every number in it is a link straight to that work.',
      },
      {
        kind: 'list',
        items: [
          '**Next-action cards**: the three cards below the briefing surface your most urgent queues (task-SLA breaches, conversations waiting for an owner, and a draft newsletter ready to send). A card turns quiet when there is nothing to do there.',
          '**Stat tiles**: a row of headline numbers (open emails, unassigned, average first response and time to close, contact growth). Use **Reload stats** to refresh them.',
          '**New contacts** and **Coming up**: a 30-day growth chart beside your upcoming events. Empty states link you to the next step when there is nothing scheduled yet.',
          '**Representative performance**: a quiet table of each teammate’s open/closed counts, resolution rate, and SLA breaches.',
        ],
      },
      { kind: 'h2', id: 'sla', text: 'How SLA status works' },
      {
        kind: 'p',
        text: 'A service-level agreement (SLA) is a promise about response time: for example, “reply to every inbox email within 24 working hours” or “close tasks within 24 working hours”. The dashboard tracks open items against those targets and rolls them up into a status.',
      },
      {
        kind: 'list',
        items: [
          '**On track**: no open items have exceeded their target.',
          '**Warning**: the number of breached items has reached the warning threshold.',
          '**Critical**: breaches have reached the critical threshold and need attention now.',
        ],
      },
      {
        kind: 'p',
        text: 'Targets count **working hours only**. Administrators define working days, business hours, the hour targets, and both thresholds under **Workspace → Service levels**. See [Settings and configuration](/help/settings).',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Chase the cause, not the number',
        text: 'A warning status is a queue, not a verdict: open the [Inbox](/inbox) or [Tasks](/tasks) and work the oldest items first. Those are the ones breaching.',
      },
    ],
  },
  {
    id: 'shortcuts',
    category: 'getting-started',
    title: 'Keyboard shortcuts',
    summary: 'Every keyboard shortcut in pplCRM on one page, plus the ? overlay that shows them anywhere.',
    keywords: [
      'keyboard',
      'shortcuts',
      'keys',
      'hotkeys',
      'productivity',
      'j',
      'k',
      'command k',
      'go to',
      'g then',
      'question mark',
      'palette',
    ],
    related: ['getting-around', 'search', 'inbox', 'grid-basics'],
    blocks: [
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Press ? anywhere',
        text: 'The `?` key opens a shortcuts overlay with this list, wherever you are (press `Esc` to close it). This article is the long-form version with context.',
      },
      { kind: 'h2', id: 'global', text: 'Anywhere' },
      {
        kind: 'keys',
        rows: [
          { keys: ['⌘', 'K'], action: 'Focus the search bar (Ctrl K on Windows and Linux)' },
          { keys: ['⌘', '⇧', 'K'], action: 'Open the command palette' },
          { keys: ['g'], action: 'Start a “go to” chord, then follow with a section key below' },
          { keys: ['?'], action: 'Show the shortcuts overlay' },
          { keys: ['Esc'], action: 'Close the open dialog or overlay' },
        ],
      },
      { kind: 'h2', id: 'go-to', text: 'Go to a section: g, then a letter' },
      {
        kind: 'p',
        text: 'Press `g`, then within a moment the letter for where you want to be. Shortcuts never fire while you are typing in a field, and the letters appear as hints beside the sidebar items.',
      },
      {
        kind: 'keys',
        rows: [
          { keys: ['g', 'h'], action: 'Dashboard (home)' },
          { keys: ['g', 'i'], action: '[Inbox](/inbox)' },
          { keys: ['g', 'n'], action: '[Newsletters](/newsletters)' },
          { keys: ['g', 'l'], action: '[Lists](/lists)' },
          { keys: ['g', 'a'], action: '[Automations](/automations)' },
          { keys: ['g', 'p'], action: '[People](/people)' },
          { keys: ['g', 'u'], action: '[Households](/households)' },
          { keys: ['g', 'c'], action: '[Companies](/companies)' },
          { keys: ['g', 'd'], action: '[Duplicates](/duplicates)' },
          { keys: ['g', 't'], action: '[Teams](/teams)' },
          { keys: ['g', 'o'], action: '[Donations](/donations)' },
          { keys: ['g', 'f'], action: '[Forms](/forms)' },
          { keys: ['g', 'k'], action: '[Tasks](/tasks)' },
          { keys: ['g', 'b'], action: '[Task board](/tasks/board)' },
        ],
      },
      { kind: 'h2', id: 'inbox-keys', text: 'In the inbox' },
      {
        kind: 'keys',
        rows: [
          { keys: ['c'], action: 'Compose' },
          { keys: ['r'], action: 'Reply' },
          { keys: ['a'], action: 'Reply all' },
          { keys: ['f'], action: 'Forward' },
          { keys: ['e'], action: 'Mark done' },
          { keys: ['s'], action: 'Star or unstar' },
          { keys: ['Shift', 'I'], action: 'Mark as read' },
          { keys: ['Shift', 'U'], action: 'Mark as unread' },
          { keys: ['#'], action: 'Delete' },
          { keys: ['J'], action: 'Next email' },
          { keys: ['K'], action: 'Previous email' },
          { keys: ['Enter'], action: 'Open or expand' },
          { keys: ['U'], action: 'Back to the list' },
        ],
      },
      { kind: 'h2', id: 'records', text: 'On a record page' },
      {
        kind: 'keys',
        rows: [
          { keys: ['J'], action: 'Next record in the filtered set you came from' },
          { keys: ['K'], action: 'Previous record in the filtered set' },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'When J and K are quiet',
        text: 'They only work when you opened the record from a grid (the “N of M filtered” pager is visible) and are ignored while you are typing in a field.',
      },
      { kind: 'h2', id: 'grid-editing', text: 'In a grid' },
      {
        kind: 'keys',
        rows: [
          { keys: ['↑', '↓', '←', '→'], action: 'Move between cells' },
          { keys: ['Enter'], action: 'Edit the focused cell (when the column allows editing)' },
        ],
      },
      {
        kind: 'p',
        text: 'You can also double-click any editable cell to start editing. More in [Working in grids](/help/grid-basics).',
      },
    ],
  },
  {
    id: 'report-a-bug',
    category: 'getting-started',
    title: 'Report a bug',
    summary: 'Send a problem report straight to the pplCRM team, with an optional screenshot.',
    keywords: ['bug', 'issue', 'problem', 'broken', 'error', 'crash', 'feedback', 'support', 'report'],
    related: ['welcome', 'getting-around', 'shortcuts'],
    blocks: [
      {
        kind: 'p',
        text: 'If something in pplCRM misbehaves, you can report it without leaving the app. Reports go straight to the pplCRM team.',
      },
      { kind: 'h2', id: 'open', text: 'Where to find it' },
      {
        kind: 'list',
        items: [
          '**Your avatar menu** (top right): choose **Report a bug**.',
          '**The command palette**: press **⌘⇧K** (Ctrl+Shift+K on Windows) and type "report".',
          '**This help center**: the "Something broken?" card at the bottom of the [Help](/help) home page.',
        ],
      },
      { kind: 'h2', id: 'what-to-write', text: 'What to include' },
      {
        kind: 'p',
        text: 'Describe what you did, what you expected, and what happened instead. You can attach one screenshot (an image up to 5 MB). Your current page and browser details are included automatically, so you do not need to copy them in.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Keep the reference code',
        text: 'After you send a report you get a reference like BR-42. Quote it if you follow up with support so we can find your report immediately.',
      },
    ],
  },
];
````

## File: libs/common/src/lib/billing/plans.ts
````typescript
/**
 * Subscription plans — the single source of truth for tiers, prices and limits.
 *
 * Consumed by:
 *  - backend enforcement  (modules/billing/usage-limits.ts, controller.ts, trpc.router.ts)
 *  - the CRM billing page (experiences/settings/billing)
 *  - the marketing website pricing page + home teaser
 *
 * Pricing model (decision log, 2026-07-14 — supersedes the flat-price 5-column model):
 *  - Three FEATURE tiers (Free / Grassroots / Movement). Which tier you're on is a feature
 *    decision. Within a tier, PRICE scales smoothly by emailable-subscriber bracket instead of
 *    stair-stepping between tiers — the old model jumped a customer 3.4× (Starter $29 →
 *    Representative $99) the moment they crossed one subscriber count. `representative` is
 *    retired. Feature split (revised 2026-07-14): newsletters are table stakes on EVERY plan
 *    including Free; forms, donations, automations, lists (segments) and volunteer management
 *    (teams & events) are the paid step-up (Grassroots and up); the field-ops surface — both
 *    companion apps (canvassing & deliveries), companion volunteer access & monitoring, yard
 *    signs, turf cutting, walk lists & routes, field reports, route optimization — is
 *    Movement-only.
 *  - Meter the EMAILABLE-SUBSCRIBER count, NOT total contacts. A campaign can store its
 *    whole voter / canvassing universe for free (storage is cheap) and only pays for who it
 *    can actually email. This is the differentiator vs. contact-metered tools.
 *  - Stripe never learns about "subscribers" — each purchasable tier has ONE graduated Stripe
 *    price, and the app reports `quantity = 1-based bracket index` (see `bracketIndexForSubscribers`).
 *    All bracket→price/subscriber-cap/email-cap logic lives here, in `plans.ts`, as inspectable
 *    data; Stripe just multiplies quantity by its graduated unit amounts.
 *  - Emails/month = 8× the bracket's subscriber cap on Grassroots (between Mailchimp
 *    Essentials' 10× and a weekly-send cadence) and 12× on Movement (matches Mailchimp
 *    Standard / Constant Contact Standard so the flagship spec-sheet line shows no smaller).
 *    Free keeps 2×. Enforced at send time since 2026-07-18 (send-guards.ts monthly allowance),
 *    not just alerted on.
 *  - Monthly send, storage and seat caps protect the real COGS: SendGrid (newsletters),
 *    Postmark (transactional, scales with seats/activity) and Azure Blob (files).
 *  - Companion volunteers carry an auth-SMS cost — and the companion apps that use them are
 *    Movement-only. (Revised 2026-07-16: companion volunteer access itself moved to
 *    Movement-only. On Grassroots it was a dead grant — volunteer links are minted only by
 *    turf assignments and delivery routes, both Movement-gated — so the old "15 volunteers"
 *    could never be used. Staff-side volunteer management — teams & volunteer events — stays
 *    Grassroots.)
 *  - Enterprise is dropped as a priced column (contact-us footnote only); the `enterprise`
 *    PlanKey stays valid internally for custom/negotiated tenants — `pricing: null` marks it.
 *  - All prices are USD.
 *  - Annual billing (added 2026-07-18): each purchasable tier also has a yearly Stripe price at
 *    exactly 10× the monthly unit amounts — "2 months free" (`ANNUAL_PRICE_MULTIPLIER`). The
 *    graduated ladder is linear in quantity, so 10× holds at every bracket and the whole
 *    quantity-as-bracket-index mechanism carries over unchanged. Display is the monthly
 *    equivalent rounded to the nearest dollar, with the EXACT annual total always alongside
 *    plus a rounding disclaimer ("$24 per month, billed annually as $290") — the checkable
 *    number is the annual total, which is what's actually charged. The website pricing page
 *    defaults to Annual (marketing convention: 2026-07-18); the in-app billing page keeps
 *    Monthly as its default (electoral campaigns end in November — don't nudge existing
 *    customers into prepay). Mid-year bracket GROWTH on an annual subscription is
 *    invoiced prorated immediately (see backend subscription-sync.ts); downgrades still defer
 *    to renewal on both intervals. Send/usage caps stay MONTHLY regardless of billing interval.
 *
 * Market calibration (competitive research 2026-07-14; final ladder locked 2026-07-15, monthly
 * billing): Grassroots beats every full-suite competitor at every count — $69 vs $75 (Mailchimp
 * Essentials) at 5k, $89 vs $110 at 10k, $129 vs $230 at 20k, $219 vs beehiiv Scale's $199 at
 * 50k is the one near-miss (beehiiv is newsletter-only). Movement beats Mailchimp Standard at
 * every count — $125 vs $100 at 5k is the exception early on, but $195 vs $230 at 15k,
 * $365 vs $450 at 50k, $565 vs $800 at 100k. Roughly 1.8× Grassroots at every bracket —
 * "cheapest full-featured option" rather than "suspiciously cheap".
 *
 * Stripe ops (manual, not code — one graduated recurring price per purchasable tier;
 * `quantity` = the bracket index from `bracketIndexForSubscribers`):
 *  - Grassroots: [{ up_to: 1, unit_amount: 2900 }, { up_to: 7, unit_amount: 2000 }, { up_to: 'inf', unit_amount: 7000 }]
 *    → qty 1 = $29, qty 2–7 add $20/step (→ $149), qty 8–10 add $70/step (→ $359; the
 *    piecewise step change at the 25,000-subscriber boundary — see GRASSROOTS_BRACKETS below).
 *  - Movement: [{ up_to: 1, unit_amount: 5500 }, { up_to: 7, unit_amount: 3500 }, { up_to: 'inf', unit_amount: 10000 }]
 *    → qty 1 = $55, qty 2–7 add $35/step (→ $265), qty 8–11 add $100/step (→ $665; same
 *    piecewise step change at the 25,000-subscriber boundary — see MOVEMENT_BRACKETS below).
 *  - Grassroots annual (interval = year): [{ up_to: 1, unit_amount: 29000 }, { up_to: 7, unit_amount: 20000 }, { up_to: 'inf', unit_amount: 70000 }]
 *  - Movement annual (interval = year): [{ up_to: 1, unit_amount: 55000 }, { up_to: 7, unit_amount: 35000 }, { up_to: 'inf', unit_amount: 100000 }]
 *    (exactly 10× the monthly unit amounts. Same graduated shape, same quantity semantics,
 *    exclusive tax on the price. Created 2026-07-18 in BOTH modes — test-mode IDs are set in
 *    .env.production, live-mode IDs are in its comments for the launch swap. A default billing
 *    portal configuration with subscription_update enabled (price switches only, proration
 *    always_invoice) exists in test mode so monthly customers can self-switch to annual; the
 *    live-mode portal needs the same configuration at launch alongside the sk_live swap.)
 *
 * Internal plan keys are persisted in `tenants.subscription_plan` and mapped to Stripe
 * price IDs. Display names are intentionally allowed to differ from keys, but here they are
 * kept aligned (`grassroots`→"Grassroots", `movement`→"Movement", …) except the free key,
 * which presents as "Free" (renamed from "Starter" in the 2026-07-14 overhaul —
 * `LEGACY_PLAN_ALIASES` resolves stale `starter` values written before the rename).
 */

export const GB = 1024 * 1024 * 1024;

/** Every plan key that can appear in `tenants.subscription_plan`. */
export type PlanKey = 'free' | 'grassroots' | 'movement' | 'enterprise';

/** Paid plans bought via self-serve Stripe checkout (excludes free and contact-sales enterprise). */
export const PURCHASABLE_PLAN_KEYS = ['grassroots', 'movement'] as const;
export type PurchasablePlanKey = (typeof PURCHASABLE_PLAN_KEYS)[number];

/** Billing intervals a purchasable plan can be bought on. Monthly is the default everywhere;
 * annual is 10× the monthly bracket price — "2 months free". */
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Months a customer doesn't pay for on annual billing — the marketing claim "2 months free". */
export const ANNUAL_MONTHS_FREE = 2;

/** Annual price = monthly bracket price × this. Derived from ANNUAL_MONTHS_FREE so the
 * marketing claim and the multiplier can't drift apart. */
export const ANNUAL_PRICE_MULTIPLIER = 12 - ANNUAL_MONTHS_FREE;

/** One row of a tier's price ladder. `upTo` is the inclusive emailable-subscriber cap; the
 * bracket's position in `TierPricing.brackets` (1-based) is the Stripe `quantity` billed for it. */
export interface PriceBracket {
  /** Emailable-subscriber cap of this bracket (inclusive). */
  readonly upTo: number;
  /** USD/month at this bracket (annual billing charges ×`ANNUAL_PRICE_MULTIPLIER` per year). */
  readonly price: number;
}

/** A purchasable (or free) tier's full price ladder. `null` on `PlanDef.pricing` means the
 * tier has no ladder at all — currently only `enterprise` (custom, negotiated pricing). */
export interface TierPricing {
  /** Ascending by `upTo`. Index + 1 = the Stripe `quantity` for that bracket; the last
   * bracket's `upTo` is the tier's hard subscriber max. */
  readonly brackets: readonly PriceBracket[];
  /** Monthly send cap = this × the current bracket's `upTo` (12 on paid tiers, 2 on Free). */
  readonly emailsPerSubscriber: number;
}

export interface PlanDef {
  readonly key: PlanKey;
  /** Customer-facing name (may differ from key). */
  readonly name: string;
  /** Display cadence, e.g. 'per month' / 'forever' / 'contact us'. */
  readonly cadence: string;
  readonly blurb: string;
  /** Bracket price ladder. `null` = enterprise custom pricing (no ladder, no Stripe quantity). */
  readonly pricing: TierPricing | null;
  /** File-storage quota in bytes. null = unlimited / custom. */
  readonly storageBytes: number | null;
  /** Included staff seats. null = unlimited. */
  readonly seats: number | null;
  /** Included companion volunteers. 0 = none, null = unlimited. */
  readonly volunteers: number | null;
  /** Bought via self-serve Stripe checkout (false for free + enterprise). */
  readonly purchasable: boolean;
  /** Highlighted as the recommended tier. */
  readonly featured: boolean;
  /** Shown as a priced column on pricing surfaces (false = enterprise, footnote-only). */
  readonly displayed: boolean;
  /** Marketing feature bullets shown on app-side billing cards (see FEATURE_MATRIX below for
   * the website's comparison-table view of the same feature split — keep both in sync). */
  readonly features: readonly string[];
}

/**
 * Grassroots ladder (final 2026-07-15 pricing) — $29 ≤1,000, +$20/bracket through 25,000, then
 * +$70/bracket to the 100,000 tier max (10 brackets). Bracket widths are non-uniform (1k → 2.5k
 * → 5k-wide steps → 25k-wide steps), so the ladder is spelled out literally rather than
 * generated. Price deltas stay Stripe-graduatable: +$20 ×6, then +$70 ×3 (see Stripe ops above).
 */
const GRASSROOTS_BRACKETS: readonly PriceBracket[] = [
  { upTo: 1_000, price: 29 },
  { upTo: 2_500, price: 49 },
  { upTo: 5_000, price: 69 },
  { upTo: 10_000, price: 89 },
  { upTo: 15_000, price: 109 },
  { upTo: 20_000, price: 129 },
  { upTo: 25_000, price: 149 },
  { upTo: 50_000, price: 219 },
  { upTo: 75_000, price: 289 },
  { upTo: 100_000, price: 359 },
];

/**
 * Movement ladder (final 2026-07-15 pricing) — $55 ≤1,000, +$35/bracket through 25,000, then
 * +$100/bracket to the 200,000 tier max (11 brackets). Same stops as Grassroots plus a final
 * 200,000 bracket; roughly 1.8× Grassroots at every shared stop. Price deltas stay
 * Stripe-graduatable: +$35 ×6, then +$100 ×4 (see Stripe ops above).
 */
const MOVEMENT_BRACKETS: readonly PriceBracket[] = [
  { upTo: 1_000, price: 55 },
  { upTo: 2_500, price: 90 },
  { upTo: 5_000, price: 125 },
  { upTo: 10_000, price: 160 },
  { upTo: 15_000, price: 195 },
  { upTo: 20_000, price: 230 },
  { upTo: 25_000, price: 265 },
  { upTo: 50_000, price: 365 },
  { upTo: 75_000, price: 465 },
  { upTo: 100_000, price: 565 },
  { upTo: 200_000, price: 665 },
];

export const PLANS: readonly PlanDef[] = [
  {
    key: 'free',
    name: 'Free',
    cadence: 'forever',
    blurb: 'For getting your bearings and running a small list.',
    pricing: { brackets: [{ upTo: 1_000, price: 0 }], emailsPerSubscriber: 2 },
    storageBytes: 1 * GB,
    seats: 2,
    volunteers: 0,
    purchasable: false,
    featured: false,
    displayed: true,
    features: [
      'Unlimited contacts & households',
      'Demo workspace with sample data',
      'Up to 1,000 email subscribers',
      '2,000 emails / month',
      '2 staff seats · 1 GB storage',
      'Shared inbox, people CRM & CSV import/export',
      'Newsletters, templates, scheduling & dynamic content',
      'AI deliverability check on every newsletter',
      'Custom reports, role-based access & 300+ integrations',
      'Community support',
    ],
  },
  {
    key: 'grassroots',
    name: 'Grassroots',
    cadence: 'per month',
    blurb: 'For a local candidate or small campaign getting to work.',
    pricing: { brackets: GRASSROOTS_BRACKETS, emailsPerSubscriber: 8 },
    storageBytes: 10 * GB,
    seats: 5,
    volunteers: 0,
    purchasable: true,
    featured: false,
    displayed: true,
    features: [
      'Everything in Free, plus:',
      'Scales smoothly from $29/month as your list grows',
      'Save 2 months with annual billing',
      'Up to 100,000 email subscribers · 8× emails/month',
      '5 staff seats · 10 GB storage',
      'Forms & donations',
      'Automations & lists (segments)',
      'Volunteer management (teams & events)',
      'Email support',
    ],
  },
  {
    key: 'movement',
    name: 'Movement',
    cadence: 'per month',
    blurb: 'For a large campaign or advocacy operation at full tilt.',
    pricing: { brackets: MOVEMENT_BRACKETS, emailsPerSubscriber: 12 },
    storageBytes: 200 * GB,
    seats: null,
    volunteers: null,
    purchasable: true,
    featured: true,
    displayed: true,
    features: [
      'Everything in Grassroots, plus:',
      'Scales smoothly from $55/month as your list grows',
      'Save 2 months with annual billing',
      'Up to 200,000 email subscribers · 12× emails/month',
      'Unlimited staff seats & volunteers · 200 GB storage',
      'Canvassing & deliveries companion apps',
      'Companion volunteer access & field monitoring',
      'Yard signs & route optimization',
      'Turf cutting, walk lists & routes, field reports',
      'Priority support & onboarding',
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    cadence: 'contact us',
    blurb: 'For federations, parties and multi-office operations.',
    pricing: null,
    storageBytes: null,
    seats: null,
    volunteers: null,
    purchasable: false,
    featured: false,
    displayed: false,
    features: [
      'Everything in Movement, plus:',
      'Unlimited subscribers & sends',
      'Multiple linked workspaces',
      'Single sign-on (SSO)',
      'Custom integrations',
      'SLA support & guided onboarding',
    ],
  },
];

export const PLANS_BY_KEY: Record<PlanKey, PlanDef> = PLANS.reduce(
  (acc, plan) => {
    acc[plan.key] = plan;
    return acc;
  },
  {} as Record<PlanKey, PlanDef>,
);

/** Stale plan values that must still resolve after the 2026-07-14 tier rename/retirement:
 * `representative` (retired, features split into grassroots/movement — nearest fit is
 * movement) and `starter` (renamed to `free`). Resolved case-insensitively by `getPlanDef`. */
export const LEGACY_PLAN_ALIASES: Readonly<Record<string, PlanKey>> = {
  representative: 'movement',
  starter: 'free',
};

/** Resolve a (possibly mixed-case, possibly legacy) stored plan value to its definition. */
export function getPlanDef(planName: string | null | undefined): PlanDef | undefined {
  if (!planName) return undefined;
  const key = planName.toLowerCase();
  const resolvedKey = LEGACY_PLAN_ALIASES[key] ?? key;
  return (PLANS_BY_KEY as Record<string, PlanDef | undefined>)[resolvedKey];
}

/** Customer-facing display name for a stored plan value (falls back to the raw value). */
export function planDisplayName(planName: string | null | undefined): string {
  return getPlanDef(planName)?.name ?? (planName ? planName : 'Free');
}

/**
 * 1-based Stripe quantity for an emailable-subscriber count on the given plan, or `null` when
 * the count exceeds the tier's max bracket (caller should treat this as "outgrown the tier").
 * A count of 0 still bills quantity 1 (every purchasable plan has a non-zero minimum charge).
 * Plans with no pricing ladder (enterprise) always return `null` — quantity is meaningless there.
 */
export function bracketIndexForSubscribers(key: PlanKey, count: number): number | null {
  const pricing = PLANS_BY_KEY[key].pricing;
  if (!pricing) return null;
  const normalizedCount = Math.max(count, 0);
  const index = pricing.brackets.findIndex((bracket) => normalizedCount <= bracket.upTo);
  return index === -1 ? null : index + 1;
}

/** The highest valid Stripe quantity (= number of brackets) for a plan. `Infinity` for plans
 * with no pricing ladder (enterprise — no quantity ceiling applies). */
export function maxQuantity(key: PlanKey): number {
  const pricing = PLANS_BY_KEY[key].pricing;
  return pricing ? pricing.brackets.length : Infinity;
}

/** The price bracket for a given Stripe quantity, clamping `qty` into the valid `[1, maxQuantity]`
 * range. Throws only if called against a plan with no pricing ladder (enterprise) — callers
 * should guard with `PLANS_BY_KEY[key].pricing !== null` first; purchasable/free plans always
 * have at least one bracket. */
export function bracketForQuantity(key: PlanKey, qty: number): PriceBracket {
  const pricing = PLANS_BY_KEY[key].pricing;
  if (!pricing) {
    throw new Error(`plan "${key}" has no pricing ladder (enterprise is custom-priced)`);
  }
  const max = pricing.brackets.length;
  const clampedIndex = Math.min(Math.max(qty, 1), max) - 1;
  const bracket = pricing.brackets[clampedIndex];
  if (!bracket) {
    // Unreachable: clampedIndex is always within [0, brackets.length - 1] above.
    throw new Error(`unreachable: no bracket at index ${clampedIndex} for plan "${key}"`);
  }
  return bracket;
}

/** Emailable-subscriber cap for a Stripe quantity on a plan. */
export function subscriberCapForQuantity(key: PlanKey, qty: number): number {
  return bracketForQuantity(key, qty).upTo;
}

/** Monthly email-send cap for a Stripe quantity on a plan (= subscriber cap × the plan's
 * `emailsPerSubscriber` multiplier). */
export function emailCapForQuantity(key: PlanKey, qty: number): number {
  const pricing = PLANS_BY_KEY[key].pricing;
  const multiplier = pricing?.emailsPerSubscriber ?? 0;
  return subscriberCapForQuantity(key, qty) * multiplier;
}

/** USD/month price for a Stripe quantity on a plan. */
export function priceForQuantity(key: PlanKey, qty: number): number {
  return bracketForQuantity(key, qty).price;
}

/** USD/year price for a Stripe quantity on a plan — exactly `ANNUAL_PRICE_MULTIPLIER`× the
 * monthly bracket price ("2 months free"). */
export function annualPriceForQuantity(key: PlanKey, qty: number): number {
  return priceForQuantity(key, qty) * ANNUAL_PRICE_MULTIPLIER;
}

/** Monthly-equivalent of an annual USD total, rounded to the nearest whole dollar (290 → 24).
 * The customer-facing framing for annual prices: "$24 per month, billed annually as $290" —
 * surfaces that show it must keep the exact annual total alongside and carry the rounding
 * disclaimer, since equivalent × 12 ≠ the billed total. */
export function monthlyEquivalentUsd(annualUsd: number): number {
  return Math.round(annualUsd / 12);
}

/** "$29" for whole dollars; tolerates cent amounts defensively ("$24.17"). */
function usdLabel(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Cadence line for surfaces with a monthly/annual toggle. Non-purchasable plans keep their
 * static cadence ('forever' / 'contact us'); paid plans read 'per month' or
 * 'per month, billed annually'. */
export function cadenceLabel(plan: PlanDef, interval: BillingInterval): string {
  if (!plan.purchasable) return plan.cadence;
  return interval === 'year' ? 'per month, billed annually' : plan.cadence;
}

/** Short "starting at" label for a plan card, e.g. '$0' (free), 'From $29' (grassroots),
 * 'From $55' (movement), 'Custom' (enterprise). With `interval: 'year'`, paid plans show the
 * rounded monthly-equivalent of the annual price, e.g. 'From $24'. */
export function startingPriceLabel(plan: PlanDef, interval: BillingInterval = 'month'): string {
  const usd = startingPriceUsd(plan, interval);
  if (usd === null) return 'Custom';
  return usd === 0 ? '$0' : `From ${usdLabel(usd)}`;
}

/** Numeric USD "starting at" price for a plan (0 = free, `null` = enterprise/custom, no ladder).
 * The numeric sibling of `startingPriceLabel`, for surfaces that convert prices to another
 * display currency (the marketing site's home teaser). With `interval: 'year'`, returns the
 * rounded monthly-equivalent of the annual price. */
export function startingPriceUsd(plan: PlanDef, interval: BillingInterval = 'month'): number | null {
  if (!plan.pricing) return null;
  const first = plan.pricing.brackets[0];
  if (!first) {
    // Unreachable: every non-null TierPricing in PLANS has at least one bracket.
    throw new Error(`unreachable: plan "${plan.key}" pricing has no brackets`);
  }
  if (interval === 'year') return monthlyEquivalentUsd(first.price * ANNUAL_PRICE_MULTIPLIER);
  return first.price;
}

/** Live price label for a plan at a given emailable-subscriber count, e.g. '$69' (in-ladder),
 * 'Contact us' (past the tier's max bracket), 'Custom' (enterprise, no ladder). With
 * `interval: 'year'`, the label is the rounded monthly-equivalent of the annual price ('$58').
 * Used by the website pricing slider and the frontend billing upgrade cards. */
export function priceLabelAt(plan: PlanDef, subscribers: number, interval: BillingInterval = 'month'): string {
  if (!plan.pricing) return 'Custom';
  const index = bracketIndexForSubscribers(plan.key, subscribers);
  if (index === null) return 'Contact us';
  const monthly = priceForQuantity(plan.key, index);
  if (interval === 'year') {
    return usdLabel(monthlyEquivalentUsd(monthly * ANNUAL_PRICE_MULTIPLIER));
  }
  return usdLabel(monthly);
}

/** Capability ordering of the tiers — used by `planAllowsFeature` for min-plan gating. */
const PLAN_RANK: Record<PlanKey, number> = { free: 0, grassroots: 1, movement: 2, enterprise: 3 };

/**
 * Server-enforced feature gates — the machine-readable core of FEATURE_MATRIX below (keep the
 * two in sync when a feature moves between tiers). The backend's plan-gate middleware
 * (apps/backend modules/billing/plan-gate.ts) blocks mutations in a gated module for tenants
 * below the feature's minimum plan.
 */
export const GATED_FEATURES = {
  forms: { minPlan: 'grassroots', label: 'Forms' },
  donations: { minPlan: 'grassroots', label: 'Donations' },
  automations: { minPlan: 'grassroots', label: 'Automations' },
  lists: { minPlan: 'grassroots', label: 'Lists (segments)' },
  volunteers: { minPlan: 'grassroots', label: 'Volunteer management' },
  canvassing: { minPlan: 'movement', label: 'Canvassing' },
  deliveries: { minPlan: 'movement', label: 'Deliveries' },
  companions: { minPlan: 'movement', label: 'Companion volunteer access' },
} as const satisfies Record<string, { minPlan: PlanKey; label: string }>;

export type GatedFeature = keyof typeof GATED_FEATURES;

/** Whether a (possibly legacy/mixed-case) stored plan value includes a gated feature. */
export function planAllowsFeature(planName: string | null | undefined, feature: GatedFeature): boolean {
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;
  return PLAN_RANK[plan.key] >= PLAN_RANK[GATED_FEATURES[feature].minPlan];
}

/**
 * Minimum plan for real (paid) household geocoding. Kept OUT of `GATED_FEATURES`/`FEATURE_MATRIX`
 * deliberately: this is a backend cost control, not a marketed tRPC-module feature — the heavy
 * geocoding consumers (canvassing turf-cutting, delivery routing) are already Movement-gated via
 * `GATED_FEATURES`, and this just stops lower tiers from incurring Google Geocoding API spend on
 * plain household map pins / ward enrichment. Mock/test geocoding is free and stays ungated.
 */
export const GEOCODING_MIN_PLAN: PlanKey = 'movement';

/** Whether a stored plan value may incur real (paid) geocoding — Movement and up. See `GEOCODING_MIN_PLAN`. */
export function planAllowsGeocoding(planName: string | null | undefined): boolean {
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;
  return PLAN_RANK[plan.key] >= PLAN_RANK[GEOCODING_MIN_PLAN];
}

/**
 * Shared feature-comparison matrix — drives the website's Mailchimp-style comparison table
 * (plan-header cards + feature rows). This is a SEPARATE data source from each PlanDef's
 * `features[]` bullet list (which drives the app-side billing cards): `features[]` is a short,
 * narrative "everything in X, plus Y" list; `FEATURE_MATRIX` is an exhaustive row-by-row grid.
 * They describe the same feature split from two different plan keys, so keep them in sync by
 * hand when a feature moves between tiers — there is no single source both surfaces read from.
 */
export interface FeatureMatrixRow {
  readonly label: string;
  /** true = ✓, false = ✗, string = a text cell (e.g. "Up to 1,000", "2 seats"). */
  readonly values: Readonly<Record<'free' | 'grassroots' | 'movement', boolean | string>>;
}

export interface FeatureMatrixGroup {
  readonly category: string;
  readonly rows: readonly FeatureMatrixRow[];
}

export const FEATURE_MATRIX: readonly FeatureMatrixGroup[] = [
  {
    category: 'Usage',
    rows: [
      {
        label: 'Emailable subscribers',
        values: { free: 'Up to 1,000', grassroots: 'Up to 100,000', movement: 'Up to 200,000' },
      },
      {
        label: 'Emails / month',
        values: { free: '2,000', grassroots: '8× your subscriber cap', movement: '12× your subscriber cap' },
      },
      { label: 'File storage', values: { free: '1 GB', grassroots: '10 GB', movement: '200 GB' } },
      { label: 'Staff seats', values: { free: '2', grassroots: '5', movement: 'Unlimited' } },
      { label: 'Companion volunteers', values: { free: '0', grassroots: '0', movement: 'Unlimited' } },
    ],
  },
  {
    category: 'Everything in every plan',
    rows: [
      { label: 'Unlimited contacts & households', values: { free: true, grassroots: true, movement: true } },
      { label: 'People CRM + shared inbox', values: { free: true, grassroots: true, movement: true } },
      { label: 'CSV import/export', values: { free: true, grassroots: true, movement: true } },
      { label: 'Newsletters', values: { free: true, grassroots: true, movement: true } },
      { label: 'Send from your own verified domain', values: { free: true, grassroots: true, movement: true } },
      { label: 'Pre-built templates', values: { free: true, grassroots: true, movement: true } },
      { label: 'Custom-coded templates', values: { free: true, grassroots: true, movement: true } },
      { label: 'Email scheduling', values: { free: true, grassroots: true, movement: true } },
      { label: 'AI deliverability check on every send', values: { free: true, grassroots: true, movement: true } },
      { label: 'Dynamic content', values: { free: true, grassroots: true, movement: true } },
      { label: 'Custom reports', values: { free: true, grassroots: true, movement: true } },
      { label: 'Role-based access', values: { free: true, grassroots: true, movement: true } },
      { label: '300+ integrations', values: { free: true, grassroots: true, movement: true } },
      { label: 'Demo workspace', values: { free: true, grassroots: true, movement: true } },
    ],
  },
  {
    category: 'Grow & engage',
    rows: [
      { label: 'Forms', values: { free: false, grassroots: true, movement: true } },
      { label: 'Donations', values: { free: false, grassroots: true, movement: true } },
      { label: 'Automations', values: { free: false, grassroots: true, movement: true } },
      { label: 'Lists (segments)', values: { free: false, grassroots: true, movement: true } },
      {
        label: 'Volunteer management (teams & events)',
        values: { free: false, grassroots: true, movement: true },
      },
    ],
  },
  {
    category: 'Canvassing',
    rows: [
      { label: 'Canvassing companion app', values: { free: false, grassroots: false, movement: true } },
      { label: 'Turf cutting', values: { free: false, grassroots: false, movement: true } },
      { label: 'Walk lists & routes', values: { free: false, grassroots: false, movement: true } },
      { label: 'Field reports', values: { free: false, grassroots: false, movement: true } },
    ],
  },
  {
    category: 'Deliveries',
    rows: [
      { label: 'Deliveries companion app', values: { free: false, grassroots: false, movement: true } },
      { label: 'Yard sign requests', values: { free: false, grassroots: false, movement: true } },
      { label: 'Route optimization', values: { free: false, grassroots: false, movement: true } },
      { label: 'Delivery monitoring', values: { free: false, grassroots: false, movement: true } },
    ],
  },
  {
    category: 'Movement only',
    rows: [
      {
        label: 'Companion volunteer access & monitoring',
        values: { free: false, grassroots: false, movement: true },
      },
      {
        label: 'Support',
        values: { free: 'Community', grassroots: 'Email', movement: 'Priority + onboarding' },
      },
    ],
  },
];
````

## File: libs/common/src/index.ts
````typescript
export type {
  IAuthKeyPayload,
  IAuthUser,
  IAuthUserDetail,
  IAuthUserRecord,
  IUserStatsSnapshot,
  IToken,
  signInInputType,
  signUpInputType,
} from './lib/auth';

export { AUTH_ROLE_LABELS, GENERIC_SIGNIN_ERROR, authRoleLabel, signInInputObj, signUpInputObj } from './lib/auth';

export type {
  INow,
  AddTagType,
  AddListType,
  AddMarketingEmailType,
  AddTaskType,
  AddTeamType,
  AddBugReportType,
  AddCampaignType,
  UpdateCampaignType,
  UpsertCampaignPersonFactType,
  SetCampaignSubscriptionType,
  CarryOverCampaignType,
  InviteAuthUserType,
  Verify2FAType,
  PERSONINHOUSEHOLDTYPE,
  PersonsType,
  MarketingEmailType,
  MarketingEmailTopLinkType,
  NewsletterReportType,
  NewsletterReportBounceType,
  NewsletterReportEngagedType,
  NewsletterReportLinkType,
  NewsletterReportPreviousSendType,
  CreateClickersListResultType,
  TasksType,
  ListsType,
  SettingsType,
  SettingsEntryType,
  UpsertSettingsInputType,
  SortModelType,
  UpdateHouseholdsType,
  UpdatePersonsType,
  UpdateTagType,
  UpdateListType,
  UpdateTeamType,
  UpdateAuthUserType,
  ProfilePreferencesType,
  UpdateMarketingEmailType,
  UpdateTaskType,
  getAllOptionsType,
  ExportCsvInputType,
  ExportCsvResponseType,
  QueueExportInputType,
  LogInstantExportInputType,
  DataExportRecordType,
  ImportListItem,
  AddVolunteerEventType,
  VolunteerEventsType,
  UpdateVolunteerEventType,
  AddVolunteerShiftType,
  VolunteerShiftsType,
  UpdateVolunteerShiftType,
  AddWebFormType,
  UpdateWebFormType,
  WebFormsType,
  CreateFormType,
  UpdateFormType,
  FormSubmissionType,
  QueryBuilderRuleNode,
  QueryBuilderGroupNode,
  QueryBuilderNode,
  WorkflowsType,
  AddWorkflowType,
  UpdateWorkflowType,
  WorkflowStepsType,
  AddWorkflowStepType,
  UpdateWorkflowStepType,
  WorkflowEnrollmentsType,
  AddEventType,
  EventType,
  UpdateEventType,
  AddTicketTypeType,
  TicketTypeType,
  UpdateTicketTypeType,
  ReorderTicketTypesType,
  AddRegistrationType,
  RegistrationType,
  UpdateRegistrationType,
  AddConnectionType,
  AddTurfType,
  UpdateTurfType,
  CutTurfsType,
  AssignTurfType,
  FieldReportRangeType,
  LogKnockType,
} from './lib/models';

export {
  cloneQueryBuilderNode,
  AddTagObj,
  AddListObj,
  AddMarketingEmailObj,
  AddTaskObj,
  TASK_STATUSES,
  TASK_BOARD_STATUSES,
  TASK_OPEN_STATUSES,
  TASK_STATUS_LABELS,
  isTaskStatus,
  isTaskBoardStatus,
  AddTeamObj,
  AddBugReportObj,
  AddCampaignObj,
  UpdateCampaignObj,
  UpsertCampaignPersonFactObj,
  SetCampaignSubscriptionObj,
  CarryOverCampaignObj,
  SUBSCRIPTION_STATUSES,
  CONSENT_SOURCES,
  CAMPAIGN_KINDS,
  CAMPAIGN_STATUSES,
  SUPPORT_LEVELS,
  SUPPORT_LEVEL_LABELS,
  VOTING_STATUSES,
  VOTING_STATUS_LABELS,
  FACT_SOURCES,
  DNC_CHANNELS,
  VOLUNTEER_STATUSES,
  VOLUNTEER_STATUS_LABELS,
  STAFF_STATUSES,
  STAFF_STATUS_LABELS,
  InviteAuthUserObj,
  Verify2FAObj,
  PersonsObj,
  MarketingEmailObj,
  marketingEmailTopLinkObj,
  TasksObj,
  ReorderTasksObj,
  ReorderSubtasksObj,
  ListsObj,
  SettingsObj,
  SettingsEntryObj,
  UpsertSettingsInputObj,
  UpdateHouseholdsObj,
  UpdatePersonsObj,
  UpdateTagObj,
  UpdateListObj,
  UpdateTeamObj,
  UpdateAuthUserObj,
  NotificationPreferencesObj,
  ProfilePreferencesObj,
  UpdateMarketingEmailObj,
  UpdateTaskObj,
  sortModelItem,
  getAllOptions,
  exportCsvInput,
  exportCsvResponse,
  queueExportInput,
  logInstantExportInput,
  dataExportRecord,
  ImportListItemObj,
  dbIdSchema,
  uuidSchema,
  addressSchema,
  idSchema,
  folderIdSchema,
  regularFolderIdSchema,
  nameSchema,
  descriptionSchema,
  emailSchema,
  phoneSchema,
  notesSchema,
  AddVolunteerEventObj,
  VolunteerEventsObj,
  UpdateVolunteerEventObj,
  AddVolunteerShiftObj,
  VolunteerShiftsObj,
  UpdateVolunteerShiftObj,
  AddWebFormObj,
  UpdateWebFormObj,
  WebFormsObj,
  CreateFormObj,
  UpdateFormObj,
  FormSubmissionObj,
  FormFieldObj,
  FormTypeEnum,
  FORM_TYPES,
  FORM_STATUSES,
  FORM_TEMPLATES,
  FORM_STANDARD_CATALOG,
  FORM_EMAIL_FIELD,
  normForm,
  fieldsForTemplate,
  WorkflowObj,
  AddWorkflowObj,
  UpdateWorkflowObj,
  WorkflowStepObj,
  AddWorkflowStepObj,
  UpdateWorkflowStepObj,
  WorkflowEnrollmentObj,
  WorkflowRunObj,
  WorkflowStepConfigObj,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_STEP_KINDS,
  CompanyInputObj,
  CompanyEnrichmentObj,
  AddEventObj,
  EventObj,
  UpdateEventObj,
  AddTicketTypeObj,
  TicketTypeObj,
  UpdateTicketTypeObj,
  ReorderTicketTypesObj,
  AddRegistrationObj,
  RegistrationObj,
  UpdateRegistrationObj,
  AddConnectionObj,
  RELATION_TYPES,
  RELATION_TYPE_LABELS,
  relationTypeSchema,
  AddTurfObj,
  UpdateTurfObj,
  CutTurfsObj,
  AssignTurfObj,
  FieldReportRangeObj,
  LogKnockObj,
  TURF_STATUSES,
  KNOCK_OUTCOMES,
  KNOCK_RESPONSES,
  KNOCK_RESPONSE_LABELS,
  DOORS_PER_TURF_PRESETS,
  turfStatusSchema,
  knockOutcomeSchema,
  knockResponseSchema,
  isTurfStatus,
  isKnockOutcome,
  CompanionSurveyObj,
  CompanionPersonResultObj,
  CompanionDoorOutcomeObj,
  CompanionClearOutcomeObj,
  CompanionPersonCreateObj,
  CompanionOpObj,
  CompanionResultsObj,
  UpdateCompanionSettingsObj,
  AddDeliveryRequestObj,
  UpdateDeliveryRequestObj,
  SetDeliveryRequestStatusObj,
  PlanDeliveriesObj,
  CommitDeliveriesObj,
  UpdateDeliveryRouteObj,
  AssignVolunteerObj,
  SetDeliveryRouteStatusObj,
  ReorderStopObj,
  ReorderStopsObj,
  StopActionObj,
  RouteIdObj,
  MintShareLinkObj,
  PublicStopActionObj,
  GetSignStatusObj,
  DELIVERY_REQUEST_STATUSES,
  DELIVERY_REQUEST_STATUS_LABELS,
  DELIVERY_ROUTE_STATUSES,
  DELIVERY_STOP_STATUSES,
  DELIVERY_SOURCES,
  DELIVERY_SKIP_REASONS,
  DONATION_METHODS,
  DONATION_METHOD_LABELS,
  donationMethodSchema,
  RecordDonationObj,
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
  interactionTypeSchema,
  LogInteractionObj,
  CompanionAccessQueryObj,
  CompanionVerifyStartObj,
  CompanionVerifyConfirmObj,
  COMPANION_LINK_KINDS,
  COMPANION_VERIFY_CHANNELS,
  COMPANION_VOLUNTEER_STATUSES,
  COMPANION_ACCESS_STATES,
} from './lib/schema';

export type {
  CompanionLinkKind,
  CompanionVerifyChannel,
  CompanionVolunteerStatus,
  CompanionAccessState,
  CompanionContact,
  CompanionAccessPayload,
  CompanionVerifyConfirmResult,
  CompanionVolunteerRow,
} from './lib/schemas/companion-access.schema';

export type {
  CampaignKind,
  CampaignStatus,
  SupportLevel,
  VotingStatus,
  FactSource,
  SubscriptionStatus,
  ConsentSource,
} from './lib/schemas/campaigns.schema';
export type { DncChannel, VolunteerStatus, StaffStatus } from './lib/schemas/persons.schema';
export type { GridColumnFilter, GridFilterModel } from './lib/schemas/core.schema';

export type { InteractionType, LogInteractionType } from './lib/schemas/activity.schema';

export type { DonationMethod, RecordDonationType, StripeConnectCountry } from './lib/schemas/donations.schema';
export { STRIPE_CONNECT_COUNTRIES } from './lib/schemas/donations.schema';

export type { FormType, FormStatus, FormField } from './lib/schemas/web-forms.schema';
export type { TaskStatus, TaskBoardStatus, ReorderTasksType, ReorderSubtasksType } from './lib/schemas/tasks.schema';
export type {
  WorkflowTriggerType,
  WorkflowStepKind,
  WorkflowStepConfigType,
  WorkflowRunType,
  WorkflowSendCondition,
  WorkflowExitCondition,
} from './lib/schemas/workflows.schema';
export { WORKFLOW_SEND_CONDITIONS, WORKFLOW_EXIT_CONDITIONS } from './lib/schemas/workflows.schema';
export type {
  TurfStatus,
  KnockOutcome,
  KnockResponse,
  CompanionSurveyType,
  CompanionOpType,
  CompanionResultsType,
  CompanionOpAck,
  CompanionSurveyPrefill,
  CompanionPersonResult,
  CompanionPerson,
  CompanionDoorOutcome,
  CompanionHousehold,
  CompanionTurfPayload,
  UpdateCompanionSettingsType,
} from './lib/schemas/canvassing.schema';
export type {
  AddDeliveryRequestType,
  UpdateDeliveryRequestType,
  SetDeliveryRequestStatusType,
  PlanDeliveriesType,
  CommitDeliveriesType,
  UpdateDeliveryRouteType,
  AssignVolunteerType,
  SetDeliveryRouteStatusType,
  ReorderStopType,
  ReorderStopsType,
  StopActionType,
  MintShareLinkType,
  PublicStopActionType,
  GetSignStatusType,
  DeliveryRequestStatus,
  DeliveryRouteStatus,
  DeliveryStopStatus,
  DeliverySource,
  DeliverySkipReason,
} from './lib/schemas/deliveries.schema';

export { debounce, escapeHtml, sleep, slugifyHandle, slugifyRecordName, RESERVED_SUBDOMAINS } from './lib/utils';
export {
  CROCKFORD_ALPHABET,
  PUBLIC_ID_LENGTH,
  encodeCrockford,
  normalizeCrockford,
  extractPublicIdFromSlug,
  buildPersonSlug,
} from './lib/public-id';
export { calculateWorkingTimeMs } from './lib/sla';

export {
  AddNewsletterTemplateObj,
  NewsletterTemplateObj,
  UpdateNewsletterTemplateObj,
} from './lib/schemas/newsletter-templates.schema';
export type {
  AddNewsletterTemplateType,
  NewsletterTemplateType,
  UpdateNewsletterTemplateType,
} from './lib/schemas/newsletter-templates.schema';

export {
  AI_CONTENT_TYPES,
  AI_REVIEW_STATUSES,
  AiPreflightVerdictObj,
  PREFLIGHT_BANDS,
  PREFLIGHT_BLOCK,
  PREFLIGHT_GOOD,
  PREFLIGHT_SEVERITIES,
  PreflightFindingObj,
  PreflightResultObj,
  RunPreflightObj,
  preflightBand,
} from './lib/schemas/content-check.schema';
export type {
  AiContentType,
  AiPreflightVerdict,
  AiReviewStatus,
  PreflightBand,
  PreflightFinding,
  PreflightResult,
  PreflightSeverity,
  RunPreflightType,
} from './lib/schemas/content-check.schema';
export {
  buildAiFindings,
  buildSpamAssassinFinding,
  computeScore,
  lintNewsletterContent,
  preflightHashInput,
} from './lib/preflight-lint';
export type { PreflightInput } from './lib/preflight-lint';

export { SPECIAL_FOLDERS, EMAIL_FOLDERS } from './lib/emails';

export type { EmailStatus, EmailFolderConfig } from './lib/emails';

export {
  GB,
  PLANS,
  PLANS_BY_KEY,
  PURCHASABLE_PLAN_KEYS,
  LEGACY_PLAN_ALIASES,
  FEATURE_MATRIX,
  getPlanDef,
  planDisplayName,
  bracketIndexForSubscribers,
  maxQuantity,
  bracketForQuantity,
  subscriberCapForQuantity,
  emailCapForQuantity,
  priceForQuantity,
  annualPriceForQuantity,
  monthlyEquivalentUsd,
  startingPriceLabel,
  startingPriceUsd,
  priceLabelAt,
  cadenceLabel,
  BILLING_INTERVALS,
  ANNUAL_MONTHS_FREE,
  ANNUAL_PRICE_MULTIPLIER,
  GATED_FEATURES,
  planAllowsFeature,
  GEOCODING_MIN_PLAN,
  planAllowsGeocoding,
} from './lib/billing/plans';
export type {
  PlanKey,
  GatedFeature,
  PurchasablePlanKey,
  BillingInterval,
  PlanDef,
  PriceBracket,
  TierPricing,
  FeatureMatrixRow,
  FeatureMatrixGroup,
} from './lib/billing/plans';
export {
  CURRENCY_CODES,
  SUPPORTED_CURRENCIES,
  COUNTRY_TO_CURRENCY,
  isCurrencyCode,
  currencyForCountry,
  convertFromUsd,
  formatCurrency,
  currencyPriceSymbol,
} from './lib/billing/currency';
export type { CurrencyCode, CurrencyDef, ExchangeRates } from './lib/billing/currency';

export { jsend, JSendFail as JSendFailError, JSendError as JSendServerError, httpStatusForJSend } from './lib/jsend';

export type {
  JSend,
  JSendSuccessInterface as JSendSuccess,
  JSendFailInterface as JSendFail,
  JSendStatus,
  JSendErrorInterface as JSendError,
} from './lib/jsend';

export type {
  HelpArticle,
  HelpBlock,
  HelpCategory,
  HelpCategoryId,
  HelpStep,
  HelpKeyRow,
  HelpInlineSegment,
} from './lib/help/help-types';
export {
  parseHelpInline,
  stripHelpInline,
  blockToPlainText,
  articleToPlainText,
  readingMinutes,
} from './lib/help/help-types';

export {
  HELP_CATEGORIES,
  HELP_ARTICLES,
  POPULAR_ARTICLE_IDS,
  getHelpArticle,
  getHelpCategory,
  articlesInCategory,
  relatedArticles,
  categoryNeighbors,
} from './lib/help/help-content';

export type { HelpHighlightSegment, HelpSearchResult } from './lib/help/help-search';
export { searchHelp, highlightTerms } from './lib/help/help-search';

export type { HelpRouteTarget } from './lib/help/help-links';
export { classifyHelpRoute } from './lib/help/help-links';

export { blockToMarkdown, articleToMarkdown } from './lib/help/help-markdown';
````

## File: libs/common/src/lib/help/articles/administration.ts
````typescript
import type { HelpArticle } from '../help-types';

export const ADMIN_ARTICLES: HelpArticle[] = [
  {
    id: 'profile',
    category: 'admin',
    title: 'Your profile',
    summary: 'Your photo, your details, and your account facts, plus a snapshot of your own activity.',
    keywords: ['profile', 'avatar', 'photo', 'account', 'notification preferences', 'personal settings', 'my account'],
    related: ['users-roles', 'settings', 'getting-around'],
    blocks: [
      {
        kind: 'p',
        text: 'Open your [Profile](/profile) from the avatar menu in the top-right corner. This page is about you: how you appear to teammates, which notifications reach you, and what you have contributed.',
      },
      { kind: 'h2', id: 'photo', text: 'Profile photo' },
      {
        kind: 'p',
        text: 'Upload a photo and crop it right in the app, or remove it to fall back to the default. A real photo makes assignment menus and activity feeds much easier to scan for everyone.',
      },
      { kind: 'h2', id: 'notifications', text: 'Notification preferences' },
      {
        kind: 'p',
        text: 'Notification preferences live in **Settings** (avatar menu → Settings), not on the Profile page. Choose, per event, whether you are alerted by email and in-app: mentions in comments, tasks assigned to you, tasks due, contacts assigned to you, finished exports, and import summaries. Every switch applies instantly. Administrators set workspace defaults, but your choices there are yours. See [Settings and configuration](/help/settings).',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Verify your email',
        text: 'If a “verification pending” notice sits at the top of your profile, click the link in the verification email. Some features stay limited until your address is confirmed.',
      },
      { kind: 'h2', id: 'impact', text: 'Your activity and impact' },
      {
        kind: 'p',
        text: 'The bottom of the profile tallies your recent contributions in the workspace, a quick answer to “what did I actually get done this month?”',
      },
    ],
  },
  {
    id: 'users-roles',
    category: 'admin',
    title: 'Users and roles',
    summary: 'Invite teammates, understand viewer / editor / admin, and enforce sign-in security like MFA.',
    keywords: [
      'users',
      'roles',
      'invite',
      'admin',
      'editor',
      'viewer',
      'permissions',
      'access',
      'mfa',
      'security',
      'campaign',
      'assignment',
    ],
    related: ['settings', 'profile', 'activity-log', 'campaigns-contexts'],
    blocks: [
      {
        kind: 'p',
        text: 'User management lives under [Users](/users) in the Admin section, visible to administrators only. Every teammate gets their own account; shared logins defeat both security and the activity log.',
      },
      {
        kind: 'p',
        text: 'The page opens with a one-line summary: how many users, how many are active or invited, and how many plan seats are in use. Each row shows a **Status** chip: **Active**, **Invited** (account created, not yet signed in), or **Deactivated**. It also has an **MFA** column showing who has multi-factor sign-in turned on and a **Last active** column based on real sign-in sessions. Change someone’s role right in the row with the role dropdown; your own role is locked, which prevents an accidental self-lockout. Once an election campaign exists, a **Campaign** column appears too: pick which campaign each Editor or Viewer works in (admins and owners always have every campaign, so their cell reads “All campaigns”). The **⋯** menu on each row opens the profile or sends a password reset email.',
      },
      { kind: 'h2', id: 'user-page', text: 'The user page' },
      {
        kind: 'p',
        text: 'Click a name to open the user’s page. Everything is managed right there, with no separate edit screen. The **Profile** card edits their name and email in place with an explicit **Save user** (changing an email sends a confirmation to the new address first). The **Access** card changes the role (it applies immediately, and locked roles say why), assigns the user’s campaign once an election campaign exists (see [Campaigns and contexts](/help/campaigns-contexts)), and shows two-factor status, last activity, and email verification. **Send password reset** sits in the header; for an **Invited** user who hasn’t signed in yet, the Access card offers **Resend invite** with a fresh activation link. **Deactivate user** and **Delete user** live in the **⋯** menu.',
      },
      { kind: 'h2', id: 'invite', text: 'Inviting someone' },
      {
        kind: 'p',
        text: '**Invite user** opens a dialog asking for the person’s email, first and last name, and role — plus, when your workspace has more than one campaign, the campaign the new Editor or Viewer will work in. The invitation arrives by email with an activation link that **expires after 7 days**, and it takes a plan seat right away. The dialog tells you how many seats remain. If an invitation lapses, open the person’s page and click **Resend invite** to issue a fresh link and temporary password. When every seat is in use, the button explains that too; free a seat or upgrade under **Settings → Billing**.',
      },
      { kind: 'h2', id: 'roles', text: 'The roles' },
      {
        kind: 'list',
        items: [
          '**Viewer**: read-only. Sees the data, changes nothing. Right for stakeholders and observers.',
          '**Editor**: the working role. Manages contacts, sends newsletters, runs the daily work.',
          '**Admin**: everything, plus the Admin area, which holds users, workspace configuration, and the workspace-wide activity log.',
          '**Owner**: everything an admin can do, plus billing and workspace lifecycle. Every workspace keeps at least one owner, and only an owner can change another owner’s role.',
        ],
      },
      {
        kind: 'p',
        text: 'Editors and Viewers also **belong to exactly one campaign** — the one an admin assigned them to (unassigned means the office). They cannot switch campaigns themselves; admins and owners can work in every campaign. See [Campaigns and contexts](/help/campaigns-contexts).',
      },
      {
        kind: 'p',
        text: 'New invitations default to the role set under **Workspace → Teams & Access**. Grant the least role that lets someone do their job. You can always raise it later.',
      },
      { kind: 'h2', id: 'mfa', text: 'Multi-factor authentication' },
      {
        kind: 'p',
        text: 'Turn on **Require MFA for all users** (Workspace → Teams & Access) and every sign-in from a new device or location must be confirmed with an email verification code. Strongly recommended once more than a couple of people share the workspace.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Departures checklist',
        text: 'When someone leaves, open their user page and pick **Deactivate user** from the **⋯** menu. Sign-in stops immediately and their sessions end, but their seat frees up and their history stays attributed to them in the activity log. If they return, **Reactivate user** restores access. Deactivated accounts keep their role.',
      },
    ],
  },
  {
    id: 'settings',
    category: 'admin',
    title: 'Settings and configuration',
    summary:
      'Two front doors: Settings for personal preferences, Workspace for policy that affects everyone (administrators).',
    keywords: [
      'settings',
      'configuration',
      'organization',
      'communications',
      'appearance',
      'billing',
      'sla settings',
      'workspace',
    ],
    related: ['users-roles', 'newsletters', 'dashboard', 'profile'],
    blocks: [
      {
        kind: 'p',
        text: 'pplCRM separates what affects **you** from what affects **everyone**. **Settings** (avatar menu → Settings) opens a compact popup for your personal preferences and applies every change instantly. There is nothing to save. The [Workspace](/workspace) settings (administrators only, under **Admin** in the sidebar) set policy for everyone and use a deliberate **Save** with a leave-guard.',
      },
      { kind: 'h2', id: 'personal', text: 'What lives in your Settings popup' },
      {
        kind: 'list',
        items: [
          '**Notifications**: a per-event matrix of email and in-app switches (mentions, task assigned, tasks due, person assigned, export ready, import summary). Each toggle saves as you flip it.',
          '**Appearance**: Theme is Light, Dark, or System (follows your device’s setting), applied live.',
          '**Passkeys**: the devices that can sign you in; add one with your device prompt, or remove one you no longer trust.',
        ],
      },
      { kind: 'h2', id: 'configuration', text: 'What lives in the Workspace settings' },
      {
        kind: 'p',
        text: 'The sidebar clusters the sections into four groups: **Workspace**, **Email**, **Features**, and **Plan & account**.',
      },
      {
        kind: 'list',
        items: [
          '**Organization**: your name, contact details, and mailing address.',
          '**Campaigns**: your permanent office context and any election campaigns — create and archive them, switch which one you (as an admin) are working in, and read how user assignment works. See [Campaigns and contexts](/help/campaigns-contexts).',
          '**Teams & access**: default role for invitations and the MFA requirement.',
          '**Communications**: default from-name and from-address (verified senders only), reply-to, the newsletter footer disclaimer, and double opt-in for web-form subscribers.',
          '**Email sync**: connect your email provider so incoming and outgoing email syncs into your pplCRM inbox.',
          '**Domain verification**: the DNS records (SPF, DKIM, DMARC) that let you send email from your own domain.',
          '**Service levels**: response-time targets for email and tasks, working days and hours, and the warning/critical thresholds behind the dashboard status.',
          '**Donations**: donation limit, residency restrictions, tax credit tiers, and your Stripe connection.',
          '**App**: how the volunteer-facing apps behave, including whether volunteer route links expire after 30 days. Expiry is the secure default (a forwarded or long-lost link goes dead on its own), but you can turn it off if your delivery routes run longer. Volunteers still verify a code and need a one-time approval either way.',
          '**Storage**: your plan quota, live usage, and the files taking up the most space.',
          '**Billing**: your plan, live usage, and payment details.',
          '**API keys**: the workspace API key for server-side integrations (submitting forms, RSVPs, and volunteer signups from your own backend, or connecting Zapier). Shown once at generation; regenerating invalidates the old key.',
          '**Account**: pause your organization account, or permanently delete it and all its data.',
        ],
      },
      { kind: 'h2', id: 'billing', text: 'Plans and billing' },
      {
        kind: 'p',
        text: 'pplCRM has three feature tiers: **Free**, **Grassroots**, and **Movement**. Which tier you are on decides which features you have. Within a paid tier, the price scales smoothly with your emailable-subscriber count instead of jumping between price points, so growing your list never means a sudden shock to the bill.',
      },
      {
        kind: 'list',
        items: [
          '**Free**: $0 forever. Up to 1,000 emailable subscribers, 2,000 emails a month, 2 staff seats, and 1 GB of storage. Includes the full people CRM and newsletters. No companion volunteers.',
          '**Grassroots**: starts at $29 a month for up to 1,000 emailable subscribers, then rises in steps as your list grows, up to $359 a month at its 100,000-subscriber ceiling. Adds web forms, donations, automations, lists, and volunteer management (teams and events).',
          '**Movement**: starts at $55 a month for up to 1,000 emailable subscribers, then rises in steps up to $665 a month at its 200,000-subscriber ceiling. Adds the canvassing and deliveries companion apps with unlimited companion volunteers: turf cutting, walk lists and routes, field reports, yard signs, and route optimization, plus priority support.',
          '**Enterprise**: for federations, parties, and multi-office operations with custom needs. Pricing is negotiated directly. Reach out from the [Billing](/workspace/billing) page.',
        ],
      },
      {
        kind: 'p',
        text: 'Every plan meters **emailable subscribers**, not total contacts. Your whole voter or canvassing universe stays free to store; you only pay for the people you can actually email.',
      },
      {
        kind: 'p',
        text: 'Paid plans can be billed **monthly or annually**. Annual billing costs exactly 10× the monthly price at every bracket — **2 months free** — paid up front for the year. Pick the interval with the Monthly/Annual toggle on the [Billing](/workspace/billing) page before upgrading; existing subscribers can switch interval from the Stripe billing portal (**Manage subscription**). Monthly is the default — if your campaign wraps up mid-year, don’t prepay twelve months.',
      },
      {
        kind: 'p',
        text: 'Plan prices exclude tax. Where your jurisdiction requires it, sales tax, VAT, or GST is calculated and added at checkout based on the billing address you enter there, and appears as its own line on every invoice and receipt. If your organization has a business tax number (VAT, GST, or similar), you can enter it at checkout so it appears on your invoices and any business-to-business tax treatment applies automatically.',
      },
      { kind: 'h2', id: 'billing-bumps', text: 'What happens when your list grows or shrinks' },
      {
        kind: 'p',
        text: 'When your emailable-subscriber count crosses into a higher price bracket, every admin and owner is notified, the subscription moves to the new bracket, and the prorated difference for the remainder of your current billing period is charged right away — on **either** interval. Growth never interrupts sending, and your monthly email allowance rises with the new bracket the moment it applies. If your list shrinks back below a bracket, the lower price reconciles at the next renewal rather than refunding the current period. If a payment fails, newsletter sending goes on hold until the payment method is updated on the [Billing](/workspace/billing) page — everything else keeps working.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Cannot see the Workspace section?',
        text: 'It is admin-only. If a setting here matters to you, ask a workspace administrator. See [Users and roles](/help/users-roles).',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Unsaved changes stay visible',
        text: 'Editing a Workspace section marks it dirty with an amber dot in the left rail, so you can move between sections without losing track of what still needs a **Save**. Navigating away while dirty asks before discarding.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Three settings to nail on day one',
        text: 'Organization details, the Communications sender identity, and SLA working hours. Everything else can wait, but these three shape every email you send and every number on the dashboard.',
      },
    ],
  },
  {
    id: 'volunteer-access',
    category: 'admin',
    title: 'Volunteer access approvals',
    summary:
      'Companion links are personal. Volunteers verify a code sent to their contact on file, and new volunteers need a one-time admin approval.',
    keywords: [
      'volunteer',
      'access',
      'approve',
      'companion',
      'canvass',
      'delivery',
      'link',
      'verify',
      'revoke',
      'code',
    ],
    related: ['users-roles', 'canvassing', 'deliveries', 'activity-log'],
    blocks: [
      {
        kind: 'p',
        text: 'Canvassing turfs and delivery routes reach volunteers as personal links: no account, nothing to install. To keep a forwarded or leaked link from exposing voter data, opening one takes two steps: the volunteer verifies a one-time code sent to the email or mobile on their person record, and a first-time volunteer waits for an admin to approve them. Approval happens once per volunteer, not per link. After that, every current and future assignment just works.',
      },
      { kind: 'h2', id: 'approve', text: 'Approving a volunteer' },
      {
        kind: 'p',
        text: 'When someone verifies for the first time, every admin gets an email, an in-app notification in the bell menu, and a badge on [Volunteer access](/volunteer-access) in the Admin section. Opening the notification takes you straight there. Each row shows the volunteer, their contact on file, and a status chip: **Invited** (link sent, not yet verified), **Awaiting approval**, **Approved**, or **Revoked**. Click **Approve** and their open Companion page unlocks by itself within seconds. They never re-enter a code.',
      },
      { kind: 'h2', id: 'revoke', text: 'Revoking access' },
      {
        kind: 'p',
        text: '**Revoke** signs the volunteer out of every phone they ever verified, effective on their next request, and dead-ends their links. Use it when someone leaves the campaign or a phone is lost. You can approve them again later. They’ll verify a fresh code first. Every approval and revocation is recorded in the [activity log](/activity).',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Verification needs a contact on file',
        text: 'Codes go to the email or mobile number on the volunteer’s person record. If neither is on file, the link tells them to ask you. Add a contact to their record and have them reopen the link.',
      },
    ],
  },
  {
    id: 'activity-log',
    category: 'admin',
    title: 'The activity log',
    summary: 'Who changed what and when, on every record page and workspace-wide for administrators.',
    keywords: ['activity', 'audit', 'history', 'log', 'changes', 'who changed', 'accountability'],
    related: ['users-roles', 'person-profile'],
    blocks: [
      {
        kind: 'p',
        text: 'Every record that can change keeps a running history. Open its **Activity** tab to see edits and touches in order, each attributed to a person and a time. It answers “who changed this phone number?” without a meeting.',
      },
      { kind: 'h2', id: 'log-interaction', text: 'Log an interaction' },
      {
        kind: 'p',
        text: 'The history is not only automatic. On any person, household, or company page, use **Log an interaction** in the header to record a real-world touch (a **call**, **door knock**, **email or note**, or **meeting**) with an optional note. It is attributed to you and joins that record’s Activity immediately, so a phone call or a conversation at the door leaves the same durable trail as an edit.',
      },
      { kind: 'h2', id: 'workspace', text: 'The workspace-wide view' },
      {
        kind: 'p',
        text: 'Administrators also get [Activity](/activity) under Admin: the same trail across the entire workspace, useful for auditing a busy day, tracing an import’s effects, or reviewing what an account did before it was deactivated.',
      },
      {
        kind: 'p',
        text: 'Filter by **Actor**, **Item type**, or **Action** to narrow the trail, and events are grouped by day (Today, Yesterday, then dated) so a busy stretch stays scannable. Actions taken through a public token, like a delivery volunteer following their link, are labelled **via volunteer link** rather than pinned on a signed-in teammate. Use **Export log** to download the filtered trail as `activity-log.csv`. The workspace log keeps the last **90 days**; older events are pruned automatically.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'The log is a teaching tool',
        text: 'When data looks wrong, check the activity first. Most “mystery changes” turn out to be a teammate with good intentions and a different assumption. Now you know who to sync with.',
      },
    ],
  },
  {
    id: 'campaigns-contexts',
    category: 'admin',
    title: 'Campaigns and contexts',
    summary:
      'One shared contact list, separate campaign workspaces: how the office and election campaigns coexist without mixing supporter data.',
    keywords: [
      'campaigns',
      'campaign',
      'context',
      'office',
      'election',
      'assign',
      'assignment',
      'archive',
      'workspace',
      'constituency',
    ],
    related: ['users-roles', 'settings', 'activity-log'],
    blocks: [
      {
        kind: 'p',
        text: 'Your workspace always has one permanent **office** context, the constituency office’s day-to-day home. When an election comes, an administrator creates an **election campaign** alongside it under [Workspace → Campaigns](/workspace/campaigns). People, households, and companies are shared across every context: one contact list, no duplicates. What stays separate per campaign is what you learn and are permitted to do in it: supporter data, email consent, and outreach.',
      },
      { kind: 'h2', id: 'assignment', text: 'Who works in which campaign' },
      {
        kind: 'p',
        text: 'Campaign membership is an admin decision, not a personal choice. **Editors and Viewers belong to exactly one campaign**: the one an admin assigned them to on the [Users](/users) page or in the invite dialog (unassigned members work in the office). Everything they see and do — newsletters, forms, donations, canvassing, the inbox — stays inside that campaign, and their [Profile](/profile) shows which campaign they are part of. **Admins and owners can work in every campaign**: they pick the context they are currently working in from [Workspace → Campaigns](/workspace/campaigns) (**Work in this campaign**), and that choice is theirs alone and follows them across devices.',
      },
      { kind: 'h2', id: 'separate', text: 'What is separate per campaign' },
      {
        kind: 'list',
        items: [
          '**Support level**: Strong, Leaning, Neutral, Leaning against, Against, Undecided; “Unknown” simply means never asked. Someone can back your office work and oppose the campaign, or vice versa.',
          '**Voting status**: Will vote, Voted (advance or election day), Not voting, Ineligible. Once someone has voted in advance they drop out of later call and knock lists.',
          '**Email consent**: subscribing to the office newsletter is not consent for campaign email, and unsubscribing from one never touches the other. A hard bounce or spam complaint suppresses the address everywhere, and **do-not-contact** on a person overrides every context.',
          '**Newsletters, donations, forms, lists, events, canvassing turfs, and deliveries**: each belongs to the context it was created in, so campaign funds and office funds never mix.',
          '**The Inbox and its email connection**: each campaign connects its own Office 365 or Gmail account and has its own Inbox. Switching context switches both the connected mailbox and the mail you see; connecting an account under one campaign never affects another. See [The shared inbox](/help/inbox).',
        ],
      },
      { kind: 'h2', id: 'lifecycle', text: 'Campaign lifecycle' },
      {
        kind: 'list',
        items: [
          '**Create** a campaign before the race, with a start date and election day.',
          '**Carry over** support levels from the office or a previous campaign as a starting assumption. Email subscriptions copy only behind an explicit confirmation. Consent judgment stays with you. Voting status never carries over.',
          '**Work** in it during the campaign. Data recorded there never bleeds into the office.',
          '**Archive** it after the race: everything stays viewable as read-only history, users assigned to it move back to the office context, and you can unarchive if late data needs to be entered.',
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'The office cannot be archived or deleted',
        text: 'It is the permanent workspace. Election campaigns cannot be deleted either. Archive them instead, so their history and attribution stay intact.',
      },
    ],
  },
];
````

## File: libs/common/src/lib/help/articles/engagement.ts
````typescript
import type { HelpArticle } from '../help-types';

export const ENGAGEMENT_ARTICLES: HelpArticle[] = [
  {
    id: 'donations',
    category: 'engagement',
    title: 'Donations, pledges, and fundraising pages',
    summary:
      'Record gifts, track promised money separately from received money, and raise online with shareable pages.',
    keywords: [
      'donation',
      'gift',
      'pledge',
      'fundraising',
      'donate page',
      'giving',
      'contribution',
      'donor',
      'record donation',
      'receipt',
      'cash',
      'check',
      'stripe',
      'processor',
      'residency',
      'paused',
    ],
    related: ['person-profile', 'forms', 'export', 'grid-basics'],
    blocks: [
      { kind: 'h2', id: 'donations', text: 'Donations: money received' },
      {
        kind: 'p',
        text: 'The [Donations](/donations) grid is the ledger of received gifts. Each donation belongs to a person, so a donor’s full giving history is always one click away on their profile’s **Donations** tab. Like any grid, it filters, exports, and bulk-edits. See [Working in grids](/help/grid-basics).',
      },
      {
        kind: 'p',
        text: 'Most gifts arrive on their own through a fundraising page. For cash, a check, or a bank transfer collected offline, click **Record donation** at the top of the Donations page: pick the donor, enter the amount, and choose a method (Card, Check, Cash, or Bank transfer). A receipt goes out automatically. Configure the sender and template in Workspace settings → Donations.',
      },
      {
        kind: 'p',
        text: 'If a card gift is later refunded or charged back through Stripe, the donation updates itself. It shows as **refunded** or **disputed** and stops counting toward the donor’s giving totals and contribution limits, so your reports stay honest without any manual cleanup. A chargeback you later win flips the gift back to succeeded automatically.',
      },
      { kind: 'h2', id: 'processor', text: 'Choose your payment processor' },
      {
        kind: 'p',
        text: 'Online gifts are processed by **Stripe**, set up under [Workspace → Donations](/workspace/donations). Stripe handles both one-time and monthly (recurring) gifts, and processes and stores donor payment data in the United States.',
      },
      {
        kind: 'p',
        text: 'Setting up Stripe means **connecting your own Stripe account** — click **Connect with Stripe**, pick your campaign’s country, and Stripe walks you through verifying the campaign before returning you to pplCRM. There are no API keys or webhook URLs to copy. Donations are charged directly to your Stripe account, so your campaign stays the merchant of record for compliance and receipting, and you manage payouts, refunds, and disputes from your own Stripe dashboard (the **Open Stripe dashboard** button). pplCRM deducts a **1% platform fee** from each card donation; Stripe’s own processing fees also apply and are billed to your account by Stripe. If a gift is fully refunded, the platform fee is refunded too.',
      },
      {
        kind: 'p',
        text: 'Why your own account? Campaign finance rules generally require contributions to be received by the campaign itself, so donations settle directly into your campaign’s bank account and never pass through pplCRM. It also puts the money in the safest possible hands: Stripe is certified to PCI DSS Level 1, the industry’s highest payment-security standard, and card details never touch pplCRM’s servers. And the account stays yours; your processing history remains with you even if you stop using pplCRM.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Donations are paused until you confirm residency',
        text: 'A new organization cannot accept donations until you confirm your residency restrictions under [Workspace → Donations](/workspace/donations). Saving that card once lifts the pause, whether you restrict donors to certain places or allow everyone.',
      },
      { kind: 'h2', id: 'pledges', text: 'Pledges: money promised' },
      {
        kind: 'p',
        text: 'Pledges live in their own view beside donations. Keeping promised and received money separate keeps reports honest, and gives you a follow-up queue of pledges yet to convert.',
      },
      { kind: 'h2', id: 'pages', text: 'Fundraising pages: money online' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Forms](/forms), click **New form**, then **Create a fundraising form**',
            detail: 'Build the giving page: your appeal, your branding.',
          },
          { title: 'Share the link', detail: 'The page stands on its own for email, social, or QR codes.' },
          {
            title: 'Watch gifts arrive',
            detail: 'Donations made through the page land in the CRM attached to the right people. No retyping.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Thank fast',
        text: 'Gratitude is a retention strategy. Pair a page with an automation that thanks donors the moment a gift lands. See [Automations](/help/automations).',
      },
    ],
  },
  {
    id: 'events-shifts',
    category: 'engagement',
    title: 'Events and volunteer shifts',
    summary: 'Publish event pages people can register for, then staff the work with scheduled volunteer shifts.',
    keywords: ['event', 'shift', 'volunteer', 'schedule', 'signup', 'registration', 'attendance', 'rsvp'],
    related: ['teams', 'automations', 'forms', 'person-profile'],
    blocks: [
      {
        kind: 'p',
        text: 'Two tools cover the in-person world: **Events** are the occasions people attend; **Shifts** are the volunteer slots that make them run. Both are created from [Forms](/forms). Click **New form**, then choose the event or shift option instead of a standard template.',
      },
      { kind: 'h2', id: 'events', text: 'Events' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Forms](/forms), click **New form**, then **Create an event page**',
            detail: 'Set the what, when, and where, and publish the event page.',
          },
          {
            title: 'Share the page',
            detail:
              'Every event gets a public link on your organization’s own web address. Copy it from the event’s **Public link** panel. Registrations flow straight into the CRM as people sign up.',
          },
          {
            title: 'Add ticket tiers and set their order',
            detail:
              'On the event’s edit page, add ticket types under **Ticket types** (leave it empty for a free RSVP). Drag a ticket by its handle to set the order; the order you set is the order attendees see on the public page.',
          },
          {
            title: 'Review turnout',
            detail: 'Registrations and attendance appear on the event, and on each person’s **Events** tab.',
          },
        ],
      },
      { kind: 'h2', id: 'shifts', text: 'Volunteer shifts' },
      {
        kind: 'p',
        text: 'Create shifts from [Forms](/forms) (click **New form**, then **Create a volunteer shift**) with a time and a place. Each shift has its own public signup link, and your organization also gets a public **Volunteer events** page listing every upcoming public shift. The link is on the shift’s edit page. As volunteers sign up and serve, their hours accumulate on their profile’s **Volunteer** tab, which makes recognizing your most dedicated people easy.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Automate the follow-through',
        text: 'Attach an [automation](/help/automations) to an event to thank attendees or brief volunteers automatically. The trigger fires per signup.',
      },
    ],
  },
  {
    id: 'forms',
    category: 'engagement',
    title: 'Web forms',
    summary:
      'Signups, RSVPs, pledges and surveys as living pages: draft → publish → archive, edited live beside a preview, with responses that are people.',
    keywords: [
      'form',
      'web form',
      'signup form',
      'survey',
      'rsvp',
      'pledge',
      'embed',
      'subscribe',
      'submission',
      'publish',
      'archive',
      'responses',
      'api',
      'api key',
      'zapier',
      'integration',
    ],
    related: ['newsletters', 'automations', 'import', 'tags-issues'],
    blocks: [
      {
        kind: 'p',
        text: 'A form under [Forms](/forms) is a living page with a lifecycle: **draft**, **published**, **archived**. You pick a type when you create it (Signup, Pledge, RSVP, Request, Survey), edit it live beside a preview, and share one public link. Every response creates or updates a person, so submissions arrive as records, never a spreadsheet to import on Friday.',
      },
      { kind: 'h2', id: 'create', text: 'Create from a template' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Forms](/forms) and click New form',
            detail: 'Pick a starting template card, then name the form. It opens as a draft in edit mode.',
          },
          {
            title: 'Turn fields on and set what’s required',
            detail:
              'Check a field to add it; click its Optional/Required pill to toggle. Drag a field by its handle to reorder it; the order you set is the order people see on the public form. Changes apply to the live form instantly. There is nothing to save.',
          },
          {
            title: 'Publish when it’s ready',
            detail:
              'Publish activates the public link and the form starts accepting responses. Unpublish pauses it; the link keeps working again the moment you republish.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Email is the identity key',
        text: 'Every form always collects an email, always required. It’s how each response is matched to (or creates) a person. That’s why the email field can’t be turned off or made optional.',
      },
      { kind: 'h2', id: 'responses', text: 'Responses are people' },
      {
        kind: 'p',
        text: 'The **Responses** tab lists each submission and links straight to the person it created or updated. Every response also applies the form’s tags, including an automatic `Source: <form name>` tag, and joins the lists you chose under **Audience**, so your segmentation stays effortless. Export the responses to CSV anytime.',
      },
      { kind: 'h2', id: 'share', text: 'Share and embed' },
      {
        kind: 'list',
        items: [
          'Copy the public link or open the standalone page from the link row.',
          'Use the `</>` embed to drop the form into any site: an auto-updating iframe, or a raw HTML form that reflects your currently enabled fields.',
          'Turn on a confirmation email to thank people automatically, or notify your team when a response lands (both under **After submit**).',
        ],
      },
      { kind: 'h2', id: 'api', text: 'Bring your own form (API)' },
      {
        kind: 'p',
        text: 'Already have a form that matches your website’s design? Keep it. Point its submit action at your form’s public endpoint — `POST /api/forms/submit/<slug>?t=<workspace>` on the API domain (the same URL the raw-HTML embed uses) — with your enabled field names, and every submission still becomes a person, applies your tags and lists, and respects double opt-in. Include the hidden `_hp` field and leave it empty; it’s the spam trap.',
      },
      {
        kind: 'p',
        text: 'Submitting from your own server or backend instead? Generate a **workspace API key** (Workspace settings → **API keys**) and send it as an `Authorization: Bearer` header. The key identifies your workspace on its own — no `?t=` needed — and lifts the anonymous per-visitor rate limit in favor of a per-workspace one built for batch traffic. The same key authenticates Zapier and the event RSVP and volunteer signup endpoints.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Never put the API key in a public page',
        text: 'The key is a secret — anyone who has it can write into your workspace. Browser-side forms don’t need it (the public endpoint works keyless); the key belongs only in server-side code. If it ever leaks, regenerate it in Workspace settings → API keys, which invalidates the old key instantly.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Archive, don’t delete',
        text: 'A form with responses can be archived. Its public link shows a friendly closed notice and every record keeps pointing at it. Restore brings it back as a draft. Only an untouched draft with zero responses can be deleted outright.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Double opt-in and your forms',
        text: 'If your workspace enables double opt-in (**Workspace → Communications**), new subscribers confirm by email before receiving newsletters: better list quality and compliance in one setting.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Donation forms show here too',
        text: 'Donation pages appear in the [Forms](/forms) list with a **Donation** chip, and selecting one previews it right beside the list like any other form. Because they collect card payments through your connected Stripe account, they aren’t edited in the live editor. **Edit donation form** opens the [Donations](/donations) fundraising builder, where the amount and payment settings live, and their responses arrive as gifts in the Donations ledger rather than a form responses tab.',
      },
    ],
  },
  {
    id: 'canvassing',
    category: 'engagement',
    title: 'Canvassing: turfs, the Companion, and the field report',
    summary:
      'Cut a smart list into walkable turfs, send them to volunteers on the Canvass Companion, and watch every knock sync back live.',
    keywords: ['canvass', 'canvassing', 'turf', 'door', 'knock', 'walk', 'field', 'companion', 'volunteer', 'gotv'],
    related: ['teams', 'lists', 'events-shifts'],
    blocks: [
      {
        kind: 'p',
        text: 'Open [Canvassing](/canvassing) under **Field** in the sidebar. The header sentence sums up the whole operation at a glance: how many turfs exist, how many are in the field now, how many doors have been attempted, and how many turfs are still waiting for a canvasser.',
      },
      { kind: 'h2', id: 'cut', text: 'Cut turfs from a list' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Click **Cut new turfs**',
            detail: 'Pick a universe: any [smart list](/lists) of the people (or households) you want knocked.',
          },
          {
            title: 'Choose doors per turf',
            detail:
              '30 for a short shift, 40 recommended, 50 for experienced canvassers, 60 for pairs. The preview does the math in the open and estimates the walk time.',
          },
          {
            title: 'Confirm',
            detail:
              'Turfs are cut from your located households into contiguous, walkable groups that never cross a hard barrier like a highway, rail line, or river. New turfs land as Draft, unassigned.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Only located doors get cut',
        text: 'A turf is built from households the app has geocoded. Addresses still being located are reported in the preview and join a turf once they resolve. Nothing is silently dropped.',
      },
      { kind: 'h2', id: 'assign', text: 'Assign turfs to volunteers' },
      {
        kind: 'p',
        text: '**Assign** opens a picker: choose the person the turf belongs to, and the app mints their personal Companion link, **sends it to them automatically** by email and text (whichever contacts their [person record](/people) has on file), and copies it to your clipboard as a backup. Links are personal on purpose: the volunteer proves it’s them with a one-time code sent to the same email or mobile, and a brand-new volunteer needs a one-time admin approval on the Volunteer access page before the turf loads. Keep a turf in sync with its list any time with **Refresh from list**. It pulls in new matching doors without ever losing knock history.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Before you assign',
        text: 'Make sure the volunteer’s person record has an email or mobile number. That’s where their link and verification code go. No contact on file means nothing can be sent and the link can’t be opened — the app warns you and leaves the copied link for you to deliver another way.',
      },
      { kind: 'h2', id: 'companion', text: 'The Canvass Companion' },
      {
        kind: 'p',
        text: 'The Companion is a web app, nothing to install. After verifying, the volunteer lands on their assignment, taps **Start walking**, and works the door list in the suggested walk order (any order works). At each door they survey the people on file (support level, top issues, follow-up flags, and notes) or record a one-tap result like not home or moved. Door-level outcomes (nobody home, inaccessible, refused) close a door with one tap and can be cleared just as fast, and “+ Add someone at this door” captures a new name on the spot. Every result syncs live to the person, the household, the turf’s progress, and the Activity log, attributed honestly as “via Canvass Companion”. No signal? Results queue on the phone and upload automatically when the volunteer is back online.',
      },
      {
        kind: 'p',
        text: 'Survey answers do real work: a support level updates the person’s support reading for the turf’s [campaign](/workspace/campaigns), **Wants a yard sign** drops a request straight into the [Deliveries](/deliveries) intake pool, **Wants to volunteer** sets their volunteer status to Prospective on the person record, contact details fill in blanks on the person record, and **Do not contact** suppresses them everywhere, immediately.',
      },
      {
        kind: 'p',
        text: '**Survey settings** (top of the Canvassing page) controls what canvassers see: the top-issues chips they can tag and the door script that opens every survey, both scoped to the campaign the turf was cut for.',
      },
      { kind: 'h2', id: 'report', text: 'The field report' },
      {
        kind: 'p',
        text: 'The **Field report** tab turns those knocks into the picture of the operation: doors, conversations, contact rate and support IDs; what voters said at the door; doors knocked per day; performance by team; when doors answer best; and your top canvassers. Change the range or **Export CSV** for the raw numbers by team and by day. Every figure flows in from synced Companions. Nothing is entered by hand.',
      },
      {
        kind: 'p',
        text: 'The **Coverage** card shows where you have actually walked. On the **Street map** every door is a dot (green where a volunteer had a conversation, amber where they knocked and got no answer, and grey where no one has been yet), with each turf drawn as a dashed boundary. Flip to **By ward** for the same picture as a table: doors, how much of each ward has been knocked, and how many are still waiting. Like the rest of the report it follows the range you pick, and it appears as soon as turfs are cut, even before the first knock.',
      },
    ],
  },
  {
    id: 'deliveries',
    category: 'engagement',
    title: 'Deliveries and volunteer routes',
    summary:
      'Collect delivery requests, turn approved ones into about-an-hour driving routes, and hand each route to a volunteer through a private link, no volunteer account needed.',
    keywords: ['yard sign', 'delivery', 'route', 'volunteer', 'sign', 'drive', 'stops', 'plan routes', 'canvass drop'],
    related: ['events-shifts', 'teams', 'forms', 'households'],
    blocks: [
      {
        kind: 'p',
        text: 'Deliveries turns sign requests into optimized driving routes and hands each one to a volunteer. Open [Deliveries](/deliveries) under **Field** in the sidebar. The badge shows how many requests are approved and ready to route. A **Requests / Routes** switch at the top of the page flips between the incoming request pool and the routes you have already planned. The **Plan routes** button stays disabled until at least one request is approved and located. There is nothing to route before then.',
      },
      { kind: 'h2', id: 'requests', text: 'Requests: approve what comes in' },
      {
        kind: 'p',
        text: 'Every request is tied to a household, so its map location comes from the household’s address. The **Readiness** chip tells you the geocode state (**Located**, **Locating…**, or **Address problem**), and a request must be approved and located to be routed. Select rows and use **Approve** or **Decline** in the selection bar; the count is repeated on every button.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Address problem?',
        text: 'A request that can’t be located shows an **Edit household** link right on the row. Fixing the address there re-triggers geocoding automatically. The request becomes routable on its own.',
      },
      { kind: 'h2', id: 'plan', text: 'Plan routes (preview first)' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Click Plan routes · N ready',
            detail:
              'Set the start address drivers leave from. Start typing and pick a suggested address. It’s remembered for next time.',
          },
          {
            title: 'Preview routes',
            detail:
              'Preview is a pure calculation. It doesn’t save anything. You’ll see proposed routes, per-stop travel times, and an honest explanation of anything that couldn’t fit.',
          },
          {
            title: 'Create N routes',
            detail: 'Only now is anything saved. All the routes are created together and you land on the routes list.',
          },
        ],
      },
      { kind: 'h2', id: 'assign', text: 'Assign and share' },
      {
        kind: 'p',
        text: 'On a route, assign the volunteer first. The link is personal to them. Click **Assign** next to Volunteer, search by name or email, and pick the person (use **Change** or **Remove volunteer** to swap or clear them later). Assigning **sends the volunteer their private link automatically** by email and text, using whichever contacts their person record has on file — no contact on file, and the app warns you to share the link yourself via **Copy volunteer link** (note that copying mints a fresh link, which replaces the one that was sent). If the message went missing — or the volunteer’s contact details changed — pick **Resend link to volunteer** from the route’s ⋯ menu: it emails/texts them a fresh link (the old one stops working). The link expires after 30 days as a security safeguard, unless an administrator turns expiry off under **Workspace → App** (handy when routes run longer than a month). You can do all of this without opening the route: the **Routes** list has an inline **Assign** on any unassigned row, and each row’s ⋯ menu covers assign/change volunteer, copy or resend the link, and cancel or delete the route. Like the Canvass Companion, the volunteer verifies a one-time code sent to their email or mobile on file, and a first-time volunteer needs a one-time admin approval on the Volunteer access page. **Open in Google Maps** launches turn-by-turn for the whole route. Reorder the stops that are still pending by dragging one by its handle, or use the up and down arrows for the same move by keyboard; delivered and skipped stops stay where they are. Either way the estimate recomputes for you. Revoke or regenerate the link any time from the ⋯ menu.',
      },
      { kind: 'h2', id: 'deliver', text: 'Volunteers deliver' },
      {
        kind: 'p',
        text: 'The volunteer opens the link on their phone and works one stop at a time: **Mark delivered**, **Couldn’t deliver** (with a reason), or **Skip for now** (moves the house to the end). The page shows first name and address only, never a constituent’s email or phone. Undo is available on any delivered or skipped stop, even after closing and reopening the page. A house reported undeliverable returns to your planning pool automatically, and when every stop is handled the route finishes itself.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'One source of truth',
        text: 'A request is “on a route” only while it has an active stop. There’s no separate flag to fall out of sync. Skip or remove a stop and the request is instantly back in the pool for the next batch.',
      },
      { kind: 'h2', id: 'standing', text: 'Yard sign standing on profiles' },
      {
        kind: 'p',
        text: 'You don’t have to open Deliveries to check a sign. Every household page carries a **Yard sign** card, and every person page shows the same control inside the **Campaign standing** card, right next to support level and voting status. It reads straight from the request pool for the campaign you are working in: **None requested**, **Requested**, **Approved**, **Declined**, or **Delivered**, with who asked, where it came from, and a link to the route it is riding on.',
      },
      {
        kind: 'p',
        text: 'Flip the status yourself when reality happens outside the app. Pick **Delivered** if someone installed a sign by hand, or record a brand-new request for a household that asked in person. If the house is sitting on an active route when you mark it delivered, the route’s stop is marked delivered too, so volunteer progress stays truthful. The change lands in the household’s and requester’s activity history.',
      },
    ],
  },
];
````

## File: libs/common/src/lib/kysely.models.ts
````typescript
// tsco:ignore
/* eslint-disable @typescript-eslint/no-explicit-any */
//
// ====================================================================
// When adding a new table, you have to  :-
// 1. Add a model and add it to the interface Models

// ====================================================================
import type {
  ColumnType,
  Insertable,
  OperandValueExpressionOrList,
  SelectExpression,
  Selectable,
  Updateable,
} from 'kysely';
import type { EmailStatus } from './emails';
import type { z } from 'zod';
import type { addressSchema } from './schema';

export type Keys<T> = keyof T;
type Json = ColumnType<JsonValue, string, string>;
type JsonArray = JsonValue[];
type JsonObject = { [K in string]?: JsonValue };
type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonArray | JsonObject | JsonPrimitive;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U> ? ColumnType<S, I | undefined, U> : ColumnType<T, T | undefined, T>;

export interface Models {
  authusers: AuthUsers;
  campaign_person_facts: CampaignPersonFacts;
  campaign_subscriptions: CampaignSubscriptions;
  campaigns: Campaigns;
  email_suppressions: EmailSuppressions;
  households: Households;
  map_campaigns_users: MapCampaignsUsers;
  map_households_tags: MapHouseholdsTags;
  map_peoples_tags: MapPeoplesTags;
  map_roles_users: MapRolesUsers;
  lists: Lists;
  map_lists_persons: MapListsPersons;
  map_lists_households: MapListsHouseholds;
  teams: Teams;
  map_teams_persons: MapTeamsPersons;
  map_teams_lists: MapTeamsLists;
  map_newsletters_lists: MapNewslettersLists;
  map_web_forms_lists: MapWebFormsLists;
  tasks: Tasks;
  persons: Persons;
  profiles: Profiles;
  roles: Roles;
  sessions: Sessions;
  tags: Tags;
  tenants: Tenants;
  workspace_api_keys: WorkspaceApiKeys;
  settings: Settings;
  donations: Donations;
  donation_periods: DonationPeriods;
  donation_pledges: DonationPledges;
  emails: Emails;
  newsletters: Newsletters;
  newsletter_templates: NewsletterTemplates;
  newsletter_events: NewsletterEvents;
  newsletter_send_log: NewsletterSendLog;
  newsletter_content_checks: NewsletterContentChecks;
  person_newsletter_engagements: PersonNewsletterEngagements;
  email_comments: EmailComments;
  email_bodies: EmailBodies;
  email_headers: EmailHeaders;
  email_recipients: EmailRecipients;
  email_attachments: EmailAttachments;
  email_drafts: EmailDrafts;
  email_trash: EmailTrash;
  email_read_states: EmailReadStates;
  task_comments: TaskComments;
  task_subtasks: TaskSubtasks;
  task_attachments: TaskAttachments;
  user_activity: UserActivity;
  ms_oauth_tokens: MsOauthTokens;
  google_oauth_tokens: GoogleOauthTokens;
  data_imports: DataImports;
  companies: Companies;
  files: Files;
  bug_reports: BugReports;
  notifications: Notifications;
  volunteer_events: VolunteerEvents;
  volunteer_shifts: VolunteerShifts;
  events: Events;
  event_ticket_types: EventTicketTypes;
  event_registrations: EventRegistrations;
  web_forms: WebForms;
  form_submissions: FormSubmissions;
  background_jobs: BackgroundJobs;
  webhook_events: WebhookEvents;
  ops_heartbeats: OpsHeartbeats;
  data_exports: DataExports;
  potential_duplicates: PotentialDuplicates;
  dismissed_duplicate_groups: DismissedDuplicateGroups;
  workflows: Workflows;
  workflow_steps: WorkflowSteps;
  workflow_enrollments: WorkflowEnrollments;
  workflow_runs: WorkflowRuns;
  person_connections: PersonConnections;
  passkeys: Passkeys;
  zapier_subscriptions: ZapierSubscriptions;
  turfs: Turfs;
  turf_households: TurfHouseholds;
  turf_assignments: TurfAssignments;
  turf_knocks: TurfKnocks;
  delivery_requests: DeliveryRequests;
  delivery_routes: DeliveryRoutes;
  delivery_route_stops: DeliveryRouteStops;
  companion_volunteers: CompanionVolunteers;
  companion_sessions: CompanionSessions;
  companion_ops: CompanionOps;
}

export type AuthUsersType = Omit<AuthUsers, 'id'> & { id: string };

export type GetOperandType<
  T extends Keys<TablesOperationMap>,
  Op extends Keys<TablesOperationMap[T]>,
  Key extends Keys<TablesOperationMap[T][Op]>,
> = unknown extends TablesOperationMap[T][Op][Key]
  ? never
  : TablesOperationMap[T][Op][Key] extends never
    ? never
    : TablesOperationMap[T][Op][Key];

export type OperationDataType<
  T extends Keys<Models>,
  Op extends 'select' | 'update' | 'insert',
> = TablesOperationMap[T][Op];

export type TypeId<T extends keyof Models> = string & { _table?: T };
export type TypeTenantId<T extends keyof Models> = string & { _table?: T };

type ExtractTableAlias<DB, TE> = TE extends `${string} as ${infer TA}`
  ? TA extends keyof DB
    ? TA
    : never
  : TE extends keyof DB
    ? TE
    : never;

export type TypeColumn<T extends keyof Models, U> = OperandValueExpressionOrList<
  Models,
  ExtractTableAlias<Models, T>,
  U
>;
export type TypeTableColumns<T extends keyof Models> = T extends keyof Models
  ? SelectExpression<Models, ExtractTableAlias<Models, T>>
  : never;

export type TablesOperationMap = {
  [K in Keys<Models>]: {
    select: Selectable<Models[K]>;
    insert: Insertable<Models[K]> & { tenant_id: string };
    update: Updateable<Models[K]>;
  };
};

export type TypeColumnValue<TTable extends keyof Models, TColumn extends keyof Models[TTable]> = UnwrapSelect<
  Models[TTable][TColumn]
>;

/*
type TableType = {
  [K in Keys<Models>]: K;
};
*/

// ====================================================================
// The following are the type definitions for the database schema
// Since I use a base controller to handle the CRUD operations, I don't
// know the exact type of the table until runtime. So I use the following
// type definitions to help me out.
// ====================================================================
interface RecordType {
  id: Generated<string>;
  tenant_id: string;
  createdby_id: string;
  updatedby_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface JunctionRecordType {
  tenant_id: string;
  createdby_id: string;
  updatedby_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
export type AddressType = z.infer<typeof addressSchema>;

interface AuthUsers extends RecordType {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  password_reset_code: string | null;
  // TODO: move to Sessions
  password_reset_code_created_at: Timestamp | null;
  role: string | null;
  verified: boolean;
  two_factor_enabled: boolean;
  two_factor_code: string | null;
  two_factor_expires_at: Timestamp | null;
  two_factor_attempts: Generated<number>;
  deletion_scheduled_at: Timestamp | null;
  /** Admin deactivation: set = can't sign in until an admin/owner reactivates. NULL = active. */
  deactivated_at: Timestamp | null;
  previous_email: string | null;
  previous_role: string | null;
  passkey_setup_dismissed_at: Timestamp | null;
  /**
   * Campaigns §15 — admin-assigned campaign for Editors/Viewers; NULL = the
   * permanent office context. Ignored for admins/owners (they see every campaign).
   */
  campaign_id: string | null;
}

/** Per-campaign email CONSENT (§15). Address health lives in EmailSuppressions; DNC on Persons. */
interface CampaignSubscriptions extends RecordType {
  campaign_id: string;
  person_id: string;
  email: string;
  /** 'subscribed' | 'pending' (double opt-in) | 'unsubscribed'. Sendable = subscribed. */
  status: Generated<string>;
  /** 'form' (express) | 'import' | 'manual' (implied) | 'copied' (carry-over). */
  consent_source: Generated<string>;
  consent_at: Timestamp | null;
  unsubscribed_at: Timestamp | null;
}

/** Global per-address suppression (§15): a hard bounce / spam complaint kills the address everywhere. */
interface EmailSuppressions {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  reason: string;
  occurred_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

/** Campaign-scoped person facts (§15): support level + voting status. No row / NULL = Unknown. */
interface CampaignPersonFacts extends RecordType {
  campaign_id: string;
  person_id: string;
  support_level: string | null;
  support_source: string | null;
  support_recorded_by: string | null;
  support_recorded_at: Timestamp | null;
  voting_status: string | null;
  voting_source: string | null;
  voting_recorded_by: string | null;
  voting_recorded_at: Timestamp | null;
}

interface Campaigns extends Omit<RecordType, 'createdby_id'> {
  admin_id: string;
  createdby_id: string;
  description: string | null;
  startdate: string | null;
  enddate: string | null;
  name: string;
  notes: string | null;
  /** 'office' = the permanent constituency-office context; 'election' = a time-bounded run. */
  kind: Generated<string>;
  /** 'active' | 'archived' — archived campaigns are read-only history. */
  status: Generated<string>;
  /** Issue-chip vocabulary shown in the canvass companion survey (spec §3.5). */
  canvass_issues: Generated<string[]>;
  /** Door script shown (collapsible) at the top of the companion survey. */
  canvass_script: string | null;
}

export interface Households extends Omit<RecordType, 'createdby_id'>, AddressType {
  /** Provenance only ("first captured in") — households are tenant-wide, never campaign-scoped. */
  campaign_id: string | null;
  createdby_id: string;
  file_id: string | null;
  home_phone: string | null;
  notes: string | null;
  address_fp_street: string | null;
  address_fp_full: string | null;
  is_placeholder?: boolean;
  district: string | null;
  precinct: string | null;
  ward: string | null;
  geocoding_status: string | null;
  /** URL slug, unique per tenant (spec §1). Generated app-side — see lib/slug.ts. */
  slug: string | null;
}

interface MapCampaignsUsers extends Omit<JunctionRecordType, 'createdby_id' | 'updatedby_id'> {
  campaign_id: string;
  user_id: string;
}

interface MapHouseholdsTags extends JunctionRecordType {
  household_id: string;
  tag_id: string;
}

export interface MapPeoplesTags extends JunctionRecordType {
  person_id: string;
  tag_id: string;
  deletable: Generated<boolean>;
}

interface MapRolesUsers extends JunctionRecordType {
  role_id: string;
  user_id: string;
}

interface Teams extends RecordType {
  name: string;
  description: string | null;
  team_captain_id: string | null;
  team_lead_user_id: string | null;
}

interface MapTeamsPersons extends JunctionRecordType {
  team_id: string;
  person_id: string;
}

// Deliveries (spec §14). "routed" is intentionally NOT a column on delivery_requests — it is
// derived from an active (pending) delivery_route_stops row (one source of truth).
export interface DeliveryRequests extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  household_id: string;
  person_id: string | null;
  web_form_id: string | null;
  // 'canvass' = raised at the door via the Canvass Companion survey (spec §3.6). The DB CHECK
  // (migration 2026-07-12-companion-apps.ts) allows it; keep this union in lockstep with that CHECK.
  source: Generated<'web_form' | 'manual' | 'canvass'>;
  status: Generated<'new' | 'approved' | 'declined' | 'delivered'>;
  notes: string | null;
  skip_reason: string | null;
}

export interface DeliveryRoutes extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  status: Generated<'draft' | 'assigned' | 'in_progress' | 'completed' | 'canceled'>;
  volunteer_person_id: string | null;
  start_address: string;
  start_lat: number;
  start_lng: number;
  est_minutes: Generated<number>;
  est_km: Generated<number>;
  scheduled_for: Timestamp | null;
  // Only the sha256 hash of the raw capability token is ever stored; the raw token is returned once.
  share_token_hash: string | null;
  share_token_expires_at: Timestamp | null;
  params: Generated<Json>;
}

export interface DeliveryRouteStops extends RecordType {
  route_id: string;
  request_id: string;
  seq: number;
  leg_minutes: Generated<number>;
  status: Generated<'pending' | 'delivered' | 'skipped'>;
  reason: string | null;
  acted_at: Timestamp | null;
  acted_via: 'volunteer_link' | 'staff' | null;
}

interface MapTeamsLists extends JunctionRecordType {
  team_id: string;
  list_id: string;
}

/**
 * Canvassing §13. A turf is a geographic slice of a smart-list universe cut into
 * a walkable door list. `status` is the stored lifecycle only —
 * 'draft' (unassigned) | 'active' (assigned/in the field) | 'retired'. Display
 * state ("In field now", "Complete") and all progress numbers are DERIVED from
 * turf_knocks at read time, never stored here (§22.6).
 */
interface Turfs extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  status: string;
  list_id: string | null;
  target_doors: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  ward: string | null;
  notes: string | null;
}

/** The doors of a turf — one row per household. */
interface TurfHouseholds extends JunctionRecordType {
  turf_id: string;
  household_id: string;
  /** Suggested visiting order (1-based), computed at cut/assign time. A hint, never a lock. */
  walk_order: number | null;
}

/** A turf handed to a team and/or opened via a tokenised Companion link. */
interface TurfAssignments extends RecordType {
  turf_id: string;
  team_id: string | null;
  token: string;
  status: string;
  assigned_at: Timestamp;
  /** The person this link belongs to — the companion access layer verifies against them. */
  volunteer_person_id: string | null;
  /** Optional hard expiry for the capability link (companion access layer). */
  expires_at: Timestamp | null;
}

/**
 * Companion access layer (COMPANION-APPS-PLAN.md §2): one row per (tenant,
 * person) who has ever been sent a companion link. `status` is the approval
 * lifecycle — 'invited' → 'verified' (code confirmed, awaiting admin) →
 * 'approved' | 'revoked'. Approval is per volunteer, not per assignment.
 */
interface CompanionVolunteers {
  id: Generated<string>;
  tenant_id: string;
  person_id: string;
  status: Generated<string>;
  verify_code_hash: string | null;
  verify_code_expires_at: Timestamp | null;
  verify_attempts: Generated<number>;
  verify_channel: 'email' | 'sms' | null;
  verified_at: Timestamp | null;
  approved_by: string | null;
  approved_at: Timestamp | null;
  revoked_at: Timestamp | null;
  createdby_id: string | null;
  updatedby_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** A verified companion device — only the sha256 of the session token is stored. */
interface CompanionSessions {
  id: Generated<string>;
  tenant_id: string;
  volunteer_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * Write-once idempotency ledger for volunteer actions (both companions).
 * Insert ON CONFLICT DO NOTHING; a conflict means "op already applied".
 */
interface CompanionOps {
  tenant_id: string;
  op_id: string;
  scope: 'canvass' | 'deliveries';
  created_at: Generated<Timestamp>;
}

/** One door interaction, synced live from a Canvass Companion. */
interface TurfKnocks extends RecordType {
  turf_id: string;
  household_id: string;
  person_id: string | null;
  outcome: string;
  response: string | null;
  notes: string | null;
  source: string;
  canvasser_name: string | null;
  client_knock_id: string | null;
  knocked_at: Timestamp;
  /** Issue chips picked in the survey (campaign-configured vocabulary). */
  issues: Generated<string[]>;
  /** Follow-up toggles from the survey (spec §3.5). */
  wants_volunteer: Generated<boolean>;
  wants_yard_sign: Generated<boolean>;
  set_dnc: Generated<boolean>;
  /** Contact info captured at the door (also applied to the person if blank there). */
  contact_phone: string | null;
  contact_email: string | null;
  subscribe: Generated<boolean>;
}

export interface MapListsPersons extends JunctionRecordType {
  list_id: string;
  person_id: string;
}

interface MapListsHouseholds extends JunctionRecordType {
  list_id: string;
  household_id: string;
}

/**
 * Normalized newsletter list targeting (replaces the JSONB
 * newsletters.target_lists document as the source of truth). `mode` carries
 * the {include, exclude} split; list_id/newsletter_id cascade on delete.
 */
export interface MapNewslettersLists extends JunctionRecordType {
  newsletter_id: string;
  list_id: string;
  mode: Generated<'include' | 'exclude'>;
}

/**
 * Normalized web-form list targeting (replaces the JSONB
 * web_forms.target_lists document as the source of truth).
 */
export interface MapWebFormsLists extends JunctionRecordType {
  web_form_id: string;
  list_id: string;
}

export interface Persons extends Omit<RecordType, 'createdby_id'> {
  /** Provenance only ("first captured in") — persons are tenant-wide, never campaign-scoped. */
  campaign_id: string | null;
  /** Global compliance override (§15): suppresses contact in every campaign context. */
  do_not_contact: Generated<boolean>;
  /** Channels the DNC applies to ('email' | 'phone' | 'door'); null = all channels. */
  do_not_contact_channels: string[] | null;
  /** Global volunteer standing (§15); null = not a volunteer. Retired the volunteer system tag (2026-07-12). */
  volunteer_status: string | null;
  /** Global staff standing (§15); null = not staff. Retired the staff system tag (2026-07-12). */
  staff_status: string | null;
  household_id: string | null;
  createdby_id: string;
  first_name: string | null;
  middle_names: string | null;
  last_name: string | null;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  home_phone: string | null;
  file_id: string | null;
  company_id: string | null;
  notes: string | null;
  linkedin: string | null;
  twitter: string | null;
  facebook: string | null;
  instagram: string | null;
  assigned_to: string | null;
  preferred_contact: string | null;
  /**
   * Opaque public identifier — 8 Crockford Base32 chars (40 CSPRNG bits),
   * unique per tenant, the canonical person lookup key (spec §1). Generated
   * app-side and NEVER changes — see lib/person-public-id.ts.
   */
  public_id: string | null;
  /**
   * URL display slug `{name}-{xxxx}-{xxxx}` (spec §1: /people/joseph-4t9k-2xpm).
   * The name is decorative; resolution is by public_id. Regenerated on rename,
   * app-side — see lib/person-public-id.ts.
   */
  slug: string | null;
}

interface Profiles extends RecordType, AddressType {
  auth_id: string;
  avatar_file_id: string | null;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  home_phone: string | null;
  /** Typed contract: ProfilePreferencesObj ({ notifications: {...} }). */
  preferences: Json | null;
}

interface Settings extends Omit<RecordType, 'createdby_id' | 'updatedby_id'> {
  key: string;
  value: JsonValue;
  createdby_id: string | null;
  updatedby_id: string | null;
}

export interface Donations extends Omit<RecordType, 'createdby_id' | 'updatedby_id'> {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  person_id: string | null;
  amount: number;
  status: Generated<string>;
  stripe_session_id: string | null;
  /** Stripe PaymentIntent id, used to correlate refund/dispute webhooks back to this gift. */
  stripe_payment_intent_id: string | null;
  /** When a refund or lost chargeback reversed this gift; null while it stands. */
  refunded_at: ColumnType<Date, Date | string, Date | string> | null;
  pledge_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  street: string | null;
  apt: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  method: Generated<string>;
  receipt_sent: Generated<boolean>;
}

export interface DonationPeriods extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  start_date: ColumnType<Date, Date | string, Date | string>;
  end_date: ColumnType<Date, Date | string, Date | string> | null;
  limit_amount: number;
  is_active: Generated<boolean>;
}

export interface DonationPledges extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  person_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  monthly_amount: number;
  status: Generated<string>;
  started_at: Generated<Timestamp>;
  cancelled_at: Timestamp | null;
  next_billing_date: ColumnType<Date, Date | string, Date | string> | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  state: string | null;
  country: string | null;
}

interface Roles extends RecordType {
  name: string;
  description: string | null;
  permissions: Json | null;
}

interface Sessions extends Omit<RecordType, 'createdby_id' | 'updatedby_id' | 'updated_at'> {
  session_id: Generated<string>;
  user_id: string;
  ip_address: string;
  last_accessed: Generated<Timestamp>;
  other_properties: Json | null;
  refresh_token: Generated<string>;
  status: string;
  user_agent: string;
  expires_at: Timestamp | null;
  last_used_at: Timestamp | null;
}

export interface Lists extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  description: string | null;
  object: 'people' | 'households';
  is_dynamic: boolean;
  definition: Json | null;
  last_refreshed_at: Timestamp | null;
  status: Generated<'idle' | 'refreshing' | 'failed'>;
}

export interface Tags extends RecordType {
  name: string;
  description: string | null;
  color: string | null;
  deletable: boolean;
  type: Generated<'tag' | 'issue'>;
}

export interface Tasks extends RecordType {
  name: string;
  details?: string;
  due_at: Timestamp | null;
  /** Canonical vocabulary: TASK_STATUSES in libs/common/src/lib/schemas/tasks.schema.ts. */
  status: 'todo' | 'in_progress' | 'waiting' | 'done' | 'archived' | null;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  completed_at: Timestamp | null;
  position: number | null;
  assigned_to: string | null;
  team_id: string | null;
  file_id: string | null;
  /** Optional link to the contact the task is about — the person the task_sla_breach automation enrolls. */
  person_id: string | null;
  /** Once-only marker: when the hourly scan first found this task past its working-hours SLA target. */
  sla_breached_at: Timestamp | null;
}

// Unlike every other record table, tenants.createdby_id is NULLABLE in the schema — the tenant
// row is created before its first user, and the hard-delete job nulls it to break the
// fk_createdby_id cycle before wiping authusers.
interface Tenants extends Omit<RecordType, 'createdby_id'>, AddressType {
  createdby_id: string | null;
  name: string;
  slug: string | null;
  admin_id: string | null;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  notes: string | null;
  placeholder_household_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  /** Billed Stripe quantity (1-based bracket index — see libs/common/src/lib/billing/plans.ts).
   * Authoritatively synced from the Stripe webhook; defaults to 1. */
  subscription_quantity: number;
  /** Billing interval of the current subscription: 'month' (default) or 'year' (annual = 10×
   * monthly, "2 months free"). Synced from the Stripe price on webhooks. */
  subscription_interval: string;
  subscription_ends_at: Timestamp | null;
  deletion_scheduled_at: Timestamp | null;
  suspended_at: Timestamp | null;
  paused_at: Timestamp | null;
  /** Demo mode: set while the seeded test-drive data is present; NULL = exited/never. */
  demo_mode_at: Timestamp | null;
  /** Automated anti-abuse pause (hard-bounce tripwire): blocks newsletter sending only.
   * Distinct from the user-initiated `paused_at` and the sign-in-blocking `suspended_at`. */
  sending_paused_at: Timestamp | null;
  sending_paused_reason: string | null;
  /** Verified sending phone (E.164) — free tenants must verify one before their first bulk send. */
  sending_phone: string | null;
  sending_phone_verified_at: Timestamp | null;
  pending_phone: string | null;
  phone_verification_code_hash: string | null;
  phone_verification_expires_at: Timestamp | null;
  phone_verification_attempts: Generated<number>;
}

interface WorkspaceApiKeys {
  id: Generated<string>;
  tenant_id: string;
  key_hash: string;
  key_preview: string;
  created_at: Generated<Timestamp>;
  last_used_at: Timestamp | null;
}

interface Emails extends RecordType {
  /** The campaign context this email was synced into (§15). */
  campaign_id: string;
  folder_id: string;
  from_email: string | null;
  /** Display-only cache of the To list; email_recipients is the source of truth (D-10). */
  to_email: string | null;
  subject: string | null;
  preview: string | null;
  assigned_to: string | null;
  is_favourite: boolean;
  deleted_at: Timestamp | null;
  status: EmailStatus | null;
}

interface Newsletters extends RecordType {
  /** The context this newsletter belongs to (§15); recipients are filtered by its consent. */
  campaign_id: string;
  name: string;
  status: string;
  subject: string | null;
  preview_text: string | null;
  audience_description: string | null;
  target_lists: Json | null;
  segments: Json | null;
  total_recipients: Generated<number>;
  delivered_count: Generated<number>;
  bounce_count: Generated<number>;
  open_rate: Generated<number>;
  click_rate: Generated<number>;
  unique_opens: Generated<number>;
  unique_clicks: Generated<number>;
  unsubscribe_count: Generated<number>;
  spam_complaint_count: Generated<number>;
  reply_count: Generated<number>;
  send_date: Timestamp | null;
  last_engagement_at: Timestamp | null;
  summary: string | null;
  html_content: string | null;
  plain_text_content: string | null;
  top_links: Json | null;
  /** Resume point recorded when a send is paused mid-batch (tripwire/rate-cap); NULL otherwise. */
  send_offset: number | null;
  /** Keyset cursor for the batch send: the last email address successfully sent. The worker
   * resumes with `WHERE email > send_cursor` so a live audience change can't skip/duplicate at a
   * batch boundary. NULL before the first batch and after completion. */
  send_cursor: string | null;
  /** The sent newsletter this row is a non-opener follow-up of; NULL for originals. At most
   * one resend per original (partial unique index). */
  resend_of_id: string | null;
}

/** A user-saved newsletter design. Tenant-wide (no campaign_id — pure content, no audience or
 * consent, so it is a shared asset per Campaigns §15). html_content stores the compiled document
 * verbatim, including the PPLCRM_VISUAL_BLOCKS_DATA comment the visual editor round-trips on. */
interface NewsletterTemplates extends RecordType {
  name: string;
  html_content: string;
  plain_text_content: Generated<string>;
}

export interface NewsletterEvents {
  id: Generated<string>;
  tenant_id: string;
  newsletter_id: string;
  email: string;
  event_type: string;
  sg_event_id: string;
  sg_message_id: string | null;
  url: string | null;
  ip: string | null;
  user_agent: string | null;
  /** SendGrid's human-readable failure reason (bounce/dropped events only). */
  reason: string | null;
  /** SendGrid bounce sub-type: 'bounce' = hard, 'blocked' = soft. */
  bounce_type: string | null;
  timestamp: Timestamp;
  created_at: Generated<Timestamp>;
}

/** One row per delivered newsletter batch — SUM(recipient_count) over a window drives the
 * free-tier warm-up cap and the per-tenant hourly send cap in the outbox worker. Automation
 * send_email steps also log here (source 'automation', no newsletter_id) so automated volume
 * counts toward the same caps. */
export interface NewsletterSendLog {
  id: Generated<string>;
  tenant_id: string;
  newsletter_id: string | null;
  recipient_count: number;
  source: Generated<'newsletter' | 'automation'>;
  created_at: Generated<Timestamp>;
}

/** Cached newsletter preflight result, one row per (tenant, content_hash). The composer's
 * on-demand check upserts here and the send-time content gate reuses the row on a hash match. */
export interface NewsletterContentChecks {
  id: Generated<string>;
  tenant_id: string;
  /** Null until a send (or a check on an existing newsletter) ties the content to a row. */
  newsletter_id: string | null;
  /** sha256 hex over the raw stored subject/html/plain-text fields. */
  content_hash: string;
  score: number;
  band: string;
  /** PreflightFinding[] as JSON. */
  findings: unknown;
  /** AiPreflightVerdict as JSON, null when the AI layer was skipped. */
  ai_verdict: unknown | null;
  ai_model: string | null;
  created_at: Generated<Timestamp>;
}

export interface PersonNewsletterEngagements {
  tenant_id: string;
  newsletter_id: string;
  email: string;
  open_count: number;
  click_count: number;
  has_unsubscribed: boolean;
  hard_bounced: boolean;
  soft_bounced: boolean;
  first_opened_at: Timestamp | null;
  last_opened_at: Timestamp | null;
  first_clicked_at: Timestamp | null;
  last_clicked_at: Timestamp | null;
  bounced_at: Timestamp | null;
  unsubscribed_at: Timestamp | null;
}

interface WebForms extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  description: string | null;
  redirect_url: string | null;
  target_tags: Json | null;
  target_lists: Json | null;
  status: 'draft' | 'published' | 'archived';
  fields: Json | null;
  send_confirmation: boolean;
  send_alert: boolean;
  form_type: string;
  type: string | null;
  slug: string;
  submit_label: string | null;
  thanks_title: string | null;
  thanks_body: string | null;
  confirm_subject: string | null;
  confirm_body: string | null;
  notify_team_on: Generated<boolean>;
  archived_at: Timestamp | null;
}

interface FormSubmissions {
  id: Generated<string>;
  tenant_id: string;
  form_id: string;
  person_id: string;
  answers: Json;
  created_at: Generated<Timestamp>;
}

interface EmailComments extends RecordType {
  email_id: string;
  author_id: string;
  comment: string;
}

interface EmailBodies extends RecordType {
  email_id: string;
  body_html: string;
}

interface EmailHeaders extends RecordType {
  email_id: string;
  headers_json: Json | null;
  raw_headers: string | null;
  date_sent: Timestamp | null;
}

interface EmailRecipients extends RecordType {
  email_id: string;
  kind: 'to' | 'cc' | 'bcc';
  name: string | null;
  email: string;
  pos: number;
}

interface EmailAttachments extends RecordType {
  email_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  cid: string | null;
  is_inline: boolean;
  pos: number;
  file_id: string | null;
}

interface EmailDrafts extends RecordType {
  /** The campaign context this draft belongs to (§15). */
  campaign_id: string;
  user_id: string;
  thread_id: string | null;
  to_list: JsonValue | null;
  cc_list: JsonValue | null;
  bcc_list: JsonValue | null;
  subject: string | null;
  body_html: string | null;
  body_delta: JsonValue | null;
  meta: JsonValue | null;
  is_locked: boolean;
}

interface EmailTrash extends RecordType {
  email_id: string;
  from_folder_id: string;
  trashed_at: Timestamp;
}

export interface EmailReadStates {
  tenant_id: string;
  user_id: string;
  email_id: string;
  is_read: boolean;
  created_at: Generated<Timestamp>;
}

interface UserActivity extends RecordType {
  user_id: string;
  activity: string;
  entity: string;
  entity_id: string | null;
  quantity: number;
  metadata: Json | null;
}

interface DataImports extends RecordType {
  file_name: string;
  source: string;
  /**
   * Tag name requested at import time; label of record once the tag is deleted
   * (tag deletion nulls tag_id). While the tag exists, tags.name via tag_id is
   * the source of truth (D-10).
   */
  tag_name: string | null;
  tag_id: string | null;
  row_count: number;
  inserted_count: number;
  error_count: number;
  skipped_count: number;
  households_created: number;
  metadata: Json | null;
  processed_at: Timestamp;
  status: Generated<string>;
  error_message: string | null;
  /** Rows folded into an existing person via the "Merge into existing" duplicate decision (spec §17). */
  merged_count: Generated<number>;
  /** All tags applied by this import (the wizard allows several comma-separated tags, not just the auto tag). */
  tags_applied: Generated<Json>;
  /** Storage key for the retained original upload — kept 90 days so History can offer a re-download. */
  source_file_key: string | null;
  source_file_size: number | null;
  /** Per-row reasons for skipped rows, so History can offer a "download skipped rows" CSV. */
  skip_reasons: Generated<Json>;
}

export interface DataExports {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  entity: string;
  file_name: string;
  status: Generated<'pending' | 'processing' | 'completed' | 'failed'>;
  row_count: number | null;
  storage_key: string | null;
  columns: ColumnType<string[] | null, string | null, string | null>;
  error: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface BackgroundJobs {
  id: Generated<string>;
  tenant_id: string | null;
  queue: Generated<string>;
  status: Generated<string>;
  payload: Json;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  error: string | null;
  run_at: Generated<Timestamp>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * Global (non-tenant) liveness markers for the in-process background worker. The `ops_watchdog`
 * cron job updates `beat_at` every cycle; `GET /healthz/worker` reports 503 when it goes stale
 * (dead-man's switch for the external availability probe).
 */
export interface OpsHeartbeats {
  name: string;
  beat_at: Generated<Timestamp>;
  details: Json | null;
}

export interface WebhookEvents {
  id: Generated<string>;
  tenant_id: string | null;
  stripe_event_id: string;
  type: string;
  payload: Json;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  error: string | null;
  run_at: Generated<Timestamp>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  processed_at: Timestamp | null;
}

export interface PotentialDuplicates {
  id: Generated<string>;
  tenant_id: string;
  group_key: string;
  person_id: string | null;
  household_id?: string | null;
  company_id?: string | null;
  reason: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** §9.3 Duplicates: a "Not duplicates" dismissal, keyed by the same `group_key` the nightly
 * sweep uses. No surrogate id — `(tenant_id, group_key)` is the natural primary key. */
export interface DismissedDuplicateGroups {
  tenant_id: string;
  group_key: string;
  dismissed_by_id: string;
  dismissed_at: Generated<Timestamp>;
}

interface MsOauthTokens {
  id: Generated<string>;
  tenant_id: string;
  /** The campaign context this mailbox connection belongs to (§15). */
  campaign_id: string;
  user_id: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: Timestamp;
  ms_email: string | null;
  delta_link: string | null;
  synced_at: Timestamp | null;
  last_sync_error: string | null;
  last_sync_error_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface GoogleOauthTokens {
  id: Generated<string>;
  tenant_id: string;
  /** The campaign context this mailbox connection belongs to (§15). */
  campaign_id: string;
  user_id: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: Timestamp;
  google_email: string | null;
  delta_link: string | null;
  synced_at: Timestamp | null;
  last_sync_error: string | null;
  last_sync_error_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TaskComments extends RecordType {
  task_id: string;
  author_id: string;
  comment: string;
}

export interface TaskSubtasks extends RecordType {
  task_id: string;
  name: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled' | null;
  position: number | null;
}

export interface TaskAttachments extends RecordType {
  task_id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  url: string | null;
}

export interface Companies extends RecordType {
  name: string;
  description: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  notes: string | null;
  /** Typed contract: CompanyEnrichmentObj (Google Places enrichment payload). */
  enrichment: Json | null;
  file_id: string | null;
  /** URL slug, unique per tenant (spec §1). Generated app-side — see lib/slug.ts. */
  slug: string | null;
}

export interface Files {
  id: Generated<string>;
  tenant_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_key: string;
  sha256_hex: string | null;
  uploaded_by: string | null;
  /** Polymorphic link — what this file belongs to (e.g. 'newsletter', 'team'). Null for untethered uploads. */
  entity_type: string | null;
  entity_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** User-submitted bug report (fire-and-forget) — stored for the ops record, emailed to OPS_ALERT_EMAIL. */
export interface BugReports {
  id: Generated<string>;
  tenant_id: string;
  created_by: string;
  description: string;
  page_url: string | null;
  user_agent: string | null;
  viewport: string | null;
  screenshot_file_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface Notifications {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface VolunteerEvents extends RecordType {
  name: string;
  description: string | null;
  location_address: string | null;
  start_time: Timestamp;
  end_time: Timestamp;
  capacity: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_private: boolean;
  send_reminder: boolean;
  slug: string;
  send_signup_confirmation: boolean;
  send_volunteer_alert: boolean;
  fields: Generated<string[]>;
}

export interface VolunteerShifts extends RecordType {
  event_id: string;
  person_id: string;
  status: 'signed_up' | 'attended' | 'no_show' | 'cancelled';
  hours_worked: number | null;
  notes: string | null;
}

export interface Events extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  description: string | null;
  location_address: string | null;
  start_time: Timestamp;
  end_time: Timestamp;
  capacity: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  slug: string;
  is_published: Generated<boolean>;
  send_reminder: Generated<boolean>;
  send_registration_confirmation: Generated<boolean>;
  fields: Generated<string[]>;
}

export interface EventTicketTypes extends RecordType {
  event_id: string;
  name: string;
  description: string | null;
  price_cents: Generated<number>;
  capacity: number | null;
  sort_order: Generated<number>;
}

export interface EventRegistrations extends RecordType {
  event_id: string;
  person_id: string;
  ticket_type_id: string | null;
  status: Generated<'registered' | 'attended' | 'no_show' | 'cancelled'>;
  checked_in_at: Timestamp | null;
  notes: string | null;
}

export interface Workflows extends RecordType {
  name: string;
  description: string | null;
  trigger_type: string;
  status: string;
  trigger_event_id: string | null;
  // Spec §16 ONLY ENROLL IF — a QueryBuilder group node (see core.schema QueryBuilderGroupNode).
  conditions: Json | null;
  /** Sequence-level goals (WorkflowExitCondition[] as jsonb) that end an enrollment early. */
  exit_conditions: Json | null;
}

export interface WorkflowSteps {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  step_number: number;
  delay_days: number;
  delay_unit: 'days' | 'hours';
  // Spec §16: steps are polymorphic. `kind` discriminates; the value each kind carries lives
  // in `config` (send_email uses subject/html/text columns; wait uses delay_days/delay_unit).
  kind: 'wait' | 'send_email' | 'add_tag' | 'create_task' | 'notify_team';
  config: Json | null;
  subject: string | null;
  preview_text: string | null;
  html_content: string | null;
  plain_text_content: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// Spec §16: one row per executed step (success, failure, or consent skip) — feeds the list's
// RUNS 30D / LAST RUN and the editor's RECENT RUNS. A failed run records the failing step for
// narration; a skipped run records why the recipient was withheld (unsubscribed/suppressed/DNC).
export interface WorkflowRuns {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  enrollment_id: string | null;
  person_id: string | null;
  step_number: number | null;
  step_kind: string | null;
  status: 'success' | 'failed' | 'skipped';
  error: string | null;
  /** First open/click of the automation email this run sent (stamped by the SendGrid event
   * webhook via the workflow_run_id custom arg). Step conditions and exit goals read these. */
  opened_at: Timestamp | null;
  clicked_at: Timestamp | null;
  /** First hard bounce / spam complaint for the automation email this run sent (stamped by the
   * same webhook). The automation abuse tripwires aggregate these per tenant. */
  bounced_at: Timestamp | null;
  spam_reported_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface WorkflowEnrollments {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  person_id: string;
  status: string;
  current_step_number: number;
  next_run_at: Timestamp | null;
  enrolled_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type RelationType =
  | 'referred_by'
  | 'referred_to'
  | 'close_friend'
  | 'family_member'
  | 'spouse'
  | 'colleague'
  | 'org_affiliation'
  | 'introduced_by'
  | 'introduced_to'
  | 'custom';

export interface PersonConnections extends RecordType {
  from_person_id: string;
  to_person_id: string;
  relation_type: RelationType;
  custom_label: string | null;
  is_mutual: Generated<boolean>;
  notes: string | null;
}

interface Passkeys {
  id: Generated<string>;
  user_id: string;
  tenant_id: string;
  credential_id: string;
  public_key: string;
  counter: Generated<number>;
  device_type: string;
  backed_up: Generated<boolean>;
  transports: string[] | null;
  aaguid: string | null;
  friendly_name: string | null;
  created_at: Generated<Timestamp>;
}

interface ZapierSubscriptions {
  id: Generated<string>;
  tenant_id: string;
  event_type: string;
  webhook_url: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

type UnwrapSelect<T> = T extends ColumnType<infer S, any, any> ? S : T;

type SelectShape<T> = { [K in keyof T]: UnwrapSelect<T[K]> };

export type HouseholdCol = keyof Models['households'];
export type PersonsdCol = keyof Models['persons'];

export type HouseholdWithExtras = SelectShape<Models['households']> & {
  persons_count: number;
  tags: string[] | null;
};
````

## File: libs/common/src/lib/help/articles/outreach.ts
````typescript
import type { HelpArticle } from '../help-types';

export const OUTREACH_ARTICLES: HelpArticle[] = [
  {
    id: 'newsletters',
    category: 'outreach',
    title: 'Create and send a newsletter',
    summary:
      'Template to audience to send: the full path, plus scheduling, resending to non-openers, the compliance footer, and how sending progress is shown.',
    keywords: [
      'newsletter',
      'campaign',
      'email blast',
      'send',
      'schedule',
      'resend',
      'template',
      'saved templates',
      'save as template',
      'audience',
      'unsubscribe',
      'deliverability',
      'score',
    ],
    related: ['lists', 'tags-issues', 'settings', 'automations', 'sending-protections', 'deliverability'],
    blocks: [
      { kind: 'h2', id: 'compose', text: 'From template to draft' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Newsletters](/newsletters) and click New newsletter',
            detail:
              'Start from a template or a blank canvas. Every template card shows a live preview of the design, so you can see what you are picking before you pick it.',
          },
          {
            title: 'Design in the visual editor',
            detail:
              'Drag blocks from the Blocks panel onto the canvas, or click one to add it. Rearrange blocks by their drag handle, and use the plus button between blocks to insert one exactly where you want it. What you see is what subscribers get.',
          },
          {
            title: 'Name it clearly',
            detail: 'The name is how you will find it on the Newsletters page and in its performance stats later.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Personalize with merge fields',
        text: 'Drop a merge field like `{FirstName}` into your copy and each recipient sees their own value. Supported fields are `{FirstName}`, `{LastName}`, `{Name}`, `{Email}` and `{Phone}`. Add a fallback after a pipe for people missing that detail. `{FirstName|there}` becomes "there" when the first name is blank.',
      },
      {
        kind: 'p',
        text: 'Not ready to send? **Save draft** keeps your work, and the newsletter waits on the [Newsletters](/newsletters) list as a **Draft**. Click its name to open it, or **Edit draft** (on the list row or on its page) to pick up where you left off in the editor. Creating and editing newsletters needs a desktop browser; on a phone you can still review drafts, view reports and send a finished draft.',
      },
      { kind: 'h2', id: 'templates', text: 'Save and reuse your own templates' },
      {
        kind: 'p',
        text: 'When a design is worth keeping, click **Save as template** on the Content step and give it a name. It joins the **Your templates** section of the Template step, live preview included, and is shared with everyone in your workspace; selecting it starts the next newsletter from that design. Delete a template from its card when it has outlived its usefulness. Newsletters already created from it keep their content. A workspace can hold up to 50 saved templates.',
      },
      { kind: 'h2', id: 'audience', text: 'Choose the audience' },
      {
        kind: 'p',
        text: 'Audiences are built from your [lists](/help/lists) and refined with tags. Include the tags you want, exclude the ones you do not (exclude always wins). The estimated recipient count updates as you adjust, so you know the reach **before** you send, not after.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Dynamic lists shine here',
        text: 'An audience built on a dynamic list is evaluated fresh. Whoever matches on send day gets the email. No stale rosters.',
      },
      { kind: 'h2', id: 'send', text: 'Send now or schedule for later' },
      {
        kind: 'p',
        text: 'Send now, or pick **Schedule for later** with a date and time; a scheduled newsletter goes out within a few minutes of that time. Until then it shows as **Scheduled** on the [Newsletters](/newsletters) list, where **Cancel schedule** moves it back to drafts; opening it also offers **Send now**. If something blocks a scheduled send when its time comes (a failed deliverability check, a sending pause), it returns to drafts and you are notified with the reason. A finished draft can also go out straight from the list. Its **Send…** button asks you to confirm before anything leaves, and stays disabled (with the reason shown on hover) until the draft has an audience, a subject and content, your workspace has a verified sender address, and your organization’s mailing address is set (it appears in the compliance footer). While a send is running, a progress indicator appears in the top bar. You can keep working anywhere in the app; sending happens in the background.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Newsletter or automation?',
        text: 'Newsletters are calendar-driven: you pick the time, and everyone in the audience gets the same issue. To email each supporter when *they* do something (join, donate, volunteer), use an [Automation](/help/automations) instead.',
      },
      { kind: 'h2', id: 'resend', text: 'Resend to non-openers' },
      {
        kind: 'p',
        text: 'A sent newsletter’s page offers **Resend to non-openers**: one follow-up, only to the people who received it but never opened or clicked it, with a new subject line (required; a fresh angle beats a tweak). Wait two to three days after the original so slow readers have had their chance, and know that each newsletter can be resent only once. Anyone who engages with the original before the resend goes out is dropped automatically. One caveat: Apple Mail marks many emails as opened on its own, so some quiet readers look like openers and will not receive the resend.',
      },
      {
        kind: 'p',
        text: 'After the send, the [Newsletters](/newsletters) page shows each campaign’s status, audience and open/click rates, with all-time totals (sent campaigns, deliveries, average engagement and bounces) summarized at the top. **View report** opens the full engagement report (it appears once a send is underway, since an unsent campaign has nothing to report), and each recipient’s profile lists the send under their **Newsletters** tab.',
      },
      { kind: 'h2', id: 'preflight', text: 'The deliverability check' },
      {
        kind: 'p',
        text: 'The **Review & send** step scores your email **0–100** for deliverability. **80 or higher** means you are good to go; **50–79** lists items worth fixing before you send; **below 50, sending is disabled** until the flagged items are fixed. Every finding shows the points it costs and how to fix it. A quick check runs as you edit; **Run full check** (also next to *Send test email* on the Content step) adds a spam-filter score and an AI review of the copy. See [Get your newsletters delivered](/help/deliverability) for what the checks look for and why.',
      },
      { kind: 'h2', id: 'report', text: 'Read the engagement report' },
      {
        kind: 'p',
        text: 'The report opens with delivered, open rate, click rate, replies and bounces, then breaks the send down: a delivery funnel (sent → delivered → opened → clicked), every bounced address with the provider’s reason and a hard/soft label plus a CSV export, an hour-by-hour chart of the first 48 hours, the top links clicked, and a comparison of the last five sends in the campaign. Bounced addresses that match a person in the CRM link straight to their profile.',
      },
      {
        kind: 'p',
        text: 'The **What to do next** panel turns the numbers into actions: **Create list of N clickers** snapshots everyone who clicked into a static list for the follow-up send, replies link to the [Inbox](/inbox), and the most engaged readers are listed by name. The side panels show the audience composition at send, unsubscribe and spam-report rates, and the exact content that went out. **Duplicate newsletter** starts the next send from a copy of this one.',
      },
      { kind: 'h2', id: 'compliance', text: 'The footer and opt-in rules' },
      {
        kind: 'list',
        items: [
          'Every newsletter goes out with a compliance footer — your organization’s name and mailing address, your footer disclaimer, an unsubscribe link and a small “powered by pplCRM” line — added automatically at send time. The design editor previews it beneath your blocks; it is not an editable block and cannot be removed. Anti-spam laws require the mailing address, so sending stays disabled until an administrator sets it under **Workspace → Organization**; the disclaimer text lives under **Workspace → Communications**.',
          'The default from-name and from-address also live there. Only verified sender addresses can be used, which protects your deliverability.',
          'With **double opt-in** enabled, people who subscribe through a web form must confirm by email before they receive newsletters.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Respect unsubscribes',
        text: 'Unsubscribed people are excluded automatically. Do not re-import or re-tag your way around it. It damages trust and your sender reputation.',
      },
      {
        kind: 'p',
        text: 'Before your first send you will also complete a couple of one-time verifications, and new Free workspaces ramp up gradually — see [Sending protections and verification](/help/sending-protections).',
      },
    ],
  },
  {
    id: 'sending-protections',
    category: 'outreach',
    title: 'Sending protections and verification',
    summary:
      'The one-time verifications required before your first newsletter, the Free-plan warm-up limit, and why sending can pause automatically.',
    keywords: [
      'verify domain',
      'verify phone',
      'sms code',
      'sending paused',
      'suspended',
      'bounce rate',
      'spam complaint',
      'warm-up',
      'daily limit',
      'deliverability',
      'anti-spam',
    ],
    related: ['newsletters', 'settings', 'forms', 'deliverability'],
    blocks: [
      {
        kind: 'p',
        text: 'Every pplCRM newsletter leaves through a shared sending infrastructure, so one bad sender can hurt everyone’s deliverability. These protections keep spammers out — and for a legitimate organization they cost a few minutes, once.',
      },
      { kind: 'h2', id: 'before-first-send', text: 'Before your first send' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Verify your sending domain',
            detail:
              'Under **Workspace → Domains**, add the domain you send from. You’ll get a checklist of **4 required DNS records** to add at your domain provider (GoDaddy, Namecheap, Cloudflare, and similar); use the copy buttons so nothing gets mistyped, then select **Check DNS records**. Changes usually appear within minutes but can take up to 48 hours. A fifth record, DMARC, is recommended but optional; it never blocks verification. Once verified, set a **default From address** on that domain under **Workspace → Communications**. Mail authenticated with your own domain lands in inboxes; unauthenticated mail lands in spam.',
          },
          {
            title: 'Verify a mobile number (Free plan)',
            detail:
              'Under **Workspace → Communications → Sending phone verification**, enter a mobile number and confirm the 6-digit SMS code. One number per workspace, one time.',
          },
        ],
      },
      { kind: 'h2', id: 'warmup', text: 'The Free-plan warm-up' },
      {
        kind: 'p',
        text: 'For the first **7 days**, a Free workspace can send up to **100 newsletter emails per day**. If a send is larger than the day’s remaining allowance, you’ll be told before anything goes out — narrow the audience or wait a day. After the first week the normal plan limits apply.',
      },
      { kind: 'h2', id: 'monthly-allowance', text: 'The monthly email allowance' },
      {
        kind: 'p',
        text: 'Every plan includes a monthly newsletter-email allowance tied to its subscriber bracket: **2×** your subscriber cap on Free, **8×** on Grassroots, and **12×** on Movement — enough for a weekly newsletter with plenty of room to spare. The composer’s **Review & send** step shows exactly how much remains, and a send larger than the remainder is declined with the numbers and the reset date rather than partially sent. Emails sent by [automations](/help/automations) count toward the same allowance and limits. The allowance resets every billing month, and because growing your list moves you up a bracket automatically, it grows with your audience — see [Plans and billing](/help/settings).',
      },
      { kind: 'h2', id: 'content-check', text: 'The content check before every send' },
      {
        kind: 'p',
        text: 'Every send must also clear the **deliverability check**: a 0–100 score built from content best practices, an optional spam-filter score, and an AI review that catches scam-like patterns and content outside the acceptable-use policy. pplCRM sending is for community, political and nonprofit updates — fundraising appeals, auctions and event promotion included; unrelated commercial product blasts are not. Scores **below 50 block the send** on every plan; 50–79 sends with a warning. The AI review runs on every check — the ones you run while drafting and the automatic check on every send. It reads only the newsletter content itself and is processed by Anthropic (listed with our other service providers in the privacy policy). See [Get your newsletters delivered](/help/deliverability).',
      },
      { kind: 'h2', id: 'pauses', text: 'Automatic pauses' },
      {
        kind: 'list',
        items: [
          'If a send’s **hard-bounce rate passes 5%**, sending is paused automatically — a bounce rate that high almost always means the list contains addresses that never opted in. Even a send already in progress stops.',
          'If a send’s **spam-complaint rate passes 1%**, the account is suspended pending a human review.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'How to never hit these',
        text: 'Only email people who opted in through your [forms](/help/forms), events, or sign-ups. Purchased or scraped lists bounce hard and get reported — the tripwires exist precisely to catch them. If your sending was paused and you believe it’s a mistake, contact support.',
      },
      { kind: 'h2', id: 'plan-features', text: 'Plan-gated features' },
      {
        kind: 'p',
        text: 'Some features are enforced by plan: forms, donations, automations, lists and volunteer management (teams and events) need **Grassroots** or higher; canvassing, deliveries and companion volunteer access need **Movement**. See your options under [Workspace → Billing](/workspace/billing).',
      },
    ],
  },
  {
    id: 'deliverability',
    category: 'outreach',
    title: 'Get your newsletters delivered',
    summary:
      'What actually decides inbox versus spam — sender reputation, list quality, engagement — and the content habits the deliverability check scores.',
    keywords: [
      'spam',
      'junk',
      'inbox',
      'deliverability',
      'images',
      'subject line',
      'dmarc',
      'postmaster',
      'score',
      'preflight',
      'open rate',
    ],
    related: ['newsletters', 'sending-protections', 'forms', 'lists'],
    blocks: [
      {
        kind: 'p',
        text: 'Whether an email lands in the inbox is decided mostly by **your sending reputation and how recipients engage** — opens, clicks, replies, deletes and spam reports — not by magic keywords. The content checks below matter, but the foundation is sending mail people asked for, from a domain that vouches for you.',
      },
      { kind: 'h2', id: 'foundation', text: 'The foundation: identity and reputation' },
      {
        kind: 'list',
        items: [
          '**Send from your verified domain.** pplCRM requires this before any broadcast — it is what lets Gmail and Outlook trust the mail is really yours.',
          '**Add a DMARC record.** It is optional for verification but Gmail, Yahoo and Microsoft require it of bulk senders; even a monitor-only policy (`p=none`) counts. Your DNS checklist under **Workspace → Domains** shows the record.',
          '**Keep your identity steady.** Same from-name and address every send, a regular cadence, and no sudden jumps in volume.',
          '**Watch your reputation where the inboxes do.** Enroll your domain in [Google Postmaster Tools](https://postmaster.google.com) — keep the spam-rate graph under 0.1% and never past 0.3%.',
        ],
      },
      { kind: 'h2', id: 'list-quality', text: 'List quality beats everything' },
      {
        kind: 'list',
        items: [
          'Only email people who **opted in** through your [forms](/help/forms), events or sign-ups. Purchased and scraped lists bounce hard, get reported, and trip the automatic pauses.',
          'Unsubscribes and bounces are honored automatically — never re-import around them.',
          'Consider **double opt-in** on public forms, and rest people who have not opened anything in months; mailing the unengaged drags down delivery for everyone else on your list.',
        ],
      },
      { kind: 'h2', id: 'content', text: 'Content habits the check scores' },
      {
        kind: 'list',
        items: [
          '**Subject:** sentence case, under ~70 characters, no stacked exclamation marks or currency symbols, and never a fake “Re:”.',
          '**Body:** keep the HTML under ~100KB (Gmail clips beyond that and hides your footer), and keep a healthy balance of real text to images. A plain-text version is generated automatically for every send.',
          '**Images:** host them on regular `https://` URLs, keep each roughly 600px wide and comfortably under 200KB, and give every image alt text — that is what people see while images load or stay blocked.',
          '**Links:** link real destinations on domains you control — no URL shorteners, no bare IP addresses, and make the visible text match where the link goes.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Test before the big send',
        text: 'Use **Check deliverability** and **Send test email** on the Content step, and read the test in Gmail and Outlook. Small copy fixes before a send are worth more than any amount of analysis after it.',
      },
      { kind: 'h2', id: 'the-check', text: 'How the deliverability check scores you' },
      {
        kind: 'p',
        text: 'The check starts at 100 and subtracts points per finding, each shown with its cost and fix. **80+** is ready to send, **50–79** is worth fixing first, and **below 50 sending is disabled**. The full check adds a spam-filter (SpamAssassin) score and an AI read of the copy that flags deceptive patterns — manufactured urgency, misleading claims, look-alike links — and content outside the acceptable-use policy. Fundraising appeals, donation asks, auctions and event promotion are all normal newsletter content here; unrelated commercial product blasts and anything phishing-shaped are not.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'A good score is not a delivery guarantee',
        text: 'The score covers what can be checked before sending. Reputation and engagement — built over many sends to a clean list — remain the larger factors, which is why the [sending protections](/help/sending-protections) watch bounces and complaints after every send.',
      },
    ],
  },
  {
    id: 'inbox',
    category: 'outreach',
    title: 'The shared inbox',
    summary:
      'Read and answer your organization’s email inside pplCRM, with every conversation attached to the right person.',
    keywords: ['inbox', 'email', 'reply', 'conversation', 'response time', 'sla email', 'correspondence', 'gmail keys'],
    related: ['dashboard', 'person-profile', 'shortcuts', 'settings'],
    blocks: [
      {
        kind: 'p',
        text: 'The [Inbox](/inbox) is a full email client inside the CRM. The difference from a personal mailbox: conversations connect to contact records, so an exchange with a supporter shows up on their profile’s **Emails** tab, context nobody has to forward around. When you open a conversation, a **person context rail** on the right shows who you’re talking to: their tags, issues of interest, and a link straight to their record.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'The Inbox belongs to your active campaign',
        text: 'Each campaign connects its own mailbox and has its own Inbox. Connect an Office 365 or Gmail account while a campaign is active and its mail syncs into that campaign; switch campaigns (from the avatar menu) and both the connected account and the visible mail switch with it. Connect a separate account under each campaign that needs one. Connecting under one campaign never touches another’s.',
      },
      { kind: 'h2', id: 'workflow', text: 'A healthy inbox rhythm' },
      {
        kind: 'list',
        items: [
          'Answer oldest first. Each open conversation shows an **SLA pill** with the time left to reply (it turns amber as the deadline nears, red once it’s overdue), and the [Dashboard](/dashboard) rolls breaches up into a status.',
          'Scan the list by status. Each row carries a chip: **Unassigned** (needs an owner), **Assigned**, or **Closed**. Assigning a conversation to a teammate notifies them in-app and by email (each tunable in their personal notification settings); assigning to yourself stays silent.',
          'Watch your own queue. The **Inbox** entry in the sidebar carries a badge with the open conversations assigned to you — the same count as the **Mine** triage folder.',
          '**Sync now** pulls new mail and reports what changed; the line beneath it shows when the inbox last synced.',
          'While replies are sending, the top bar shows a sending indicator with a count; you can navigate away freely.',
          'Notifications alert you to activity that needs you. Tune them under **Settings** in the avatar menu.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Work it like Gmail',
        text: 'The inbox answers to Gmail-style keys: `c` compose, `r` reply, `e` mark done, `s` star, `j`/`k` next and previous, `#` delete, and more. The full table is in [Keyboard shortcuts](/help/shortcuts), or press `?` right in the inbox.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Where the response target comes from',
        text: 'Administrators set the email SLA in working hours (plus the working days and business hours that count) under **Workspace → SLA Configuration**. See [The dashboard and SLA health](/help/dashboard).',
      },
    ],
  },
  {
    id: 'automations',
    category: 'outreach',
    title: 'Automations',
    summary:
      'Build multi-step workflows that run on their own, triggered manually or by things that happen, like an event signup.',
    keywords: ['automation', 'workflow', 'trigger', 'steps', 'follow up', 'drip', 'automatic'],
    related: ['newsletters', 'events-shifts', 'tasks'],
    blocks: [
      {
        kind: 'p',
        text: 'Automations (under [Automations](/automations) in the sidebar) do the repetitive follow-through for you: the welcome sequence for new subscribers, the thank-you after a gift, the reminder before a shift. The list shows each automation as a one-line recipe (the trigger and its steps) with how many times it ran in the last 30 days and how the last run went. For one update that goes to everyone at a time you pick, use a [newsletter](/help/newsletters) instead; automations are for per-person journeys.',
      },
      { kind: 'h2', id: 'recipes', text: 'Start from a recipe' },
      {
        kind: 'p',
        text: 'New automation offers four ready-made recipes with starter copy: **Welcome new supporters** (three emails over two weeks, ending early if they donate), **Thank every donor** (a same-day thank-you plus a personal-note task), **Follow up after a shift** (thanks, then the next invitation), and **Re-engage quiet supporters** (a gentle win-back where the second email only goes to people who didn’t open the first, and any engagement ends the sequence). A recipe lands as a draft; review every email, adjust the waits, then activate. Or start from scratch with a bare trigger.',
      },
      { kind: 'h2', id: 'anatomy', text: 'Anatomy of an automation' },
      {
        kind: 'list',
        items: [
          '**Trigger** is the one event that lets someone in: Form submitted, Person created, Tag added, List joined, Donation recorded, a billing event, a volunteer shift status, a task breaching its SLA (the person the task is linked to enrolls), a new subscriber or unsubscriber, a supporter going quiet (no opens or clicks for a number of days you choose), or plain Manual enrollment. Everything after the trigger is the sequence.',
          '**Steps**: what happens, in order. Add a **Wait**, **Send email**, **Add tag**, **Create task**, or **Notify team** at any insertion point; waits and actions can be mixed in any order.',
          '**Email conditions**: from the second email on, a Send email step can be gated on what the person did with the previous email in the sequence, for example **Only if they didn’t open the previous email**. Put a Wait before a conditioned email so people have time to engage; a skipped step shows as a neutral **Skipped** with the reason.',
          '**End early when** sets sequence goals on the right rail: end the sequence the moment they donate, open any email in it, or click any email in it. Someone who converts stops getting the rest of the asks.',
          '**Only enroll if** sets optional conditions on the right rail. With none, everyone who hits the trigger enrolls.',
          '**Active / Paused**: Active runs every time the trigger fires. Pausing stops new runs immediately; nothing queues while paused.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Clicks beat opens',
        text: 'Apple Mail opens many emails automatically for privacy, so "opened" over-counts and "didn’t open" reaches fewer people than truly went quiet. When a click is a realistic ask, prefer click-based conditions and goals; they are the reliable signal.',
      },
      { kind: 'h2', id: 'first', text: 'A good first automation' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open [Automations](/automations) and click New automation',
            detail: 'Pick a recipe, or a trigger from the cards. That’s the event that enrolls people.',
          },
          {
            title: 'Build the sequence',
            detail:
              'Use the + between steps to add a wait, an email, a tag, a task, or a team notification. Drag a step by its handle to reorder it; steps run top to bottom.',
          },
          {
            title: 'Name it and set it Active',
            detail:
              'The name is how the list and the Activity log refer to it. Once it’s active it starts watching for the trigger.',
          },
        ],
      },
      { kind: 'h2', id: 'consent', text: 'Consent and sending limits' },
      {
        kind: 'p',
        text: 'Automation emails follow the same rules as newsletters. People who unsubscribed, bounced, or are marked do-not-contact are skipped automatically (the run shows a neutral **Skipped** with the reason, not a failure). Every automation email carries an unsubscribe link and counts toward your plan’s monthly email allowance and sending limits; if your workspace’s sending is paused, the step waits and retries instead of losing the email.',
      },
      { kind: 'h2', id: 'enrolled', text: 'Who’s enrolled' },
      {
        kind: 'p',
        text: 'The Enrolled contacts tab shows who is moving through the sequence and where they are. Enrollment is per contact. Someone already in the sequence isn’t enrolled twice by the same trigger.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Every run is logged',
        text: 'Each step an automation runs is written to the Activity log, and the last run shows on the list. A failure names the step that failed, so you can see exactly where to look.',
      },
    ],
  },
];
````
