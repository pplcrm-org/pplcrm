import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { RecordDonationDialog } from './record-donation-dialog';
import { DonationsService } from '../../../services/api/donations-service';
import { PersonsService } from '../../persons/services/persons-service';

describe('RecordDonationDialog', () => {
  let component: RecordDonationDialog;
  let fixture: ComponentFixture<RecordDonationDialog>;
  let mockDonationsSvc: any;
  let mockPersonsSvc: any;
  let mockAlertSvc: any;

  const donor = { id: 'p1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' };

  /**
   * The gift date the dialog defaults to: today in the viewer's own timezone as YYYY-MM-DD.
   * Built from the local calendar parts, matching the component — `toISOString()` would give the
   * UTC day and disagree with the component after 7pm in Toronto.
   */
  const todayIso = (): string => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  beforeEach(async () => {
    mockDonationsSvc = {
      recordDonation: vi.fn().mockResolvedValue({ id: 'd1' }),
    };
    mockPersonsSvc = {
      getAllWithAddress: vi.fn().mockResolvedValue({ rows: [donor] }),
    };
    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [RecordDonationDialog],
      providers: [
        { provide: DonationsService, useValue: mockDonationsSvc },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecordDonationDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // jsdom doesn't implement <dialog>.showModal/close — stub them so open()/close() don't throw.
    const dlgEl = fixture.nativeElement.querySelector('dialog');
    dlgEl.showModal = vi.fn();
    dlgEl.close = vi.fn();
  });

  it('should not submit without a selected donor or a positive amount', async () => {
    await component['submit']();
    expect(mockDonationsSvc.recordDonation).not.toHaveBeenCalled();
    expect(component['donorInvalid']()).toBe(true);
  });

  /** Fill the required mailing-address block — no gift is recorded without one (receipts print it). */
  const fillAddress = () => {
    component['street'].set('12 Maple Ave');
    component['city'].set('Ottawa');
    component['province'].set('ON');
    component['postal'].set('K1A 0A1');
    component['country'].set('CA');
  };

  it('should not submit without the donor mailing address', async () => {
    component['selectDonor'](donor);
    component['amount'].set(50);
    component['street'].set('');
    component['city'].set('');

    await component['submit']();

    expect(mockDonationsSvc.recordDonation).not.toHaveBeenCalled();
    expect(component['addressInvalid']()).toBe(true);
  });

  it('should record the donation with the donor, amount in cents, method, gift date, and mailing address', async () => {
    component['selectDonor'](donor);
    component['amount'].set(50);
    component['method'].set('cash');
    fillAddress();

    await component['submit']();

    // No `campaign_id`: no campaign context has loaded here, so the gift is left for the backend
    // to file under the office fund rather than sent with an empty campaign.
    expect(mockDonationsSvc.recordDonation).toHaveBeenCalledWith({
      personId: 'p1',
      amountCents: 5000,
      method: 'cash',
      gift_date: todayIso(),
      // The country goes out as the ISO code, which is the spelling the server's residency rules
      // compare against — a gift submitted as "Canada" was refused by a workspace allowing "CA".
      address: { street: '12 Maple Ave', apt: null, city: 'Ottawa', state: 'ON', zip: 'K1A 0A1', country: 'CA' },
    });
    // No receipt claim in the toast: whether a receipt is issued depends on workspace settings.
    // The amount is formatted in the workspace currency — here the CAD default, so "CA$".
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Saved. CA$50.00 from Jane Doe recorded');
  });

  it('turns a household country name into its ISO code when prefilling from the donor', () => {
    component['selectDonor']({ ...donor, country: 'Canada' });
    expect(component['country']()).toBe('CA');
  });

  it('submits a country the app does not list exactly as it was recorded', async () => {
    component['selectDonor']({ ...donor, country: 'Kenya' });
    component['amount'].set(50);
    component['street'].set('12 Maple Ave');
    component['city'].set('Nairobi');
    component['province'].set('Nairobi');
    component['postal'].set('00100');

    await component['submit']();

    expect(mockDonationsSvc.recordDonation).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ country: 'Kenya' }) }),
    );
    // …and the picker keeps offering it, so opening the dialog does not blank the field.
    expect(component['countryOptions']()[0]).toEqual({ code: 'Kenya', name: 'Kenya' });
  });

  it('should show an error alert when the save fails', async () => {
    mockDonationsSvc.recordDonation.mockRejectedValue(new Error('Choose who gave this gift. Receipts need a name.'));
    component['selectDonor'](donor);
    component['amount'].set(50);
    fillAddress();

    await component['submit']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Choose who gave this gift. Receipts need a name.');
  });

  it('should search for donors and populate results', async () => {
    vi.useFakeTimers();
    component['onDonorSearchChange']('jane');
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await fixture.whenStable();

    expect(mockPersonsSvc.getAllWithAddress).toHaveBeenCalledWith({ searchStr: 'jane', startRow: 0, endRow: 10 });
    expect(component['donorResults']()).toEqual([donor]);
  });
});
