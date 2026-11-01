#!/usr/bin/env node
/**
 * Runs a command with UTSAV_WRITE_EVIDENCE=1 — the supported way to regenerate the
 * tracked evidence files (docs/evidence/ai/ai-eval-results.json and
 * e2e/evidence/accessibility/*.json). Ordinary test runs never write into tracked
 * directories; the writers are gated on this variable (see tests/ai/evaluation.test.ts
 * and e2e/specs/accessibility.spec.ts).
 *
 * Cross-platform on purpose (the maintainer runs PowerShell): the env var is set inside
 * Node instead of relying on POSIX shell syntax.
 *
 * Usage: node scripts/run-with-evidence.mjs <command> [args...]
 *   npm run evidence:ai    -> node scripts/run-with-evidence.mjs npx vitest run tests/ai/evaluation.test.ts
 *   npm run evidence:a11y  -> node scripts/run-with-evidence.mjs npx playwright test e2e/specs/accessibility.spec.ts
 */
import { spawnSync } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error('usage: node scripts/run-with-evidence.mjs <command> [args...]');
  process.exit(2);
}
const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: { ...process.env, UTSAV_WRITE_EVIDENCE: '1' },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
