import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { AuthService } from '../../../auth/auth-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../../settings/services/settings-service';
import { NewslettersService } from '../services/newsletters-service';
import { NewslettersPage } from './newsletters-page';

const sentRow = (overrides: Record<string, unknown> = {}) => ({
  id: '1',
  name: 'Spring gala follow-up',
  status: 'sent',
  total_recipients: 2000,
  delivered_count: 1842,
  bounce_count: 12,
  open_rate: 44.1,
  click_rate: 9.2,
  unique_opens: 800,
  unique_clicks: 170,
  send_date: new Date('2026-05-12T09:00:00'),
  ...overrides,
});

class MockNewslettersService {
  getAll = vi.fn().mockResolvedValue({ rows: [], count: 0 });
  send = vi.fn().mockResolvedValue({});
  refreshCount = signal(0);
}

class MockCampaignContextService {
  activeCampaignId = signal<string | null>(null);
  ensureLoaded = vi.fn().mockResolvedValue(undefined);
}

class MockConfirmDialogService {
  confirm = vi.fn().mockResolvedValue(true);
}

class MockAlertService {
  showError = vi.fn();
  showSuccess = vi.fn();
}

class MockSettingsService {
  load = vi.fn().mockResolvedValue(undefined);
  getValue = vi.fn().mockReturnValue(['team@example.org']);
  snapshotSignal = signal<Record<string, unknown>>({ 'organization.address': '1 Main St, Springfield' });
}

class MockAuthService {
  user = signal<{ tenant_demo_mode_at: Date | null } | null>({ tenant_demo_mode_at: null });
  getUserSignal = () => this.user;
}

