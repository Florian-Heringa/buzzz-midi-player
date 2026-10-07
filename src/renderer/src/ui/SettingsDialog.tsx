import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import {
  CHANNEL_TRACK_OPTIONS,
  updateSettings,
  useSettings
} from './settings'
import { COLOR_MODES, setThemePrefs, THEMES, useThemePrefs } from './theme'

/** Global preferences: appearance and how notes are shown. */
export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const reloadFile = useAppStore((s) => s.reloadFile)
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
      // A click on the backdrop (outside the dialog's box) closes it.
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const inside =
          e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
        if (!inside) close()
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
          <legend>MIDI tracks with several channels</legend>
          {CHANNEL_TRACK_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="settings-dialog__option settings-dialog__option--described"
            >
              <input
                type="radio"
                name="channel-tracks"
                value={option.value}
                checked={settings.channelTracks === option.value}
                onChange={() => {
                  updateSettings({ channelTracks: option.value })
                  void reloadFile()
                }}
              />
              <span>
                {option.label}
                <small>{option.hint}</small>
              </span>
            </label>
          ))}
          <small className="settings-dialog__footnote">
            Single-track (Type 0) MIDI files are always split by channel, since all their parts
            share one track.
          </small>
        </fieldset>

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
