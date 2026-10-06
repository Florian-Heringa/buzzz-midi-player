import { memo } from 'react'
import { DEFAULT_VOLUME, effectiveVolume, type TrackMix } from '../audio/mixer'
import { GM_FAMILIES, GM_PROGRAM_NAMES, midiNoteName } from '../model/gm'
import { isSounding } from '../model/sounding'
import { noteRange, type Track } from '../model/song'
import { useAppStore } from '../store/appStore'
import { panLabel } from './format'
import { Knob } from './Knob'

const volumeText = (volume: number): string => `Vol ${Math.round((volume / 127) * 100)}%`
const panText = (pan: number): string => `Pan ${panLabel(pan)}`

/**
 * Activity meter: the track's audible volume while one of its notes is sounding.
 * Subscribes to the playhead itself so the rest of the strip doesn't re-render every frame.
 */
function LevelMeter({ track, level }: { track: Track; level: number }): React.JSX.Element {
  const active = useAppStore(
    (s) => s.transport === 'playing' && isSounding(track, s.positionTick)
  )
  const shown = active ? level : 0
  return (
    <div className="strip__meter" role="meter" aria-label={`${track.name} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
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
  if (!song) return <p className="placeholder mixer-panel__empty">The mixer appears when a file is open.</p>
  const anySolo = mixes.some((m) => m.solo)

  return (
    <div className="mixer-panel" role="group" aria-label="Mixer">
      {song.tracks.map((track) => (
        <ChannelStrip
          key={track.id}
          track={track}
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
  mix,
  selected,
  shared,
  anySolo
}: {
  track: Track
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
      aria-label={track.name}
    >
      <button
        className="strip__name"
        aria-pressed={selected}
        onClick={() => selectTrack(track.id)}
        title={selected ? `${track.name} (practice part)` : `Practice ${track.name}`}
      >
        {track.name}
      </button>
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
          label={`${track.name} pan`}
          value={mix.pan}
          min={-64}
          max={63}
          defaultValue={0}
          bipolar
          format={panText}
          onChange={(pan) => update({ pan })}
        />
        <Knob
          label={`${track.name} volume`}
          value={mix.volume}
          min={0}
          max={127}
          defaultValue={DEFAULT_VOLUME}
          format={volumeText}
          onChange={(volume) => update({ volume })}
        />
      </div>

      <LevelMeter track={track} level={effectiveVolume(mix, anySolo) / 127} />

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
