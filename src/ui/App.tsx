import { useMemo } from 'react';
import { loadWorkspace } from '../state/persistence';
import { Shell } from './shell';

/**
 * App entry: load the workspace once and hand it to the shell. The shell owns
 * everything user-facing; this file stays the stable import path for main.tsx.
 */
export function App() {
  const saved = useMemo(() => loadWorkspace(), []);
  return <Shell workspace={saved} />;
}
