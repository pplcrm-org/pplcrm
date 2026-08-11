/**
 * Build-time generator for the machine-facing help surface.
 *
 * Emits static, agent-friendly artifacts derived entirely from the shared
 * `@common` help library so they can never drift from the in-app content:
 *
 *   - `docs/<id>.md`  one raw Markdown file per help article (with a small
 *                     frontmatter header pointing at the canonical HTML URL)
 *   - `llms.txt`      the llms.txt manifest (https://llmstxt.org/)
 *   - `sitemap.xml`   marketing pages + every docs page (HTML URLs)
 *   - `robots.txt`    allow-all + sitemap reference
 *
 * Files are written into `apps/website/src/generated/`, which `project.json`'s
 * `assets` array copies to the built bundle root. The `generate-docs` nx target
 * runs this before `build` (via `build.dependsOn`), so a plain
 * `nx build website` always produces fresh output — no manual step.
 *
 * Run with: tsx --tsconfig tsconfig.base.json apps/website/tools/generate-help-static.ts
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';

import type { HelpArticle } from '@common';
import { HELP_ARTICLES, HELP_CATEGORIES, articleToMarkdown } from '@common';

import { AUDIENCE_CONTENT } from '../src/app/home/audience-content';

/**
 * The marketing site's own public origin, used to build absolute URLs.
 * Keep in sync with `apps/website/src/environments/environment.prod.ts`
 * (`siteUrl`). Overridable at build time via `WEBSITE_SITE_URL` for previews.
 */
const SITE_URL: string = (process.env['WEBSITE_SITE_URL'] ?? 'https://pplcrm.com').replace(/\/+$/, '');

/**
 * Concrete static marketing routes to include in the sitemap. Mirrors the
 * real `path`s in `apps/website/src/app/app.routes.ts`, intentionally skipping
 * the `soon` stub and the `**` wildcard. `/docs` and `/docs/<id>` are added
 * separately from the article list.
 */
const MARKETING_PATHS: readonly string[] = [
  '',
  'faq',
  'for/offices',
  'for/campaigns',
  'for/nonprofits',
  'for/churches',
  'compare',
  'canvassing',
  'deliveries',
  'districts',
  'switch',
  'switch/breeze',
  'switch/planning-center',
  'switch/nationbuilder',
  'switch/mailchimp',
  'use-cases',
  'use-cases/federal-campaign',
  'use-cases/provincial-campaign',
  'use-cases/municipal-campaign',
  'use-cases/constituency-office',
  'use-cases/advocacy',
  'use-cases/nonprofit',
  'pricing',
  'about',
  'careers',
  'data-ownership',
  'privacy',
  'eula',
  'security',
];

const scriptDir: string = dirname(fileURLToPath(import.meta.url));
const SRC_DIR: string = resolve(scriptDir, '../src');
const OUT_DIR: string = resolve(scriptDir, '../src/generated');
const DOCS_DIR: string = join(OUT_DIR, 'docs');

/** Escape the five XML special characters for use in text/attribute nodes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Quote a string for a YAML frontmatter scalar. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The canonical human-facing HTML URL for an article. */
function articleHtmlUrl(article: HelpArticle): string {
  return `${SITE_URL}/docs/${article.id}`;
}

