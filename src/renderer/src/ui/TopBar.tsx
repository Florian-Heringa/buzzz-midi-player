import { useEffect, useState, type KeyboardEvent } from 'react'
import { measureCount } from '../model/measures'
import { MAX_TEMPO_FACTOR, MIN_TEMPO_FACTOR, useAppStore } from '../store/appStore'
import { formatTime, keyName } from './format'
import { ThemeMenu } from './ThemeMenu'

/** Top pane: file actions, song details, transport, tempo and loop controls. */
export function TopBar({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const openExportDialog = useAppStore((s) => s.openExportDialog)

  // The header is a single row that never wraps, so its height stays fixed when items
  // (like the last export) appear; song details are clipped instead on narrow windows.
  return (
    <div className="top-bar">
      <header className="top-bar__header">
        <div className="top-bar__row top-bar__row--fixed">
          <button onClick={onOpen}>Open MIDI…</button>
          <button onClick={openExportDialog} disabled={!song}>
            Export MP3…
          </button>
          <span className="top-bar__file">{song ? song.name : 'No file loaded'}</span>
          <SongSummary />
          <div className="top-bar__end">
            <LastExport />
            <ThemeMenu />
          </div>
        </div>
      </header>
      {song && (
        <div className="top-bar__playback" role="group" aria-label="Playback">
          <TransportRow />
          <div className="top-bar__row">
            <TempoControl />
            <LoopControls />
          </div>
        </div>
      )}
    </div>
  )
}

/** The last exported MP3: click to show it in the file explorer. */
function LastExport(): React.JSX.Element | null {
  const lastExport = useAppStore((s) => s.lastExport)
  const showLastExport = useAppStore((s) => s.showLastExport)
  const dismiss = useAppStore((s) => s.dismissLastExport)
  if (!lastExport) return null

  return (
    <span className="last-export">
      <button
        className="last-export__open"
        onClick={() => void showLastExport()}
        title={`Show in folder: ${lastExport.path}`}
      >
        <span className="last-export__icon" aria-hidden>
          ♪
        </span>
        <span className="last-export__name">{lastExport.name}</span>
        <span className="last-export__action">Show in folder</span>
      </button>
      <button
        className="last-export__dismiss"
        onClick={dismiss}
        aria-label={`Dismiss ${lastExport.name}`}
        title="Dismiss"
      >
        ×
      </button>
    </span>
  )
}

function SongSummary(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  if (!song) return null
  const timeSig = song.timeSignatures[0]
  const key = song.keySignatures[0]
  const varies = song.tempoMap.tempos.length > 1
  const items: [string, string][] = [
    ['Tempo', `${Math.round(song.tempoMap.bpmAt(0))} BPM${varies ? ' (varies)' : ''}`],
    ['Time', `${timeSig.numerator}/${timeSig.denominator}`],
    ['Key', keyName(key.fifths, key.mode)],
    ['Length', formatTime(song.tempoMap.tickToSeconds(song.durationTicks))],
    ['Bars', String(measureCount(song))],
    ['Tracks', String(song.tracks.length)]
  ]
  return (
    // Full text as a tooltip, since the summary is clipped when the header runs out of room.
    <dl className="song-summary" title={items.map(([label, value]) => `${label} ${value}`).join(' · ')}>
      {items.map(([label, value]) => (
        <div key={label} className="song-summary__item">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function TransportRow(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const transport = useAppStore((s) => s.transport)
  const positionTick = useAppStore((s) => s.positionTick)
  const tempoFactor = useAppStore((s) => s.tempoFactor)
  const engineStatus = useAppStore((s) => s.engineStatus)
  const togglePlay = useAppStore((s) => s.togglePlay)
  const stop = useAppStore((s) => s.stop)
  const seek = useAppStore((s) => s.seek)
  const loopEnabled = useAppStore((s) => s.loop.enabled)

  // Space toggles playback unless a text field has focus.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (event.code !== 'Space' || target.matches('input[type="text"], input[type="number"], textarea, select')) {
        return
      }
      event.preventDefault()
      void togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  if (!song) return null
  const elapsed = song.tempoMap.tickToSeconds(positionTick) / tempoFactor
  const total = song.tempoMap.tickToSeconds(song.durationTicks) / tempoFactor
  const playing = transport === 'playing'

  return (
    <div className="top-bar__row transport">
      <button
        className="transport__play"
        onClick={() => void togglePlay()}
        disabled={engineStatus === 'loading'}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button onClick={() => void stop()} aria-label="Stop" title={loopEnabled ? "Stop and return to the loop start" : "Stop and return to start"}>
        ■
      </button>
      <span className="transport__time">
        {formatTime(elapsed)} / {formatTime(total)}
      </span>
      <input
        className="transport__position"
        type="range"
        min={0}
        max={song.durationTicks}
        step={1}
        value={positionTick}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Position"
      />
      {engineStatus === 'loading' && <span className="transport__status">Loading sounds…</span>}
    </div>
  )
}

function TempoControl(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const tempoFactor = useAppStore((s) => s.tempoFactor)
  const positionTick = useAppStore((s) => s.positionTick)
  const setTempoFactor = useAppStore((s) => s.setTempoFactor)
  if (!song) return null
  const bpm = Math.round(song.tempoMap.bpmAt(positionTick) * tempoFactor)

  return (
    // Double-clicking anywhere on the control, including its label and value, resets it.
    <label
      className="control-group transport__tempo"
      onDoubleClick={() => setTempoFactor(1)}
      title="Double-click to reset to 100%"
    >
      <span className="control-group__label">Tempo</span>
      <input
        type="range"
        min={MIN_TEMPO_FACTOR * 100}
        max={MAX_TEMPO_FACTOR * 100}
        step={5}
        value={Math.round(tempoFactor * 100)}
        onChange={(e) => setTempoFactor(Number(e.target.value) / 100)}
      />
      <span className="transport__tempo-value">
        {Math.round(tempoFactor * 100)}% · {bpm} BPM
      </span>
    </label>
  )
}

/** Loop range controls. Playback does not loop yet; these only set the range. */
function LoopControls(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const loop = useAppStore((s) => s.loop)
  const setLoop = useAppStore((s) => s.setLoop)
  if (!song) return null
  const bars = measureCount(song)

  return (
    <div className="control-group loop-controls" role="group" aria-label="Loop">
      <button
        className={loop.enabled ? 'button--active' : ''}
        aria-pressed={loop.enabled}
        onClick={() => setLoop({ enabled: !loop.enabled })}
        title="Loop between the chosen bars (playback looping is not implemented yet)"
      >
        ⟲ Loop
      </button>
      <label className="loop-controls__bar">
        <span className="control-group__label">Bars</span>
        <BarInput
          value={loop.startBar}
          bars={bars}
          label="Loop start bar"
          onCommit={(startBar) => setLoop({ startBar })}
        />
      </label>
      <label className="loop-controls__bar">
        <span className="control-group__label">to</span>
        <BarInput
          value={loop.endBar}
          bars={bars}
          label="Loop end bar"
          onCommit={(endBar) => setLoop({ endBar })}
        />
      </label>
    </div>
  )
}

/**
 * Bar number field. Typing is free-form; the value is validated (by the store) only when
 * focus leaves the field or Enter is pressed. Escape cancels; ↑/↓ step immediately.
 */
function BarInput({
  value,
  bars,
  label,
  onCommit
}: {
  value: number
  bars: number
  label: string
  onCommit: (bar: number) => void
}): React.JSX.Element {
  // While editing, the typed text; null when showing the committed value.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft !== null && draft.trim() !== '') onCommit(Number(draft))
    setDraft(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      commit()
    } else if (event.key === 'Escape') {
      setDraft(null)
      event.currentTarget.blur()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onCommit(value + (event.key === 'ArrowUp' ? 1 : -1))
      setDraft(null)
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={onKeyDown}
      aria-label={label}
      title={`Bar 1–${bars}`}
    />
  )
}
