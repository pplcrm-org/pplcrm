import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, WORKSPACE_CURRENCIES, WORKSPACE_CURRENCY_LABELS } from '@common';
import type { PcIconNameType } from '@icons/icons.index';

export type SettingsFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'number'
  | 'select'
  | 'toggle'
  | 'password'
  | 'url'
  | 'date'
  | 'day-toggles';

export interface SettingsOptionConfig {
  label: string;
  value: string;
}

export interface SettingsFieldConfig {
  key: string;
  label: string;
  type: SettingsFieldType;
  placeholder?: string;
  helper?: string;
  options?: SettingsOptionConfig[];
  defaultValue?: unknown;
  /** Span both columns of the section grid (textareas always do). */
  fullWidth?: boolean;
}

export interface SettingsSectionConfig {
  id: string;
  title: string;
  description: string;
  icon: PcIconNameType;
  fields: SettingsFieldConfig[];
}

/** One labeled cluster of sidebar nav items. */
export interface SettingsNavGroup {
  label: string | null;
  /** Section ids in display order — may mix form-driven (SETTINGS_SECTIONS)
   *  and self-saving custom sections (CUSTOM_SECTIONS in settings-page.ts). */
  ids: string[];
}

export const WORKSPACE_NAV_GROUPS: SettingsNavGroup[] = [
  { label: 'Workspace', ids: ['organization', 'modules', 'campaigns', 'access', 'data'] },
  { label: 'Email', ids: ['communications', 'email-sync', 'domains'] },
  { label: 'Features', ids: ['sla', 'donations', 'deliveries', 'app'] },
  { label: 'Plan & account', ids: ['storage', 'billing', 'api-keys', 'account'] },
];

// There is no personal nav any more. Notifications, theme and passkeys live in the avatar-menu
// dialog (`personal-settings-dialog`), which is the surface users actually find; the parallel
// /settings page rendered the same toggles from a second hand-maintained list and drifted from
// it. Appearance's two keys were never personal at all — they are tenant defaults, so they moved
// to Workspace → Organization, where saving them does not need an admin-only call from a page
// captioned "nothing here affects teammates".

/**
 * Every IANA zone the runtime knows, so a workspace anywhere can find itself. Built once at
 * module load; `supportedValuesOf` is absent on older engines, hence the fallback to the
 * browser's own zone plus the default.
 */
const TIMEZONE_OPTIONS: SettingsOptionConfig[] = (() => {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [...new Set([Intl.DateTimeFormat().resolvedOptions().timeZone, DEFAULT_TIMEZONE])];
  return zones.map((zone) => ({ label: zone.replace(/_/g, ' '), value: zone }));
})();

const CURRENCY_OPTIONS: SettingsOptionConfig[] = WORKSPACE_CURRENCIES.map((code) => ({
  label: WORKSPACE_CURRENCY_LABELS[code],
  value: code,
}));

