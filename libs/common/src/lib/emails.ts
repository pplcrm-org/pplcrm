// ---------- Public compatibility interface (loose) ----------
// ---------- Strict types for compile-time guarantees ----------
interface EmailFolderBase {
  icon: string;
  id: string;
  is_default: boolean;
  name: string;
  sort_order: number;
  is_hidden?: boolean;
}

export interface EmailFolderConfig {
  code?: string; // optional/loose for compatibility
  icon: string;
  id: string;
  is_default: boolean;
  is_virtual: boolean;
  name: string;
  sort_order: number;
  is_hidden?: boolean;
}

export interface RealEmailFolder extends EmailFolderBase {
  code?: never; // forbidden on real folders
  is_virtual: false;
}

export interface VirtualEmailFolder extends EmailFolderBase {
  code: string; // required when virtual
  is_virtual: true;
}

// ---------- Derived types ----------
type Folder = (typeof EMAIL_FOLDERS)[number];

type OnlyReal = Extract<Folder, { is_virtual: false }>;

type OnlyVirtual = Extract<Folder, { is_virtual: true }>;

// All folders (merged, exact keys/ids)
export type AllFolderKey = keyof typeof SPECIAL_FOLDERS | keyof typeof REGULAR_FOLDERS;

export type AllFoldersMap = typeof SPECIAL_FOLDERS & typeof REGULAR_FOLDERS;

export type EmailStatus = 'open' | 'closed';

export type HasRow = {
  email_id: string;
  has: boolean;
};

export type RegularFolderId = OnlyReal['id']; // '7' | '3' | '4' | '5'

export type RegularFolderKey = Uppercase<RegularFolderName>; // 'DRAFTS' | 'SENT' | 'SPAM' | 'TRASH'

export type RegularFolderName = OnlyReal['name']; // 'Drafts' | 'Sent' | 'Spam' | 'Trash'

export type ServerEmail = {
  assigned_to?: string | null;
  attachment_count?: number | string | bigint | null;
  folder_id: string | number;
  from_email?: string | null;
  is_read?: boolean;

  // any of these might be present depending on endpoint:
  has_attachment?: boolean | null;
  id: string | number;
  is_favourite: boolean;
  preview?: string | null;
  status?: string;
  subject?: string | null;
  to_email?: string | null;
  updated_at: string | Date;
  date_sent?: string | Date | null;
  sender_first_name?: string | null;
  sender_last_name?: string | null;
};

export type SpecialFolderId = OnlyVirtual['id'];

export type SpecialFolderKey = OnlyVirtual['code'];

export type StrictEmailFolderConfig = VirtualEmailFolder | RealEmailFolder;

function createRegularFolders<const F extends readonly StrictEmailFolderConfig[]>(folders: F) {
  type RegularFolder = Extract<F[number], { is_virtual: false }>;
  type FolderKey = Uppercase<RegularFolder['name'] & string>;
  type FolderId<K extends FolderKey> = Extract<RegularFolder, { name: Capitalize<Lowercase<K>> }>['id'];

  const entries = folders
    .filter((f): f is RegularFolder => !f.is_virtual)
    .map((f) => [f.name.toUpperCase() as FolderKey, f.id] as const);

  return Object.freeze(Object.fromEntries(entries)) as { readonly [K in FolderKey]: FolderId<K> };
}

function createSpecialFolders<const F extends readonly StrictEmailFolderConfig[]>(folders: F) {
  type VirtualFolder = Extract<F[number], { is_virtual: true }>;
  type FolderCode = VirtualFolder extends { code: infer C extends string } ? C : never;
  type FolderId<Code extends string> = Extract<VirtualFolder, { code: Code }>['id'];

  const entries = folders.filter((f): f is VirtualFolder => f.is_virtual).map((f) => [f.code, f.id] as const);

  return Object.freeze(Object.fromEntries(entries)) as { readonly [P in FolderCode]: FolderId<P> };
}

export const isRegularFolderId = (id: string): id is RegularFolderId =>
  Object.values(REGULAR_FOLDERS).includes(id as RegularFolderId);

// Optional runtime type guards
export const isSpecialFolderId = (id: string): id is SpecialFolderId =>
  Object.values(SPECIAL_FOLDERS).includes(id as SpecialFolderId);

