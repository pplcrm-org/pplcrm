import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Sidebar } from './sidebar';
import { SidebarService } from './sidebar-service';
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
});
