import { BadRequestError } from '../errors/app-errors';

/**
 * What a tenant may upload to the files library (finding M11).
 *
 * There was no extension, MIME, or magic-byte check anywhere in the upload path: the
 * client declared a `mimeType`, it was stored verbatim, and the download route echoed it
 * straight back as the response `Content-Type`. `Content-Disposition: attachment` stops
 * the browser rendering it inline, so this was never a stored-XSS hole — but it did leave
 * the platform working as a general-purpose file host on its own domain, which is what
 * malware distribution and phishing-kit hosting look for.
 *
 * An allow-list, not a deny-list: the set of dangerous types is open-ended, the set of
 * things a campaign CRM legitimately stores is not. Attachments in the CRM's own mailbox
 * sync are exempt — those arrive from a mail provider, not from a tenant's uploader.
 */

/** MIME types accepted on tenant uploads, grouped by why they are here. */
const ALLOWED_MIME_TYPES = new Set<string>([
  // Images — logos, photos, newsletter assets
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/heic',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  // Data — imports, exports, list files
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/json',
  // Archives — bulk photo/document drops
  'application/zip',
  'application/x-zip-compressed',
  // Media — canvass/event recordings
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

/**
 * Extensions refused regardless of declared type. Belt-and-braces: an executable served
 * as `text/plain` is still an executable once it reaches disk, and the filename is what a
 * recipient double-clicks.
 */
const BLOCKED_EXTENSIONS = new Set<string>([
  'exe',
  'dll',
  'scr',
  'com',
  'pif',
  'bat',
  'cmd',
  'sh',
  'bash',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'jar',
  'msi',
  'msp',
  'app',
  'apk',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'lnk',
  'hta',
  'reg',
  'wsf',
  'gadget',
  'html',
  'htm',
  'xhtml',
  'svgz',
  'php',
  'phtml',
  'asp',
  'aspx',
  'jsp',
  'cgi',
]);

/** The lower-cased extension of a filename, or '' when it has none. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : '';
}

/** The MIME type to store: the client's, if it is allowed, else a safe generic one. */
export function safeMimeType(declared: string | null | undefined): string {
  const value = (declared ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED_MIME_TYPES.has(value) ? value : 'application/octet-stream';
}

/**
 * Reject an upload whose filename or declared type is not something a CRM stores.
 *
 * Throws BadRequestError with a message safe to show the user.
 */
export function assertUploadAllowed(filename: string, declaredMimeType?: string | null): void {
  const ext = extensionOf(filename);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new BadRequestError(`Files of type .${ext} cannot be uploaded.`);
  }

  const mime = (declaredMimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  // An absent type is fine — the extension check above already ran, and browsers omit it
  // for unusual formats. A type that is present must be one we recognise.
  if (mime && !ALLOWED_MIME_TYPES.has(mime)) {
    throw new BadRequestError('That file type is not supported.');
  }
}
