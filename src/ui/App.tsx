import { useState } from 'react';
import { loadWorkspace, type Workspace } from '../state/persistence';
import { Shell } from './shell';

/**
 * App entry: load the workspace once and hand it to the shell. The shell owns
 * everything user-facing; this file stays the stable import path for main.tsx.
 *
 * The workspace is state so the recovery notice's explicit "continue for this session"
 * action can swap it in place (the persistence module has already switched its storage
 * to the volatile session store by then) — no reload, which would lose the session-only
 * choice and land the family back on the same recovery card.
 */
export function App() {
  const [saved, setSaved] = useState<Workspace>(() => loadWorkspace());
  const [sessionOnly, setSessionOnly] = useState(false);
  return (
    <Shell
      workspace={saved}
      sessionOnly={sessionOnly}
      onSessionContinue={() => {
        setSessionOnly(true);
        setSaved(loadWorkspace());
      }}
    />
  );
}
