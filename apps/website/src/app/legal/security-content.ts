import type { LegalDoc } from './legal-types';

/**
 * The security page. Every mechanism named here (argon2id, hashed tokens,
 * AES-256-GCM OAuth secrets, signature-verified webhooks, tenant-scoping
 * checks, retention windows) exists in the codebase; if an implementation
 * changes, change this document in the same commit. The honesty section
 * (no certification claims) is deliberate; do not add badges we have not
 * earned.
 */
export const SECURITY_DOC: LegalDoc = {
  eyebrow: 'Trust',
  title: 'Security',
  intro:
    'Boring, deliberate security: what we actually do to protect your list, described specifically enough to be checked. No badges we have not earned.',
  updated: 'August 22, 2026',
  blocks: [
    {
      kind: 'h2',
      id: 'approach',
      text: 'Our approach',
    },
    {
      kind: 'p',
      text: 'A political or community list is one of the most sensitive databases an organization holds: names, addresses, donations, opinions. We designed for that from the first table. The principles are simple: hold as little as possible, encrypt what must be held, hand out the narrowest slice that does the job, make deletion real, and verify everything that arrives from outside. This page describes the mechanisms, not aspirations.',
    },
    {
      kind: 'h2',
      id: 'isolation',
      text: 'Workspace isolation',
    },
    {
      kind: 'list',
      items: [
        'Every organization’s workspace is isolated. Every database query in the product is scoped to your workspace, and that rule is enforced by an automated check that runs on every build: code that touches workspace tables without workspace scoping fails and cannot ship.',
        'The application connects to the database with a least-privilege role, and row-level security in the database provides defense in depth behind the application checks.',
        'Public identifiers for people are deliberately non-sequential, so records cannot be enumerated by walking IDs.',
      ],
    },
    {
      kind: 'h2',
      id: 'accounts',
      text: 'Account security',
    },
    {
      kind: 'list',
      items: [
        '**Passwords** are hashed with argon2id (64 MB memory cost), the current best practice, and are never stored or logged in plain text. At signup, passwords are checked against known breach corpora and you are warned before choosing one that has leaked elsewhere.',
        '**Passkeys** (WebAuthn) are supported for phishing-resistant sign-in.',
        '**Two-factor authentication** challenges sign-ins from a new device or location with a short-lived one-time code, and workspace admins can require 2FA for everyone in the organization.',
        '**Sessions** use a short-lived access token plus a refresh token kept in an HttpOnly, secure cookie that page scripts cannot read. Session and refresh tokens are stored server-side only as SHA-256 hashes, so a database leak does not yield usable sessions. Sessions expire after 24 hours, or 30 days with “remember me”, and you can see and revoke your active sessions.',
        '**Abuse resistance:** sign-in attempts are rate limited per IP, verification codes expire in minutes and allow limited attempts, and sign-in responses are constant-time so attackers cannot discover which emails have accounts.',
      ],
    },
    {
      kind: 'h2',
      id: 'encryption',
      text: 'Encryption',
    },
    {
      kind: 'list',
      items: [
        'All traffic is encrypted in transit with TLS, with HSTS enforced. The application sets a strict content security policy and does not allow itself to be framed by other sites.',
        'Database connections are encrypted, and stored data is encrypted at rest by the hosting platform.',
        'OAuth tokens for connected mailboxes (Gmail, Microsoft 365) get an extra application-level layer: AES-256-GCM encryption with a key held outside the database.',
        'Secrets that only need comparison (session tokens, verification codes, reset codes, volunteer device sessions) are stored as one-way hashes, never as plaintext.',
      ],
    },
    {
      kind: 'h2',
      id: 'field-access',
      text: 'Field and volunteer access',
    },
    {
      kind: 'p',
      text: 'Field tools are where lists usually leak, so companion access is least-privilege by construction. A volunteer link exposes exactly one turf or route, never the list, and a volunteer never sees an email, a phone number or a donation history. Volunteers verify with a one-time code sent to the contact your organization has on file (codes expire in 10 minutes, five attempts maximum) and must be approved once by an admin before first use. By default an approved canvasser can also pick another turf inside the campaign they are already working in — never another campaign, never another organization — and you can turn that off for the whole workspace or for one person. Device sessions are stored hashed and expire after 30 days; links expire too, and both are revocable at any time. A lost phone is an inconvenience, not a breach of your list.',
    },
    {
      kind: 'p',
      text: 'The two links we text to staff are held to the same rule. An approve-by-text link decides one volunteer and dies on the first tap, after three days at most. The organizer link for a sign-up QR code shows that code and the people who scanned it, can approve only those people, and stops working after twelve hours or the moment you rotate the code. Both are stored hashed, and both only ever go to the mobile number on the recipient’s own profile.',
    },
    {
      kind: 'p',
      text: 'A donor’s giving-page link follows the same construction: it shows that one donor their own giving and nothing else, is stored hashed, expires on its own, and can be revoked by the organization at any time. Card updates on that page happen on Stripe’s hosted pages — card numbers never touch ours.',
    },
    {
      kind: 'h2',
      id: 'payments',
      text: 'Payments',
    },
    {
      kind: 'p',
      text: 'Card details never touch our servers. Subscriptions and card donations are processed by Stripe. We store the donation record; Stripe stores the payment instruments, under its PCI DSS obligations.',
    },
    {
      kind: 'h2',
      id: 'webhooks-integrations',
      text: 'Integrations and webhooks',
    },
    {
      kind: 'list',
      items: [
        'Every inbound webhook is authenticated before we act on it: Stripe events by signature, SendGrid events by ECDSA signature, and Postmark events by a shared token compared in constant time.',
        'Mailbox sync is opt-in per workspace, scoped by OAuth consent, disconnectable at any time, and its tokens are encrypted as described above.',
        'API keys for integrations are issued per workspace, stored only as a SHA-256 hash, and shown once at creation. A workspace can hold two at a time so a key can be rotated without downtime, and either can be revoked at any moment — revocation takes effect on the next request.',
      ],
    },
    {
      kind: 'h2',
      id: 'sending',
      text: 'Sending protections',
    },
    {
      kind: 'p',
      text: 'Outbound email is guarded because deliverability and trust are shared resources. Newsletters only leave from a domain you have verified with SPF and DKIM, and every workspace verifies a mobile number by SMS before its first send. New Free-plan senders also warm up gradually under a daily cap — 100 messages a day for their first seven days. Every newsletter also passes a deliverability check before it sends — a 0–100 score over content best practices plus an AI review that catches phishing-shaped and scam-like content; drafts scoring below 50 cannot send until fixed. The AI review runs on every send, on every plan — it exists to stop a compromised account from blasting phishing before a single message leaves, not just to police new signups. Each plan’s monthly email allowance (2× your subscriber cap on Free, 8× on Grassroots, 12× on Movement) is enforced in the send path, and emails sent by automations count toward the same allowance — send volume is tied to the audience size a workspace actually pays for, so a small plan cannot be used to blast a huge imported list. The Free plan’s 1,000-emailable-subscriber limit is enforced in the same path: a free workspace whose emailable list exceeds the limit cannot send newsletters at all until it reduces the list or upgrades. Sending pauses automatically when hard bounces exceed 5% and is suspended when spam complaints exceed 1%. Imported contact lists are checked on import — each address’s domain is verified and disposable addresses flagged — and undeliverable addresses are suppressed automatically; an import with an extreme rate of them pauses sending pending review. Suppression is enforced in the send path itself, for newsletters and automation emails alike: unsubscribed, bounced and do-not-contact addresses are excluded from every future send, and nobody in your workspace can override that.',
    },
    {
      kind: 'h2',
      id: 'infrastructure',
      text: 'Infrastructure, residency and backups',
    },
    {
      kind: 'list',
      items: [
        'The platform runs on Microsoft Azure, with workspaces hosted in Canada; workspace data stays there for processing and backups.',
        'The marketing site and public pages are served from Cloudflare’s edge with strict TLS between the edge and our origin.',
        'Databases are backed up automatically every day, with backups retained for 7 days in Canada. Deleted data therefore leaves backups within 7 days of leaving the live database.',
      ],
    },
    {
      kind: 'h2',
      id: 'monitoring',
      text: 'Audit trails',
    },
    {
      kind: 'p',
      text: 'Every change to a record is written to the workspace activity log with who, what and when, including actions taken through volunteer links, which are labeled as such. Exports are logged too, so an admin can always answer “who pulled the list”. Activity is retained for 90 days and exportable. When a background mailbox sync fails, the error recorded on the connection carries a support code that lets us find the exact server-side event without you sending us your data. Our servers are also monitored around the clock: automated probes check the service that stores and serves your data from outside every few minutes and page us when it is unreachable, background processing is watched on a slower cycle, and server errors are reported to an error-tracking service (with credentials and workspace content stripped — see the privacy policy’s subprocessor list) so we usually know about a problem before you do.',
    },
    {
      kind: 'h2',
      id: 'honesty',
      text: 'What we do not claim',
    },
    {
      kind: 'p',
      text: 'We are a small team and we would rather show you exactly what we do than imply an audit we have not had. We do not currently hold SOC 2 or ISO 27001 certification, and we do not display compliance badges we have not earned. What you get instead is specific, checkable engineering: the mechanisms on this page, the retention windows in the [privacy policy](/privacy), and the commitments on the [data ownership page](/data-ownership). If your organization requires a security questionnaire for procurement, write to us and we will answer it honestly.',
    },
    {
      kind: 'h2',
      id: 'disclosure',
      text: 'Reporting a vulnerability',
    },
    {
      kind: 'p',
      text: 'If you believe you have found a security issue, email hello@pplcrm.com with “Security” in the subject line and we will respond within 3 business days. Please give us reasonable time to fix the issue before disclosing it publicly, do not access data that is not yours, and do not degrade the service while testing. We will not take legal action against good-faith research that follows these rules, and we credit reporters who want credit once a fix ships.',
    },
  ],
};
