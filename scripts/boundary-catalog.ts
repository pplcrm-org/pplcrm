/**
 * Build, check and publish the catalog of published electoral boundary maps.
 *
 * This is maintainer tooling. It does not run in CI, it is not part of any application build, and
 * nothing at runtime depends on it having run — a workspace with no published map behaves exactly
 * as it did before the catalog existed.
 *
 * ## What it does
 *
 *   npm run boundary-catalog -- build [--only <slug>]
 *     Downloads each source's file, converts it to WGS84 GeoJSON, simplifies it until it satisfies
 *     the product's own caps, writes `<slug>.geojson`, and regenerates the generated catalog file
 *     that describes what it wrote.
 *
 *   npm run boundary-catalog -- validate
 *     Re-checks every built file against the caps and against the checksum the catalog records,
 *     without downloading anything. This is what to run after pulling someone else's build.
 *
 *   npm run boundary-catalog -- upload
 *     Pushes the built files to the reserved `catalog/boundaries/` storage prefix the backend reads
 *     from. Uses the same storage account and connection string the application uses.
 *
 * ## Why the conversion is not optional
 *
 * Publishers ship shapefiles drawn for cartography: projected coordinate systems, coastlines traced
 * to the metre, and a dozen census attributes per feature. The matcher needs none of that and pays
 * for all of it — every vertex of every ring is walked by the ray cast for every household on every
 * re-match. So each file is reprojected to WGS84 (the coordinate system GeoJSON and the geocoder
 * both use), stripped to a name and a code, simplified, and rounded. The caps in
 * `boundaries.schema.ts` are the acceptance test: a converted file that a workspace could not have
 * uploaded is a file this script must not publish either.
 *
 * ## Why mapshaper is run through npx rather than added as a dependency
 *
 * It is used by this one script, on a maintainer's machine, a few times a year. Installing it into
 * every developer's node_modules and every CI run to serve that would be the wrong trade. This
 * follows the same pattern `npm run azurite:start` already uses.
 */

import { BlobServiceClient } from '@azure/storage-blob';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import type { PublishedBoundaryEntry } from '../libs/common/src/lib/boundaries/catalog/catalog.types';
import {
  BOUNDARY_MAX_FEATURES_PER_SET,
  BOUNDARY_MAX_VERTICES_PER_FEATURE,
  BOUNDARY_UPLOAD_MAX_BYTES,
  countBoundaryVertices,
} from '../libs/common/src/lib/schemas/boundaries.schema';
import type { PublishedBoundarySource } from './boundary-catalog-sources';
import { PUBLISHED_BOUNDARY_SOURCES } from './boundary-catalog-sources';

const execFileAsync = promisify(execFile);

/** Where downloads and converted files live. Not committed — see .gitignore. */
const WORK_DIR = path.resolve(process.cwd(), '.boundary-catalog');
const DOWNLOAD_DIR = path.join(WORK_DIR, 'downloads');
const BUILD_DIR = path.join(WORK_DIR, 'build');

/** The generated file the application reads. */
const CATALOG_FILE = path.resolve(process.cwd(), 'libs/common/src/lib/boundaries/catalog/catalog.entries.ts');

/** The storage prefix the backend reads published files from. Mirrors the constant in @common. */
const STORAGE_PREFIX = 'catalog/boundaries';

/**
 * Simplification attempts, strongest retention first.
 *
 * Simplifying is lossy, so the script keeps as much detail as the caps allow rather than picking a
 * single aggressive setting. A national riding file usually passes at 10%; a coastline-heavy one
 * (British Columbia, Alaska) needs more. Each value is the percentage of vertices mapshaper keeps.
 */
const SIMPLIFY_STEPS = ['20%', '10%', '5%', '2%', '1%'] as const;

/** Coordinate precision of the written file: about 0.1 m, far finer than any boundary is drawn. */
const COORDINATE_PRECISION = '0.000001';

