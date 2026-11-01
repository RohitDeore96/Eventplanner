/**
 * The session-volatile store behind the recovery notice's explicit "continue for this
 * session" action (stage-2 defect A/B). When the browser's real storage cannot even be
 * read, the app must still let the family plan — without depending on, writing to, or
 * risking the data it could not inspect. Choosing to continue swaps every default-storage
 * access to an in-memory store that lives and dies with the page: nothing is written to
 * the device, and a reload honestly ends the session.
 */

/** A storage that lives and dies with this JS context. */
function volatileStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getLength: () => map.size,
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as Storage;
}

/**
 * Session-only mode, entered ONLY through the recovery notice's explicit action — never
 * inferred from a failed read, which must keep surfacing the recovery path.
 */
let sessionStore: Storage | null = null;

/** True after the user chose to continue without storage for this session. */
export function isSessionOnlyStorage(): boolean {
  return sessionStore !== null;
}

/** The explicit recovery action: run entirely in memory for the rest of the session. */
export function continueSessionWithoutStorage(): void {
  sessionStore ??= volatileStorage();
}

/** One storage resolver for every default-storage access (stage-2 rule: the storage
 * accessor is resolved at the call site, inside each try, because `window.localStorage`
 * itself can throw). An explicit test storage wins, then the session store, then the
 * browser's real storage. */
export function effectiveStorage(storage?: Storage): Storage {
  if (storage !== undefined) return storage;
  if (sessionStore !== null) return sessionStore;
  return window.localStorage;
}
