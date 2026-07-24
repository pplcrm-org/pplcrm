import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { FilesService } from '@experiences/files/services/files.service';
import { BugReportsService } from '../../services/api/bug-reports-service';
import { BugReportDialogService } from '../../services/bug-report-dialog.service';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** Narrow the untyped registerFile result to the row id we need. */
function hasId(value: unknown): value is { id: string | number } {
  return typeof value === 'object' && value != null && 'id' in value;
}

/**
 * Global "Report a bug" dialog (fire-and-forget). Hosted once in the dashboard layout;
 * opened from the user menu, the command palette, and the Help Center via
 * {@link BugReportDialogService}. The user types only the description — page URL, user
 * agent, and viewport are captured automatically and sent along for the ops email.
 */
@Component({
  selector: 'pc-report-bug-dialog',
  imports: [Icon, FormField, ModalShell],
  templateUrl: './report-bug-dialog.html',
})
export class ReportBugDialog {
  private readonly bugReportsSvc = inject(BugReportsService);
  private readonly filesSvc = inject(FilesService);
  private readonly alertSvc = inject(AlertService);
  private readonly router = inject(Router);

  private readonly _loading = createLoadingGate();

  protected readonly dialogSvc = inject(BugReportDialogService);

  protected readonly description = signal('');
  protected readonly descriptionForm = form(this.description, (d) => {
    required(d);
    maxLength(d, 5000);
  });

  protected readonly screenshot = signal<File | null>(null);
  protected readonly submitting = signal(false);

  protected readonly descriptionInvalid = () => this.descriptionForm().invalid() && this.descriptionForm().touched();

  protected onClosed(): void {
    this.dialogSvc.close();
    this.resetForm();
  }

  protected onScreenshotChange(files: FileList | null): void {
    const file = files?.item(0) ?? null;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.alertSvc.showError('The screenshot must be an image.');
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      this.alertSvc.showError('That image is over 5 MB. Crop it or take a smaller screenshot.');
      return;
    }
    this.screenshot.set(file);
  }

  protected removeScreenshot(): void {
    this.screenshot.set(null);
  }

  protected async submit(): Promise<void> {
    this.descriptionForm().markAsTouched();
    if (this.descriptionForm().invalid()) return;

    this.submitting.set(true);
    const end = this._loading.begin();
    try {
      let screenshotFileId: string | null = null;
      const file = this.screenshot();
      if (file) {
        // Untethered upload — the server links it to the report inside the same
        // transaction that creates the row.
        const uploaded: unknown = await this.filesSvc.uploadFileDirectly(file);
        screenshotFileId = hasId(uploaded) ? String(uploaded.id) : null;
      }

      const { id } = await this.bugReportsSvc.report({
        description: this.description(),
        page_url: this.router.url,
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        screenshot_file_id: screenshotFileId,
      });

      this.alertSvc.showSuccess(`Thanks for the report. Reference BR-${id}. Our team will take a look.`);
      this.dialogSvc.close();
      this.resetForm();
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to send the report');
    } finally {
      this.submitting.set(false);
      end();
    }
  }

  private resetForm(): void {
    this.description.set('');
    this.descriptionForm().reset();
    this.screenshot.set(null);
    this.submitting.set(false);
  }
}
