import type { LegalDoc } from './legal-types';

/**
 * The privacy policy. Every operational claim in here (retention windows,
 * cookie names, subprocessors, deletion behavior) mirrors what the product
 * actually does; if the product changes, change this document in the same
 * commit. Plain language on purpose: the policy is part of the pitch.
 */
export const PRIVACY_DOC: LegalDoc = {
  eyebrow: 'Legal',
  title: 'Privacy policy',
  intro:
    'What we collect, why, where it lives, and the things we will never do with it. Written to be read, not skimmed past.',
  updated: 'August 14, 2026',
  blocks: [
    {
      kind: 'h2',
      id: 'overview',
      text: 'Who we are and what this covers',
    },
    {
      kind: 'p',
      text: 'pplCRM (“we”, “us”) is a relationship platform for constituency offices, campaigns, non-profits and churches, operated from Canada. This policy covers the marketing site (pplcrm.com), the application (app.pplcrm.com and api.pplcrm.com), the volunteer companion apps (go.pplcrm.com), and the public pages organizations publish through us (their pages on pplforms.com). You can reach us about anything in this policy at hello@pplcrm.com.',
    },
    {
      kind: 'p',
      text: 'The short version: we collect what we need to run the service and nothing else. We never sell, share, rent or mine the people in your workspace. We run no advertising trackers and no third-party analytics anywhere. Delete means deleted.',
    },
    {
      kind: 'h2',
      id: 'roles',
      text: 'Two kinds of data: yours and your organization’s',
    },
    {
      kind: 'p',
      text: 'It helps to separate two roles, because your rights differ between them.',
    },
    {
      kind: 'list',
      items: [
        '**Data we control.** Your account details, billing information, support conversations and website interactions. For this data, we decide how it is handled, and this policy is the full story.',
        '**Data your organization controls.** Everything inside a workspace: the constituents, voters, donors and volunteers your organization stores, plus notes, donations, form submissions and synced email. Here the organization is the data controller and we are its service provider; we process this data only on the organization’s instructions and never for our own purposes.',
      ],
    },
    {
      kind: 'p',
      text: 'If you are in an organization’s list rather than a pplCRM account holder, the section “If you are in one of our customers’ lists” below is written for you.',
    },
    {
      kind: 'h2',
      id: 'account-data',
      text: 'What we collect about account holders',
    },
    {
      kind: 'list',
      items: [
        '**Identity and sign-in.** Your name, email address and password. Passwords are stored only as an argon2id hash; nobody at pplCRM can see them. If you enable passkeys or two-factor codes, we store the public credential or a hashed one-time code, never a usable secret.',
        '**Session security data.** The IP address and browser signature of your active sessions. We keep these so we can show you where you are signed in and challenge sign-ins from a new device or location.',
        '**Billing.** Paid plans are billed through Stripe. Stripe collects your card details and billing address directly; card numbers never touch our servers. We keep your plan, invoices and billing contact.',
        '**Phone number.** Only if you provide one, for example to verify sending. Every workspace verifies a mobile number once before its first newsletter. Verification codes are sent by SMS and stored hashed.',
        '**Support.** Emails you send to hello@pplcrm.com, so we can answer them and improve the product.',
      ],
    },
    {
      kind: 'h2',
      id: 'workspace-data',
      text: 'Data your organization stores in its workspace',
    },
    {
      kind: 'p',
      text: 'A workspace can hold contact details for people, households and companies, notes and tags, casework, donation history, event RSVPs, volunteer availability, and campaign facts such as support level and voting status. Some of this is politically sensitive personal information; we treat the entire workspace with the same care regardless of category.',
    },
    {
      kind: 'list',
      items: [
        '**Addresses and maps.** Household addresses can be geocoded so they appear on maps and turfs. Geocoding sends the street address to the Google Maps Geocoding API and stores the resulting coordinates.',
        '**Volunteer locations during canvassing.** While a volunteer walks a turf with the Canvass Companion, the app reports their position to their organization about once a minute, behind a banner on their phone that says so for the whole shift. Positions are visible only to the organization’s admins — never to other volunteers — and are deleted at midnight; only the day’s totals survive (when the shift ran, doors knocked, distance walked). An organization can restrict this to turf-level presence with no coordinates at all, and a volunteer who declines the browser’s location permission can still canvass.',
        '**Synced mailboxes.** If a workspace admin connects Gmail or Microsoft 365, we sync email content into the workspace so conversations sit next to the people they belong to. We take as little as does the job: syncing starts from **the last 48 hours** — we do not import your mail archive — and attachments are not copied to our servers unless someone opens them, apart from small inline images. Attachments on messages your provider marked as spam are never copied at all. The OAuth tokens for these connections are encrypted at rest with AES-256-GCM, and you can disconnect at any time. Our use of data received from Google APIs adheres to the Google API Services User Data Policy, including its Limited Use requirements.',
        '**Newsletter engagement.** When an organization sends a newsletter, delivery and engagement events (bounces, unsubscribes, opens and clicks) are recorded so the sender can respect them.',
        '**Uploaded files.** Imports and attachments are stored in Canada with the rest of your workspace data.',
      ],
    },
    {
      kind: 'h2',
      id: 'public-pages',
      text: 'Public forms, donations, events and volunteer links',
    },
    {
      kind: 'p',
      text: 'Organizations can publish signup forms, donation pages, event pages and volunteer links. Anything you submit on those pages goes into that organization’s workspace, and the organization is responsible for how it is used. Donation payments are processed by Stripe (see the subprocessor list below); we receive the donation record, never your full card details. Volunteers using a companion link verify with a one-time code sent to the email or mobile number the organization has on file; codes and device sessions are stored hashed and expire automatically. An organization can also publish a join code (usually as a QR code at an event). If you scan one and give your name and a contact, we create or match a record for you in that organization\u2019s workspace and send you a one-time code; a person at the organization must still approve you before you can see anything, and they can revoke that at any time.',
    },
    {
      kind: 'h2',
      id: 'how-we-use',
      text: 'How we use personal information',
    },
    {
      kind: 'list',
      items: [
        'To run the service: signing you in, storing and displaying your workspace, sending the emails and SMS messages you ask it to send.',
        'To bill you and send you invoices, receipts and important account notices.',
        'To keep the platform safe: rate limiting, new-device challenges, and the sending guards that pause senders whose mail bounces or draws complaints.',
        'To answer support requests, using the minimum data needed to help.',
        'To comply with the law when we genuinely must, and we will tell you when the law allows it.',
      ],
    },
    {
      kind: 'h2',
      id: 'what-we-never-do',
      text: 'What we never do',
    },
    {
      kind: 'list',
      items: [
        'We never sell, share, rent or trade personal information, yours or your organization’s. To anyone.',
        'We never use workspace data for advertising, profiling, or building products for other customers, and we do not use it to train machine-learning models.',
        'We run no third-party analytics, advertising pixels or fingerprinting scripts on the website or in the product.',
        'We never read workspace content out of curiosity. Access by our team is limited to what a specific support request or safety issue requires.',
      ],
    },
    {
      kind: 'h2',
      id: 'subprocessors',
      text: 'Service providers we rely on',
    },
    {
      kind: 'p',
      text: 'We use a small set of infrastructure providers, each for one job. They receive only what that job requires and may not use it for anything else.',
    },
    {
      kind: 'list',
      items: [
        '**Microsoft Azure.** Hosts the application, database and file storage in Canada.',
        '**Cloudflare.** Serves the marketing site and the public form, donation and companion pages at the network edge.',
        '**Stripe.** Subscription billing, tax calculation, and card donation processing. Stripe stores payment and donor data in the United States.',
        '**Postmark.** Delivers transactional email such as verification links, security codes and account notices.',
        '**SendGrid.** Delivers newsletters and automation emails from your organization’s own verified domain and reports delivery and engagement events.',
        '**Twilio.** Sends SMS one-time codes for volunteer verification and sending verification.',
        '**Anthropic.** Powers the newsletter deliverability check’s AI content review. It receives only the draft being checked (subject, body text and link list) when a check runs — never your contact lists — and under our agreement the content is not used to train models.',
        '**Sentry.** Collects error reports from our backend servers when something breaks, so we can fix it. Reports contain the technical failure details (the error, where in our code it happened, which background job or request type failed) with sign-in cookies, credentials and request bodies stripped before sending — never your contact lists or workspace records. Sentry stores these reports in the United States. Nothing from Sentry runs in your browser.',
        '**Google Maps.** Geocodes household addresses and renders maps.',
        '**Google and Microsoft.** Mailbox sync, only for workspaces that connect them.',
        '**Zapier.** Only if your organization creates an integration; data flows are defined by the workflows you build.',
      ],
    },
    {
      kind: 'h2',
      id: 'residency',
      text: 'Where your data lives',
    },
    {
      kind: 'p',
      text: 'Workspaces are hosted in Canada, and your workspace data stays in Canada for processing and backups. Signup asks whether you require a specific region (Canada, the United States or the European Union), and defaults to no requirement; choosing a region is part of the Movement plan. Only Canada is in operation today, so every workspace — including one that asked for another region — is created in Canada, and the request is recorded for if and when that region opens. Four narrow exceptions apply: card payments processed by Stripe are stored by Stripe in the United States, email or SMS necessarily travels to wherever the recipient is, newsletter drafts sent to the AI deliverability review are processed by Anthropic in the United States, and technical error reports from our backend (with credentials and workspace content stripped) are stored by Sentry in the United States.',
    },
    {
      kind: 'h2',
      id: 'retention',
      text: 'Retention and deletion',
    },
    {
      kind: 'p',
      text: 'We keep personal information only while it does its job, and the product enforces its own deadlines.',
    },
    {
      kind: 'list',
      items: [
        '**Records you delete** are removed from the live database immediately. Automated backups expire within 7 days, at which point deleted data is gone from those too.',
        '**Workspace deletion** can be scheduled by an organization admin. After a 30-day grace window (cancelable at any time), every record in the workspace is permanently deleted, and we confirm by email when it is done.',
        "**Login deletion** (deleting an individual user account) permanently removes the person's email address, name, password and sign-in credentials after the same 30-day cancelable window. Work they contributed inside a workspace (records, notes, activity history) belongs to that organization and stays in its workspace, attributed to “Deleted user”.",
        '**Activity logs** are kept for 90 days, then pruned automatically.',
        '**Synced mail you archive or move** out of a synced folder in your own mail client is hidden from the CRM but kept, so any comments, assignment or triage status your team added to it survive. If nobody ever commented on it, assigned it, starred it or closed it, the copy is deleted 90 days later.',
        '**Synced mail after a move to the Free plan.** The shared inbox is a paid feature. When a workspace moves to the Free plan, mailbox sync stops and its synced email is kept for 30 days, then permanently deleted along with the mailbox connection. Upgrading within those 30 days restores the inbox intact; the originals always remain in your own Gmail or Microsoft mailbox.',
        '**Export files** are downloadable for 30 days, then removed. **Import source files** are kept for 90 days so you can audit an import, then removed.',
        '**Donation receipts and giving statements** (the PDF documents) are kept for as long as the workspace exists — receipt rules require even cancelled receipts to be retained — and count toward the workspace storage quota. They are permanently deleted with the workspace.',
        '**Sessions** expire after 24 hours, or 30 days if you chose “remember me”. Volunteer device sessions expire after 30 days.',
        '**Suppression records** (unsubscribes, bounces, complaints) are kept while a workspace is active, because keeping them is what honors the opt-out.',
        '**Billing records** are kept as long as tax and accounting law requires.',
      ],
    },
    {
      kind: 'h2',
      id: 'security',
      text: 'How we protect it',
    },
    {
      kind: 'p',
      text: 'Encryption in transit everywhere, encrypted OAuth secrets at rest, hashed tokens, workspace isolation enforced by automated checks on every build, signature-verified webhooks, and least-privilege access for field volunteers. The full, honest detail (including what we do not claim) is on the [security page](/security).',
    },
    {
      kind: 'h2',
      id: 'cookies',
      text: 'Cookies',
    },
    {
      kind: 'p',
      text: 'We use exactly two cookies, both ours, neither used for tracking.',
    },
    {
      kind: 'list',
      items: [
        '**pc_refresh.** Keeps you signed in to the app. HttpOnly and secure, so scripts cannot read it.',
        '**pc_signed_in.** A yes/no flag that lets this website show “Dashboard” instead of “Log in” when you already have a session. It contains no personal data.',
      ],
    },
    {
      kind: 'p',
      text: 'There are no advertising cookies, no analytics cookies, and no third-party cookies. That is the whole list.',
    },
    {
      kind: 'h2',
      id: 'rights',
      text: 'Your rights',
    },
    {
      kind: 'p',
      text: 'Wherever you are, we extend the same rights: access the personal information we hold about you, correct it, receive a portable copy, and have it deleted. Account holders can exercise most of these directly in the product (export lives in settings; deletion is described above). For anything else, email hello@pplcrm.com and we will respond within 30 days. We comply with PIPEDA and applicable provincial privacy law in Canada, and with the GDPR and UK GDPR for workspaces and visitors in those regions. If you are unsatisfied with our answer, you can complain to your privacy regulator; in Canada that is the Office of the Privacy Commissioner.',
    },
    {
      kind: 'h2',
      id: 'in-someones-list',
      text: 'If you are in one of our customers’ lists',
    },
    {
      kind: 'p',
      text: 'If a constituency office, campaign, non-profit or church that uses pplCRM holds your information, that organization decides why and how it is used, and your request is theirs to answer: contact them directly to access, correct or delete your record, or to opt out of contact. Every newsletter sent through pplCRM carries the sender’s name, postal address and a working unsubscribe link, and unsubscribes are honored automatically across all future sends. If you contact us instead, we will forward your request to the organization and help them fulfill it.',
    },
    {
      kind: 'h2',
      id: 'children',
      text: 'Children',
    },
    {
      kind: 'p',
      text: 'pplCRM is a tool for organizations and is not directed at children. You must be the age of majority where you live to create an account. We do not knowingly collect personal information from children for our own purposes; organizations are responsible for the lawfulness of the records they store.',
    },
    {
      kind: 'h2',
      id: 'changes',
      text: 'Changes to this policy',
    },
    {
      kind: 'p',
      text: 'When this policy changes materially, we will email workspace admins and update the date at the top before the change takes effect. We will never weaken the commitments in “What we never do” quietly; a change to those would be announced prominently and in advance.',
    },
    {
      kind: 'h2',
      id: 'contact',
      text: 'Contact',
    },
    {
      kind: 'p',
      text: 'Privacy questions, requests and complaints all go to hello@pplcrm.com. A human reads every one.',
    },
  ],
};
