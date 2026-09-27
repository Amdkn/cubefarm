// Types shared between the swarm server and the 3D client.

export type AgentStatus =
  | 'idle' // at desk, nothing assigned
  | 'preparing' // setting up the git worktree
  | 'working' // Claude Code session running
  | 'done' // finished, PR opened (or finished without one)
  | 'error' // session failed
  | 'stopped'; // manager stopped it

export type LogKind = 'text' | 'tool' | 'result' | 'system' | 'error' | 'manager' | 'done' | 'thinking';

export interface LogLine {
  id: number;
  t: number; // epoch ms
  kind: LogKind;
  text: string;
  tool?: string; // tool name for kind === 'tool'
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  createdAt: string;
}

export interface PullInfo {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  reviewDecision: string | null;
  closesIssues: number[];
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  checks: 'pending' | 'passing' | 'failing' | 'none';
}

export interface RepoView {
  id: string; // "owner/name"
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number; // 1-based floor number in the building
  color: string; // accent color for the floor
  autoAssign: boolean;
  browserTesting: boolean;
  links: string[]; // ids of related repos this floor's agents can read for context
  cloneStatus: 'pending' | 'cloning' | 'ready' | 'error';
  cloneError?: string;
  issues: IssueInfo[]; // open issues
  pulls: PullInfo[]; // open + recently merged PRs
  lastSync: number | null;
  syncError?: string;
}

export type AgentRole = 'dev' | 'qa';

/** How the cartoon character is drawn. Picked from the agent's name when hired; the manager can change it. */
export type AgentLook = 'feminine' | 'masculine';

/** What an agent is currently doing: implementing an issue, testing a PR, or fixing a PR after QA. */
export type AgentTask = 'issue' | 'qa' | 'fix';

export interface AgentView {
  id: string;
  name: string;
  repoId: string;
  role: AgentRole;
  look: AgentLook;
  task: AgentTask | null;
  desk: number; // desk slot on the floor (dev desks and QA lab stations are numbered separately)
  color: string; // shirt color
  hair: string; // hair color
  skin: string;
  model: string; // '' = use the swarm default model, or a model id / alias
  effort: EffortLevel | ''; // '' = use the swarm default effort
  status: AgentStatus;
  issueNumber: number | null; // devs: the issue being worked on
  issueTitle: string | null; // devs: issue title; QA: title of the PR under test
  branch: string | null;
  prNumber: number | null; // devs: the PR they opened; QA: the PR under test
  prUrl: string | null;
  currentTool: string | null;
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  browserUrl: string | null;
  hasScreenshot: boolean;
  screenshotAt: number | null;
  lastError: string | null;
  log: LogLine[]; // tail of the terminal log (full buffer on snapshot)
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type QaStatus =
  | 'queued' // waiting for a free QA tester
  | 'testing' // a QA tester is on it
  | 'passed' // ready to merge
  | 'failed' // failed; waiting for the dev who wrote it to be free
  | 'fixing' // the dev is fixing what QA found
  | 'needs-human'; // failed too many rounds, or nobody can fix it automatically

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  details: string;
}

export interface QaView {
  repoId: string;
  prNumber: number;
  status: QaStatus;
  round: number; // 1-based QA round
  devAgentId: string | null; // who wrote it (null for PRs opened outside the swarm)
  qaAgentId: string | null; // who is testing / last tested it
  summary: string | null; // latest QA summary
  checks: QaCheck[];
  commentUrl: string | null; // the PR comment with the latest QA report
  updatedAt: number;
}

export interface SwarmSettings {
  maxConcurrent: number; // cap on simultaneously running Claude Code sessions
  defaultModel: string;
  defaultEffort: EffortLevel;
  permissionMode: 'guarded' | 'bypass';
}

export interface WorldSnapshot {
  user: string | null; // gh login
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  workspaceRoot: string;
  settings: SwarmSettings;
  repos: RepoView[];
  agents: AgentView[];
  qa: QaView[];
}

export type ServerEvent =
  | { type: 'snapshot'; data: WorldSnapshot }
  | { type: 'repo'; repo: RepoView }
  | { type: 'repoRemoved'; repoId: string }
  | { type: 'agent'; agent: Omit<AgentView, 'log'> }
  | { type: 'agentRemoved'; agentId: string }
  | { type: 'log'; agentId: string; lines: LogLine[] }
  | { type: 'screen'; agentId: string; url: string | null; at: number }
  | { type: 'qa'; qa: QaView }
  | { type: 'qaRemoved'; repoId: string; prNumber: number }
  | { type: 'settings'; settings: SwarmSettings }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string };

export interface GhRepoSummary {
  nameWithOwner: string;
  description: string;
  visibility: string;
  updatedAt: string;
}
