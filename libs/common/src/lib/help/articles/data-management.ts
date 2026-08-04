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
    related: ['duplicates', 'importing-districts', 'export', 'tags-issues', 'add-people'],
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
          'For companies and tasks the wizard needs a mapped **name** column. Rows without one are skipped. For households, rows matching an address you already have (or repeated in the file) are skipped, and new addresses are queued for geocoding — see [Geocoding, boundary matching, and what each costs](/help/geocoding-and-costs) for when that finishes.',
          'A households file that already names each row’s district, ward or precinct can bring those in too, with no lookup and no cost. See [Import district, ward and precinct columns](/help/importing-districts).',
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
        text: 'The tab lists everyone’s exports so the workspace can see what has been extracted, but the file itself is yours: you can download or delete an export you requested, and organization admins and owners can download or delete any of them. A colleague’s export shows **Owner only** where the download and delete buttons would be, with their name in the **By** column, so you can see the export exists without being offered a button that would be refused. After 30 days the file is deleted and its row leaves the list; the Activity log entry stays. Exporting the workspace **user list** is limited to admins and owners.',
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
        tone: 'warning',
        title: 'Merging two volunteers keeps only one volunteer record',
        text: 'A person can hold one companion volunteer record, so merging two people who both have one keeps the record you are keeping and removes the other, along with the phones signed in on it. If the removed one was the approved record, that volunteer verifies a code again and an admin approves them again before they can canvass or deliver. The merge confirmation tells you when this pair is affected. See [Volunteer access approvals](/help/volunteer-access).',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Make it a habit',
        text: 'A five-minute duplicates pass after every import keeps the database trustworthy, far cheaper than a heroic annual cleanup.',
      },
    ],
  },
  {
    id: 'importing-districts',
    category: 'data',
    title: 'Import district, ward and precinct columns',
    summary:
      'A purchased voter file usually already names each row’s electoral areas. The import wizard reads those columns straight in — no map to find, no lookups, no cost.',
    keywords: [
      'district column',
      'ward column',
      'precinct column',
      'riding column',
      'voter file',
      'cd',
      'ld',
      'congressional district',
      'legislative district',
      'polling division',
      'import districts',
      'electoral geography',
    ],
    related: ['import', 'district-boundaries', 'geocoding-and-costs', 'campaign-jurisdictions'],
    blocks: [
      {
        kind: 'p',
        text: 'A purchased voter file — or an export from your party, or from a previous campaign — usually arrives with the electoral areas already filled in on every row: the congressional district, both legislative districts, the precinct. pplCRM reads those columns directly during a households import. Nothing is looked up, no outlines are needed, and it costs nothing. If you have a file like that, this is by far the fastest way to get electoral geography into the workspace, and it is worth doing before you go hunting for map files.',
      },
      { kind: 'h2', id: 'columns', text: 'Column names that are recognised' },
      {
        kind: 'p',
        text: 'On the **Map columns** step the wizard guesses from your header row. The guess ignores case, spaces and punctuation, so `Congressional District`, `congressional_district` and `CONGRESSIONALDISTRICT` are all the same header as far as it is concerned.',
      },
      {
        kind: 'list',
        items: [
          '**District** and **Riding** — a seat area.',
          '**Ward** — a seat area in most places, a voting subdivision in Massachusetts. You say which when the set is created; the column name never decides it.',
          '**Precinct**, **Poll** and **Polling division** — a voting subdivision. New York files that say **Election district** mean the same thing.',
          '**CD** and **Congressional district** — the US federal seat area.',
          '**LD** and **Legislative district** — a US state seat area. If your file has separate upper-chamber and lower-chamber columns, map each one; they are different maps and they are kept apart.',
        ],
      },
      {
        kind: 'p',
        text: 'A column named something we do not recognise is not lost. Every column on the **Map columns** step has a field picker, so choose the right field yourself and it imports exactly the same way. Anything you leave unmapped shows a “Skipped” chip and is left out, as always.',
      },
      { kind: 'h2', id: 'creates', text: 'What the import creates' },
      {
        kind: 'p',
        text: 'Each mapped column becomes one boundary set in your workspace — a named map with a declared role — and each row’s value becomes that household’s area name inside it. A file carrying `CD`, `LD` and `Precinct` columns produces three sets and three area names per household, and none of them overwrites another. See [Boundary maps](/help/district-boundaries).',
      },
      {
        kind: 'p',
        text: 'What you get from imported names, immediately: filter and sort [Households](/households) by area, count doors per area, build a smart [list](/lists) like “everyone in precinct 12”, and export by area. Turf cutting uses these areas as its boundaries too, but it also needs each door’s coordinates — see the geocoding note below.',
      },
      {
        kind: 'p',
        text: 'What you do not get: an outline. There is no shape to display, and — more importantly — nothing to place a **new** address into. A household typed in by hand next week, or arriving from a web form, has no value for that set until you import one for it or add the real map by upload or by drawing. If addresses keep arriving after the initial load, plan on getting the actual map eventually.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Tidy the column before you import, not after',
        text: 'Area names are matched as plain text, so `Ward 3`, `WARD 3` and `3` are three different areas. A file that spells the same ward two ways produces two areas where you wanted one. Five minutes in the spreadsheet beforehand saves a merge afterwards.',
      },
      {
        kind: 'p',
        text: 'The rest of the wizard behaves exactly as [Import from CSV](/help/import) describes — Upload, Map columns, Review, Import, and nothing written until the last step. District columns ride along with an ordinary households import; there is no separate import type for them.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'These columns trigger no geocoding',
        text: 'Reading an area name out of a column is not an address lookup. If the rows are also brand-new addresses, those addresses still need coordinates before map pins, turf cutting and delivery routing will work, and that part is metered — see [Geocoding, boundary matching, and what each costs](/help/geocoding-and-costs). The area names themselves are usable the moment the import finishes.',
      },
    ],
  },
  {
    id: 'geocoding-and-costs',
    category: 'data',
    title: 'Geocoding, boundary matching, and what each costs',
    summary:
      'Turning an address into coordinates uses a paid service and is metered. Placing coordinates inside a boundary is free. Which is which, and what a household stuck on “Locating…” is waiting for.',
    keywords: [
      'geocode',
      'geocoding',
      'coordinates',
      'lat lng',
      'pending',
      'locating',
      'daily limit',
      'budget',
      'cost',
      'quota',
      'address problem',
      'not geocoded',
      'map pin',
      'daily budget',
    ],
    related: ['households', 'district-boundaries', 'import', 'importing-districts'],
    blocks: [
      {
        kind: 'p',
        text: 'Two different jobs get confused with each other, and almost every question about cost comes down to telling them apart. **Geocoding** turns a street address into coordinates. It asks an outside service, that service charges per address, and so pplCRM meters it carefully. **Boundary matching** takes coordinates the workspace already has and works out which areas they fall inside. It is arithmetic on our own servers, it calls nothing, and it is free and unmetered.',
      },
      { kind: 'h2', id: 'free', text: 'What never costs anything' },
      {
        kind: 'list',
        items: [
          'Adding, drawing, reshaping, renaming or deleting a **boundary map**. Every one of these only re-reads coordinates already on file. No address is sent anywhere.',
          'Uploading a GeoJSON file.',
          'Re-matching every household in the workspace against a map you just changed.',
          'Importing district, ward or precinct **names** from a CSV column. See [Import district, ward and precinct columns](/help/importing-districts).',
          'Deleting a boundary set and adding it back.',
        ],
      },
      {
        kind: 'p',
        text: 'So you can redraw a ward map as many times as it takes to get it right. It costs exactly the same as not redrawing it.',
      },
      { kind: 'h2', id: 'costs', text: 'What does cost, and how it is metered' },
      {
        kind: 'p',
        text: 'One thing costs money: finding the coordinates for an address this workspace has not looked up before.',
      },
      {
        kind: 'list',
        items: [
          '**You add or edit one household in the app** — looked up right away, normally within a minute. One address, one lookup.',
          '**You import a file** — never during the import, whatever its size. The import finishes without a single lookup: rows are saved and marked as waiting, and the first batch of lookups starts straight away. Anything beyond the day’s budget carries over to the following days. This is deliberate. A file of fifty thousand addresses would be a large bill arriving in one go, and metering it out is what keeps the feature affordable.',
          '**An address this workspace has looked up before** — free. The answer is remembered, including the answer “there is no such address”, so re-importing the same file, or importing one that overlaps something you loaded last month, costs nothing. It stays remembered even if you delete the household and add it back.',
        ],
      },
      {
        kind: 'p',
        text: 'There is also a cap on how many **new** addresses one workspace can look up per day. It applies per workspace per day, not per import, so splitting a large file into several small ones does not get around it — and is not meant to. Going over it never fails anything: the remaining rows simply stay marked as waiting — their status chip reads **Locating…** — and carry on the next day. Nothing is dropped and no import is rejected.',
      },
      { kind: 'h2', id: 'chips', text: 'What the status chip on a household means' },
      {
        kind: 'list',
        items: [
          '**Located** — coordinates are on file. The map pin is set, boundary areas are matched, and the household can be cut into a turf or routed for a delivery.',
          '**Locating…** — waiting for a lookup. The household record itself is complete and saved; the only things missing are its pin and the boundary areas that depend on it. A single edit usually clears within a minute or two. Imported rows start clearing as soon as the import lands, and a very large import is spread across several days on purpose — a file of tens of thousands of addresses will not all be located on the first day.',
          '**Address problem** — the address was looked up and could not be found. Open **Edit** and correct it; saving a corrected address queues a fresh lookup. The failed answer is remembered too, so leaving a bad address alone does not keep costing you anything.',
          '**Not geocoded** — geocoding is a **Movement** feature and this workspace is on a lower plan. The address is saved and perfectly usable; it was simply never sent for a lookup. See [Settings and configuration](/help/settings) for what each plan includes.',
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Turfs and routes use located households only',
        text: 'Turf cutting and delivery routing only use households that have been located. Addresses still on **Locating…** are counted and reported in the preview, never silently dropped — and once they resolve, **Refresh doors from list** on a turf brings the newly located doors in. See [Canvassing](/help/canvassing).',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Already have the area names? You do not have to wait',
        text: 'Boundary areas normally arrive from matching, which needs coordinates first. But if your file already names each row’s ward or precinct, those names are written at import with no lookup involved — so filtering, counting, lists and exports by area work straight away, even while the map pins are still catching up. Turf cutting is the exception: it builds walk lists from located doors, so it still waits for coordinates.',
      },
    ],
  },
];
