// A NUL byte (0x00) in a source file makes grep, ripgrep, and git grep classify the
// file as binary and silently skip it — the file becomes invisible to every grep-based
// tool and CI check. This already hid auth middleware from a security review, so this
// spec asserts no source file under apps/*/src or libs/*/src contains a 0x00 byte.
// Represent NUL in a string literal as the escape '\u0000' instead.
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nx', 'coverage']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.html', '.css'];

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Collect every source file under `dir`, pruning skipped directories before descending. */
function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(join(dir, entry.name), out);
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

/** Every source file under the `src` directory of every project in apps/ and libs/. */
function allSourceFiles(): string[] {
  const files: string[] = [];
  for (const group of ['apps', 'libs']) {
    const groupDir = join(REPO_ROOT, group);
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const srcDir = join(groupDir, entry.name, 'src');
      try {
        collectSourceFiles(srcDir, files);
      } catch {
        // No src/ directory in this project — nothing to scan.
      }
    }
  }
  return files;
}

describe('source hygiene', () => {
  it('no source file contains a NUL (0x00) byte', () => {
    const files = allSourceFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => readFileSync(file).includes(0));
    expect(offenders).toEqual([]);
  });
});
