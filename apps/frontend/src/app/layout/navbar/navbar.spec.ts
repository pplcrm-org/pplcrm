import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Navbar } from './navbar';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { FullScreenService } from '../../services/fullscreen.service';
import { SearchService } from '../../services/api/search-service';
import { CommandPaletteService } from '../../services/command-palette.service';
import { SidebarService } from 'apps/frontend/src/app/layout/sidebar/sidebar-service';
import { ThemeService } from 'apps/frontend/src/app/layout/theme/theme-service';
import { NotificationsService } from '../../services/api/notifications-service';
import { EmailActionsStore } from '../../experiences/emails/services/store/email-actions.store';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';

describe('Navbar Component', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  let mockAuthSvc: any;
  let mockFullScreenSvc: any;
  let mockSearchSvc: any;
  let mockPaletteSvc: any;
  let mockSidebarSvc: any;
  let mockThemeSvc: any;
  let mockNotificationsSvc: any;
  let initNotificationsSpy: any;
  let user: any;

  beforeEach(async () => {
    initNotificationsSpy = vi.spyOn(Navbar.prototype as any, 'initNotifications').mockReturnValue(Promise.resolve());

    user = signal<any>({ name: 'Test User', role: 'admin', tenant_org_mode: 'church' });

    mockAuthSvc = {
      signOut: vi.fn(),
      currentUser: vi.fn().mockReturnValue(user()),
      getUserSignal: vi.fn().mockReturnValue(user),
      resolveAvatarUrl: vi.fn().mockImplementation((url) => url),
    };

    mockFullScreenSvc = {
      isFullScreenMode: vi.fn().mockReturnValue(false),
      toggleFullScreen: vi.fn(),
    };

    mockSearchSvc = {
      clearSearch: vi.fn(),
      doSearchImmediate: vi.fn(),
      doSearch: vi.fn(),
      // A grid is "present" in these specs, so ⌘K keeps its filter-the-page behavior.
      hasGridConsumer: vi.fn().mockReturnValue(true),
      registerGridConsumer: vi.fn(),
      unregisterGridConsumer: vi.fn(),
    };

    mockPaletteSvc = { open: vi.fn() };

    mockSidebarSvc = {
      isMobileOpen: vi.fn().mockReturnValue(false),
      toggleMobile: vi.fn(),
      // Used by the pc-favourite-toggle rendered inside the navbar
      findItemForUrl: vi.fn().mockReturnValue(undefined),
      toggleFavourite: vi.fn().mockReturnValue(false),
    };

    mockThemeSvc = {
      theme: vi.fn().mockReturnValue('light'),
      getTheme: vi.fn().mockReturnValue('light'),
      toggleTheme: vi.fn(),
    };

    mockNotificationsSvc = {
      getLatest: vi.fn().mockResolvedValue([]),
      getUnreadCount: vi.fn().mockResolvedValue(0),
      markRead: vi.fn().mockResolvedValue(undefined),
      markAllRead: vi.fn().mockResolvedValue(undefined),
    };

    const mockEmailActionsStore = {
      sendingCount: vi.fn().mockReturnValue(0),
    };

    await TestBed.configureTestingModule({
      imports: [Navbar],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: FullScreenService, useValue: mockFullScreenSvc },
        { provide: SearchService, useValue: mockSearchSvc },
        { provide: CommandPaletteService, useValue: mockPaletteSvc },
        { provide: SidebarService, useValue: mockSidebarSvc },
        { provide: ThemeService, useValue: mockThemeSvc },
        { provide: NotificationsService, useValue: mockNotificationsSvc },
        { provide: EmailActionsStore, useValue: mockEmailActionsStore },
        // OrgModeService (behind the avatar-menu workspace header) reads the settings snapshot.
        { provide: SettingsService, useValue: { snapshotSignal: signal({}), upsert: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle mobile sidebar', () => {
    component['toggleMobile']();
    expect(mockSidebarSvc.toggleMobile).toHaveBeenCalled();
  });

  it('should check if mobile sidebar is open', () => {
    expect(component['isMobileOpen']()).toBe(false);
    expect(mockSidebarSvc.isMobileOpen).toHaveBeenCalled();
  });

  it('should sign out user', () => {
    component['signOut']();
    expect(mockAuthSvc.signOut).toHaveBeenCalled();
  });

  it('should toggle theme', () => {
    component['toggleTheme']();
    expect(mockThemeSvc.toggleTheme).toHaveBeenCalled();
  });

  it('should toggle fullscreen', () => {
    component['toggleFullScreen']();
    expect(mockFullScreenSvc.toggleFullScreen).toHaveBeenCalled();
  });

  it('should check if fullscreen mode is active', () => {
    expect(component['isFullScreenMode']()).toBe(false);
    expect(mockFullScreenSvc.isFullScreenMode).toHaveBeenCalled();
  });

  it('should show search bar and set focus', async () => {
    component['showSearchBar']();
    expect(component['searchBarVisible']()).toBe(true);

    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 1 + 20)); // wait for queueMicrotask to execute
    // Checking focus is difficult without mounting to real DOM, but we can verify the signal.
  });

  it('should hide search bar', () => {
    component['showSearchBar']();
    component['hideSearchBar']();
    expect(component['searchBarVisible']()).toBe(false);
  });

  it('opens the command palette instead of the search bar when no grid is listening', () => {
    mockSearchSvc.hasGridConsumer.mockReturnValue(false);
    component['showSearchBar']();
    expect(mockPaletteSvc.open).toHaveBeenCalled();
    expect(component['searchBarVisible']()).toBe(false);
  });

  it('should toggle search bar visibility', () => {
    component['toggleSearch']();
    expect(component['searchBarVisible']()).toBe(true);
    component['toggleSearch']();
    expect(component['searchBarVisible']()).toBe(false);
  });

  it('should clear search and call search service', () => {
    component['searchStr'].set('test');
    component['clearSearch']();
    expect(component['searchStr']()).toBe('');
    expect(mockSearchSvc.clearSearch).toHaveBeenCalled();
  });

  it('should update search string and call search on input', () => {
    const mockEvent = { target: { value: 'query' } } as unknown as Event;
    component['onSearchInput'](mockEvent);

    expect(component['searchStr']()).toBe('query');
    expect(mockSearchSvc.doSearch).toHaveBeenCalledWith('query');
  });

  it('should perform immediate search on enter', () => {
    component['searchStr'].set('urgent');
    component['onSearchEnter']();
    expect(mockSearchSvc.doSearchImmediate).toHaveBeenCalledWith('urgent');
  });

  it('should hide search bar on blur if empty', () => {
    component['showSearchBar']();
    component['searchStr'].set('');
    component['onBlurSearchBar']();
    expect(component['searchBarVisible']()).toBe(false);
  });

  it('should NOT hide search bar on blur if not empty', () => {
    component['showSearchBar']();
    component['searchStr'].set('test');
    component['onBlurSearchBar']();
    expect(component['searchBarVisible']()).toBe(true);
  });

  it('should handle Ctrl+K to open search bar', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    vi.spyOn(event, 'preventDefault');

    component.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(component['searchBarVisible']()).toBe(true);
  });

  it('should handle Escape to close search bar', () => {
    component['showSearchBar']();
    component['searchStr'].set('test');

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    component.handleKeyDown(event);

    expect(component['searchBarVisible']()).toBe(false);
    expect(component['searchStr']()).toBe('');
  });

  it('should fetch initial notifications and count on creation', async () => {
    initNotificationsSpy.mockRestore();

    mockNotificationsSvc.getUnreadCount.mockResolvedValue(3);
    mockNotificationsSvc.getLatest.mockResolvedValue([{ id: '1', title: 'N1' }]);

    await component['initNotifications']();

    expect(component.unreadCount()).toBe(3);
    expect(component.notifications()).toEqual([{ id: '1', title: 'N1' }]);
    expect(component.hasMore()).toBe(false);
  });

  it('should fetch new notifications if unread count increases during polling', async () => {
    component.unreadCount.set(2);
    component.notifications.set([{ id: 'old', title: 'Old' }]);

    mockNotificationsSvc.getUnreadCount.mockResolvedValue(4);
    mockNotificationsSvc.getLatest.mockResolvedValue([
      { id: '1', title: 'New 1' },
      { id: '2', title: 'New 2' },
    ]);

    await component['refreshCount']();

    expect(component.unreadCount()).toBe(4);
    expect(component.notifications()).toEqual([
      { id: '1', title: 'New 1' },
      { id: '2', title: 'New 2' },
    ]);
  });

  it('should load more notifications and append non-duplicate items', async () => {
    mockNotificationsSvc.getLatest.mockClear();
    component.notifications.set([{ id: '1', title: 'Notif 1' }]);
    component.hasMore.set(true);

    mockNotificationsSvc.getLatest.mockResolvedValue([
      { id: '1', title: 'Notif 1' },
      { id: '2', title: 'Notif 2' },
    ]);

    await component['loadMore']();

    expect(mockNotificationsSvc.getLatest).toHaveBeenCalledWith({ limit: 5, offset: 1 });
    expect(component.notifications()).toEqual([
      { id: '1', title: 'Notif 1' },
      { id: '2', title: 'Notif 2' },
    ]);
    expect(component.hasMore()).toBe(false);
  });

  it('should update local state when clickNotification is called and mark notification read', async () => {
    const notif = { id: 'notif-1', read: false, link: '/tasks' };
    component.notifications.set([notif]);
    component.unreadCount.set(1);

    vi.spyOn(component as any, 'closeDropdown').mockReturnValue(undefined);

    await component['clickNotification'](notif);

    expect(mockNotificationsSvc.markRead).toHaveBeenCalledWith('notif-1');
    expect(component.notifications()[0]?.read).toBe(true);
    expect(component.unreadCount()).toBe(0);
  });

  it('should update local state and mark all as read when markAllAsRead is called', async () => {
    component.notifications.set([
      { id: '1', read: false },
      { id: '2', read: false },
    ]);
    component.unreadCount.set(2);

    const event = new Event('click');
    await component['markAllAsRead'](event);

    expect(mockNotificationsSvc.markAllRead).toHaveBeenCalled();
    expect(component.notifications().every((n) => n.read)).toBe(true);
    expect(component.unreadCount()).toBe(0);
  });

  it('should set the unread count on initNotifications', async () => {
    initNotificationsSpy.mockRestore();
    mockNotificationsSvc.getUnreadCount.mockResolvedValue(3);
    mockNotificationsSvc.getLatest.mockResolvedValue([]);

    await component['initNotifications']();

    expect(component.unreadCount()).toBe(3);
  });

  it('should refetch notifications on refreshCount when the count increases', async () => {
    component.unreadCount.set(2);
    mockNotificationsSvc.getUnreadCount.mockResolvedValue(3);
    mockNotificationsSvc.getLatest.mockResolvedValue([]);

    await component['refreshCount']();

    expect(component.unreadCount()).toBe(3);
    expect(mockNotificationsSvc.getLatest).toHaveBeenCalled();
  });

  it('should compute avatar initials from the user name', () => {
    expect(component['userInitials']()).toBeDefined();
  });

  it('should label the workspace with the tenant organization mode', () => {
    expect(component['orgModeLabel']()).toBe('Church');
  });

  it('should fall back to the default mode label when the session carries none', () => {
    user.set({ name: 'Test User', role: 'admin' });
    expect(component['orgModeLabel']()).toBe('Constituency office');
  });

  it('should offer the mode switch to admins and only state it for plain members', () => {
    expect(component['canChangeOrgMode']()).toBe(true);

    user.set({ name: 'Test User', role: 'user' });
    expect(component['canChangeOrgMode']()).toBe(false);
  });
});
