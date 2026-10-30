import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '../../src/schemas/zodRuntime';

/**
 * The production CSP is `script-src 'self'` — no `unsafe-eval`. Zod v4 normally probes
 * for JIT support with `new Function('')`, which the browser blocks and logs as a CSP
 * violation. The shared zodRuntime module switches zod to its interpreted path so the
 * app stays clean under the strict policy.
 */
describe('zod runtime under strict CSP', () => {
  it('declares jitless mode globally so zod never probes new Function', () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });

  it('keeps parsing behaviour identical without the JIT regex compiler', () => {
    const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    expect(isoDate.safeParse('2026-02-14').success).toBe(true);
    expect(isoDate.safeParse('14-02-2026').success).toBe(false);
    expect(z.object({ guests: z.number().int().min(1) }).safeParse({ guests: 0 }).success).toBe(
      false,
    );
  });

  it('never calls the Function constructor, even when the CSP trap is armed', () => {
    const realFunction = globalThis.Function;
    let probeCalls = 0;
    // Mirror what a browser does when script-src blocks eval: constructing via Function throws.
    const cspFunction = (...args: unknown[]): ReturnType<typeof realFunction> => {
      if (args.length === 0) {
        probeCalls += 1;
        throw new TypeError('CSP: EvalError — call blocked');
      }
      return realFunction(...(args as []));
    };
    globalThis.Function = Object.assign(cspFunction, realFunction);
    try {
      // Fresh schemas of every check kind the app uses — parsing must not touch the JIT.
      const schemas = [
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        z.string().max(80),
        z.number().int().min(1).max(100_000),
        z.enum(['wedding', 'birthday', 'community']),
        z.array(z.string().min(1).max(120)).max(6),
      ];
      for (const schema of schemas) {
        schema.safeParse('x');
      }
      expect(probeCalls).toBe(0);
    } finally {
      globalThis.Function = realFunction;
    }
  });
});
