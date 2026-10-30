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
 */
import { spawn } from 'node:child_process';

const PORT = 8791;
const BASE = `http://localhost:${PORT}`;

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

const child = spawn('npx', ['tsx', 'scripts/dev-api.ts'], {
  env: { ...process.env, API_PORT: String(PORT) },
  stdio: 'ignore',
});

let failed = false;
try {
  await waitUntilReady(30_000);
  for (const testCase of CASES) {
    let verdict;
    try {
      const { status, body } = await post(`/api/${testCase.name}`, testCase.body);
      if (status !== 200) {
        verdict = `HTTP ${status} ${JSON.stringify(body)}`;
      } else if (body.source === 'built-in') {
        verdict = 'fell back to built-in (the live model did not answer)';
      } else if (body.source === 'cache') {
        verdict = 'answered from cache instead of the live model';
      } else {
        verdict = testCase.check(body);
      }
    } catch (error) {
      verdict = `request failed: ${error.message}`;
    }
    if (verdict === null) {
      log(`PASS ${testCase.name} (answered by: live model)`);
    } else {
      failed = true;
      log(`FAIL ${testCase.name}: ${verdict}`);
    }
  }
} catch (error) {
  failed = true;
  log(`FAIL setup: ${error.message}`);
} finally {
  child.kill('SIGTERM');
}

if (failed) {
  log(
    'Live smoke FAILED: the schemas or the money contract did not hold against the live provider.',
  );
  process.exit(1);
}
log('Live smoke PASSED: the provider accepted every response schema and the money contract held.');
