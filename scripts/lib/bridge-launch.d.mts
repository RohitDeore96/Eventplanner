export interface BridgeLaunch {
  command: string;
  args: string[];
  useShell: boolean;
  via: 'tsx-cli' | 'npx-shell' | 'npx-direct';
}

export function resolveBridgeLaunch(overrides?: {
  platform?: string;
  execPath?: string;
  require?: NodeJS.Require;
}): BridgeLaunch;