// ---------- Configuration (validated against STRICT type) ----------
export const EMAIL_FOLDERS = [
  // Virtual
  { id: '9', name: 'Starred', icon: 'star', sort_order: 1, is_default: false, is_virtual: true, code: 'FAVOURITES' },
  {
    id: '8',
    name: 'Unassigned',
    icon: 'inbox',
    sort_order: 2,
    is_default: false,
    is_virtual: true,
    code: 'UNASSIGNED',
  },
  {
    id: '6',
    name: 'Mine',
    icon: 'user-circle',
    sort_order: 3,
    is_default: true,
    is_virtual: true,
    code: 'ASSIGNED_TO_ME',
  },
  {
    id: '1',
    name: 'Open',
    icon: 'document-duplicate',
    sort_order: 4,
    is_default: false,
    is_virtual: true,
    code: 'ALL_OPEN',
  },
  {
    id: '2',
    name: 'Closed',
    icon: 'document-check',
    sort_order: 5,
    is_default: false,
    is_virtual: true,
    code: 'CLOSED',
  },

  // Real
  { id: '11', name: 'Inbox', icon: 'inbox', sort_order: 6, is_default: false, is_virtual: false },
  { id: '7', name: 'Drafts', icon: 'document', sort_order: 7, is_default: false, is_virtual: false },
  { id: '10', name: 'Outbox', icon: 'clock', sort_order: 8, is_default: false, is_virtual: false },
  { id: '3', name: 'Sent', icon: 'paper-airplane', sort_order: 9, is_default: false, is_virtual: false },
  { id: '5', name: 'Trash', icon: 'trash', sort_order: 10, is_default: false, is_virtual: false },
  { id: '4', name: 'Spam', icon: 'exclamation-triangle', sort_order: 11, is_default: false, is_virtual: false },
] as const satisfies StrictEmailFolderConfig[];

// Real-only (exact keys/ids)
export const REGULAR_FOLDERS = createRegularFolders(EMAIL_FOLDERS);

// ---------- Exposed constants ----------

// Virtual-only (exact keys/ids)
export const SPECIAL_FOLDERS = createSpecialFolders(EMAIL_FOLDERS);
export const ALL_FOLDERS: AllFoldersMap = { ...SPECIAL_FOLDERS, ...REGULAR_FOLDERS } as const;

// Useful helpers
export const ALL_FOLDER_IDS = EMAIL_FOLDERS.map((f) => f.id) as ReadonlyArray<Folder['id']>;
export const FOLDER_BY_ID = Object.freeze(Object.fromEntries(EMAIL_FOLDERS.map((f) => [f.id, f]))) as Readonly<
  Record<Folder['id'], Folder>
>;

// ---------- Attachment payload policy ----------
//
// Synced mail arrives as metadata; the bytes are fetched separately. Where that fetch is allowed
// depends on the folder, because a mailbox's junk is not something we want sitting in our storage
// account. Shared by the ingester, the download route and the attachment UI so all three agree.

/**
 * Attachments at or below this size are fetched during sync (logos, signatures, inline images), so
 * a body renders complete on first open. Anything larger waits until someone asks for it.
 */
export const EAGER_ATTACHMENT_MAX_BYTES = 256 * 1024;

/**
 * Whether an attachment's payload may EVER be fetched and stored.
 *
 * Spam is a hard no: pulling junk-folder payloads would mean storing malware in our own blob
 * container and serving it back from our own domain. The attachment row is still shown — filename,
 * type and size — so a false positive is recognisable, but the bytes stay in the provider. To get
 * the file, the user moves the message out of Spam in their mail client and it arrives on the next
 * sync, in a folder where downloading is allowed.
 */
export function allowsAttachmentDownload(folderId: string | number | null | undefined): boolean {
  return String(folderId ?? '') !== ALL_FOLDERS.SPAM;
}

/**
 * Whether small attachments in this folder are fetched eagerly during sync. Only the two folders
 * people actually work out of; Trash and Spam are metadata-only until (and unless) asked for.
 */
export function allowsEagerAttachmentFetch(folderId: string | number | null | undefined): boolean {
  const id = String(folderId ?? '');
  return id === ALL_FOLDERS.INBOX || id === ALL_FOLDERS.SENT;
}

/**
 * Whether inline images in a body may auto-load. Blocked in Spam — loading a remote or embedded
 * image in junk mail confirms to the sender that the address is live.
 */
export function allowsInlineImages(folderId: string | number | null | undefined): boolean {
  return String(folderId ?? '') !== ALL_FOLDERS.SPAM;
}
