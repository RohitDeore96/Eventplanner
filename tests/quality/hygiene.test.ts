import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Project hygiene gate (comparable to the leading competitor's): the conventions that
 * keep the codebase auditable are enforced BY A TEST, so drift fails CI the same way a
 * broken unit test does. Complements — never duplicates — the ESLint plugins (Rules of
 * Hooks, jsx-a11y), dependency-cruiser (layering), knip (dead code) and prettier (style).
 *
 * Enforced here:
 *  1. Required project and contributor documentation exists.
 *  2. Source files in src/ and api/ stay at 250 lines or fewer.
 *  3. No explicit `any`, no unsafe TypeScript suppressions.
 *  4. No HTML injection sinks and no eval-style dynamic code.
 *  5. No debug logging in browser code.
 *  6. Server logging is fixed-message only (no interpolated request data).
 *  7. No embedded credentials; the browser never touches provider keys.
 *  8. README documents the commands an evaluator runs, and CI runs the same gates.
 */

const ROOT = join(import.meta.dirname, '..', '..');

function walk(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = join(dir, entry);
    const full = join(ROOT, relative);
    if (statSync(full).isDirectory()) out.push(...walk(relative, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(relative);
  }
  return out.sort();
}

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('project hygiene', () => {
  it('requires the project and contributor documentation', () => {
    const required = [
      'README.md',
      'LICENSE',
      'SECURITY.md',
      'CONTRIBUTING.md',
      '.env.example',
      '.editorconfig',
      '.gitignore',
      'docs/ARCHITECTURE.md',
      'docs/METRICS.md',
      'docs/ACCESSIBILITY_REPORT.md',
      'docs/SPEC.md',
      'docs/DECISIONS.md',
      '.github/workflows/ci.yml',
      'vercel.json',
    ];
    const missing = required.filter((file) => !existsSync(join(ROOT, file)));
    expect(missing).toEqual([]);
  });

  it('keeps every src/ and api/ source file at 250 lines or fewer', () => {
    const files = [...walk('src', ['.ts', '.tsx']), ...walk('api', ['.ts'])];
    expect(files.length).toBeGreaterThan(100);
    const oversized = files
      .map((file) => ({ file, lines: read(file).split('\n').length }))
      .filter(({ lines }) => lines > 250);
    expect(oversized).toEqual([]);
  });

  it('bans explicit any and unsafe TypeScript suppressions', () => {
    const files = [
      ...walk('src', ['.ts', '.tsx']),
      ...walk('api', ['.ts']),
      ...walk('tests', ['.ts', '.tsx']),
      ...walk('e2e', ['.ts']),
    ];
    const banned = /:\s*any\b|as any\b(?!\s*[a-z])|<any>|@ts-ignore|@ts-nocheck/;
    const offenders = files
      .filter((file) => file !== 'tests/quality/hygiene.test.ts')
      .filter((file) => banned.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('bans HTML injection sinks and eval-style dynamic code from app code', () => {
    const files = [...walk('src', ['.ts', '.tsx']), ...walk('api', ['.ts'])];
    const banned = /dangerouslySetInnerHTML|\.innerHTML\s*=|eval\(|new Function\(/;
    const offenders = files.filter((file) => banned.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('keeps debug logging out of browser code', () => {
    const files = walk('src', ['.ts', '.tsx']);
    const banned = /console\.(log|debug|info|warn|error)\(/;
    const offenders = files.filter((file) => banned.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('keeps server logging fixed-message only (no interpolated request data)', () => {
    const files = walk('api', ['.ts']);
    for (const file of files) {
      for (const line of read(file).split('\n')) {
        if (!line.includes('console.')) continue;
        // A single string literal: no template placeholders, no concatenation, no extra
        // arguments — request data, prompts and keys can therefore never reach the logs.
        expect(line.trim()).toMatch(/^console\.error\('[^'$\\]*'\);$/);
      }
    }
  });

  it('never embeds credentials and keeps provider keys server-side', () => {
    const files = [
      ...walk('src', ['.ts', '.tsx']),
      ...walk('api', ['.ts']),
      ...walk('scripts', ['.mjs']),
      ...walk('e2e', ['.ts']),
    ];
    const credential = /AIza[0-9A-Za-z_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY/;
    const offenders = files.filter((file) => credential.test(read(file)));
    expect(offenders).toEqual([]);
    // The browser bundle must not reference the provider key or any VITE-injected secret.
    for (const file of walk('src', ['.ts', '.tsx'])) {
      expect(read(file)).not.toMatch(/GEMINI_API_KEY|import\.meta\.env\.VITE_/);
    }
    expect(read('.gitignore')).toMatch(/^\.env$/m);
  });

  it('documents the commands an evaluator runs', () => {
    const readme = read('README.md');
    for (const command of ['npm run dev', 'npm run check', 'npm run test:e2e', 'npm ci']) {
      expect(readme).toContain(command);
    }
    // The recorded figures must reference the generated truth file.
    expect(readme).toContain('docs/METRICS.md');
  });

  it('runs the same gate set in CI as documented locally', () => {
    const workflow = read('.github/workflows/ci.yml');
    for (const step of [
      'npm run lint',
      'npm run typecheck',
      'npm run test:cov',
      'npm run build',
      'node scripts/check-size.mjs',
      'node scripts/secret-scan.mjs',
      'npm run test:e2e',
    ]) {
      expect(workflow).toContain(step);
    }
  });
});
