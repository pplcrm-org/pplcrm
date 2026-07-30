#!/usr/bin/env node
/**
 * PostToolUse hook (Edit|Write|MultiEdit).
 *
 * CLAUDE.md has several "keep in sync" obligations that nothing enforces: change
 * a number the marketing site quotes, ship a feature without a Help Center
 * article, add a notification key that only lands in half its six files. None of
 * them fail a build, so they rot silently.
 *
 * CLAUDE.md §0 deliberately stopped restating the skill index (a second copy
 * only goes stale), which means nothing keeps these rules resident either. This
 * hook is the cheap replacement: zero context cost until someone touches one of
 * the paths below, then one line naming the obligation and the skill.
 *
 * Always exits 0, and is advisory only — it never blocks an edit.
 */

const RULES = [
  {
    match: (p) => p === 'libs/common/src/lib/billing/plans.ts',
    say: "Plan pricing, caps, and feature gates are quoted verbatim on the marketing site. If you changed a fact the site states, update the apps/website copy in this same change and bump the affected legal document's `updated:` date. Registry: the pplcrm-website-claims skill.",
  },
  {
    match: (p) =>
      /^apps\/backend\/src\/app\/modules\/(newsletters\/(send-guards|preflight\.service)|billing\/plan-gate)\.ts$/.test(
        p,
      ),
    say: 'Send caps, tripwire thresholds, preflight bands, and plan gates are all stated on the marketing site and documented in the pplcrm-sending-guards skill. Changing a number here means updating both.',
  },
  {
    match: (p) => p === 'apps/backend/src/app/lib/jobs/handlers/maintenance.handlers.ts',
    say: 'Retention and backup windows are stated as exact numbers on the marketing site and in the legal documents — see the pplcrm-website-claims skill before changing one.',
  },
  {
    match: (p) => p === 'libs/common/src/lib/schemas/auth.schema.ts',
    say: 'If you touched NotificationPreferencesObj: a new key must also land in sanitizeUser defaults, BOTH settings UIs, and the spec count. Full checklist in the pplcrm-notifications skill.',
  },
  {
    match: (p, tool) => tool === 'Write' && p.startsWith('apps/frontend/src/app/experiences/'),
    say: 'New user-facing surface: add or update the Help Center article in libs/common/src/lib/help/articles/*.ts in this same change (CLAUDE.md §4), then run `npx nx test common`. UI doctrine: the pplcrm-design-principles skill.',
  },
  {
    match: (p) => /^libs\/common\/src\/lib\/help\/articles\/[^/]+\.ts$/.test(p),
    say: 'Run `npx nx test common` — the help-content spec catches broken slugs and links, though not stale prose, so re-read what you changed.',
  },
  {
    match: (p) => /^apps\/backend\/src\/app\/_migrations\/.+\.ts$/.test(p),
    say: 'Migrations are forward-only: never edit one that has been applied, and schema.sql stays the baseline. See the pplcrm-migrations skill.',
  },
];

const readStdin = () =>
  new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => resolve(raw));
  });

const main = async () => {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }

  const filePath = payload?.tool_response?.filePath ?? payload?.tool_input?.file_path;
  if (typeof filePath !== 'string' || filePath.length === 0) return;

  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const relative = filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
  const tool = payload?.tool_name ?? '';

  const hits = RULES.filter((rule) => rule.match(relative, tool)).map((rule) => rule.say);
  if (hits.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Keep-in-sync obligations for ${relative}:\n${hits.map((h) => `- ${h}`).join('\n')}`,
      },
    }),
  );
};

await main();
