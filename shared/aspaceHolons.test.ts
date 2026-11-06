import { describe, expect, it } from 'vitest';
import {
  ASPACE_3OS_FLOORS,
  CEO_HOLON_PROFILE,
  buildAmbitionBrief,
  formatFloorOsLabel,
  getOsFloorSpec,
} from './aspaceHolons.js';

describe('Cube Farm 3-OS Holon Floors & CEO A0 Amadeus Architecture', () => {
  it('exposes exactly 3 canonical OS floors totaling 578 Holons', () => {
    expect(ASPACE_3OS_FLOORS).toHaveLength(3);
    expect(ASPACE_3OS_FLOORS[0].osSlug).toBe('tech-os');
    expect(ASPACE_3OS_FLOORS[0].totalHolons).toBe(13);
    expect(ASPACE_3OS_FLOORS[1].osSlug).toBe('life-os');
    expect(ASPACE_3OS_FLOORS[1].totalHolons).toBe(43);
    expect(ASPACE_3OS_FLOORS[2].osSlug).toBe('areas-os');
    expect(ASPACE_3OS_FLOORS[2].totalHolons).toBe(522);

    const total = ASPACE_3OS_FLOORS.reduce((acc, f) => acc + f.totalHolons, 0);
    expect(total).toBe(578);
  });

  it('exposes CEO A0 Amadeus profile linked to sovereign human Amadou Kone', () => {
    expect(CEO_HOLON_PROFILE.holonId).toBe('aspace:a0:amadeus');
    expect(CEO_HOLON_PROFILE.sovereignHuman).toBe('Amadou Kone');
    expect(CEO_HOLON_PROFILE.ratificationSignature).toBe('human:amdkn');
    expect(CEO_HOLON_PROFILE.posture).toContain('7D');
    expect(CEO_HOLON_PROFILE.posture).toContain('10D');
    expect(CEO_HOLON_PROFILE.emythTriangle.vitalA1).toBeDefined();
    expect(CEO_HOLON_PROFILE.emythTriangle.epistemicS1).toBeDefined();
  });

  it('resolves OS floors and builds Ambition brief with Felix Rieseberg 4 vectors', () => {
    const floor3 = getOsFloorSpec(3);
    expect(floor3?.osSlug).toBe('areas-os');

    const label = formatFloorOsLabel(3, 'aspace-os/areas-os');
    expect(label.title).toContain('Areas OS');

    const brief = buildAmbitionBrief('Automate OMK Office Stripe workflow', 3);
    expect(brief.floor.osSlug).toBe('areas-os');
    expect(brief.speed).toContain('Fable 5');
    expect(brief.depth).toContain('Outside Judge');
  });
});
