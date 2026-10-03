// Shared theme definitions and types for UUPM / Business OS Multi-Theme

export type ThemeId = 'aspace' | 'uupm-dark' | 'uupm-light';

export interface ThemeTokens {
  '--ink': string;
  '--paper': string;
  '--muted': string;
  '--good': string;
  '--bad': string;
  '--warn': string;
  '--accent': string;
  '--font': string;
  '--mono': string;
  'color-scheme': 'light' | 'dark';
  '--bg-main': string;
}

export interface ThemePreset {
  id: ThemeId;
  name: string;
  description: string;
  tokens: ThemeTokens;
}

export const THEMES: Record<ThemeId, ThemePreset> = {
  aspace: {
    id: 'aspace',
    name: "A'Space Classic",
    description: "The original CubeFarm cartoon 3D office aesthetic",
    tokens: {
      '--ink': '#1f1d2b',
      '--paper': '#fffdf6',
      '--muted': '#6c7086',
      '--good': '#2dc653',
      '--bad': '#ef476f',
      '--warn': '#ffb703',
      '--accent': '#ff8a5b',
      '--font': "Fredoka, 'Segoe UI', system-ui, sans-serif",
      '--mono': "'JetBrains Mono', Consolas, monospace",
      'color-scheme': 'light',
      '--bg-main': '#bfe3ff',
    },
  },
  'uupm-dark': {
    id: 'uupm-dark',
    name: 'UUPM / Business OS Dark',
    description: 'Dark Mode Glassmorphism with neon accent tones',
    tokens: {
      '--ink': '#f8fafc',
      '--paper': '#0f172a',
      '--muted': '#94a3b8',
      '--good': '#10b981',
      '--bad': '#f43f5e',
      '--warn': '#f59e0b',
      '--accent': '#3b82f6',
      '--font': "Inter, system-ui, -apple-system, sans-serif",
      '--mono': "'JetBrains Mono', Consolas, monospace",
      'color-scheme': 'dark',
      '--bg-main': '#020617',
    },
  },
  'uupm-light': {
    id: 'uupm-light',
    name: 'UUPM / Business OS Light',
    description: 'Clean SaaS Minimalist profile with vibrant CTA accents',
    tokens: {
      '--ink': '#0f172a',
      '--paper': '#ffffff',
      '--muted': '#64748b',
      '--good': '#10b981',
      '--bad': '#e11d48',
      '--warn': '#d97706',
      '--accent': '#2563eb',
      '--font': "Inter, system-ui, -apple-system, sans-serif",
      '--mono': "'JetBrains Mono', Consolas, monospace",
      'color-scheme': 'light',
      '--bg-main': '#f8fafc',
    },
  },
};

export const DEFAULT_THEME_ID: ThemeId = 'aspace';

export function getTheme(id?: string | null): ThemePreset {
  if (id && id in THEMES) {
    return THEMES[id as ThemeId];
  }
  return THEMES[DEFAULT_THEME_ID];
}