/** Build one article's `.md` body: frontmatter header + raw article Markdown. */
function articleMarkdownFile(article: HelpArticle): string {
  const keywords: string = article.keywords.map((k: string): string => yamlString(k)).join(', ');
  const frontmatter: string = [
    '---',
    `title: ${yamlString(article.title)}`,
    `canonical_url: ${articleHtmlUrl(article)}`,
    `category: ${article.category}`,
    `keywords: [${keywords}]`,
    'generated: true',
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${articleToMarkdown(article)}\n`;
}

/** Build the llms.txt manifest, grouped by category in `HELP_CATEGORIES` order. */
function buildLlmsTxt(): string {
  const lines: string[] = [
    '# pplCRM',
    '',
    '> pplCRM is a CRM for constituency offices, campaigns, non-profits, and churches — one list ' +
      'for constituents, voters, donors, members, and volunteers, with newsletters, canvassing, ' +
      'deliveries, events, donations, and forms built in.',
    '',
    '## Docs',
    '',
  ];

  for (const category of HELP_CATEGORIES) {
    const articles: HelpArticle[] = HELP_ARTICLES.filter(
      (article: HelpArticle): boolean => article.category === category.id,
    );
    if (articles.length === 0) {
      continue;
    }
    lines.push(`### ${category.label}`, '');
    for (const article of articles) {
      lines.push(`- [${article.title}](${SITE_URL}/docs/${article.id}.md): ${article.summary}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Date this build ran (YYYY-MM-DD), used as the sitemap `<lastmod>`. */
const BUILD_DATE: string = new Date().toISOString().slice(0, 10);

/** Per-page crawl hints. Home ranks highest; legal/company pages lowest. */
function sitemapHints(path: string): { changefreq: string; priority: string } {
  if (path === '') return { changefreq: 'weekly', priority: '1.0' };
  if (path === 'pricing') return { changefreq: 'weekly', priority: '0.9' };
  if (
    path === 'faq' ||
    path === 'compare' ||
    path === 'canvassing' ||
    path === 'deliveries' ||
    path === 'districts' ||
    path.startsWith('for/') ||
    path === 'switch' ||
    path.startsWith('switch/') ||
    path === 'use-cases' ||
    path.startsWith('use-cases/')
  ) {
    return { changefreq: 'monthly', priority: '0.8' };
  }
  if (path === 'docs' || path.startsWith('docs/')) return { changefreq: 'monthly', priority: '0.6' };
  if (path === 'privacy' || path === 'eula' || path === 'security') {
    return { changefreq: 'yearly', priority: '0.3' };
  }
  return { changefreq: 'monthly', priority: '0.5' };
}

/** Build a valid urlset sitemap of marketing pages + all docs pages (HTML). */
function buildSitemap(): string {
  const paths: string[] = [
    ...MARKETING_PATHS,
    'docs',
    ...HELP_ARTICLES.map((article: HelpArticle): string => `docs/${article.id}`),
  ];
  const urls: string = paths
    .map((path: string): string => {
      const loc: string = path === '' ? `${SITE_URL}/` : `${SITE_URL}/${path}`;
      const { changefreq, priority } = sitemapHints(path);
      return (
        `  <url>\n    <loc>${escapeXml(loc)}</loc>\n` +
        `    <lastmod>${BUILD_DATE}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n  </url>`
      );
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Build robots.txt: allow all, point at the sitemap, hint agents at llms.txt. */
function buildRobotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# AI agents: a machine-readable index of the docs lives at /llms.txt',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Every audience hero must have its screenshot on disk.
 *
 * There is no mock fallback any more (the old <pc-app-preview> was deleted once every hero had a
 * real shot), so a missing or renamed file renders as a broken image on a landing page — and the
 * website has no tests to catch it. Failing the build is the cheap substitute.
 */
async function assertHeroAssets(): Promise<void> {
  const missing: string[] = [];
  const placeholders: string[] = [];
  for (const [audience, copy] of Object.entries(AUDIENCE_CONTENT)) {
    const path = resolve(SRC_DIR, copy.hero.img);
    try {
      await access(path);
    } catch {
      missing.push(`${audience} → ${copy.hero.img}`);
      continue;
    }
    if (copy.hero.imgIsPlaceholder) {
      placeholders.push(`${audience} → ${copy.hero.img}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing hero screenshot(s):\n  ${missing.join('\n  ')}\n` +
        'Capture the shot from a workspace in that organization mode and commit it to ' +
        'apps/website/src/assets/site-shots/.',
    );
  }
  // A borrowed shot passes the existence check, so say so loudly on every build rather than
  // letting a landing page ship showing another audience's product.
  if (placeholders.length > 0) {
    console.warn(
      `[generate-help-static] WARNING — placeholder hero screenshot(s), NOT FIT TO SHIP:\n  ${placeholders.join(
        '\n  ',
      )}\nClear the imgIsPlaceholder flag once the real shot is committed.`,
    );
  }
}

async function main(): Promise<void> {
  await assertHeroAssets();

  // Rebuild from scratch so removed articles don't leave stale .md files.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(DOCS_DIR, { recursive: true });

  await Promise.all(
    HELP_ARTICLES.map(
      (article: HelpArticle): Promise<void> =>
        writeFile(join(DOCS_DIR, `${article.id}.md`), articleMarkdownFile(article), 'utf8'),
    ),
  );

  await Promise.all([
    writeFile(join(OUT_DIR, 'llms.txt'), buildLlmsTxt(), 'utf8'),
    writeFile(join(OUT_DIR, 'sitemap.xml'), buildSitemap(), 'utf8'),
    writeFile(join(OUT_DIR, 'robots.txt'), buildRobotsTxt(), 'utf8'),
  ]);

  const marketingCount: number = MARKETING_PATHS.length + 1; // + /docs
  console.warn(
    `[generate-help-static] wrote ${HELP_ARTICLES.length} docs/*.md, llms.txt, robots.txt, ` +
      `and sitemap.xml (${marketingCount + HELP_ARTICLES.length} URLs) to ${OUT_DIR}`,
  );
}

main().catch((error: unknown): void => {
  console.error(error);
  process.exitCode = 1;
});
