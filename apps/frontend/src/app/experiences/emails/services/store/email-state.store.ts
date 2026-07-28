import { computed, signal, Service, linkedSignal } from '@angular/core';

import { ServerEmail } from '../../../../../../../../libs/common/src/lib/emails';
import type { EmailType } from '../../../../../../../../libs/common/src/lib/models';

@Service()
export class EmailStateStore {
  public readonly activeFolderId = signal<string | null>(null);

  public readonly currentSelectedEmailId = linkedSignal<string | null, string | null>({
    source: () => this.activeFolderId(),
    computation: () => null,
  });

  public readonly emailsById = signal<Record<string, EmailType>>({});

  public readonly currentSelectedEmail = computed(() => {
    const id = this.currentSelectedEmailId();
    return id ? (this.emailsById()[id] ?? null) : null;
  });

  public readonly emailIdsByFolderId = signal<Record<string, string[]>>({});

  public readonly hasAttachmentByEmailId = signal<Record<string, boolean | undefined>>({});

  public readonly isBodyExpanded = signal<boolean>(false);

  /** Person context rail (§5): collapsed = 48px identity strip, expanded = 236px card. */
  public readonly personRailCollapsed = signal<boolean>(false);

  public readonly mobilePanelView = signal<'folders' | 'list' | 'detail'>('folders');

  public togglePersonRail(): void {
    this.personRailCollapsed.update((v) => !v);
  }

  public clearHasAttachment(emailId: string) {
    this.hasAttachmentByEmailId.update((m) => {
      const next = { ...m };
      delete next[emailId];
      return next;
    });
  }

  public emailsInFolderWithFlags(folderId: string) {
    return computed(() => {
      const ids = this.emailIdsByFolderId()[folderId] ?? [];
      const emailsMap = this.emailsById();
      const flags = this.hasAttachmentByEmailId();
      return ids
        .map((id) => emailsMap[id])
        .filter(Boolean)
        .map((e) => ({ ...e!, has_attachment: flags[e!.id] ?? false }));
    });
  }

  public hasAttachment(emailId: string) {
    return computed<boolean | undefined>(() => this.hasAttachmentByEmailId()[emailId]);
  }

  public mergeHasRows(rows: Array<{ email_id: string; has: boolean }>, fillFalseForIds?: string[]) {
    const map: Record<string, boolean> = {};
    for (const r of rows) map[String(r.email_id)] = !!r.has;

    // Optional: mark any requested ids that didn't come back as false
    if (fillFalseForIds?.length) {
      for (const id of fillFalseForIds) if (!(id in map)) map[id] = false;
    }

    this.setManyHasAttachment(map);
  }

  public patchEmail(emailKey: string, patch: Partial<EmailType>): EmailType | undefined {
    const prev = this.readEmail(emailKey);
    if (!prev) return undefined;
    this.emailsById.update((m) => ({ ...m, [emailKey]: { ...prev, ...patch } }));
    return prev;
  }

  public readEmail(emailKey: string): EmailType | undefined {
    return this.emailsById()[emailKey];
  }

  public removeEmail(emailId: string): void {
    // Remove from normalized map
    this.emailsById.update((m) => {
      const next = { ...m };
      delete next[emailId];
      return next;
    });

    // Remove from folder lists
    this.emailIdsByFolderId.update((map) => {
      const next: Record<string, string[]> = {};
      for (const [fid, ids] of Object.entries(map)) {
        next[fid] = ids.filter((id) => id !== emailId);
      }
      return next;
    });

    // Clear attachment flag
    this.clearHasAttachment(emailId);
  }

  public replaceEmail(emailKey: string, value: EmailType): void {
    this.emailsById.update((m) => ({ ...m, [emailKey]: value }));
  }

  public selectEmail(email: EmailType | { id: EmailId } | null): void {
    this.currentSelectedEmailId.set(email ? String(email.id) : null);
  }

  public setEmailsForFolder(folderId: string, serverEmails: ServerEmail[], append = false): void {
    const ids: string[] = [];
    const flagsMap: Record<string, boolean> = {}; // collect booleans while we normalize rows

    this.emailsById.update((map) => {
      const next = { ...map };
      for (const s of serverEmails) {
        const id = String(s.id);
        ids.push(id);

        // reuse your existing helper; prefer hasMap[id] when provided
        const { has, count } = deriveHasAndCount(s);
        flagsMap[id] = has;

        const e: EmailType = {
          id,
          folder_id: String(s.folder_id),
          updated_at: new Date(s.updated_at),
          date_sent: s.date_sent ? new Date(s.date_sent) : undefined,
          is_favourite: !!s.is_favourite,
          attachment_count: count,
          status: (s as any).status || 'open',
          from_email: s.from_email ?? undefined,
          to_email: s.to_email ?? undefined,
          subject: s.subject ?? undefined,
          preview: s.preview ?? undefined,
          preview_text: s.preview_text ?? undefined,
          assigned_to: s.assigned_to ?? undefined,
          has_attachment: has, // keep in the normalized email too
          is_read: !!(s as any).is_read,
          sender_first_name: s.sender_first_name ?? undefined,
          sender_last_name: s.sender_last_name ?? undefined,
        };

        next[id] = e;
      }
      return next;
    });

    this.emailIdsByFolderId.update((m) => {
      const existing = append ? (m[folderId] ?? []) : [];
      const combined = [...existing];
      for (const id of ids) {
        if (!combined.includes(id)) {
          combined.push(id);
        }
      }
      return { ...m, [folderId]: combined };
    });

    // seed/refresh the per-id flags cache
    this.setManyHasAttachment(flagsMap);
  }

  public setHasAttachment(emailId: string, hasAttachment: boolean | undefined) {
    this.hasAttachmentByEmailId.update((m) => ({ ...m, [emailId]: hasAttachment }));
  }

  public setManyHasAttachment(map: Record<string, boolean | undefined>) {
    this.hasAttachmentByEmailId.update((prev) => ({ ...prev, ...map }));
  }

  public toggleBodyExpanded(): void {
    this.isBodyExpanded.update((v) => !v);
  }
}

export type EmailId = string | number;

function deriveHasAndCount(s: ServerEmail): { has: boolean; count: number } {
  if (typeof s.has_attachment === 'boolean') {
    const n = toNum(s.attachment_count);
    // if backend didn’t send a count, synthesize a minimal one
    return { has: s.has_attachment, count: n ?? (s.has_attachment ? 1 : 0) };
  }
  const count = toNum(s.attachment_count);
  return { has: count > 0, count };
}

function toNum(n: unknown): number {
  if (typeof n === 'bigint') return Number(n);
  if (typeof n === 'string') return Number(n) || 0;
  if (typeof n === 'number') return n;
  return 0;
}
