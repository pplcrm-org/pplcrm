import type { PromptOptions } from '@uxcommon/components/confirm-dialog.service';
import type { PcMapVariant } from '@uxcommon/components/map/map-types';
import type { PcStatusType } from '@uxcommon/components/status-badge/status-badge';

/**
 * The one vocabulary for turf status, shared by the turf list, the strip map and the
 * turf detail page so the same turf never reads two different ways.
 *
 * The labels say what is happening in the world ("Needs canvassers", "Knocking now")
 * rather than naming the stored lifecycle ("Draft", "Assigned"): a first-time organizer
 * should be able to read a row and know what to do next without a glossary (design §1).
 * The status is derived from knocks at read time, never stored (see `pplcrm-canvassing`).
 */
export type TurfStatus = 'draft' | 'assigned' | 'in_field' | 'complete' | 'retired';

export const TURF_STATUS_LABEL: Record<TurfStatus, string> = {
  draft: 'Needs canvassers',
  assigned: 'Links sent',
  in_field: 'Knocking now',
  complete: 'Every door knocked',
  retired: 'Retired',
};

/** The sentence behind each label, shown on hover and listed in the guide. */
export const TURF_STATUS_HINT: Record<TurfStatus, string> = {
  draft: 'Cut and ready to walk. Nobody is on it yet.',
  assigned: 'Its canvassers have their personal Companion links. No knocks logged yet.',
  in_field: 'A knock was logged here in the last few hours.',
  complete: 'Every door in this turf has been tried at least once.',
  retired: 'Closed to new knocks. Everything it collected stays in the field report.',
};

export const TURF_STATUS_TONE: Record<TurfStatus, PcStatusType> = {
  draft: 'ghost',
  assigned: 'info',
  in_field: 'success',
  complete: 'neutral',
  retired: 'ghost',
};

/** Pin tint on the turf strip map, matched to the badge tone. */
export const TURF_STATUS_MAP_VARIANT: Record<TurfStatus, PcMapVariant> = {
  draft: 'neutral',
  assigned: 'info',
  in_field: 'success',
  complete: 'primary',
  retired: 'muted',
};

/**
 * "Refresh from list" is the least self-evident action on the page: it silently
 * adds and removes doors. So it explains itself before it runs, in the user's terms,
 * naming the list it is about to re-read (§3 guide, don't error).
 */
export function refreshFromListExplainer(listName: string): string {
  return (
    `Doors that are still in "${listName}" stay exactly as they are. ` +
    "Any new address in the list that falls inside this turf's ward is added, and doors that have left the list are " +
    'taken off the turf. Knocks already logged are kept either way, so nothing is lost from the field report.'
  );
}

/** Mirrors `nameSchema('Name', 120)` on `UpdateTurfObj` — checked here so an over-long
 *  name is caught in the user's words instead of coming back as a validation error. */
export const TURF_NAME_MAX_LENGTH = 120;

/**
 * Rename a turf.
 *
 * The name is not decoration: it is what canvassers already walking the turf see in the
 * Companion and what the field report files it under, so the prompt says where the new
 * name will turn up rather than only asking for one (§3 guide, don't error). Turfs come
 * out of the cutter with generated names ("Ward 12 — 3"), and the first thing an organizer
 * wants is to call them what the neighbourhood calls them.
 */
export function renameTurfPrompt(currentName: string): PromptOptions {
  return {
    title: 'Rename turf',
    message:
      `Canvassers already walking this turf see its name in the Companion, and the field report files it ` +
      `under that name — both follow the new one straight away. Nothing else changes: its doors, the knocks ` +
      `already logged and every link that has been handed out all keep working.`,
    defaultValue: currentName,
    inputPlaceholder: 'e.g. Ward 12 — north of Elm',
    confirmText: 'Rename turf',
  };
}

/**
 * What the prompt's answer means. `none` covers cancelled, blank and unchanged — three
 * different ways of saying "leave it alone", none of which should fire a request.
 */
export type TurfRenameIntent =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'rename'; name: string };

export function turfRenameIntent(answer: string | null, currentName: string): TurfRenameIntent {
  const next = (answer ?? '').trim();
  if (next.length === 0 || next === currentName.trim()) return { kind: 'none' };
  if (next.length > TURF_NAME_MAX_LENGTH) {
    return {
      kind: 'invalid',
      reason: `A turf name can be at most ${TURF_NAME_MAX_LENGTH} characters. That one is ${next.length}.`,
    };
  }
  return { kind: 'rename', name: next };
}

export function renameResultMessage(from: string, to: string): string {
  return `Renamed "${from}" to "${to}". Canvassers see the new name the next time their Companion refreshes.`;
}

/** What actually changed, in doors rather than row counts. */
export function refreshResultMessage(listName: string, res: { added: number; removed: number }): string {
  if (res.added === 0 && res.removed === 0) return `This turf already matches "${listName}". Nothing changed.`;
  const parts: string[] = [];
  if (res.added > 0) parts.push(`${res.added} ${res.added === 1 ? 'door' : 'doors'} added`);
  if (res.removed > 0) parts.push(`${res.removed} ${res.removed === 1 ? 'door' : 'doors'} removed`);
  return `Refreshed from "${listName}": ${parts.join(', ')}. Knocks already logged were kept.`;
}
