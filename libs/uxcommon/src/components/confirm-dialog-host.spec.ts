import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfirmDialogHost } from './confirm-dialog-host';
import { ConfirmDialogService } from './confirm-dialog.service';

/** Sentinel used to assert that a dialog promise has NOT settled yet. */
const PENDING = Symbol('pending');

function stillPending(p: Promise<unknown>): Promise<unknown> {
  return Promise.race([p, Promise.resolve(PENDING)]);
}

describe('ConfirmDialogHost — every close path settles the promise', () => {
  let fixture: ComponentFixture<ConfirmDialogHost>;
  let svc: ConfirmDialogService;
  let dlg: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ConfirmDialogHost] }).compileComponents();
    fixture = TestBed.createComponent(ConfirmDialogHost);
    svc = TestBed.inject(ConfirmDialogService);
    fixture.detectChanges();
    dlg = fixture.debugElement.query(By.css('dialog')).nativeElement;
  });

  // jsdom has no showModal()/close(), so the browser's own Escape handling cannot
  // run here. These tests dispatch the events the browser would dispatch —
  // 'cancel' (Escape, preventable) then 'close' — and assert what the host does
  // with them.

  it('resolves with the cancel value when a dismissible dialog is closed by Escape', async () => {
    const answer = svc.confirm({ title: 'Discard changes?' });
    fixture.detectChanges();

    const escape = new Event('cancel', { cancelable: true });
    dlg.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    dlg.dispatchEvent(new Event('close'));

    await expect(answer).resolves.toBe(false);
    expect(svc.isOpenSignal()).toBe(false);
  });

  it('resolves a prompt with null when closed by Escape', async () => {
    const answer = svc.prompt({ title: 'Name this list' });
    fixture.detectChanges();

    dlg.dispatchEvent(new Event('cancel', { cancelable: true }));
    dlg.dispatchEvent(new Event('close'));

    await expect(answer).resolves.toBeNull();
  });

  it('refuses Escape on a dialog with allowBackdropClose: false and keeps it open', async () => {
    const answer = svc.confirm({ title: 'Sign-out failed', allowBackdropClose: false });
    fixture.detectChanges();

    const escape = new Event('cancel', { cancelable: true });
    dlg.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(svc.isOpenSignal()).toBe(true);
    await expect(stillPending(answer)).resolves.toBe(PENDING);
  });

  it('does not render the backdrop close form on a dialog with allowBackdropClose: false', () => {
    void svc.confirm({ title: 'Sign-out failed', allowBackdropClose: false });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('form.modal-backdrop'))).toBeNull();
  });

  it('renders the backdrop close form on a dismissible dialog', () => {
    void svc.confirm({ title: 'Discard changes?' });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('form.modal-backdrop'))).not.toBeNull();
  });

  it('settles a confirmed dialog once — the close event that follows changes nothing', async () => {
    const answer = svc.confirm({ title: 'Delete this record?', variant: 'danger' });
    fixture.detectChanges();

    fixture.componentInstance.onConfirm();
    await expect(answer).resolves.toBe(true);

    // The effect closes the native element after the state clears; the browser
    // then fires 'close'. Nothing is pending, so it must do nothing.
    dlg.dispatchEvent(new Event('close'));

    const next = svc.confirm({ title: 'A later dialog' });
    fixture.detectChanges();
    await expect(stillPending(next)).resolves.toBe(PENDING);
  });
});

describe('ConfirmDialogService — a second dialog cannot orphan the first', () => {
  let svc: ConfirmDialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ConfirmDialogService);
  });

  it('settles a still-pending dialog with its cancel value when another dialog opens', async () => {
    const first = svc.confirm({ title: 'First' });
    const second = svc.prompt({ title: 'Second' });

    await expect(first).resolves.toBe(false);

    svc.ok('typed value');
    await expect(second).resolves.toBe('typed value');
  });
});
