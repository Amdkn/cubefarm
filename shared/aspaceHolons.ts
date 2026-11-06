/**
 * A'Space OS V5 × Cube Farm — 3-Floor Holonic OS Architecture & 24/7 CEO Digital Twin ("A0 Amadeus")
 *
 * Replaces generic per-repo floors with the 3 canonical Operating Systems of A'Space OS:
 *   - Floor 1 (`aspace-os/tech-os`): L0 Tech OS · BedRock & Software Factory (13 Holons S1/S2/S3)
 *   - Floor 2 (`aspace-os/life-os`): L1 Life OS 2026 · Cockpit 6 Frameworks × 8 Life Domains (43 Holons A1/A2/A3)
 *   - Floor 3 (`aspace-os/areas-os`): L2 Areas OS · Imbrication des 3 Couches B1–I1 / B2–I2 / B3–I3 dans PARA de Life OS
 *     (522 Holons = LD00 + 8 OwnerBooks + J1 LD09 + 64 DC Managers + 448 Marvel Technicians). Total 3 OS = 578 Holons.
 *   - Loop: S0 Amadou Kone (10D, Out of the Loop) · S1 Near · S2 Close (Mezzanine Agent-Office) · S3 Keep Loop Alive. A0 = 7D.
 *   - Tab: bascule 3D → vue 2D de dessus en Tableaux-Portails (cf. `PORTAL_BOARDS_2D`).
 *
 * Supervised 24/7 in the Lobby by A0 Amadeus (`aspace:a0:amadeus`), the Digital Twin CEO of Amadou Kone (`human:amdkn`),
 * powered by Felix Rieseberg's "Modo de Volar" 4-Vector Ambition Protocol (Speed, Altitude, Depth + Outside Judge, Range).
 */

export interface CubeFarmOsFloorSpec {
  floor: 1 | 2 | 3;
  code: 'L0' | 'L1' | 'L2';
  osSlug: 'tech-os' | 'life-os' | 'areas-os';
  fullName: string;
  displayName: string;
  badge: string;
  color: string;
  totalHolons: number;
  gatekeepers: string[];
  holonRoster: string[];
  summary: string;
  mission: string;
  qaBrief: string;
  seedIssues: [string, string][];
}

export const CEO_HOLON_PROFILE = {
  holonId: 'aspace:a0:amadeus',
  name: 'A0 Amadeus',
  historicalAlias: 'Kirby',
  sovereignHuman: 'Amadou Kone',
  ratificationSignature: 'human:amdkn',
  posture: '24/7 Digital Twin CEO · 7D (S0 Amadou Kone en 10D, Out of the Loop)',
  companyName: "A'Space OS V5 · 3-OS Holon Cube Farm",
  emythTriangle: {
    surfaceB1: ['B1-Jerry (5s UX Clarity · Spock Areas)', 'B1-Summer (Immediate Action · Picard Projects)'],
    vitalA1: ['A1-Beth (LD03/LD04 Homeostasis & 00h-05h Nocturnal Shield)', 'A1-Morty (Native Read-Back & Edge-Case Fallback)'],
    epistemicS1: ['S1-Rick (Anti-Rent Veto & R10 Cryptographic Receipt)'],
  },
  ambitionVectors: ['Speed (Fable 5 80/20)', 'Altitude (Goal Beyond the Goal)', 'Depth (Raw Sources + Outside Judge)', 'Range (Verbs + Multi-OS Holon Crew)'],
} as const;