describe('NewslettersPage', () => {
  let fixture: ComponentFixture<NewslettersPage>;
  let component: NewslettersPage;
  let svc: MockNewslettersService;
  let dialogs: MockConfirmDialogService;
  let alerts: MockAlertService;
  let context: MockCampaignContextService;
  let settings: MockSettingsService;
  let auth: MockAuthService;

  beforeEach(async () => {
    svc = new MockNewslettersService();
    dialogs = new MockConfirmDialogService();
    alerts = new MockAlertService();
    context = new MockCampaignContextService();
    settings = new MockSettingsService();
    auth = new MockAuthService();

    await TestBed.configureTestingModule({
      imports: [NewslettersPage],
      providers: [
        provideRouter([]),
        { provide: NewslettersService, useValue: svc },
        { provide: CampaignContextService, useValue: context },
        { provide: ConfirmDialogService, useValue: dialogs },
        { provide: AlertService, useValue: alerts },
        { provide: SettingsService, useValue: settings },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
  });

  /** Create the component AFTER the test has configured its mocks, then let the initial load settle. */
  async function create(): Promise<void> {
    fixture = TestBed.createComponent(NewslettersPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await vi.waitFor(() => expect(component['loaded']()).toBe(true));
    fixture.detectChanges();
  }

  it('loads rows on first render', async () => {
    svc.getAll.mockResolvedValue({ rows: [sentRow()], count: 1 });
    await create();
    expect(svc.getAll).toHaveBeenCalledTimes(1);
    expect(component['rows']().length).toBe(1);
    expect(component['loaded']()).toBe(true);
  });

  it('reloads when the campaign context switches', async () => {
    await create();
    expect(svc.getAll).toHaveBeenCalledTimes(1);
    context.activeCampaignId.set('7');
    fixture.detectChanges();
    await vi.waitFor(() => expect(svc.getAll).toHaveBeenCalledTimes(2));
  });

  it('computes all-time stats from sent rows only', async () => {
    svc.getAll.mockResolvedValue({
      rows: [
        sentRow({ id: '1', delivered_count: 1000, unique_opens: 400, unique_clicks: 100, bounce_count: 10 }),
        sentRow({ id: '2', delivered_count: 1000, unique_opens: 200, unique_clicks: 60, bounce_count: 5 }),
        sentRow({ id: '3', status: 'draft', delivered_count: 999, unique_opens: 999, bounce_count: 999 }),
      ],
      count: 3,
    });
    await create();
    const stats = component['stats']();
    expect(stats.sentCount).toBe(2);
    expect(stats.delivered).toBe(2000);
    expect(stats.avgOpenRate).toBe(30);
    expect(stats.avgClickRate).toBe(8);
    expect(stats.bounces).toBe(15);
  });

  it('narrates sent and in-progress counts in the header sentence', async () => {
    svc.getAll.mockResolvedValue({
      rows: [sentRow({ id: '1' }), sentRow({ id: '2', status: 'scheduled' }), sentRow({ id: '3', status: 'sending' })],
      count: 3,
    });
    await create();
    expect(component['headerSentence']()).toBe('1 campaign sent · 2 in progress');
  });

  it('maps statuses to the shared badge tones and labels', async () => {
    await create();
    expect(component['statusTone']('sent')).toBe('success');
    expect(component['statusTone']('scheduled')).toBe('info');
    expect(component['statusTone']('draft')).toBe('ghost');
    expect(component['statusTone']('unknown')).toBe('ghost');
    expect(component['statusLabel']('queuing')).toBe('Sending');
    expect(component['statusLabel']('draft')).toBe('Draft');
  });

  const draftRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: '9',
    name: 'May canvass kickoff',
    status: 'draft',
    total_recipients: 0,
    delivered_count: 0,
    bounce_count: 0,
    open_rate: 0,
    click_rate: 0,
    unique_opens: 0,
    unique_clicks: 0,
    send_date: null,
    has_audience: true,
    has_content: true,
    ...overrides,
  });

  it('sends a draft only after the confirm dialog is accepted', async () => {
    await create();

    dialogs.confirm.mockResolvedValue(false);
    await component['sendDraft'](draftRow());
    expect(svc.send).not.toHaveBeenCalled();

    dialogs.confirm.mockResolvedValue(true);
    await component['sendDraft'](draftRow());
    expect(svc.send).toHaveBeenCalledWith('9');
    expect(alerts.showSuccess).toHaveBeenCalled();
  });

  it('surfaces a send failure as an error toast', async () => {
    await create();

    svc.send.mockRejectedValue(new Error('boom'));
    await component['sendDraft'](draftRow());
    expect(alerts.showError).toHaveBeenCalled();
  });

  it('names the unmet send condition, in priority order', async () => {
    await create();

    expect(component['sendBlocker'](draftRow())).toBeNull();
    expect(component['sendBlocker'](draftRow({ has_audience: false }))).toContain('no audience');
    expect(component['sendBlocker'](draftRow({ has_content: false }))).toContain('no subject or content');

    settings.snapshotSignal.set({});
    expect(component['sendBlocker'](draftRow())).toContain('mailing address');
    settings.snapshotSignal.set({ 'organization.address': '1 Main St, Springfield' });

    component['verifiedSenders'].set([]);
    expect(component['sendBlocker'](draftRow())).toContain('Verify a sender address');

    // Demo mode outranks every other blocker — sending is locked server-side too.
    auth.user.set({ tenant_demo_mode_at: new Date() });
    expect(component['sendBlocker'](draftRow())).toContain('locked during the demo');
  });

  it('refuses to send a blocked draft even if invoked directly', async () => {
    await create();
    component['verifiedSenders'].set([]);

    await component['sendDraft'](draftRow());
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(svc.send).not.toHaveBeenCalled();
  });

  it('derives audience and content readiness from the raw record', async () => {
    svc.getAll.mockResolvedValue({
      rows: [
        // The wizard stores targeting as a JSON include/exclude document. A draft only has an
        // audience when `include` actually names something.
        sentRow({
          id: '1',
          status: 'draft',
          target_lists: JSON.stringify({ include: ['list-supporters'], exclude: [] }),
          subject: 'Hi',
          html_content: '<p>x</p>',
        }),
        sentRow({ id: '2', status: 'draft' }),
      ],
      count: 2,
    });
    await create();
    const [ready, empty] = component['rows']();
    expect(ready?.has_audience).toBe(true);
    expect(ready?.has_content).toBe(true);
    expect(empty?.has_audience).toBe(false);
    expect(empty?.has_content).toBe(false);
  });
});
