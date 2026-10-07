import { useEffect, useId, useRef, useState } from 'react'
import { COLOR_MODES, setThemePrefs, THEMES, useThemePrefs } from './theme'

/** Header button with a popover to choose the theme and light/dark appearance. */
export function ThemeMenu(): React.JSX.Element {
  const prefs = useThemePrefs()
  // Fixed position under the button while open, so the pane's scroll area can't clip it.
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const open = position !== null
  const setOpen = (next: boolean): void => {
    const rect = button.current?.getBoundingClientRect()
    setPosition(next && rect ? { top: rect.bottom + 6, right: window.innerWidth - rect.right } : null)
  }
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return
    const close = (): void => setPosition(null)
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="theme-menu" ref={root}>
      <button
        ref={button}
        className="theme-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        title="Theme and light/dark appearance"
      >
        <span aria-hidden>◐</span> Display
      </button>
      {open && (
        <div
          className="theme-menu__panel"
          id={panelId}
          role="dialog"
          aria-label="Display"
          style={position ?? undefined}
        >
          <fieldset>
            <legend>Theme</legend>
            {THEMES.map((theme) => (
              <label key={theme.value} className="theme-menu__option">
                <input
                  type="radio"
                  name="theme"
                  value={theme.value}
                  checked={prefs.theme === theme.value}
                  onChange={() => setThemePrefs({ theme: theme.value })}
                />
                {theme.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Appearance</legend>
            {COLOR_MODES.map((mode) => (
              <label key={mode.value} className="theme-menu__option">
                <input
                  type="radio"
                  name="color-mode"
                  value={mode.value}
                  checked={prefs.mode === mode.value}
                  onChange={() => setThemePrefs({ mode: mode.value })}
                />
                {mode.label}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </div>
  )
}