export const ASPACE_3OS_FLOORS: readonly CubeFarmOsFloorSpec[] = [
  {
    floor: 1,
    code: 'L0',
    osSlug: 'tech-os',
    fullName: 'aspace-os/tech-os',
    displayName: 'Tech OS · L0 BedRock & Software Factory',
    badge: 'L0 Tech OS · 13 Holons (S1/S2/S3)',
    color: '#4fb3e8',
    totalHolons: 13,
    gatekeepers: ['S1-Rick'],
    holonRoster: [
      'S1-Rick',
      'D13-Kernel',
      'Ryan-Build',
      'Yaz-Observe',
      'Graham-State',
      'D11-Life',
      'Amy-Interface',
      'Rory-Persistence',
      'River-Flow',
      'D12-Buzz',
      'Bill-Research',
      'Clara-Forge',
      'Nardole-Dispatch',
    ],
    summary: 'L0 Tech OS · Aspace Software Factory, Pi Durable Subagents, DeepSeek Superagent, WikiLLM OKF v0.2 & Graphify (13 Holons)',
    mission:
      'Maintain 100% deterministic gates (02_Factory/checks.ps1 6/6, 27/27 CLI tools), crash-safe Pi Durable SQLite checkpoints (writerLock + modelPool failover), and R10 Canary Receipts across all 8 harnesses (dsh, pi, opencode, claude, codex, agy, hc, orca).',
    qaBrief: [
      '- S1-Rick Gate: Verify zero proprietary cloud lock-in, zero plaintext secrets, and valid R10 receipt.',
      '- S3-Yaz Gate: Run pwsh -NoProfile -File 02_Factory/checks.ps1 (all 6 deterministic gates must PASS).',
      '- S3-Graham Gate: Confirm SQLite idempotency (requestId) and strictly append-only 00_Memoire/bundle/log.md.',
      '- Outside Judge (Modo de Volar Depth Step 4): All unit tests and TypeScript checks pass with <200ms local latency target.',
    ].join('\n'),
    seedIssues: [
      [
        'Enforce R10 Canary Receipt verification in S1-Rick & S3-Yaz pipeline',
        'Bind Sheet_Rgt_CANARY_RECEIPTS and Sheet_Rgt_CANARY_EVENTS into 02_Factory/checks.ps1 and S3-Yaz LiDAR telemetry.',
      ],
      [
        'Pi Durable writerLock & multi-model failover across dsh, pi, claude, codex, opencode',
        'Ensure single writerLock per git worktree while allowing parallel writer:false reviewers (S1-Rick, S3-Yaz, S3-Bill).',
      ],
      [
        'Graphify + WikiLLM OKF v0.2 automated ingestion for 3-OS Drive Canon',
        'Keep 00_Memoire/bundle/concepts/*.md synchronized with the 193 Holons and 20 IPBDs.',
      ],
      [
        'Amy-Interface 3D Cube Farm telemetry bridge with Herdr (hc) and Orca worktrees',
        'Stream live Holon activity across Floor 1 (Tech OS), Floor 2 (Life OS), and Floor 3 (Business OS).',
      ],
      [
        'Nardole-Dispatch return_to envelope routing for DeepSeek Superagent tickets',
        'Route Source -> Trigger -> Thread -> Eval -> Ticket -> Assignment -> Executor -> Channel with 5s shell backgrounding.',
      ],
      [
        'Graham-State temporal replay & Bedrock Hub Baux FDE (Concordia TTL 300s)',
        'Enforce 5-minute fencing token leases before any cross-OS state mutation.',
      ],
    ],
  },
  {
    floor: 2,
    code: 'L1',
    osSlug: 'life-os',
    fullName: 'aspace-os/life-os',
    displayName: 'Life OS 2026 · L1 Cockpit 6 Frameworks × 8 LD',
    badge: 'L1 Life OS 2026 · 43 Holons (A1/A2/A3)',
    color: '#8fd14f',
    totalHolons: 43,
    gatekeepers: ['A1-Beth', 'A1-Morty'],
    holonRoster: [
      'A1-Beth',
      'A1-Morty',
      'Orville-Ikigai',
      'Zora-LifeWheel',
      'Curie-12WY',
      'Enterprise-PARA',
      'Cerritos-GTD',
      'Protostar-DEAL',
      'Pike-Vision',
      'MBenga-Focus90',
      'Picard-Projects',
      'Spock-Areas',
      'Geordi-Resources',
      'Data-Archives',
      'Mariner-GTD',
    ],
    summary: 'L1 Life OS 2026 · 48 Intersections (6 Starfleet Frameworks × 8 Life Domains LD01..LD08) & Beth Biological Shield (43 Holons)',
    mission:
      'Sanctuarize Amadou Kone in his 7D Visionary posture by automating the 48 intersections of the Life OS 2026 Cockpit (Ikigai/Orville, Life Wheel/Zora, 12WY/Curie, PARA/Enterprise, GTD/Cerritos, DEAL/Protostar) under A1-Beth homeostasis (LD03/LD04 + 00h-05h nocturnal shield) and A1-Morty read-back prudence.',
    qaBrief: [
      '- A1-Beth Gate: Verify biological state (GREEN/ORANGE/RED/HALT_LD03/HALT_LD04) and block intrusive notifications between 00h00 and 05h00.',
      '- A1-Morty Gate: Confirm native read-back after every GWS/Calendar/Drive/Tasks write and verify manual fallback.',
      '- Curie 12WY Gate: Ensure 90-minute focus blocks (MBenga) and >= 85% weekly execution score tracking.',
      '- Outside Judge (Modo de Volar): Zero 3D cognitive leakage to Amadou Kone; <= 5s visual clarity.',
    ].join('\n'),
    seedIssues: [
      [
        'A1-Beth Homeostasis Shield: enforce 00h00-05h00 nocturnal sanctuary and LD03/LD04 HALT gates',
        'Automatically switch all 3 OS floors to silent autonomous execution during nocturnal sanctuary hours or HALT_LD03/HALT_LD04.',
      ],
      [
        'Synchronize 48 Cockpit intersections (6 Frameworks × 8 Life Domains LD01..LD08)',
        'Reconcile Orville (Ikigai Slides), Zora (Life Wheel Sheets), Curie (12WY Calendar), Enterprise (PARA Drive), Cerritos (GTD Tasks), and Protostar (DEAL Chat).',
      ],
      [
        'Curie 12WY: automate MBenga 90-minute deep focus blocks and Friday weekly review',
        'Protect daily 90m blocks in Google Calendar and compute weekly execution score (>85% target).',
      ],
      [
        'Enterprise PARA & Rory-Persistence: bidirectional Drive <-> Linear <-> GTD reconciliation',
        'Ensure Picard (Projects), Spock (Areas), Geordi (Resources), and Data (Archives) stay 100% aligned with Mariner/Freeman GTD.',
      ],
    ],
  },
  {
    floor: 3,
    code: 'L2',
    osSlug: 'areas-os',
    fullName: 'aspace-os/areas-os',
    displayName: 'Areas OS · L2 Imbrication 3 Couches dans PARA',
    badge: 'L2 Areas OS · 522 Holons (LD00 + B1..I1 + J1 LD09 + 64 DC + 448 Marvel)',
    color: '#ff8a5b',
    totalHolons: 522,
    gatekeepers: ['LD00-Beth-Morty', 'B1-Jerry', 'B1-Summer', 'J1-Meta-Jerry'],
    holonRoster: [
      'LD00-Beth-Morty',
      'B1-Jerry',
      'B1-Summer',
      'B1-Book-LD01',
      'C1-Saru-LD02',
      'D1-Culber-LD03',
      'E1-Tilly-LD04',
      'F1-Stamets-LD05',
      'G1-Burnham-LD06',
      'H1-Reno-LD07',
      'I1-Georgiou-LD08',
      'J1-Meta-Jerry',
      'B2-I2-DC-Managers-64',
      'B3-I3-Marvel-Technicians-448',
      'OMK-Office-Engine',
      'Liberty-Ride-SOB',
    ],
    summary: 'L2 Areas OS · 3 couches B1–I1/B2–I2/B3–I3 imbriquées dans PARA (Spock Areas→Picard Projects) de Life OS, structuré par le Life Core de Tech OS · LD00 + J1 LD09 · SOB/Liberty Ride, Concordia, OMK Office',
    mission:
      'Operate the 522 Holons of Areas OS (LD00 + 8 OwnerBooks B1..I1 + J1 Meta-Jerry as LD09 fractal elevation for A2 Zora + 64 DC Managers B2..I2 on the Agent-Office Mezzanine + 448 Marvel Technicians B3..I3 = 7×8×8) across the 8 OwnerBooks (B1 Book LD01..I1 Georgiou LD08): scale SOB/Liberty Ride (8 Make/Openbot workflows), Concordia (TTL 300s fencing tokens), and The OMK Office (100 clients/mo × $300/yr = $360k/yr gross -> $10k/mo net sanctified for A0 in C1 Saru Trillion Finances Vault).',
    qaBrief: [
      '- B1-Jerry Gate: 5-second UX & executive clarity test passed; aligned with Spock macro Area.',
      '- B1-Summer Gate: Immediate executable action with zero bureaucratic fluff; aligned with Picard micro Project.',
      '- Concordia Gate: Fencing token lease (TTL 300s / 5 min) verified before external Make/Openbot/Stripe side effects.',
      '- Outside Judge (Modo de Volar): Revenue & unit economics verified against raw ledger data; J1 Meta-Jerry is LD09 (fractal elevation for A2 Zora); LD00 (Beth & Morty) supervises.',
    ].join('\n'),
    seedIssues: [
      [
        'B1 Book (LD01) · The OMK Office: automate 100 clients/mo × $300/yr pipeline ($360k/yr gross -> $10k/mo net A0)',
        'Wire acquisition, onboarding, billing, and C1 Saru Trillion Finances Vault allocation with deterministic receipts.',
      ],
      [
        'B1 Book (LD01) · SOB / Liberty Ride: orchestrate the 8 Make/Openbot production workflows under Concordia TTL 300s',
        'Enforce 5-minute fencing token leases (Bedrock Hub Baux FDE) across all 8 Liberty Ride operational flows.',
      ],
      [
        'C1 Saru (LD02) · Trillion Finances Vault: automated treasury allocation & $10k/mo net A0 sanctuary',
        'Track gross-to-net cashflow, reserve buffers, and require human:amdkn ratification on external capital movements.',
      ],
      [
        'J1 Meta-Jerry (LD09): fractal elevation for A2 Zora × Spock (Areas) across B1..I1',
        'Aggregate KPIs across the 8 OwnerBooks, 64 DC Managers and 448 Marvel Technicians in <5s clarity view.',
      ],
    ],
  },
] as const;

