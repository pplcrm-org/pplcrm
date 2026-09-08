import { z } from 'zod';

import { idSchema, notesSchema } from './core.schema';

// Deliveries (spec §14). Enums mirror the binding spec (docs/spec/Deliveries Spec.dc.html §2) —
// the spec's strings win, including the American spelling "canceled" for route status.
export const DELIVERY_REQUEST_STATUSES = ['new', 'approved', 'declined', 'delivered'] as const;
export const DELIVERY_ROUTE_STATUSES = ['draft', 'assigned', 'in_progress', 'completed', 'canceled'] as const;
export const DELIVERY_STOP_STATUSES = ['pending', 'delivered', 'skipped'] as const;
// Keep in lockstep with the chk_delivery_requests_source CHECK (widened by the 2026-08-22
// donor-portal migration): 'canvass' = raised at the door, 'donor_portal' = the donor's own page.
export const DELIVERY_SOURCES = ['web_form', 'manual', 'canvass', 'donor_portal'] as const;

/**
 * What the household is owed — 'yard_sign' | 'flyer'. GOTV is deliberately NOT a purpose:
 * nobody "requests" a reminder to vote; GOTV is a turf mode (see canvassing.schema TURF_MODES).
 * The open-per-household unique index is scoped per purpose: one open task of each kind per
 * household, tenant-wide across campaigns.
 */
export const DELIVERY_PURPOSES = ['yard_sign', 'flyer'] as const;
export type DeliveryPurpose = (typeof DELIVERY_PURPOSES)[number];

export const DELIVERY_PURPOSE_LABELS: Record<DeliveryPurpose, string> = {
  yard_sign: 'Yard sign',
  flyer: 'Flyer drop',
};

/** The noun for conflict/explanation copy: "…already has an open yard-sign request". */
export const DELIVERY_PURPOSE_NOUNS: Record<DeliveryPurpose, string> = {
  yard_sign: 'yard-sign request',
  flyer: 'flyer-drop request',
};

/**
 * What a delivery outing (turf, mode 'delivery') carries — the cut wizard's choice and
 * the stored `turfs.delivery_purpose`. 'both' is a real option, not a wildcard default:
 * a volunteer carrying signs AND flyers serves either kind of open request at a door.
 */
export const TURF_DELIVERY_PURPOSES = ['yard_sign', 'flyer', 'both'] as const;
export type TurfDeliveryPurpose = (typeof TURF_DELIVERY_PURPOSES)[number];

export const TURF_DELIVERY_PURPOSE_LABELS: Record<TurfDeliveryPurpose, string> = {
  yard_sign: 'Yard signs',
  flyer: 'Flyers',
  both: 'Signs and flyers',
};

// The four failure reasons a volunteer can pick (spec §4.4). "Skip for now" (defer) is NOT a
// reason — it keeps the stop pending and moves it to the end of the route.
export const DELIVERY_SKIP_REASONS = ['No safe spot', 'Wrong address', 'Resident declined', 'Other'] as const;

export type DeliveryRequestStatus = (typeof DELIVERY_REQUEST_STATUSES)[number];

/** Display labels for a request's standing on person/household pages ('new' reads as "Requested"). */
export const DELIVERY_REQUEST_STATUS_LABELS: Record<DeliveryRequestStatus, string> = {
  new: 'Requested',
  approved: 'Approved',
  declined: 'Declined',
  delivered: 'Delivered',
};
export type DeliveryRouteStatus = (typeof DELIVERY_ROUTE_STATUSES)[number];
export type DeliveryStopStatus = (typeof DELIVERY_STOP_STATUSES)[number];
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];
export type DeliverySkipReason = (typeof DELIVERY_SKIP_REASONS)[number];

// ---- Requests --------------------------------------------------------------
export const AddDeliveryRequestObj = z.object({
  /** Campaigns §15 — the context this request belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  household_id: idSchema,
  person_id: idSchema.or(z.literal('')).nullable().optional(),
  /** What the household is owed; the backend defaults to 'yard_sign'. */
  purpose: z.enum(DELIVERY_PURPOSES).optional(),
  notes: notesSchema,
});

/**
 * Bulk targeting intake: one approved request per eligible household in a list. DNC
 * residents are never made requesters (a household whose every living resident is DNC is
 * skipped), households already holding an open request of this kind are skipped, and the
 * batch stops at the cap so a workspace-sized list cannot be turned into requests blind.
 */
export const AddDeliveryRequestsFromListObj = z.object({
  /** Campaigns §15 — the context these requests belong to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  list_id: idSchema,
  purpose: z.enum(DELIVERY_PURPOSES),
});

/** The most households one add-from-list call will create requests for. */
export const ADD_FROM_LIST_CAP = 5000;

export const UpdateDeliveryRequestObj = z.object({
  notes: notesSchema,
});

// Bulk approve/decline from the selection bar (spec §4.1), plus the manual standing flips from the
// household/person "Yard sign" control — 'delivered' covers signs installed without the app.
export const SetDeliveryRequestStatusObj = z.object({
  ids: z.array(idSchema).min(1, 'Select at least one request'),
  status: z.enum(DELIVERY_REQUEST_STATUSES),
});

// The yard-sign standing lookup for one household in one campaign context.
export const GetSignStatusObj = z.object({
  household_id: idSchema,
  campaign_id: idSchema,
});

// (The planning / routes / public-stop schemas retired with the driving-route system —
// turfs-absorb-deliveries Phase 4. Delivery work goes out as delivery-mode turfs.)

export type AddDeliveryRequestType = z.infer<typeof AddDeliveryRequestObj>;
export type AddDeliveryRequestsFromListType = z.infer<typeof AddDeliveryRequestsFromListObj>;
export type UpdateDeliveryRequestType = z.infer<typeof UpdateDeliveryRequestObj>;
export type SetDeliveryRequestStatusType = z.infer<typeof SetDeliveryRequestStatusObj>;
export type GetSignStatusType = z.infer<typeof GetSignStatusObj>;
