#!/usr/bin/env node
/**
 * Bundle budget gate (E2): every JS asset in dist must fit the gzip budget.
 * Fails the build when the budget is exceeded, with the real numbers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_KB = 250; // gzipped JavaScript, whole bundle
const dist = 'dist/assets';

function gzipSize(buffer) {
  return gzipSync(buffer).length;
}

function main() {
  let files;
  try {
    files = readdirSync(dist).filter((f) => f.endsWith('.js'));
  } catch {
    console.error('dist/assets missing — run `npm run build` first.');
    process.exit(1);
  }
  if (files.length === 0) {
    console.error('No JS assets found in dist/assets.');
    process.exit(1);
  }
  let total = 0;
  const rows = [];
  for (const file of files) {
    const size = gzipSize(readFileSync(join(dist, file)));
    total += size;
    rows.push(`  ${file}: ${(size / 1024).toFixed(1)} KB gz`);
  }
  const totalKb = total / 1024;
  console.log(`Bundle: ${totalKb.toFixed(1)} KB gz across ${files.length} file(s)`);
  console.log(rows.join('\n'));
  if (totalKb > BUDGET_KB) {
    console.error(`OVER BUDGET: ${totalKb.toFixed(1)} KB > ${BUDGET_KB} KB`);
    process.exit(1);
  }
  console.log(`Under budget (${BUDGET_KB} KB).`);
}

main();
