#!/usr/bin/env node
/**
 * PostToolUse hook (Edit|Write|MultiEdit).
 *
 * Formats the file that was just written, so the working tree already matches
 * what lint-staged would produce at commit time. ~0.1s via the local prettier
 * binary. Deliberately NOT eslint: a single type-aware lint of one backend
 * file costs ~26s (same as linting the whole project), which is a commit-time
 * cost, not a per-edit one.
 *
 * Scoped to files inside the repo; prettier's own .prettierignore and
 * --ignore-unknown decide the rest. Always exits 0.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  // Only format inside the repo — never a scratchpad file or something under ~/.claude.
  if (!filePath.startsWith(`${root}/`)) return;
  if (!existsSync(filePath)) return;

  const prettier = join(root, 'node_modules', '.bin', 'prettier');
  if (!existsSync(prettier)) return;

  try {
    execFileSync(prettier, ['--write', '--ignore-unknown', filePath], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    // A syntax error prettier cannot parse is the edit's problem, not the hook's.
  }
};

await main();
