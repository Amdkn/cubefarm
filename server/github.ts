import { gh, ghJson } from './exec.ts';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../shared/types.ts';

// All GitHub access goes through the gh CLI so it reuses the user's existing `gh auth login`.

export async function currentUser(): Promise<string> {
  return gh(['api', 'user', '--jq', '.login']);
}

export async function listMyRepos(owner?: string): Promise<GhRepoSummary[]> {
  const args = ['repo', 'list'];
  if (owner) args.push(owner);
  args.push('--limit', '200', '--json', 'nameWithOwner,description,visibility,updatedAt');
  const repos = await ghJson<GhRepoSummary[]>(args);
  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface RepoMeta {
  nameWithOwner: string;
  description: string;
  url: string;
  defaultBranch: string;
}

export async function repoMeta(fullName: string): Promise<RepoMeta> {
  const raw = await ghJson<{ nameWithOwner: string; description: string | null; url: string; defaultBranchRef: { name: string } | null }>([
    'repo',
    'view',
    fullName,
    '--json',
    'nameWithOwner,description,url,defaultBranchRef',
  ]);
  return {
    nameWithOwner: raw.nameWithOwner,
    description: raw.description ?? '',
    url: raw.url,
    defaultBranch: raw.defaultBranchRef?.name || 'main',
  };
}

export async function createRepo(name: string, opts: { description?: string; visibility: 'private' | 'public'; owner?: string }): Promise<string> {
  const target = opts.owner ? `${opts.owner}/${name}` : name;
  const args = ['repo', 'create', target, `--${opts.visibility}`, '--add-readme'];
  if (opts.description) args.push('--description', opts.description);
  const out = await gh(args, { timeoutMs: 60_000 });
  // gh prints the new repo URL; normalise to owner/name.
  const match = out.match(/github\.com\/([^/\s]+\/[^/\s]+)/);
  return match ? match[1] : target;
}

export async function listIssues(fullName: string): Promise<IssueInfo[]> {
  const raw = await ghJson<
    { number: number; title: string; body: string; url: string; labels: { name: string }[]; createdAt: string }[]
  >(['issue', 'list', '-R', fullName, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,labels,createdAt']);
  return raw
    .map((i) => ({ number: i.number, title: i.title, body: i.body ?? '', url: i.url, labels: i.labels.map((l) => l.name), createdAt: i.createdAt }))
    .sort((a, b) => a.number - b.number);
}

interface RawPull {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  closingIssuesReferences: { number: number }[] | null;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  statusCheckRollup: { status?: string; conclusion?: string; state?: string }[] | null;
}

const PR_FIELDS =
  'number,title,url,headRefName,state,isDraft,mergeable,reviewDecision,closingIssuesReferences,createdAt,mergedAt,additions,deletions,statusCheckRollup';

function checksOf(rollup: RawPull['statusCheckRollup']): PullInfo['checks'] {
  if (!rollup || rollup.length === 0) return 'none';
  const bad = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'];
  if (rollup.some((c) => bad.includes(c.conclusion ?? '') || bad.includes(c.state ?? ''))) return 'failing';
  if (rollup.some((c) => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')) return 'pending';
  return 'passing';
}

function toPull(p: RawPull): PullInfo {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    headRefName: p.headRefName,
    state: p.state,
    isDraft: p.isDraft,
    mergeable: p.mergeable,
    reviewDecision: p.reviewDecision || null,
    closesIssues: (p.closingIssuesReferences ?? []).map((r) => r.number),
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    additions: p.additions,
    deletions: p.deletions,
    checks: checksOf(p.statusCheckRollup),
  };
}

export async function listPulls(fullName: string): Promise<PullInfo[]> {
  const [open, merged] = await Promise.all([
    ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'open', '--limit', '50', '--json', PR_FIELDS]),
    ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'merged', '--limit', '8', '--json', PR_FIELDS]),
  ]);
  return [...open, ...merged].map(toPull);
}

export async function createIssue(fullName: string, title: string, body: string): Promise<number> {
  const out = await gh(['issue', 'create', '-R', fullName, '--title', title, '--body-file', '-'], { input: body || ' ' });
  const match = out.match(/\/issues\/(\d+)/);
  if (!match) throw new Error(`Could not read the new issue number from gh output: ${out}`);
  return Number(match[1]);
}

