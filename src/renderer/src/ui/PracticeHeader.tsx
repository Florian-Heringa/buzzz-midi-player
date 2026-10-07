import { trackDisplayName, useAppStore } from '../store/appStore'
import { DEFAULT_SETTINGS, MAX_ZOOM, MIN_ZOOM, NOTE_DISPLAYS, updateSettings, useSettings } from './settings'

/** Title of the practice track plus one-click solo / mute for it. */
export function PracticeHeader(): React.JSX.Element | null {
  const track = useAppStore((s) =>
    s.song && s.selectedTrackId !== null ? s.song.tracks[s.selectedTrackId] : null
  )
  const mix = useAppStore((s) => (s.selectedTrackId !== null ? s.mixes[s.selectedTrackId] : null))
  const updateMix = useAppStore((s) => s.updateMix)
  const name = useAppStore((s) => trackDisplayName(s, s.selectedTrackId))
  if (!track || !mix) return null

  return (
    <div className="practice-header">
      <h2 className="practice-header__title">
        <span className="practice-header__swatch" aria-hidden />
        {name}
      </h2>
      <button
        aria-pressed={mix.solo}
        className={mix.solo ? 'button--active' : ''}
        onClick={() => updateMix(track.id, { solo: !mix.solo, muted: false })}
        title="Hear only this part (other soloed parts stay audible)"
      >
        Solo part
      </button>
      <button
        aria-pressed={mix.muted}
        className={mix.muted ? 'button--active' : ''}
        onClick={() => updateMix(track.id, { muted: !mix.muted, solo: false })}
        title="Sing this part yourself with the other parts playing"
      >
        Mute part
      </button>
      <ViewSwitch />
      <ZoomControl />
    </div>
  )
}

/** Piano roll or sheet music, as a pair of toggle buttons. */
function ViewSwitch(): React.JSX.Element {
  const { noteDisplay } = useSettings()
  return (
    <div className="view-switch" role="group" aria-label="Note display">
      {NOTE_DISPLAYS.filter((option) => option.available).map((option) => (
        <button
          key={option.value}
          className={noteDisplay === option.value ? 'button--active' : undefined}
          aria-pressed={noteDisplay === option.value}
          onClick={() => updateSettings({ noteDisplay: option.value })}
          title={option.hint}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Zoom factor for one button press of − or +. */
const ZOOM_STEP = 1.25

/** Horizontal zoom of the note display (also: mouse wheel over the notes). */
function ZoomControl(): React.JSX.Element {
  const { zoom } = useSettings()
  const percent = Math.round((zoom / DEFAULT_SETTINGS.zoom) * 100)
  const set = (value: number): void => updateSettings({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)) })

  return (
    <div
      className="zoom-control"
      role="group"
      aria-label="Zoom"
      title="Zoom (or use the mouse wheel over the notes) · double-click to reset"
      onDoubleClick={(e) => {
        if (!(e.target instanceof HTMLButtonElement)) set(DEFAULT_SETTINGS.zoom)
      }}
    >
      <span className="zoom-control__label">Zoom</span>
      <button onClick={() => set(zoom / ZOOM_STEP)} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM}>
        −
      </button>
      <input
        type="range"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={1}
        value={zoom}
        onChange={(e) => set(Number(e.target.value))}
        aria-label="Zoom"
        aria-valuetext={`${percent}%`}
      />
      <button onClick={() => set(zoom * ZOOM_STEP)} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM}>
        +
      </button>
      <span className="zoom-control__value">{percent}%</span>
    </div>
  )
}
