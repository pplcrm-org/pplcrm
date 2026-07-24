import { Injectable, signal } from '@angular/core';

/**
 * Open-state for the global "Report a bug" dialog (hosted once in the dashboard layout,
 * same idiom as KeyboardShortcutsService.helpVisible) so the navbar menu, the command
 * palette, and the Help Center can all open the one instance.
 */
@Injectable({ providedIn: 'root' })
export class BugReportDialogService {
  private readonly _visible = signal(false);

  public readonly visible = this._visible.asReadonly();

  public open(): void {
    this._visible.set(true);
  }

  public close(): void {
    this._visible.set(false);
  }
}
