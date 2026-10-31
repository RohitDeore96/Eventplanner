/**
 * Resolves how to launch `scripts/dev-api.ts` for the live AI smoke test.
 *
 * Invariant (regression-guarded in tests/lib/bridge-launch.test.ts): a shell is
 * never combined with an args array. Node's DEP0190 deprecation fires when args
 * are passed alongside `shell: true` (they are concatenated, not escaped), so
 * whenever a shell is unavoidable the command is one pre-joined string and the
 * args array stays empty.
 *
 * Preferred launch everywhere: `node <tsx/cli> scripts/dev-api.ts`. tsx exports
 * `./cli` as a plain .mjs file, so Node executes it directly — no npx, no shell,
 * identical behaviour on Windows (Node 20+) and POSIX. The fallback only runs
 * when tsx is not installed at all (bare checkout without `npm install`).
 */
import { createRequire } from 'node:module';

/**
 * @param {object} [overrides] injection point for tests.
 * @param {string} [overrides.platform] defaults to process.platform.
 * @param {string} [overrides.execPath] defaults to process.execPath.
 * @param {NodeRequire} [overrides.require] defaults to a require rooted here.
 * @returns {{ command: string, args: string[], useShell: boolean, via: string }}
 */
export function resolveBridgeLaunch(overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const execPath = overrides.execPath ?? process.execPath;
  const req = overrides.require ?? createRequire(import.meta.url);
  try {
    const tsxCli = req.resolve('tsx/cli');
    return {
      command: execPath,
      args: [tsxCli, 'scripts/dev-api.ts'],
      useShell: false,
      via: 'tsx-cli',
    };
  } catch {
    // tsx is not resolvable from here (e.g. dependencies not installed). Fall
    // back to npx. On Windows npx is npx.cmd and .cmd files cannot be spawned
    // shell-free (Node >= 20.12 rejects them with EINVAL), so the shell is
    // required — with a single command string and no args (DEP0190-safe).
  }
  if (platform === 'win32') {
    return { command: 'npx tsx scripts/dev-api.ts', args: [], useShell: true, via: 'npx-shell' };
  }
  return {
    command: 'npx',
    args: ['tsx', 'scripts/dev-api.ts'],
    useShell: false,
    via: 'npx-direct',
  };
}
