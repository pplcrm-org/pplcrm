import type { CompanionLastKnock, CompanionPersonResult, KnockResponse, SupportLevel } from '@common';
import { KNOCK_RESPONSE_LABELS, SUPPORT_LEVEL_LABELS } from '@common';
import type { PcIconNameType } from '@icons/icons.index';

import type { DoorStance, DoorStatus } from './canvass-derive';

/** Small presentational helpers shared by the canvass views. No state. */

/** DaisyUI badge classes for a derived door status — color only where it means something (§5). */
export function statusBadgeClass(status: DoorStatus): string {
  switch (status) {
    case 'canvassed':
      return 'badge badge-success';
    case 'dnc':
    case 'outcome:refused':
      return 'badge badge-error';
    case 'outcome:no_answer':
      // Blue, matching the walk map: knocked, nobody home — worth another try.
      return 'badge badge-info';
    case 'outcome:inaccessible':
    case 'outcome:moved':
      return 'badge badge-warning';
    case 'in_progress':
      return 'badge badge-info badge-outline';
    case 'not_visited':
      return 'badge badge-ghost';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * How a door's stance is drawn: a thumb, a colour, a word.
 *
 * One idiom, three places (walk list, unit list, household card), so a green thumbs-up
 * always means the same thing. `null` returns null rather than a "no data" glyph — an
 * un-ID'd door is the normal case, and an icon on every row would say nothing while
 * competing with the ones that do.
 */
export interface StanceStyle {
  icon: PcIconNameType;
  label: string;
  /** Text/icon colour class. */
  tone: string;
  /** Left accent used on list rows. */
  accent: string;
}

export function stanceStyle(stance: DoorStance): StanceStyle | null {
  switch (stance) {
    case 'supporter':
      return { icon: 'hand-thumb-up', label: 'Supporter', tone: 'text-success', accent: 'border-l-success' };
    case 'non_supporter':
      return { icon: 'hand-thumb-down', label: 'Not supporting', tone: 'text-error', accent: 'border-l-error' };
    case 'undecided':
      return { icon: 'question-mark-circle', label: 'Undecided', tone: 'text-warning', accent: 'border-l-warning' };
    case 'mixed':
      return { icon: 'user-group', label: 'Mixed', tone: 'text-warning', accent: 'border-l-warning' };
    case null:
      return null;
    default: {
      const _exhaustive: never = stance;
      return _exhaustive;
    }
  }
}

/** How the CRM's prior read reads on a person card — "Strong", "Leaning against", … */
export function supportLevelLabel(level: SupportLevel | null): string | null {
  return level == null ? null : (SUPPORT_LEVEL_LABELS[level] ?? null);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago, in the coarsest unit that is still true.
 *
 * Deliberately never says "yesterday": 26 hours ago can be today, and a calendar word
 * would be a claim the elapsed time does not support. Anything in the future (a phone
 * whose clock is behind the server's) reads as "just now" rather than as a negative.
 */
export function timeAgoLabel(elapsedMs: number): string {
  if (elapsedMs < MINUTE_MS) return 'just now';
  if (elapsedMs < HOUR_MS) {
    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(elapsedMs / DAY_MS);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * "Julie L. spoke to someone here 1 day ago" — the line at the top of a door.
 *
 * The point of the sentence is the decision it supports: knock anyway, or move on. So it
 * names who came and how long ago, and it distinguishes a conversation from a door that
 * was merely tried — "canvassed" over a no-answer would overstate what happened. A knock
 * this volunteer logged themselves says "You", because being told your own work back in
 * the third person reads as somebody else having been here.
 *
 * Returns null when there is no recent visit; the server only sends one inside
 * `RECENT_KNOCK_WINDOW_DAYS`, so this never has to police the window itself.
 */
export function lastVisitLabel(
  last: CompanionLastKnock | null,
  options: { myName: string | null; now: number },
): string | null {
  if (last == null) return null;
  const at = Date.parse(last.at);
  if (Number.isNaN(at)) return null;

  const mine = isSameCanvasser(last.canvasser_name, options.myName);
  const who = mine ? 'You' : last.canvasser_name?.trim() || 'Someone';
  const verb = last.conversation ? 'spoke to someone here' : 'tried this door';
  return `${who} ${verb} ${timeAgoLabel(Math.max(0, options.now - at))}`;
}

/** Knocks carry a display name, not a volunteer id, so this is the only match available. */
function isSameCanvasser(knockName: string | null, myName: string | null): boolean {
  const a = knockName?.trim().toLowerCase();
  const b = myName?.trim().toLowerCase();
  return !!a && !!b && a === b;
}

export { firstNameOf } from './canvass-derive';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
}

/** Label for a door's surveyed stance, including the disagreement case. */
export function consensusLabel(consensus: KnockResponse | 'mixed' | null): string | null {
  if (consensus == null) return null;
  return consensus === 'mixed' ? 'Mixed support' : KNOCK_RESPONSE_LABELS[consensus];
}

/**
 * Chip label for a person's recorded result.
 *
 * A stance the label table does not name falls back to "Surveyed" rather than to nothing:
 * an empty chip is a block of colour, and colour alone does not say "supporter" to anyone
 * standing on a porch.
 */
export function personResultLabel(result: CompanionPersonResult, support: KnockResponse | null): string {
  switch (result) {
    case 'canvassed':
      return support != null ? (KNOCK_RESPONSE_LABELS[support] ?? 'Surveyed') : 'Surveyed';
    case 'not_home':
      return 'Not home';
    case 'moved':
      return 'Moved';
    case 'refused':
      return 'Refused';
    case 'deceased':
      return 'Deceased';
    case 'data_error':
      return 'Flagged for review';
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
