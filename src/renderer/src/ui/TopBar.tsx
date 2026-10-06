import { useEffect } from 'react'
import { measureCount } from '../model/measures'
import { MAX_TEMPO_FACTOR, MIN_TEMPO_FACTOR, useAppStore } from '../store/appStore'
import { formatTime, keyName } from './format'

/** Top pane: file actions, song details, transport, tempo and loop controls. */
export function TopBar({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const error = useAppStore((s) => s.error)
  const notice = useAppStore((s) => s.notice)
  const openExportDialog = useAppStore((s) => s.openExportDialog)

  return (
    <div className="top-bar">
      <div className="top-bar__row">
        <button onClick={onOpen}>Open MIDI…</button>
        <button onClick={openExportDialog} disabled={!song}>
          Export MP3…
        </button>
        <span className="top-bar__file">{song ? song.name : 'No file loaded'}</span>
        <SongSummary />
        {notice && (
          <span className="top-bar__notice" role="status">
            {notice}
          </span>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {song && (
        <>
          <TransportRow />
          <div className="top-bar__row">
            <TempoControl />
            <LoopControls />
          </div>
        </>
      )}
    </div>
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
    <dl className="song-summary">
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

  // Space toggles playback unless a text field has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
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
      <button onClick={() => void stop()} aria-label="Stop" title="Stop and return to start">
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
    <label className="control-group transport__tempo">
      <span className="control-group__label">Tempo</span>
      <input
        type="range"
        min={MIN_TEMPO_FACTOR * 100}
        max={MAX_TEMPO_FACTOR * 100}
        step={5}
        value={Math.round(tempoFactor * 100)}
        onChange={(e) => setTempoFactor(Number(e.target.value) / 100)}
        onDoubleClick={() => setTempoFactor(1)}
        title="Double-click to reset to 100%"
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
        <input
          type="number"
          min={1}
          max={bars}
          value={loop.startBar}
          onChange={(e) => setLoop({ startBar: Number(e.target.value) })}
          aria-label="Loop start bar"
        />
      </label>
      <label className="loop-controls__bar">
        <span className="control-group__label">to</span>
        <input
          type="number"
          min={1}
          max={bars}
          value={loop.endBar}
          onChange={(e) => setLoop({ endBar: Number(e.target.value) })}
          aria-label="Loop end bar"
        />
      </label>
    </div>
  )
}
