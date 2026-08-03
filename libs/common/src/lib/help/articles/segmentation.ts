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
        text: 'Administrators curate the shared vocabulary under [Tags & issues](/tags) in the Data section. One entry, two tabs: [Tags](/tags) and [Issues](/issues). Each tab opens with a sentence naming the whole vocabulary: how many tags or issues exist, how many applications, and (on Tags) how many have not been used in 90 days.',
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
        text: 'The [Issues](/issues) tab additionally ranks by interest with a trend (new applications in the last 30 days) and a top area — the ward, riding or precinct where that issue comes up most, named with your campaign’s own word for it (see [What office a campaign is running for](/help/campaign-jurisdictions)). Issues exist to tell the policy team what people care about, not to describe who someone is, which is what tags are for.',
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
      'all subscribers',
      'all volunteers',
      'built-in list',
      'system list',
      'undeletable',
      'ward',
      'precinct',
      'riding',
      'district',
    ],
    related: ['tags-issues', 'filters', 'district-boundaries', 'newsletters'],
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
      { kind: 'h2', id: 'built-in', text: 'The two lists you always have' },
      {
        kind: 'p',
        text: 'Every context starts with two built-in smart lists, marked “Built in” in the table: **All Subscribers** (everyone who has opted in to email in this context) and **All Volunteers** (everyone with a volunteer standing, at any stage). They refresh themselves like any smart list, and they are always there — including while you are exploring the demo data, and after you clear it. Because other things point at them, they cannot be deleted or renamed; you can edit their description. If you want a variation, make your own smart list from the same rule.',
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
              'Compose conditions in the query builder: match all or any, with nested groups. For people you can rule on tags and issues, on standing (volunteer status, subscriber status, staff status, support level, voting status, do not contact), on any contact or address field, and on the electoral areas a household sits in — so “everyone in precinct 12” is one rule. The area field is labelled with your campaign’s word for it and is always offered; until your workspace has a [boundary map](/help/district-boundaries) or imported area names, it simply matches nobody. Status fields offer a picker rather than a text box, plus “is set” / “is not set”. The live preview does the math in public: “Matches 1,284 people right now”, with a note reminding you whether that count will keep moving (Smart) or freeze on save (Static).',
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
        text: 'If a list is in use, the delete confirmation names its consumers (the newsletters, forms, and turfs that reference it), so you never break an audience by surprise. The people and households themselves are never touched; only the list is removed. The two built-in lists have no delete button at all.',
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
