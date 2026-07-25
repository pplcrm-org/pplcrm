import { computed, inject } from '@angular/core';
import type { Signal } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import type { FieldTree } from '@angular/forms/signals';
import { ConfirmDialogService } from './shared-dialog.service';

/**
 * Writes the form's pending edits and resolves true only if the write landed. It must NOT navigate:
 * the router is already mid-navigation when the leave prompt runs (forms pass `stayPut`/no `done`).
 */
export type SaveOnLeave = () => Promise<boolean>;

export interface UnsavedChangesHandle {
  dirtyCount: Signal<number>;
  headerLine: Signal<string | null>;
  confirmDiscardIfDirty(recordName: string, save?: SaveOnLeave): Promise<boolean>;
}

/** The two ways out of the leave prompt; cancelling it (Keep editing) resolves to null instead. */
type LeaveChoice = 'save' | 'discard';

interface Deactivatable {
  canDeactivate?(): boolean | Promise<boolean>;
}

/** Route-level guard: lets any edit-page component veto navigation away while it has unsaved changes. */
export const unsavedChangesGuard: CanDeactivateFn<Deactivatable> = (component) =>
  component.canDeactivate ? component.canDeactivate() : true;

/**
 * Wires an Angular Signal Forms `form`/`payload` pair up to the "Unsaved changes · N fields" header
 * line and a leave-confirm dialog naming the changed fields. `dirty()` is per-field and already used
 * to gate the Save button (see pc-form-actions) - this just reads the same signals.
 */
export function injectUnsavedChanges<TModel extends Record<string, unknown>>(
  form: FieldTree<TModel>,
  payload: Signal<TModel>,
): UnsavedChangesHandle {
  const dialogs = inject(ConfirmDialogService);

  // Subfields<TModel> guarantees one FieldTree per data key, so indexing by the payload's
  // own keys is safe even though TypeScript can't express a dynamic per-key lookup here.
  const fields = form as unknown as Record<string, () => { dirty(): boolean }>;

  const dirtyKeys = computed(() => Object.keys(payload()).filter((key) => fields[key]?.().dirty()));
  const dirtyCount = computed(() => dirtyKeys().length);
  const headerLine = computed(() =>
    dirtyCount() > 0 ? `Unsaved changes · ${dirtyCount()} field${dirtyCount() === 1 ? '' : 's'}` : null,
  );

  return {
    dirtyCount,
    headerLine,
    async confirmDiscardIfDirty(recordName: string, save?: SaveOnLeave): Promise<boolean> {
      if (dirtyCount() === 0) return true;
      const fieldList = joinWithAnd(dirtyKeys().map(humanizeFieldKey));

      // Without a save handler the page can only offer the two lossy ways out.
      if (!save) {
        return dialogs.confirm({
          title: 'Leave without saving?',
          message: `Your changes to ${recordName} (${fieldList}) will be lost.`,
          variant: 'warning',
          confirmText: 'Discard changes',
          cancelText: 'Keep editing',
          emphasizeCancel: true,
        });
      }

      // Offer the way out of the trap, not just the two ways to lose it: saving is the
      // emphasized default, discarding is the de-emphasized escape.
      const choice = await dialogs.choose<LeaveChoice>({
        title: 'Leave without saving?',
        message: `Your changes to ${recordName} (${fieldList}) are not saved yet.`,
        variant: 'warning',
        choices: [
          { label: 'Save changes', value: 'save', variant: 'info' },
          { label: 'Discard changes', value: 'discard', variant: 'warning' },
        ],
        cancelText: 'Keep editing',
      });
      // A failed save keeps the user on the form with their edits intact (the toast says why).
      if (choice === 'save') return save();
      return choice === 'discard';
    },
  };
}

function humanizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
