import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Backend } from './backend.ts';
import type { LogEntry, SessionHandle, SessionResult } from './agentRunner.ts';
import type { PrDetails } from './github.ts';
import { HOME_DIR, LOG_BUFFER, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS, WORKSPACE_ROOT } from './config.ts';
import type {
  AgentLook,
  AgentRole,
  AgentStatus,
  AgentTask,
  AgentView,
  EffortLevel,
  IssueInfo,
  LogLine,
  PullInfo,
  QaCheck,
  QaView,
  RepoView,
  ServerEvent,
  SwarmSettings,
  WorldSnapshot,
} from '../shared/types.ts';

// ---------- persisted shape ----------

interface PersistedRepo {
  id: string;
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number;
  color: string;
  autoAssign: boolean;
  browserTesting: boolean;
  links: string[]; // other connected repos this floor's agents may read
  addedAt: number;
}

interface PersistedAgent {
  id: string;
  name: string;
  repoId: string;
  role: AgentRole;
  look: AgentLook;
  task: AgentTask | null;
  desk: number;
  color: string;
  hair: string;
  skin: string;
  model: string;
  effort: EffortLevel | '';
  status: AgentStatus;
  issueNumber: number | null;
  issueTitle: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  sessionId: string | null;
  lastError: string | null;
  logTail: LogLine[];
}

/** A pull request's trip through QA. */
interface QaRecord extends QaView {
  issueNumber: number | null;
  devSessionId: string | null; // the dev's Claude Code session, resumed to fix QA findings
  fixInstructions: string | null;
  sessionFailures: number;
}

interface Persisted {
  settings: SwarmSettings;
  repos: PersistedRepo[];
  agents: PersistedAgent[];
  qa: QaRecord[];
}

interface Shot {
  data: Buffer;
  mime: string;
  url: string | null;
  at: number;
}

interface AgentRuntime {
  log: LogLine[];
  pending: LogLine[];
  session: SessionHandle | null;
  currentTool: string | null;
  browserUrl: string | null;
  screenshot: { data: Buffer; mime: string; at: number } | null;
  shots: Shot[]; // every screenshot of the current session (QA evidence)
}

interface RepoRuntime {
  issues: IssueInfo[];
  pulls: PullInfo[];
  lastSync: number | null;
  syncError?: string;
  syncing: boolean;
  cloneStatus: RepoView['cloneStatus'];
  cloneError?: string;
}

interface QaReport {
  verdict: 'pass' | 'fail';
  summary: string;
  checks: QaCheck[];
  commands: { command: string; result: string }[];
  screenshots: string[];
  fixInstructions?: string;
}

// ---------- flavour ----------

const FLOOR_COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#3a86ff'];
const HAIR = ['#2b2118', '#6b4226', '#c68642', '#f2d16b', '#d94f30', '#1c1c1c', '#8e8e8e', '#5b3cc4', '#e76f51'];
const SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
const DEV_NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido', 'Hedy', 'Tim', 'Katherine',
  'Bjarne', 'Frances', 'Edsger', 'Anita', 'Donald', 'Sophie', 'Yukihiro', 'Jean', 'Niklaus', 'Karen', 'Brendan',
];
const QA_NAMES = ['Sherlock', 'Marple', 'Poirot', 'Nancy', 'Columbo', 'Fletcher', 'Watson', 'Morse', 'Holmes', 'Maigret'];

// Names that get the feminine character look: everyone in the name pools above, plus common first names
// for agents the manager names themselves. The manager can always change an agent's look in the console.
const FEMININE_NAMES = new Set(
  (
    'ada grace margaret barbara radia hedy katherine frances anita sophie jean karen marple nancy fletcher ' +
    'alice amanda amelia amy ana anna anne aisha astrid ava bella beth carla caroline charlotte chloe claire clara ' +
    'diana elena elizabeth ella ellie emily emma eva fatima fiona freya georgia hannah harper helen holly ingrid iris ' +
    'isabella ivy jane jasmine jessica julia kate laura leah leila lena lily linda lisa lucy maria marie mary maya mei ' +
    'mia mila monica naomi natalie nina nora olivia paula priya rachel rose ruby sandra sara sarah scarlett sofia ' +
    'stella susan tess tessa tina vera victoria yuki zara zoe'
  ).split(' '),
);
const lookFor = (name: string): AgentLook => (FEMININE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase()) ? 'feminine' : 'masculine');
const LOOKS: AgentLook[] = ['feminine', 'masculine'];
const MAX_DESKS: Record<AgentRole, number> = { dev: 12, qa: 3 };
const MAX_QA_ROUNDS = 3;
// Every agent runs Claude Opus 5.5 at medium effort unless the manager overrides it.
const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'agent';

const BUSY: AgentStatus[] = ['preparing', 'working'];
const FREE: AgentStatus[] = ['idle', 'done'];

// The latest browser screenshot per agent is kept on disk so monitors survive a server restart.
const SCREENS_DIR = path.join(HOME_DIR, 'screens');
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const screenFile = (agentId: string, mime: string) => path.join(SCREENS_DIR, `${agentId}.${MIME_EXT[mime] ?? 'img'}`);

async function loadScreen(agentId: string): Promise<{ data: Buffer; mime: string; at: number } | null> {
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const file = path.join(SCREENS_DIR, `${agentId}.${ext}`);
    try {
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      return { data, mime, at: stat.mtimeMs };
    } catch {
      // try the next extension
    }
  }
  return null;
}

async function removeScreens(agentId: string) {
  await Promise.all(Object.values(MIME_EXT).map((ext) => fs.rm(path.join(SCREENS_DIR, `${agentId}.${ext}`), { force: true })));
}

// ---------- QA report ----------

const QA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands', 'screenshots'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'], description: 'pass only if the change works and meets the issue requirements' },
    summary: { type: 'string', description: 'Two to four sentences for the pull request comment.' },
    checks: {
      type: 'array',
      description: 'Each acceptance criterion, test run or scenario you verified.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'result', 'details'],
        properties: {
          name: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string', description: 'What you did and what you observed.' },
        },
      },
    },
    commands: {
      type: 'array',
      description: 'Test suites, linters, builds and other commands you ran.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'result'],
        properties: { command: { type: 'string' }, result: { type: 'string', description: 'e.g. "42 passed, 0 failed"' } },
      },
    },
    screenshots: {
      type: 'array',
      description: 'One short caption per screenshot you took with browser_take_screenshot, in the order you took them.',
      items: { type: 'string' },
    },
    fixInstructions: { type: 'string', description: 'When the verdict is fail: precise, actionable instructions for the developer.' },
  },
};

