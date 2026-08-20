import { Component } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanionGate } from './companion-gate';
import { CompanionApiError, CompanionSessionService } from './companion-api';

/**
 * The verify + approve gate both companions sit behind (/t/:token canvassing and
 * /r/:token deliveries). The server's GET /access answer is the whole state machine —
 * the gate renders whatever state comes back and only projects the app on 'ready' —
 * so these tests pin each state as the volunteer experiences it: which screen shows,
 * which API call each tap makes, and that a failure never advances or wedges the gate.
 */
@Component({
  imports: [CompanionGate],
  template: `
    <pc-companion-gate kind="turf" [token]="'tok-1'" (ready)="onReady()">
      <p>THE COMPANION APP CONTENT</p>
    </pc-companion-gate>
  `,
})
class HostCmp {
  public readyCount = 0;

  public onReady(): void {
    this.readyCount++;
  }
}

describe('CompanionGate', () => {
  const getAccess = vi.fn();
  const verifyStart = vi.fn();
  const verifyConfirm = vi.fn();
  const joinStart = vi.fn();

  const fixtures: ComponentFixture<unknown>[] = [];

  beforeEach(() => {
    getAccess.mockReset();
    verifyStart.mockReset();
    verifyConfirm.mockReset();
    joinStart.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: CompanionSessionService, useValue: { getAccess, verifyStart, verifyConfirm, joinStart } }],
    });
  });

  afterEach(() => {
    // Destroy runs the DestroyRef cleanup that clears the approval poll and the
    // resend-cooldown intervals — otherwise a timer leaks into the next test.
    while (fixtures.length) fixtures.pop()?.destroy();
  });

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function createGate(kind: string, token: string | null): Promise<ComponentFixture<CompanionGate>> {
    const fixture = TestBed.createComponent(CompanionGate);
    fixtures.push(fixture);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('token', token);
    await settle(fixture);
    return fixture;
  }

  function buttonByText(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    const match = buttons.find((b) => (b.textContent ?? '').includes(text));
    if (!match) throw new Error(`No button containing "${text}"`);
    return match;
  }

  it('asks the server about the link and shows the verify-code step for an unverified device', async () => {
    getAccess.mockResolvedValue({
      state: 'need_verification',
      volunteerName: 'Jordan',
      organizationName: 'Riverside',
      contacts: [
        { channel: 'email', masked: 'j•••@example.com' },
        { channel: 'sms', masked: '•••••1234' },
      ],
    });

    const fixture = await createGate('turf', 'tok-1');

    expect(getAccess).toHaveBeenCalledWith('turf', 'tok-1');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain("Hi Jordan. Let's confirm it's you");
    expect(text).toContain('Email a code to j•••@example.com');
    expect(text).toContain('Text a code to •••••1234');
  });

  it('sends the code over the tapped channel and swaps to the code-entry form', async () => {
    getAccess.mockResolvedValue({
      state: 'need_verification',
      contacts: [{ channel: 'email', masked: 'j•••@example.com' }],
    });
    verifyStart.mockResolvedValue({ masked: 'j•••@example.com' });

    const fixture = await createGate('turf', 'tok-1');
    buttonByText(fixture, 'Email a code').click();
    await settle(fixture);

    expect(verifyStart).toHaveBeenCalledWith('turf', 'tok-1', 'email');
    expect(fixture.nativeElement.textContent).toContain('Enter the 6-digit code sent to j•••@example.com');
  });

  it('confirming a code on an approved volunteer opens the gate and emits ready', async () => {
    getAccess.mockResolvedValue({
      state: 'need_verification',
      contacts: [{ channel: 'email', masked: 'j•••@example.com' }],
    });
    verifyStart.mockResolvedValue({ masked: 'j•••@example.com' });
    verifyConfirm.mockResolvedValue({ status: 'ready', sessionToken: 'sess-1', expiresAt: '2099-01-01T00:00:00Z' });

    const fixture = await createGate('turf', 'tok-1');
    const component = fixture.componentInstance;
    const readySpy = vi.fn();
    component.ready.subscribe(readySpy);

    buttonByText(fixture, 'Email a code').click();
    await settle(fixture);
    component['codeValue'] = '123456';
    await component['confirm'](new Event('submit'));
    await settle(fixture);

    expect(verifyConfirm).toHaveBeenCalledWith('turf', 'tok-1', '123456');
    expect(readySpy).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).not.toContain("confirm it's you");
  });

  it('confirming a code on a not-yet-approved volunteer parks on the waiting-for-approval screen', async () => {
    getAccess.mockResolvedValue({
      state: 'need_verification',
      organizerName: 'Sam Chen',
      contacts: [{ channel: 'email', masked: 'j•••@example.com' }],
    });
    verifyStart.mockResolvedValue({ masked: 'j•••@example.com' });
    verifyConfirm.mockResolvedValue({
      status: 'pending_approval',
      sessionToken: 'sess-1',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const fixture = await createGate('turf', 'tok-1');
    const component = fixture.componentInstance;
    const readySpy = vi.fn();
    component.ready.subscribe(readySpy);

    buttonByText(fixture, 'Email a code').click();
    await settle(fixture);
    component['codeValue'] = '123456';
    await component['confirm'](new Event('submit'));
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain("You're verified, waiting for approval");
    expect(readySpy).not.toHaveBeenCalled();
  });

  it('an invalid or expired code shows the error and stays on code entry', async () => {
    getAccess.mockResolvedValue({
      state: 'need_verification',
      contacts: [{ channel: 'email', masked: 'j•••@example.com' }],
    });
    verifyStart.mockResolvedValue({ masked: 'j•••@example.com' });
    verifyConfirm.mockRejectedValue(new CompanionApiError('That code is not right. Try again.', 400));

    const fixture = await createGate('turf', 'tok-1');
    const component = fixture.componentInstance;
    const readySpy = vi.fn();
    component.ready.subscribe(readySpy);

    buttonByText(fixture, 'Email a code').click();
    await settle(fixture);
    component['codeValue'] = '123456';
    await component['confirm'](new Event('submit'));
    await settle(fixture);

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('That code is not right. Try again.');
    expect(text).toContain('Enter the 6-digit code sent to j•••@example.com');
    expect(readySpy).not.toHaveBeenCalled();
  });

  it('a device that already holds a valid approved session skips the gate entirely', async () => {
    getAccess.mockResolvedValue({ state: 'ready' });

    const fixture = TestBed.createComponent(HostCmp);
    fixtures.push(fixture);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('THE COMPANION APP CONTENT');
    expect(fixture.componentInstance.readyCount).toBe(1);
    expect(verifyStart).not.toHaveBeenCalled();
    expect(verifyConfirm).not.toHaveBeenCalled();
  });

  it('a rejected or expired session falls back to the verify step instead of wedging', async () => {
    // The server is the authority: a device whose session was revoked simply gets
    // need_verification back, and the gate must re-run the code flow, not show the app.
    getAccess.mockResolvedValue({
      state: 'need_verification',
      contacts: [{ channel: 'email', masked: 'j•••@example.com' }],
    });

    const fixture = TestBed.createComponent(HostCmp);
    fixtures.push(fixture);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).not.toContain('THE COMPANION APP CONTENT');
    expect(fixture.nativeElement.textContent).toContain("Let's confirm it's you");
    expect(fixture.componentInstance.readyCount).toBe(0);
  });

  it('a dead link names the organizer to contact', async () => {
    getAccess.mockResolvedValue({ state: 'dead', organizerName: 'Sam Chen' });

    const fixture = await createGate('turf', 'tok-dead');

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain("This link isn't active");
    expect(text).toContain('Contact Sam Chen to get a new link');
  });

  it('an unassigned link asks the organizer to re-send it', async () => {
    getAccess.mockResolvedValue({ state: 'unassigned' });

    const fixture = await createGate('turf', 'tok-1');

    expect(fixture.nativeElement.textContent).toContain("This link isn't ready yet");
  });

  it('an unreachable server shows the retry screen, never the dead-link screen', async () => {
    getAccess.mockResolvedValue({ state: 'unreachable' });

    const fixture = await createGate('turf', 'tok-1');

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain("Can't reach the server");
    expect(text).not.toContain("This link isn't active");
  });

  it('an offline poll tick never demotes the waiting-for-approval screen', async () => {
    getAccess.mockResolvedValue({ state: 'pending_approval', organizerName: 'Sam Chen' });

    const fixture = await createGate('turf', 'tok-1');
    expect(fixture.nativeElement.textContent).toContain("You're verified, waiting for approval");

    getAccess.mockResolvedValue({ state: 'unreachable' });
    await fixture.componentInstance['checkNow']();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain("You're verified, waiting for approval");
    expect(fixture.nativeElement.textContent).not.toContain("Can't reach the server");
  });

  it('the QR-join identity step hands back a claim that the code entry then verifies with', async () => {
    getAccess.mockResolvedValue({
      state: 'need_identity',
      organizationName: 'Riverside',
      joiningLabel: 'Maple Ward — turf 3',
    });
    joinStart.mockResolvedValue({ claim: 'claim-1', channel: 'email', masked: 'd•••@example.com' });
    verifyConfirm.mockResolvedValue({ status: 'pending_approval', sessionToken: 's', expiresAt: '2099-01-01' });

    const fixture = await createGate('join', 'JOINCODE1');
    const component = fixture.componentInstance;

    expect(fixture.nativeElement.textContent).toContain("You'll be helping with Maple Ward — turf 3");

    component['joinName'] = 'Dana Whitfield';
    component['joinContact'] = 'dana@example.com';
    await component['submitIdentity'](new Event('submit'));
    await settle(fixture);

    expect(joinStart).toHaveBeenCalledWith({
      code: 'JOINCODE1',
      first_name: 'Dana',
      last_name: 'Whitfield',
      email: 'dana@example.com',
    });
    expect(fixture.nativeElement.textContent).toContain('Enter the 6-digit code sent to d•••@example.com');

    component['codeValue'] = '654321';
    await component['confirm'](new Event('submit'));

    // The claim, not the join code, is the credential from here on.
    expect(verifyConfirm).toHaveBeenCalledWith('join', 'claim-1', '654321');
  });
});
