import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DonorLinkRequestPage } from './donor-link-request-page';
import { DonorPortalApiError, DonorPortalApiService } from './donor-portal-api';

/**
 * The /g request page must never reveal whether an email matched anyone: every 200 renders one
 * identical confirmation. The only honest divergence is the 429 rate-limit message.
 */

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DonorLinkRequestPage', () => {
  let fixture: ComponentFixture<DonorLinkRequestPage>;
  let apiMock: { requestLink: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    apiMock = { requestLink: vi.fn().mockResolvedValue({ ok: true }) };

    await TestBed.configureTestingModule({
      imports: [DonorLinkRequestPage],
      providers: [{ provide: DonorPortalApiService, useValue: apiMock }],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function submitWith(email: string): Promise<string> {
    fixture = TestBed.createComponent(DonorLinkRequestPage);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('input');
    expect(input).toBeTruthy();
    // Drive the component the way the template does.
    fixture.componentInstance['onInput'](email);
    await fixture.componentInstance['submit']();
    await flushMicrotasks();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('renders the identical confirmation for every 200, match or miss', async () => {
    const first = await submitWith('a-donor@example.com');
    const second = await submitWith('nobody-we-know@example.com');

    expect(apiMock.requestLink).toHaveBeenCalledWith('a-donor@example.com');
    expect(apiMock.requestLink).toHaveBeenCalledWith('nobody-we-know@example.com');
    expect(first).toContain('Check your email');
    expect(first).toContain('If that address matches our records');
    // Byte-identical rendered copy — the page cannot leak who is in the records.
    expect(second).toBe(first);
  });

  it('shows the honest rate-limit message on a 429 and stays on the form', async () => {
    apiMock.requestLink.mockRejectedValue(new DonorPortalApiError('slow down', 429));

    const text = await submitWith('a-donor@example.com');

    expect(text).toContain('Too many link requests right now. Wait a few minutes and try again.');
    expect(text).not.toContain('Check your email');
  });

  it('coaches instead of submitting when the email is missing', async () => {
    const text = await submitWith('   ');

    expect(apiMock.requestLink).not.toHaveBeenCalled();
    expect(text).toContain('Enter the email address you used to donate.');
  });
});
