import type { HelpArticle } from '../help-types';

export const ADMIN_ARTICLES: HelpArticle[] = [
  {
    id: 'profile',
    category: 'admin',
    title: 'Your profile',
    summary: 'Your photo, your details, and your account facts, plus a snapshot of your own activity.',
    keywords: [
      'profile',
      'avatar',
      'photo',
      'account',
      'notification preferences',
      'personal settings',
      'my account',
      'mobile number',
      'phone number',
      'text me',
      'sign out',
      'signing out',
      'log out',
    ],
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
      { kind: 'h2', id: 'mobile', text: 'Mobile number' },
      {
        kind: 'p',
        text: 'The **Profile** card holds your name, the email you sign in with, and an optional **mobile number**. The mobile is only ever used to text *you*: a volunteer waiting for your approval (the one text alert in [Settings](/help/settings)), and the **Send to my phone** button that texts you a QR sign-up page to hold up at a launch. It is never shown to volunteers or contacts, and it is never a sending number for the workspace — that is a separate, verified number under **Workspace → Communications**. Include the area code; a number we could not text is refused rather than saved, because a saved-but-unreachable number would leave you wondering why nothing arrived. Clear the field to stop being texted entirely. Name, email, and mobile save together with **Save changes**; the email change takes effect only after you confirm it from the new address.',
      },
      { kind: 'h2', id: 'notifications', text: 'Notification preferences' },
      {
        kind: 'p',
        text: 'Notification preferences live in **Settings** (avatar menu → Settings), not on the Profile page. Choose, per event, whether you are alerted by email and in-app: mentions in comments, tasks assigned to you, tasks due, contacts assigned to you, emails assigned to you, finished exports, and import summaries. Every switch applies instantly — there is nothing to save. These are yours alone; there is no workspace-wide notification default. See [Settings and configuration](/help/settings).',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Verify your email',
        text: 'If a “verification pending” notice sits at the top of your profile, click the link in the verification email. Some features stay limited until your address is confirmed.',
      },
      { kind: 'h2', id: 'signing-out', text: 'Signing out' },
      {
        kind: 'p',
        text: 'Sign out from the avatar menu in the top-right corner. Closing a session is something only the server can do, so the app waits for the server to confirm before it takes you to the sign-in page. If your connection drops at that moment you are told the sign-out did not go through and offered a retry, rather than being shown a sign-in page while your session is quietly still open.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'If sign-out cannot reach the server',
        text: 'Choose **Try again** once you are back online. If you have to leave the computer straight away, choose **Sign out on this device**: the app locks you out here immediately and finishes signing you out from the server as soon as this device reconnects. On a shared or public computer, change your password afterwards so the session is closed right away.',
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
      'boundaries',
    ],
    related: ['users-roles', 'district-boundaries', 'newsletters', 'dashboard', 'profile'],
    blocks: [
      {
        kind: 'p',
        text: 'pplCRM separates what affects **you** from what affects **everyone**. **Settings** (avatar menu → Settings) opens a compact popup for your personal preferences and applies every change instantly. There is nothing to save. The [Workspace](/workspace) settings (administrators only, under **Admin** in the sidebar) set policy for everyone and use a deliberate **Save** with a leave-guard.',
      },
      { kind: 'h2', id: 'personal', text: 'What lives in your Settings popup' },
      {
        kind: 'list',
        items: [
          '**Notifications**: a per-event matrix of email and in-app switches (mentions, task assigned, tasks due, person assigned, email assigned, export ready, import summary). Each toggle saves as you flip it. Import summaries arrive by email only. There is also one text-message alert — when a volunteer you invited is waiting for approval. It is on by default: an unapproved volunteer is stuck at a door until someone lets them in, so this is the one worth interrupting you for. Turn it off here if you would rather not be texted; you still get the email and the bell either way, and we never text you without a mobile number on your profile — add one under **Mobile number** on [your profile](/profile), and Settings will remind you if the text alert is on with no number on file.',
          '**Theme**: Light, Dark, or System (follows your device’s setting), applied live. This is yours alone: an administrator changing the workspace default theme never overrides a theme you picked.',
          '**Passkeys**: the devices that can sign you in; add one with your device prompt, or remove one you no longer trust.',
          '**Where you’re signed in**: every browser and phone currently signed in to your account, showing the browser, the IP address it signed in from, when it signed in, and when it was last active. Sign out any one of them, or use **Sign out N other devices** to end them all at once. The browser you are reading this in is marked **This device** and has no button of its own; **Sign out** in the avatar menu is how you end that one. This is what to reach for if you lose a phone, or if a sign-out failed because you were offline at the time. Closing a browser does not end a session on its own: sessions last 24 hours, or 30 days if you chose “remember me”, and signing a device out here takes effect immediately.',
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
          '**Organization**: your name, contact details, and mailing address, plus the settings everyone sees the effect of — **time zone**, **currency**, **date format**, and the **default theme** for people who have not picked their own. Time zone is the one worth setting first: it decides what “9am” means for service levels and working hours, and which day a date belongs to across the app. Currency is used for donations, pledges, and event pricing — both what a donor is charged and what you see.',
          '**Modules**: what kind of organization this is — **Constituency office**, **Political campaign**, **Non-profit**, or **Church** — and which optional modules (Canvassing, Deliveries, Donations, Approvals) appear in your sidebar. The organization type only picks the wording and the starting set: a constituency office starts without **Donations**, because a publicly funded office does not fundraise — the campaign or riding association behind it does, on separate books. A module that is off — whether the organization type left it off or you switched it off yourself — stays in the sidebar, dimmed, so you can see it exists; clicking it points you back here. Turn any module on here and it lights up immediately. Turning one off never deletes anything, and never blocks a link you already have. Whichever type you pick is shown at the top of your avatar menu, so you can always tell which one a workspace is on; administrators can click it to come straight back here.',
          '**Campaigns**: your permanent office context and any election campaigns — create and archive them, set which office each one is running for, switch which one you (as an admin) are working in, and read how user assignment works. This section appears for organizations that run elections (a constituency office or a campaign). See [Campaigns and contexts](/help/campaigns-contexts) and [What office a campaign is running for](/help/campaign-jurisdictions).',
          '**Boundaries**: the electoral maps your households are matched against — wards, ridings, districts, precincts. Import the names from a CSV, upload a published GeoJSON file, or draw the areas yourself over your own household pins. Adding or changing a map never calls a paid service. See [Boundary maps](/help/district-boundaries).',
          '**Teams & access**: default role for invitations and the MFA requirement.',
          '**Data & duplicates**: maintenance for the address matching behind duplicate detection. Recomputing address fingerprints is worth doing if your addresses were imported oddly and duplicates are being missed; it is available once a month.',
          '**Communications**: default from-name and from-address (only an address on a domain you have verified, or your workspace’s own pplCRM address), reply-to, the newsletter footer disclaimer, and double opt-in for web-form subscribers.',
          '**Email sync**: connect your email provider so incoming and outgoing email syncs into your pplCRM inbox.',
          '**Domain verification**: the DNS records (SPF, DKIM, DMARC) that let you send email from your own domain.',
          '**Service levels**: response-time targets for email and tasks, working days and hours, and the warning/critical thresholds behind the dashboard status.',
          '**Donations**: donation limit, residency restrictions, tax credit tiers, your Stripe connection, and tax receipt configuration — the receipting regime, registration number, signatory and signature image, and numbering prefix. None of it affects the donation receipt every gift gets automatically. See [Donation receipts and giving statements](/help/donation-receipts).',
          '**Deliveries**: the planning defaults the Plan routes page starts from — minutes per stop, average driving speed, how many drivers, and whether the drive back to the start counts. Organizers can still override any of them for a single plan without changing the defaults.',
          '**App**: how the volunteer-facing apps behave, including whether volunteer route links expire after 30 days. Expiry is the secure default (a forwarded or long-lost link goes dead on its own), but you can turn it off if your delivery routes run longer. Volunteers still verify a code and need a one-time approval either way.',
          '**Storage**: your plan quota, live usage, and the files taking up the most space.',
          '**Billing**: your plan, live usage, and payment details.',
          '**API keys**: workspace API keys for server-side integrations (submitting forms, RSVPs, and volunteer signups from your own backend, or connecting Zapier). Grassroots and above. Each key is shown once, at creation. A workspace can hold two at once so you can rotate without downtime; revoking one takes effect immediately.',
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
          '**Free**: $0 forever. Up to 1,000 emailable subscribers, 2,000 emails a month, 2 staff seats, and 1 GB of storage. Includes the people CRM and newsletters. No shared inbox and no companion volunteers.',
          '**Grassroots**: starts at $29 a month for up to 1,000 emailable subscribers, then rises in steps as your list grows, up to $359 a month at its 100,000-subscriber ceiling. Adds the shared inbox (Gmail and Microsoft mailbox sync), web forms, donations, automations, lists, volunteer management (teams and events), and API access with 300+ integrations.',
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
        text: 'Paid plans can be billed **monthly or annually**. Annual billing costs exactly 10× the monthly price at every bracket — **2 months free** — paid up front for the year. Pick the interval with the Monthly/Annual toggle on the [Billing](/workspace/billing) page before upgrading. Already subscribed? Set the toggle to the other interval and your current plan’s card offers the switch; a dialog states what Stripe charges or credits before anything changes. Monthly is the default — if your campaign wraps up mid-year, don’t prepay twelve months.',
      },
      {
        kind: 'p',
        text: 'Moving between the paid tiers (Grassroots ↔ Movement) happens right on the plan cards too: click the other tier’s button and confirm. The change applies immediately to your existing subscription — an upgrade charges the prorated difference for the rest of the current period and unlocks the new features right away; a downgrade turns the higher tier’s features off immediately and credits the unused amount toward future invoices. The confirmation dialog lists exactly which features turn off before you commit. Moving to **Free** is different — it is a cancellation; see [Canceling a paid plan](#cancel-downgrade).',
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
      { kind: 'h2', id: 'cancel-downgrade', text: 'Canceling a paid plan (moving to Free)' },
      {
        kind: 'p',
        text: 'To cancel, use **Downgrade to Free** on the [Billing](/workspace/billing) page. It first shows exactly what will change in your workspace, then schedules the cancellation for the end of the period you have already paid for — and you can **Resume subscription** any time before that date. When the downgrade lands, Grassroots and Movement features turn off: published forms stop accepting submissions, API keys stop working, automations stop processing, and the shared inbox locks. If your workspace has more than **1,000 emailable subscribers**, newsletter sending is blocked until the list is reduced to the Free limit or you upgrade again. Your contacts and other data are never deleted, with one exception: email synced from a connected mailbox is permanently deleted **30 days** after the downgrade, and re-subscribing later cannot restore it — the workspace owner gets an email spelling out all of this, with the exact deletion date, when the downgrade takes effect.',
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
      'turf access',
      'roam',
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
        text: 'When someone verifies for the first time, every admin gets an email, an in-app notification in the bell menu, and a badge on [Volunteer access](/volunteer-access) in the Admin section. Opening the notification takes you straight there. Each row shows the volunteer, their contact on file, and a status chip: **Invited** (link sent, not yet verified), **Awaiting approval**, **Approved**, or **Revoked**. Click **Approve** and their open Companion page unlocks by itself within seconds. They never re-enter a code, and the sidebar badge drops as you approve. Someone you did not expect — a stranger who scanned a QR code on a poster — can be turned away with **Decline** on the same row, which stops their link and clears them off the waiting list. Declining is not permanent: approve them later if you change your mind.',
      },
      {
        kind: 'p',
        text: 'If you are sitting on the page while volunteers verify on their phones, **Refresh** at the top re-reads the list and the join code counts. New arrivals do not appear on their own.',
      },
      { kind: 'h2', id: 'turf-access', text: 'How much a volunteer can pick for themselves' },
      {
        kind: 'p',
        text: 'The **Turf access** column on an approved row decides whether that volunteer chooses their own [turfs](/canvassing) or only walks the ones you hand them. **Workspace default** follows the setting in Workspace → Companion apps. **Any turf in campaign** lets them open the turf picker in the Canvass Companion and start on any turf that isn’t retired — including one somebody else is already walking, which is how a group splits a turf. **Only assigned turfs** pins them to what you place them on. Changing it takes effect on their next tap; nothing needs resending.',
      },
      {
        kind: 'p',
        text: 'A volunteer you’ve never placed on a turf can still pick one, as long as they may roam. They see the turfs of every campaign that isn’t archived, unless they joined by scanning a QR code for one campaign, in which case they see that campaign’s turfs. Once they’re on a turf, roaming keeps them inside the campaigns they’re actually working.',
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
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Merging two volunteers keeps only one volunteer record',
        text: 'A person can hold one volunteer record, so merging two people who both have one keeps the record you are keeping and removes the other, along with the phones signed in on it. If the removed one was the approved record, that volunteer verifies a code again and needs approving again. The merge confirmation says this before you commit, and only when both people are volunteers. See [Find and merge duplicates](/help/duplicates).',
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
      'jurisdiction',
      'riding',
      'ward',
      'seat',
    ],
    related: ['campaign-jurisdictions', 'users-roles', 'settings', 'activity-log'],
    blocks: [
      {
        kind: 'p',
        text: 'Your workspace always has one permanent **office** context, the constituency office’s day-to-day home. When an election comes, an administrator creates an **election campaign** alongside it under [Workspace → Campaigns](/workspace/campaigns). People, households, and companies are shared across every context: one contact list, no duplicates. What stays separate per campaign is what you learn and are permitted to do in it: supporter data, email consent, and outreach.',
      },
      { kind: 'h2', id: 'office', text: 'Each campaign declares what it is running for' },
      {
        kind: 'p',
        text: 'A campaign also records the office it is contesting: the country, the level of government, the province or state, and the seat. That is what makes the app say **riding** to an Ottawa campaign, **constituency** to an Alberta one, **ward** to a Toronto councillor and **congressional district** to an Ohio campaign — on the same screens, without anybody configuring wording. It also decides which boundary maps your households are matched against. Two campaigns in one workspace can be at completely different levels, and a household holds the areas for both at once. See [What office a campaign is running for](/help/campaign-jurisdictions).',
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
      {
        kind: 'callout',
        tone: 'info',
        title: 'Only for organizations that run elections',
        text: 'Election campaigns are offered to constituency offices and political campaigns. If your workspace is set to Non-profit or Church under [Workspace → Modules](/workspace/modules), the Campaigns section is hidden — you still have the one permanent context underneath, which is simply your workspace. Change the organization type there if that is wrong.',
      },
    ],
  },
  {
    id: 'campaign-jurisdictions',
    category: 'admin',
    title: 'What office a campaign is running for',
    summary:
      'Tell a campaign its country, level of government and seat, and every screen starts using the right word: riding, ward, constituency, congressional district.',
    keywords: [
      'jurisdiction',
      'riding',
      'ward',
      'precinct',
      'district',
      'constituency',
      'circonscription',
      'polling division',
      'congressional district',
      'legislative district',
      'chamber',
      'at large',
      'seat',
      'office',
      'canada',
      'united states',
      'municipal',
      'provincial',
      'state',
      'federal',
    ],
    related: ['campaigns-contexts', 'district-boundaries', 'importing-districts', 'settings'],
    blocks: [
      {
        kind: 'p',
        text: 'A campaign’s **jurisdiction** is the answer to one question: what office is this campaign contesting, and where. Set it when you create a campaign under [Workspace → Campaigns](/workspace/campaigns), or edit it there afterwards. It decides three things — the words the app uses for electoral areas, which boundary maps your households are matched against, and which further questions the campaign form bothers to ask you.',
      },
      { kind: 'h2', id: 'vocabulary', text: 'Three words that are not interchangeable' },
      {
        kind: 'p',
        text: 'This is the part people get wrong, and it is worth two minutes because everything else follows from it.',
      },
      {
        kind: 'list',
        items: [
          '**District** — in Canada, a **riding** — is a **seat area**: the territory that elects one representative. An MP, an MLA, a member of Congress, a state legislator.',
          '**Ward** is usually a seat area too, one level down: the territory that elects one councillor.',
          '**Precinct** — in Canada a **polling division**, in New York an **election district** — is not a seat area at all. It is a **voting subdivision inside** one: the area served by a single polling place.',
        ],
      },
      {
        kind: 'p',
        text: 'So district and ward are normally the same kind of thing at different levels of government, and a precinct is a different kind of thing that sits inside either one. That distinction does real work here. A riding or a congressional district holds tens of thousands of doors, which is far too many to hand to anybody. A precinct or a polling division is roughly one evening’s walk. A riding is what a campaign is **for**; a precinct is what a canvassing turf is **cut along**.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'The word “ward” means two different things',
        text: 'In Ontario a ward elects a councillor. In Massachusetts cities a ward elects nobody: it is a voting subdivision containing precincts, and Boston’s council seats are their own separate districts. No product can be right in both places by reading the word. So pplCRM never does. Every boundary map you add declares what it **is** — a seat area, a voting subdivision, or a locality — and the name is only a label on top of that. That is exactly why a Massachusetts household can hold a ward **and** a precinct at the same time without either being wrong.',
      },
      { kind: 'h2', id: 'choices', text: 'The seven choices' },
      {
        kind: 'list',
        items: [
          '**Canada — federal**: the seat area is a **riding**, subdivided into **polling divisions**. There is no province to pick; federal ridings cover the whole country.',
          '**Canada — provincial**: also **ridings**, except where the province uses its own word. Alberta and Saskatchewan say **constituency**, Newfoundland and Labrador and Prince Edward Island say **district**, Quebec says **circonscription**. Picking the province applies the right word for you; you do not have to know the list.',
          '**Canada — municipal**: the seat area is a **ward** (**district** in Quebec), subdivided into **polls**. Mayors — and every seat on Vancouver city council — are elected across the whole municipality instead, which is what the at-large tick box below is for.',
          '**United States — federal**: **congressional districts**, subdivided into **precincts**. A US Senate race has no district at all: senators are elected statewide.',
          '**United States — state**: **legislative districts**, subdivided into precincts. State legislatures have two chambers, so this is the one choice that asks you which — an upper-chamber (senate) race and a lower-chamber (house or assembly) race are matched against entirely different maps, and there is no way to work out one from the other. Governor and the other statewide offices have no district.',
          '**United States — local**: **council districts** or wards, subdivided into precincts. At-large council seats have no district.',
          '**Other**: everything not modelled in detail — school board, county commission, band council, a special district, or a race that is none of the above. The neutral words **district** and **subdivision** are used, and no region is required.',
        ],
      },
      { kind: 'h2', id: 'fields', text: 'What the campaign form asks' },
      {
        kind: 'p',
        text: 'Only the questions that apply to your choice are shown. A Canadian federal campaign never sees a chamber selector; a church or non-profit workspace never sees any of this at all.',
      },
      {
        kind: 'list',
        items: [
          '**Country and level** — the seven choices above.',
          '**Province or state** — asked for everything except a Canadian federal race and **Other**.',
          '**Municipality** — asked for a Canadian municipal or a US local race.',
          '**Chamber** — upper or lower. US state races only.',
          '**Elected at large** — tick this when the seat has no territory of its own: a US senator, a governor, a mayor, an at-large councillor, or the single statewide congressional seat that Alaska, Delaware, North Dakota, South Dakota, Vermont and Wyoming each have. Ticking it hides the seat name, because there is not one — the seat covers the municipality you named, or the whole region if you named none.',
          '**Seat name** — `Ottawa Centre`, `Calgary-Elbow`, `Ward 14`, `OH-3`, `LD-12`. This is the district printed on donation receipts, which is not always the area you canvass: a candidate running in one city ward is still a candidate of the whole municipality, so the receipt names the municipality.',
          '**Which areas this campaign represents** — the separate question of which map areas are yours, used to tell whether an address is in your territory. Usually one, and you pick it from whichever map covers your office. Add several when several areas elect one seat: a regional councillor elected by two wards represents both, and an address in either counts as inside. If no map covers your office yet — which is normal for municipal wards, since most municipalities publish none — type the name instead and add a map later.',
          '**Seat position** — only where more than one person is elected from the same district. Arizona’s House and New Jersey’s General Assembly elect two per district, Washington numbers positions within each legislative district, and at-large council seats are frequently numbered. Type whatever the ballot says: `Position 2`, `Seat B`, `Place 4`.',
          '**What to call this area** — a manual override for the word. Leave it blank unless your race genuinely uses something other than what the app picked.',
          '**Office title** — `MP`, `MLA`, `Councillor`, `Representative`, `Senator`. It appears in wording and nothing else.',
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'One workspace, several levels at once',
        text: 'A councillor’s permanent office context and a provincial election campaign can live in the same workspace, each with its own jurisdiction and its own vocabulary. Nothing is shared between them but the contacts, and a household holds the boundaries for both at the same time. See [Campaigns and contexts](/help/campaigns-contexts).',
      },
      { kind: 'h2', id: 'effect', text: 'What changes once it is set' },
      {
        kind: 'list',
        items: [
          'Column headers and page copy stop hedging. The [Households](/households) grid says **Riding**, **Ward**, or **Congressional district**, and its summary line counts “across 12 ridings” or “across 40 precincts”.',
          'The [Canvassing](/canvassing) coverage tab and the turf-cutting explanation use your subdivision’s word.',
          'The smart-list rule builder offers your electoral areas as a filter, so “everyone in precinct 12” is a list you can build. See [Smart and static lists](/help/lists).',
          'Turfs are cut along the finest map your workspace holds for that campaign. See [Boundary maps](/help/district-boundaries).',
          'The starter tags a new workspace is seeded with use your word rather than assuming Canadian federal vocabulary.',
        ],
      },
      { kind: 'h2', id: 'us-limits', text: 'What pplCRM does not do for US campaigns' },
      {
        kind: 'p',
        text: 'Worth knowing before you plan around it. US political contributions are not tax-deductible federally, so there is no TAX receipt to issue and pplCRM issues none. Donors are still sent a plain donation receipt for every gift, which makes no tax claim. It also does not prepare or file FEC or state disclosure reports — that is a separate compliance system with its own contributor occupation, employer and per-donor limit rules, and this product does not have it. A US workspace records gifts in the [Donations](/donations) ledger and exports them; the filing itself happens elsewhere. Canadian receipting is unaffected — see [Donation receipts and giving statements](/help/donation-receipts).',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Not running elections?',
        text: 'If your workspace is set to Non-profit or Church under [Workspace → Modules](/workspace/modules), none of these questions appear. There is no office to declare.',
      },
    ],
  },
  {
    id: 'district-boundaries',
    category: 'admin',
    title: 'Boundary maps: wards, ridings, districts and precincts',
    summary:
      'A boundary map tells pplCRM which electoral areas each household sits in. There are four ways to get one: select a published map, import the names, upload a file, or draw it yourself.',
    keywords: [
      'boundary',
      'boundaries',
      'boundary set',
      'geojson',
      'shapefile',
      'map',
      'ward map',
      'riding map',
      'precinct map',
      'district',
      'upload',
      'redistricting',
      'vintage',
      'seat area',
      'subdivision',
    ],
    related: ['drawing-boundaries', 'importing-districts', 'campaign-jurisdictions', 'geocoding-and-costs'],
    blocks: [
      {
        kind: 'p',
        text: 'A **boundary map** — a boundary set — is one named collection of areas. Each area has a name (`Ward 12`) and an optional code, and the set as a whole declares what it **is**: a **seat area** (the territory that elects someone), a **voting subdivision** (a precinct, a polling division, a Massachusetts ward), or a **locality** (a whole municipality). Manage them under **Boundaries** in [Workspace settings](/workspace).',
      },
      {
        kind: 'p',
        text: 'Meaning lives in that declared role, never in the name. It is what lets a Toronto ward and a Boston ward both be represented correctly even though one elects a councillor and the other elects nobody. See [What office a campaign is running for](/help/campaign-jurisdictions) for why that matters.',
      },
      { kind: 'h2', id: 'many', text: 'Why a household holds several at once' },
      {
        kind: 'p',
        text: 'One American address sits inside a congressional district **and** a state senate district **and** a state house district **and** a city council district **and** a precinct, all at the same time: five different lines drawn over one house. pplCRM keeps one answer per map, so no level ever overwrites another, and a household page lists every area it belongs to rather than the last one that happened to be worked out.',
      },
      {
        kind: 'p',
        text: 'The [People](/people) and [Households](/households) grids follow the same rule. The column you see by default is **District**, which lists every area a household falls in, across every map you hold, in one cell. Each map also has a column of its own — your campaign’s map under your word for it (**Riding**, **Ward**, **Congressional district**), plus a **Wards** column if you hold a ward map, and so on — sortable and filterable one level at a time. Those per-map columns all start switched off, because **District** already names the same areas; turn on the ones you want from the column chooser. A CSV export writes every one of them.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Old and new maps live side by side',
        text: 'Canada redrew its federal ridings for the 2023 representation order, the United States redraws congressional and legislative districts after each census, and several states redraw again mid-decade by court order. You often need the outgoing map to compare with past results and the incoming one to target. Each is its own set with its own **vintage** label, and one household holds both without either being wrong.',
      },
      { kind: 'h2', id: 'ways-to-get-a-map', text: 'Four ways to get a map' },
      {
        kind: 'list',
        items: [
          '**Select a published map.** The fastest option when one covers your seat. pplCRM keeps ready-made maps for Canadian federal ridings, Ontario and Alberta provincial ridings, and US congressional, state senate and state house districts. Pick it from a list and it is downloaded and matched for you — nothing to find, convert or upload, and no cost. Municipal wards and precincts are not among them.',
          '**Import the names you already have.** Cheapest and fastest when no published map covers you. If your rows already carry a district, ward or precinct column — a purchased voter file almost always does — the import wizard writes those names straight onto each household. No shapes to find, no lookups, no cost. See [Import district, ward and precinct columns](/help/importing-districts).',
          '**Upload a map file.** A GeoJSON file from whoever publishes it: an elections body, a provincial commission, a city open-data portal. You name the set, declare its role, and say which property in the file holds each area’s name.',
          '**Draw it yourself.** For the many municipalities that publish nothing usable, draw the areas on the map with your own household pins visible underneath. See [Drawing boundaries on the map](/help/drawing-boundaries).',
        ],
      },
      {
        kind: 'p',
        text: 'These are not exclusive. A workspace commonly selects the state’s legislative districts, imports precinct names from its voter file, and draws its own organizing areas, all at once. Each is a separate set and each household holds all of them.',
      },
      { kind: 'h2', id: 'select-published', text: 'Selecting a published map' },
      {
        kind: 'p',
        text: 'Open **Boundaries** in [Workspace settings](/workspace) and choose to add a published map. Maps that match a campaign you are already running are listed first. Each row names the body that publishes it, the edition, and how many areas it holds; adding one shows the licence and the attribution the publisher requires. The areas are then matched against every household that has coordinates, which costs nothing.',
      },
      {
        kind: 'p',
        text: 'A published map is read-only, because every workspace using it shares the same file — you can delete it, but you cannot rename or reshape its areas. If you need to change the lines, upload your own copy or draw them instead. When a legislature redraws its boundaries the new edition is added as a separate map with its own vintage, and the one you already added stays exactly as it is.',
      },
      { kind: 'h2', id: 'upload', text: 'Uploading your own map file' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Get the file as GeoJSON',
            detail:
              'Most open-data portals offer GeoJSON directly. If yours only publishes a shapefile, convert it to GeoJSON first with whatever mapping tool you already use.',
          },
          {
            title: 'Open Boundaries in [Workspace settings](/workspace) and choose to upload',
            detail: 'Give the set a name your organizers will recognize in a dropdown.',
          },
          {
            title: 'Declare its role',
            detail:
              'Seat area, voting subdivision, or locality. This is the field that gives the set its meaning, and it is the one worth getting right.',
          },
          {
            title: 'Pick which property holds the name',
            detail:
              'The uploader lists every property it found in your file with an example value from the first area, so you can see which one holds `Ward 12` and which holds `12`. Pick a code property too if the file has one.',
          },
          {
            title: 'Save',
            detail:
              'The areas are listed, the original file is kept in your workspace files, and every household already on the map is matched against the new set straight away. Matching costs nothing.',
          },
        ],
      },
      {
        kind: 'p',
        text: 'Uploads have limits, and a file that breaks one is refused with a message naming the limit rather than failing quietly: **20 MB** per file, **5,000** areas in one set, **50,000** points in one area’s outline, and **50** sets per workspace. A national file that is too large usually fits comfortably once split per province or state, which is also faster to match against.',
      },
      { kind: 'h2', id: 'matching', text: 'How a household gets its areas' },
      {
        kind: 'p',
        text: 'Matching compares a household’s coordinates against each area’s outline and records the ones it falls inside. It is arithmetic on our own servers: it calls no outside service and costs nothing, so it re-runs whenever coordinates change, whenever a map changes, and whenever a new map arrives. A household with no coordinates yet has no areas yet — see [Geocoding, boundary matching, and what each costs](/help/geocoding-and-costs).',
      },
      {
        kind: 'p',
        text: 'Only the maps your workspace actually needs are matched, worked out from your active campaigns. An Arizona state house campaign needs Arizona’s lower-chamber districts and its precincts, not fifty states’ worth of everything. Saving a campaign — creating one, or changing its jurisdiction, region or chamber — queues a matching pass over the households you already have right away, and a nightly sweep backstops it, so the areas fill in behind you.',
      },
      { kind: 'h2', id: 'turfs', text: 'Boundaries and canvassing turfs' },
      {
        kind: 'p',
        text: 'Turf cutting uses the finest voting-subdivision map your workspace holds for that campaign’s jurisdiction and region. With none, it falls back to the seat-area map. With neither, every door lands in one bucket and turfs are grouped purely by which doors sit near each other — which is what happened before boundary maps existed, now reached deliberately instead of by accident. See [Canvassing](/help/canvassing).',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'A map here is for organizing work, not for compliance',
        text: 'An uploaded map is exactly as accurate as the file you uploaded, and a drawn map is approximate by nature. Neither is a legal source. In particular, the electoral district printed on a donation receipt is a value you enter yourself in the receipting settings and on the campaign — it is never read off one of these maps. See [Donation receipts and giving statements](/help/donation-receipts).',
      },
      { kind: 'h2', id: 'housekeeping', text: 'Renaming, replacing and deleting' },
      {
        kind: 'p',
        text: 'Rename a set or any single area at any time; the new name shows everywhere immediately. Deleting a set removes it and every household’s membership in it, and changes nothing else about those households. Because matching is free, deleting a set and adding a better one costs nothing but a little of our own processing, so there is no reason to live with a map you have outgrown.',
      },
    ],
  },
  {
    id: 'drawing-boundaries',
    category: 'admin',
    title: 'Drawing boundaries on the map',
    summary:
      'Draw ward, precinct or organizing areas by hand, over your own household pins. Free, quick, approximate — and fine for canvassing but not for anything legal.',
    keywords: [
      'draw',
      'drawing',
      'polygon',
      'hand drawn',
      'sketch',
      'boundary',
      'ward',
      'precinct',
      'turf boundary',
      'organizing areas',
      'overlap',
      'gap',
      'snap',
      'vertex',
    ],
    related: ['district-boundaries', 'geocoding-and-costs', 'canvassing', 'campaign-jurisdictions'],
    blocks: [
      {
        kind: 'p',
        text: 'Thousands of municipalities publish no usable ward or precinct map. Rather than hunt for a file that may not exist, draw the areas yourself. It usually takes a few minutes, it costs nothing, and you do it with your own geocoded household pins visible underneath — so you can see exactly which doors fall where while you are still drawing, which is the whole reason to do it here rather than in external mapping software.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Drawn boundaries are approximate. Read this before you rely on one.',
        text: 'A shape drawn by hand is close, not exact. Two areas drawn next to each other will have small gaps and small overlaps along their shared edge unless you trace it very carefully, and pplCRM does not pretend otherwise. That is acceptable for what drawn maps are for — **organizing canvassing work**, where the line stands in for the rivers, rail lines and arterial roads you would not send a volunteer across. It is **not acceptable for anything legal or official**: never treat a drawn area as the electoral district printed on a donation receipt, or as evidence of which district someone lives in for a compliance purpose.',
      },
      { kind: 'h2', id: 'draw', text: 'Draw a set' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open Boundaries in [Workspace settings](/workspace) and choose to draw a map',
            detail:
              'The map opens framed on your workspace, showing the households you have coordinates for — as individual pins, or as counted groups when there are too many pins to draw. See [What you see underneath at full size](#households-under-the-map).',
          },
          {
            title: 'Name the set and give it a role',
            detail:
              'Seat area, voting subdivision, or locality. A drawn set does not have to be an official area at all — “the three neighbourhoods we are targeting” is a perfectly good set, and turfs can be cut along it exactly like a real precinct map.',
          },
          {
            title: 'Draw the first area',
            detail:
              'Pick up the drawing tool, click each corner around the area, and close the shape back at the point you started. The household pins stay visible the whole time.',
          },
          { title: 'Name the area', detail: '`Ward 3`, `Riverside`, `East of the tracks` — whatever your team says.' },
          {
            title: 'Draw the rest',
            detail:
              'Everything already saved stays on screen while you work. Place a new corner near a corner of a shape that already exists and it snaps onto it, so a shared edge can be traced without pixel-perfect clicking.',
          },
          {
            title: 'Read the two counts',
            detail:
              'The map reports two numbers: households in **no** area and households in **more than one**. They are counted when you open the map and again whenever you press **Check again** — after an edit, a notice reminds you to recheck. That is your quality check.',
          },
        ],
      },
      { kind: 'h2', id: 'counts', text: 'What the two counts are telling you' },
      {
        kind: 'list',
        items: [
          '**Households in no area** — a gap, or a genuine outsider. A small number at the edges of your map usually means a seam to close by dragging a vertex. A large number usually means an area you have not drawn yet.',
          '**Households in more than one** — an overlap. Two shapes cover the same ground, and at least one of them reaches further than you meant.',
          'Neither is an error and neither blocks anything. No data is lost either way, and both numbers move as you fix the shapes.',
        ],
      },
      {
        kind: 'p',
        text: 'When an address does land in an overlap, which area wins is not left to chance: areas are checked in name order, so the same address lands in the same area on every single run and your reports do not drift between refreshes. Fix the overlap when you get to it; until then, at least the answer is stable.',
      },
      { kind: 'h2', id: 'find-an-area', text: 'Finding an area on a big map' },
      {
        kind: 'p',
        text: 'Beside the map is the list of every area the map holds. Picking one from the list **moves the map to it** and frames it, so you do not have to know where it is before you can look at it — which matters on a national map of hundreds of ridings, where the area you want may be a province away from where you are looking. Clicking a shape on the map itself selects it without moving anything, because it is already in front of you. **Fit map to everything** returns to the whole map and all of your households.',
      },
      { kind: 'h2', id: 'households-under-the-map', text: 'What you see underneath at full size' },
      {
        kind: 'p',
        text: 'The households drawn under your areas are the ones inside the part of the map you are looking at, and they are redrawn each time you pan or zoom. That is what keeps the page quick for a real list: a provincial candidate can hold 35,000 households or more, which is far more pins than any browser can draw at once.',
      },
      {
        kind: 'list',
        items: [
          'Looking at a whole riding or city, the households are **grouped**: one shaded circle per area with a count in it, bigger where there are more doors. That is a density picture — where your doors are — rather than a list of them.',
          'Zoom in, or click a circle, and the groups break apart. Once fewer than 2,000 households are in view they are drawn as individual pins again.',
          'The caption under the map always says which of the two you are looking at, how many households are in view, and how many your workspace holds in total.',
        ],
      },
      {
        kind: 'p',
        text: 'None of this changes matching. Every household with coordinates is matched against every area, whether or not it was ever drawn on your screen.',
      },
      { kind: 'h2', id: 'edit', text: 'Reshape, rename, delete' },
      {
        kind: 'p',
        text: 'Click a saved area to select it, or pick it from the list. Drag any vertex to reshape it, rename it in place, or delete it after a confirmation. Every change re-runs matching for the whole set, so the two counts and every household’s areas are correct again by the time you look away. Redrawing an area you got wrong is genuinely cheap — there is no reason to leave a bad shape alone.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Drawing never costs anything',
        text: 'Drawing, reshaping, renaming, deleting and re-matching call no paid service at all. They only re-read coordinates that are already on file for your households. The one thing that does cost money is turning a brand-new address into coordinates in the first place — see [Geocoding, boundary matching, and what each costs](/help/geocoding-and-costs).',
      },
      { kind: 'h2', id: 'tips', text: 'Three habits that make it quicker' },
      {
        kind: 'list',
        items: [
          'Work outward from the pins. The doors you actually have are the only part of the map that matters; empty ground can be sloppy without costing you anything.',
          'Trace a shared edge by snapping onto the neighbour’s corners rather than eyeballing a parallel line. It is faster and it removes the gap and the overlap in one go.',
          'Save after each area rather than after all of them. You find a seam problem when one shape is wrong, not when twelve are.',
        ],
      },
    ],
  },
];
