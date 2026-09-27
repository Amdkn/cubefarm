import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { agentsOnRepo, useStore, type ManagerTab } from '../store';
import type { EffortLevel, GhRepoSummary, RepoView } from '../../../shared/types';
import { IssueForm } from './KanbanView';
import { Panel } from './Overlays';
import { StatusPill } from './TerminalView';

const MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'];
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

// ---------- floors ----------

function ConnectRepo() {
  const repos = useStore((s) => s.repos);
  const [list, setList] = useState<GhRepoSummary[] | null>(null);
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = (o?: string) => {
    setList(null);
    void attempt(() => api.githubRepos(o)).then((r) => setList(r ?? []));
  };
  useEffect(() => load(), []);

  const connected = new Set(repos.map((r) => r.id.toLowerCase()));
  const shown = (list ?? []).filter((r) => !connected.has(r.nameWithOwner.toLowerCase()) && r.nameWithOwner.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const connect = async (name: string) => {
    setBusy(name);
    await attempt(() => api.connectRepo(name));
    setBusy(null);
  };

  return (
    <div className="card">
      <h3>🔌 Connect an existing repo</h3>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your repos…" />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Org / user (optional)" style={{ maxWidth: 200 }} />
        <button className="btn" onClick={() => load(owner.trim() || undefined)}>
          List
        </button>
      </div>
      <div className="repo-list">
        {list === null && <div className="muted small">Asking gh for your repos…</div>}
        {list && shown.length === 0 && <div className="muted small">No matching repos.</div>}
        {shown.map((r) => (
          <div key={r.nameWithOwner} className="repo-row">
            <div>
              <b>{r.nameWithOwner}</b> <span className="chip">{r.visibility.toLowerCase()}</span>
              {r.description && <div className="muted small">{r.description}</div>}
            </div>
            <button className="btn btn-small btn-good" disabled={busy === r.nameWithOwner} onClick={() => connect(r.nameWithOwner)}>
              {busy === r.nameWithOwner ? 'Moving in…' : 'Add floor'}
            </button>
          </div>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) void connect(manual.trim()).then(() => setManual(''));
        }}
      >
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…or type owner/name" />
        <button className="btn" disabled={!manual.trim() || !!busy}>
          Connect
        </button>
      </form>
    </div>
  );
}

function CreateRepo() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const ok = await attempt(() => api.createRepo({ name: name.trim(), description, visibility, owner: owner.trim() || undefined }));
        setBusy(false);
        if (ok) {
          setName('');
          setDescription('');
        }
      }}
    >
      <h3>✨ Start a new project</h3>
      <p className="muted small">Creates a new GitHub repo (with a README so agents have a branch to work from) and gives it a floor.</p>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="repo-name" />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Org (optional)" style={{ maxWidth: 180 }} />
      </div>
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
      <div className="row">
        <label className="toggle">
          <input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private
        </label>
        <label className="toggle">
          <input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Public
        </label>
        <span className="spacer" />
        <button className="btn btn-good" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create repo & floor'}
        </button>
      </div>
    </form>
  );
}

