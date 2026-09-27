import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_ROOT } from './config.ts';
import { gh, git, run } from './exec.ts';

// Layout on disk:
//   <WORKSPACE_ROOT>/<owner>__<repo>/main            full clone, never edited by agents
//   <WORKSPACE_ROOT>/<owner>__<repo>/desks/<agent>   one git worktree per agent, reused from task to task

const locks = new Map<string, Promise<unknown>>();

/** Serialise git operations per repo so concurrent worktree adds don't fight over index locks. */
function withRepoLock<T>(fullName: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(fullName) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(fullName, next);
  return next;
}

export const repoDir = (fullName: string) => path.join(WORKSPACE_ROOT, fullName.replace('/', '__'));
export const mainDir = (fullName: string) => path.join(repoDir(fullName), 'main');
export const deskDir = (fullName: string, agentSlug: string) => path.join(repoDir(fullName), 'desks', agentSlug);

async function exists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

// Tool droppings that should never be committed from a desk (shared by all worktrees of the clone).
const LOCAL_EXCLUDES = ['.playwright-mcp/'];

async function addLocalExcludes(main: string) {
  const file = path.join(main, '.git', 'info', 'exclude');
  const current = await fs.readFile(file, 'utf8').catch(() => '');
  const missing = LOCAL_EXCLUDES.filter((l) => !current.split(/\r?\n/).includes(l));
  if (missing.length === 0) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}# added by Office Swarm\n${missing.join('\n')}\n`);
}

export function ensureClone(fullName: string): Promise<void> {
  return withRepoLock(fullName, async () => {
    const dir = mainDir(fullName);
    if (await exists(path.join(dir, '.git'))) {
      await git(['fetch', 'origin', '--prune'], { cwd: dir, timeoutMs: 180_000 });
    } else {
      await fs.mkdir(repoDir(fullName), { recursive: true });
      await gh(['repo', 'clone', fullName, dir], { timeoutMs: 600_000 });
    }
    await addLocalExcludes(dir);
  });
}

export interface DeskBase {
  defaultBranch: string;
  /** Start from a pull request's head instead of the default branch (QA testing, fixes after QA). */
  pr?: number;
}

/** Remove a directory, retrying while Windows still has handles open in it. */
async function removeDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

export function prepareDesk(fullName: string, base: DeskBase, agentSlug: string, branch: string): Promise<string> {
  return withRepoLock(fullName, async () => {
    const main = mainDir(fullName);
    await git(['fetch', 'origin', '--prune'], { cwd: main, timeoutMs: 180_000 });
    let ref = `origin/${base.defaultBranch}`;
    if (base.pr) {
      // refs/pull/N/head works for branches in this repo and for forks alike
      ref = `origin/pr/${base.pr}`;
      await git(['fetch', 'origin', `+refs/pull/${base.pr}/head:refs/remotes/${ref}`], { cwd: main, timeoutMs: 180_000 });
    }
    try {
      await git(['rev-parse', '--verify', ref], { cwd: main });
    } catch {
      throw new Error(
        base.pr
          ? `Could not fetch pull request #${base.pr} of ${fullName}.`
          : `${fullName} has no ${base.defaultBranch} branch yet. Push an initial commit (or create the repo with a README) before assigning work.`,
      );
    }

    const wt = deskDir(fullName, agentSlug);

    // Reuse the desk's worktree in place. Deleting it fails on Windows while any process (a dev server
    // the agent left running, a browser) still has its working directory inside, and reuse keeps
    // node_modules warm between tasks.
    if (await exists(path.join(wt, '.git'))) {
      try {
        await git(['checkout', '--force', '-B', branch, ref], { cwd: wt });
        await git(['reset', '--hard', ref], { cwd: wt });
        // Untracked leftovers from the last task go; ignored files (node_modules, build caches) stay.
        await git(['clean', '-fd'], { cwd: wt }).catch(() => undefined);
        return wt;
      } catch {
        // fall through and rebuild the worktree from scratch
      }
    }

    if (await exists(wt)) {
      await git(['worktree', 'remove', '--force', wt], { cwd: main }).catch(() => undefined);
      try {
        await removeDir(wt);
      } catch (err) {
        throw new Error(
          `Could not clear the desk folder ${wt}: ${(err as Error).message}. A program started by the previous task is probably still running there. Close it and try again.`,
        );
      }
    }
    await git(['worktree', 'prune'], { cwd: main });
    await fs.mkdir(path.dirname(wt), { recursive: true });
    await git(['worktree', 'add', '-B', branch, wt, ref], { cwd: main });
    return wt;
  });
}

export function removeDesk(fullName: string, agentSlug: string): Promise<void> {
  return withRepoLock(fullName, async () => {
    const main = mainDir(fullName);
    const wt = deskDir(fullName, agentSlug);
    if (!(await exists(wt))) return;
    await git(['worktree', 'remove', '--force', wt], { cwd: main }).catch(() => undefined);
    await removeDir(wt).catch(() => undefined);
    await git(['worktree', 'prune'], { cwd: main }).catch(() => undefined);
  });
}

// ---------- leftover processes ----------

// Only these kinds of processes are stopped when walking up from a leftover to its (orphaned) launcher.
const LAUNCHERS = ['node.exe', 'cmd.exe', 'bash.exe', 'sh.exe', 'conhost.exe', 'python.exe', 'npm.exe', 'npx.exe', 'bun.exe', 'deno.exe'];

/**
 * Stop what an agent left running: anything listening on its reserved port or whose command line
 * points into its desk, plus the shell/node chain that launched it. Called when the agent is not working.
 */
export async function releaseDesk(fullName: string, agentSlug: string, port: number): Promise<void> {
  const desk = deskDir(fullName, agentSlug);
  if (process.platform === 'win32') {
    const variants = [desk, desk.replaceAll('\\', '/')].map((d) => `'${d.toLowerCase().replaceAll("'", "''")}'`).join(', ');
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$seed = @()
Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { $seed += [int]$_.OwningProcess }
$desks = @(${variants})
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
foreach ($p in $all) {
  if (-not $p.CommandLine) { continue }
  $cmd = $p.CommandLine.ToLower()
  foreach ($d in $desks) { if ($cmd.Contains($d)) { $seed += [int]$p.ProcessId } }
}
$launchers = @(${LAUNCHERS.map((n) => `'${n}'`).join(', ')})
$kill = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($id in $seed) {
  $cur = $byId[$id]
  $first = $true
  while ($cur -and [int]$cur.ProcessId -ne ${process.pid} -and ($first -or $launchers -contains $cur.Name.ToLower())) {
    [void]$kill.Add([int]$cur.ProcessId)
    $first = $false
    $cur = $byId[[int]$cur.ParentProcessId]
  }
}
foreach ($id in $kill) { taskkill /PID $id /T /F 2>&1 | Out-Null }
Write-Output $kill.Count`;
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30_000 }).catch(() => undefined);
    return;
  }
  const pids = await run('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null; pgrep -f ${JSON.stringify(desk)} 2>/dev/null`]).catch(() => '');
  for (const pid of pids.split(/\s+/).map(Number).filter((p) => p && p !== process.pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
