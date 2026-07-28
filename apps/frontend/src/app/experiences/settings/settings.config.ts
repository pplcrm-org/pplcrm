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

/** One labeled cluster of sidebar nav items. `label: null` renders the items
 *  without an eyebrow (the personal /settings mode stays a flat list). */
export interface SettingsNavGroup {
  label: string | null;
  /** Section ids in display order — may mix form-driven (SETTINGS_SECTIONS)
   *  and self-saving custom sections (CUSTOM_SECTIONS in settings-page.ts). */
  ids: string[];
}

export const WORKSPACE_NAV_GROUPS: SettingsNavGroup[] = [
  { label: 'Workspace', ids: ['organization', 'campaigns', 'access'] },
  { label: 'Email', ids: ['communications', 'email-sync', 'domains'] },
  { label: 'Features', ids: ['sla', 'donations', 'app'] },
  { label: 'Plan & account', ids: ['storage', 'billing', 'api-keys', 'account'] },
];

export const PERSONAL_NAV_GROUPS: SettingsNavGroup[] = [
  { label: null, ids: ['notifications', 'appearance', 'passkeys'] },
];

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
    ],
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
    id: 'notifications',
    title: 'Notifications',
    description: 'Tenant-wide notification defaults and escalation.',
    icon: 'bell',
    fields: [
      {
        key: 'notifications.mention_in_comment',
        label: 'Mentioned in comment',
        type: 'toggle',
        helper: 'Alerts when someone mentions you in a thread',
        defaultValue: true,
      },
      {
        key: 'notifications.mention_in_comment_in_app',
        label: 'Mentioned in comment (in-app)',
        type: 'toggle',
        defaultValue: true,
      },
      {
        key: 'notifications.task_assigned',
        label: 'Task assigned',
        type: 'toggle',
        helper: 'Alerts when a task is assigned to you',
        defaultValue: true,
      },
      {
        key: 'notifications.task_assigned_in_app',
        label: 'Task assigned (in-app)',
        type: 'toggle',
        defaultValue: true,
      },
      {
        key: 'notifications.task_due',
        label: 'Task due today / overdue',
        type: 'toggle',
        helper: 'Daily reminder check of active tasks due',
        defaultValue: true,
      },
      {
        key: 'notifications.task_due_in_app',
        label: 'Task due today / overdue (in-app)',
        type: 'toggle',
        defaultValue: true,
      },
      {
        key: 'notifications.person_assigned',
        label: 'Person assigned',
        type: 'toggle',
        helper: 'Alerts when a contact ownership is assigned to you',
        defaultValue: true,
      },
      {
        key: 'notifications.person_assigned_in_app',
        label: 'Person assigned (in-app)',
        type: 'toggle',
        defaultValue: true,
      },
      {
        key: 'notifications.email_assigned',
        label: 'Email assigned',
        type: 'toggle',
        helper: 'Alerts when an inbox conversation is assigned to you',
        defaultValue: true,
      },
      {
        key: 'notifications.email_assigned_in_app',
        label: 'Email assigned (in-app)',
        type: 'toggle',
        defaultValue: true,
      },
      {
        key: 'notifications.export_ready',
        label: 'Export ready',
        type: 'toggle',
        helper: 'Receive download link when CSV export finishes',
        defaultValue: true,
      },
      {
        key: 'notifications.export_ready_in_app',
        label: 'Export ready (in-app)',
        type: 'toggle',
        defaultValue: true,
      },
      {
        key: 'notifications.import_summary',
        label: 'Import summary',
        type: 'toggle',
        helper: 'Spreadsheet import completion stats report',
        defaultValue: true,
      },
      {
        key: 'notifications.import_summary_in_app',
        label: 'Import summary (in-app)',
        type: 'toggle',
        defaultValue: true,
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
        defaultValue: 'editor',
        options: [
          { label: 'Viewer', value: 'viewer' },
          { label: 'Editor', value: 'editor' },
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
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Global UI defaults that users can override locally.',
    icon: 'sun',
    fields: [
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
    ],
  },
];
