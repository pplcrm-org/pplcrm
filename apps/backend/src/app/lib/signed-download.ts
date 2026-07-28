import { createSigner, createVerifier } from 'fast-jwt';
import { env } from '../../env';
import { UnauthorizedError } from '../errors/app-errors';

const DOWNLOAD_SCOPE = 'file-download';
const EMAIL_ATTACHMENT_SCOPE = 'email-attachment';
const UPLOAD_SCOPE = 'file-upload';
// Long enough that cached user lists keep rendering avatars, short enough
// that a URL leaked from history or logs goes stale quickly.
const DOWNLOAD_URL_TTL = '24h';
// Matches the write-SAS lifetime in StorageService.generateWriteSasUrl — once the
// SAS is dead the handle is useless anyway.
const UPLOAD_HANDLE_TTL = '15m';

interface SignedDownloadPayload {
  scope: typeof DOWNLOAD_SCOPE;
  file_id: string;
  tenant_id: string;
}

interface SignedEmailAttachmentPayload {
  scope: typeof EMAIL_ATTACHMENT_SCOPE;
  email_id: string;
  tenant_id: string;
}

interface SignedUploadPayload {
  scope: typeof UPLOAD_SCOPE;
  storage_key: string;
  tenant_id: string;
}

const signer = createSigner({ algorithm: 'HS256', key: env.sharedSecret, expiresIn: DOWNLOAD_URL_TTL });
const verifier = createVerifier({ algorithms: ['HS256'], key: env.sharedSecret, ignoreExpiration: false });
const uploadSigner = createSigner({ algorithm: 'HS256', key: env.sharedSecret, expiresIn: UPLOAD_HANDLE_TTL });

/**
 * Mint an opaque handle for a storage key the server just derived, to be handed
 * back on `files.registerFile`.
 *
 * SECURITY: the client must never supply a storage key directly. `registerFile`
 * scopes the DB row it creates by tenant, but the *blob* it points at is whatever
 * key the row carries — so accepting a client key let any tenant register (and
 * then download or delete) another tenant's blob. Round-tripping a signed handle
 * keeps the key server-derived end to end, and the signature makes the tenant
 * binding structural rather than a validation a later refactor can drop.
 */
export function signUploadHandle(storageKey: string, tenantId: string): string {
  return uploadSigner({ scope: UPLOAD_SCOPE, storage_key: String(storageKey), tenant_id: String(tenantId) });
}

/**
 * Verify an upload handle and return the storage key it was minted for. Throws
 * UnauthorizedError unless the handle is intact, unexpired, and bound to this tenant.
 */
export function verifyUploadHandle(handle: string, tenantId: string): string {
  let payload: unknown;
  try {
    payload = verifier(handle);
  } catch (err) {
    throw new UnauthorizedError('Unauthorized: Invalid or expired upload handle', undefined, { cause: err });
  }
  const parsed = payload as Partial<SignedUploadPayload> | null;
  if (
    !parsed ||
    parsed.scope !== UPLOAD_SCOPE ||
    !parsed.storage_key ||
    String(parsed.tenant_id) !== String(tenantId)
  ) {
    throw new UnauthorizedError('Unauthorized: Invalid upload handle');
  }
  return String(parsed.storage_key);
}

/**
 * Build a relative download URL carrying a short-lived token scoped to a
 * single file. Safe to embed in <img> tags: unlike a session JWT it cannot
 * be replayed against other endpoints and it expires quickly.
 */
export function signedFileDownloadUrl(fileId: string, tenantId: string): string {
  const st = signer({ scope: DOWNLOAD_SCOPE, file_id: String(fileId), tenant_id: String(tenantId) });
  return `/api/files/download/${fileId}?st=${encodeURIComponent(st)}`;
}

/**
 * Verify a signed download token and confirm it was minted for the file
 * being requested. Throws UnauthorizedError on any mismatch.
 */
export function verifyFileDownloadToken(st: string, fileId: string): SignedDownloadPayload {
  let payload: unknown;
  try {
    payload = verifier(st);
  } catch (err) {
    throw new UnauthorizedError('Unauthorized: Invalid or expired download token', undefined, { cause: err });
  }
  const parsed = payload as Partial<SignedDownloadPayload> | null;
  if (!parsed || parsed.scope !== DOWNLOAD_SCOPE || !parsed.tenant_id || String(parsed.file_id) !== String(fileId)) {
    throw new UnauthorizedError('Unauthorized: Invalid download token');
  }
  return parsed as SignedDownloadPayload;
}

/**
 * Build a relative URL for an email attachment carrying a short-lived token
 * scoped to that one email + tenant. Safe to embed in a link/`<img>`: unlike a
 * session JWT it can't be replayed against other endpoints and expires quickly.
 */
export function signedEmailAttachmentUrl(emailId: string, attachmentId: string, tenantId: string): string {
  const st = signer({ scope: EMAIL_ATTACHMENT_SCOPE, email_id: String(emailId), tenant_id: String(tenantId) });
  return `/api/emails/${emailId}/attachments/${attachmentId}?st=${encodeURIComponent(st)}`;
}

/** As {@link signedEmailAttachmentUrl}, but for an inline (cid) attachment reference. */
export function signedEmailInlineUrl(emailId: string, cid: string, tenantId: string): string {
  const st = signer({ scope: EMAIL_ATTACHMENT_SCOPE, email_id: String(emailId), tenant_id: String(tenantId) });
  return `/api/emails/${emailId}/attachments/cid/${encodeURIComponent(cid)}?st=${encodeURIComponent(st)}`;
}

/**
 * Verify an email-attachment token and confirm it was minted for the email being
 * requested. Throws UnauthorizedError on any mismatch. The specific attachment /
 * cid is then resolved by the route, tenant-scoped, from this token's tenant_id.
 */
export function verifyEmailAttachmentToken(st: string, emailId: string): SignedEmailAttachmentPayload {
  let payload: unknown;
  try {
    payload = verifier(st);
  } catch (err) {
    throw new UnauthorizedError('Unauthorized: Invalid or expired download token', undefined, { cause: err });
  }
  const parsed = payload as Partial<SignedEmailAttachmentPayload> | null;
  if (
    !parsed ||
    parsed.scope !== EMAIL_ATTACHMENT_SCOPE ||
    !parsed.tenant_id ||
    String(parsed.email_id) !== String(emailId)
  ) {
    throw new UnauthorizedError('Unauthorized: Invalid download token');
  }
  return parsed as SignedEmailAttachmentPayload;
}
