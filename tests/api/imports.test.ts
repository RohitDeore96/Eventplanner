import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Vercel's Node runtime loads `api/**` as ES modules WITHOUT TypeScript's resolver, so every
 * relative import inside `api/` must carry an explicit `.js` extension or the whole function
 * crashes at cold start with FUNCTION_INVOCATION_FAILED. This guard keeps that property.
 */

const API_ROOT = join(process.cwd(), 'api');

function listTsFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) entries.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) entries.push(full);
  }
  return entries;
}

describe('serverless function import guard', () => {
  it('every relative import inside api/ ends with .js so the Vercel runtime can resolve it', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(API_ROOT)) {
      const source = readFileSync(file, 'utf8');
      const imports = source.matchAll(/from\s+'(\.[^']+)'/g);
      for (const match of imports) {
        const specifier = match[1];
        if (specifier !== undefined && !specifier.endsWith('.js')) {
          offenders.push(`${file}: '${specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
