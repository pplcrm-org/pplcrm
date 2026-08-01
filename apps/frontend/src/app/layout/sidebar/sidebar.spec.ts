import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Sidebar } from './sidebar';
import { SidebarService } from './sidebar-service';
import { SidebarItems, type ISidebarItem } from './sidebar-items';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AuthService } from '../../auth/auth-service';
import { TasksService } from '@experiences/tasks/services/tasks-service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

describe('Sidebar Component', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;
  let mockSidebarSvc: any;
  let mockAuthService: any;
  let mockTasksSvc: any;

  /** The component samples matchMedia('(min-width: 1024px)') once, at construction — so call this
   *  before creating the fixture you want to test. */
  function setLargeScreen(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  }

  beforeEach(async () => {
    setLargeScreen(false);
    mockSidebarSvc = {
      getItems: vi.fn().mockReturnValue(signal([{ label: 'Test Item' }])),
      closeMobile: vi.fn(),
      isCollapsed: vi.fn().mockReturnValue(false),
      isFull: vi.fn().mockReturnValue(true),
      isHalf: vi.fn().mockReturnValue(false),
      isMobileOpen: vi.fn().mockReturnValue(true),
      toggleCollapsed: vi.fn(),
      toggleDrawer: vi.fn(),
    };

    mockAuthService = {
      getUser: vi.fn().mockReturnValue({ role: 'admin' }),
      getUserSignal: vi.fn().mockReturnValue(signal({ role: 'admin' })),
    };

    mockTasksSvc = {
      countSlaBreaches: vi.fn().mockResolvedValue(0),
    };

    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        { provide: SidebarService, useValue: mockSidebarSvc },
        { provide: AuthService, useValue: mockAuthService },
        { provide: TasksService, useValue: mockTasksSvc },
        provideRouter([]), // needed for RouterLink
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should retrieve items from SidebarService', () => {
    fixture.detectChanges();
    expect(component['items']()).toEqual([{ label: 'Test Item' }]);
    expect(mockSidebarSvc.getItems).toHaveBeenCalled();
  });

  it('should call closeMobile on service when triggered', () => {
    component['closeMobile']();
    expect(mockSidebarSvc.closeMobile).toHaveBeenCalled();
  });

  it('should check if section is collapsed', () => {
    expect(component['isCollapsed']('section1')).toBe(false);
    expect(mockSidebarSvc.isCollapsed).toHaveBeenCalledWith('section1');
  });

  it('should accurately return drawer state', () => {
    expect(component['isDrawerFull']()).toBe(true);
    expect(component['isDrawerHalf']()).toBe(false);
    expect(component['isMobileOpen']()).toBe(true);
  });

  it('should hide adminOnly sections from editors', () => {
    mockAuthService.getUser.mockReturnValue({ role: 'user' });
    mockSidebarSvc.getItems.mockReturnValue(
      signal([
        { name: 'ADMIN', type: 'subheading', adminOnly: true, children: [] },
        { name: 'People', route: '/people' },
      ]),
    );
    expect(component['items']().map((item: { name: string }) => item.name)).toEqual(['People']);
  });

  it('should honor collapse state on the expanded desktop sidebar', () => {
    // The only place chevrons exist: large screen, full drawer, mobile menu closed.
    setLargeScreen(true);
    mockSidebarSvc.isCollapsed.mockReturnValue(true);
    mockSidebarSvc.isMobileOpen.mockReturnValue(false);
    const desktop = TestBed.createComponent(Sidebar).componentInstance;
    expect(desktop['isVisuallyCollapsed']('section1')).toBe(true);
  });

  it('should ignore collapse state in the full-screen mobile menu', () => {
    mockSidebarSvc.isCollapsed.mockReturnValue(true);
    // isMobileOpen is true in the default mock. The mobile menu has no chevrons, so a collapsed
    // section would be a dead end — it always shows everything.
    expect(component['isVisuallyCollapsed']('section1')).toBe(false);
  });

  it('should ignore collapse state on the narrow icon rail', () => {
    mockSidebarSvc.isCollapsed.mockReturnValue(true);
    // Mobile closed + small screen (matchMedia mock reports matches: false) = narrow rail
    mockSidebarSvc.isMobileOpen.mockReturnValue(false);
    expect(component['isVisuallyCollapsed']('section1')).toBe(false);
  });

  it('should toggle collapse state of a section', () => {
    component['toggleCollapse']('section1');
    expect(mockSidebarSvc.toggleCollapsed).toHaveBeenCalledWith('section1');
  });

  it('should toggle the drawer state', () => {
    component['toggleDrawer']();
    expect(mockSidebarSvc.toggleDrawer).toHaveBeenCalled();
  });

  /**
   * Module visibility. An off module — off by the MODE's default or by an explicit USER
   * override — is DIMMED, not dropped: it stays visible so the user learns it exists,
   * and clicking it explains instead of navigating. The route stays resolvable and the
   * `g` chord keeps working, because "off" is a default the user can undo, not a
   * permission.
   */
  describe('organization mode', () => {
    function buildWith(mode: string, overrides: Record<string, boolean> = {}): Sidebar {
      TestBed.resetTestingModule();
      setLargeScreen(false);
      const user = signal({ role: 'admin', tenant_org_mode: mode, tenant_module_overrides: overrides });
      TestBed.configureTestingModule({
        imports: [Sidebar],
        providers: [
          { provide: SidebarService, useValue: { ...mockSidebarSvc, getItems: () => signal(SidebarItems) } },
          { provide: AuthService, useValue: { getUser: () => user(), getUserSignal: () => user } },
          { provide: TasksService, useValue: mockTasksSvc },
          { provide: SettingsService, useValue: { snapshotSignal: signal({}), upsert: vi.fn() } },
          { provide: AlertService, useValue: { showInfo: vi.fn() } },
          provideRouter([]),
        ],
      });
      return TestBed.createComponent(Sidebar).componentInstance;
    }

    function find(cmp: Sidebar, name: string) {
      const items = (cmp as any).items() as ISidebarItem[];
      return items.flatMap((i) => (i.children ? [i, ...i.children] : [i])).find((i) => i.name === name);
    }

    it('dims canvassing and deliveries in church mode (off by mode default, still visible)', () => {
      const cmp = buildWith('church');
      expect(find(cmp, 'Canvassing')?.dimmed).toBe(true);
      expect(find(cmp, 'Canvassing')?.hidden).toBeFalsy();
      expect(find(cmp, 'Deliveries')?.dimmed).toBe(true);
      expect(find(cmp, 'Deliveries')?.hidden).toBeFalsy();
    });

    it('dims donations in office mode', () => {
      const cmp = buildWith('office');
      expect(find(cmp, 'Donations')?.dimmed).toBe(true);
      expect(find(cmp, 'Donations')?.hidden).toBeFalsy();
    });

    it('dims a module the user explicitly turned off, same as a mode default', () => {
      const campaign = buildWith('campaign', { donations: false });
      expect(find(campaign, 'Donations')?.dimmed).toBe(true);
      expect(find(campaign, 'Donations')?.hidden).toBeFalsy();

      // Same treatment when the user's decision matches the mode default.
      const church = buildWith('church', { canvassing: false });
      expect(find(church, 'Canvassing')?.dimmed).toBe(true);
      expect(find(church, 'Canvassing')?.hidden).toBeFalsy();
    });

    it('keeps them fully visible in campaign mode', () => {
      const cmp = buildWith('campaign');
      expect(find(cmp, 'Canvassing')?.hidden).toBeFalsy();
      expect(find(cmp, 'Canvassing')?.dimmed).toBeFalsy();
      expect(find(cmp, 'Deliveries')?.hidden).toBeFalsy();
      expect(find(cmp, 'Deliveries')?.dimmed).toBeFalsy();
    });

    it('lets an explicit override re-show a module the mode turned off', () => {
      const cmp = buildWith('church', { canvassing: true });
      expect(find(cmp, 'Canvassing')?.hidden).toBeFalsy();
      expect(find(cmp, 'Canvassing')?.dimmed).toBeFalsy();
    });

    it('never hides or dims an entry that belongs to no optional module', () => {
      const cmp = buildWith('church');
      expect(find(cmp, 'Teams')?.hidden).toBeFalsy();
      expect(find(cmp, 'Teams')?.dimmed).toBeFalsy();
      expect(find(cmp, 'People')?.hidden).toBeFalsy();
      expect(find(cmp, 'People')?.dimmed).toBeFalsy();
    });

    it('words the mode-sensitive entries from the term table', () => {
      const cmp = buildWith('church');
      const canvassing = find(cmp, 'Canvassing');
      expect(canvassing).toBeDefined();
      expect((cmp as any).label(canvassing)).toBe('Visitation');
      expect((cmp as any).label(find(cmp, 'Donations'))).toBe('Giving');
    });

    it('toasts instead of navigating when a dimmed entry is clicked', () => {
      const cmp = buildWith('office');
      const donations = find(cmp, 'Donations');
      const event = { preventDefault: vi.fn() };
      (cmp as any).onNavClick(donations, event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(TestBed.inject(AlertService).showInfo).toHaveBeenCalledWith(
        'Donations is turned off for this workspace. You can turn it on in Workspace settings.',
      );
      expect(mockSidebarSvc.closeMobile).not.toHaveBeenCalled();
    });

    it('closes the mobile menu, with no toast, when an enabled entry is clicked', () => {
      const cmp = buildWith('campaign');
      const donations = find(cmp, 'Donations');
      const event = { preventDefault: vi.fn() };
      (cmp as any).onNavClick(donations, event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(TestBed.inject(AlertService).showInfo).not.toHaveBeenCalled();
      expect(mockSidebarSvc.closeMobile).toHaveBeenCalled();
    });

    it('names the off reason in the dimmed entry tooltip, using the mode wording', () => {
      const cmp = buildWith('office');
      expect((cmp as any).tooltipFor(find(cmp, 'Donations'))).toBe('Donations is turned off for this workspace');
    });
  });
});
