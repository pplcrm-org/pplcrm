import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FieldTree } from '@angular/forms/signals';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmDialogService } from './shared-dialog.service';
import { injectUnsavedChanges, unsavedChangesGuard, type UnsavedChangesHandle } from './unsaved-changes-guard';

describe('unsavedChangesGuard', () => {
  const run = (component: unknown) => (unsavedChangesGuard as any)(component, {}, {}, {});

  it('allows navigation when the component has no canDeactivate hook', () => {
    expect(run({})).toBe(true);
  });

  it('forwards a synchronous canDeactivate verdict', () => {
    expect(run({ canDeactivate: () => false })).toBe(false);
    expect(run({ canDeactivate: () => true })).toBe(true);
  });

  it('forwards a Promise-based canDeactivate verdict untouched', async () => {
    await expect(run({ canDeactivate: () => Promise.resolve(false) })).resolves.toBe(false);
  });
});

describe('injectUnsavedChanges', () => {
  let chooseMock: ReturnType<typeof vi.fn>;
  let confirmMock: ReturnType<typeof vi.fn>;
  // Signal-backed like the real per-field dirty() — the guard's computed() only
  // recomputes when a tracked signal changes, so a plain Set would go stale.
  let dirtySig: ReturnType<typeof signal<ReadonlySet<string>>>;
  let handle: UnsavedChangesHandle;

  const markDirty = (...keys: string[]) => {
    dirtySig.set(new Set([...dirtySig(), ...keys]));
  };

  function buildHandle(payloadValue: Record<string, unknown>): UnsavedChangesHandle {
    const payload = signal(payloadValue);
    const fields: Record<string, () => { dirty(): boolean }> = {};
    for (const key of Object.keys(payloadValue)) {
      fields[key] = () => ({ dirty: () => dirtySig().has(key) });
    }
    return TestBed.runInInjectionContext(() =>
      injectUnsavedChanges(fields as unknown as FieldTree<Record<string, unknown>>, payload),
    );
  }

  beforeEach(() => {
    dirtySig = signal<ReadonlySet<string>>(new Set());
    confirmMock = vi.fn().mockResolvedValue(false);
    chooseMock = vi.fn().mockResolvedValue(null);
    TestBed.configureTestingModule({
      providers: [{ provide: ConfirmDialogService, useValue: { confirm: confirmMock, choose: chooseMock } }],
    });
    handle = buildHandle({ firstName: 'A', last_name: 'B', zipCode: '90210' });
  });

  describe('dirtyCount / headerLine', () => {
    it('reports a clean form with no header line', () => {
      expect(handle.dirtyCount()).toBe(0);
      expect(handle.headerLine()).toBeNull();
    });

    it('pluralizes the header line correctly', () => {
      markDirty('firstName');
      expect(handle.dirtyCount()).toBe(1);
      expect(handle.headerLine()).toBe('Unsaved changes · 1 field');

      markDirty('last_name');
      expect(handle.dirtyCount()).toBe(2);
      expect(handle.headerLine()).toBe('Unsaved changes · 2 fields');
    });

    it('tolerates a payload key with no matching form field', () => {
      const orphan = buildHandle({ known: 'x' });
      // remove the field lookup entirely by asking about a payload the form doesn't know
      const noFields = TestBed.runInInjectionContext(() =>
        injectUnsavedChanges({} as unknown as FieldTree<Record<string, unknown>>, signal({ mystery: 1 })),
      );

      expect(orphan.dirtyCount()).toBe(0);
      expect(noFields.dirtyCount()).toBe(0);
      expect(noFields.headerLine()).toBeNull();
    });
  });

  describe('confirmDiscardIfDirty', () => {
    it('resolves true without a dialog when the form is clean', async () => {
      await expect(handle.confirmDiscardIfDirty('this person')).resolves.toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it('asks with humanized, and-joined field names when dirty', async () => {
      markDirty('firstName', 'last_name', 'zipCode');

      await expect(handle.confirmDiscardIfDirty('this person')).resolves.toBe(false);

      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Leave without saving?',
          // camelCase and snake_case both humanize; 3+ items use the Oxford comma.
          message: 'Your changes to this person (first name, last name, and zip code) will be lost.',
          emphasizeCancel: true,
        }),
      );
    });

    it('joins exactly two dirty fields with a bare "and"', async () => {
      markDirty('firstName', 'zipCode');

      await handle.confirmDiscardIfDirty('this record');

      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Your changes to this record (first name and zip code) will be lost.' }),
      );
    });

    it('names a single dirty field without any joiner', async () => {
      markDirty('last_name');

      await handle.confirmDiscardIfDirty('this record');

      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Your changes to this record (last name) will be lost.' }),
      );
    });

    it('returns the dialog verdict when the user chooses to discard', async () => {
      markDirty('firstName');
      confirmMock.mockResolvedValue(true);

      await expect(handle.confirmDiscardIfDirty('this record')).resolves.toBe(true);
    });
  });

  describe('confirmDiscardIfDirty with a save handler', () => {
    it('saves nothing and asks nothing when the form is clean', async () => {
      const save = vi.fn().mockResolvedValue(true);

      await expect(handle.confirmDiscardIfDirty('this person', save)).resolves.toBe(true);

      expect(chooseMock).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('offers Save changes, Discard changes and Keep editing', async () => {
      markDirty('firstName', 'zipCode');

      // choose() resolving null is "Keep editing" (cancel or backdrop) — stay put.
      await expect(handle.confirmDiscardIfDirty('this person', vi.fn())).resolves.toBe(false);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(chooseMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Leave without saving?',
          message: 'Your changes to this person (first name and zip code) are not saved yet.',
          cancelText: 'Keep editing',
          choices: [
            { label: 'Save changes', value: 'save', variant: 'info' },
            { label: 'Discard changes', value: 'discard', variant: 'warning' },
          ],
        }),
      );
    });

    it('saves and then leaves when the user picks Save changes', async () => {
      markDirty('firstName');
      chooseMock.mockResolvedValue('save');
      const save = vi.fn().mockResolvedValue(true);

      await expect(handle.confirmDiscardIfDirty('this person', save)).resolves.toBe(true);

      expect(save).toHaveBeenCalledOnce();
    });

    it('keeps the user on the form when the save fails', async () => {
      markDirty('firstName');
      chooseMock.mockResolvedValue('save');
      const save = vi.fn().mockResolvedValue(false);

      await expect(handle.confirmDiscardIfDirty('this person', save)).resolves.toBe(false);
    });

    it('leaves without saving when the user picks Discard changes', async () => {
      markDirty('firstName');
      chooseMock.mockResolvedValue('discard');
      const save = vi.fn();

      await expect(handle.confirmDiscardIfDirty('this person', save)).resolves.toBe(true);

      expect(save).not.toHaveBeenCalled();
    });
  });
});
