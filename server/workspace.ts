import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_ROOT } from './config.ts';
import { gh, git } from './exec.ts';

// Layout on disk:
//   <WORKSPACE_ROOT>/<owner>__<repo>/main            full clone, never edited by agents
//   <WORKSPACE_ROOT>/<owner>__<repo>/desks/<agent>   one git worktree per agent

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

export function ensureClone(fullName: string): Promise<void> {
  return withRepoLock(fullName, async () => {
    const dir = mainDir(fullName);
    if (await exists(path.join(dir, '.git'))) {
      await git(['fetch', 'origin', '--prune'], { cwd: dir, timeoutMs: 180_000 });
      return;
    }
    await fs.mkdir(repoDir(fullName), { recursive: true });
    await gh(['repo', 'clone', fullName, dir], { timeoutMs: 600_000 });
  });
}

export interface DeskBase {
  defaultBranch: string;
  /** Start from a pull request's head instead of the default branch (QA testing, fixes after QA). */
  pr?: number;
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
    if (await exists(wt)) {
      await git(['worktree', 'remove', '--force', wt], { cwd: main }).catch(() => undefined);
      await fs.rm(wt, { recursive: true, force: true });
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
    await fs.rm(wt, { recursive: true, force: true }).catch(() => undefined);
    await git(['worktree', 'prune'], { cwd: main }).catch(() => undefined);
  });
}
