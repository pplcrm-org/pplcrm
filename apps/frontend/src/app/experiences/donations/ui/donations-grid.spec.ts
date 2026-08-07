import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { provideDataGridConfig } from '@frontend/shared/components/datagrid/datagrid.tokens';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { DonationsChangedService } from '../../../services/api/donations-changed.service';
import { DonationsGridComponent } from './donations-grid';
import { DonationsService } from '../../../services/api/donations-service';

import type { CellParams, ColumnDef } from '@frontend/shared/components/datagrid/grid-defaults';

/** The grid's ngOnInit kicks off fire-and-forget async work that whenStable() doesn't track. */
async function flushGrid(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('DonationsGridComponent', () => {
  let fixture: ComponentFixture<DonationsGridComponent>;
  let component: DonationsGridComponent;
  let mockDonationsSvc: any;
  let mockAlertSvc: any;

  const rows = [
    {
      id: '1',
      pledge_id: null,
      person_id: 'p1',
      donor_name: 'Jane Doe',
      person_first_name: 'Jane',
      person_last_name: 'Doe',
      person_email: 'jane@example.com',
      amount: 5000,
      status: 'succeeded',
      method: 'card',
      receipt_status: 'receipted',
      receipt_id: 'r1',
      receipt_number: 'R-2026-00001',
      country: 'CA',
      state: 'ON',
      created_at: new Date(),
    },
  ];

  const summary = {
    totalCents: 15000,
    totalCount: 2,
    thisMonthCents: 5000,
    thisMonthCount: 1,
    lastMonthCents: 10000,
    acknowledgedThisMonth: 1,
    activePledgeCount: 2,
  };

  function findCol(field: string): ColumnDef {
    const col = (component as any).col.find((c: ColumnDef) => c.field === field);
    expect(col).toBeDefined();
    return col;
  }

  beforeEach(async () => {
    const refreshCount = signal(0);
    mockDonationsSvc = {
      listScope: 'all',
      refreshCount,
      // The real one bumps the signal the child grid watches — keep that, so these tests prove the
      // grid actually re-fetches rather than that a spy was called.
      triggerRefresh: vi.fn(() => refreshCount.update((n) => n + 1)),
      abort: vi.fn(),
      getAll: vi.fn().mockResolvedValue({ rows, count: rows.length }),
      getAllArchived: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
      getLedgerSummary: vi.fn().mockResolvedValue(summary),
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
        // The grid's Tags/Issues filter pills load tag names on init — keep that off the network.
        { provide: TagOptionsService, useValue: { getTagNames: vi.fn().mockResolvedValue([]) } },
      ],
    }).compileComponents();

    // The component declares its own providers (a component-scoped DonationsService and the
    // AbstractAPIService alias the child grid injects) — swap the whole set for the mock,
    // or the grid quietly fetches through a real service (test trap #1 in pplcrm-datagrid).
    TestBed.overrideComponent(DonationsGridComponent, {
      set: {
        providers: [
          { provide: DonationsService, useValue: mockDonationsSvc },
          { provide: AbstractAPIService, useValue: mockDonationsSvc },
          provideDataGridConfig({ messages: { entityNoun: 'gift', entityNounPlural: 'gifts' } }),
        ],
      },
    });

    fixture = TestBed.createComponent(DonationsGridComponent);
    component = fixture.componentInstance;
  });

  it('loads the server-side summary and computes the header tiles from it', async () => {
    await flushGrid(fixture);

    expect(mockDonationsSvc.getLedgerSummary).toHaveBeenCalledWith('all');
    expect(component['totalRaised']()).toBe(150);
    expect(component['totalGiftCount']()).toBe(2);
    expect(component['thisMonthTotal']()).toBe(50);
    expect(component['averageGift']()).toBe(50);
    expect(component['monthlyDonorCount']()).toBe(2);
    expect(component['acknowledgedThisMonth']()).toBe(1);
    // 50 this month vs 100 last month.
    expect(component['monthOverMonthDelta']()).toBe(-50);
    expect(component['headerSentence']()).toContain('raised in total across 2 gifts');
  });

  it('lets the grid fetch its page through the service (AbstractAPIService contract)', async () => {
    await flushGrid(fixture);

    expect(mockDonationsSvc.getAll).toHaveBeenCalled();
    const [options] = mockDonationsSvc.getAll.mock.calls[0];
    expect(options.startRow).toBe(0);
  });

  it('fixes the service scope from its route before the grid first fetches', async () => {
    Object.assign(TestBed.inject(ActivatedRoute).snapshot.data, { scope: 'one-time' });

    fixture = TestBed.createComponent(DonationsGridComponent);
    component = fixture.componentInstance;
    await flushGrid(fixture);

    expect(mockDonationsSvc.listScope).toBe('one-time');
    expect(mockDonationsSvc.getLedgerSummary).toHaveBeenCalledWith('one-time');
    expect(component['headerSentence']()).toContain('raised this month');

    Object.assign(TestBed.inject(ActivatedRoute).snapshot.data, { scope: undefined });
  });

  it('reloads the summary and refreshes the grid when a gift is written anywhere', async () => {
    await flushGrid(fixture);
    mockDonationsSvc.getLedgerSummary.mockClear();

    // What DonationsService raises after any successful donation write — from this page's own
    // dialog, the sibling tab, or a person's page. Without it a tab held in the route-reuse cache
    // showed its old rows until the browser reloaded.
    TestBed.inject(DonationsChangedService).notify();
    await flushGrid(fixture);

    expect(mockDonationsSvc.getLedgerSummary).toHaveBeenCalledTimes(1);
    expect(mockDonationsSvc.triggerRefresh).toHaveBeenCalled();
  });

  it('fetches a fresh page of rows after that tick, not just the totals', async () => {
    await flushGrid(fixture);
    const before = mockDonationsSvc.getAll.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    const withNewGift = [...rows, { ...rows[0], id: '2', donor_name: 'New Donor' }];
    mockDonationsSvc.getAll.mockResolvedValue({ rows: withNewGift, count: withNewGift.length });
    TestBed.inject(DonationsChangedService).notify();
    await flushGrid(fixture);

    expect(mockDonationsSvc.getAll.mock.calls.length).toBeGreaterThan(before);
  });

  it('shows an error toast when the summary fails to load', async () => {
    mockDonationsSvc.getLedgerSummary.mockRejectedValue(new Error('boom'));

    await flushGrid(fixture);

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Failed to load donation totals. Please try again.');
    expect(component['summary']()).toBeNull();
  });

  it('renders the donor cell from the joined name with the email as subtitle', () => {
    const col = findCol('donor_name');
    const params: CellParams = { data: rows[0], value: null, colDef: col };
    expect(col.valueGetter?.(params)).toBe('Jane Doe');
    expect(col.doorSubtitle?.(params)).toBe('jane@example.com');
  });

  it('renders receipt badges by status, never marking an acknowledgement green', () => {
    const col = findCol('receipt_status');
    const receipted = col.cellRenderer?.({ data: rows[0], value: 'receipted', colDef: col });
    expect(String(receipted)).toContain('badge-success');
    expect(String(receipted)).toContain('R-2026-00001');

    const acknowledged = col.cellRenderer?.({ data: { receipt_number: null }, value: 'acknowledged', colDef: col });
    expect(String(acknowledged)).toContain('Acknowledged');
    expect(String(acknowledged)).not.toContain('badge-success');

    const none = col.cellRenderer?.({ data: {}, value: 'none', colDef: col });
    expect(String(none)).toContain('Not sent');
  });

  it('marks pledge installments with a Monthly badge in the method cell', () => {
    const col = findCol('method');
    const installment = col.cellRenderer?.({ data: { pledge_id: 'pl1' }, value: 'card', colDef: col });
    expect(String(installment)).toContain('Monthly');

    const oneTime = col.cellRenderer?.({ data: { pledge_id: null }, value: 'card', colDef: col });
    expect(String(oneTime)).not.toContain('Monthly');
  });
});
