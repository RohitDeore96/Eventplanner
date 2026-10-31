#!/usr/bin/env node
/**
 * Opt-in LIVE AI smoke test (Milestone 8). Never runs in CI by default.
 *
 * Mocked route tests prove request construction and response validation; they cannot
 * prove the live provider accepts our JSON-mode response schemas. This script does:
 * it boots the real route modules on a local port with a REAL key and checks that every
 * endpoint answers 200 from the actual model, with money converted by the one canonical
 * rule (model states major units, the route converts exactly once).
 *
 * Usage:  GEMINI_API_KEY=... npm run smoke:ai
 * Without the key the script says SKIP and exits 0 — it never fabricates a pass.
 * The key is read from the environment only; it is never logged or written anywhere.
 *
 * Behaviour notes:
 * - Cases run 8 s apart so a free-tier key is not punished for burst rate limits; the
 *   route's own model chain (with its [ai] failover logs, visible via stdio) answers.
 * - The PASS line names the exact model that answered (the route's `source` field),
 *   so a recorded run can state which model served it.
 * - The API bridge is launched shell-free on every platform (node <tsx/cli>):
 *   no DEP0190 shell+args warning, no npx.cmd/EINVAL trouble on Windows. Only a
 *   bare checkout without tsx installed falls back to npx (see scripts/lib/bridge-launch.mjs).
 * - A bridge that dies before all cases finish fails the run with the child's
 *   exit reason — a dead bridge can never be reported as PASS.
 * - Exit code: 0 on PASS or SKIP, 1 on any FAIL, so a human or CI can gate on it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolveBridgeLaunch } from './lib/bridge-launch.mjs';

const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const GAP_BETWEEN_CASES_MS = 8_000;

const log = (line) => process.stdout.write(`${line}\n`);

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length === 0) {
  log('SKIP: GEMINI_API_KEY is not set. The live provider was NOT exercised;');
  log('mocked tests remain the only AI evidence. Run with a real key to smoke-test live.');
  process.exit(0);
}

const CASES = [
  {
    name: 'parse-intake',
    body: { text: 'Shaadi in Pune, 200 guests, 8 lakh budget', currency: 'INR' },
    check(body) {
      if (body.occasion !== 'wedding') return `occasion: ${JSON.stringify(body.occasion)}`;
      if (body.guests !== 200) return `guests: ${JSON.stringify(body.guests)}`;
      // "8 lakh" must become exactly 80,000,000 paise via budgetMajor + one conversion.
      if (body.budgetMinor !== 80_000_000)
        return `budgetMinor: ${JSON.stringify(body.budgetMinor)}`;
      if (body.budgetMajor !== undefined) return 'budgetMajor leaked into the response';
      return null;
    },
  },
  {
    name: 'suggest-ideas',
    body: { occasion: 'wedding', vibe: 'pastel marigold', guests: 120 },
    check(body) {
      const ok =
        Array.isArray(body.themes) &&
        body.themes.length > 0 &&
        Array.isArray(body.activities) &&
        Array.isArray(body.foodStyle) &&
        Array.isArray(body.personalTouches);
      return ok ? null : `ideas shape: ${JSON.stringify(body).slice(0, 120)}`;
    },
  },
  {
    name: 'extract-quote',
    body: {
      text: 'Sharma Caterers\nTotal: Rs 2,50,000 inclusive tax\nAdvance 25% on booking',
      currency: 'INR',
    },
    check(body) {
      if (body.totalPriceMinor !== 25_000_000) {
        return `totalPriceMinor: ${JSON.stringify(body.totalPriceMinor)}`;
      }
      if (body.totalPriceMajor !== undefined) return 'totalPriceMajor leaked into the response';
      return null;
    },
  },
  {
    name: 'propose-patch',
    body: {
      instruction: 'add one haldi task and move 20000 from decor to catering',
      facts:
        'Categories: Venue planned 2000000, Decor planned 1000000, Catering planned 3000000. Budget 6000000.',
      today: new Date().toISOString().slice(0, 10),
      currency: 'INR',
    },
    check(body) {
      if (!Array.isArray(body.actions) || body.actions.length === 0) return 'no actions';
      const allowed = new Set([
        'task/add',
        'task/update',
        'task/delay',
        'budget/move',
        'category/add',
      ]);
      for (const action of body.actions) {
        if (!allowed.has(action.type)) return `action type: ${action.type}`;
        if (action.type === 'budget/move') {
          if (!Number.isInteger(action.amountMinor) || action.amountMinor <= 0) {
            return `amountMinor: ${JSON.stringify(action.amountMinor)}`;
          }
          if (action.amountMajor !== undefined) return 'amountMajor leaked into the response';
        }
      }
      return null;
    },
  },
];

function post(path, body) {
  return globalThis
    .fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://localhost:${PORT}`,
        host: `localhost:${PORT}`,
      },
      body: JSON.stringify(body),
    })
    .then(async (response) => ({ status: response.status, body: await response.json() }));
}

async function waitUntilReady(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`${BASE}/api/review-plan`, { method: 'GET' });
      if (response.status === 405) return; // the guarded route is up
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
  throw new Error('the local API bridge never became ready');
}

const isWin = process.platform === 'win32';

// Shell-free on every platform: node runs the tsx CLI entry directly (see
// scripts/lib/bridge-launch.mjs for the resolution and its DEP0190 invariant).
const launch = resolveBridgeLaunch();
const child = launch.useShell
  ? spawn(launch.command, {
      env: { ...process.env, API_PORT: String(PORT) },
      stdio: 'inherit',
      shell: true,
    })
  : spawn(launch.command, launch.args, {
      env: { ...process.env, API_PORT: String(PORT) },
      stdio: 'inherit',
    });

// A spawn failure or an early bridge exit must surface as a FAIL, never as a
// silent pass-through or a fake PASS. `stopping` excludes the cleanup kill.
let failed = false;
let childExitReason = null;
let stopping = false;
let allCasesDone = false;
child.on('error', (error) => {
  childExitReason = `could not start the API bridge: ${error.message}`;
});
child.on('exit', (code, signal) => {
  if (stopping) return;
  childExitReason = `the API bridge exited unexpectedly (code ${code}, signal ${signal})`;
});

try {
  await waitUntilReady(30_000);
  for (const [index, testCase] of CASES.entries()) {
    if (index > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, GAP_BETWEEN_CASES_MS));
    }
    if (childExitReason !== null) {
      failed = true;
      log(`FAIL ${testCase.name}: ${childExitReason}`);
      break;
    }
    let verdict;
    let answeredBy = 'live model';
    try {
      const { status, body } = await post(`/api/${testCase.name}`, testCase.body);
      if (status !== 200) {
        verdict = `HTTP ${status} ${JSON.stringify(body)}`;
      } else if (body.source === 'built-in') {
        verdict = 'fell back to built-in (the live model did not answer)';
      } else if (body.source === 'cache') {
        verdict = 'answered from cache instead of the live model';
      } else {
        answeredBy = body.source;
        verdict = testCase.check(body);
      }
    } catch (error) {
      verdict = `request failed: ${error.message}`;
    }
    if (verdict === null) {
      log(`PASS ${testCase.name} (answered by: ${answeredBy})`);
    } else {
      failed = true;
      log(`FAIL ${testCase.name}: ${verdict}`);
    }
  }
  allCasesDone = true;
} catch (error) {
  failed = true;
  log(`FAIL setup: ${error.message}`);
} finally {
  stopping = true;
  if (isWin) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// The bridge dying before every case ran is a setup failure (it can never
// produce a false PASS). If it dies after every case already passed, the verdict
// stands and the late exit is only reported.
if (childExitReason !== null) {
  if (allCasesDone) {
    log(`NOTE bridge: ${childExitReason} (all cases had already completed)`);
  } else {
    failed = true;
    log(`FAIL bridge: ${childExitReason}`);
  }
}

if (failed) {
  log(
    'Live smoke FAILED: the schemas or the money contract did not hold against the live provider.',
  );
  process.exit(1);
}
log('Live smoke PASSED: the provider accepted every response schema and the money contract held.');