function FloorRow({ repo, all }: { repo: RepoView; all: RepoView[] }) {
  const agents = useStore((s) => s.agents);
  const goToFloor = useStore((s) => s.goToFloor);
  const team = agentsOnRepo(agents, repo.id);
  const others = all.filter((r) => r.id !== repo.id);
  const patch = (p: Parameters<typeof api.updateRepo>[1]) => void attempt(() => api.updateRepo(repo.id, p));
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="row">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <a href={repo.url} target="_blank" rel="noreferrer">
            <b>{repo.fullName}</b>
          </a>
          <div className="muted small">
            {team.length} agents · {repo.issues.length} open issues · {repo.pulls.filter((p) => p.state === 'OPEN').length} open PRs · default branch <code>{repo.defaultBranch}</code> · clone:{' '}
            {repo.cloneStatus}
          </div>
          {repo.cloneError && <div className="term-error small">clone failed: {repo.cloneError}</div>}
          {repo.syncError && <div className="term-error small">sync failed: {repo.syncError}</div>}
        </div>
        <input type="color" value={repo.color} onChange={(e) => patch({ color: e.target.value })} title="Floor colour" />
        <button className="btn btn-small" onClick={() => goToFloor(repo.floor)}>
          Visit
        </button>
      </div>
      <div className="row wrap">
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => patch({ autoAssign: e.target.checked })} /> ⚡ Auto-assign issues
        </label>
        <label className="toggle">
          <input type="checkbox" checked={repo.browserTesting} onChange={(e) => patch({ browserTesting: e.target.checked })} /> 🌐 Browser testing (Playwright MCP)
        </label>
        <span className="spacer" />
        <button
          className="btn btn-small btn-ghost"
          onClick={() => {
            if (confirm(`Disconnect ${repo.fullName}? Its agents are let go. Nothing is deleted on GitHub, and local clones stay on disk.`)) void attempt(() => api.disconnectRepo(repo.id));
          }}
        >
          Disconnect
        </button>
      </div>
      {others.length > 0 && (
        <div className="row wrap links">
          <span className="muted small">🔗 Agents here may read:</span>
          {others.map((o) => (
            <label key={o.id} className="toggle small">
              <input
                type="checkbox"
                checked={repo.links.includes(o.id)}
                onChange={(e) => patch({ links: e.target.checked ? [...repo.links, o.id] : repo.links.filter((l) => l !== o.id) })}
              />
              {o.fullName}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function FloorsTab() {
  const repos = useStore((s) => s.repos);
  return (
    <div className="tab-grid">
      <div>
        <h3 className="section">🏢 Floors</h3>
        {repos.length === 0 && <p className="muted">No floors yet. Connect a repo or start a new project →</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorRow key={r.id} repo={r} all={repos} />
        ))}
      </div>
      <div>
        <ConnectRepo />
        <CreateRepo />
      </div>
    </div>
  );
}

// ---------- team ----------

function TeamTab() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const openOverlay = useStore((s) => s.openOverlay);
  const [names, setNames] = useState<Record<string, string>>({});
  if (repos.length === 0) return <p className="muted">Connect a repo first; agents need a floor to sit on.</p>;
  return (
    <div>
      <datalist id="models">
        {MODELS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {[...repos].sort((a, b) => a.floor - b.floor).map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return (
          <div key={repo.id} className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
            <div className="row">
              <span className="floor-badge">{repo.floor}</span>
              <b className="grow">{repo.fullName}</b>
              <input value={names[repo.id] ?? ''} onChange={(e) => setNames({ ...names, [repo.id]: e.target.value })} placeholder="Name (optional)" style={{ maxWidth: 160 }} />
              <button
                className="btn btn-small btn-good"
                disabled={team.filter((a) => a.role === 'dev').length >= 12}
                onClick={() =>
                  void attempt(() => api.hireAgent(repo.id, { name: names[repo.id] || undefined, role: 'dev' })).then(() => setNames({ ...names, [repo.id]: '' }))
                }
              >
                + Developer
              </button>
              <button
                className="btn btn-small"
                disabled={team.filter((a) => a.role === 'qa').length >= 3}
                onClick={() =>
                  void attempt(() => api.hireAgent(repo.id, { name: names[repo.id] || undefined, role: 'qa' })).then(() => setNames({ ...names, [repo.id]: '' }))
                }
              >
                + QA tester
              </button>
            </div>
            {team.length === 0 && <div className="muted small">No one works here yet.</div>}
            <table className="team">
              <tbody>
                {team.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="dot" style={{ background: a.color }} />
                    </td>
                    <td>
                      <input
                        className="inline"
                        defaultValue={a.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && void attempt(() => api.updateAgent(a.id, { name: e.target.value }))}
                      />
                    </td>
                    <td>
                      <span className="chip">{a.role === 'qa' ? '🔍 QA' : '💻 Dev'}</span>
                    </td>
                    <td>
                      <select
                        value={a.look}
                        title="Character look"
                        onChange={(e) => void attempt(() => api.updateAgent(a.id, { look: e.target.value as 'feminine' | 'masculine' }))}
                      >
                        <option value="feminine">👩 She</option>
                        <option value="masculine">👨 He</option>
                      </select>
                    </td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="small">{a.status === 'idle' ? <span className="muted">—</span> : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `#${a.issueNumber ?? ''} ${a.issueTitle ?? ''}`.slice(0, 40)}</td>
                    <td>
                      <input
                        className="inline"
                        list="models"
                        defaultValue={a.model}
                        placeholder={settings.defaultModel}
                        onBlur={(e) => e.target.value !== a.model && void attempt(() => api.updateAgent(a.id, { model: e.target.value }))}
                      />
                    </td>
                    <td>
                      <select value={a.effort} onChange={(e) => void attempt(() => api.updateAgent(a.id, { effort: e.target.value }))}>
                        <option value="">default ({settings.defaultEffort})</option>
                        {EFFORTS.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">
                      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                        Terminal
                      </button>{' '}
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() => confirm(`Let ${a.name} go?`) && void attempt(() => api.fireAgent(a.id))}
                      >
                        Let go
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ---------- issues ----------

function IssuesTab({ initialRepo }: { initialRepo?: string }) {
  const repos = useStore((s) => s.repos);
  const allAgents = useStore((s) => s.agents);
  const [repoId, setRepoId] = useState(initialRepo ?? repos[0]?.id ?? '');
  const repo = repos.find((r) => r.id === repoId);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  if (repos.length === 0) return <p className="muted">Connect a repo first.</p>;
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>📝 File a new issue</h3>
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {r.floor} · {r.fullName}
            </option>
          ))}
        </select>
        {repo && <IssueForm key={repo.id} repoId={repo.id} agents={agents} />}
      </div>
      <div className="card">
        <h3>Open issues on {repo?.fullName}</h3>
        <div className="repo-list tall">
          {repo?.issues.length === 0 && <div className="muted small">None. Nice.</div>}
          {repo?.issues.map((i) => {
            const holder = agents.find((a) => a.role === 'dev' && a.issueNumber === i.number && a.status !== 'idle');
            return (
              <div key={i.number} className="repo-row">
                <div>
                  <a href={i.url} target="_blank" rel="noreferrer">
                    #{i.number}
                  </a>{' '}
                  {i.title}
                  {i.labels.length > 0 && <div className="muted small">{i.labels.join(', ')}</div>}
                </div>
                {holder ? (
                  <span className="agent-chip">
                    <span className="dot" style={{ background: holder.color }} />
                    {holder.name}
                  </span>
                ) : (
                  <select value="" onChange={(e) => e.target.value && void attempt(() => api.assign(e.target.value, i.number))}>
                    <option value="">Assign…</option>
                    {agents
                      .filter((a) => a.role === 'dev' && a.status !== 'working' && a.status !== 'preparing')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- settings ----------

function SettingsTab() {
  const settings = useStore((s) => s.settings);
  const user = useStore((s) => s.user);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const demo = useStore((s) => s.demo);
  const set = (p: Parameters<typeof api.updateSettings>[0]) => void attempt(() => api.updateSettings(p));
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>🧠 Agents</h3>
        <label className="field">
          <span>Default model</span>
          <input list="models-s" defaultValue={settings.defaultModel} onBlur={(e) => e.target.value !== settings.defaultModel && set({ defaultModel: e.target.value })} />
          <datalist id="models-s">
            {MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Default effort</span>
          <select value={settings.defaultEffort} onChange={(e) => set({ defaultEffort: e.target.value as EffortLevel })}>
            {EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Max concurrent sessions</span>
          <input type="number" min={1} max={32} defaultValue={settings.maxConcurrent} onBlur={(e) => set({ maxConcurrent: Number(e.target.value) })} />
        </label>
        <p className="muted small">Every agent shares your Claude subscription's usage limits, so more parallel sessions burn through them faster.</p>
      </div>
      <div className="card">
        <h3>🛡️ Permissions</h3>
        <label className="toggle block">
          <input type="radio" checked={settings.permissionMode === 'guarded'} onChange={() => set({ permissionMode: 'guarded' })} />
          <span>
            <b>Guarded</b> (recommended): edits are auto-approved inside the agent's worktree. Writes elsewhere, force-pushes, pushes to the default branch, merging PRs and repo admin commands are refused.
          </span>
        </label>
        <label className="toggle block">
          <input type="radio" checked={settings.permissionMode === 'bypass'} onChange={() => set({ permissionMode: 'bypass' })} />
          <span>
            <b>Bypass</b>: no permission checks at all. Only use this in a disposable VM or container.
          </span>
        </label>
        <h3>ℹ️ Environment</h3>
        <div className="small">
          GitHub: <b>{user ?? 'not signed in'}</b>
          {demo && ' (demo)'}
          <br />
          Workspaces: <code>{workspaceRoot}</code>
        </div>
      </div>
    </div>
  );
}

export function ManagerConsole({ initialTab, initialRepo }: { initialTab?: ManagerTab; initialRepo?: string }) {
  const [tab, setTab] = useState<ManagerTab>(initialTab ?? 'floors');
  const tabs: [ManagerTab, string][] = [
    ['floors', '🏢 Floors & repos'],
    ['team', '👩‍💻 Team'],
    ['issues', '📝 Issues'],
    ['settings', '⚙️ Settings'],
  ];
  return (
    <Panel wide title="🧑‍💼 Manager's console">
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'tab-on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'floors' && <FloorsTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'issues' && <IssuesTab initialRepo={initialRepo} />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </Panel>
  );
}
