import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveBridgeLaunch } from '../../scripts/lib/bridge-launch.mjs';

/**
 * Regression guard for the Windows DEP0190 warning: Node deprecates passing an
 * args array together with `shell: true` (args are concatenated, not escaped).
 * The bridge launcher must therefore never combine the two — on any platform,
 * with or without tsx installed — and must prefer a fully shell-free launch.
 */

const failingRequire = createRequire(import.meta.url) satisfies NodeJS.Require;
function requireMissing(): NodeJS.Require {
  // Any resolve call throws, simulating a checkout without tsx installed.
  const missing = (...args: Parameters<NodeJS.Require>) => {
    throw new Error(`Cannot find module '${args[0]}'`);
  };
  return missing as unknown as NodeJS.Require;
}

describe('resolveBridgeLaunch', () => {
  it('prefers a shell-free launch: node runs the tsx CLI directly', () => {
    const launch = resolveBridgeLaunch();
    expect(launch.useShell).toBe(false);
    expect(launch.via).toBe('tsx-cli');
    expect(launch.command).toBe(process.execPath);
    expect(launch.args[1]).toBe('scripts/dev-api.ts');
    // The resolved CLI is a real file inside the installed tsx package.
    expect(launch.args[0]).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
  });

  it('never combines shell:true with an args array (DEP0190 invariant)', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
      for (const req of [failingRequire, undefined]) {
        const launch = resolveBridgeLaunch(
          req === undefined
            ? { platform, execPath: 'node' }
            : { platform, execPath: 'node', require: req },
        );
        if (launch.useShell) {
          expect(launch.args).toEqual([]);
        }
      }
    }
  });

  it('falls back to a single shell command string on Windows when tsx is missing', () => {
    const launch = resolveBridgeLaunch({
      platform: 'win32',
      execPath: 'node',
      require: requireMissing(),
    });
    expect(launch.useShell).toBe(true);
    expect(launch.via).toBe('npx-shell');
    expect(launch.args).toEqual([]); // no args array next to the shell — DEP0190-safe
    expect(launch.command).toBe('npx tsx scripts/dev-api.ts');
  });

  it('falls back to shell-free npx with args on POSIX when tsx is missing', () => {
    const launch = resolveBridgeLaunch({
      platform: 'linux',
      execPath: 'node',
      require: requireMissing(),
    });
    expect(launch.useShell).toBe(false);
    expect(launch.via).toBe('npx-direct');
    expect(launch.command).toBe('npx');
    expect(launch.args).toEqual(['tsx', 'scripts/dev-api.ts']);
  });
});

describe('live-ai-smoke.mjs without GEMINI_API_KEY', () => {
  it('reports SKIP and exits 0 without spawning the bridge', () => {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.GEMINI_API_KEY;
    const result = spawnSync(process.execPath, ['scripts/live-ai-smoke.mjs'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SKIP');
    expect(result.stdout).toContain('The live provider was NOT exercised');
  });
});
