import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * The payloads behind the demo inbox's attachments.
 *
 * These are BUILT, not bundled: every byte is generated here, so there are no binary
 * fixtures in the repo and nothing to keep in sync with a checked-in file. Formats are
 * limited to ones that are trivially valid when assembled by hand (CSV, iCalendar) plus
 * a real PNG encoded below — a demo that ships a subtly malformed PDF is worse than a
 * demo with no attachment at all.
 *
 * Payloads are deliberately small (all well under a kilobyte). They exist to make the
 * attachment chips, the download path and the storage plumbing real in a fresh
 * workspace, not to be interesting documents.
 */
export interface DemoAttachmentAsset {
  filename: string;
  content_type: string;
  /**
   * Built on demand rather than held as a module-level constant: these are needed once,
   * during signup seeding, and there is no reason to keep them resident for the life of
   * the process.
   */
  build(): Buffer;
}

// ── PNG encoding ────────────────────────────────────────────────────────────
// A minimal truecolor (8-bit RGB, non-interlaced) encoder. Enough for a flat
// placeholder image; not a general-purpose one.

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    // The index is masked to 0..255 and the table has exactly 256 entries, so the
    // lookup is total; the `?? 0` only satisfies noUncheckedIndexedAccess.
    const entry = CRC_TABLE[(c ^ byte) & 0xff] ?? 0;
    c = entry ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A flat image with a one-pixel border, vertically shaded so it reads as a photo
 * placeholder rather than a rendering failure.
 */
function buildPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const [r, g, b] = rgb;
  // Each scanline is a filter byte (0 = None) followed by RGB triples.
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    // Darken towards the bottom by up to 20%.
    const shade = 1 - (y / height) * 0.2;
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      raw[offset++] = edge ? 0x33 : Math.round(r * shade);
      raw[offset++] = edge ? 0x3a : Math.round(g * shade);
      raw[offset++] = edge ? 0x44 : Math.round(b * shade);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolor
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Text payloads ───────────────────────────────────────────────────────────

const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(',')).join('\r\n') + '\r\n', 'utf8');

/**
 * A single-event iCalendar file. Dates are fixed literals, not computed from `now`:
 * a demo attachment is opened rarely and re-generating it per signup would make the
 * bytes (and therefore the sha256 dedupe key) differ for no benefit.
 */
const ics = (uid: string, summary: string, location: string, start: string, end: string): Buffer =>
  Buffer.from(
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//pplCRM//Demo//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${start}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${summary}`,
      `LOCATION:${location}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n'),
    'utf8',
  );

export const DEMO_ATTACHMENT_ASSETS = {
  // Campaign workspace.
  'porch-sign-spot': {
    filename: 'porch-sign-spot.png',
    content_type: 'image/png',
    build: () => buildPng(320, 200, [0x8c, 0xa9, 0x7d]),
  },
  'meet-and-greet-hold': {
    filename: 'meet-and-greet-hold.ics',
    content_type: 'text/calendar',
    build: () =>
      ics(
        'demo-meet-and-greet@pplcrm.example',
        'Meet-and-greet (hold)',
        'Bytown Coffee Roasters',
        '20260226T230000Z',
        '20260227T010000Z',
      ),
  },
  'westboro-circulation': {
    filename: 'westboro-circulation.csv',
    content_type: 'text/csv',
    build: () =>
      csv([
        ['month', 'households', 'opens', 'clicks'],
        ['November', '902', '431', '58'],
        ['December', '910', '470', '77'],
        ['January', '918', '444', '61'],
      ]),
  },

  // Constituency office workspace.
  'sidewalk-hazard': {
    filename: 'sidewalk-hazard.png',
    content_type: 'image/png',
    build: () => buildPng(320, 240, [0x9a, 0x9d, 0xa0]),
  },
  'office-hours-hold': {
    filename: 'office-hours-hold.ics',
    content_type: 'text/calendar',
    build: () =>
      ics(
        'demo-office-hours@pplcrm.example',
        'Mobile office hours (hold)',
        'Bytown Coffee Roasters',
        '20260226T230000Z',
        '20260227T010000Z',
      ),
  },

  // Nonprofit workspace.
  'hamper-referrals': {
    filename: 'hamper-referrals.csv',
    content_type: 'text/csv',
    build: () =>
      csv([
        ['household', 'adults', 'children', 'note'],
        ['Seniors (1)', '1', '0', 'Mobility — needs delivery'],
        ['Seniors (2)', '1', '0', 'Mobility — needs delivery'],
        ['Family', '2', '3', 'Has runway to next week'],
        ['Couple', '2', '1', 'Newborn — formula needed'],
      ]),
  },
  'surplus-pallet': {
    filename: 'surplus-pallet.png',
    content_type: 'image/png',
    build: () => buildPng(320, 240, [0xc9, 0x8b, 0x4e]),
  },
  'service-hours-form': {
    filename: 'service-hours-form.png',
    content_type: 'image/png',
    build: () => buildPng(300, 388, [0xe8, 0xe6, 0xdf]),
  },
} satisfies Record<string, DemoAttachmentAsset>;

export type DemoAttachmentKey = keyof typeof DEMO_ATTACHMENT_ASSETS;

/**
 * Narrows a string read back from the database (`email_attachments.remote_ref`) to a known
 * asset. A workspace seeded before an asset was renamed still holds the old key, and the
 * honest answer there is "leave it unmaterialized", not "throw" or "guess".
 */
export function isDemoAttachmentKey(key: string): key is DemoAttachmentKey {
  return Object.prototype.hasOwnProperty.call(DEMO_ATTACHMENT_ASSETS, key);
}

/** Payload plus the fields the `files` row needs, built once per asset per seed. */
export interface BuiltDemoAttachment {
  filename: string;
  content_type: string;
  bytes: Buffer;
  size_bytes: number;
  sha256_hex: string;
}

export function buildDemoAttachment(key: DemoAttachmentKey): BuiltDemoAttachment {
  const asset = DEMO_ATTACHMENT_ASSETS[key];
  const bytes = asset.build();
  return {
    filename: asset.filename,
    content_type: asset.content_type,
    bytes,
    size_bytes: bytes.length,
    sha256_hex: createHash('sha256').update(bytes).digest('hex'),
  };
}