export const SETTINGS_SECTIONS: SettingsSectionConfig[] = [
  {
    id: 'organization',
    title: 'Organization',
    description: 'Tenant branding, contact details, and campaign defaults.',
    icon: 'cog-6-tooth',
    fields: [
      {
        key: 'organization.name',
        label: 'Organization name',
        type: 'text',
        placeholder: 'pplCRM',
        defaultValue: '',
      },
      {
        key: 'organization.contact_email',
        label: 'Primary contact email',
        type: 'email',
        placeholder: 'hello@example.com',
        defaultValue: '',
      },
      {
        key: 'organization.phone',
        label: 'Contact phone',
        type: 'tel',
        placeholder: '(555) 555-1234',
        defaultValue: '',
      },
      {
        key: 'organization.address',
        label: 'Mailing address',
        type: 'textarea',
        placeholder: '123 Main St, Springfield, USA',
        defaultValue: '',
      },
      {
        key: 'organization.timezone',
        label: 'Time zone',
        type: 'select',
        defaultValue: DEFAULT_TIMEZONE,
        options: TIMEZONE_OPTIONS,
        helper:
          'Decides what “9am” means for service levels, working hours, and dates shown across the app. Without it the server’s clock is used, which is rarely yours.',
      },
      {
        key: 'organization.currency',
        label: 'Currency',
        type: 'select',
        defaultValue: DEFAULT_CURRENCY,
        options: CURRENCY_OPTIONS,
        helper: 'Used for donations, pledges, and event pricing — both what donors are charged and what you see.',
      },
      {
        key: 'appearance.date_format',
        label: 'Date format',
        type: 'select',
        defaultValue: 'MMMM d, yyyy',
        options: [
          { label: 'January 10, 2025', value: 'MMMM d, yyyy' },
          { label: '01/10/2025', value: 'MM/dd/yyyy' },
          { label: '10/01/2025', value: 'dd/MM/yyyy' },
        ],
      },
      {
        key: 'appearance.theme',
        label: 'Default theme',
        type: 'select',
        defaultValue: 'system',
        options: [
          { label: 'System', value: 'system' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ],
        helper:
          'The starting theme for everyone in this workspace. Anyone who picks their own theme from the avatar menu keeps it.',
      },
    ],
  },
  {
    id: 'data',
    title: 'Data & duplicates',
    description: 'Maintenance for the matching that powers duplicate detection.',
    icon: 'document-duplicate',
    // No stored settings — duplicate matching has no thresholds to tune. The section exists
    // to give the address-fingerprint recompute tool (rendered from settings-page.html) a home;
    // it was previously gated on this section id while no such section was registered.
    fields: [],
  },
  {
    id: 'app',
    title: 'Companion Apps',
    description: 'How the volunteer-facing apps and shared links behave for your organization.',
    icon: 'wrench-screwdriver',
    fields: [
      {
        key: 'app.volunteer_links_expire',
        label: 'Volunteer route links expire after 30 days',
        type: 'toggle',
        defaultValue: true,
        fullWidth: true,
        helper:
          'Links expire for security: if a route link is forwarded on or turns up on a lost phone months later, it no longer works, and volunteers aren’t confused by stale routes reappearing. Anyone opening a link still verifies a one-time code and needs your one-time approval, so turning expiry off is safe if your deliveries run longer than 30 days and you’re tired of re-sending links. Existing links follow whatever this is set to right now, and you can always revoke a single route’s link from its ⋯ menu.',
      },
      {
        key: 'app.canvass_volunteer_roam',
        label: 'Which turfs a canvasser can see',
        type: 'select',
        defaultValue: 'campaign',
        fullWidth: true,
        options: [
          { label: 'Any turf in their campaign — they pick their own', value: 'campaign' },
          { label: 'Only turfs you assign them', value: 'assigned' },
        ],
        helper:
          'This decides what an approved canvasser can see, not just what you hand them. On “any turf in their campaign” they get a turf picker in the app: they can start on an unclaimed turf, join one someone else is already walking, and switch between turfs mid-shift without you sending a new link. They never leave the campaigns you have already placed them in, and they still need your one-time approval first. Choose “only turfs you assign them” if you would rather place every canvasser by hand. You can override this for one person from Volunteer access.',
      },
    ],
  },
  {
    id: 'communications',
    title: 'Communications',
    description: 'Email delivery, inbox routing, and compliance copy.',
    icon: 'envelope',
    fields: [
      {
        key: 'communications.default_from_name',
        label: 'Default from name',
        type: 'text',
        placeholder: 'pplCRM Team',
        defaultValue: '',
      },
      {
        key: 'communications.default_from_email',
        label: 'Default from email',
        type: 'select',
        defaultValue: '',
        options: [],
      },
      {
        key: 'communications.reply_to',
        label: 'Reply-to email',
        type: 'select',
        defaultValue: '',
        options: [],
      },
      {
        key: 'communications.footer_disclaimer',
        label: 'Email footer disclaimer',
        type: 'textarea',
        placeholder: 'Paid for by pplCRM Campaign…',
        defaultValue: '',
        helper: 'Appended to the bottom of every newsletter, above the unsubscribe link.',
      },
      {
        key: 'communications.double_opt_in',
        label: 'Require double opt-in',
        type: 'toggle',
        defaultValue: false,
        helper: 'Require new web-form subscribers to confirm via email before they receive newsletters.',
      },
    ],
  },
  {
    id: 'access',
    title: 'Teams & access',
    description: 'Default role for new invites and tenant-wide MFA enforcement.',
    icon: 'user-group',
    fields: [
      {
        key: 'access.default_role',
        label: 'Default invite role',
        type: 'select',
        // Values are AUTH_ROLES, not the labels. 'Editor' is the label for the `user` role
        // (AUTH_ROLE_LABELS in libs/common/src/lib/auth.ts) — storing 'editor' here writes a
        // role no permission check recognises.
        defaultValue: 'user',
        options: [
          { label: 'Viewer', value: 'viewer' },
          { label: 'Editor', value: 'user' },
          { label: 'Admin', value: 'admin' },
        ],
      },
      {
        key: 'access.mfa_required',
        label: 'Require MFA for all users',
        type: 'toggle',
        defaultValue: false,
        helper: 'Force email verification codes for every user signing in from a new device or location.',
      },
    ],
  },

  {
    id: 'sla',
    title: 'Service levels',
    description:
      'Configure Service Level Agreements (SLAs) for tasks and emails, including working days, business hours, and status warning/critical thresholds.',
    icon: 'clock',
    fields: [
      {
        key: 'sla.tasks_hours',
        label: 'Task SLA target (working hours)',
        type: 'number',
        defaultValue: 24,
        helper: 'Maximum working hours allowed to resolve or close a task before it is considered an SLA breach.',
      },
      {
        key: 'sla.emails_hours',
        label: 'Email SLA target (working hours)',
        type: 'number',
        defaultValue: 24,
        helper:
          'Maximum working hours allowed to reply to an incoming inbox email before it is considered an SLA breach.',
      },
      {
        key: 'sla.email_warning_threshold',
        label: 'Email SLA warning threshold (breaches)',
        type: 'number',
        defaultValue: 1,
        helper: 'Number of active open email breaches that triggers a "Warning" (yellow) status on the dashboard.',
      },
      {
        key: 'sla.email_critical_threshold',
        label: 'Email SLA critical threshold (breaches)',
        type: 'number',
        defaultValue: 4,
        helper: 'Number of active open email breaches that triggers a "Critical" (red) status on the dashboard.',
      },
      {
        key: 'sla.task_warning_threshold',
        label: 'Task SLA warning threshold (breaches)',
        type: 'number',
        defaultValue: 1,
        helper: 'Number of active open task breaches that triggers a "Warning" (yellow) status on the dashboard.',
      },
      {
        key: 'sla.task_critical_threshold',
        label: 'Task SLA critical threshold (breaches)',
        type: 'number',
        defaultValue: 4,
        helper: 'Number of active open task breaches that triggers a "Critical" (red) status on the dashboard.',
      },
      {
        key: 'sla.working_days',
        label: 'Working days',
        type: 'day-toggles',
        defaultValue: '1,2,3,4,5',
        helper: 'Days of the week counted towards the SLA response and resolution calculations.',
      },
      {
        key: 'sla.working_hours_start',
        label: 'Working hours start (HH:MM)',
        type: 'text',
        defaultValue: '09:00',
        helper: 'Beginning of the business day for working time tracking.',
      },
      {
        key: 'sla.working_hours_end',
        label: 'Working hours end (HH:MM)',
        type: 'text',
        defaultValue: '17:00',
        helper: 'End of the business day for working time tracking.',
      },
    ],
  },
];
