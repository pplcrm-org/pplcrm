import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterModule,
} from '@angular/router';
import { Alerts } from '@uxcommon/components/alerts/alerts';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { Icon } from '@icons/icon';
import { AuthService } from '../../auth/auth-service';

import { Navbar } from '../navbar/navbar';
import { Sidebar } from '../sidebar/sidebar';
import { SidebarService } from 'apps/frontend/src/app/layout/sidebar/sidebar-service';
import { CommandPalette } from '../command-palette/command-palette';
import { KeyboardShortcutsHelp } from '../keyboard-shortcuts/keyboard-shortcuts-help';
import { ReportBugDialog } from '../report-bug/report-bug-dialog';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { BreadcrumbDefaultsService } from '../../services/breadcrumb-defaults.service';

@Component({
  selector: 'pc-dashboard',
  imports: [Navbar, Sidebar, RouterModule, Alerts, Icon, KeyboardShortcutsHelp, CommandPalette, ReportBugDialog],
  templateUrl: './dashboard.html',
  host: {
    '(window:keydown)': 'onKeydown($event)',
  },
})
export class Dashboard {
  private readonly sidebarSvc = inject(SidebarService);
  private readonly auth = inject(AuthService);
  private readonly shortcuts = inject(KeyboardShortcutsService);
  private readonly router = inject(Router);

  protected readonly userSignal = this.auth.getUserSignal();
  protected readonly isViewer = computed(() => this.userSignal()?.role === 'viewer');
  protected readonly isDemo = computed(() => !!this.userSignal()?.tenant_demo_mode_at);

  // Narrates slow route transitions (lazy-chunk download on a cold connection):
  // gated so sub-300ms navigations show nothing at all.
  private readonly _navGate = createLoadingGate();
  private _endNav: (() => void) | undefined;
  protected readonly navPending = this._navGate.visible;

  constructor() {
    // Route-driven default breadcrumbs for every page the shell hosts.
    inject(BreadcrumbDefaultsService).start();

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this._endNav?.();
        this._endNav = this._navGate.begin();
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this._endNav?.();
        this._endNav = undefined;
      }
    });
  }

  protected isMobileOpen() {
    return this.sidebarSvc.isMobileOpen();
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.shortcuts.handleKeydown(event);
  }
}
