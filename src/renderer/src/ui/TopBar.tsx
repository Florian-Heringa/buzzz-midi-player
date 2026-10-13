import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  enharmonicFifths,
  estimateDiffersFromFile,
  keyChoiceFromFile,
  keyName,
  sourceKey,
  type Accidentals,
  type KeyChoice,
  type KeySource,
  type Mode
} from '../model/keys'
import { lastLoopBarStart, loopTicks } from '../model/loop'
import { measureCount } from '../model/measures'
import { MAX_BASE_BPM, MIN_BASE_BPM } from '../presets/preset'
import {
  MAX_TEMPO_FACTOR,
  MIN_TEMPO_FACTOR,
  interpretedSong,
  playbackRate,
  tempoScale,
  useAppStore
} from '../store/appStore'
import { formatTime } from './format'

/** Top pane: file actions, song details, transport, tempo and loop controls. */
export function TopBar({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const openExportDialog = useAppStore((s) => s.openExportDialog)
  const openSettings = useAppStore((s) => s.openSettings)

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
            <button
              className="settings-button"
              onClick={openSettings}
              title="Settings (Ctrl+,)"
              aria-haspopup="dialog"
            >
              <span aria-hidden>⚙</span> Settings
            </button>
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
  const song = useAppStore(interpretedSong)
  const scale = useAppStore(tempoScale)
  if (!song) return null
  const timeSig = song.timeSignatures[0]
  const key = song.keySignatures[0]
  const varies = song.tempoMap.tempos.length > 1
  const items: [string, string][] = [
    ['Tempo', `${Math.round(song.tempoMap.bpmAt(0) * scale)} BPM${varies ? ' (varies)' : ''}`],
    ['Time', `${timeSig.numerator}/${timeSig.denominator}`],
    ['Key', keyName(key.fifths, key.mode)],
    ['Length', formatTime(song.tempoMap.tickToSeconds(song.durationTicks) / scale)],
    ['Bars', String(measureCount(song))],
    ['Tracks', String(song.tracks.length)]
  ]
  return (
    // Full text as a tooltip, since the summary is clipped when the header runs out of room.
    <dl className="song-summary" title={items.map(([label, value]) => `${label} ${value}`).join(' · ')}>
      {items.map(([label, value]) => (
        <div key={label} className="song-summary__item">
          <dt>{label}</dt>
          <dd>
            {label === 'Key' ? (
              <KeyPicker name={value} />
            ) : label === 'Tempo' ? (
              <TempoPicker name={value} />
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A menu that opens under its button: closes on a click elsewhere, Escape or a resize. Fixed
 * position, so the clipped song details can't hide it.
 */
function usePopover(): {
  button: RefObject<HTMLButtonElement | null>
  panel: RefObject<HTMLDivElement | null>
  position: { top: number; left: number } | null
  toggle: () => void
} {
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const open = position !== null

  useEffect(() => {
    if (!open) return
    const close = (): void => setPosition(null)
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close()
        button.current?.focus()
      }
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

  const toggle = useCallback(() => {
    setPosition((current) => {
      const rect = button.current?.getBoundingClientRect()
      return current || !rect ? null : { top: rect.bottom + 6, left: rect.left }
    })
  }, [])
  return { button, panel, position, toggle }
}

/**
 * The tempo as a button: correct the song's tempo when the file's is wrong. Tempo changes in
 * the file keep their proportions; the practice tempo (%) applies on top.
 */
function TempoPicker({ name }: { name: string }): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const baseBpm = useAppStore((s) => s.baseBpm)
  const setBaseBpm = useAppStore((s) => s.setBaseBpm)
  const { button, panel, position, toggle } = usePopover()
  const open = position !== null
  if (!song) return null
  const fileBpm = song.tempoMap.bpmAt(0)
  const varies = song.tempoMap.tempos.length > 1

  return (
    <>
      <button
        ref={button}
        className="summary-picker__button tempo-picker__button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        title={
          baseBpm === null
            ? 'Change the song tempo (if the file has it wrong)'
            : `Corrected from ${formatBpm(fileBpm)} BPM in the file. Click to change.`
        }
      >
        {name}
        <span aria-hidden> ▾</span>
      </button>
      {open && (
        <div
          ref={panel}
          className="summary-picker__panel tempo-picker__panel"
          role="dialog"
          aria-label="Song tempo"
          style={position}
        >
          <fieldset>
            <legend>Song tempo</legend>
            <p className="summary-picker__note">
              For files with the wrong tempo. The tempo slider then speeds up or slows down from here.
              {varies && ' Tempo changes in the file move along.'}
            </p>
            <label className="tempo-picker__field">
              <span>{varies ? 'Starts at' : 'Tempo'}</span>
              <NumberInput
                value={Math.round(baseBpm ?? fileBpm)}
                label="Song tempo in BPM"
                title={`${MIN_BASE_BPM}–${MAX_BASE_BPM} BPM`}
                onCommit={setBaseBpm}
              />
              <span>BPM</span>
            </label>
            <div className="tempo-picker__file">
              <span>
                The file says <strong>{formatBpm(fileBpm)} BPM</strong>
              </span>
              <button onClick={() => setBaseBpm(null)} disabled={baseBpm === null}>
                Use the file’s tempo
              </button>
            </div>
          </fieldset>
        </div>
      )}
    </>
  )
}

/** BPM with at most one decimal: 120, 97.5. */
function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 10) / 10)
}

const KEY_OPTIONS: { accidentals: Accidentals; mode: Mode; label: string }[] = [
  { accidentals: 'sharps', mode: 'major', label: '♯ Sharps · major' },
  { accidentals: 'sharps', mode: 'minor', label: '♯ Sharps · minor' },
  { accidentals: 'flats', mode: 'major', label: '♭ Flats · major' },
  { accidentals: 'flats', mode: 'minor', label: '♭ Flats · minor' }
]

/**
 * The key as a button: choose whether it reads on the sharp or flat side (switching to the
 * enharmonic key where one exists) and as major or minor.
 */
function KeyPicker({ name }: { name: string }): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const keyChoice = useAppStore((s) => s.keyChoice)
  const setKeyChoice = useAppStore((s) => s.setKeyChoice)
  const { button, panel, position, toggle } = usePopover()
  const open = position !== null

  if (!song) return null
  const fileKey = song.keySignatures[0]
  const current: KeyChoice = keyChoice ?? { ...keyChoiceFromFile(fileKey), source: 'file' }
  const source: KeySource = current.source ?? 'file'
  const offerEstimate = estimateDiffersFromFile(song)
  // The four readings below apply to the key of the chosen source.
  const baseKey = sourceKey(song, source)
  const baseReading = keyChoiceFromFile(baseKey)
  const chooseSource = (next: KeySource): void =>
    setKeyChoice({ ...keyChoiceFromFile(sourceKey(song, next)), source: next })

  return (
    <>
      <button
        ref={button}
        className="summary-picker__button key-picker__button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        title={
          fileKey.estimated
            ? 'Key estimated from the notes (the file has none). Click to change how it is read.'
            : 'Change how the key is read'
        }
      >
        {name}
        <span aria-hidden> ▾</span>
      </button>
      {open && (
        <div ref={panel} className="summary-picker__panel key-picker__panel" role="dialog" aria-label="Key" style={position}>
          {offerEstimate && song.estimatedKey && (
            <fieldset className="key-picker__sources">
              <legend>Key signature</legend>
              {(['file', 'estimate'] as const).map((option) => {
                const key = sourceKey(song, option)
                return (
                  <label key={option} className="key-picker__option">
                    <input
                      type="radio"
                      name="key-source"
                      checked={source === option}
                      onChange={() => chooseSource(option)}
                    />
                    <span className="key-picker__label">
                      {option === 'file' ? 'From the file' : 'Estimated from the notes'}
                    </span>
                    <span className="key-picker__result">{keyName(key.fifths, key.mode)}</span>
                  </label>
                )
              })}
            </fieldset>
          )}
          <fieldset>
            <legend>Read the key as</legend>
            {fileKey.estimated && (
              <p className="summary-picker__note">This file has no key signature, so the key was estimated from the notes.</p>
            )}
            {KEY_OPTIONS.map((option) => {
              const fifths = enharmonicFifths(baseKey.fifths, option.accidentals)
              const isBaseReading =
                option.accidentals === baseReading.accidentals && option.mode === baseReading.mode
              return (
                <label key={option.label} className="key-picker__option">
                  <input
                    type="radio"
                    name="key-choice"
                    checked={current.accidentals === option.accidentals && current.mode === option.mode}
                    onChange={() => setKeyChoice({ ...option, source })}
                  />
                  <span className="key-picker__label">{option.label}</span>
                  <span className="key-picker__result">
                    {keyName(fifths, option.mode)}
                    {isBaseReading && <small> ({baseKey.estimated ? 'estimated' : 'file'})</small>}
                  </span>
                </label>
              )
            })}
          </fieldset>
        </div>
      )}
    </>
  )
}

function TransportRow(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const transport = useAppStore((s) => s.transport)
  const positionTick = useAppStore((s) => s.positionTick)
  const rate = useAppStore(playbackRate)
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
  const elapsed = song.tempoMap.tickToSeconds(positionTick) / rate
  const total = song.tempoMap.tickToSeconds(song.durationTicks) / rate
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
  const rate = useAppStore(playbackRate)
  if (!song) return null
  const bpm = Math.round(song.tempoMap.bpmAt(positionTick) * rate)

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

/** Loop on/off, the loop's bars, and jumps to its start and its last bar. */
function LoopControls(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const loop = useAppStore((s) => s.loop)
  const setLoop = useAppStore((s) => s.setLoop)
  const seek = useAppStore((s) => s.seek)
  if (!song) return null
  const bars = measureCount(song)
  const goToStart = (): void => {
    const state = useAppStore.getState()
    if (state.song) seek(loopTicks(state.song, state.loop).start)
  }

  return (
    <div className="control-group loop-controls" role="group" aria-label="Loop">
      <button
        className={loop.enabled ? 'button--active' : ''}
        aria-pressed={loop.enabled}
        onClick={() => setLoop({ enabled: !loop.enabled })}
        title="Loop between the chosen bars: playback jumps back to the first bar after the last"
      >
        ⟲ Loop
      </button>
      <label className="loop-controls__bar">
        <span className="control-group__label">Bars</span>
        <NumberInput
          value={loop.startBar}
          label="Loop start bar"
          title={`Bar 1–${bars}; the playhead moves there`}
          onCommit={(startBar) => {
            setLoop({ startBar })
            goToStart()
          }}
        />
      </label>
      <label className="loop-controls__bar">
        <span className="control-group__label">to</span>
        <NumberInput
          value={loop.endBar}
          label="Loop end bar"
          title={`Bar 1–${bars}`}
          onCommit={(endBar) => setLoop({ endBar })}
        />
      </label>
      <button
        className="loop-controls__jump"
        onClick={goToStart}
        aria-label="Go to loop start"
        title={`Go to the loop start (bar ${loop.startBar})`}
      >
        ⇤
      </button>
      <button
        className="loop-controls__jump"
        onClick={() => seek(lastLoopBarStart(song, loop))}
        aria-label="Go to loop end"
        title={`Go to the loop's last bar (bar ${loop.endBar})`}
      >
        ⇥
      </button>
    </div>
  )
}

/**
 * Whole-number field. Typing is free-form; the value is validated (by the caller) only when
 * focus leaves the field or Enter is pressed. Escape cancels; ↑/↓ step immediately.
 */
function NumberInput({
  value,
  label,
  title,
  onCommit
}: {
  value: number
  label: string
  title: string
  onCommit: (value: number) => void
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
      title={title}
    />
  )
}
