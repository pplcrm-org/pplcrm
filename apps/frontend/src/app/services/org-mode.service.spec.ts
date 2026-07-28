import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IAuthUser } from '@common';

import { AuthService } from '../auth/auth-service';
import { OrgModeService } from './org-mode.service';
import { SettingsService } from '../experiences/settings/services/settings-service';

describe('OrgModeService', () => {
  const user = signal<IAuthUser | null>(null);
  const snapshot = signal<Record<string, unknown>>({});

  function makeService(): OrgModeService {
    TestBed.configureTestingModule({
      providers: [
        OrgModeService,
        { provide: AuthService, useValue: { getUserSignal: () => user, getCurrentUser: () => Promise.resolve(null) } },
        { provide: SettingsService, useValue: { snapshotSignal: snapshot, upsert: () => Promise.resolve({}) } },
      ],
    });
    return TestBed.inject(OrgModeService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    user.set(null);
    snapshot.set({});
  });

  describe('mode', () => {
    it('falls back to office when neither source has a value', () => {
      expect(makeService().mode()).toBe('office');
    });

    it('reads the session when the snapshot is empty — the cold-load path', () => {
      user.set({ tenant_org_mode: 'church' } as IAuthUser);
      expect(makeService().mode()).toBe('church');
    });

    it('prefers the snapshot over the session, so a save shows up immediately', () => {
      user.set({ tenant_org_mode: 'church' } as IAuthUser);
      snapshot.set({ 'workspace.mode': 'nonprofit' });
      expect(makeService().mode()).toBe('nonprofit');
    });

    it('ignores garbage in either source', () => {
      user.set({ tenant_org_mode: 'temple' } as unknown as IAuthUser);
      snapshot.set({ 'workspace.mode': 42 });
      expect(makeService().mode()).toBe('office');
    });
  });

  describe('terms', () => {
    it('recomputes when the mode changes', () => {
      const service = makeService();
      expect(service.term('nav.donations')).toBe('Donations');
      snapshot.set({ 'workspace.mode': 'church' });
      expect(service.term('nav.donations')).toBe('Giving');
      expect(service.term('nav.canvassing')).toBe('Visitation');
    });
  });

  describe('enabledModules', () => {
    it('applies the mode defaults', () => {
      snapshot.set({ 'workspace.mode': 'church' });
      const service = makeService();
      expect(service.isEnabled('canvassing')).toBe(false);
      expect(service.isEnabled('deliveries')).toBe(false);
      expect(service.isEnabled('donations')).toBe(true);
      expect(service.isEnabled('volunteerAccess')).toBe(true);
    });

    it('leaves everything on for the default mode', () => {
      const service = makeService();
      expect(service.enabledModules().size).toBe(4);
    });

    it('lets an explicit override re-enable a module the mode turned off', () => {
      snapshot.set({ 'workspace.mode': 'church', 'workspace.modules': { canvassing: true } });
      expect(makeService().isEnabled('canvassing')).toBe(true);
    });

    it('lets an explicit override turn off a module the mode left on', () => {
      snapshot.set({ 'workspace.modules': { donations: false } });
      expect(makeService().isEnabled('donations')).toBe(false);
    });

    it('reads overrides from the session before the snapshot arrives', () => {
      user.set({ tenant_org_mode: 'church', tenant_module_overrides: { canvassing: true } } as IAuthUser);
      expect(makeService().isEnabled('canvassing')).toBe(true);
    });
  });
});