export const LOOP_HIERARCHY = {
  S0: 'Out of the Loop — Amadou Kone (human:amdkn) · 10D',
  S1: 'Near of the Loop — S1-Rick & Ricks verses',
  S2: 'Close of the Loop — Doctors D11/D12/D13, A2 Starfleet, 64 DC Managers (Agent-Office Mezzanine)',
  S3: 'Keep Aspace Loop Alive — Companions, A3 Specialists, 448 Marvel Technicians',
} as const;

/** 2D top-down `Tab` view: each project is a wall painting (Tableau-Portail) you can enter on the same page. */
export const PORTAL_BOARDS_2D = [
  'L0 Tech OS: Kernel · Life Core · Buzz Core',
  'L1 Life OS: Ikigai/Life Wheel · 12WY/DEAL · PARA/GTD',
  'L2 Areas OS: B1 Carrière · C1 Finances · D1 Santé · E1 Cognition · F1 Réseau · G1 Habitat · H1 Sandbox · I1 Civilizer',
] as const;

export const TOTAL_HOLONS = 578;

export const HOLON_AGENT_NAMES: readonly string[] = Array.from(
  new Set(ASPACE_3OS_FLOORS.flatMap((f) => f.holonRoster)),
);

export function getOsFloorSpec(floorOrRepo: number | string): CubeFarmOsFloorSpec | undefined {
  if (typeof floorOrRepo === 'number') {
    return ASPACE_3OS_FLOORS.find((f) => f.floor === floorOrRepo);
  }
  const lower = floorOrRepo.toLowerCase().replace('business-os', 'areas-os');
  return ASPACE_3OS_FLOORS.find(
    (f) =>
      f.fullName.toLowerCase() === lower ||
      f.osSlug === lower ||
      lower.endsWith(`/${f.osSlug}`),
  );
}

