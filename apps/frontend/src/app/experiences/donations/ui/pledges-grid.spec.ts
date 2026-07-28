import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { PledgesGridComponent } from './pledges-grid';
import { DonationsService } from '../../../services/api/donations-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';

describe('PledgesGridComponent', () => {
  let component: PledgesGridComponent;
  let fixture: ComponentFixture<PledgesGridComponent>;
  let mockDonationsSvc: any;
  let mockAlertSvc: any;
  let mockDialogSvc: any;

  const pledges = [
    {
      id: '1',
      person_id: 'p1',
      person_first_name: 'Jane',
      person_last_name: 'Doe',
      person_email: 'jane@example.com',
      monthly_amount: 2000,
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
      next_billing_date: '2026-02-01T00:00:00Z',
      state: 'ON',
      country: 'CA',
    },
    {
      id: '2',
      person_id: 'p2',
      monthly_amount: 1000,
      status: 'cancelled',
      started_at: null,
      next_billing_date: null,
    },
  ];

  beforeEach(async () => {
    mockDonationsSvc = {
      listPledges: vi.fn().mockResolvedValue(pledges),
      cancelPledge: vi.fn().mockResolvedValue({ success: true }),
    };
    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };
    mockDialogSvc = {
      confirm: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [PledgesGridComponent],
      providers: [
        provideRouter([]),
        { provide: DonationsService, useValue: mockDonationsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PledgesGridComponent);
    component = fixture.componentInstance;
  });

  it('should load pledges on init and compute active pledge summary', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockDonationsSvc.listPledges).toHaveBeenCalled();
    expect(component['pledges']()).toEqual(pledges);
    expect(component['activePledgeCount']()).toBe(1);
    expect(component['totalMonthlyCommitted']()).toBe(20);
  });

  it('should show an error alert when loading pledges fails', async () => {
    mockDonationsSvc.listPledges.mockRejectedValue(new Error('boom'));

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Failed to load pledges. Please try again.');
  });

  it('should cancel a pledge after confirmation and reload the list', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    mockDonationsSvc.listPledges.mockResolvedValue([pledges[1]]);

    await component['cancelPledge'](pledges[0]);

    expect(mockDialogSvc.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Cancel pledge for Jane Doe?' }),
    );
    expect(mockDonationsSvc.cancelPledge).toHaveBeenCalledWith('1');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Pledge cancelled successfully.');
    expect(component['cancelling']()).toBeNull();
  });

  it('should not cancel a pledge when the confirmation dialog is dismissed', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    mockDialogSvc.confirm.mockResolvedValue(false);

    await component['cancelPledge'](pledges[0]);

    expect(mockDonationsSvc.cancelPledge).not.toHaveBeenCalled();
  });

  it('should show an error alert when cancelling a pledge fails', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    mockDonationsSvc.cancelPledge.mockRejectedValue(new Error('Payment provider error'));

    await component['cancelPledge'](pledges[0]);

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Payment provider error');
    expect(component['cancelling']()).toBeNull();
  });

  it('should map pledge status to the correct badge class', () => {
    expect(component['statusBadgeClass']('active')).toBe('badge-success');
    expect(component['statusBadgeClass']('past_due')).toBe('badge-warning');
    expect(component['statusBadgeClass']('cancelled')).toBe('badge-ghost');
    expect(component['statusBadgeClass']('unpaid')).toBe('badge-error');
    expect(component['statusBadgeClass']('unknown')).toBe('badge-neutral');
  });

  it('should format currency and dates defensively', () => {
    // Workspace currency (Workspace → Organization); CAD is the default.
    expect(component['formatCurrency'](2000)).toBe('CA$20.00');
    expect(component['formatCurrency'](null)).toBe('CA$0.00');
    expect(component['formatDate'](null)).toBe('—');
    expect(component['formatDate']('2026-02-01T00:00:00Z')).toContain('2026');
  });
});
