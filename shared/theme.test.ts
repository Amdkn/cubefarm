import { describe, expect, it } from 'vitest';
import { getTheme, THEMES, DEFAULT_THEME_ID } from './theme';

describe('shared/theme', () => {
  it('returns default theme when requested theme is unknown or null', () => {
    expect(getTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme('non-existent-theme').id).toBe(DEFAULT_THEME_ID);
  });

  it('returns requested theme preset when valid', () => {
    expect(getTheme('uupm-dark').id).toBe('uupm-dark');
    expect(getTheme('uupm-light').id).toBe('uupm-light');
    expect(getTheme('aspace').id).toBe('aspace');
  });

  it('contains valid token structure for every preset', () => {
    for (const preset of Object.values(THEMES)) {
      expect(preset.tokens['--ink']).toBeDefined();
      expect(preset.tokens['--paper']).toBeDefined();
      expect(preset.tokens['--accent']).toBeDefined();
      expect(preset.tokens['color-scheme']).toMatch(/^(light|dark)$/);
    }
  });
});
