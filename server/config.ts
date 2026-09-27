import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.SWARM_PORT ?? 4317);

// Everything the swarm writes lives outside this project so that agents working in
// cloned repos never pick up this project's CLAUDE.md or settings by walking up the tree.
export const HOME_DIR = process.env.SWARM_HOME ?? path.join(os.homedir(), '.office-swarm');
export const WORKSPACE_ROOT = path.join(HOME_DIR, 'workspaces');
export const DEMO = process.argv.includes('--demo') || process.env.SWARM_DEMO === '1' || process.env.SWARM_DEMO === 'true';
export const STATE_FILE = path.join(HOME_DIR, DEMO ? 'demo-state.json' : 'state.json');

// How often each connected repo's issues and PRs are refreshed from GitHub.
export const SYNC_INTERVAL_MS = 45_000;
// How often idle agents on auto-assign floors look for new work.
export const SCHEDULER_INTERVAL_MS = 8_000;
// Terminal lines kept per agent.
export const LOG_BUFFER = 600;
