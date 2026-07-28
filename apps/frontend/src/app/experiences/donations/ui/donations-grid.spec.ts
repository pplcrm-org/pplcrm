import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { DonationsGridComponent } from './donations-grid';
import { DonationsService } from '../../../services/api/donations-service';

describe('DonationsGridComponent', () => {
  let component: DonationsGridComponent;
  let fixture: ComponentFixture<DonationsGridComponent>;
  let mockDonationsSvc: any;
  let mockAlertSvc: any;

  const now = new Date();
  const thisMonthIso = new Date(now.getFullYear(), now.getMonth(), 15, 10, 0, 0).toISOString();
  const lastMonthIso = new Date(now.getFullYear(), now.getMonth() - 1, 10, 10, 0, 0).toISOString();

  const rows = [
    {
      id: '1',
      pledge_id: null,
      person_id: 'p1',
      person_first_name: 'Jane',
      person_last_name: 'Doe',
      person_email: 'jane@example.com',
      amount: 5000,
      status: 'succeeded',
      method: 'card',
      receipt_sent: true,
      country: 'CA',
      state: 'ON',
      created_at: thisMonthIso,
    },
    {
      id: '2',
      pledge_id: null,
      person_id: 'p2',
      person_first_name: 'John',
      person_last_name: 'Smith',
      person_email: null,
      amount: 2500,
      status: 'failed',
      method: 'cash',
      receipt_sent: false,
      country: 'US',
      state: null,
      created_at: thisMonthIso,
    },
    {
      // An installment of a monthly pledge — counted by the All tab, excluded by One-time.
      id: '3',
      pledge_id: 'pl1',
      person_id: 'p3',
      person_first_name: 'Alex',
      person_last_name: 'Lee',
      person_email: 'alex@example.com',
      amount: 10000,
      status: 'succeeded',
      method: 'check',
      receipt_sent: true,
      country: 'CA',
      state: 'ON',
      created_at: lastMonthIso,
    },
  ];

  const pledges = [{ status: 'active' }, { status: 'active' }, { status: 'cancelled' }];

  beforeEach(async () => {
    mockDonationsSvc = {
      listDonations: vi.fn().mockResolvedValue(rows),
      listPledges: vi.fn().mockResolvedValue(pledges),
    };
    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DonationsGridComponent],
      providers: [
        provideRouter([]),
        { provide: DonationsService, useValue: mockDonationsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DonationsGridComponent);
    component = fixture.componentInstance;
  });

  it('should load donations and pledges on init and compute this-month summary statistics', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockDonationsSvc.listDonations).toHaveBeenCalled();
    expect(mockDonationsSvc.listPledges).toHaveBeenCalled();
    // Only the succeeded, this-month row (id 1, $50) counts toward this month's total.
    expect(component['thisMonthTotal']()).toBe(50);
    expect(component['thisMonthCount']()).toBe(1);
    expect(component['averageGift']()).toBe(50);
    expect(component['monthlyDonorCount']()).toBe(2);
    expect(component['receiptsSentThisMonth']()).toBe(1);
  });

  it('should total every gift ever received on the All tab', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    // $50 this month + the $100 pledge installment from last month; the failed row never counts.
    expect(component['totalRaised']()).toBe(150);
    expect(component['totalGiftCount']()).toBe(2);
    expect(component['headerSentence']()).toContain('$150.00 raised in total across 2 gifts');
  });

  it('should show an error alert when loading donations fails', async () => {
    mockDonationsSvc.listDonations.mockRejectedValue(new Error('boom'));

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Failed to load donations. Please try again.');
    expect(component['donations']()).toEqual([]);
  });

  it('should reload donations when refresh is invoked', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    mockDonationsSvc.listDonations.mockClear();

    mockDonationsSvc.listDonations.mockResolvedValue([rows[0]]);
    component['refresh']();
    await fixture.whenStable();

    expect(mockDonationsSvc.listDonations).toHaveBeenCalledTimes(1);
    expect(component['donations']()).toEqual([rows[0]]);
  });

  it('should format currency amounts from cents', () => {
    // Amounts render in the workspace currency (Workspace → Organization), which defaults to
    // CAD. They used to be hardcoded to USD while Stripe was charged in CAD.
    expect(component['formatCurrency'](150000)).toBe('CA$1,500.00');
    expect(component['formatCurrency'](null)).toBe('CA$0.00');
    expect(component['formatCurrency'](undefined)).toBe('CA$0.00');
  });

  it('should format valid dates', () => {
    expect(component['formatDate']('2026-01-15T10:00:00Z')).toContain('2026');
  });

  it('should only show succeeded gifts in the recent-gifts table', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const recent = component['recentGifts']();
    expect(recent.map((d: any) => d.id)).toEqual(['1', '3']);
    expect(component['totalGiftCount']()).toBe(2);
  });

  describe('the One-time tab', () => {
    beforeEach(async () => {
      // The tab a page renders as comes from its route data; mutate the real snapshot rather
      // than stubbing ActivatedRoute, so the template's routerLinks still resolve.
      Object.assign(TestBed.inject(ActivatedRoute).snapshot.data, { scope: 'one-time' });

      fixture = TestBed.createComponent(DonationsGridComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should exclude monthly-pledge installments from its gifts and totals', () => {
      expect(component['recentGifts']().map((d: any) => d.id)).toEqual(['1']);
      expect(component['totalRaised']()).toBe(50);
      expect(component['totalGiftCount']()).toBe(1);
      expect(component['headerSentence']()).toContain('$50.00 raised this month across 1 gift');
    });
  });
});
