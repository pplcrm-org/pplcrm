import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { allowsAttachmentDownload } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AttachmentIconComponent } from '@uxcommon/components/icons/attachment-icon';
import { Icon } from '@uxcommon/components/icons/icon';
import { FileSizePipe } from '@uxcommon/pipes/filesize.pipe';
import { SanitizeHtmlPipe } from '@uxcommon/pipes/sanitize-html.pipe';

import type { EmailType } from '../../../../../../../../libs/common/src/lib/models';
import { environment } from '../../../../../environments/environment';
import { EmailsStore } from '../../services/store/emailstore';

@Component({
  selector: 'pc-email-body',
  imports: [SanitizeHtmlPipe, FileSizePipe, AttachmentIconComponent, Icon],
  template: `<div
    class="prose max-w-none break-words overflow-y-auto h-full p-2 email-scrollbar border border-1 border-base-300 rounded-xl"
  >
    @if (isSpam()) {
      <div class="alert alert-warning alert-soft mb-3 text-sm not-prose" role="status">
        <pc-icon name="exclamation-triangle" [size]="4"></pc-icon>
        <span i18n>
          This message is in spam, so its images and attachments stay unopened. If it is genuine, move it out of spam in
          your mailbox — it will come back here on the next sync with everything available.
        </span>
      </div>
    }
    <div [innerHTML]="bodyHtml() | sanitizeHtml"></div>
    @if (attachments().length > 0) {
      <div class="mt-4 flex flex-wrap gap-2">
        @for (att of attachments(); track att.id) {
          @if (isSpam()) {
            <span
              class="badge badge-outline opacity-60 cursor-not-allowed"
              i18n-title
              title="Attachments on spam messages cannot be opened"
            >
              <pc-attachment-icon [filename]="att.filename" [size]="4"></pc-attachment-icon>
              <span>{{ att.filename }} | {{ att.size_bytes | fileSize }}</span>
            </span>
          } @else {
            <a
              class="badge badge-outline no-underline hover:text-primary group"
              [href]="getAttachmentUrl(att)"
              target="_blank"
              rel="noopener"
              i18n-rel
            >
              <pc-attachment-icon [filename]="att.filename" [size]="4" class="group-hover:hidden"></pc-attachment-icon>
              <pc-icon name="arrow-down-tray" [size]="4" class="hidden group-hover:block"></pc-icon>
              <span>{{ att.filename }} | {{ att.size_bytes | fileSize }}</span>
            </a>
          }
        }
      </div>
    }
  </div>`,
})
export class EmailBody {
  private readonly alerts = inject(AlertService);
  private readonly emailId = computed(() => {
    const em = this.email();
    return em ? String(em.id) : null;
  });
  private readonly store = inject(EmailsStore);

  protected readonly attachments = computed(() => {
    const id = this.emailId();
    if (!id) return [] as any[];
    const header = this.store.getEmailHeaderById(id)();
    return (header?.attachments || []).filter((a: any) => !a.is_inline);
  });
  protected readonly bodyHtml = computed(() => {
    const id = this.emailId();
    return id ? (this.store.getEmailBodyById(id)() ?? '') : '';
  });
  /**
   * Spam messages are shown in full — subject, sender, body text and the attachment list — so a
   * false positive is recognisable, but their payloads are never fetched. The server enforces this;
   * the UI says so plainly rather than offering an action that would be refused.
   */
  protected readonly isSpam = computed(() => !allowsAttachmentDownload(this.email()?.folder_id));

  public email = input<EmailType | null>(null);

  constructor() {
    effect(() => {
      const id = this.emailId();
      if (!id) return;

      // Only fetch if truly not cached (undefined); empty string is a valid "loaded" result.
      const cached = untracked(() => this.store.getEmailBodyById(id)());
      if (typeof cached === 'undefined') {
        this.store.loadEmailWithHeaders(id).catch((err) => {
          console.error('Failed to load email data:', err);
          this.alerts.showError('Failed to load email data. Please try again later.');
        });
      }
    });
  }

  protected getAttachmentUrl(att: any): string {
    // The backend returns a short-lived, email-scoped signed URL (download_url).
    // We never build a URL with a session token in it (SECURITY-REVIEW.md 1.3).
    return att?.download_url ? `${environment.apiUrl}${att.download_url}` : '';
  }
}
