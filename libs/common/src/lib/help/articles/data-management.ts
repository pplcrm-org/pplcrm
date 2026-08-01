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
      { kind: 'h2', id: 'email-checkup', text: 'Email check-up' },
      {
        kind: 'p',
        text: 'Every people import runs a quiet check on each email address — no extra step, no third-party service. It looks up whether the address’s **domain can actually receive mail** (its DNS records) and whether it belongs to a known **disposable-email** provider. Addresses that fail either check are **suppressed**: they stay on the contact, but they’re left out of newsletters and automated emails. The completion email reports the numbers — checked, valid, suppressed, and any **likely typos** (for example `name@gmial.com`, which we flag but never change for you) and **role addresses** (`info@`, `admin@` — kept, never suppressed, since shared inboxes are legitimate contacts). Addresses we couldn’t verify (a slow or flaky DNS lookup) are always kept.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'A dirty list can pause your sending',
        text: 'If a large import comes back with an unusually high rate of undeliverable addresses — the signature of a purchased or scraped list — sending is paused pending review, the same way a high [bounce rate](/help/sending-protections) does. Import only contacts who opted in.',
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
        kind: 'p',
        text: 'The tab lists everyone’s exports so the workspace can see what has been extracted, but the file itself is yours: you can download or delete an export you requested, and organization admins and owners can download or delete any of them. After 30 days the file is deleted and its row leaves the list; the Activity log entry stays. Exporting the workspace **user list** is limited to admins and owners.',
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
