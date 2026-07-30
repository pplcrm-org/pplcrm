import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovePage } from './approve-page';
import { CompanionSessionService } from './companion-api';

/**
 * The whole page hangs off one route param, and every failure to read it looks identical
 * to a dead link — so these tests assert the request actually goes out with the token.
 *
 * The order below (create, then setInput) is exactly what `withComponentInputBinding()`
 * does: the component is constructed first and the routed input arrives right after. A
 * page that reads `token()` from its constructor throws NG0950 into its own catch and
 * renders "This approval link isn't active" without ever calling the backend, which is
 * how the approve-by-text link shipped broken.
 */
describe('ApprovePage', () => {
  const getApproval = vi.fn();
  const actOnApproval = vi.fn();

  beforeEach(() => {
    getApproval.mockReset();
    actOnApproval.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: CompanionSessionService, useValue: { getApproval, actOnApproval } }],
    });
  });

  it('asks the backend about the token from the URL and shows who is waiting', async () => {
    getApproval.mockResolvedValue({
      state: 'pending',
      volunteerName: 'Zia',
      volunteerContact: 'z•••@example.com',
      organizationName: 'Riverside',
    });

    const fixture = TestBed.createComponent(ApprovePage);
    fixture.componentRef.setInput('token', 'tok-abc');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getApproval).toHaveBeenCalledWith('tok-abc');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Approve Zia?');
    expect(text).not.toContain("isn't active");
  });

  it('reports a genuinely dead link as dead', async () => {
    getApproval.mockResolvedValue({ state: 'dead' });

    const fixture = TestBed.createComponent(ApprovePage);
    fixture.componentRef.setInput('token', 'tok-dead');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("This approval link isn't active");
  });

  it('passes the same token to the decision', async () => {
    getApproval.mockResolvedValue({ state: 'pending', volunteerName: 'Zia' });
    actOnApproval.mockResolvedValue({ state: 'decided', decision: 'approved', volunteerName: 'Zia' });

    const fixture = TestBed.createComponent(ApprovePage);
    fixture.componentRef.setInput('token', 'tok-abc');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const approve: HTMLButtonElement | null = fixture.nativeElement.querySelector('button.btn-primary');
    approve?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actOnApproval).toHaveBeenCalledWith('tok-abc', 'approve');
  });
});
