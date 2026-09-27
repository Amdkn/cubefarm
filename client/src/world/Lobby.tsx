import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { drawSign, roundRect, SANS } from './draw';
import { Elevator } from './Elevator';
import { useCanvasTexture, useInteractable } from './interact';
import { HALF_D, HALF_W, MANAGER_DESK, MANAGER_ROOM, RECEPTION } from './layout';
import { glow, shade } from './materials';
import { WallSign } from './OfficeFloor';
import { Bookshelf, Couch, CoffeeTable, GlassWall, Plant, Rug, WallClock } from './Props';
import { Shell } from './Shell';
import { Ball, Box, Cyl } from './Toon';

const ACCENT = '#ff8a5b';

function useOfficeStats() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const qa = useStore((s) => s.qa);
  return useMemo(() => {
    const list = Object.values(agents);
    const working = list.filter((a) => a.status === 'working' || a.status === 'preparing').length;
    const openPrs = repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'OPEN').length, 0);
    const merged = repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'MERGED').length, 0);
    const issues = repos.reduce((n, r) => n + r.issues.length, 0);
    const floors = repos.map((r) => ({
      floor: r.floor,
      name: r.fullName,
      color: r.color,
      team: list.filter((a) => a.repoId === r.id).length,
      working: list.filter((a) => a.repoId === r.id && (a.status === 'working' || a.status === 'preparing')).length,
      prs: r.pulls.filter((p) => p.state === 'OPEN').length,
    }));
    const qaList = Object.values(qa);
    const inQa = qaList.filter((q) => q.status !== 'passed').length;
    const readyToMerge = qaList.filter((q) => q.status === 'passed').length;
    return { repos: repos.length, agents: list.length, working, openPrs, inQa, readyToMerge, merged, issues, floors, max: settings.maxConcurrent };
  }, [repos, agents, settings, qa]);
}

