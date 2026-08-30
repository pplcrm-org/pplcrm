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
        text: 'The header checkbox selects the visible page. If more rows match your filters, the grid offers **Select all N rows**. One click extends the selection to every match, and the bar confirms “All N rows are selected.” Selections this large are held as ids only, so even tens of thousands of matches select instantly.',
      },
      {
        kind: 'p',
        text: 'For very large results the selection stops at 50,000 rows, and the bar says so plainly: “The first 50,000 of N matching rows are selected.” Bulk actions then apply to exactly those rows — narrow the filter and repeat to reach the rest. The grid never claims to have selected rows it is not actually holding.',
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
