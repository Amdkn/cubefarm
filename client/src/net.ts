import { useStore } from './store';
import { restartExpected, shouldReload } from './officeUpdate';
import {
  CEO_ID,
  DEFAULT_DOG_NAME,
  DEFAULT_MAX_AGENTS,
  type AgentLook,
  type AgentRole,
  type AgentView,
  type ClientEvent,
  type RepoView,
  type ServerEvent,
  type WorldSnapshot,
} from '../../shared/types';
import { DEFAULT_WEATHER, DEFAULT_WORLD_EVENTS, EMPTY_WEATHER_VIEW } from '../../shared/outside';
import { currentWatch } from './watch';
import { hitchWs } from './hitches';

let retry = 0;
let socket: WebSocket | null = null;
let sentWatch = '';

/** Tells the office what this tab shows (watch.ts) whenever that changes, so it sends only the lines it needs. */
function sendWatch() {
  const watch = JSON.stringify({ type: 'lines', ...currentWatch(useStore.getState()) } satisfies ClientEvent);
  if (socket?.readyState !== WebSocket.OPEN || watch === sentWatch) return;
  sentWatch = watch;
  socket.send(watch);
}
let watching = false;
// Back from the time-lapse: everything waits for the fresh snapshot asked for, so nothing applies on top of the replay.
let awaitingSnapshot = false;
// Presence too: the other visitors are live people, there in a replay as much as in the live office.
const OUTSIDE_REPLAY = new Set<ServerEvent['type']>([
  'notify',
  'notifyChannels',
  'settings',
  'officeUpdate',
  'clis',
  'voiceKey',
  'voiceCache',
  'progress',
  'visitors',
  'visitorPose',
  'visitorEmote',
  'visitorPing',
]);
let opens = 0;
/** Characters in and out on /ws since the page loaded, and in for presence alone (its probe turns them into rates). */
export const wsTraffic = { in: 0, out: 0, presence: 0 };

/** Sends a message on /ws; false while disconnected, when it's dropped. */
export function sendWs(msg: ClientEvent) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  const text = JSON.stringify(msg);
  socket.send(text);
  wsTraffic.out += text.length;
  return true;
}

/** How many times the socket has opened: a new one means the server has forgotten this tab (presence tells it again). */
export const wsOpens = () => opens;

/** The time-lapse stopped: asks for the live office again (a reconnect brings a snapshot anyway). */
export function requestSnapshot() {
  awaitingSnapshot = true;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resync' } satisfies ClientEvent));
}

// The commit this tab last reloaded for, so a new office commit reloads the page at most once.
const RELOAD_KEY = 'office-swarm:reloaded-for';

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_KEY);
  } catch {
    return null;
  }
}

/** The server came back on a different commit: load the client that goes with it. */
function reloadForNewCommit(commit: string): boolean {
  if (!shouldReload(useStore.getState().officeCommit, commit, reloadedFor())) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, commit);
  } catch {
    return false; // without storage we can't promise a single reload, so keep the old client
  }
  location.reload();
  return true;
}

