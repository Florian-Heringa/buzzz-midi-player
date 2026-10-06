import { useEffect } from 'react'
import { MAX_TEMPO_FACTOR, MIN_TEMPO_FACTOR, useAppStore } from '../store/appStore'
import { formatTime } from './SongInfo'

export function TransportBar(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const transport = useAppStore((s) => s.transport)
  const positionTick = useAppStore((s) => s.positionTick)
  const tempoFactor = useAppStore((s) => s.tempoFactor)
  const engineStatus = useAppStore((s) => s.engineStatus)
  const togglePlay = useAppStore((s) => s.togglePlay)
  const stop = useAppStore((s) => s.stop)
  const seek = useAppStore((s) => s.seek)
  const setTempoFactor = useAppStore((s) => s.setTempoFactor)

  // Space toggles playback unless a text field has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (event.code !== 'Space' || target.matches('input[type="text"], textarea, select')) return
      event.preventDefault()
      void togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  if (!song) return null

  const { tempoMap } = song
  const elapsed = tempoMap.tickToSeconds(positionTick) / tempoFactor
  const total = tempoMap.tickToSeconds(song.durationTicks) / tempoFactor
  const bpm = Math.round(tempoMap.bpmAt(positionTick) * tempoFactor)
  const playing = transport === 'playing'

  return (
    <div className="transport">
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

      <label className="transport__tempo">
        <span>Tempo</span>
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

      {engineStatus === 'loading' && <span className="transport__status">Loading sounds…</span>}
    </div>
  )
}
