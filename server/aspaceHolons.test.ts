import { describe, expect, it } from 'vitest';
import {
  ASPACE_3OS_FLOORS,
  buildAmbitionBrief,
  CEO_HOLON_PROFILE,
  formatFloorOsLabel,
  getOsFloorSpec,
  HOLON_AGENT_NAMES,
} from '../shared/aspaceHolons.ts';
import { ceoSystemPrompt } from './ceo.ts';

describe("A'Space OS V5 · 3-Floor Holonic Cube Farm & 24/7 CEO Digital Twin", () => {
  it('defines the 3 canonical OS floors (Tech OS, Life OS 2026, Areas OS) totaling 578 Holons', () => {
    expect(ASPACE_3OS_FLOORS).toHaveLength(3);
    expect(ASPACE_3OS_FLOORS.map((f) => f.fullName)).toEqual([
      'aspace-os/tech-os',
      'aspace-os/life-os',
      'aspace-os/areas-os',
    ]);
    const total = ASPACE_3OS_FLOORS.reduce((sum, f) => sum + f.totalHolons, 0);
    expect(total).toBe(578);
    expect(ASPACE_3OS_FLOORS[2].totalHolons).toBe(1 + 8 + 1 + 64 + 448);
    expect(HOLON_AGENT_NAMES).toContain('S1-Rick');
    expect(HOLON_AGENT_NAMES).toContain('A1-Beth');
    expect(HOLON_AGENT_NAMES).toContain('B1-Book-LD01');
  });

  it('resolves floor OS labels and builds 4-Vector Ambition briefs (Modo de Volar)', () => {
    expect(getOsFloorSpec(1)?.osSlug).toBe('tech-os');
    expect(getOsFloorSpec('aspace-os/life-os')?.floor).toBe(2);
    expect(formatFloorOsLabel(3, 'aspace-os/areas-os').badge).toContain('522 Holons');

    const brief = buildAmbitionBrief('Automate OMK Office $360k/yr pipeline', 3);
    expect(brief.floor.osSlug).toBe('areas-os');
    expect(brief.speed).toContain('Fable 5');
    expect(brief.altitude).toContain('Goal beyond the goal');
    expect(brief.depth).toContain('Outside Judge');
    expect(brief.range).toContain('B1-Jerry');
  });

  it('embeds A0 Amadeus 24/7 CEO identity, E-Myth Triangle, and Modo de Volar in ceoSystemPrompt', () => {
    const prompt = ceoSystemPrompt({
      name: CEO_HOLON_PROFILE.name,
      company: CEO_HOLON_PROFILE.companyName,
      manager: CEO_HOLON_PROFILE.sovereignHuman,
      notesFile: 'notes.md',
      sessionLimit: 4,
      maxAgents: 8,
      scaling: 'auto',
    });
    expect(prompt).toContain('A0 Amadeus');
    expect(prompt).toContain('aspace:a0:amadeus');
    expect(prompt).toContain('Modo de Volar');
    expect(prompt).toContain('Outside Judge');
  });
});