export async function mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase'): Promise<void> {
  const pr = await ghJson<{ headRefName: string; isCrossRepository: boolean }>(['pr', 'view', String(number), '-R', fullName, '--json', 'headRefName,isCrossRepository']);
  await gh(['pr', 'merge', String(number), '-R', fullName, `--${method}`], { timeoutMs: 60_000 });
  // Tidy up the swarm branch on the remote; the local worktree is cleaned when the agent takes its next issue.
  if (!pr.isCrossRepository && pr.headRefName.startsWith('swarm/')) {
    await gh(['api', '-X', 'DELETE', `repos/${fullName}/git/refs/heads/${pr.headRefName}`]).catch(() => undefined);
  }
}

export async function closePull(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'close', String(number), '-R', fullName]);
}

export async function prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null> {
  const list = await ghJson<{ number: number; url: string }[]>(['pr', 'list', '-R', fullName, '--head', branch, '--state', 'all', '--json', 'number,url', '--limit', '1']);
  return list[0] ?? null;
}

// ---------- QA support ----------

export interface PrDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  headSha: string;
  isCrossRepository: boolean;
  closesIssues: number[];
  state: 'OPEN' | 'CLOSED' | 'MERGED';
}

export async function prDetails(fullName: string, number: number): Promise<PrDetails> {
  const raw = await ghJson<{
    number: number;
    title: string;
    body: string;
    url: string;
    headRefName: string;
    headRefOid: string;
    isCrossRepository: boolean;
    closingIssuesReferences: { number: number }[] | null;
    state: PrDetails['state'];
  }>(['pr', 'view', String(number), '-R', fullName, '--json', 'number,title,body,url,headRefName,headRefOid,isCrossRepository,closingIssuesReferences,state']);
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    headRefName: raw.headRefName,
    headSha: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    closesIssues: (raw.closingIssuesReferences ?? []).map((r) => r.number),
    state: raw.state,
  };
}

export async function issueDetails(fullName: string, number: number): Promise<{ title: string; body: string }> {
  const raw = await ghJson<{ title: string; body: string }>(['issue', 'view', String(number), '-R', fullName, '--json', 'title,body']);
  return { title: raw.title, body: raw.body ?? '' };
}

export async function commentPull(fullName: string, number: number, body: string): Promise<string> {
  const out = await gh(['pr', 'comment', String(number), '-R', fullName, '--body-file', '-'], { input: body });
  return out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? '';
}

// QA screenshots live on an orphan branch so evidence never lands in the default branch when a PR is merged.
export const EVIDENCE_BRANCH = 'swarm-qa-evidence';
const evidenceReady = new Set<string>();

const ghApiJson = <T>(method: string, endpoint: string, body: unknown) =>
  gh(['api', '-X', method, endpoint, '-H', 'Content-Type: application/json', '--input', '-'], { input: JSON.stringify(body), timeoutMs: 120_000 }).then(
    (out) => (out ? JSON.parse(out) : null) as T,
  );

async function ensureEvidenceBranch(fullName: string) {
  if (evidenceReady.has(fullName)) return;
  try {
    await gh(['api', `repos/${fullName}/git/ref/heads/${EVIDENCE_BRANCH}`]);
  } catch {
    const readme =
      '# QA evidence\n\nScreenshots attached to pull request QA reports by Office Swarm QA agents.\nThis branch has no shared history with the code and is never merged.\n';
    const newTree = await ghApiJson<{ sha: string }>('POST', `repos/${fullName}/git/trees`, {
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: readme }],
    });
    const commit = await ghApiJson<{ sha: string }>('POST', `repos/${fullName}/git/commits`, { message: 'QA evidence branch (Office Swarm)', tree: newTree.sha, parents: [] });
    await ghApiJson('POST', `repos/${fullName}/git/refs`, { ref: `refs/heads/${EVIDENCE_BRANCH}`, sha: commit.sha });
  }
  evidenceReady.add(fullName);
}

/** Upload one evidence file and return a URL that renders inside PR comments (also for private repos). */
export async function uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string> {
  await ensureEvidenceBranch(fullName);
  await ghApiJson('PUT', `repos/${fullName}/contents/${filePath}`, {
    message: `QA evidence: ${filePath}`,
    content: data.toString('base64'),
    branch: EVIDENCE_BRANCH,
  });
  return `https://github.com/${fullName}/raw/${EVIDENCE_BRANCH}/${filePath}`;
}
