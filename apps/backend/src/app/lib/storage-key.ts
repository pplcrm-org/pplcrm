// Helpers for building blob storage keys from user-supplied filenames.
//
// A storage key is a path. The uploader's filename is interpolated into it, so it
// must never be able to introduce path structure of its own: `../` would climb out
// of the tenant prefix that scopes the key, and a leading `/` would reset it.

/** Longest filename we accept — comfortably past any real one, short of abuse. */
export const MAX_FILENAME_LENGTH = 255;
/** Longest client-declared MIME type we store. */
export const MAX_MIME_TYPE_LENGTH = 255;
/** Longest entity_type / entity_id association string. */
export const MAX_ENTITY_REF_LENGTH = 128;

const FALLBACK_FILENAME = 'file';

/**
 * Key prefixes that hold product data rather than a workspace's own files.
 *
 * Everything a workspace uploads is keyed `uploads/<tenant_id>/…`, built in the files router and
 * signed into an upload handle that is verified against the caller's tenant, so a client cannot
 * choose its own key. These prefixes are the other side of that: they are written by maintainer
 * tooling, they are shared by every workspace, and nothing tenant-owned may ever live under them.
 *
 * `catalog/boundaries` holds the published electoral boundary files that back a `bundled` boundary
 * set — one GeoJSON per catalog entry, uploaded by `tools/boundary-catalog` and read by
 * `lib/gis/boundary-store.ts`. They are shared reference data, identical for every workspace that
 * adds the same map, so keying them per tenant would store the same national file hundreds of times.
 */
export const RESERVED_STORAGE_PREFIXES = ['catalog/'] as const;

/**
 * True when a key belongs to shared product data rather than to a workspace.
 *
 * Used to keep the two spaces from touching: a tenant-scoped delete or listing must never act on a
 * reserved key, and a reserved read must never be satisfied by a tenant key.
 */
export function isReservedStorageKey(key: string): boolean {
  return RESERVED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Reduce a filename to a single safe path component.
 *
 * Strips directory separators and traversal, drops control characters, and collapses
 * anything else outside a conservative allow-list to `_`. The result is never empty
 * and never begins with a dot (so it cannot produce a hidden or extension-only key).
 */
export function sanitizeFilename(filename: string): string {
  const base = (filename ?? '')
    // Take the last path component under either separator, so `../../etc/passwd`
    // and `C:\evil\x.txt` both reduce to their trailing name.
    .split(/[/\\]/)
    .pop()
    ?.trim();

  if (!base) return FALLBACK_FILENAME;

  const cleaned = base
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_FILENAME_LENGTH);

  return cleaned || FALLBACK_FILENAME;
}
