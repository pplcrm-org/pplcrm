import { z } from 'zod';
import { phoneSchema, notesSchema, idSchema, nullableEmailSchema, addressSchema } from './core.schema';
import { COMPANION_VOLUNTEER_STATUSES } from './companion-access.schema';

/**
 * Do-not-contact channels (Campaigns §15). The flag lives on the person — it is a
 * global compliance override, never a per-campaign preference. A null/absent
 * channel list means "no contact on any channel".
 */
export const DNC_CHANNELS = ['email', 'phone', 'door'] as const;
export type DncChannel = (typeof DNC_CHANNELS)[number];

/**
 * Volunteer & staff standing (Campaigns §15) — first-class person status, not a
 * tag. Global (tenant-wide), single-valued, and read by team-membership logic,
 * so it is a structured concept. NULL/absent = "not a volunteer / not staff".
 * Volunteer carries a recruiting pipeline (prospective → active → inactive →
 * former); staff has no "prospective" — a person either is staff or has left.
 */
export const VOLUNTEER_STATUSES = ['prospective', 'active', 'inactive', 'former'] as const;
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number];

export const VOLUNTEER_STATUS_LABELS: Record<VolunteerStatus, string> = {
  prospective: 'Prospective',
  active: 'Active',
  inactive: 'Inactive',
  former: 'Former',
};

export const STAFF_STATUSES = ['active', 'inactive', 'former'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  former: 'Former',
};

export const PersonsObj = z.object({
  id: z.string(),
  household_id: z.string(),
  email: z.string(),
  email2: z.string(),
  first_name: z.string(),
  middle_names: z.string(),
  last_name: z.string(),
  home_phone: z.string(),
  mobile: z.string(),
  notes: z.string(),
  linkedin: z.string().nullable().optional(),
  twitter: z.string().nullable().optional(),
  facebook: z.string().nullable().optional(),
  instagram: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  preferred_contact: z.string().nullable().optional(),
  volunteer_status: z.string().nullable().optional(),
  staff_status: z.string().nullable().optional(),
  deceased_at: z.string().nullable().optional(),
  senior: z.boolean().nullable().optional(),
});

export const UpdateHouseholdsObj = addressSchema.extend({
  home_phone: phoneSchema('Home phone'),
  notes: notesSchema,
});

export const UpdatePersonsObj = z.object({
  campaign_id: idSchema.optional(),
  household_id: idSchema.optional(),
  company_id: idSchema.or(z.literal('')).nullable().optional(),
  email: nullableEmailSchema,
  email2: nullableEmailSchema,
  first_name: z.string().trim().max(100, 'First name is too long').nullable().optional(),
  middle_names: z.string().trim().max(100, 'Middle names are too long').nullable().optional(),
  last_name: z.string().trim().max(100, 'Last name is too long').nullable().optional(),
  home_phone: phoneSchema('Home phone'),
  mobile: phoneSchema('Mobile phone'),
  notes: notesSchema,
  linkedin: z.string().trim().max(255, 'LinkedIn URL is too long').nullable().optional(),
  twitter: z.string().trim().max(255, 'Twitter URL is too long').nullable().optional(),
  facebook: z.string().trim().max(255, 'Facebook URL is too long').nullable().optional(),
  instagram: z.string().trim().max(255, 'Instagram URL is too long').nullable().optional(),
  assigned_to: idSchema.or(z.literal('')).nullable().optional(),
  preferred_contact: z.string().trim().max(20, 'Preferred contact is too long').nullable().optional(),
  do_not_contact: z.boolean().optional(),
  do_not_contact_channels: z.array(z.enum(DNC_CHANNELS)).nullable().optional(),
  volunteer_status: z.enum(VOLUNTEER_STATUSES).nullable().optional(),
  staff_status: z.enum(STAFF_STATUSES).nullable().optional(),
  /**
   * Reported dead. A date rather than a boolean because "when did we learn this" is the
   * question that gets asked when a family complains about a letter. Setting it does NOT
   * imply do_not_contact here — the canvass path sets both deliberately; a staff edit that
   * wants the same should say so.
   */
  deceased_at: z.coerce.date().nullable().optional(),
  /** 65 or older. Null = never asked, which is not the same as false. */
  senior: z.boolean().nullable().optional(),
});

/**
 * What merging two people costs beyond the records themselves. Asked before the confirmation
 * dialog opens, so the dialog can name the consequence of *this* pair instead of showing a
 * standing caution on every merge, which people learn to click past.
 *
 * `companion_volunteers` is UNIQUE (tenant_id, person_id) and is an access grant, not data: when
 * both people hold a volunteer row the merge keeps the target's and deletes the source's, along
 * with that row's device sessions and approval tokens (see `PersonsRepo.mergePersons`). Each
 * status is null when that person has no volunteer row at all, which is the common case.
 */
export const PersonMergeImpactObj = z.object({
  companionAccess: z.object({
    target: z.enum(COMPANION_VOLUNTEER_STATUSES).nullable(),
    source: z.enum(COMPANION_VOLUNTEER_STATUSES).nullable(),
  }),
});
