import { useStore } from './store';
import type { GhRepoSummary, SwarmSettings } from '../../shared/types';

async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return data as T;
}

const r = (repoId: string) => `/api/repos/${encodeURIComponent(repoId)}`;

export const api = {
  githubRepos: (owner?: string) => call<GhRepoSummary[]>('GET', `/api/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  connectRepo: (fullName: string) => call('POST', '/api/repos', { fullName }),
  createRepo: (body: { name: string; description: string; visibility: 'private' | 'public'; owner?: string }) => call('POST', '/api/repos/new', body),
  updateRepo: (repoId: string, patch: { autoAssign?: boolean; browserTesting?: boolean; color?: string; links?: string[] }) => call('PATCH', r(repoId), patch),
  disconnectRepo: (repoId: string) => call('DELETE', r(repoId)),
  syncRepo: (repoId: string) => call('POST', `${r(repoId)}/sync`),
  createIssue: (repoId: string, title: string, body: string, assignTo?: string) => call<{ number: number }>('POST', `${r(repoId)}/issues`, { title, body, assignTo }),
  mergePull: (repoId: string, n: number, method: 'squash' | 'merge' | 'rebase' = 'squash') => call('POST', `${r(repoId)}/pulls/${n}/merge`, { method }),
  closePull: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/close`),
  sendToQa: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/qa`),
  hireAgent: (repoId: string, opts: { name?: string; model?: string; effort?: string; role?: 'dev' | 'qa' } = {}) => call('POST', `${r(repoId)}/agents`, opts),
  updateAgent: (id: string, patch: { name?: string; model?: string; effort?: string; look?: 'feminine' | 'masculine' }) => call('PATCH', `/api/agents/${id}`, patch),
  fireAgent: (id: string) => call('DELETE', `/api/agents/${id}`),
  assign: (id: string, issueNumber: number, note?: string) => call('POST', `/api/agents/${id}/assign`, { issueNumber, note }),
  stop: (id: string) => call('POST', `/api/agents/${id}/stop`),
  reset: (id: string) => call('POST', `/api/agents/${id}/reset`),
  message: (id: string, text: string) => call('POST', `/api/agents/${id}/message`, { text }),
  updateSettings: (patch: Partial<SwarmSettings>) => call('PATCH', '/api/settings', patch),
};
