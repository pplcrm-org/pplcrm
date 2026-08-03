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
          '**Donations**: every gift on record, showing date, amount, method (card or manual, with a “· monthly” note for pledge-linked gifts), and what the donor was sent — the tax receipt number where one has been issued, otherwise the donation receipt that went out when the gift arrived. Click the chip to open the gift. An active monthly pledge also lights up a “Monthly donor” chip beside the name.',
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
      'riding',
      'polling division',
      'congressional district',
      'boundaries',
      'geocode',
      'door notes',
    ],
    related: ['add-people', 'person-profile', 'district-boundaries', 'geocoding-and-costs', 'duplicates'],
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
        text: 'Editing a household, search for an address and pick a suggestion. It fills every field below and geocodes the household, so its electoral areas fill in automatically. Prefer to type it yourself? Open **Enter address manually**; manual edits save as typed, geocode in the background, and the map pin appears once the address verifies.',
      },
      {
        kind: 'p',
        text: 'A household holds **every** electoral area that covers it, one per boundary map your workspace has loaded, and none of them overwrites another. Depending on where you organize and what maps you hold, that might be a riding and a polling division, or a congressional district, a state senate district, a state house district, a council district and a precinct all at once. Each is labelled with the word your campaign uses — see [What office a campaign is running for](/help/campaign-jurisdictions) — and where those maps come from is covered in [Boundary maps](/help/district-boundaries).',
      },
      {
        kind: 'p',
        text: 'The household page shows a map card. Clicking it opens the location in your maps app, with the address and its area labelled on top. A status chip always tells you where geocoding stands: **Located** (the pin is set), **Locating…** (still working in the background), **Address problem** (the address could not be found; open Edit and fix it), or **Not geocoded** (geocoding is a Movement feature and your plan is below it — the address is saved and fine, it just wasn’t placed on the map). Geocoded households power canvassing turfs and delivery coverage, so a clean address pays off downstream. What each state costs and when a **Locating…** household resolves is spelled out in [Geocoding, boundary matching, and what each costs](/help/geocoding-and-costs). Below the details you’ll also find a **Yard sign** card showing this home’s sign request in the campaign you are working in. Set it right there if a sign went up outside the app (see [Deliveries](/help/deliveries)).',
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
          {
            title: 'Add volunteers',
            detail:
              'Search the volunteer picker and tick everyone on the crew. Each pick becomes a chip you can remove, and the team captain is badged in the list. If you name a captain who is not on the roster, the form offers to add them.',
          },
          {
            title: 'Give it work',
            detail:
              'Pick the target lists this team will contact the same way, then attach tasks to complete. The team page tracks both.',
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