interface BuiltFile {
  source: PublishedBoundarySource;
  filePath: string;
  featureCount: number;
  bytes: number;
  sha256: string;
  simplify: string;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Download ──────────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the publisher's file, once.
 *
 * Cached by filename because these are tens of megabytes each and a build is usually re-run to
 * adjust simplification rather than to get different bytes. Delete `.boundary-catalog/downloads` to
 * force a re-fetch.
 */
async function download(source: PublishedBoundarySource): Promise<string> {
  ensureDir(DOWNLOAD_DIR);
  const extension = path.extname(new URL(source.downloadUrl).pathname) || '.zip';
  const target = path.join(DOWNLOAD_DIR, `${source.slug}${extension}`);
  if (fs.existsSync(target)) {
    log(`  cached  ${path.basename(target)}`);
    return target;
  }

  log(`  fetching ${source.downloadUrl}`);
  const response = await fetch(source.downloadUrl);
  if (!response.ok) {
    throw new Error(`${source.publisher} returned ${response.status} ${response.statusText} for ${source.downloadUrl}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, bytes);
  log(`  saved    ${path.basename(target)} (${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB)`);
  return target;
}

// ── Convert ───────────────────────────────────────────────────────────────────────────────────

/**
 * Run mapshaper once at one simplification level.
 *
 * The pipeline, in order: read whatever the publisher shipped; reproject to WGS84 because the ray
 * cast and the geocoder both work in longitude and latitude; drop every attribute except the two
 * that matter; rename them to the fixed `name` and `code` the loader expects, so nothing downstream
 * has to know what the publisher called them; simplify with `keep-shapes`, which prevents small
 * areas collapsing to nothing at aggressive settings; and write rounded coordinates.
 */
async function runMapshaper(source: PublishedBoundarySource, input: string, output: string, simplify: string) {
  const fields = [source.sourceNameProperty, source.sourceCodeProperty].filter(Boolean).join(',');
  const renames = [
    `name=${source.sourceNameProperty}`,
    source.sourceCodeProperty ? `code=${source.sourceCodeProperty}` : null,
  ]
    .filter(Boolean)
    .join(',');

  const args = [
    '--yes',
    'mapshaper',
    '-i',
    input,
    'snap',
    '-proj',
    'wgs84',
    '-filter-fields',
    fields,
    '-rename-fields',
    renames,
    '-simplify',
    simplify,
    'keep-shapes',
    '-clean',
    '-o',
    output,
    'format=geojson',
    `precision=${COORDINATE_PRECISION}`,
  ];

  // mapshaper writes its progress to stderr; only a non-zero exit is a failure.
  await execFileAsync('npx', args, { maxBuffer: 1024 * 1024 * 64 });
}

/** Every reason a converted file would be refused if a workspace had tried to upload it. */
function capViolations(featureCount: number, maxVertices: number, bytes: number): string[] {
  const problems: string[] = [];
  if (featureCount === 0) problems.push('it holds no areas at all');
  if (featureCount > BOUNDARY_MAX_FEATURES_PER_SET) {
    problems.push(`${featureCount} areas is past the cap of ${BOUNDARY_MAX_FEATURES_PER_SET}`);
  }
  if (maxVertices > BOUNDARY_MAX_VERTICES_PER_FEATURE) {
    problems.push(`one area has ${maxVertices} points, past the cap of ${BOUNDARY_MAX_VERTICES_PER_FEATURE}`);
  }
  if (bytes > BOUNDARY_UPLOAD_MAX_BYTES) {
    problems.push(
      `${(bytes / (1024 * 1024)).toFixed(1)} MB is past the cap of ${BOUNDARY_UPLOAD_MAX_BYTES / (1024 * 1024)} MB`,
    );
  }
  return problems;
}

/** Read a converted file and report the three numbers the caps are stated in. */
function measure(filePath: string): { featureCount: number; maxVertices: number; bytes: number } {
  const bytes = fs.statSync(filePath).size;
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const collection = parsed as { features?: unknown };
  if (!Array.isArray(collection.features)) {
    throw new Error(`${path.basename(filePath)} is not a GeoJSON FeatureCollection`);
  }

  let maxVertices = 0;
  for (const item of collection.features) {
    const geometry = (item as { geometry?: unknown }).geometry;
    const type = (geometry as { type?: unknown })?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
    // countBoundaryVertices walks every ring of every part, the same count the cap is stated in.
    maxVertices = Math.max(maxVertices, countBoundaryVertices(geometry as never));
  }

  return { featureCount: collection.features.length, maxVertices, bytes };
}

/**
 * Convert one source, simplifying only as much as the caps require.
 *
 * Detail is thrown away reluctantly: the first setting that satisfies every cap wins, so a small
 * provincial map keeps far more of its outline than a coastline-heavy national one.
 */
async function convert(source: PublishedBoundarySource, input: string): Promise<BuiltFile> {
  ensureDir(BUILD_DIR);
  const output = path.join(BUILD_DIR, `${source.slug}.geojson`);

  for (const simplify of SIMPLIFY_STEPS) {
    await runMapshaper(source, input, output, simplify);
    const { featureCount, maxVertices, bytes } = measure(output);
    const problems = capViolations(featureCount, maxVertices, bytes);

    if (problems.length === 0) {
      const fileBytes = fs.readFileSync(output);
      log(
        `  built    ${source.slug}.geojson at ${simplify} — ${featureCount} areas, ` +
          `${(bytes / (1024 * 1024)).toFixed(2)} MB, largest area ${maxVertices} points`,
      );
      return {
        source,
        filePath: output,
        featureCount,
        bytes,
        sha256: sha256Of(fileBytes),
        simplify,
      };
    }

    // An area-count violation is not something simplification can fix — it is a property of what
    // the publisher drew, not of how finely it is drawn. Say so instead of retrying four times.
    if (featureCount === 0 || featureCount > BOUNDARY_MAX_FEATURES_PER_SET) {
      throw new Error(`${source.slug}: ${problems.join('; ')}. Split this map or leave it out of the catalog.`);
    }
    log(`  retry    ${simplify} was not enough — ${problems.join('; ')}`);
  }

  throw new Error(
    `${source.slug}: still past the caps at the strongest simplification. ` +
      'This map needs splitting, or it does not belong in the catalog.',
  );
}

// ── The generated catalog file ────────────────────────────────────────────────────────────────

function entryFor(built: BuiltFile, supersededBy: string | null): PublishedBoundaryEntry {
  const { source } = built;
  return {
    slug: source.slug,
    label: source.label,
    jurisdiction: source.jurisdiction,
    region: source.region,
    chamber: source.chamber,
    role: source.role,
    vintage: source.vintage,
    publisher: source.publisher,
    licence: source.licence,
    attribution: source.attribution,
    sourceUrl: source.sourceUrl,
    // Always `name` and `code`: the conversion renamed the publisher's own property names, so the
    // loader never has to know what they were.
    nameProperty: 'name',
    codeProperty: source.sourceCodeProperty ? 'code' : null,
    featureCount: built.featureCount,
    bytes: built.bytes,
    sha256: built.sha256,
    supersededBy,
  };
}

function writeCatalogFile(entries: readonly PublishedBoundaryEntry[]): void {
  const body =
    entries.length === 0
      ? '[]'
      : `[\n${entries.map((entry) => `  ${JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ')},`).join('\n')}\n]`;

  const contents = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by \`npm run boundary-catalog -- build\` from \`scripts/boundary-catalog-sources.ts\`.
 * The feature count, byte size and checksum below describe files that exist; the backend verifies
 * the checksum before it will match a household against any of these boundaries, so a hand-typed
 * value does not fail quietly, it fails the whole map.
 */

import type { PublishedBoundaryEntry } from './catalog.types';

/** Every published map available to add, in the order the picker lists them within a group. */
export const PUBLISHED_BOUNDARY_ENTRIES: readonly PublishedBoundaryEntry[] = ${body};
`;

  fs.writeFileSync(CATALOG_FILE, contents, 'utf8');
  log(`\nWrote ${path.relative(process.cwd(), CATALOG_FILE)} with ${entries.length} entries.`);
}

// ── Commands ──────────────────────────────────────────────────────────────────────────────────

function selectedSources(only: string | null): readonly PublishedBoundarySource[] {
  const chosen = only ? PUBLISHED_BOUNDARY_SOURCES.filter((s) => s.slug === only) : PUBLISHED_BOUNDARY_SOURCES;
  if (only && chosen.length === 0) fail(`No source named "${only}" in scripts/boundary-catalog-sources.ts.`);

  const unverified = chosen.filter((s) => !s.licenceVerified);
  if (unverified.length > 0) {
    fail(
      'These sources have licenceVerified: false and will not be converted:\n' +
        unverified.map((s) => `  ${s.slug} — ${s.publisher}, ${s.licence}`).join('\n') +
        '\n\nRead the publisher’s licence, record it in the source entry, and set licenceVerified: true.\n' +
        'A source whose terms do not clearly permit redistribution should be deleted, not flagged.',
    );
  }
  return chosen;
}

async function build(only: string | null): Promise<void> {
  const sources = selectedSources(only);
  if (sources.length === 0) {
    fail(
      'scripts/boundary-catalog-sources.ts lists no sources, so there is nothing to build.\n' +
        'Read that file’s header: each entry needs a licence a person has read and a URL a person has opened.',
    );
  }

  const built: BuiltFile[] = [];
  for (const source of sources) {
    log(`\n${source.slug} — ${source.label}`);
    const input = await download(source);
    built.push(await convert(source, input));
  }

  // A source that supersedes another marks it, so the picker can show the older edition as replaced
  // rather than dropping it — a campaign fighting an election under the old lines still needs them.
  const replacedBy = new Map<string, string>();
  for (const { source } of built) {
    if (source.supersedes) replacedBy.set(source.supersedes, source.slug);
  }

  writeCatalogFile(built.map((b) => entryFor(b, replacedBy.get(b.source.slug) ?? null)));
  log('\nNext: npm run boundary-catalog -- upload');
}

/**
 * Re-check the built files without downloading or converting anything.
 *
 * This is the command that catches a build somebody else ran on a different mapshaper version, or a
 * file that was edited after it was generated. It compares against the generated catalog rather
 * than against the sources, because the generated catalog is what the application will trust.
 */
async function validate(): Promise<void> {
  const { PUBLISHED_BOUNDARY_ENTRIES } =
    (await import('../libs/common/src/lib/boundaries/catalog/catalog.entries')) as {
      PUBLISHED_BOUNDARY_ENTRIES: readonly PublishedBoundaryEntry[];
    };

  if (PUBLISHED_BOUNDARY_ENTRIES.length === 0) {
    log('The generated catalog is empty, so there is nothing to validate.');
    return;
  }

  let problems = 0;
  for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
    const filePath = path.join(BUILD_DIR, `${entry.slug}.geojson`);
    if (!fs.existsSync(filePath)) {
      log(`  MISSING  ${entry.slug} — run build first`);
      problems++;
      continue;
    }

    const bytes = fs.readFileSync(filePath);
    const digest = sha256Of(bytes);
    const { featureCount, maxVertices } = measure(filePath);
    const capProblems = capViolations(featureCount, maxVertices, bytes.byteLength);

    if (digest !== entry.sha256) {
      log(`  CHANGED  ${entry.slug} — checksum does not match the catalog; the file was edited or rebuilt`);
      problems++;
    } else if (featureCount !== entry.featureCount) {
      log(`  COUNT    ${entry.slug} — file holds ${featureCount} areas, catalog says ${entry.featureCount}`);
      problems++;
    } else if (capProblems.length > 0) {
      log(`  CAPS     ${entry.slug} — ${capProblems.join('; ')}`);
      problems++;
    } else {
      log(`  ok       ${entry.slug} — ${featureCount} areas, ${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB`);
    }
  }

  if (problems > 0) fail(`\n${problems} of ${PUBLISHED_BOUNDARY_ENTRIES.length} files did not check out.`);
  log(`\nAll ${PUBLISHED_BOUNDARY_ENTRIES.length} files match the catalog.`);
}

/** Push the built files to the storage prefix the backend reads them from. */
async function upload(): Promise<void> {
  const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];
  if (!connectionString) {
    fail('AZURE_STORAGE_CONNECTION_STRING is not set. Point it at the account the backend reads.');
  }
  const containerName = process.env['AZURE_STORAGE_CONTAINER'] ?? 'uploads';

  const { PUBLISHED_BOUNDARY_ENTRIES } =
    (await import('../libs/common/src/lib/boundaries/catalog/catalog.entries')) as {
      PUBLISHED_BOUNDARY_ENTRIES: readonly PublishedBoundaryEntry[];
    };

  if (PUBLISHED_BOUNDARY_ENTRIES.length === 0) {
    log('The generated catalog is empty, so there is nothing to upload.');
    return;
  }

  const container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
  await container.createIfNotExists();

  for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
    const filePath = path.join(BUILD_DIR, `${entry.slug}.geojson`);
    if (!fs.existsSync(filePath)) fail(`${entry.slug}.geojson is not built. Run build first.`);

    const bytes = fs.readFileSync(filePath);
    // Refuse to publish bytes the catalog does not describe: the backend will reject them on
    // download anyway, and a mismatch found here names the file instead of a runtime log line.
    const digest = sha256Of(bytes);
    if (digest !== entry.sha256) fail(`${entry.slug}.geojson does not match its catalog checksum. Rebuild it.`);

    const key = `${STORAGE_PREFIX}/${entry.slug}.geojson`;
    await container.getBlockBlobClient(key).upload(bytes, bytes.length, {
      blobHTTPHeaders: { blobContentType: 'application/geo+json' },
    });
    log(`  uploaded ${key}`);
  }

  log(`\nUploaded ${PUBLISHED_BOUNDARY_ENTRIES.length} files to ${containerName}/${STORAGE_PREFIX}.`);
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const onlyIndex = rest.indexOf('--only');
  const only = onlyIndex >= 0 ? (rest[onlyIndex + 1] ?? null) : null;

  switch (command) {
    case 'build':
      await build(only);
      break;
    case 'validate':
      await validate();
      break;
    case 'upload':
      await upload();
      break;
    default:
      fail('Usage: npm run boundary-catalog -- <build [--only <slug>] | validate | upload>');
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
