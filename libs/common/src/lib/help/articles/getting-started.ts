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
