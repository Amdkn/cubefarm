import { useMemo } from 'react';
import { repoOnFloor, useStore } from '../store';

export function HUD() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const connected = useStore((s) => s.connected);
  const demo = useStore((s) => s.demo);
  const user = useStore((s) => s.user);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const focus = useStore((s) => s.focus);
  const overlay = useStore((s) => s.overlay);
  const locked = useStore((s) => s.locked);
  const started = useStore((s) => s.started);
  const travel = useStore((s) => s.travel);
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  const repo = floor === 0 ? null : repoOnFloor(repos, floor);
  const running = useMemo(() => Object.values(agents).filter((a) => a.status === 'working' || a.status === 'preparing').length, [agents]);
  const floorAgents = repo ? Object.values(agents).filter((a) => a.repoId === repo.id) : [];
  const qa = useStore((s) => s.qa);
  const floorQa = repo ? Object.values(qa).filter((q) => q.repoId === repo.id) : [];

  return (
    <div className="hud">
      <div className="hud-floor" style={{ ['--accent' as string]: repo?.color ?? '#ff8a5b' }}>
        <div className="floor-num">{repo ? repo.floor : 'G'}</div>
        <div>
          <div className="floor-name">{repo ? repo.fullName : "Lobby & manager's office"}</div>
          <div className="floor-sub">
            {repo
              ? `${floorAgents.length} agents · ${floorAgents.filter((a) => a.status === 'working' || a.status === 'preparing').length} working · ${floorQa.filter((q) => q.status !== 'passed').length} in QA · ${floorQa.filter((q) => q.status === 'passed').length} ready to merge`
              : `${repos.length} floor${repos.length === 1 ? '' : 's'} connected`}
          </div>
        </div>
      </div>

      <div className="hud-status">
        {demo && <span className="pill pill-demo">DEMO</span>}
        <span className={`pill ${connected ? 'pill-ok' : 'pill-bad'}`}>{connected ? '● live' : '○ reconnecting'}</span>
        <span className="pill">
          ⚙️ {running}/{settings.maxConcurrent} sessions
        </span>
        {user && <span className="pill">🐙 {user}</span>}
      </div>

      {!ghReady && ghError && <div className="hud-banner">⚠️ {ghError}</div>}

      {started && !overlay && !travel && <div className={`crosshair ${focus ? 'crosshair-hot' : ''}`} />}
      {started && !overlay && focus && (
        <div className="hud-hint">
          <kbd>E</kbd> {focus.label}
        </div>
      )}
      {started && !overlay && !locked && !travel && <div className="hud-resume">Click to look around</div>}
      {started && (
        <div className="hud-help">
          <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>E</kbd> interact · <kbd>H</kbd> help · <kbd>Esc</kbd> free mouse
        </div>
      )}

      <div className={`fade ${travel?.phase === 'closing' ? 'fade-in' : ''}`}>
        {travel && <div className="fade-label">{travel.to === 0 ? 'Lobby' : `Floor ${travel.to}`}</div>}
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
