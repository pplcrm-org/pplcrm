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
        text: 'Send now, or pick **Schedule for later** with a date and time; a scheduled newsletter goes out within a few minutes of that time. Until then it shows as **Scheduled** on the [Newsletters](/newsletters) list, where **Cancel schedule** moves it back to drafts; opening it also offers **Send now**. If something blocks a scheduled send when its time comes (a failed deliverability check, a sending pause), it returns to drafts and you are notified with the reason. A finished draft can also go out straight from the list. Its **Send…** button asks you to confirm before anything leaves, and stays disabled (with the reason shown on hover) until the draft has an audience, a subject and content, and your organization’s mailing address is set (it appears in the compliance footer). Sending identity — a verified domain, or your workspace’s pplCRM address — is checked at send time; see the sender rules below. While a send is running, a progress indicator appears in the top bar. You can keep working anywhere in the app; sending happens in the background.',
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
          'The default from-name and from-address also live there. Each newsletter can send from a different address — the one you choose in the composer is what the real send uses, not just the test — but only an address on a domain your workspace has verified, or your workspace’s own pplCRM address, can be chosen; that protects your deliverability, since bulk mail from an address on a domain we cannot authenticate is filtered or rejected. Clicking the verification link for an address does not, by itself, make it sendable — a personal Gmail or Outlook address you click-verify still gets refused at send time, because its domain is not one you have authenticated. If your workspace has no address that qualifies yet, the composer shows no From picker at all — leave the sender fields as they are and every send goes out from the workspace default address instead.',
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
              'Under **Workspace → Domains**, add the domain you send from. You’ll get a checklist of **4 required DNS records** to add at your domain provider (GoDaddy, Namecheap, Cloudflare, and similar); use the copy buttons so nothing gets mistyped, then select **Check DNS records**. Changes usually appear within minutes but can take up to 48 hours. A fifth record, DMARC, is recommended but optional; it never blocks verification. One of the four — **branded links** — defaults to `email.yourdomain`; if that name is already in use on your domain, select **use a different name** on that record and pick another (`links` and `go` are common). Once verified, set a **default From address** on that domain under **Workspace → Communications**. Mail authenticated with your own domain lands in inboxes; unauthenticated mail lands in spam.',
          },
          {
            title: 'Verify a mobile number',
            detail:
              'Under **Workspace → Communications → Sending phone verification**, enter a mobile number and confirm the 6-digit SMS code. One number per workspace, one time — required on every plan, because the sending reputation you share is shared by paying workspaces too.',
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
      { kind: 'h2', id: 'subscriber-cap', text: 'The Free-plan subscriber limit' },
      {
        kind: 'p',
        text: 'The Free plan includes up to **1,000 emailable subscribers**, and the limit is enforced at send time: while your workspace has more than 1,000 emailable subscribers, newsletter sends are blocked — the composer says so on **Review & send** instead of surprising you with an error. Nothing is deleted: your contacts all stay, and the block lifts the moment your emailable list is back at 1,000 or fewer (remove email addresses or mark people **Do not contact**) or you upgrade. Only *emailable* people count — contacts without an email address, do-not-contact records and suppressed addresses don’t.',
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
          'If a **contact import** comes back with an unusually high rate of **undeliverable addresses** (dead domains or disposable-email services), sending is paused pending review — the same purchased/scraped-list signal, caught before you ever hit send. Every people import checks each address’s domain and quietly suppresses the bad ones; see [Import from CSV](/help/import).',
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
        text: 'Some features are enforced by plan: the shared inbox (mailbox sync), forms, donations, automations, lists, volunteer management (teams and events) and API access (including Zapier) need **Grassroots** or higher; canvassing, deliveries and companion volunteer access need **Movement**. Moving to the Free plan turns these off — and synced inbox email is permanently deleted 30 days after the downgrade (see [Plans and billing](/help/settings)). See your options under [Workspace → Billing](/workspace/billing).',
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
    keywords: [
      'inbox',
      'email',
      'reply',
      'conversation',
      'response time',
      'sla email',
      'correspondence',
      'gmail keys',
      'sync',
      'attachments',
      'spam',
      'old emails',
      'history',
    ],
    related: ['dashboard', 'person-profile', 'shortcuts', 'settings'],
    blocks: [
      {
        kind: 'p',
        text: 'The [Inbox](/inbox) is a full email client inside the CRM. The difference from a personal mailbox: conversations connect to contact records, so an exchange with a supporter shows up on their profile’s **Emails** tab, context nobody has to forward around. When you open a conversation, a **person context rail** on the right shows who you’re talking to: their tags, issues of interest, and a link straight to their record.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'The shared inbox is a Grassroots feature',
        text: 'Connecting a real Gmail or Microsoft mailbox needs the **Grassroots** plan or higher; the demo workspace’s sample inbox is included free so you can try it. If a workspace moves to the Free plan, the inbox locks immediately, sync stops, and the synced email is permanently deleted **30 days** after the downgrade — upgrading within that window restores everything, but after it the mail cannot be recovered (your originals stay in Gmail or Microsoft either way). See [Plans and billing](/help/settings).',
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
          'The **Triage** rail on the left starts collapsed to an icon strip so the conversation list gets the room; hover it to read the folder names, or click the **»** button in its header to pin it open. Your choice is remembered on this browser.',
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
      { kind: 'h2', id: 'what-syncs', text: 'What syncs, and what doesn’t' },
      {
        kind: 'p',
        text: 'Connecting a mailbox pulls **the last 48 hours** of Inbox, Sent, Trash and Spam, and everything after that arrives as it lands. It deliberately does not import your archive: mail from months ago has already been dealt with, and importing it would drop thousands of already-handled messages into your open queue on day one. Connecting takes seconds rather than hours as a result. Your old mail stays where it is, in your mail client.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Attachments download when you open them',
        text: 'Small files come across during the sync so messages render complete. Anything larger is listed with its name, type and size, and is fetched the first time someone opens it — then kept, so the second open is instant and the file survives the original message being deleted. If the mailbox has since been disconnected, or the message deleted upstream, an unopened attachment can no longer be retrieved and the inbox says so.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Spam is visible but never opened',
        text: 'Messages your mail provider flagged as spam still sync, so a wrongly-flagged supporter is not invisible to you — you see the sender, subject, body and what was attached. Their images and attachments are never downloaded, because pulling junk-mail payloads onto our servers would mean storing and serving whatever is in them. If a spam message is genuine, move it out of spam in your mail client; it returns here on the next sync with everything available.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Archiving in your mail client tidies up here too',
        text: 'When you archive a message, move it to another folder, or let a rule file it, it leaves this inbox on the next sync — the same tidy-up, in both places. What you added here is not thrown away with it: comments, the person it was assigned to, its open or closed status and its star all stay on the message, and any link to it (an assignment email, a mention, an activity entry) still opens it. An assigned or starred message also stays on **Assigned to me** and **Favourites**, so archiving it upstream never quietly clears somebody’s list. Messages that left the mailbox and that nobody here ever commented on, assigned, closed or starred are cleaned up after 90 days.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Re-syncing',
        text: '**Re-sync recent mail**, under the mailbox settings, resets the sync position and pulls the last 48 hours again. It is for when a sync failed or looks incomplete. Older mail already in your inbox is untouched.',
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
          '**Trigger** is the one event that lets someone in: Form submitted, Person created, Tag added, List joined, Donation recorded, a billing event, a volunteer shift status, an event registration (new contact or existing supporter, optionally limited to one event), a yard sign delivered (the requester enrolls the moment their sign reaches the house), a task breaching its SLA (the person the task is linked to enrolls; tasks that an automation created are not counted, and the same person is enrolled by this trigger at most once a week, so an automation that creates tasks cannot keep re-triggering itself), a new subscriber or unsubscriber, a supporter going quiet (no opens or clicks for a number of days you choose), a campaign date arriving (see below), or plain Manual enrollment. Everything after the trigger is the sequence.',
          '**Campaign date arrives** enrolls everyone on a list of your choosing a set number of days before a campaign’s end date — countdown reminders, election-day sends. It needs all three parts (the campaign, the days-before number, the list) before it can be activated, and it re-reads the campaign’s end date daily, so moving the date moves the send with no edit here. Each person on the list is enrolled once, on that day.',
          '**Steps**: what happens, in order. Add a **Wait**, **Send email**, **Add tag**, **Add to list** (a static list — smart lists compute their own members), **Create task**, or **Notify team** at any insertion point; waits and actions can be mixed in any order. A contact an automation adds to a static list also fires any **List joined** automations watching that list.',
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
        text: 'Every automation is either **relationship** mail or **marketing** mail, shown as **Email type** in the workflow settings. Relationship mail is a direct response to something the person did themselves — a form they submitted, a shift they signed up for, a gift they gave — so it can reach contacts who never subscribed to your newsletter. Marketing mail is promotional: it only goes to subscribed contacts (everyone else is skipped, with the reason shown on the run), and it cannot send until your organization’s mailing address is set under **Workspace → Organization**, the same anti-spam requirement newsletters have. Most triggers decide the type for you: the person’s own actions are relationship (that includes an event they registered for and a yard sign they asked for), and **Supporter goes quiet** is always marketing — reaching out because someone stopped engaging is re-solicitation, not a reply. For triggers that could be either (Manual enrollment, Tag added, List joined, Person created, New subscriber, Campaign date arrives), the type defaults to marketing and you can switch it to relationship if the sequence truly answers the person’s own action.',
      },
      {
        kind: 'p',
        text: 'Whatever the type, people who unsubscribed, bounced, or are marked do-not-contact are skipped automatically (the run shows a neutral **Skipped** with the reason, not a failure). There is one deliberate exception: an automation on the **New unsubscriber** trigger may send one — and only one — final email to the person who just unsubscribed, so a goodbye or win-back message can actually reach them. Anyone who hard-bounced, reported spam, or is marked do-not-contact is still never emailed, and a second unsubscribe later does not earn a second message. Every automation email carries an unsubscribe link and counts toward your plan’s monthly email allowance and sending limits; if your workspace’s sending is paused, the step waits and retries instead of losing the email. In Recent runs an email step shows **Queued** from the moment the sequence reaches it until it has actually been handed to our mail provider — usually seconds — and then becomes **Success**, **Skipped** or **Failed**. If someone unsubscribes, or your workspace’s sending is stopped, in that gap, the email is dropped and the run says **Skipped** rather than claiming it was sent.',
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
