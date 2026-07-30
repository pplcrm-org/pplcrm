import type { CompanionPersonResult, KnockResponse, SupportLevel } from '@common';
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
  return level == null ? null : SUPPORT_LEVEL_LABELS[level];
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

/** Chip label for a person's recorded result. */
export function personResultLabel(result: CompanionPersonResult, support: KnockResponse | null): string {
  switch (result) {
    case 'canvassed':
      return support != null ? KNOCK_RESPONSE_LABELS[support] : 'Surveyed';
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
