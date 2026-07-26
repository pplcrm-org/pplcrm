import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../auth/auth-service';
import { PersonsService } from '../persons/services/persons-service';
import { SettingsService } from '../settings/services/settings-service';
import { GoLiveService } from './go-live.service';

/**
 * The wizard derives completion from real account state rather than trusting a stored "done"
 * flag. That is the property worth pinning: a flag drifts the moment someone changes something in
 * Settings, and a wizard that claims sending is configured when it isn't sends the user away
 * believing they can email their supporters.
 */
describe('GoLiveService', () => {
  let snapshot: ReturnType<typeof signal<Record<string, unknown>>>;
  let user: ReturnType<typeof signal<Record<string, unknown> | null>>;
  let service: GoLiveService;

  beforeEach(() => {
    snapshot = signal<Record<string, unknown>>({});
    user = signal<Record<string, unknown> | null>({ tenant_demo_mode_at: null });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SettingsService,
          useValue: {
            snapshotSignal: snapshot,
            load: vi.fn().mockResolvedValue({}),
            upsert: vi.fn().mockResolvedValue({}),
            getValue: <T>(key: string, fallback: T) => (snapshot()[key] as T) ?? fallback,
          },
        },
        { provide: AuthService, useValue: { getUserSignal: () => user } },
        { provide: PersonsService, useValue: { count: vi.fn().mockResolvedValue(0) } },
      ],
    });
    service = TestBed.inject(GoLiveService);
  });

  describe('organization', () => {
    it('is done only once both a name and a postal address exist', () => {
      expect(service.organizationDone()).toBe(false);

      snapshot.set({ 'organization.name': 'Riverside Ward Office' });
      expect(service.organizationDone()).toBe(false);

      // The address is the load-bearing one: the send guard blocks every newsletter without it.
      snapshot.set({ 'organization.name': 'Riverside Ward Office', 'organization.address': '1 Main St' });
      expect(service.organizationDone()).toBe(true);
    });

    it('does not count whitespace as an address', () => {
      snapshot.set({ 'organization.name': 'Riverside', 'organization.address': '   ' });
      expect(service.organizationDone()).toBe(false);
    });
  });

  describe('sending', () => {
    it('is not done with no from address', () => {
      expect(service.sendingDone()).toBe(false);
    });

    it('is done with a from address on the tenant’s own domain', () => {
      snapshot.set({ 'communications.default_from_email': 'news@vote-jane.org' });
      expect(service.sendingDone()).toBe(true);
    });

    /**
     * On the shared domain the From address is ours, so without a reply-to a reply reaches us
     * rather than them — and the send guard refuses outright. The step must not read as done
     * while sending would actually fail.
     */
    it('requires a reply-to when using the platform address', () => {
      snapshot.set({
        'communications.platform_from_email': 'riverside@send.pplcrm.com',
        'communications.default_from_email': 'riverside@send.pplcrm.com',
      });
      expect(service.usingPlatformAddress()).toBe(true);
      expect(service.sendingDone()).toBe(false);

      snapshot.set({
        'communications.platform_from_email': 'riverside@send.pplcrm.com',
        'communications.default_from_email': 'riverside@send.pplcrm.com',
        'communications.reply_to': 'office@riverside.example',
      });
      expect(service.sendingDone()).toBe(true);
    });

    it('counts as settled when the user said "not yet" out loud', async () => {
      await service.setSendsEmail(false);
      expect(service.sendingDone()).toBe(true);
    });
  });

  describe('demo', () => {
    it('tracks the tenant flag rather than a stored step', () => {
      user.set({ tenant_demo_mode_at: new Date() });
      expect(service.demoDone()).toBe(false);

      user.set({ tenant_demo_mode_at: null });
      expect(service.demoDone()).toBe(true);
    });
  });

  /** demo.exit refuses without a settled plan, so offering it early is offering a button that throws. */
  it('locks the demo step until a plan is chosen, and says why', () => {
    expect(service.lockedReason()['demo']).toBe('Choose a plan first');
  });

  describe('deferrals', () => {
    it('records a deferral once, idempotently', async () => {
      await service.defer('sending');
      await service.defer('sending');
      expect(service.state().deferred).toEqual(['sending']);

      await service.undefer('sending');
      expect(service.state().deferred).toEqual([]);
    });

    it('persists progress under the setup.wizard key', async () => {
      const settings = TestBed.inject(SettingsService);
      await service.goTo('organization');

      expect(settings.upsert).toHaveBeenCalledWith([
        expect.objectContaining({ key: 'setup.wizard', value: expect.objectContaining({ step: 'organization' }) }),
      ]);
    });

    /** Progress is a convenience; every step's real work saves on its own. A failed progress
     * write must not block the user mid-setup. */
    it('survives a failed progress write', async () => {
      const settings = TestBed.inject(SettingsService);
      (settings.upsert as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));

      await expect(service.goTo('phone')).resolves.toBeUndefined();
      expect(service.state().step).toBe('phone');
    });
  });

  describe('outstanding', () => {
    it('lists what is left, and excludes the optional team step', () => {
      user.set({ tenant_demo_mode_at: null });
      snapshot.set({
        'organization.name': 'Riverside',
        'organization.address': '1 Main St',
        'communications.default_from_email': 'news@vote-jane.org',
      });

      // Plan, phone and people are still unmet in this fixture; team is never listed because
      // inviting teammates is genuinely optional and must not read as an unfinished obligation.
      expect(service.outstanding()).toEqual(['plan', 'phone', 'people']);
      expect(service.outstanding()).not.toContain('team');
    });
  });
});
