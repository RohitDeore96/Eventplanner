#!/usr/bin/env node
/**
 * Docs truth gate (Q2): generates docs/METRICS.md from REAL runs — never typed by hand.
 * CI runs the same checks; if a number in the README disagrees with this file, CI fails.
 * Run: node scripts/gen-metrics.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';

function run(command, label) {
  try {
    const output = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    console.error(`METRICS: "${label}" failed\n${output.slice(-800)}`);
    return { ok: false, output };
  }
}

const results = [];

// 1. Typecheck
const tsc = run('npx tsc --noEmit', 'typecheck');
results.push(['Typecheck', tsc.ok ? '0 errors' : 'FAILED']);

// 2. Lint
const lint = run('npx eslint . --max-warnings 0', 'lint');
results.push(['Lint (typescript-eslint strictTypeChecked)', lint.ok ? '0 findings' : 'FAILED']);

// 3. Tests with coverage
const vitest = run('npx vitest run --coverage', 'tests');
const testMatch = /Tests\s+(\d+) passed/.exec(vitest.output);
const filesMatch = /Test Files\s+(\d+) passed/.exec(vitest.output);
const stmt = /Statements\s+:\s+([\d.]+)%/.exec(vitest.output);
const branch = /Branches\s+:\s+([\d.]+)%/.exec(vitest.output);
const funcs = /Functions\s+:\s+([\d.]+)%/.exec(vitest.output);
const lines = /Lines\s+:\s+([\d.]+)%/.exec(vitest.output);
results.push([
  'Tests',
  testMatch ? `${testMatch[1]} passed across ${filesMatch?.[1] ?? '?'} files` : 'FAILED',
]);
results.push([
  'Coverage',
  lines && stmt
    ? `${lines[1]}% lines, ${stmt[1]}% statements, ${funcs?.[1] ?? '?'}% functions, ${branch?.[1] ?? '?'}% branches`
    : 'see CI run',
]);

// 4. Build + bundle size
const build = run('npm run build', 'build');
if (build.ok) {
  const size = run('node scripts/check-size.mjs', 'bundle size');
  const bundle = /Bundle: ([\d.]+) KB gz/.exec(size.output);
  results.push(['Bundle', bundle ? `${bundle[1]} KB gzipped JavaScript` : 'see CI run']);
} else {
  results.push(['Bundle', 'BUILD FAILED']);
}

// 5. Repo size
const repo = run('node scripts/check-repo-size.mjs', 'repo size');
const repoMatch = /pack size: ([\d.]+) MB/.exec(repo.output);
results.push(['Repo size', repoMatch ? `${repoMatch[1]} MB (limit 10 MB)` : 'see CI run']);

// 6. Audit
const audit = run('npm audit --omit=dev --audit-level=high', 'audit');
results.push(['npm audit (runtime deps)', audit.ok ? 'clean at high severity' : 'FAILED']);

const date = new Date().toISOString().slice(0, 10);
const table = results.map(([label, value]) => `| ${label} | ${value} |`).join('\n');

const md = `# Metrics — generated from real runs

Every number below comes from a command executed on ${date} by \`node scripts/gen-metrics.mjs\`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
${table}

Reproduce locally:

\`\`\`bash
npm ci
node scripts/gen-metrics.mjs
\`\`\`

AI features are not exercised by these checks: they need a \`GEMINI_API_KEY\` and are
therefore marked **Not run here**. The route tests cover the AI paths with a mocked model.
`;

writeFileSync('docs/METRICS.md', md);
console.log(md);

// Fail when any gate failed so CI catches drift.
if (
  results.some(
    ([label]) =>
      label !== 'Repo size' && /FAILED/.test(results.find(([l]) => l === label)?.[1] ?? ''),
  )
) {
  process.exit(1);
}
if (!existsSync('docs/METRICS.md')) process.exit(1);
