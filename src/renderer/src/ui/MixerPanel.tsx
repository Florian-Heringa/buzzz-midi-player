import { memo } from 'react'
import type { TrackMix } from '../audio/mixer'
import { GM_FAMILIES, GM_PROGRAM_NAMES, midiNoteName } from '../model/gm'
import { noteRange, type Track } from '../model/song'
import { useAppStore } from '../store/appStore'
import { panLabel } from './format'

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

      <label className="strip__pan">
        <span className="strip__label">Pan {panLabel(mix.pan)}</span>
        <input
          type="range"
          min={-64}
          max={63}
          value={mix.pan}
          onChange={(e) => update({ pan: Number(e.target.value) })}
          onDoubleClick={() => update({ pan: 0 })}
          title="Double-click to center"
          aria-label={`${track.name} pan`}
        />
      </label>

      <div className="strip__fader">
        <input
          type="range"
          min={0}
          max={127}
          value={mix.volume}
          onChange={(e) => update({ volume: Number(e.target.value) })}
          aria-label={`${track.name} volume`}
          aria-orientation="vertical"
        />
      </div>
      <span className="strip__value">{Math.round((mix.volume / 127) * 100)}%</span>

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
