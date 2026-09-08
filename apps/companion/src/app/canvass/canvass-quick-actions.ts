import type { CompanionHousehold, KnockResponse, TurfMode } from '@common';
import type { AlertService } from '@uxcommon/components/alerts/alert-service';

import { isAttempted, livingResidents } from './canvass-derive';
import type { CanvassStore } from './canvass-store';

/** The one-tap outcomes a list row offers; which set depends on the turf's mode. */
export type QuickActionId =
  | 'supporter'
  | 'undecided'
  | 'non_supporter'
  | 'reminded'
  | 'already_voted'
  | 'not_home'
  | 'delivered'
  | 'cant_deliver';

/**
 * The row-level one-tap outcomes, shared by the walk list and the drive list so the two
 * views never drift apart on what a row can record (operator rule 2026-09-05: the list row
 * is the primary recording surface; the door screen is for the uncommon work).
 *
 * A persuasion walk records a stance or a miss; a GOTV walk the reminder, the ballot
 * already cast, or the miss; a delivery outing the drop-off or its failure. The words are
 * the ask, not the storage: "Reminded" is stored as the ordinary supporter survey and
 * "Already voted" as the already_voted one — no new vocabulary anywhere downstream.
 * "Undecided" sits on the persuasion row because it is the commonest answer after a miss
 * (operator, 2026-09-07).
 */
export function quickActionsFor(mode: TurfMode): { id: QuickActionId; label: string }[] {
  if (mode === 'gotv') {
    return [
      { id: 'reminded', label: 'Reminded' },
      { id: 'already_voted', label: 'Already voted' },
      { id: 'not_home', label: 'Nobody home' },
    ];
  }
  if (mode === 'delivery') {
    // "Couldn't deliver" needs a reason, so it opens the door screen where one is
    // picked — a reasonless record would tell the office nothing about the retry.
    return [
      { id: 'delivered', label: 'Delivered' },
      { id: 'cant_deliver', label: "Couldn't deliver" },
    ];
  }
  return [
    { id: 'supporter', label: 'Supporter' },
    { id: 'undecided', label: 'Undecided' },
    { id: 'non_supporter', label: 'Non-supporter' },
    { id: 'not_home', label: 'Not home' },
  ];
}

/**
 * Quick actions live on doors still owed a visit; a DNC door records nothing at all.
 * A delivery row keys off its delivery state instead — DNC does not bar it, because
 * the household asked for what is being dropped off.
 */
export function showQuickActionsFor(mode: TurfMode, h: CompanionHousehold): boolean {
  if (mode === 'delivery') return h.delivery_status === 'pending';
  return !h.dnc && !isAttempted(h);
}

/**
 * Perform a row's one-tap outcome, with the confirmation toast. Actions that need more
 * from the volunteer (whose ballot, why undeliverable) open the door screen instead of
 * guessing — the store's view signal is the navigation.
 */
export function performQuickAction(
  store: CanvassStore,
  alerts: AlertService,
  h: CompanionHousehold,
  action: QuickActionId,
): void {
  switch (action) {
    case 'delivered':
      if (store.deliverDoor(h.id, true)) alerts.showSuccess('Marked delivered');
      return;
    case 'cant_deliver':
      // The door screen collects the reason.
      store.view.set({ kind: 'household', household_id: h.id });
      return;
    case 'not_home':
      store.doorOutcome(h.id, 'no_answer');
      alerts.showSuccess('Marked "Nobody home"');
      return;
    case 'supporter':
      quickStance(store, alerts, h, 'supporter', 'supporter');
      return;
    case 'undecided':
      quickStance(store, alerts, h, 'undecided', 'undecided');
      return;
    case 'non_supporter':
      quickStance(store, alerts, h, 'non_supporter', 'non-supporter');
      return;
    case 'reminded': {
      const target = quickTargetId(h);
      store.quickSurvey(h.id, target, 'supporter');
      alerts.showSuccess(target ? `Reminded ${targetName(h, target)} to vote` : 'Reminded the household to vote');
      return;
    }
    case 'already_voted': {
      // "Already voted" is a fact about one person's ballot. With several residents the
      // row cannot know whose, so the door opens for the volunteer to say who — an
      // anonymous version would record a conversation but lose the turnout fact.
      const target = quickTargetId(h);
      if (target == null && livingResidents(h).length > 0) {
        store.view.set({ kind: 'household', household_id: h.id });
        return;
      }
      store.quickSurvey(h.id, target, 'already_voted');
      alerts.showSuccess('Marked "Already voted"');
      return;
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
    }
  }
}

/**
 * A row-level stance tap, with a confirmation that says WHO it was recorded for
 * (operator, 2026-09-07): with one resident it names them; with several it is a
 * household-level answer, and the toast says so and points at the door screen for
 * per-person recording — otherwise a volunteer reasonably believes they just marked
 * every listed person a supporter.
 */
function quickStance(
  store: CanvassStore,
  alerts: AlertService,
  h: CompanionHousehold,
  support: KnockResponse,
  word: string,
): void {
  const target = quickTargetId(h);
  store.quickSurvey(h.id, target, support);
  alerts.showSuccess(
    target
      ? `Marked ${targetName(h, target)} ${word}`
      : `Marked the household ${word} — open the door to record each person`,
  );
}

/** The tapped person's name for the confirmation; falls back to the generic word. */
function targetName(h: CompanionHousehold, personId: string): string {
  return h.people.find((p) => p.id === personId)?.name ?? 'this resident';
}

/** The one living, contactable resident this row speaks for — or null (record door-level). */
function quickTargetId(h: CompanionHousehold): string | null {
  const candidates = livingResidents(h).filter((p) => !p.dnc);
  const only = candidates.length === 1 ? candidates[0] : undefined;
  return only?.id ?? null;
}