/** Fallback autonome A'Space OS V5 si aucun serveur Swarm n'est joint apres 1,2s (ex. Vercel) */
function injectAutonomousOrbit() {
  const defaultSettings = {
    sessionLimit: 0,
    defaultModel: 'claude-opus-5-5',
    defaultEffort: 'medium' as const,
    runtime: 'terminal' as const,
    defaultCli: 'claude' as const,
    scaling: 'approve' as const,
    maxAgents: DEFAULT_MAX_AGENTS,
    ceoHeartbeatMin: 60,
    managerName: 'Amadou Kone',
    companyName: 'Aspace OS V5 · City Office',
    dogName: DEFAULT_DOG_NAME,
    projectsDir: '',
    setupDone: true,
    tutorialStep: -1,
    pacingSessions: 3,
    trimIdleDesksMin: 120,
    voice: { provider: 'off' as const, voiceId: '', voiceName: '', model: '', speakOffice: false, keepDays: 7 },
    themes: { mode: 'auto' as const, disabled: [], birthday: null },
    weather: DEFAULT_WEATHER,
    worldEvents: DEFAULT_WORLD_EVENTS,
    listen: { provider: 'off' as const, autoSend: false, handsFree: false },
    notify: {
      events: { needsHuman: true, ceoMessage: true, hire: true, agentError: true, usage: true, merge: true },
      channels: { desktop: false, push: false, ntfy: false },
      officeUrl: '',
    },
    cloud: { machineKind: 'local' as const, boxSize: 'small' as const, boxLimit: 10 },
  };

  const makeRepo = (id: string, name: string, floor: number, color: string, mission: string): RepoView => ({
    id,
    fullName: `Amdkn/${name}`,
    description: mission,
    url: `https://github.com/Amdkn/${name}`,
    defaultBranch: 'main',
    floor,
    color,
    autoAssign: false,
    autoMerge: false,
    folderSync: 'in sync',
    browserTesting: false,
    links: [],
    mission,
    summary: mission,
    qaBrief: 'Standard Aspace QA checks',
    localPath: null,
    checkoutPath: '',
    cloneStatus: 'ready',
    issues: [
      {
        number: 1,
        title: `${name} Holonic Gateway Ready`,
        body: 'Autonomous loop verified',
        url: `https://github.com/Amdkn/${name}/issues/1`,
        labels: ['enhancement'],
        createdAt: new Date().toISOString(),
      },
    ],
    pulls: [],
    held: [],
    lastSync: Date.now(),
    previewConfig: { command: null, env: {} },
    preview: {
      status: 'stopped',
      port: 5000 + floor,
      url: null,
      ref: 'main',
      pr: null,
      commit: 'aspace-v5',
      startedAt: null,
      error: null,
      logTail: [],
    },
  });

  const repos: RepoView[] = [
    makeRepo('fkb00', 'FKB00_Runtime', 1, '#6366f1', 'Tech OS Kernel & Multi-Harness Engine'),
    makeRepo('fkb01', 'FKB01_Inference', 2, '#06b6d4', 'Sovereign Inference & Local LLM Mesh'),
    makeRepo('fkb02', 'FKB02_Memory', 3, '#8b5cf6', 'Neuro-Symbolic Memory & Shared Brain'),
    makeRepo('fkb03', 'FKB03_3DWorlds', 4, '#ec4899', 'City Office 3D & World Engineering'),
    makeRepo('fkb06', 'FKB06_Video_SaaS', 5, '#ef4444', 'Automated Video Studio & Saas Engine'),
    makeRepo('fkb07', 'FKB07_Money_Maker', 6, '#10b981', 'B2B Monetization & Algo Trading Bots'),
  ];

  const makeAgent = (
    id: string,
    name: string,
    repoId: string,
    role: AgentRole,
    desk: number,
    color: string,
    hair: string,
    skin: string,
    look: AgentLook = 'masculine',
  ): AgentView => ({
    id,
    name,
    repoId,
    role,
    look,
    task: null,
    desk,
    color,
    hair,
    skin,
    style: null,
    model: 'claude-sonnet-4-5',
    effort: 'medium',
    cli: 'claude',
    host: 'local',
    terminal: false,
    status: 'idle',
    issueNumber: null,
    issueTitle: null,
    branch: null,
    prNumber: null,
    prUrl: null,
    currentTool: null,
    startedAt: Date.now(),
    endedAt: null,
    costUsd: 0,
    turns: 0,
    browserUrl: null,
    hasScreenshot: false,
    screenshotAt: null,
    lastError: null,
    career: null,
    log: [],
    activity: null,
  });

  const agents: AgentView[] = [
    makeAgent(CEO_ID, 'A0-AMADEUS', 'fkb00', 'ceo', 0, '#e63946', '#2b2118', '#f1c27d'),
    makeAgent('s1', 'S1-RICK', 'fkb00', 'agent', 1, '#3a86ff', '#ffffff', '#f1c27d'),
    makeAgent('a1', 'A1-BETH', 'fkb00', 'agent', 2, '#9b5de5', '#e7c496', '#f1c27d', 'feminine'),
    makeAgent('s3', 'S3-GRAHAM', 'fkb00', 'agent', 3, '#06d6a0', '#4a3728', '#f1c27d'),
  ];

  const autonomousSnapshot: { type: 'snapshot'; data: WorldSnapshot } = {
    type: 'snapshot',
    data: {
      user: 'Amadou Kone (S0)',
      ghReady: true,
      demo: true,
      machinesRoot: '',
      settings: defaultSettings,
      repos,
      agents,
      qa: [],
      prPreviews: [],
      requests: [],
      ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null },
      messages: [
        {
          id: 1,
          from: 'ceo',
          text: 'Welcome to Aspace OS V5 City Office. The sovereign mesh and 6 FKB poles are initialized and running.',
          at: Date.now(),
        },
      ],
      phoneReadAt: Date.now(),
      version: '0.3.20-aspace-v5',
      officeCommit: 'aspace-v5',
      officeUpdate: undefined,
      usage: { state: 'normal', until: null, warning: null },
      ops: {
        floors: [],
        total: {
          ready: 6,
          building: 0,
          inQa: 0,
          fixing: 0,
          toMerge: 0,
          needsYou: 0,
          triage: 0,
          mergedToday: 0,
          mergedHour: 0,
          spark: [0, 0, 0, 0, 0, 0],
          leadMs: null,
          qaWaitMs: null,
          qaPass: 1.0,
          ciPass: 1.0,
          ciRuns: 6,
          ciMs: 30000,
          busy: 0,
          idle: 4,
          errors: 0,
          costToday: 0,
        },
        ceoCostToday: 0,
        alarms: [],
      },
      doctor: [],
      clis: [
        { id: 'claude', label: 'Claude Code', installed: true, version: '1.5.0', integrated: true },
        { id: 'codex', label: 'Codex CLI', installed: true, version: '1.0.0', integrated: true },
        { id: 'opencode', label: 'OpenCode', installed: true, version: '1.19.5', integrated: true },
      ],
      voiceKeySet: false,
      voiceKeyHint: '',
      voiceCache: { clips: 0, bytes: 0, saved: [] },
      weather: EMPTY_WEATHER_VIEW,
      ticker: [],
      notifyChannels: { webhooks: { ntfy: { set: false, hint: '' } }, pushDevices: 0 },
      cloud: undefined,
      progress: { floors: {}, achievements: [], coffees: 0, merges: 0 },
      pong: {},
    },
  };
  useStore.getState().setConnected(true);
  useStore.getState().apply(autonomousSnapshot as ServerEvent);
}

