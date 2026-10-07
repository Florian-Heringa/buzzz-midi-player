import { useSyncExternalStore, type CSSProperties } from 'react'

export type ThemeName = 'modern' | 'classic'
export type ColorMode = 'system' | 'light' | 'dark'

export interface ThemePrefs {
  theme: ThemeName
  mode: ColorMode
}

export const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'modern', label: 'Modern' },
  { value: 'classic', label: 'Classic' }
]

export const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const STORAGE_KEY = 'display-theme'
const DEFAULT_PREFS: ThemePrefs = { theme: 'modern', mode: 'system' }
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

let prefs = load()
const listeners = new Set<() => void>()

function load(): ThemePrefs {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof saved === 'object' && saved !== null) {
      const { theme, mode } = saved as Record<string, unknown>
      return {
        theme: THEMES.some((t) => t.value === theme) ? (theme as ThemeName) : DEFAULT_PREFS.theme,
        mode: COLOR_MODES.some((m) => m.value === mode) ? (mode as ColorMode) : DEFAULT_PREFS.mode
      }
    }
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return DEFAULT_PREFS
}

/** Light or dark, resolving 'system' from the OS setting. */
export function resolvedMode(mode: ColorMode): 'light' | 'dark' {
  return mode === 'system' ? (darkQuery.matches ? 'dark' : 'light') : mode
}

/** Applies the theme to the page; styles key off `data-theme` and `data-mode` on <html>. */
function apply(): void {
  const root = document.documentElement
  const mode = resolvedMode(prefs.mode)
  root.dataset.theme = prefs.theme
  root.dataset.mode = mode
  root.style.colorScheme = mode
}

export function setThemePrefs(change: Partial<ThemePrefs>): void {
  const modeChanged = change.mode !== undefined && change.mode !== prefs.mode
  prefs = { ...prefs, ...change }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Not persisting the theme is fine.
  }
  // The window frame and native menus follow the chosen mode too.
  if (modeChanged) void window.api.setNativeTheme(prefs.mode)
  apply()
  listeners.forEach((listener) => listener())
}

/** Applies the saved theme; call before the first render to avoid a flash of the wrong theme. */
export function initTheme(): void {
  apply()
  void window.api.setNativeTheme(prefs.mode)
  darkQuery.addEventListener('change', () => {
    if (prefs.mode === 'system') {
      apply()
      listeners.forEach((listener) => listener())
    }
  })
}

export function useThemePrefs(): ThemePrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => prefs
  )
}

/** Hue (0–360) for a track's color in the Modern theme; spread by the golden angle. */
export function trackHue(trackId: number): number {
  return Math.round((250 + trackId * 137.508) % 360)
}

/** Inline style giving an element a track's hue, for themes that color tracks. */
export function trackHueStyle(trackId: number): CSSProperties {
  return { '--track-hue': trackHue(trackId) } as CSSProperties
}