function parseReport(result: SessionResult): QaReport | null {
  let raw: unknown = result.structured;
  if (!raw && result.text) {
    const json = result.text.match(/\{[\s\S]*\}/);
    if (json) {
      try {
        raw = JSON.parse(json[0]);
      } catch {
        raw = null;
      }
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<QaReport>;
  if (r.verdict !== 'pass' && r.verdict !== 'fail') return null;
  return {
    verdict: r.verdict,
    summary: String(r.summary ?? ''),
    checks: Array.isArray(r.checks) ? r.checks.map((c) => ({ name: String(c.name ?? ''), result: c.result === 'fail' ? 'fail' : c.result === 'skip' ? 'skip' : 'pass', details: String(c.details ?? '') })) : [],
    commands: Array.isArray(r.commands) ? r.commands.map((c) => ({ command: String(c.command ?? ''), result: String(c.result ?? '') })) : [],
    screenshots: Array.isArray(r.screenshots) ? r.screenshots.map(String) : [],
    fixInstructions: r.fixInstructions ? String(r.fixInstructions) : undefined,
  };
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Swarm {
  private state: Persisted = {
    settings: { maxConcurrent: 4, defaultModel: DEFAULT_MODEL, defaultEffort: 'medium', permissionMode: 'guarded' },
    repos: [],
    agents: [],
    qa: [],
  };
  private agentRt = new Map<string, AgentRuntime>();
  private repoRt = new Map<string, RepoRuntime>();
  private clients = new Set<WebSocket>();
  private user: string | null = null;
  private ghError: string | undefined;
  private saveTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private logSeq = 1;

  constructor(private backend: Backend) {}

  // ---------- lifecycle ----------

  async init() {
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      const loaded = JSON.parse(raw) as Partial<Persisted>;
      this.state = {
        settings: { ...this.state.settings, ...loaded.settings },
        repos: (loaded.repos ?? []).map((r) => ({ ...r, links: r.links ?? [] })),
        agents: (loaded.agents ?? []).map((a) => ({
          ...a,
          effort: a.effort ?? '',
          role: a.role ?? 'dev',
          look: a.look ?? lookFor(a.name),
          task: a.task ?? (a.issueNumber ? 'issue' : null),
        })),
        qa: loaded.qa ?? [],
      };
      if (!this.state.settings.defaultModel) this.state.settings.defaultModel = DEFAULT_MODEL;
      if (!EFFORTS.includes(this.state.settings.defaultEffort)) this.state.settings.defaultEffort = 'medium';
    } catch {
      // first run
    }
    const interrupted: PersistedAgent[] = [];
    for (const a of this.state.agents) {
      const tail = a.logTail ?? [];
      for (const l of tail) this.logSeq = Math.max(this.logSeq, l.id + 1);
      this.agentRt.set(a.id, { log: tail, pending: [], session: null, currentTool: null, browserUrl: null, screenshot: await loadScreen(a.id), shots: [] });
      if (BUSY.includes(a.status)) {
        a.status = 'stopped';
        a.lastError = 'The swarm server restarted while this agent was working.';
        interrupted.push(a);
      }
    }
    for (const r of this.state.repos) this.repoRt.set(r.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending' });

    try {
      this.user = await this.backend.user();
    } catch (err) {
      this.ghError = `GitHub CLI is not ready: ${(err as Error).message}. Run "gh auth login".`;
      console.warn(this.ghError);
    }

    if (this.backend.demo && this.state.repos.length === 0) {
      for (const r of await this.backend.listMyRepos()) {
        const repo = await this.connectRepo(r.nameWithOwner);
        for (let i = 0; i < (repo.floor === 1 ? 5 : 3); i++) this.hireAgent(repo.id, {});
        this.updateRepo(repo.id, { autoAssign: true });
      }
    }
    for (const r of this.state.repos) this.ensureQaTester(r);

    for (const r of this.state.repos) void this.cloneRepo(r.id);
    await Promise.all(this.state.repos.map((r) => this.syncRepo(r.id)));
    // Nothing is running yet, so anything still alive in a desk is left over from before the restart.
    await Promise.all(
      this.state.agents.map((a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        return repo ? this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a)).catch(() => undefined) : undefined;
      }),
    );
    this.recover(interrupted);
    setInterval(() => this.state.repos.forEach((r, i) => setTimeout(() => void this.syncRepo(r.id), i * 1500)), SYNC_INTERVAL_MS);
    setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    this.save();
    setTimeout(() => this.schedule(), 1000);
  }

  /** Agents cut off by a server restart pick their Claude Code session back up (QA and demo agents start over). */
  private recover(agents: PersistedAgent[]) {
    for (const a of agents) {
      if (a.task === 'qa' || this.backend.demo || !a.sessionId || !a.branch) {
        this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Starting over from the queue.' }]);
        const rec = a.task === 'qa' ? this.state.qa.find((q) => q.qaAgentId === a.id && q.status === 'testing') : undefined;
        if (rec) this.setQa(rec, { status: 'queued' });
        const fix = a.task === 'fix' ? this.state.qa.find((q) => q.devAgentId === a.id && q.status === 'fixing') : undefined;
        if (fix) this.setQa(fix, { status: 'failed' });
        this.clearTask(a);
        continue;
      }
      if (this.running() >= this.state.settings.maxConcurrent) continue; // stays 'stopped'; the manager can resume it later
      void this.message(a.id, 'The office server restarted while you were working. Check the state of your worktree and continue where you left off.').catch((err) =>
        console.warn(`could not resume ${a.name}`, err),
      );
    }
  }

  // ---------- views ----------

  private repoView(r: PersistedRepo): RepoView {
    const rt = this.repoRt.get(r.id)!;
    return {
      id: r.id,
      fullName: r.fullName,
      description: r.description,
      url: r.url,
      defaultBranch: r.defaultBranch,
      floor: r.floor,
      color: r.color,
      autoAssign: r.autoAssign,
      browserTesting: r.browserTesting,
      links: r.links,
      cloneStatus: rt.cloneStatus,
      cloneError: rt.cloneError,
      issues: rt.issues,
      pulls: rt.pulls,
      lastSync: rt.lastSync,
      syncError: rt.syncError,
    };
  }

  private agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const rt = this.agentRt.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      look: a.look,
      task: a.task,
      desk: a.desk,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      model: a.model,
      effort: a.effort,
      status: a.status,
      issueNumber: a.issueNumber,
      issueTitle: a.issueTitle,
      branch: a.branch,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      currentTool: rt.currentTool,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      costUsd: a.costUsd,
      turns: a.turns,
      browserUrl: rt.browserUrl,
      hasScreenshot: !!rt.screenshot,
      screenshotAt: rt.screenshot?.at ?? null,
      lastError: a.lastError,
      log: withLog ? rt.log : [],
    };
  }

  private qaView(q: QaRecord): QaView {
    return {
      repoId: q.repoId,
      prNumber: q.prNumber,
      status: q.status,
      round: q.round,
      devAgentId: q.devAgentId,
      qaAgentId: q.qaAgentId,
      summary: q.summary,
      checks: q.checks,
      commentUrl: q.commentUrl,
      updatedAt: q.updatedAt,
    };
  }

  snapshot(): WorldSnapshot {
    return {
      user: this.user,
      ghReady: !this.ghError,
      ghError: this.ghError,
      demo: this.backend.demo,
      workspaceRoot: WORKSPACE_ROOT,
      settings: this.state.settings,
      repos: this.state.repos.map((r) => this.repoView(r)),
      agents: this.state.agents.map((a) => this.agentView(a, true)),
      qa: this.state.qa.map((q) => this.qaView(q)),
    };
  }

  screenshot(agentId: string) {
    return this.agentRt.get(agentId)?.screenshot ?? null;
  }

  // ---------- clients ----------

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.send(ws, { type: 'snapshot', data: this.snapshot() });
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
  }

  private broadcast(ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  private toast(level: 'info' | 'success' | 'error', text: string) {
    this.broadcast({ type: 'toast', level, text });
  }

  private emitRepo(r: PersistedRepo) {
    this.broadcast({ type: 'repo', repo: this.repoView(r) });
  }

  private emitAgent(a: PersistedAgent) {
    const { log: _log, ...rest } = this.agentView(a, false);
    this.broadcast({ type: 'agent', agent: rest });
  }

  private setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    Object.assign(rec, patch, { updatedAt: Date.now() });
    this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    this.save();
  }

  private appendLog(a: PersistedAgent, entries: LogEntry[]) {
    const rt = this.agentRt.get(a.id);
    if (!rt) return;
    const t = Date.now();
    for (const e of entries) {
      const line: LogLine = { id: this.logSeq++, t, kind: e.kind, text: e.text, tool: e.tool };
      rt.log.push(line);
      rt.pending.push(line);
    }
    if (rt.log.length > LOG_BUFFER) rt.log.splice(0, rt.log.length - LOG_BUFFER);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushLogs(), 120);
  }

  private flushLogs() {
    this.flushTimer = null;
    for (const [agentId, rt] of this.agentRt) {
      if (rt.pending.length === 0) continue;
      this.broadcast({ type: 'log', agentId, lines: rt.pending });
      rt.pending = [];
    }
    this.save();
  }

  // ---------- persistence ----------

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      for (const a of this.state.agents) a.logTail = (this.agentRt.get(a.id)?.log ?? []).slice(-200);
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      const tmp = `${STATE_FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.state, null, 2));
      await fs.rename(tmp, STATE_FILE);
    }, 1500);
  }

  // ---------- lookups ----------

  private repo(id: string) {
    const r = this.state.repos.find((x) => x.id === id);
    if (!r) throw new HttpError(404, `Repo ${id} is not connected`);
    return r;
  }

  private agent(id: string) {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, `No agent ${id}`);
    return a;
  }

  private running() {
    return this.state.agents.filter((a) => BUSY.includes(a.status)).length;
  }

  private agentSlug(a: PersistedAgent) {
    return `${slugify(a.name)}-${a.id.slice(0, 4)}`;
  }

  private clearTask(a: PersistedAgent) {
    Object.assign(a, { status: 'idle', task: null, issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null, lastError: null });
    this.emitAgent(a);
  }

  // ---------- GitHub / repos ----------

  listGithubRepos(owner?: string) {
    return this.backend.listMyRepos(owner);
  }

  async connectRepo(fullName: string): Promise<RepoView> {
    const existing = this.state.repos.find((r) => r.id.toLowerCase() === fullName.toLowerCase());
    if (existing) throw new HttpError(409, `${fullName} is already floor ${existing.floor}`);
    const meta = await this.backend.repoMeta(fullName);
    const floor = this.state.repos.reduce((m, r) => Math.max(m, r.floor), 0) + 1;
    const repo: PersistedRepo = {
      id: meta.nameWithOwner,
      fullName: meta.nameWithOwner,
      description: meta.description,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      floor,
      color: FLOOR_COLORS[(floor - 1) % FLOOR_COLORS.length],
      autoAssign: false,
      browserTesting: true,
      links: [],
      addedAt: Date.now(),
    };
    this.state.repos.push(repo);
    this.repoRt.set(repo.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending' });
    this.save();
    this.emitRepo(repo);
    this.toast('success', `${repo.fullName} moved into floor ${floor}`);
    this.ensureQaTester(repo);
    void this.cloneRepo(repo.id);
    void this.syncRepo(repo.id);
    return this.repoView(repo);
  }

  async createRepo(name: string, opts: { description?: string; visibility: 'private' | 'public'; owner?: string }) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, 'Repo names may only contain letters, numbers, ".", "-" and "_"');
    const fullName = await this.backend.createRepo(name, opts);
    return this.connectRepo(fullName);
  }

  disconnectRepo(id: string) {
    const repo = this.repo(id);
    for (const a of this.state.agents.filter((x) => x.repoId === id)) this.fireAgent(a.id, true);
    this.state.repos = this.state.repos.filter((r) => r.id !== id);
    for (const q of this.state.qa.filter((x) => x.repoId === id)) this.broadcast({ type: 'qaRemoved', repoId: id, prNumber: q.prNumber });
    this.state.qa = this.state.qa.filter((q) => q.repoId !== id);
    for (const r of this.state.repos) r.links = r.links.filter((l) => l !== id);
    this.repoRt.delete(id);
    // Keep floors contiguous.
    this.state.repos.sort((a, b) => a.floor - b.floor).forEach((r, i) => (r.floor = i + 1));
    this.save();
    this.broadcast({ type: 'repoRemoved', repoId: id });
    for (const r of this.state.repos) this.emitRepo(r);
    this.toast('info', `${repo.fullName} disconnected (files kept in the workspace folder)`);
  }

  updateRepo(id: string, patch: Partial<Pick<PersistedRepo, 'autoAssign' | 'browserTesting' | 'color' | 'links'>>) {
    const repo = this.repo(id);
    if (patch.autoAssign !== undefined) repo.autoAssign = !!patch.autoAssign;
    if (patch.browserTesting !== undefined) repo.browserTesting = !!patch.browserTesting;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) repo.color = patch.color;
    if (Array.isArray(patch.links)) repo.links = patch.links.filter((l) => l !== id && this.state.repos.some((r) => r.id === l));
    this.save();
    this.emitRepo(repo);
    setTimeout(() => this.schedule(), 200);
    return this.repoView(repo);
  }

  private async cloneRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.cloneStatus === 'cloning') return;
    rt.cloneStatus = 'cloning';
    rt.cloneError = undefined;
    this.emitRepo(repo);
    try {
      await this.backend.ensureClone(repo.fullName);
      rt.cloneStatus = 'ready';
    } catch (err) {
      rt.cloneStatus = 'error';
      rt.cloneError = (err as Error).message;
      this.toast('error', `Could not clone ${repo.fullName}: ${rt.cloneError}`);
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  async syncRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.syncing) return;
    rt.syncing = true;
    try {
      const [issues, pulls] = await Promise.all([this.backend.listIssues(repo.fullName), this.backend.listPulls(repo.fullName)]);
      rt.issues = issues;
      rt.pulls = pulls;
      rt.lastSync = Date.now();
      rt.syncError = undefined;
      this.reconcilePulls(repo, pulls);
    } catch (err) {
      rt.syncError = (err as Error).message;
    } finally {
      rt.syncing = false;
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  /** Keep agents and QA records in step with what happened to PRs on GitHub. */
  private reconcilePulls(repo: PersistedRepo, pulls: PullInfo[]) {
    for (const a of this.state.agents) {
      if (a.repoId !== repo.id || a.role !== 'dev' || a.prNumber == null || BUSY.includes(a.status) || a.status === 'idle') continue;
      const pr = pulls.find((p) => p.number === a.prNumber);
      if (!pr || pr.state === 'OPEN') continue;
      this.appendLog(a, [{ kind: 'done', text: pr.state === 'MERGED' ? `🎉 PR #${pr.number} was merged. Ready for the next issue.` : `PR #${pr.number} was closed without merging.` }]);
      this.clearTask(a);
    }

    // Finished PRs leave QA.
    for (const q of this.state.qa.filter((x) => x.repoId === repo.id)) {
      const pr = pulls.find((p) => p.number === q.prNumber);
      if (pr && pr.state !== 'OPEN' && q.status !== 'testing' && q.status !== 'fixing') {
        this.state.qa = this.state.qa.filter((x) => x !== q);
        this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber: q.prNumber });
      }
    }

    // Every swarm PR goes through QA, including ones opened before QA existed or while the server was down.
    for (const pr of pulls) {
      if (pr.state !== 'OPEN' || pr.isDraft || !pr.headRefName.startsWith('swarm/')) continue;
      if (this.state.qa.some((q) => q.repoId === repo.id && q.prNumber === pr.number)) continue;
      const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role === 'dev' && (a.prNumber === pr.number || a.branch === pr.headRefName));
      this.queueQa(repo, pr.number, dev ?? null, pr.closesIssues[0] ?? null);
    }
    this.save();
  }

  async createIssue(repoId: string, title: string, body: string, assignTo?: string) {
    const repo = this.repo(repoId);
    if (!title.trim()) throw new HttpError(400, 'An issue needs a title');
    const number = await this.backend.createIssue(repo.fullName, title.trim(), body);
    await this.syncRepo(repo.id);
    this.toast('success', `Issue #${number} filed on ${repo.fullName}`);
    if (assignTo) await this.assign(assignTo, number);
    else setTimeout(() => this.schedule(), 200);
    return number;
  }

  async mergePull(repoId: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    const repo = this.repo(repoId);
    await this.backend.mergePull(repo.fullName, number, method);
    this.toast('success', `Merged PR #${number} into ${repo.defaultBranch}`);
    await this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 200);
  }

  async closePull(repoId: string, number: number) {
    const repo = this.repo(repoId);
    await this.backend.closePull(repo.fullName, number);
    await this.syncRepo(repo.id);
  }

  // ---------- agents ----------

  hireAgent(repoId: string, opts: { name?: string; model?: string; effort?: string; role?: string; look?: string }) {
    const repo = this.repo(repoId);
    const role: AgentRole = opts.role === 'qa' ? 'qa' : 'dev';
    const used = new Set(this.state.agents.filter((a) => a.repoId === repo.id && a.role === role).map((a) => a.desk));
    let desk = 0;
    while (used.has(desk)) desk++;
    if (desk >= MAX_DESKS[role]) {
      throw new HttpError(400, role === 'qa' ? `The QA lab on floor ${repo.floor} is full (${MAX_DESKS.qa} stations)` : `Floor ${repo.floor} is full (${MAX_DESKS.dev} desks)`);
    }
    const taken = new Set(this.state.agents.map((a) => a.name));
    const pool = role === 'qa' ? QA_NAMES : DEV_NAMES;
    const name = opts.name?.trim() || pool.find((n) => !taken.has(n)) || `${role === 'qa' ? 'Tester' : 'Agent'} ${this.state.agents.length + 1}`;
    const agent: PersistedAgent = {
      id: crypto.randomUUID(),
      name,
      repoId: repo.id,
      role,
      look: LOOKS.includes(opts.look as AgentLook) ? (opts.look as AgentLook) : lookFor(name),
      task: null,
      desk,
      color: pick(SHIRTS),
      hair: pick(HAIR),
      skin: pick(SKIN),
      model: opts.model ?? '',
      effort: EFFORTS.includes(opts.effort as EffortLevel) ? (opts.effort as EffortLevel) : '',
      status: 'idle',
      issueNumber: null,
      issueTitle: null,
      branch: null,
      prNumber: null,
      prUrl: null,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      sessionId: null,
      lastError: null,
      logTail: [],
    };
    this.state.agents.push(agent);
    this.agentRt.set(agent.id, { log: [], pending: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [] });
    this.appendLog(agent, [
      { kind: 'system', text: role === 'qa' ? `🔍 ${name} joined the QA lab on floor ${repo.floor} (${repo.fullName}).` : `👋 ${name} joined floor ${repo.floor} (${repo.fullName}).` },
    ]);
    this.save();
    this.broadcast({ type: 'agent', agent: this.agentView(agent, false) });
    setTimeout(() => this.schedule(), 200);
    return this.agentView(agent, true);
  }

  /** Every floor has at least one QA tester. */
  private ensureQaTester(repo: PersistedRepo) {
    if (this.state.agents.some((a) => a.repoId === repo.id && a.role === 'qa')) return;
    this.hireAgent(repo.id, { role: 'qa' });
  }

  updateAgent(id: string, patch: { name?: string; model?: string; effort?: string; look?: string }) {
    const a = this.agent(id);
    if (patch.name?.trim() && patch.name.trim() !== a.name) {
      a.name = patch.name.trim().slice(0, 24);
      a.look = lookFor(a.name);
    }
    if (LOOKS.includes(patch.look as AgentLook)) a.look = patch.look as AgentLook;
    if (patch.model !== undefined) a.model = String(patch.model).trim();
    if (patch.effort !== undefined) a.effort = EFFORTS.includes(patch.effort as EffortLevel) ? (patch.effort as EffortLevel) : '';
    this.save();
    this.emitAgent(a);
  }

  fireAgent(id: string, force = false) {
    const a = this.agent(id);
    if (!force && a.role === 'qa' && this.state.agents.filter((x) => x.repoId === a.repoId && x.role === 'qa').length <= 1) {
      throw new HttpError(409, `${a.name} is the only QA tester on this floor, and every floor needs at least one.`);
    }
    this.agentRt.get(id)?.session?.stop();
    void removeScreens(id);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id) q.devAgentId = null;
      if (q.devAgentId === null && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (repo) {
      const slug = this.agentSlug(a);
      void this.backend
        .releaseDesk(repo.fullName, slug, this.port(a))
        .then(() => this.backend.removeDesk(repo.fullName, slug))
        .catch(() => undefined);
    }
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    this.agentRt.delete(id);
    this.save();
    this.broadcast({ type: 'agentRemoved', agentId: id });
  }

  stopAgent(id: string) {
    const a = this.agent(id);
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Stopped by manager';
    this.appendLog(a, [{ kind: 'manager', text: '■ Manager stopped this session.' }]);
    this.agentRt.get(id)?.session?.stop();
    this.emitAgent(a);
    this.save();
  }

  resetAgent(id: string) {
    const a = this.agent(id);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is busy; stop them first`);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    this.clearTask(a);
    this.appendLog(a, [{ kind: 'system', text: '↺ Cleared desk. Ready for new work.' }]);
    this.save();
  }

  private issueTaken(repo: PersistedRepo, n: number) {
    if (this.state.agents.some((a) => a.repoId === repo.id && a.role === 'dev' && a.issueNumber === n && a.status !== 'idle')) return true;
    const pulls = this.repoRt.get(repo.id)?.pulls ?? [];
    return pulls.some((p) => p.state === 'OPEN' && (p.closesIssues.includes(n) || p.headRefName.startsWith(`swarm/issue-${n}-`)));
  }

  private ensureSlot() {
    if (this.running() >= this.state.settings.maxConcurrent) {
      throw new HttpError(429, `All ${this.state.settings.maxConcurrent} concurrent session slots are busy. Raise the limit in the manager's office or wait.`);
    }
  }

  async assign(agentId: string, issueNumber: number, note?: string) {
    const a = this.agent(agentId);
    const repo = this.repo(a.repoId);
    if (a.role === 'qa') throw new HttpError(400, `${a.name} is a QA tester; they test pull requests rather than issues.`);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is already working on #${a.issueNumber}`);
    this.ensureSlot();
    const issue = this.repoRt.get(repo.id)?.issues.find((i) => i.number === issueNumber);
    if (!issue) throw new HttpError(404, `Issue #${issueNumber} is not open on ${repo.fullName}`);
    const holder = this.state.agents.find((x) => x.id !== a.id && x.repoId === repo.id && x.issueNumber === issueNumber && BUSY.includes(x.status));
    if (holder) throw new HttpError(409, `${holder.name} is already working on #${issueNumber}`);
    void this.runTask(a, repo, issue, note);
    return this.agentView(a, false);
  }

  private port(a: PersistedAgent) {
    return 5200 + (parseInt(a.id.slice(0, 4), 16) % 700);
  }

  private linkedRepos(repo: PersistedRepo) {
    return repo.links.map((id) => this.state.repos.find((r) => r.id === id)).filter((r): r is PersistedRepo => !!r);
  }

  private buildSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, fixing?: { pr: number; headRef: string }) {
    const linked = this.linkedRepos(repo).map((r) => `- ${r.fullName}: read-only reference clone at ${this.backend.mainDir(r.fullName)}`);
    const push = fixing ? `git push origin HEAD:${fixing.headRef}` : `git push -u origin ${branch}`;
    return [
      `You are ${a.name}, a software engineer on an autonomous agent team ("Office Swarm"). Several teammates work in parallel on other issues of the same repository, each in their own git worktree. Nobody is watching live to answer questions, so make sensible decisions yourself and record assumptions in the PR description. The manager may occasionally send you messages; follow their instructions.`,
      'Every pull request is tested by a QA teammate before the manager merges it. If they find problems you will receive their report; fix the problems on the same branch.',
      '',
      `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
      `Your worktree: ${cwd}`,
      fixing
        ? `You are fixing pull request #${fixing.pr}. Its code is checked out on local branch ${branch}; push fixes with: ${push}. Do not open a new pull request.`
        : `Your branch: ${branch} (already checked out, created from origin/${repo.defaultBranch})`,
      linked.length ? `Related repositories you may read for context (do not modify them):\n${linked.join('\n')}` : '',
      '',
      'Workflow:',
      '1. Read the issue and explore the relevant code before changing anything.',
      '2. Implement the change with focused commits and clear messages.',
      "3. Run the project's existing tests, linters and build (if any) and fix what you broke. Install dependencies first if needed.",
      repo.browserTesting
        ? `4. If the project has a web UI, start its dev server in the background on port ${this.port(a)} (reserved for you, so you don't collide with teammates), then check your change with the Playwright browser tools (mcp__playwright__browser_navigate, browser_snapshot, browser_click, browser_take_screenshot). Stop the dev server when you're done.`
        : '4. Verify the behaviour you changed as directly as you can.',
      `5. Push: ${push}`,
      fixing
        ? '6. Reply with a short summary of what you fixed.'
        : `6. Open a pull request with the GitHub CLI: gh pr create --base ${repo.defaultBranch} --head ${branch} --title "<concise title>" --body "<what changed, how you verified it, assumptions>". The body must contain "Closes #<issue number>".`,
      fixing ? '' : '7. End your final message with the pull request URL on its own line.',
      '',
      'Rules: never push to the default branch, never force-push, never merge pull requests (the manager reviews and merges), and never edit files outside your worktree. If you cannot finish, open a draft PR (gh pr create --draft) explaining what is left and why.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  private beginTask(a: PersistedAgent, patch: Partial<PersistedAgent>, banner: string, preparing: string) {
    const rt = this.agentRt.get(a.id)!;
    Object.assign(a, {
      status: 'preparing' as AgentStatus,
      startedAt: Date.now(),
      endedAt: null,
      costUsd: 0,
      turns: 0,
      lastError: null,
      ...patch,
    });
    rt.screenshot = null;
    rt.browserUrl = null;
    rt.shots = [];
    void removeScreens(a.id);
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${banner} ━━━` },
      { kind: 'system', text: preparing },
    ]);
    this.emitAgent(a);
    this.save();
  }

  private async prepare(a: PersistedAgent, repo: PersistedRepo, base: { pr?: number }, branch: string): Promise<string | null> {
    try {
      if (this.repoRt.get(repo.id)?.cloneStatus !== 'ready') await this.cloneRepo(repo.id);
      await this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a));
      const cwd = await this.backend.prepareDesk(repo.fullName, { defaultBranch: repo.defaultBranch, pr: base.pr }, this.agentSlug(a), branch);
      return a.status === 'preparing' ? cwd : null; // null: stopped or fired while preparing
    } catch (err) {
      if (a.status !== 'preparing') return null;
      a.status = 'error';
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.emitAgent(a);
      this.save();
      return null;
    }
  }

  private async runTask(a: PersistedAgent, repo: PersistedRepo, issue: IssueInfo, note?: string) {
    const branch = `swarm/issue-${issue.number}-${slugify(a.name)}`;
    this.beginTask(
      a,
      { task: 'issue', issueNumber: issue.number, issueTitle: issue.title, branch, prNumber: null, prUrl: null, sessionId: null },
      `Issue #${issue.number}: ${issue.title}`,
      `Preparing worktree on ${branch}…`,
    );
    const cwd = await this.prepare(a, repo, {}, branch);
    if (!cwd) return;

    const prompt = [
      `Please resolve GitHub issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
      '',
      issue.body?.trim() || '(The issue has no description.)',
      note ? `\nNote from the manager: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.startAgentSession(a, repo, cwd, prompt, this.buildSystemAppend(a, repo, cwd, branch));
  }

  private startAgentSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId?: string,
    outputSchema?: Record<string, unknown>,
  ) {
    const rt = this.agentRt.get(a.id)!;
    a.status = 'working';
    this.emitAgent(a);
    rt.session = this.backend.startSession(
      {
        cwd,
        prompt,
        systemAppend,
        model: a.model || this.state.settings.defaultModel,
        effort: a.effort || this.state.settings.defaultEffort,
        browserTesting: repo.browserTesting,
        permissionMode: this.state.settings.permissionMode,
        additionalDirectories: this.linkedRepos(repo).map((r) => this.backend.mainDir(r.fullName)),
        role: a.role,
        outputSchema,
        resumeSessionId,
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => {
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          a.sessionId = id;
        },
        browserUrl: (url) => {
          rt.browserUrl = url;
          this.emitAgent(a);
        },
        screenshot: (data, mime) => {
          const at = Date.now();
          rt.screenshot = { data, mime, at };
          rt.shots.push({ data, mime, url: rt.browserUrl, at });
          if (rt.shots.length > 12) rt.shots.shift();
          this.broadcast({ type: 'screen', agentId: a.id, url: rt.browserUrl, at });
          void removeScreens(a.id)
            .then(() => fs.mkdir(SCREENS_DIR, { recursive: true }))
            .then(() => fs.writeFile(screenFile(a.id, mime), data))
            .catch((err) => console.warn('could not save screenshot', err));
        },
        finished: (result) => void this.onFinished(a, repo, result),
      },
      repo.defaultBranch,
    );
  }

  private async onFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // fired
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    // Dev servers the agent forgot to stop would otherwise keep its port and lock its desk folder.
    void this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a)).catch(() => undefined);

    if (a.task === 'qa') await this.onQaFinished(a, repo, result);
    else if (a.task === 'fix') this.onFixFinished(a, repo, result);
    else await this.onIssueFinished(a, repo, result);

    this.emitAgent(a);
    this.save();
    void this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 500);
  }

  private minutes(a: PersistedAgent) {
    return a.startedAt && a.endedAt ? Math.max(1, Math.round((a.endedAt - a.startedAt) / 60000)) : 0;
  }

  private fail(a: PersistedAgent, result: SessionResult, what: string) {
    a.status = 'error';
    a.lastError = result.errors.join('; ') || 'Session failed';
    this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
    this.toast('error', `${a.name} hit a problem on ${what}: ${a.lastError.slice(0, 120)}`);
  }

  private async onIssueFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const escaped = repo.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = result.text.match(new RegExp(`https://github\\.com/${escaped}/pull/(\\d+)`, 'i'));
    if (m) {
      a.prNumber = Number(m[1]);
      a.prUrl = m[0];
    } else if (a.branch) {
      const pr = await this.backend.prForBranch(repo.fullName, a.branch).catch(() => null);
      if (pr) {
        a.prNumber = pr.number;
        a.prUrl = pr.url;
      }
    }

    if (a.status === 'stopped') return; // the manager already logged the stop
    if (!result.ok) return this.fail(a, result, `#${a.issueNumber}`);
    a.status = 'done';
    this.appendLog(a, [{ kind: 'done', text: `✔ Finished in ${this.minutes(a)}m · ${a.turns} turns${a.prNumber ? ` · PR #${a.prNumber}` : ' · no PR found'}` }]);
    if (a.prNumber) {
      this.queueQa(repo, a.prNumber, a, a.issueNumber);
      this.appendLog(a, [{ kind: 'system', text: `📨 Handed PR #${a.prNumber} to QA.` }]);
      this.toast('success', `${a.name} opened PR #${a.prNumber} for #${a.issueNumber}; it's off to QA`);
    } else {
      this.toast('success', `${a.name} finished #${a.issueNumber}`);
    }
  }

  // ---------- QA ----------

  private queueQa(repo: PersistedRepo, prNumber: number, dev: PersistedAgent | null, issueNumber: number | null) {
    let rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec) {
      if (rec.status === 'testing') return;
      this.setQa(rec, { status: 'queued', devAgentId: dev?.id ?? rec.devAgentId, devSessionId: dev?.sessionId ?? rec.devSessionId });
    } else {
      rec = {
        repoId: repo.id,
        prNumber,
        status: 'queued',
        round: 1,
        devAgentId: dev?.id ?? null,
        qaAgentId: null,
        summary: null,
        checks: [],
        commentUrl: null,
        updatedAt: Date.now(),
        issueNumber,
        devSessionId: dev && dev.prNumber === prNumber ? dev.sessionId : null,
        fixInstructions: null,
        sessionFailures: 0,
      };
      this.state.qa.push(rec);
      this.setQa(rec, {});
    }
    setTimeout(() => this.schedule(), 200);
  }

  /** Manager's "send to QA" for any open PR (including ones opened by people). */
  async sendToQa(repoId: string, prNumber: number) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber && p.state === 'OPEN');
    if (!pr) throw new HttpError(404, `PR #${prNumber} is not open on ${repo.fullName}`);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec?.status === 'testing' || rec?.status === 'fixing') throw new HttpError(409, `PR #${prNumber} is already ${rec.status}`);
    if (rec && (rec.status === 'needs-human' || rec.status === 'passed' || rec.status === 'failed')) {
      // a fresh start: the manager decided it deserves another round
      rec.round += 1;
      rec.sessionFailures = 0;
    }
    const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role === 'dev' && (a.prNumber === prNumber || a.branch === pr.headRefName));
    this.queueQa(repo, prNumber, dev ?? null, pr.closesIssues[0] ?? null);
    this.toast('info', `PR #${prNumber} is queued for QA`);
  }

  private buildQaSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, pr: PrDetails) {
    return [
      `You are ${a.name}, a QA engineer on an autonomous agent team ("Office Swarm"). Developers open pull requests; you independently verify that each one really works before the manager merges it. Be thorough and skeptical, but fair: fail a PR only for real problems (broken behaviour, failing tests or build, the issue's requirements not met, obvious regressions), not for style preferences.`,
      '',
      `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
      `Pull request #${pr.number} "${pr.title}" from branch ${pr.headRefName}: ${pr.url}`,
      `Your worktree: ${cwd}. It has the pull request's code checked out on local branch ${branch}.`,
      '',
      'How to test:',
      '1. Read the PR description and the linked issue, and work out the acceptance criteria.',
      `2. Review what changed: git diff origin/${repo.defaultBranch}...HEAD`,
      "3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).",
      repo.browserTesting
        ? `4. If the project has a UI, start it in the background on port ${this.port(a)} (reserved for you) and exercise the change in a real browser with the Playwright tools: navigate, click, type, resize to a phone size, try edge cases, and check the console for errors. Take a screenshot with browser_take_screenshot of every important state: the screenshots are attached to the PR as evidence. Stop the server afterwards.`
        : '4. Exercise the changed behaviour directly (run the program, call the API, write a quick script).',
      '5. You may write throwaway scripts to probe behaviour, but do not commit them.',
      '',
      'Rules: do not modify the code under test, do not commit, push, comment on, review or merge anything on GitHub. The office posts your report on the pull request. Finish with the structured QA report: verdict, summary, the checks you performed, the commands you ran and one caption per screenshot.',
    ].join('\n');
  }

  private async runQa(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const branch = `qa/pr-${rec.prNumber}-${slugify(a.name)}`;
    this.setQa(rec, { status: 'testing', qaAgentId: a.id });
    this.beginTask(
      a,
      { task: 'qa', issueNumber: rec.issueNumber, issueTitle: `PR #${rec.prNumber}`, branch, prNumber: rec.prNumber, prUrl: null, sessionId: null },
      `QA · PR #${rec.prNumber} · round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );

    let pr: PrDetails;
    let issue: { title: string; body: string } | null = null;
    try {
      pr = await this.backend.prDetails(repo.fullName, rec.prNumber);
      const issueNumber = rec.issueNumber ?? pr.closesIssues[0] ?? null;
      if (issueNumber) issue = await this.backend.issueDetails(repo.fullName, issueNumber).catch(() => null);
      Object.assign(a, { issueTitle: pr.title, prUrl: pr.url });
      this.emitAgent(a);
    } catch (err) {
      a.status = 'error';
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      this.emitAgent(a);
      return;
    }
    if (pr.state !== 'OPEN') {
      this.appendLog(a, [{ kind: 'system', text: `PR #${pr.number} is ${pr.state.toLowerCase()}; nothing to test.` }]);
      this.state.qa = this.state.qa.filter((q) => q !== rec);
      this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber: rec.prNumber });
      this.clearTask(a);
      return;
    }

    const cwd = await this.prepare(a, repo, { pr: rec.prNumber }, branch);
    if (!cwd) {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return;
    }

    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const prompt = [
      `Please QA pull request #${pr.number}: ${pr.title}`,
      `URL: ${pr.url}`,
      `Author: ${dev ? `${dev.name} (developer agent)` : 'a teammate'} · QA round ${rec.round}`,
      rec.round > 1 && rec.summary ? `\nThis is a re-test after fixes. Last round's findings:\n${rec.summary}\n${rec.fixInstructions ?? ''}\nCheck those first, then re-check everything else.` : '',
      '',
      'PR description:',
      pr.body.trim() || '(empty)',
      issue ? `\nLinked issue: ${issue.title}\n${issue.body.trim() || '(no description)'}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');

    this.startAgentSession(a, repo, cwd, prompt, this.buildQaSystemAppend(a, repo, cwd, branch, pr), undefined, QA_SCHEMA);
  }

  private async onQaFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    const rt = this.agentRt.get(a.id)!;
    const report = result.ok ? parseReport(result) : null;

    if (a.status === 'stopped' || !report) {
      if (a.status !== 'stopped') this.fail(a, { ...result, errors: result.errors.length ? result.errors : ['QA finished without a usable report'] }, `QA of PR #${a.prNumber}`);
      if (rec) {
        const failures = rec.sessionFailures + 1;
        this.setQa(rec, {
          status: a.status === 'stopped' || failures >= 2 ? 'needs-human' : 'queued',
          qaAgentId: null,
          sessionFailures: failures,
          summary: a.status === 'stopped' ? 'QA was stopped by the manager.' : rec.summary,
        });
      }
      return;
    }

    a.status = 'done';
    const pass = report.verdict === 'pass';
    this.appendLog(a, [{ kind: pass ? 'done' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${a.prNumber} · ${report.checks.length} checks · ${rt.shots.length} screenshots` }]);

    // Evidence + comment on the PR
    let commentUrl: string | null = null;
    if (rec) {
      try {
        this.appendLog(a, [{ kind: 'system', text: '📎 Uploading evidence and posting the QA report on the PR…' }]);
        const body = await this.renderQaComment(a, repo, rec, report, rt.shots);
        commentUrl = (await this.backend.commentPull(repo.fullName, rec.prNumber, body)) || null;
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ ${commentUrl ?? 'comment posted'}` }]);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ Could not post the QA report: ${(err as Error).message}` }]);
      }
      const nextStatus = pass ? 'passed' : rec.round >= MAX_QA_ROUNDS ? 'needs-human' : 'failed';
      this.setQa(rec, {
        status: nextStatus,
        summary: report.summary,
        checks: report.checks,
        commentUrl: commentUrl ?? rec.commentUrl,
        fixInstructions: report.fixInstructions ?? report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.details}`).join('\n'),
        sessionFailures: 0,
      });
      this.toast(
        pass ? 'success' : 'error',
        pass
          ? `✅ ${a.name} passed PR #${rec.prNumber}: ready to merge`
          : nextStatus === 'needs-human'
            ? `❌ PR #${rec.prNumber} failed QA ${rec.round} times and needs a human`
            : `❌ ${a.name} failed PR #${rec.prNumber}; sending it back to the developer`,
      );
    }
  }

  private async renderQaComment(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, report: QaReport, shots: Shot[]) {
    const pass = report.verdict === 'pass';
    const images: string[] = [];
    const evidence = shots.slice(-8);
    const offset = shots.length - evidence.length;
    const folder = `pr-${rec.prNumber}/round-${rec.round}-${Date.now().toString(36)}`;
    for (const [i, shot] of evidence.entries()) {
      const n = offset + i + 1;
      const ext = MIME_EXT[shot.mime] ?? 'png';
      const file = `${folder}/${String(n).padStart(2, '0')}.${ext}`;
      try {
        const url = await this.backend.uploadEvidence(repo.fullName, file, shot.data);
        const caption = report.screenshots[n - 1] ?? `Screenshot ${n}`;
        images.push(`**${n}. ${caption}**${shot.url ? ` · \`${shot.url}\`` : ''}\n\n<img src="${url}" alt="${caption.replace(/"/g, "'")}" width="760">`);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ screenshot ${n} upload failed: ${(err as Error).message.slice(0, 120)}` }]);
      }
    }
    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const lines = [
      `## 🔍 QA report: ${pass ? '✅ Passed' : '❌ Failed'}`,
      `**Tester:** ${a.name} (Office Swarm QA agent) · **Round:** ${rec.round}${dev ? ` · **Author:** ${dev.name}` : ''}`,
      '',
      report.summary,
      '',
      '| | Check | Details |',
      '|---|---|---|',
      ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`),
    ];
    if (report.commands.length) {
      lines.push('', '<details><summary>🧪 Commands run</summary>', '', '| Command | Result |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
    }
    if (!pass && report.fixInstructions) lines.push('', '### 🔧 What needs fixing', '', report.fixInstructions);
    if (images.length) lines.push('', '### 📸 Evidence', '', ...images.flatMap((img) => [img, '']));
    else lines.push('', '_No browser screenshots were taken in this round._');
    lines.push('', `<sub>Posted by Office Swarm · ${pass ? 'ready for the manager to merge' : rec.round >= MAX_QA_ROUNDS ? 'needs a human decision' : 'sent back to the developer for fixes'}</sub>`);
    return lines.join('\n');
  }

  /** Send a failed PR back to the developer who wrote it (or any free developer on the floor). */
  private async runFix(dev: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const original = rec.devAgentId === dev.id;
    const pull = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const headRef = pull?.headRefName ?? dev.branch ?? `pr-${rec.prNumber}`;
    const qaAgent = rec.qaAgentId ? this.state.agents.find((x) => x.id === rec.qaAgentId) : null;
    this.setQa(rec, { status: 'fixing', devAgentId: dev.id });
    this.beginTask(
      dev,
      { task: 'fix', issueNumber: rec.issueNumber, issueTitle: pull?.title ?? `PR #${rec.prNumber}`, branch: headRef, prNumber: rec.prNumber, prUrl: pull?.url ?? null },
      `Fixing PR #${rec.prNumber} after QA round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );
    const cwd = await this.prepare(dev, repo, { pr: rec.prNumber }, headRef);
    if (!cwd) {
      if (rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    const failed = rec.checks.filter((c) => c.result === 'fail');
    const prompt = [
      original
        ? `QA tester ${qaAgent?.name ?? 'QA'} tested your pull request #${rec.prNumber} and it FAILED (round ${rec.round}).`
        : `You are taking over pull request #${rec.prNumber} (${pull?.url ?? ''}), written by a teammate, because QA failed it (round ${rec.round}). Read the PR and the linked issue first.`,
      '',
      `QA summary: ${rec.summary ?? ''}`,
      failed.length ? `Failed checks:\n${failed.map((c) => `- ${c.name}: ${c.details}`).join('\n')}` : '',
      rec.fixInstructions ? `\nWhat needs fixing:\n${rec.fixInstructions}` : '',
      rec.commentUrl ? `\nFull report with screenshots: ${rec.commentUrl}` : '',
      '',
      `Fix these problems, re-run the relevant checks, and push to the same branch: git push origin HEAD:${headRef}`,
      'Then reply with a short summary of what you changed. Do not open a new pull request; QA will re-test automatically.',
    ]
      .filter((l) => l !== '')
      .join('\n');
    const resume = original && rec.devSessionId ? rec.devSessionId : undefined;
    this.startAgentSession(dev, repo, cwd, prompt, this.buildSystemAppend(dev, repo, cwd, headRef, { pr: rec.prNumber, headRef }), resume);
  }

  private onFixFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    if (a.status === 'stopped') {
      if (rec?.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    if (!result.ok) {
      this.fail(a, result, `the fix for PR #${a.prNumber}`);
      if (rec) this.setQa(rec, { status: 'needs-human' });
      return;
    }
    a.status = 'done';
    this.appendLog(a, [{ kind: 'done', text: `✔ Fix pushed for PR #${a.prNumber} in ${this.minutes(a)}m. Back to QA.` }]);
    if (rec) {
      this.setQa(rec, { status: 'queued', round: rec.round + 1, devSessionId: a.sessionId ?? rec.devSessionId });
      this.toast('info', `${a.name} pushed fixes for PR #${rec.prNumber}; QA round ${rec.round} is queued`);
    }
  }

  async message(id: string, text: string) {
    const a = this.agent(id);
    const repo = this.repo(a.repoId);
    if (!text.trim()) throw new HttpError(400, 'Empty message');
    const rt = this.agentRt.get(id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
      rt.session.send(text);
      return;
    }
    if (a.role === 'qa') throw new HttpError(409, `${a.name} isn't testing anything right now. Send a PR to QA from the Kanban board.`);
    if (a.status === 'preparing') throw new HttpError(409, `${a.name} is still setting up; try again in a moment`);
    if (!a.sessionId || !a.branch) throw new HttpError(409, `${a.name} has no session to continue. Assign an issue instead.`);
    this.ensureSlot();
    this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
    const cwd = this.backend.deskDir(repo.fullName, this.agentSlug(a));
    a.lastError = null;
    a.startedAt = Date.now();
    if (a.task === null) a.task = 'issue';
    const fixing = a.task === 'fix' && a.prNumber ? { pr: a.prNumber, headRef: a.branch } : undefined;
    this.startAgentSession(a, repo, cwd, text, this.buildSystemAppend(a, repo, cwd, a.branch, fixing), a.sessionId);
  }

  updateSettings(patch: Partial<SwarmSettings>) {
    const s = this.state.settings;
    if (patch.maxConcurrent !== undefined) s.maxConcurrent = Math.max(1, Math.min(32, Math.round(Number(patch.maxConcurrent)) || 1));
    if (patch.defaultModel !== undefined) s.defaultModel = String(patch.defaultModel).trim() || DEFAULT_MODEL;
    if (patch.defaultEffort !== undefined && EFFORTS.includes(patch.defaultEffort)) s.defaultEffort = patch.defaultEffort;
    if (patch.permissionMode === 'guarded' || patch.permissionMode === 'bypass') s.permissionMode = patch.permissionMode;
    this.save();
    this.broadcast({ type: 'settings', settings: s });
    setTimeout(() => this.schedule(), 200);
    return s;
  }

  // ---------- scheduling ----------

  private free(repo: PersistedRepo, role: AgentRole) {
    return this.state.agents.filter((a) => a.repoId === repo.id && a.role === role && FREE.includes(a.status)).sort((x, y) => x.desk - y.desk);
  }

  private scheduleOffset = 0;

  /** Start QA on the oldest waiting PR, or send a failed PR back to its developer. Returns true if work started. */
  private startPipelineWork(repo: PersistedRepo): boolean {
    const queued = this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'queued').sort((x, y) => x.updatedAt - y.updatedAt)[0];
    const tester = queued && this.free(repo, 'qa')[0];
    if (queued && tester) {
      void this.runQa(tester, repo, queued);
      return true;
    }
    const failed = this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'failed').sort((x, y) => x.updatedAt - y.updatedAt);
    for (const rec of failed) {
      const original = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : undefined;
      // Prefer the author; only hand it to someone else if the author has left the floor.
      const dev = original ? (FREE.includes(original.status) ? original : undefined) : this.free(repo, 'dev')[0];
      if (!dev) continue;
      void this.runFix(dev, repo, rec);
      return true;
    }
    return false;
  }

  /** Give a free developer the next backlog issue (auto-assign floors only). Returns true if work started. */
  private startIssueWork(repo: PersistedRepo): boolean {
    const rt = this.repoRt.get(repo.id)!;
    if (!repo.autoAssign) return false;
    const agent = this.free(repo, 'dev')[0];
    if (!agent) return false;
    const next = rt.issues.find((i) => !i.labels.some((l) => /^(swarm:skip|wontfix|question)$/i.test(l)) && !this.issueTaken(repo, i.number));
    if (!next) return false;
    // assign() flips the agent to 'preparing' synchronously, so the next pass sees it as busy.
    void this.assign(agent.id, next.number).catch((err) => console.warn('auto-assign failed', err));
    return agent.status === 'preparing';
  }

  /**
   * Hand out work for free session slots. Finishing beats starting: QA and QA fixes on every floor go before any new issue.
   * Within each phase floors take turns (one job per floor per pass), and the starting floor rotates between calls,
   * so no repo can hog the slots.
   */
  private schedule() {
    const repos = this.state.repos.filter((r) => {
      const rt = this.repoRt.get(r.id);
      return rt && rt.lastSync != null && rt.cloneStatus !== 'error';
    });
    if (repos.length === 0) return;
    this.scheduleOffset = (this.scheduleOffset + 1) % repos.length;
    const order = [...repos.slice(this.scheduleOffset), ...repos.slice(0, this.scheduleOffset)];
    for (const start of [(r: PersistedRepo) => this.startPipelineWork(r), (r: PersistedRepo) => this.startIssueWork(r)]) {
      let progress = true;
      while (progress) {
        progress = false;
        for (const repo of order) {
          if (this.running() >= this.state.settings.maxConcurrent) return;
          if (start(repo)) progress = true;
        }
      }
    }
  }
}
