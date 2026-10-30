#!/usr/bin/env node
/** Repo size gate (R10): tracked content must stay under 10 MB. */
import { execSync } from 'node:child_process';

const LIMIT_BYTES = 10 * 1024 * 1024;
const size =
  Number(
    execSync('git count-objects -vH', { encoding: 'utf8' }).match(/size-pack: (\d+)/)?.[1] ?? 0,
  ) * 1024;
const mb = size / 1024 / 1024;
console.log(`Repo pack size: ${mb.toFixed(2)} MB`);
if (size > LIMIT_BYTES) {
  console.error('OVER THE 10 MB LIMIT.');
  process.exit(1);
}
console.log('Under the 10 MB limit.');