export function formatFloorOsLabel(floor: number, fullName: string): {
  title: string;
  subtitle: string;
  badge: string;
} {
  const spec = getOsFloorSpec(fullName) ?? getOsFloorSpec(floor);
  if (!spec) {
    const short = fullName.split('/')[1] ?? fullName;
    return {
      title: short,
      subtitle: fullName,
      badge: `Floor ${floor}`,
    };
  }
  return {
    title: spec.displayName,
    subtitle: `${spec.badge} · Gatekeepers: ${spec.gatekeepers.join(', ')}`,
    badge: spec.badge,
  };
}

/**
 * Felix Rieseberg's "Modo de Volar" 4-Vector Ambition Brief builder for Cube Farm CEO & Floors.
 */
export function buildAmbitionBrief(mandate: string, floorNumber?: number): {
  mandate: string;
  floor: CubeFarmOsFloorSpec;
  speed: string;
  altitude: string;
  depth: string;
  range: string;
} {
  const spec =
    (floorNumber ? getOsFloorSpec(floorNumber) : undefined) ??
    ASPACE_3OS_FLOORS[0];
  return {
    mandate,
    floor: spec,
    speed:
      'Fable 5 80/20 execution cadence (>80% tool_use), parallel worktrees, <=200ms local latency target.',
    altitude: `Goal beyond the goal: turn "${mandate}" into a self-verifying, compounding capability on Floor ${spec.floor} (${spec.displayName}) with 3 explicit pros/cons executive decisions and systemic prevention.`,
    depth:
      '4-Step Depth Upgrade: (1) Top domain expert standard unprompted; (2) Start from raw sources (00_Memoire/raw/ & SQLite); (3) Industry-grade executable tests; (4) Independent Outside Judge verification (S1-Rick + S3-Yaz + QA pass).',
    range: `Replace nouns with verbs of real impact and assemble cross-functional Holon crew (${spec.holonRoster.slice(0, 5).join(', ')}) + Red Team critic (${spec.gatekeepers.join(', ')}).`,
  };
}