export function connect() {
  // subscribed here, not as the module loads: the store imports this module (through presence) before it exists
  if (!watching) {
    watching = true;
    useStore.subscribe(sendWatch);
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const customWs = (import.meta as any).env?.VITE_SWARM_WS_URL;
  const wsTarget =
    customWs ||
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? `${proto}://${location.host}/ws`
      : 'wss://swarm.aspaceos.tech/ws');

  let settled = false;
  const fallbackTimer = setTimeout(() => {
    if (!settled && !useStore.getState().loaded) {
      settled = true;
      try {
        if (socket && socket.readyState !== WebSocket.OPEN) socket.close();
      } catch {}
      injectAutonomousOrbit();
    }
  }, 1200);

  let ws: WebSocket;
  try {
    ws = new WebSocket(wsTarget);
  } catch {
    injectAutonomousOrbit();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    settled = true;
    clearTimeout(fallbackTimer);
    retry = 0;
    sentWatch = '';
    opens++;
    useStore.getState().setConnected(true);
    sendWatch();
  };
  ws.onmessage = (e) => {
    const bytes = typeof e.data === 'string' ? e.data.length : 0;
    wsTraffic.in += bytes;
    const from = performance.now();
    let type = 'other';
    try {
      const ev = JSON.parse(e.data) as ServerEvent;
      type = ev.type;
      if (ev.type.startsWith('visitor')) wsTraffic.presence += e.data.length;
      if (ev.type === 'snapshot' && ev.data.officeCommit && reloadForNewCommit(ev.data.officeCommit)) return;
      // While the time-lapse plays it owns the office; it asks for a fresh snapshot when it stops. What isn't part of
      // the replayed office (notifications, settings, the office's own update…) still applies.
      if (!OUTSIDE_REPLAY.has(ev.type)) {
        if (useStore.getState().replaying) return;
        if (awaitingSnapshot) {
          if (ev.type !== 'snapshot') return;
          awaitingSnapshot = false;
        }
      }
      useStore.getState().apply(ev);
    } catch (err) {
      console.error('bad server event', err);
    }
    hitchWs(type, bytes, performance.now() - from); // the hitch recorder: what each message cost to apply
  };
  ws.onclose = () => {
    const s = useStore.getState();
    s.setConnected(false);
    // A drop while the office updates itself is the restart: say so, and look for it coming back sooner.
    const restarting = s.restarting || restartExpected(s.officeUpdate);
    if (restarting !== s.restarting) s.setRestarting(restarting);
    setTimeout(connect, Math.min(restarting ? 2000 : 8000, 500 * 2 ** retry++));
  };
}