function ManagerComputer() {
  const stats = useOfficeStats();
  const ref = useInteractable<THREE.Group>({ id: 'manager-console', label: "Open the manager's console", action: { kind: 'manager' } }, 3.2);
  const tex = useCanvasTexture(
    1024,
    640,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 1024, 640);
      g.addColorStop(0, '#20224a');
      g.addColorStop(1, '#3a1f4d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 640);
      ctx.fillStyle = '#ffd6a5';
      ctx.font = `700 54px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('✻ Manager Console', 50, 70);
      const rows: [string, string][] = [
        ['Floors (repos)', `${stats.repos}`],
        ['Agents on staff', `${stats.agents}`],
        ['Sessions running', `${stats.working} / ${stats.max}`],
        ['Open issues', `${stats.issues}`],
        ['PRs in QA / ready to merge', `${stats.inQa} / ${stats.readyToMerge}`],
      ];
      rows.forEach(([k, v], i) => {
        const y = 170 + i * 72;
        roundRect(ctx, 50, y - 30, 924, 60, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.fillStyle = '#c9c9ee';
        ctx.font = `500 34px ${SANS}`;
        ctx.fillText(k, 76, y);
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 38px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(v, 948, y);
        ctx.textAlign = 'left';
      });
      ctx.fillStyle = '#7CFFB2';
      ctx.font = `600 32px ${SANS}`;
      ctx.fillText('Press E to manage floors, team & issues', 50, 590);
    },
    [stats],
  );
  return (
    <group ref={ref} position={[MANAGER_DESK.x, 0, MANAGER_DESK.z]}>
      <Box size={[MANAGER_DESK.w, 0.08, MANAGER_DESK.d]} position={[0, 0.76, 0]} color="#8d5a3b" outline />
      <Box size={[MANAGER_DESK.w - 0.1, 0.72, 0.06]} position={[0, 0.37, -MANAGER_DESK.d / 2 + 0.05]} color="#6f4530" />
      <Box size={[0.08, 0.72, MANAGER_DESK.d - 0.1]} position={[-MANAGER_DESK.w / 2 + 0.08, 0.37, 0]} color="#6f4530" />
      <Box size={[0.08, 0.72, MANAGER_DESK.d - 0.1]} position={[MANAGER_DESK.w / 2 - 0.08, 0.37, 0]} color="#6f4530" />
      {/* big monitor facing the door */}
      <Box size={[0.1, 0.34, 0.1]} position={[0, 0.97, -0.15]} color="#adb5bd" />
      <Box size={[0.4, 0.03, 0.26]} position={[0, 0.815, -0.15]} color="#adb5bd" outline />
      <Box size={[1.42, 0.92, 0.06]} position={[0, 1.55, -0.18]} color="#343a40" outline />
      <mesh position={[0, 1.55, -0.145]}>
        <planeGeometry args={[1.34, 0.84]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Box size={[0.5, 0.025, 0.16]} position={[0, 0.815, 0.25]} color="#f4f4f8" outline />
      <Cyl r={0.05} h={0.11} position={[0.9, 0.855, 0.1]} color="#ffd166" outline />
      <Box size={[0.3, 0.2, 0.03]} position={[-0.95, 0.9, -0.1]} rotation={[-0.3, 0.3, 0]} color="#e9c46a" outline />
      {/* manager chair (yours) */}
      <group position={[0, 0, -1.1]}>
        <Box size={[0.64, 0.12, 0.6]} position={[0, 0.48, 0]} color="#2b2d42" outline />
        <Box size={[0.62, 0.8, 0.12]} position={[0, 0.95, -0.3]} color="#2b2d42" outline />
        <Cyl r={0.04} h={0.4} position={[0, 0.22, 0]} color="#6c757d" />
        <Cyl r={0.3} h={0.04} position={[0, 0.03, 0]} color="#6c757d" />
      </group>
    </group>
  );
}

function Directory() {
  const stats = useOfficeStats();
  const ref = useInteractable<THREE.Group>({ id: 'directory', label: 'Floor directory — take the elevator', action: { kind: 'elevator' } }, 4);
  const tex = useCanvasTexture(
    768,
    560,
    (ctx) => {
      roundRect(ctx, 0, 0, 768, 560, 30);
      ctx.fillStyle = '#23263a';
      ctx.fill();
      ctx.fillStyle = '#ffd6a5';
      ctx.font = `700 46px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Directory', 36, 52);
      const floors = [...stats.floors].sort((a, b) => b.floor - a.floor).slice(0, 7);
      floors.forEach((f, i) => {
        const y = 118 + i * 58;
        ctx.fillStyle = f.color;
        roundRect(ctx, 36, y - 22, 54, 44, 12);
        ctx.fill();
        ctx.fillStyle = '#1f2233';
        ctx.font = `700 30px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(f.floor), 63, y + 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 28px ${SANS}`;
        const name = f.name.length > 24 ? `${f.name.slice(0, 23)}…` : f.name;
        ctx.fillText(name, 108, y);
        ctx.fillStyle = '#a9adc6';
        ctx.font = `500 24px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${f.working}/${f.team} busy · ${f.prs} PR`, 740, y);
        ctx.textAlign = 'left';
      });
      const gy = 118 + floors.length * 58;
      ctx.fillStyle = ACCENT;
      roundRect(ctx, 36, gy - 22, 54, 44, 12);
      ctx.fill();
      ctx.fillStyle = '#1f2233';
      ctx.font = `700 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('G', 63, gy + 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 28px ${SANS}`;
      ctx.fillText("Lobby & manager's office", 108, gy);
      if (stats.floors.length === 0) {
        ctx.fillStyle = '#a9adc6';
        ctx.font = `500 26px ${SANS}`;
        ctx.fillText('No floors yet: connect a repo in the', 36, gy + 80);
        ctx.fillText("manager's office (back left corner).", 36, gy + 116);
      }
    },
    [stats],
  );
  return (
    <group ref={ref} position={[4.4, 1.75, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
      <mesh>
        <planeGeometry args={[2.6, 1.9]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function TrophyCabinet() {
  const stats = useOfficeStats();
  const tex = useCanvasTexture(
    512,
    160,
    (ctx) => drawSign(ctx, 512, 160, [{ text: `🏆 ${stats.merged} PRs merged`, size: 50, color: '#2d3142' }], '#ffe8a3'),
    [stats.merged],
  );
  const cups = Math.min(8, stats.merged);
  return (
    <group position={[12, 0, -HALF_D + 0.55]}>
      <Box size={[4.4, 2.1, 1]} position={[0, 1.05, 0]} color="#b08968" outline />
      <Box size={[4.1, 1.2, 0.8]} position={[0, 1.2, 0.12]} color="#fdf6e3" shadow={false} />
      <Box size={[4.1, 0.04, 0.8]} position={[0, 1.2, 0.12]} color="#b08968" shadow={false} />
      {Array.from({ length: cups }, (_, i) => (
        <group key={i} position={[-1.7 + (i % 4) * 1.1, i < 4 ? 0.62 : 1.22, 0.2]}>
          <Cyl r={0.08} rTop={0.16} h={0.22} position={[0, 0.2, 0]} color="#ffd43b" outline />
          <Cyl r={0.03} h={0.1} position={[0, 0.05, 0]} color="#ffd43b" />
          <Box size={[0.2, 0.04, 0.2]} position={[0, 0.01, 0]} color="#495057" />
        </group>
      ))}
      <mesh position={[0, 2.45, 0.02]}>
        <planeGeometry args={[2.4, 0.75]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Lobby() {
  const m = MANAGER_ROOM;
  const user = useStore((s) => s.user);
  return (
    <group>
      <Shell accent={ACCENT} floorColor="#e2c7a3" westWindows={[1.5, 8]} eastWindows={[-2, 6]} seed={0} />
      <Rug position={[3, 0.004, 3]} size={[14, 9]} color="#ffd6a5" />

      {/* manager's office */}
      <Rug position={[(m.minX + m.maxX) / 2, 0.005, (m.minZ + m.maxZ) / 2]} size={[m.maxX - m.minX, m.maxZ - m.minZ]} color="#cde7e1" />
      <GlassWall from={[m.maxX, m.minZ]} to={[m.maxX, m.maxZ]} />
      <GlassWall from={[m.minX, m.maxZ]} to={[m.doorMinX, m.maxZ]} />
      <GlassWall from={[m.doorMaxX, m.maxZ]} to={[m.maxX, m.maxZ]} />
      <Box size={[m.doorMaxX - m.doorMinX, 0.5, 0.1]} position={[(m.doorMinX + m.doorMaxX) / 2, 2.55, m.maxZ]} color="#8d99ae" />
      <WallSign
        position={[(m.doorMinX + m.doorMaxX) / 2, 3.1, m.maxZ + 0.06]}
        rotationY={0}
        size={[3.4, 0.5]}
        px={[816, 120]}
        draw={(ctx) => drawSign(ctx, 816, 120, [{ text: `MANAGER${user ? ` · ${user}` : ''}`, size: 52 }], '#2b2d42')}
        deps={[user]}
      />
      <ManagerComputer />
      <Bookshelf position={[-HALF_W + 0.4, 0, -8]} rotationY={Math.PI / 2} />
      <Plant position={[m.maxX - 0.6, 0, m.minZ + 0.6]} scale={1.1} pot="#3a86ff" />
      <Plant position={[m.minX + 0.6, 0, m.maxZ - 0.6]} scale={0.9} />
      <WallSign
        position={[MANAGER_DESK.x, 2.3, -HALF_D + 0.03]}
        rotationY={0}
        size={[2.4, 1.2]}
        px={[512, 256]}
        draw={(ctx) =>
          drawSign(ctx, 512, 256, [
            { text: '⭐', size: 70 },
            { text: 'World’s Best', size: 44, weight: 600 },
            { text: 'Agent Wrangler', size: 50 },
          ], '#9b5de5')
        }
        deps={[]}
      />

      {/* reception */}
      <group position={[RECEPTION.x, 0, RECEPTION.z]}>
        <Box size={[RECEPTION.w, 1.05, RECEPTION.d]} position={[0, 0.525, 0]} color="#ffffff" outline />
        <Box size={[RECEPTION.w + 0.1, 0.08, RECEPTION.d + 0.1]} position={[0, 1.09, 0]} color={ACCENT} outline />
        <Box size={[RECEPTION.w - 0.4, 0.3, 0.02]} position={[0, 0.6, RECEPTION.d / 2 + 0.01]} color={shade(ACCENT, 0.15)} shadow={false} />
        {/* a very cheerful receptionist bot */}
        <group position={[0, 1.13, -0.1]}>
          <Cyl r={0.2} rTop={0.16} h={0.4} position={[0, 0.2, 0]} color="#e9ecef" outline />
          <Ball r={0.22} position={[0, 0.58, 0]} color="#f8f9fa" outline />
          <mesh position={[-0.08, 0.6, 0.2]} material={glow('#4cc9f0')}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
          <mesh position={[0.08, 0.6, 0.2]} material={glow('#4cc9f0')}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
          <Cyl r={0.012} h={0.2} position={[0, 0.88, 0]} color="#adb5bd" />
          <mesh position={[0, 0.99, 0]} material={glow(ACCENT)}>
            <sphereGeometry args={[0.045, 10, 8]} />
          </mesh>
        </group>
      </group>
      <WallSign
        position={[3, 2.25, -HALF_D + 0.03]}
        rotationY={0}
        size={[7, 1.6]}
        px={[1400, 320]}
        draw={(ctx) =>
          drawSign(ctx, 1400, 320, [
            { text: '✻ Office Swarm', size: 120 },
            { text: 'a Claude Code agent team', size: 48, weight: 500 },
          ], ACCENT)
        }
        deps={[]}
      />

      <Elevator floorLabel="▲ G · Lobby" accent={ACCENT} />
      <Directory />
      <TrophyCabinet />
      <WallClock position={[8.4, 2.8, -HALF_D + 0.05]} />
      <Couch position={[11.5, 0, 4]} rotationY={Math.PI} color="#4cc9f0" />
      <CoffeeTable position={[11.5, 0, 6.2]} />
      <Plant position={[HALF_W - 0.7, 0, HALF_D - 0.7]} scale={1.2} />
      <Plant position={[-HALF_W + 0.7, 0, HALF_D - 0.7]} scale={1.2} pot="#06d6a0" />
      <Plant position={[-3, 0, HALF_D - 0.6]} />
      <Plant position={[3, 0, -HALF_D + 0.7]} scale={0.8} />
    </group>
  );
}
