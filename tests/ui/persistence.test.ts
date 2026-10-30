import { describe, expect, it } from 'vitest';
import {
  clearSavedPlan,
  loadSavedPlan,
  savePlan,
  SCHEMA_VERSION,
} from '../../src/state/persistence';
import { makePlan, run } from '../helpers';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getLength: 0,
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as Storage;
}

const plan = run(makePlan(), {
  type: 'guest/add',
  id: 'g1',
  name: 'Meera',
  rsvp: 'yes',
  plusOnes: 0,
  dietary: [],
  group: 'Family',
});

describe('persistence', () => {
  it('saves and loads a plan unchanged', () => {
    const storage = memoryStorage();
    expect(savePlan(plan, storage).ok).toBe(true);
    const loaded = loadSavedPlan(storage);
    expect(loaded).toEqual(plan);
  });

  it('migrates a version-0 record (no schemaVersion) forward', () => {
    const storage = memoryStorage({
      'utsav.plans.v1': JSON.stringify({ savedAtISO: '2026-10-30T00:00:00.000Z', plan }),
    });
    const loaded = loadSavedPlan(storage);
    expect(loaded).toEqual(plan);
  });

  it('refuses records written by a newer schema instead of guessing', () => {
    const storage = memoryStorage({
      'utsav.plans.v1': JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, plan }),
    });
    expect(loadSavedPlan(storage)).toBeNull();
  });

  it('returns null for corrupted JSON, wrong shapes and oversized payloads', () => {
    const corrupted = memoryStorage({ 'utsav.plans.v1': '{not json' });
    expect(loadSavedPlan(corrupted)).toBeNull();
    const wrong = memoryStorage({
      'utsav.plans.v1': JSON.stringify({ schemaVersion: 1, plan: { id: 5 } }),
    });
    expect(loadSavedPlan(wrong)).toBeNull();
    const huge = memoryStorage({ 'utsav.plans.v1': 'x'.repeat(400_001) });
    expect(loadSavedPlan(huge)).toBeNull();
  });

  it('reports when storage refuses writes and clears cleanly', () => {
    const failing: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        // nothing stored
      },
      clear: () => {
        // nothing stored
      },
      key: () => null,
      getLength: 0,
    } as unknown as Storage;
    const status = savePlan(plan, failing);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('refused');
    expect(() => {
      clearSavedPlan(failing);
    }).not.toThrow();
  });
});
