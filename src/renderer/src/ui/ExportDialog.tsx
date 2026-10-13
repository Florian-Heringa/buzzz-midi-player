import { useEffect, useRef } from 'react'
import { EXPORT_BITRATES, MAX_EXPORT_REPEATS, type ExportMode } from '../presets/preset'
import { playbackRate, trackDisplayName, useAppStore } from '../store/appStore'

const MODES: { value: ExportMode; label: string; hint: (part: string) => string }[] = [
  { value: 'mix', label: 'Current mix', hint: () => 'All tracks with your volume, pan, mute and solo settings.' },
  { value: 'practice-solo', label: 'Practice part only', hint: (part) => `Only ${part}.` },
  {
    value: 'practice-muted',
    label: 'Without practice part',
    hint: (part) => `Everything except ${part}, to sing along with.`
  }
]

export function ExportDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.exportDialogOpen)
  const settings = useAppStore((s) => s.exportSettings)
  const progress = useAppStore((s) => s.exportProgress)
  const tempoFactor = useAppStore((s) => s.tempoFactor)
  const startBpm = useAppStore((s) => (s.song ? Math.round(s.song.tempoMap.bpmAt(0) * playbackRate(s)) : 0))
  const loop = useAppStore((s) => s.loop)
  const practice = useAppStore((s) =>
    s.song && s.selectedTrackId !== null ? trackDisplayName(s, s.selectedTrackId) : null
  )
  const setExportSettings = useAppStore((s) => s.setExportSettings)
  const startExport = useAppStore((s) => s.startExport)
  const close = useAppStore((s) => s.closeExportDialog)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  if (!open) return null
  const rendering = progress !== null
  const part = practice ?? 'the selected track'

  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <h2>Export MP3</h2>
      <fieldset disabled={rendering}>
        <legend>Contents</legend>
        {MODES.map((mode) => (
          <label key={mode.value} className="export-dialog__mode">
            <input
              type="radio"
              name="export-mode"
              value={mode.value}
              checked={settings.mode === mode.value}
              onChange={() => setExportSettings({ mode: mode.value })}
            />
            <span>
              {mode.label}
              <small>{mode.hint(part)}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset disabled={rendering}>
        <legend>Range</legend>
        <label className="export-dialog__mode">
          <input
            type="radio"
            name="export-range"
            checked={settings.range === 'song'}
            onChange={() => setExportSettings({ range: 'song' })}
          />
          <span>Whole song</span>
        </label>
        <label className="export-dialog__mode">
          <input
            type="radio"
            name="export-range"
            checked={settings.range === 'loop'}
            onChange={() => setExportSettings({ range: 'loop' })}
          />
          <span>
            Loop: {loop.startBar === loop.endBar ? `bar ${loop.startBar}` : `bars ${loop.startBar}–${loop.endBar}`}
            <small>Whether or not looping is switched on. The sound fades out after the last time.</small>
          </span>
        </label>
        <label className="export-dialog__repeats">
          Play the loop
          <select
            value={settings.repeats}
            disabled={settings.range !== 'loop'}
            onChange={(e) => setExportSettings({ repeats: Number(e.target.value) })}
            aria-label="Times to play the loop"
          >
            {Array.from({ length: MAX_EXPORT_REPEATS }, (_, i) => i + 1).map((times) => (
              <option key={times} value={times}>
                {times === 1 ? 'once' : `${times} times`}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="export-dialog__row">
        <label>
          Quality{' '}
          <select
            value={settings.bitrate}
            disabled={rendering}
            onChange={(e) => setExportSettings({ bitrate: Number(e.target.value) })}
          >
            {EXPORT_BITRATES.map((kbps) => (
              <option key={kbps} value={kbps}>
                {kbps} kbps
              </option>
            ))}
          </select>
        </label>
        <span className="export-dialog__tempo">
          Tempo {Math.round(tempoFactor * 100)}% · {startBpm} BPM
        </span>
      </div>

      {rendering && (
        <div className="export-dialog__progress">
          <progress value={progress} max={1} />
          <span>{Math.round(progress * 100)}%</span>
        </div>
      )}

      <div className="export-dialog__actions">
        <button onClick={close}>Cancel</button>
        <button className="button--primary" disabled={rendering} onClick={() => void startExport()}>
          {rendering ? 'Exporting…' : 'Export…'}
        </button>
      </div>
    </dialog>
  )
}
