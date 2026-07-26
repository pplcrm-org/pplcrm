import type { LegalDoc } from './legal-types';

/**
 * The end user license agreement (the terms of service for the platform).
 * Operational specifics (plan caps, sending guards, deletion windows, the 1%
 * donation platform fee) mirror the product; if the product changes, change
 * this document in the same commit.
 */
export const EULA_DOC: LegalDoc = {
  eyebrow: 'Legal',
  title: 'End user license agreement',
  intro:
    'The agreement between you and pplCRM when you use the service. Plain language where the law allows it, and no surprises hiding in the numbered clauses.',
  updated: 'July 25, 2026',
  blocks: [
    {
      kind: 'h2',
      id: 'agreement',
      text: '1. The agreement',
    },
    {
      kind: 'p',
      text: 'These terms are a contract between pplCRM (“we”, “us”) and the organization or person creating an account (“you”). They cover the pplCRM application, the volunteer companion apps, the public pages you publish through us, and the marketing site. By creating an account, or by clicking agree at signup, you accept them. If you are accepting on behalf of an organization, you confirm you have authority to bind it, and “you” means that organization.',
    },
    {
      kind: 'p',
      text: 'You must be the age of majority in your jurisdiction to create an account. The [privacy policy](/privacy) explains how personal information is handled and is part of this agreement.',
    },
    {
      kind: 'h2',
      id: 'accounts',
      text: '2. Accounts and workspaces',
    },
    {
      kind: 'list',
      items: [
        'Each organization gets its own workspace, isolated from every other organization on the platform.',
        'You are responsible for the accuracy of your account information, for keeping credentials confidential, and for what happens under your seats. Tell us at hello@pplcrm.com immediately if you suspect unauthorized access.',
        'Workspace admins control who has access, including requiring two-factor authentication for the whole workspace, approving field volunteers, and deactivating people who leave.',
        'Signup requires a working email address; accounts with unverified email cannot sign in.',
      ],
    },
    {
      kind: 'h2',
      id: 'plans-billing',
      text: '3. Plans, billing and taxes',
    },
    {
      kind: 'list',
      items: [
        'Current plans, prices and limits are on the [pricing page](/pricing). Paid plans are billed in US dollars through Stripe; prices shown in other currencies are estimates only. Applicable sales taxes are calculated at checkout.',
        'Paid plans can be billed monthly or annually. Annual billing is paid up front for the year at 10× the monthly price — two months free — and renews yearly unless canceled.',
        'Paid plans are metered on emailable subscribers, not stored contacts. When your subscriber count crosses into a new bracket, we email your admins, move you to the new bracket, and charge the prorated difference for the remainder of your current billing period on either interval. Growing never interrupts your service. If your count shrinks, the price drops at the next renewal automatically.',
        'The free plan is free indefinitely, within its published limits (subscriber, sending, seat and storage caps). We may adjust free-plan limits with notice; we will never retroactively charge you.',
        'If a subscription payment fails, newsletter sending is placed on hold until the payment method is updated — nothing else is restricted, and reading and exporting your data are never affected.',
        'We may change paid pricing with at least 30 days’ notice; changes take effect at your next billing cycle, and you can cancel before they do.',
        'Downgrading or lapsing never locks your data. Reading and exporting stay available regardless of plan; features above your plan simply stop being editable.',
      ],
    },
    {
      kind: 'h2',
      id: 'cancellation',
      text: '4. Cancellation and refunds',
    },
    {
      kind: 'p',
      text: 'You can cancel your subscription at any time. Cancellation stops future renewals; your paid features run until the end of the period you have paid for. Except where the law requires otherwise, fees already paid are not refunded, and partial periods are not prorated. If you believe we have billed you in error, write to hello@pplcrm.com and we will fix genuine mistakes without ceremony.',
    },
    {
      kind: 'h2',
      id: 'your-data',
      text: '5. Your data stays yours',
    },
    {
      kind: 'list',
      items: [
        'You own the data in your workspace. We claim no rights to it beyond the narrow license needed to run the service for you: storing it, displaying it to your team, sending what you tell us to send, and backing it up.',
        'We never sell, share, rent or mine workspace data, use it for advertising, or use it to train machine-learning models. These commitments are stated in full in the [privacy policy](/privacy) and on the [data ownership page](/data-ownership).',
        'You can export everything to CSV at any time, on every plan.',
        'Workspace deletion is real: after a 30-day grace window it permanently and irreversibly deletes every record in the workspace. Export first; we cannot recover data you asked us to destroy.',
        'If your organization needs a signed data processing agreement, write to hello@pplcrm.com.',
      ],
    },
    {
      kind: 'h2',
      id: 'responsibilities',
      text: '6. Your responsibilities for the people in your list',
    },
    {
      kind: 'p',
      text: 'You are the steward of the people in your workspace, and the law sees it the same way: for workspace data you are the controller and we are your service provider. That means you are responsible for:',
    },
    {
      kind: 'list',
      items: [
        'Having consent or another lawful basis for the personal information you store and the messages you send, under the laws that apply to you (for example PIPEDA and CASL in Canada, CAN-SPAM in the US, GDPR and PECR in Europe and the UK).',
        'Complying with the election, campaign finance and donor disclosure laws of your jurisdiction, including any rules about who may donate and what records you must keep.',
        'Answering access, correction and deletion requests from the people in your list. The product gives you the tools; the obligation is yours.',
        'What your team and volunteers do with the access you give them.',
      ],
    },
    {
      kind: 'h2',
      id: 'acceptable-use',
      text: '7. Acceptable use',
    },
    {
      kind: 'p',
      text: 'We built pplCRM for legitimate community, political and non-profit work. You agree not to use it to:',
    },
    {
      kind: 'list',
      items: [
        'Send spam. Purchased, scraped or borrowed lists are prohibited; you may only email people who gave you their address with a reasonable expectation of hearing from you.',
        'Break the law, including privacy, election, anti-harassment and anti-discrimination law.',
        'Harass, threaten, defame or deceive people, or impersonate another person or organization.',
        'Probe, disrupt or overload the service, resell access to it, or attempt to access another organization’s workspace.',
        'Store data you have no right to hold, including data obtained by breach or deception.',
      ],
    },
    {
      kind: 'p',
      text: 'We may suspend or terminate accounts that break these rules. Where the situation allows it, we warn first and suspend second; where people are being harmed, we act first.',
    },
    {
      kind: 'h2',
      id: 'email-rules',
      text: '8. Email sending rules',
    },
    {
      kind: 'p',
      text: 'Deliverability is a shared resource, so the platform enforces guardrails and you agree to them:',
    },
    {
      kind: 'list',
      items: [
        'Newsletters are sent from your own verified domain. Every newsletter automatically carries your organization’s name, postal address, a working unsubscribe link and a “powered by pplCRM” attribution line, and this footer cannot be removed. Sending is disabled until the postal address is set.',
        'Unsubscribes, bounces and do-not-contact flags are honored automatically on all future sends. Attempting to circumvent suppression is a breach of this agreement.',
        'Every workspace verifies a mobile number before its first send, and new free-plan senders also warm up gradually under a daily cap.',
        'Each plan includes a monthly newsletter-email allowance (shown on the [pricing page](/pricing)), and it is enforced at send time: a send larger than what remains of your allowance is declined with the exact numbers, and the allowance resets each billing month. Emails sent by automations count toward the same allowance. Growing your list raises your bracket — and your allowance — automatically.',
        'Every newsletter passes a deliverability check before it sends. Content that scores in the blocked band — phishing-shaped links, scam patterns, or commercial marketing unrelated to your organization’s cause — will not send until fixed. Fundraising, auctions and event promotion are normal newsletter content and are not affected.',
        'Sending pauses automatically if your hard-bounce rate exceeds 5%, and is suspended if your spam-complaint rate exceeds 1%. We do this to protect both your sending reputation and everyone else’s; write to us to review and resume.',
        'Imported contact lists are checked on the way in: each address’s domain is verified and disposable addresses are flagged. Undeliverable addresses are suppressed automatically, and an import with an unusually high rate of them — the hallmark of a purchased or scraped list — pauses your sending pending review.',
      ],
    },
    {
      kind: 'h2',
      id: 'donations',
      text: '9. Donations',
    },
    {
      kind: 'list',
      items: [
        'Donation payments are processed by Stripe. We are not a payment processor, and card details never touch our servers.',
        'Card donations processed through Stripe carry a 1% platform fee in addition to Stripe’s own processing fees, as shown in the product.',
        'You are responsible for your eligibility to accept donations, for issuing any receipts the law requires, and for compliance with contribution limits and disclosure rules.',
        'Refunds and chargebacks are handled through the payment processor; the product reflects them against the donation record automatically.',
      ],
    },
    {
      kind: 'h2',
      id: 'volunteers',
      text: '10. Volunteer companion access',
    },
    {
      kind: 'p',
      text: 'Companion links give volunteers access to exactly the turf or route you assign, without an account. Volunteers verify with a one-time code and each must be approved once by an admin. You are responsible for who you approve, and you can revoke a volunteer or regenerate a link at any time. Companion sessions and links expire automatically unless you configure otherwise.',
    },
    {
      kind: 'h2',
      id: 'ip',
      text: '11. Intellectual property',
    },
    {
      kind: 'p',
      text: 'We own the pplCRM software, design and brand. We grant you a non-exclusive, non-transferable right to use the service while this agreement is in effect. You may not copy, modify, reverse engineer or create derivative works of the service except where the law grants that right regardless of contract. If you send us feedback or feature ideas, we may use them without obligation; that license covers the idea, never your data.',
    },
    {
      kind: 'h2',
      id: 'availability',
      text: '12. Availability and support',
    },
    {
      kind: 'p',
      text: 'We work to keep the service fast and available, and we maintain automated backups, but we do not promise uninterrupted service and self-serve plans carry no formal SLA. We may change the service as we improve it; if we materially remove functionality your plan depends on, we will give you notice and time to export. Support is by email at hello@pplcrm.com, and a human replies.',
    },
    {
      kind: 'h2',
      id: 'suspension-termination',
      text: '13. Suspension and termination',
    },
    {
      kind: 'list',
      items: [
        'You may stop using the service and delete your workspace at any time; section 5 describes how deletion works.',
        'We may suspend or terminate for breach of these terms, non-payment, legal requirement, or genuine risk to the platform or other customers. Except in urgent cases, we give notice and a chance to fix the problem first.',
        'On termination we will not withhold your data: export remains available for a reasonable wind-down period before deletion, except where the law forbids it.',
        'Sections that by their nature should survive (data commitments, disclaimers, liability limits, governing law) survive termination.',
      ],
    },
    {
      kind: 'h2',
      id: 'disclaimers',
      text: '14. Disclaimers',
    },
    {
      kind: 'p',
      text: 'The service is provided “as is” and “as available”. To the maximum extent the law allows, we disclaim implied warranties of merchantability, fitness for a particular purpose and non-infringement. pplCRM is a tool: we do not provide legal advice, and using features like consent tracking, suppression lists or receipts does not by itself make you compliant with the laws that apply to you.',
    },
    {
      kind: 'h2',
      id: 'liability',
      text: '15. Limitation of liability',
    },
    {
      kind: 'p',
      text: 'To the maximum extent the law allows: neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenues or data; and our total liability under this agreement is capped at the amounts you paid us in the 12 months before the event giving rise to the claim (or 100 US dollars if you are on the free plan). Nothing in this section limits liability that cannot lawfully be limited, and nothing in it weakens our data commitments in section 5.',
    },
    {
      kind: 'h2',
      id: 'indemnity',
      text: '16. Indemnity',
    },
    {
      kind: 'p',
      text: 'You will defend and indemnify us against third-party claims arising from your data, your messages, or your breach of sections 6 through 9, provided we tell you promptly about the claim and let you control the defense.',
    },
    {
      kind: 'h2',
      id: 'law',
      text: '17. Governing law',
    },
    {
      kind: 'p',
      text: 'This agreement is governed by the laws of the Province of Ontario and the federal laws of Canada applicable in it, and the courts of Ontario have exclusive jurisdiction, except that either party may seek injunctive relief for misuse of data or intellectual property in any competent court. If you are a consumer somewhere whose law gives you mandatory protections, those protections are unaffected.',
    },
    {
      kind: 'h2',
      id: 'changes',
      text: '18. Changes to these terms',
    },
    {
      kind: 'p',
      text: 'When these terms change materially, we will email workspace admins at least 30 days before the change takes effect, and update the date at the top. If you keep using the service after that date, the new terms apply; if you do not agree, cancel and export before it, and we will help.',
    },
    {
      kind: 'h2',
      id: 'contact',
      text: '19. Contact',
    },
    {
      kind: 'p',
      text: 'Questions about these terms go to hello@pplcrm.com. If anything here seems to conflict with the plain-language promises on the [data ownership page](/data-ownership), tell us; the stricter protection for you is the one we intend.',
    },
  ],
};
