#!/usr/bin/env node
/**
 * Secret scan: fails when anything that looks like a live credential is tracked.
 * Deliberately simple and readable; the point is catching accidents, not adversaries.
 */
import { execSync } from 'node:child_process';

const PATTERNS = [
  [/ghp_[A-Za-z0-9]{36,}/, 'GitHub personal access token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
  [/AIza[0-9A-Za-z\-_]{30,}/, 'Google API key'],
  [/sk-[A-Za-z0-9]{20,}/, 'generic sk- secret'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
];

const tracked = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');
let hits = 0;
for (const file of tracked) {
  if (file === '') continue;
  let content;
  try {
    content = execSync(`git show :"${file}"`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch {
    continue; // binary or unreadable in the index; audit covers the rest
  }
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(content)) {
      console.error(`SECRET SCAN: possible ${label} in ${file}`);
      hits += 1;
    }
  }
}
if (hits > 0) {
  console.error(`${hits} potential secret(s) found. Remove them and rotate the credential.`);
  process.exit(1);
}
console.log('Secret scan clean.');
