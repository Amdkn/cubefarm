import { useStore } from '../store';
import { requestLook } from '../world/Player';

export function StartScreen() {
  const started = useStore((s) => s.started);
  const loaded = useStore((s) => s.loaded);
  const connected = useStore((s) => s.connected);
  const demo = useStore((s) => s.demo);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const start = useStore((s) => s.start);
  if (started) return null;

  const enter = () => {
    start();
    requestLook();
  };

  return (
    <div className="start">
      <div className="start-card">
        <div className="start-logo">✻</div>
        <h1>Office Swarm</h1>
        <p className="start-tag">A cartoon office where a team of Claude Code agents works through your GitHub issues.</p>
        <ul className="start-list">
          <li>🏢 Every connected repo is a floor. Ride the elevator between them.</li>
          <li>💻 Walk up behind an agent to watch their terminal, or press <kbd>E</kbd> to open it.</li>
          <li>🔍 QA testers in the lab test every pull request and post the evidence on the PR before you merge.</li>
          <li>📋 The whiteboard on each floor is the Kanban: backlog → in progress → in QA → ready to merge.</li>
          <li>🧑‍💼 The manager's office in the lobby is where you connect repos, hire agents and file issues.</li>
        </ul>
        <button className="btn btn-big" onClick={enter} disabled={!loaded}>
          {loaded ? 'Enter the office' : connected ? 'Loading…' : 'Connecting to the swarm server…'}
        </button>
        <div className="start-meta">
          {demo && <span className="pill pill-demo">DEMO MODE: fake repos, fake agents</span>}
          {loaded && (
            <span>
              {repos.length} floor{repos.length === 1 ? '' : 's'} · {Object.keys(agents).length} agents
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
