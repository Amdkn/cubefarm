import { getTheme, ThemeId } from '../../shared/theme';

const THEME_STORAGE_KEY = 'cubefarm:theme';

export function loadSavedTheme(): ThemeId | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'aspace' || saved === 'uupm-dark' || saved === 'uupm-light') {
      return saved;
    }
  } catch {
    // localStorage might not be available
  }
  return null;
}

export function saveThemePreference(themeId: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // ignore storage errors
  }
}

export function applyTheme(themeId: ThemeId): void {
  const preset = getTheme(themeId);
  const root = document.documentElement;

  for (const [key, value] of Object.entries(preset.tokens)) {
    if (key === 'color-scheme') {
      root.style.colorScheme = value;
    } else {
      root.style.setProperty(key, value);
    }
  }

  root.dataset.theme = preset.id;
}
