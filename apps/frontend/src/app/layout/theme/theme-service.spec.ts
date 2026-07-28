import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme-service';
import { SettingsService } from '../../experiences/settings/services/settings-service';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ThemeService', () => {
  let service: ThemeService;
  let mockSettingsSvc: any;
  let mockSnapshotSignal: any;
  let settingsStore: Record<string, any>;

  beforeEach(() => {
    settingsStore = {
      'appearance.theme': 'light',
    };
    mockSnapshotSignal = signal({});
    mockSettingsSvc = {
      snapshotSignal: mockSnapshotSignal,
      getValue: vi.fn((key: string) => settingsStore[key]),
    };

    // Mock localStorage
    const store: Record<string, string> = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] || null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, val) => {
      store[key] = val;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key) => {
      delete store[key];
    });
    vi.spyOn(Storage.prototype, 'clear').mockImplementation(() => {
      for (const k in store) {
        delete store[k];
      }
    });

    // Mock window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize theme based on localStorage override', () => {
    localStorage.setItem('pc-theme', 'dark');
    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);
    expect(service.getTheme()).toBe('dark');
  });

  it('should fallback to SettingsService default theme if no localStorage override', () => {
    settingsStore['appearance.theme'] = 'dark';
    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);
    expect(service.getTheme()).toBe('dark');
  });

  it('should fallback to system settings if neither localStorage nor settings are set', () => {
    settingsStore['appearance.theme'] = undefined;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, // system is dark
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any;

    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);
    expect(service.getTheme()).toBe('dark');
  });

  it('should toggle theme and store it in localStorage', () => {
    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);
    expect(service.getTheme()).toBe('light');

    service.toggleTheme();
    expect(service.getTheme()).toBe('dark');
    expect(localStorage.getItem('pc-theme')).toBe('dark');

    service.toggleTheme();
    expect(service.getTheme()).toBe('light');
    expect(localStorage.getItem('pc-theme')).toBe('light');
  });

  it('should follow the OS when the preference is explicitly system, ignoring the workspace default', () => {
    settingsStore['appearance.theme'] = 'light'; // workspace default is light
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, // but the OS is dark
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any;

    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);

    service.setPreference('system');
    expect(service.getPreference()).toBe('system');
    expect(service.getTheme()).toBe('dark');
    expect(localStorage.getItem('pc-theme')).toBe('system');
  });

  it('keeps a personal theme pin when the workspace default changes', async () => {
    // The workspace default is 'light'; this user deliberately pinned 'dark'.
    settingsStore['appearance.theme'] = 'light';
    localStorage.setItem('pc-theme', 'dark');

    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);
    expect(service.getTheme()).toBe('dark'); // the pin wins over the workspace default

    // An admin now flips the workspace default. This must not reach into anyone's own choice:
    // the service previously cleared `pc-theme` here, silently unpinning every user.
    settingsStore['appearance.theme'] = 'dark';
    mockSnapshotSignal.set({});

    await TestBed.runInInjectionContext(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    expect(localStorage.getItem('pc-theme')).toBe('dark');
    expect(service.getTheme()).toBe('dark');
  });

  it('follows the workspace default for a user who never pinned a theme', async () => {
    settingsStore['appearance.theme'] = 'light';
    localStorage.removeItem('pc-theme');

    TestBed.configureTestingModule({
      providers: [ThemeService, { provide: SettingsService, useValue: mockSettingsSvc }],
    });
    service = TestBed.inject(ThemeService);
    expect(service.getTheme()).toBe('light');

    settingsStore['appearance.theme'] = 'dark';
    mockSnapshotSignal.set({});

    await TestBed.runInInjectionContext(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    expect(service.getTheme()).toBe('dark');
    expect(localStorage.getItem('pc-theme')).toBeNull();
  });
});
