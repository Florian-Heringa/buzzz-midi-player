import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import {
  DEFAULT_SETTINGS,
  MAX_ZOOM,
  MIN_ZOOM,
  NOTE_DISPLAYS,
  updateSettings,
  useSettings
} from './settings'
import { COLOR_MODES, setThemePrefs, THEMES, useThemePrefs } from './theme'

/** Global preferences: appearance and how notes are shown. */
export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const settings = useSettings()
  const theme = useThemePrefs()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <h2 id="settings-title">Settings</h2>

      <section className="settings-dialog__section">
        <h3>Appearance</h3>
        <div className="settings-dialog__columns">
          <fieldset>
            <legend>Theme</legend>
            {THEMES.map((option) => (
              <label key={option.value} className="settings-dialog__option">
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={theme.theme === option.value}
                  onChange={() => setThemePrefs({ theme: option.value })}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Light or dark</legend>
            {COLOR_MODES.map((option) => (
              <label key={option.value} className="settings-dialog__option">
                <input
                  type="radio"
                  name="color-mode"
                  value={option.value}
                  checked={theme.mode === option.value}
                  onChange={() => setThemePrefs({ mode: option.value })}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </div>
      </section>

      <section className="settings-dialog__section">
        <h3>Notation</h3>
        <fieldset>
          <legend>Note display</legend>
          {NOTE_DISPLAYS.map((option) => (
            <label
              key={option.value}
              className={`settings-dialog__option settings-dialog__option--described${option.available ? '' : ' settings-dialog__option--unavailable'}`}
            >
              <input
                type="radio"
                name="note-display"
                value={option.value}
                disabled={!option.available}
                checked={settings.noteDisplay === option.value}
                onChange={() => updateSettings({ noteDisplay: option.value })}
              />
              <span>
                {option.label}
                <small>{option.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <label
          className="settings-dialog__row"
          onDoubleClick={() => updateSettings({ zoom: DEFAULT_SETTINGS.zoom })}
          title="Double-click to reset"
        >
          <span>Horizontal zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={10}
            value={settings.zoom}
            onChange={(e) => updateSettings({ zoom: Number(e.target.value) })}
            aria-valuetext={`${Math.round((settings.zoom / DEFAULT_SETTINGS.zoom) * 100)}%`}
          />
          <span className="settings-dialog__value">
            {Math.round((settings.zoom / DEFAULT_SETTINGS.zoom) * 100)}%
          </span>
        </label>

        <label className="settings-dialog__option">
          <input
            type="checkbox"
            checked={settings.followPlayhead}
            onChange={(e) => updateSettings({ followPlayhead: e.target.checked })}
          />
          Scroll the staff to follow the playhead while playing
        </label>
      </section>

      <div className="settings-dialog__actions">
        <button className="button--primary" onClick={close} autoFocus>
          Done
        </button>
      </div>
    </dialog>
  )
}
