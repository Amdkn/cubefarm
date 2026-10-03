import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadSavedTheme, saveThemePreference } from './theme';
import { getTheme } from '../../shared/theme';

describe('client/src/theme', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('saves and loads theme preference from storage', () => {
    if (typeof localStorage !== 'undefined') {
      expect(loadSavedTheme()).toBeNull();
      saveThemePreference('uupm-dark');
      expect(loadSavedTheme()).toBe('uupm-dark');
    }
  });

  it('applies theme tokens if window/document is available', () => {
    if (typeof document !== 'undefined') {
      applyTheme('uupm-dark');
      const preset = getTheme('uupm-dark');

      expect(document.documentElement.dataset.theme).toBe('uupm-dark');
      expect(document.documentElement.style.getPropertyValue('--ink')).toBe(preset.tokens['--ink']);
    }
  });
});
