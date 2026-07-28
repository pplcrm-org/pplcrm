import { z } from 'zod';

import { idSchema, notesSchema } from './core.schema';

// Deliveries (spec §14). Enums mirror the binding spec (docs/spec/Deliveries Spec.dc.html §2) —
// the spec's strings win, including the American spelling "canceled" for route status.
export const DELIVERY_REQUEST_STATUSES = ['new', 'approved', 'declined', 'delivered'] as const;
export const DELIVERY_ROUTE_STATUSES = ['draft', 'assigned', 'in_progress', 'completed', 'canceled'] as const;
export const DELIVERY_STOP_STATUSES = ['pending', 'delivered', 'skipped'] as const;
export const DELIVERY_SOURCES = ['web_form', 'manual'] as const;

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
  /** Campaigns §15 — the context this yard-sign request belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  household_id: idSchema,
  person_id: idSchema.or(z.literal('')).nullable().optional(),
  notes: notesSchema,
});

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

// ---- Planning --------------------------------------------------------------
// Advanced params default to the spec's inline summary (60 min/driver · 5 min/stop · 30 km/h · no
// return trip). Preview is pure — it writes nothing.
export const PlanDeliveriesObj = z.object({
  start_address: z.string().trim().min(1, 'Start address is required').max(500, 'Address is too long'),
  drivers: z.number().int().min(1).max(50).nullable().optional(),
  service_minutes: z.number().min(0).max(60).nullable().optional(),
  avg_speed_kmh: z.number().min(1).max(120).nullable().optional(),
  include_return_leg: z.boolean().nullable().optional(),
});

/**
 * Workspace → Deliveries planning defaults (`deliveries.route_defaults`). Same bounds as the
 * per-plan overrides above, since these seed exactly those fields. `drivers: null` means
 * "as many as needed", matching the Plan routes placeholder.
 */
export const SetRouteDefaultsObj = z.object({
  serviceMinutes: z.number().min(0).max(60),
  avgSpeedKmh: z.number().min(1).max(120),
  includeReturnLeg: z.boolean(),
  drivers: z.number().int().min(1).max(50).nullable(),
});

export const CommitDeliveriesObj = PlanDeliveriesObj.extend({
  routes: z
    .array(
      z.object({
        request_ids: z.array(idSchema).min(1, 'A route needs at least one stop'),
      }),
    )
    .min(1, 'Nothing to commit'),
});

// ---- Routes ----------------------------------------------------------------
export const UpdateDeliveryRouteObj = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150, 'Name is too long').optional(),
  scheduled_for: z.string().datetime().nullable().optional(),
});

export const AssignVolunteerObj = z.object({
  route_id: idSchema,
  person_id: idSchema.nullable(),
});

export const SetDeliveryRouteStatusObj = z.object({
  route_id: idSchema,
  status: z.enum(['in_progress', 'completed', 'canceled']),
});

export const ReorderStopObj = z.object({
  route_id: idSchema,
  stop_id: idSchema,
  direction: z.enum(['up', 'down']),
});

// Drag-to-reorder: the full new order of a route's PENDING stops. Delivered/skipped stops are not
// movable and keep their seq; the backend reassigns only the pending slots to this order.
export const ReorderStopsObj = z.object({
  route_id: idSchema,
  ordered_stop_ids: z.array(idSchema).min(1, 'Provide the new stop order'),
});

// Staff act on a stop from the route detail page. Same transitions as the public path.
export const StopActionObj = z.object({
  route_id: idSchema,
  stop_id: idSchema,
  action: z.enum(['deliver', 'skip', 'remove']),
  reason: z.enum(DELIVERY_SKIP_REASONS).nullable().optional(),
});

export const RouteIdObj = z.object({ route_id: idSchema });

export const MintShareLinkObj = z.object({
  route_id: idSchema,
  regenerate: z.boolean().optional(),
});

// ---- Public volunteer path (token is the only credential) ------------------
// defer = "Skip for now": moves the stop to the end and renumbers (stays pending, not a failure).
export const PublicStopActionObj = z.object({
  action: z.enum(['deliver', 'skip', 'defer', 'undo']),
  reason: z.enum(DELIVERY_SKIP_REASONS).nullable().optional(),
});

export type AddDeliveryRequestType = z.infer<typeof AddDeliveryRequestObj>;
export type UpdateDeliveryRequestType = z.infer<typeof UpdateDeliveryRequestObj>;
export type SetDeliveryRequestStatusType = z.infer<typeof SetDeliveryRequestStatusObj>;
export type GetSignStatusType = z.infer<typeof GetSignStatusObj>;
export type PlanDeliveriesType = z.infer<typeof PlanDeliveriesObj>;
export type SetRouteDefaultsType = z.infer<typeof SetRouteDefaultsObj>;
export type CommitDeliveriesType = z.infer<typeof CommitDeliveriesObj>;
export type UpdateDeliveryRouteType = z.infer<typeof UpdateDeliveryRouteObj>;
export type AssignVolunteerType = z.infer<typeof AssignVolunteerObj>;
export type SetDeliveryRouteStatusType = z.infer<typeof SetDeliveryRouteStatusObj>;
export type ReorderStopType = z.infer<typeof ReorderStopObj>;
export type ReorderStopsType = z.infer<typeof ReorderStopsObj>;
export type StopActionType = z.infer<typeof StopActionObj>;
export type MintShareLinkType = z.infer<typeof MintShareLinkObj>;
export type PublicStopActionType = z.infer<typeof PublicStopActionObj>;
