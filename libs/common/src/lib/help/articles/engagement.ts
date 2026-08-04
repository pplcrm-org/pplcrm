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
    related: ['donation-receipts', 'person-profile', 'forms', 'export', 'grid-basics'],
    blocks: [
      { kind: 'h2', id: 'donations', text: 'Donations: money received' },
      {
        kind: 'p',
        text: 'The [Donations](/donations) grid is the ledger of received gifts. Each donation belongs to a person, so a donor’s full giving history is always one click away on their profile’s **Donations** tab. The list works like the other grids — search finds donors by name or email, columns filter and sort, and long ledgers page instead of loading every gift at once — but rows are read-only: donation amounts and receipts have legal weight, so open a gift to change anything about it. See [Working in grids](/help/grid-basics).',
      },
      {
        kind: 'p',
        text: 'Four tabs sit at the top. **All** is the whole ledger, led by the total you have raised to date — every gift, including the monthly installments (they carry a **Monthly** chip). **One-time** narrows it to single gifts, so the month-over-month numbers are not moved by recurring money. **Monthly pledges** is the recurring commitments themselves, and **Receipts & statements** is where receipts and year-end documents live.',
      },
      {
        kind: 'p',
        text: 'Most gifts arrive on their own through a fundraising page. For cash, a check, or a bank transfer collected offline, click **Record donation** at the top of the Donations page: pick the donor, enter the amount and their mailing address (no gift is recorded without one — receipts must print it), and choose a method (Card, Check, Cash, or Bank transfer). Official receipts are covered in [Donation receipts and giving statements](/help/donation-receipts): configure the regime in Workspace settings → Donations, then issue receipts by hand or turn on auto-issue.',
      },
      {
        kind: 'p',
        text: 'If a card gift is later refunded or charged back through Stripe, the donation updates itself. It shows as **refunded** or **disputed** and stops counting toward the donor’s giving totals and contribution limits, so your reports stay honest without any manual cleanup. Any receipt covering the gift is cancelled at the same moment — a reversed gift never keeps a live receipt. A chargeback you later win flips the gift back to succeeded automatically; its receipt stays cancelled until you reissue it (receipt numbers are never silently reused).',
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
    id: 'donation-receipts',
    category: 'engagement',
    title: 'Donation receipts and giving statements',
    summary:
      'Every gift is receipted by email the moment it arrives. Official tax receipts are issued at year end, or one at a time on request.',
    keywords: [
      'receipt',
      'acknowledgement',
      'thank you',
      'official receipt',
      'tax receipt',
      'giving statement',
      'year-end',
      'CRA',
      'charity',
      'political contribution',
      'registered agent',
      'cancel receipt',
      'reissue',
      'signature',
      'statement',
    ],
    related: ['donations', 'person-profile', 'settings'],
    blocks: [
      { kind: 'h2', id: 'every-gift', text: 'Every gift is receipted straight away' },
      {
        kind: 'p',
        text: 'When a donation is recorded — through a fundraising page, a monthly pledge charge, or the **Record donation** dialog — pplCRM emails the donor a **donation receipt** within moments, with a PDF attached. It shows your organization, the donor, the amount, the date and the payment method, and it carries a numbered reference beginning with **A-**. There is nothing to set up and nothing to turn on: it works in a brand-new workspace, and it works for organizations that issue no tax receipts at all.',
      },
      {
        kind: 'p',
        text: 'This document is deliberately **not** a tax receipt, and it says so on its face. It makes no claim about deductibility, so it needs no registration number, no authorized signatory and no mailing address. If a gift is later refunded or charged back, its receipt is cancelled along with any tax receipt covering the gift.',
      },
      { kind: 'h2', id: 'setup', text: 'Set up tax receipting once' },
      {
        kind: 'p',
        text: 'Official tax receipts are a separate document, and they are optional: a municipal campaign or a United States committee has no tax receipt to issue, and leaving this unconfigured is a perfectly normal resting state. If your organization does issue them, go to [Workspace → Donations](/workspace/donations) and choose your **receipting regime**: registered charity (CRA official donation receipts), federal political, or a provincial political regime (Ontario, British Columbia, Alberta, Quebec). The regime decides what a receipt must contain and who may sign it. Then fill in your legal organization name and address, registration number, the signatory’s name and title, a receipt number prefix, and the place of issue. **Preview receipt** shows a SPECIMEN-watermarked sample before anything real is issued.',
      },
      {
        kind: 'p',
        text: 'You can also upload a **signature image**, which is printed above the signatory’s name; a scanned facsimile is accepted under every regime here. Uploading one is your organization’s decision, not a requirement pplCRM imposes: if there is none on file the receipts page says so, and receipts still issue, printing the signatory’s name and the words “Authorized signature” without an image above them.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Check who may issue receipts',
        text: 'Only specific roles may issue contribution receipts — federally a registered agent or official agent; provincially the role your electoral authority prescribes; for charities, someone the charity authorizes. Confirm with your own counsel or electoral authority before issuing. Two special cases the app enforces: Ontario candidate campaigns are receipted by Elections Ontario (gifts are recorded here, not receipted here), and Quebec provincial receipts are issued by Élections Québec, so pplCRM never prints them.',
      },
      { kind: 'h2', id: 'statements', text: 'The year-end run' },
      {
        kind: 'p',
        text: 'Official tax receipts go out once a year. On the [Receipts & statements](/donations/receipts) tab, pick a year and press **Run year-end**. Every donor with a successful gift in that year receives one document: a **numbered official tax receipt** covering their receiptable giving, where your workspace is set up to issue one and the donor has a mailing address on file — otherwise a **giving summary**, which lists every gift but is explicitly not an official receipt. Gifts your regime says are receipted by the electoral authority — Ontario candidate-campaign contributions — are never included on an official receipt issued here; a donor whose gifts were all of that kind receives the giving summary instead.',
      },
      {
        kind: 'p',
        text: 'Donors with an email on file receive theirs automatically (large batches send in waves over a few hours); the rest are marked **Print & mail** for you to download. You are notified when the run completes, with a count of tax receipts, summaries and to-print documents. Rerunning a year only fills in donors who do not already have a document for it.',
      },
      { kind: 'h2', id: 'issuing', text: 'Issuing a tax receipt on request' },
      {
        kind: 'p',
        text: 'A donor who wants their tax receipt before year end does not have to wait. Open the gift from the [Donations](/donations) grid (or the person’s Donations tab) and press **Issue receipt**. Tax receipts are **numbered gap-free per year** and immutable once issued: corrections go through **cancel and replace**, which cancels the old receipt (kept forever, marked cancelled, with your reason) and issues a successor that prints “cancels and replaces receipt No. …”. If a receipted gift is refunded or charged back, its receipt is cancelled automatically.',
      },
      {
        kind: 'p',
        text: 'A tax receipt needs the donor’s **mailing address** — online checkout collects it, and the Record donation dialog requires it. An older gift recorded without one shows “needs donor address”: add an address to the donor’s household, then issue. The immediate donation receipt is unaffected; it needs no address.',
      },
      {
        kind: 'p',
        text: 'The receipts list hides the per-gift donation receipts by default, because there is one for every gift and they would bury everything else. Turn on **Show acknowledgements** to see them.',
      },
      { kind: 'h2', id: 'pdf-failed', text: 'When a PDF says “Retry PDF”' },
      {
        kind: 'p',
        text: 'The PDF is drawn and filed a moment after the receipt itself is created, so a brand-new receipt shows a greyed-out **PDF** button for a few seconds. If the button turns into a red **Retry PDF**, that generation failed for good — usually something outside the receipt, such as file storage being briefly unreachable. The receipt is still valid and keeps its number; only the document is missing. Press **Retry PDF** and it is generated again. Retrying does not email the donor: once the PDF is there, download it and send it yourself if the original email never went out.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Receipts are records, not legal advice',
        text: 'pplCRM prepares documents from the details you configure; issuing legally valid receipts remains your organization’s responsibility. When in doubt, ask your counsel, the CRA, or your electoral authority.',
      },
      { kind: 'h2', id: 'demo-receipts', text: 'The sample receipts in a new workspace' },
      {
        kind: 'p',
        text: 'A workspace that starts with sample donations also starts with a donation receipt for each of them, so the ledger reads the way the real thing behaves. A charity or church workspace adds a few sample official tax receipts on top, configured under the sample organization’s name and registration number. All of it is cleared when you remove the demo data — your own details replace them, and nothing real is ever issued under the sample ones. See [Demo mode and sample data](/help/demo-mode).',
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
      {
        kind: 'callout',
        tone: 'info',
        title: 'What a response may change on someone you already have',
        text: 'A form is public, so anybody can submit one. When the email matches a person already in your workspace, the response is **linked** to them rather than allowed to rewrite them: it can fill a first name, last name or mobile that is currently blank, and nothing else. It never overwrites a value you already have, never changes their household or address, and never edits their notes. The full answers — address and message included — are kept on the response itself, where you can read them and apply anything worth keeping by hand. A brand-new person is created in full, address and all.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Only the fields your form defines are accepted',
        text: 'A submission is matched against your form’s own field list. Answers to fields the form doesn’t define are discarded and never reach the person record or the response — so a form with no address inputs cannot receive an address, whoever posts to it.',
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
        text: 'Submitting from your own server or backend instead? Create a **workspace API key** (Workspace settings → **API keys**) and send it as an `Authorization: Bearer` header. The key identifies your workspace on its own — no `?t=` needed — and lifts the anonymous per-visitor rate limit in favor of a per-workspace one built for batch traffic. The same key authenticates Zapier and the event RSVP and volunteer signup endpoints. API access is available on **Grassroots** and above.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Never put the API key in a public page',
        text: 'The key is a secret — anyone who has it can write into your workspace. Browser-side forms don’t need it (the public endpoint works keyless); the key belongs only in server-side code. If it ever leaks, **Revoke** it in Workspace settings → API keys: it stops working instantly. A workspace can hold **two keys at once**, which is how you rotate without downtime — add a second key, move your integrations onto it, then revoke the first. Each key shows when it was last used, so you can tell which one is still in service before you revoke anything.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Archive, don’t delete',
        text: 'A form with responses can be archived. Its public link shows a friendly closed notice and every record keeps pointing at it. Restore brings it back as a draft. Only an untouched draft with zero responses can be deleted outright.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Forms need a paid plan — including forms already published',
        text: 'Forms are available on **Grassroots** and above. If your workspace moves to the Free plan, published forms stop accepting submissions: anyone opening one on your website sees an error. Nothing is deleted — your forms and every response you have already collected stay exactly as they are, and everything resumes the moment you upgrade again. The Billing page warns you about this, and tells you how many published forms are affected, before the change goes through.',
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
    keywords: [
      'canvass',
      'canvassing',
      'turf',
      'door',
      'knock',
      'walk',
      'field',
      'companion',
      'volunteer',
      'gotv',
      'boundary',
      'ward',
      'precinct',
      'coverage',
    ],
    related: ['teams', 'lists', 'district-boundaries', 'drawing-boundaries', 'events-shifts'],
    blocks: [
      {
        kind: 'p',
        text: 'A **turf** is one walkable batch of doors, cut from a list you already have. You hand a turf to volunteers, they knock with the Canvass Companion on their phone, and every answer lands back in the CRM. Open [Canvassing](/canvassing) under **Field** in the sidebar. The sentence under the title sums the operation up: how many turfs exist, how many are being knocked right now, how many doors have been tried, and how many turfs still have nobody on them.',
      },
      { kind: 'h2', id: 'cut', text: 'Cut turfs from a list' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Click **Cut turfs from a list**',
            detail:
              'Pick the list of people or households you want knocked. Any [list](/lists) works, and a smart list is the one to prefer because the turfs can be re-read from it later.',
          },
          {
            title: 'Choose doors per turf',
            detail:
              '30 for a short shift, 40 recommended, 50 for experienced canvassers, 60 for pairs. The preview does the math in the open and estimates the walk time.',
          },
          {
            title: 'Confirm',
            detail:
              'Turfs are cut from the addresses the app has placed on the map, into batches whose doors sit next to each other. A turf never crosses a boundary line, and those lines tend to follow the rivers, rail lines and arterial roads, so nobody is sent across one. New turfs arrive marked **Needs canvassers**.',
          },
        ],
      },
      {
        kind: 'p',
        text: 'Which line that is depends on the maps your workspace holds for this campaign. Cutting uses the finest voting subdivision available — a precinct, a polling division, a poll — and falls back to the seat area (the ward, riding or congressional district) when there is no subdivision map. With no boundary map at all, doors are grouped purely by which ones sit near each other, and those turfs are labelled as unbounded so nobody mistakes the grouping for a real line. Getting a map in is quick and free: see [Boundary maps](/help/district-boundaries), or [draw one yourself](/help/drawing-boundaries) if your municipality publishes nothing usable.',
      },
      { kind: 'h2', id: 'statuses', text: 'What the badge on a turf means' },
      {
        kind: 'list',
        items: [
          '**Needs canvassers**: cut and ready to walk, but nobody is on it yet.',
          '**Links sent**: its canvassers have their personal Companion links. No knocks logged yet.',
          '**Knocking now**: a knock was logged on this turf in the last few hours.',
          '**Every door knocked**: every door in the turf has been tried at least once.',
          '**Retired**: closed to new knocks. Everything it collected stays in the field report.',
        ],
      },
      {
        kind: 'p',
        text: 'Nothing here is a setting you switch. Each badge is worked out from the knocks that have actually come in, so a turf tells you the truth about itself without anyone remembering to update it.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Only located doors get cut',
        text: 'A turf is built from households the app has geocoded. Addresses still being located are reported in the preview, never silently dropped — and once they resolve, **Refresh doors from list** brings them into the turf (see “Keeping a turf in step with its list” below).',
      },
      { kind: 'h2', id: 'open-turf', text: 'Open a turf' },
      {
        kind: 'p',
        text: 'Click a turf’s name — in the list, or its pin on the map — to open it. The turf page is where you see what is actually happening on the ground: a map of its doors (green where a volunteer had a conversation, amber where they knocked and nobody answered, grey where nobody has been yet) inside the turf’s dashed boundary, everyone walking it with the doors and conversations credited to each of them, and then every door in walk order with who lives there, what the last visit recorded, which canvasser recorded it, and when. Filter the door list to talked, knocked-no-answer, or not-yet to see what is left. Addresses link to the household and names to the person, so a doorstep note is one click from the record it belongs to. Managing canvassers, the join QR, refreshing from the list, and retiring the turf are all here too, alongside the turf’s activity log.',
      },
      {
        kind: 'p',
        text: 'Turfs arrive from the cutter with generated names, and the first thing worth doing is calling them what your organizers call them. **Rename turf** — in a turf’s ⋯ menu on the list, or the pencil beside the name on the turf page — changes it everywhere at once: canvassers already walking it see the new name the next time their Companion refreshes, and the field report files it under the new name too. Nothing else moves. Its doors, the knocks already logged and every link you have handed out all keep working, and the rename itself is recorded in the turf’s activity log with who did it.',
      },
      { kind: 'h2', id: 'assign', text: 'Put canvassers on a turf' },
      {
        kind: 'p',
        text: '**Add canvassers** opens the turf’s roster. Search for people and add as many as you like at once, because a turf holds a whole group walking it together, not one person. Everyone you add gets their own personal Companion link, **sent to them automatically** by email and text (whichever contacts their [person record](/people) has on file). Links are personal on purpose: each volunteer proves it’s them with a one-time code sent to their own email or mobile, and a brand-new volunteer needs a one-time admin approval on the Volunteer access page before the turf loads. Remove someone from the roster and their link stops working immediately, while everyone else keeps walking and the doors they already knocked stay credited to them.',
      },
      {
        kind: 'p',
        text: 'By default a canvasser can also pick their own turf. Once they’re on at least one turf in a campaign, the Companion shows them every other turf in that campaign — nearest first if they let the phone share its location — so they can start on an unclaimed one or join a turf someone else is already walking, and switch between turfs mid-shift without you sending anything. If you would rather place every canvasser by hand, set **Which turfs a canvasser can see** to “Only turfs you assign them” in Settings → Companion Apps. You can also override it for one person from the Volunteer access page.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Before you assign',
        text: 'Make sure the volunteer’s person record has an email or mobile number. That’s where their link and verification code go. No contact on file means nothing can be sent and the link can’t be opened — the app warns you and leaves the copied link for you to deliver another way.',
      },
      { kind: 'h2', id: 'refresh', text: 'Keeping a turf in step with its list' },
      {
        kind: 'p',
        text: 'A list keeps moving after you cut from it: people are added, people move away, a smart list re-decides who belongs. **Refresh doors from list**, in a turf’s ⋯ menu or on the turf page, re-reads the list and brings the turf back in line. Doors still in the list are left exactly as they are, new addresses in the list that fall inside the turf’s own boundary are added, and doors that have left the list come off the turf. Knocks already logged are kept either way, so nothing disappears from the field report. The app tells you the count both ways before and after.',
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Greyed out? The turf has no list behind it',
        text: 'Only a turf that was cut from a list can be re-read from one, because that is where the doors came from. A turf built by hand has nothing to compare against, so the action is offered but disabled and says why.',
      },
      { kind: 'h2', id: 'join-qr', text: 'Sign volunteers up on the spot with a QR code' },
      {
        kind: 'p',
        text: 'Everything above assumes the volunteer is already in your database. For the five people who turned up at the launch and aren’t, use a **join code**. On the [Volunteer access](/volunteer-access) page, **Join by QR** gives you a QR code and an eight-character code to go with it — show it on your phone, project it, or print it on the sign-in sheet. Someone scans it, types their name and one contact, gets a one-time code to prove that contact is theirs, and lands in your approval queue. If they are already in your rolodex we match them rather than making a second copy; if they aren’t, we create them with volunteer status **Prospective** so you can tidy them up later.',
      },
      {
        kind: 'p',
        text: 'The eight-character code under the QR is not decoration — it is the way in for the phone whose camera won’t focus. Opening the companion app’s address on its own (**go.pplcrm.com** in production) asks for that code and then runs exactly the same sign-up. Read it out; the field ignores spaces, dashes, and case.',
      },
      {
        kind: 'p',
        text: 'A turf can have its own QR too — **Show join QR** in a turf’s ⋯ menu. Everyone who scans that one lands on that turf, which is how you get a group walking together off one poster. The campaign-wide code on Volunteer access drops people on the turf picker instead. Either way nobody sees a single door until you approve them: **Rotate code** mints a replacement and kills the old one instantly, so anything already printed stops working.',
      },
      { kind: 'h2', id: 'approve-by-text', text: 'Approve from your phone' },
      {
        kind: 'p',
        text: 'If you are the one running the launch, **Send to my phone** on the Join by QR panel texts you the whole thing on one page: the QR blown up to hold across a room, the eight-character code under it, and everyone who has scanned it waiting, with **Approve** next to each name. The list refreshes itself while you stand there. That link only ever goes to the mobile on your own profile (set it under **Mobile number** on [your profile](/profile) — the panel offers you the link if there is none on file), it only reaches the people who scanned that one code, and it stops working after twelve hours or the moment you rotate the code — whichever comes first.',
      },
      {
        kind: 'p',
        text: 'Approving from the Volunteer access page always works. But when you are the one who invited someone — you assigned them a turf, or you created the join code they scanned — we can also text you a link that approves them in one tap. It shows who is asking and what they’d be joining before you decide, and it expires after three days. It’s on by default — an unapproved volunteer is standing at a door unable to work, and a text is the fastest way to unblock them — but it only ever reaches you if your profile has a mobile number (**Mobile number** on [your profile](/profile)), and you can switch it off from the **Volunteer waiting for approval** row in your notification settings. Email and in-app alerts go out either way.',
      },
      { kind: 'h2', id: 'companion', text: 'The Canvass Companion' },
      {
        kind: 'p',
        text: 'The Companion is a web app, nothing to install. After verifying, the volunteer lands on their assignment, taps **Start walking**, and works the door list in the suggested walk order (any order works). Each row shows who lives there by full name — with a shared surname said once, so “Heather & Ross Gagnon” rather than the surname twice. At each door they survey the people on file (support level, top issues, follow-up flags, and notes) or record a one-tap result like not home or moved. Door-level outcomes (nobody home, inaccessible, refused, moved out) close a door with one tap and can be cleared just as fast, and “+ Add someone at this door” captures a new name on the spot. Every result syncs live to the person, the household, the turf’s progress, and the Activity log, attributed honestly as “via Canvass Companion”. No signal? Results queue on the phone and upload automatically when the volunteer is back online.',
      },
      {
        kind: 'p',
        text: 'The Companion works **one street at a time**. A turf is a neighbourhood; a shift is a street. It opens already narrowed to the street holding the volunteer’s next unknocked door, and the bar above the door list names it. Tapping that bar opens the street picker: every street in the turf, nearest first once the phone shares its location and in walk order otherwise, each with its own progress. There is no “all doors” option — nothing is hidden by that, because every street is in the list (including one bucket for doors with no street on file) and the whole turf’s total is stated underneath. The progress bar tracks the street in view, with the turf’s own count on the line below, so a finished street never reads as a finished turf.',
      },
      {
        kind: 'p',
        text: 'Rows carry what a canvasser needs before they knock. A coloured left edge and a thumb say where the door stands — green thumbs-up for a supporter, red thumbs-down for someone against, an amber question mark for undecided, and an amber group icon when the people at one door disagree. That reading comes from whatever the CRM already knows, from any source, so a turf is useful on its first morning rather than only after your own team has knocked it. A yard-sign icon means somebody there is already owed a sign, and a green check means somebody there has already voted. Doors nobody has ever ID’d carry no mark at all — an icon on every row would say nothing while competing with the ones that do. The map colours its pins from exactly the same reading, so a green row can never be a grey pin.',
      },
      {
        kind: 'p',
        text: 'Apartments fold into their building. Forty flats at 58 Huron Avenue arrive as forty households sharing one street address, so the walk list shows one row — “58 Huron Avenue N · 40 units · 3 attempted” — that opens into the unit list. Units are ordered the way a hallway runs (101, 102, then 1003, with lettered units like PH2 last), and each one behaves exactly like a door on a street. A building only counts as done when every unit in it does.',
      },
      {
        kind: 'p',
        text: 'When a group is splitting one turf, the street picker also shows who has taken what — “Dana is here” next to a street someone else picked. It’s a note to the group, never a lock: any volunteer can still take any street, and nothing stops a knock. Streets are handed back automatically when someone picks a different one, switches turfs, or ends their shift.',
      },
      {
        kind: 'p',
        text: 'Because several people can walk one turf at once, the door list re-checks itself about once a minute and says how fresh it is (“Updated just now”). Tap that line to update immediately. It means a door someone else just knocked shows up as knocked instead of being knocked twice — and anything the volunteer recorded but hasn’t synced yet is kept, not overwritten.',
      },
      {
        kind: 'p',
        text: '**End shift on this device**, on the volunteer’s **Me** tab, signs that phone out: the device session is revoked, so the phone has to verify a fresh one-time code before it can see the turf again. Worth doing on a shared or borrowed phone, and worth knowing before doing it on a personal one. It syncs anything still waiting first, and if something genuinely cannot be sent it says how much will be lost before you confirm. A volunteer who ends a shift by mistake is not locked out — their turf assignment is untouched, and they verify a code and carry on.',
      },
      {
        kind: 'p',
        text: 'Occasionally a result cannot be sent — the turf’s door list changed while the phone was offline, for instance, so the household it names is no longer part of the turf. The Companion never deletes that result. A red bar appears at the top of every screen saying how many results couldn’t sync, and the **Me** tab lists each one by name with the reason. **Try again** re-sends the ones a retry could still fix (useful right after you refresh a turf’s doors from its list), and **Discard this one** removes a result the volunteer decides is not worth keeping. Nothing on that list has reached the CRM, so it is worth clearing before the phone is put away.',
      },
      {
        kind: 'p',
        text: 'Survey answers do real work: a support level updates the person’s support reading for the turf’s [campaign](/workspace/campaigns), **Wants a yard sign** drops a request straight into the [Deliveries](/deliveries) intake pool, **Wants to volunteer** sets their volunteer status to Prospective on the person record, **65 or older** records their age band on the person record so you can build a seniors list, contact details fill in blanks on the person record, and **Do not contact** suppresses them everywhere, immediately.',
      },
      {
        kind: 'p',
        text: 'A canvasser also meets things that are wrong with the record itself, and the bottom of the survey is where those go. **Deceased** stamps the date on the person record and stops all contact immediately — one more letter to someone who has died is the worst thing a campaign’s data can do, so it does not wait for review. **Error in data** asks what is wrong and opens a task for the campaign admin with the volunteer’s own words; it changes nothing about the person, because “this is wrong” is a report, not a diagnosis. Both sit at the end behind a confirmation rather than in the quick-code row at the top, so neither is one mis-tap away from the most-tapped buttons on the screen. One open review task per person — a family of four at a wrong address does not become four identical tasks.',
      },
      {
        kind: 'p',
        text: 'Both facts are visible and editable on the person record, under **At the door** in the standing card: the senior band as a three-way choice (65 or older / under 65 / not recorded — “not recorded” is a real answer, because nobody has asked), and the deceased mark with the date it was recorded. Undoing a deceased mark restores the record but deliberately leaves do-not-contact in place. Both are filters in the [smart-list](/lists) rule builder as **Senior (65+)** and **Deceased**.',
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
        text: 'The **Coverage** card shows where you have actually walked. On the **Street map** every door is a dot (green where a volunteer had a conversation, amber where they knocked and got no answer, and grey where no one has been yet), with each turf drawn as a dashed boundary. Flip to the **By area** tab for the same picture as a table: doors, how much of each area has been knocked, and how many are still waiting. That tab is named with your campaign’s own word — **By ward**, **By riding**, **By precinct** — from the office it is running for (see [What office a campaign is running for](/help/campaign-jurisdictions)), and doors that fall in no area are grouped under **Unbounded**. Like the rest of the report it follows the range you pick, and it appears as soon as turfs are cut, even before the first knock.',
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
        text: 'Deliveries turns sign requests into optimized driving routes and hands each one to a volunteer. Open [Deliveries](/deliveries) under **Field** in the sidebar. The badge shows how many requests are approved and ready to route. A **Requests / Routes** switch at the top of the page flips between the incoming request pool and the routes you have already planned. **Routes** carries a count whenever volunteers are out delivering: it is the number of routes in progress, not the total number of routes, so an empty count means nobody has started one yet. The **Plan routes** button stays disabled until at least one request is approved and located. There is nothing to route before then.',
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
        text: 'On a route, assign the volunteer first. The link is personal to them. Click **Assign** next to Volunteer, search by name or email, and pick the person (use **Change** or **Remove volunteer** to swap or clear them later). Assigning **sends the volunteer their private link automatically** by email and text, using whichever contacts their person record has on file — no contact on file, and the app warns you to share the link yourself via **Copy volunteer link** (note that copying mints a fresh link, which replaces the one that was sent). If the message went missing — or the volunteer’s contact details changed — pick **Resend link to volunteer** from the route’s ⋯ menu: it emails/texts them a fresh link (the old one stops working). The link expires after 30 days as a security safeguard, unless an administrator turns expiry off under **Workspace → App** (handy when routes run longer than a month). You can do all of this without opening the route: the **Routes** list has an inline **Assign** on any unassigned row, and each row’s ⋯ menu covers assign/change volunteer, copy or resend the link, and cancel or delete the route. Like the Canvass Companion, the volunteer verifies a one-time code sent to their email or mobile on file, and a first-time volunteer needs a one-time admin approval on the Volunteer access page. Reorder the stops that are still pending by dragging one by its handle, or use the up and down arrows for the same move by keyboard; delivered and skipped stops stay where they are. Either way the estimate recomputes for you. Revoke or regenerate the link any time from the ⋯ menu.',
      },
      { kind: 'h2', id: 'route-map', text: 'See the route on a map' },
      {
        kind: 'p',
        text: 'Every route shows its own map: a pin for the start address, then one numbered pin per stop in visit order, coloured by what happened at that door (to deliver, delivered, couldn’t deliver). The dotted line is the visit order, not the driving path; our estimate measures distance between houses, not roads. **Open in Google Maps**, just above the map, launches turn-by-turn driving for the whole route. A stop whose household address hasn’t been located yet can’t be drawn, so the page says how many are missing instead of quietly leaving them out.',
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
