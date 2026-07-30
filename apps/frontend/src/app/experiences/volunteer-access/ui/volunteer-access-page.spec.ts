import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';

import type { CompanionVolunteerRow } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';

import { JoinCodesService } from '../services/join-codes-service';
import { VolunteerAccessService } from '../services/volunteer-access-service';
import { VolunteerAccessPage } from './volunteer-access-page';

function approvedRow(canRoam: boolean | null): CompanionVolunteerRow {
  return {
    id: 'v1',
    person_id: 'p1',
    first_name: 'Ada',
    last_name: 'Byron',
    email: 'ada@example.com',
    mobile: null,
    status: 'approved',
    verify_channel: 'email',
    verified_at: new Date('2026-07-29T12:00:00Z').toISOString(),
    approved_at: new Date('2026-07-29T12:05:00Z').toISOString(),
    can_roam: canRoam,
    approved_by_name: 'Sam Organizer',
    created_at: new Date('2026-07-29T11:00:00Z').toISOString(),
  };
}

describe('VolunteerAccessPage — turf access select', () => {
  let fixture: ComponentFixture<VolunteerAccessPage>;
  const setRoam = vi.fn().mockResolvedValue(undefined);

  async function render(canRoam: boolean | null): Promise<HTMLSelectElement> {
    await TestBed.configureTestingModule({
      imports: [VolunteerAccessPage],
      providers: [
        {
          provide: VolunteerAccessService,
          useValue: {
            getAll: vi.fn().mockResolvedValue([approvedRow(canRoam)]),
            setRoam,
            approve: vi.fn(),
            revoke: vi.fn(),
          },
        },
        { provide: JoinCodesService, useValue: { getForCampaign: vi.fn().mockResolvedValue([]) } },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VolunteerAccessPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select: HTMLSelectElement | null = fixture.nativeElement.querySelector('select');
    if (!select) throw new Error('expected the turf access select to render');
    return select;
  }

  beforeEach(() => {
    setRoam.mockClear();
    TestBed.resetTestingModule();
  });

  /**
   * The regression this file exists for: the stored override has to be the option the
   * organizer actually sees on a fresh load. A `[value]` binding on the <select> looks
   * right and silently isn't — it runs before @for has created any option, so the
   * browser falls back to the first one and every volunteer reads as "Workspace default".
   */
  it('shows the stored override on first render, not the first option', async () => {
    expect((await render(true)).value).toBe('roam');
    TestBed.resetTestingModule();
    expect((await render(false)).value).toBe('assigned');
    TestBed.resetTestingModule();
    expect((await render(null)).value).toBe('default');
  });

  it('sends null for the workspace default and a boolean for an explicit choice', async () => {
    const select = await render(null);
    select.value = 'assigned';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(setRoam).toHaveBeenCalledWith('v1', false);
  });
});
