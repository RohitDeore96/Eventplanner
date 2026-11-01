import { z } from 'zod';

/**
 * The app ships a strict CSP (`script-src 'self'`, no `unsafe-eval`). By default zod v4
 * probes whether the JIT regex compiler may run through the Function constructor; under
 * strict CSP that probe is blocked and every browser logs a CSP violation, even though
 * zod catches it.
 * Declaring `jitless` up front skips the probe entirely and parsing stays on the identical
 * interpreted path. Imported for its side effect by every module that touches zod, so the
 * frontend bundle and the serverless functions share one behaviour.
 */
z.core.globalConfig.jitless = true;

/** Marker export: keeps this file an ES module for side-effect-only imports. */
export {};
