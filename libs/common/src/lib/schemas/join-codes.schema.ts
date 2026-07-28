import { z } from 'zod';

import { idSchema } from './core.schema';

/**
 * Campaign join codes — the QR (and typeable) front door for volunteers who are not in
 * the database yet. See `companion-access.schema.ts` for the gate states a scan lands in.
 *
 * No `JoinCodeObj` read-shape: nothing validates a join code coming back off the wire,
 * so the read type is a hand-assembled row (below) rather than a third Zod object. See
 * the note in `pplcrm-schemas-validation` about incomplete triads.
 */

export const JOIN_CODE_STATUSES = ['active', 'revoked'] as const;
export type JoinCodeStatus = (typeof JOIN_CODE_STATUSES)[number];

/** Codes are 8 chars of a Crockford-style alphabet — no 0/O/1/I, because people type these. */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const JOIN_CODE_LENGTH = 8;

export const AddJoinCodeObj = z.object({
  /** Null = the office context rather than a specific campaign (Campaigns §15). */
  campaign_id: idSchema.or(z.literal('')).nullable().optional(),
  /** Set = everyone who scans lands on this turf together; null = they pick their own. */
  turf_id: idSchema.or(z.literal('')).nullable().optional(),
  /** What the poster says ("Saturday launch — Maple"), for the admin's own list. */
  label: z.string().trim().max(120).nullable().optional(),
  expires_at: z.string().trim().max(40).nullable().optional(),
  max_uses: z.number().int().positive().max(10_000).nullable().optional(),
});

export const UpdateJoinCodeObj = z.object({
  label: z.string().trim().max(120).nullable().optional(),
  status: z.enum(JOIN_CODE_STATUSES).optional(),
  expires_at: z.string().trim().max(40).nullable().optional(),
  max_uses: z.number().int().positive().max(10_000).nullable().optional(),
});

export type AddJoinCodeType = z.infer<typeof AddJoinCodeObj>;
export type UpdateJoinCodeType = z.infer<typeof UpdateJoinCodeObj>;

/** One row of the admin's join-code list, with the counts that make it worth reading. */
export interface JoinCodeRow {
  id: string;
  code: string;
  label: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  turf_id: string | null;
  turf_name: string | null;
  status: JoinCodeStatus;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  /** Scans that became approved volunteers, and scans still waiting on an admin. */
  joined_count: number;
  pending_count: number;
  created_at: string;
  /** The URL the QR encodes — built server-side so the companion origin is never guessed. */
  url: string;
}

/** A join code plus the QR bitmap for it. `matrix[row][col]` — true = dark module. */
export interface JoinCodeQr {
  code: string;
  url: string;
  matrix: boolean[][];
}
