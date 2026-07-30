#!/usr/bin/env node
/**
 * PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit).
 *
 * Refuses hand-edits to generated artefacts and names the procedure that
 * regenerates them. CLAUDE.md says "never hand-edit" for each of these; a
 * rule an agent has to remember is weaker than one it cannot violate.
 *
 * Reads the hook payload on stdin, prints a deny decision on stdout, and
 * always exits 0 — an exit code here would read as a hook crash, not a block.
 */

const PROTECTED = [
  {
    match: (p) => /^apps\/(backend|frontend|libs)\/STRUCTURE\.md$/.test(p),
    reason:
      'STRUCTURE.md is a generated repomix codebase map, not a hand-written doc. Backend/frontend regenerate as a `build` dependency; refresh all three with `npm run context:all` (or `npm run context:backend` / `context:frontend` / `context:libs`). If the map looks wrong, the fix is in the source tree it summarises.',
  },
  {
    match: (p) => p === 'apps/backend/src/app/_migrations/schema.sql',
    reason:
      'schema.sql is the `pg_dump --schema-only` baseline that 0001_baseline.ts executes on a fresh database. An ordinary schema change goes in a NEW apps/backend/src/app/_migrations/YYYY-MM-DD-description.ts. Regenerating this file is a deliberate pre-ship re-squash (regenerate the dump, delete the dated migrations, reset kysely_migration, verify a from-scratch build) — read the pplcrm-migrations skill first and say so explicitly.',
  },
  {
    match: (p) => p === 'apps/backend/src/app/_migrations/0001_baseline.ts',
    reason:
      '0001_baseline.ts is an applied migration — migrations are forward-only history. Add a new timestamped migration instead. See the pplcrm-migrations skill.',
  },
  {
    match: (p) => p.startsWith('apps/website/src/generated/'),
    reason:
      'apps/website/src/generated is tsx codegen output, rebuilt as a `build` dependency. Edit the source instead: help content lives in libs/common/src/lib/help/articles/*.ts.',
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
    return; // Unparseable payload: stay out of the way rather than block the edit.
  }

  const filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
  if (typeof filePath !== 'string' || filePath.length === 0) return;

  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const relative = filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;

  const hit = PROTECTED.find((rule) => rule.match(relative));
  if (!hit) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${relative} is generated. ${hit.reason}`,
      },
    }),
  );
};

await main();
