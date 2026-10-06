import { memo, useState } from 'react'
import { DEFAULT_VOLUME, effectiveVolume, type TrackMix } from '../audio/mixer'
import { GM_FAMILIES, GM_PROGRAM_NAMES, midiNoteName } from '../model/gm'
import { isSounding } from '../model/sounding'
import { noteRange, type Track } from '../model/song'
import { MAX_TRACK_LABEL_LENGTH } from '../presets/preset'
import { useAppStore } from '../store/appStore'
import { panLabel } from './format'
import { Knob } from './Knob'

const volumeText = (volume: number): string => `Vol ${Math.round((volume / 127) * 100)}%`
const panText = (pan: number): string => `Pan ${panLabel(pan)}`

/**
 * Activity meter: the track's audible volume while one of its notes is sounding.
 * Subscribes to the playhead itself so the rest of the strip doesn't re-render every frame.
 */
function LevelMeter({
  track,
  name,
  level
}: {
  track: Track
  name: string
  level: number
}): React.JSX.Element {
  const active = useAppStore(
    (s) => s.transport === 'playing' && isSounding(track, s.positionTick)
  )
  const shown = active ? level : 0
  return (
    <div className="strip__meter" role="meter" aria-label={`${name} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
      <div className="strip__meter-fill" style={{ height: `${shown * 100}%` }} />
    </div>
  )
}

/** Bottom pane: one vertical channel strip per track. */
export function MixerPanel(): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const mixes = useAppStore((s) => s.mixes)
  const assignment = useAppStore((s) => s.assignment)
  const selectedTrackId = useAppStore((s) => s.selectedTrackId)
  const trackLabels = useAppStore((s) => s.trackLabels)
  if (!song) return <p className="placeholder mixer-panel__empty">The mixer appears when a file is open.</p>
  const anySolo = mixes.some((m) => m.solo)

  return (
    <div className="mixer-panel" role="group" aria-label="Mixer">
      {song.tracks.map((track) => (
        <ChannelStrip
          key={track.id}
          track={track}
          name={trackLabels[track.id] || track.name}
          mix={mixes[track.id]}
          selected={track.id === selectedTrackId}
          shared={assignment?.sharedTrackIds.has(track.id) ?? false}
          anySolo={anySolo}
        />
      ))}
    </div>
  )
}

function ChannelStrip({
  track,
  name,
  mix,
  selected,
  shared,
  anySolo
}: {
  track: Track
  /** Display name: custom name or the name from the file. */
  name: string
  mix: TrackMix
  selected: boolean
  shared: boolean
  anySolo: boolean
}): React.JSX.Element {
  const selectTrack = useAppStore((s) => s.selectTrack)
  const updateMix = useAppStore((s) => s.updateMix)
  const update = (change: Partial<TrackMix>): void => updateMix(track.id, change)
  const silenced = mix.muted || (anySolo && !mix.solo)
  const range = noteRange(track)

  return (
    <section
      className={['strip', selected && 'strip--selected', silenced && 'strip--silenced']
        .filter(Boolean)
        .join(' ')}
      aria-label={name}
    >
      <TrackName track={track} name={name} selected={selected} onSelect={() => selectTrack(track.id)} />
      <span className="strip__meta" title={`${track.notes.length} notes`}>
        {range && !track.isDrum
          ? `${midiNoteName(range.low)}–${midiNoteName(range.high)}`
          : `${track.notes.length} notes`}
        {shared && (
          <span
            className="strip__warning"
            title="More than 15 tracks: this track shares a synth channel, so its mixer settings also affect other tracks."
          >
            {' '}⚠
          </span>
        )}
      </span>

      {track.isDrum ? (
        <span className="strip__drums">Drum kit</span>
      ) : (
        <InstrumentSelect value={mix.program} onChange={(program) => update({ program })} />
      )}

      <div className="strip__knobs">
        <Knob
          label={`${name} pan`}
          value={mix.pan}
          min={-64}
          max={63}
          defaultValue={0}
          bipolar
          format={panText}
          onChange={(pan) => update({ pan })}
        />
        <Knob
          label={`${name} volume`}
          value={mix.volume}
          min={0}
          max={127}
          defaultValue={DEFAULT_VOLUME}
          format={volumeText}
          onChange={(volume) => update({ volume })}
        />
      </div>

      <LevelMeter track={track} name={name} level={effectiveVolume(mix, anySolo) / 127} />

      <div className="strip__toggles">
        <button
          className={`strip__toggle${mix.muted ? ' strip__toggle--mute' : ''}`}
          aria-pressed={mix.muted}
          title="Mute"
          onClick={() => update({ muted: !mix.muted })}
        >
          M
        </button>
        <button
          className={`strip__toggle${mix.solo ? ' strip__toggle--solo' : ''}`}
          aria-pressed={mix.solo}
          title="Solo"
          onClick={() => update({ solo: !mix.solo })}
        >
          S
        </button>
      </div>
    </section>
  )
}

/**
 * Track name button: click to make it the practice part, double-click to rename.
 * Renaming saves on Enter or when focus leaves; Escape cancels; an empty name restores
 * the name from the MIDI file.
 */
function TrackName({
  track,
  name,
  selected,
  onSelect
}: {
  track: Track
  name: string
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const renameTrack = useAppStore((s) => s.renameTrack)
  const [draft, setDraft] = useState<string | null>(null)

  if (draft !== null) {
    const finish = (save: boolean): void => {
      if (save) renameTrack(track.id, draft)
      setDraft(null)
    }
    return (
      <input
        className="strip__name strip__name-input"
        type="text"
        value={draft}
        maxLength={MAX_TRACK_LABEL_LENGTH}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true)
          else if (e.key === 'Escape') finish(false)
        }}
        aria-label={`Rename ${name}`}
        placeholder={track.name}
      />
    )
  }

  const renamed = name !== track.name
  return (
    <button
      className="strip__name"
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={() => setDraft(name)}
      title={`${selected ? `${name} (practice part)` : `Practice ${name}`}${renamed ? ` · originally "${track.name}"` : ''} · double-click to rename`}
    >
      {name}
    </button>
  )
}

/** GM instrument picker, grouped by family. */
const InstrumentSelect = memo(function InstrumentSelect({
  value,
  onChange
}: {
  value: number
  onChange: (program: number) => void
}): React.JSX.Element {
  return (
    <select
      className="strip__instrument"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Instrument"
      title={GM_PROGRAM_NAMES[value]}
    >
      {GM_FAMILIES.map((family, familyIndex) => (
        <optgroup key={family} label={family}>
          {GM_PROGRAM_NAMES.slice(familyIndex * 8, familyIndex * 8 + 8).map((name, i) => (
            <option key={name} value={familyIndex * 8 + i}>
              {name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
})
