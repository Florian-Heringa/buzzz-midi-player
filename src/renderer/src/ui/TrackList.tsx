import { memo } from 'react'
import type { TrackMix } from '../audio/mixer'
import { GM_FAMILIES, GM_PROGRAM_NAMES, midiNoteName } from '../model/gm'
import { noteRange, type Track } from '../model/song'
import { useAppStore } from '../store/appStore'

function describeTrack(track: Track): string {
  const range = noteRange(track)
  const rangeText = range && !track.isDrum ? ` · ${midiNoteName(range.low)}–${midiNoteName(range.high)}` : ''
  return `${track.notes.length} notes${rangeText}`
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
      className="mixer__instrument"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Instrument"
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

function TrackRow({
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

  return (
    <li
      role="option"
      aria-selected={selected}
      className={[
        'track-list__item',
        selected && 'track-list__item--selected',
        silenced && 'track-list__item--silenced'
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => selectTrack(track.id)}
    >
      <div className="track-list__header">
        <span className="track-list__name">{track.name}</span>
        {/* Controls don't change the selected track. */}
        <span className="mixer__toggles" onClick={(e) => e.stopPropagation()}>
          <button
            className={`mixer__toggle${mix.muted ? ' mixer__toggle--mute' : ''}`}
            aria-pressed={mix.muted}
            title="Mute"
            onClick={() => update({ muted: !mix.muted })}
          >
            M
          </button>
          <button
            className={`mixer__toggle${mix.solo ? ' mixer__toggle--solo' : ''}`}
            aria-pressed={mix.solo}
            title="Solo"
            onClick={() => update({ solo: !mix.solo })}
          >
            S
          </button>
        </span>
      </div>
      <span className="track-list__meta">
        {describeTrack(track)}
        {shared && (
          <span title="More than 15 tracks: this track shares a synth channel, so its mixer settings also affect other tracks.">
            {' '}
            · ⚠ shared channel
          </span>
        )}
      </span>

      <div className="mixer" onClick={(e) => e.stopPropagation()}>
        <label className="mixer__row">
          <span>Vol</span>
          <input
            type="range"
            min={0}
            max={127}
            value={mix.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
            aria-label={`${track.name} volume`}
          />
          <span className="mixer__value">{Math.round((mix.volume / 127) * 100)}%</span>
        </label>
        <label className="mixer__row">
          <span>Pan</span>
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
          <span className="mixer__value">{panLabel(mix.pan)}</span>
        </label>
        {track.isDrum ? (
          <span className="mixer__drums">Drum kit</span>
        ) : (
          <InstrumentSelect value={mix.program} onChange={(program) => update({ program })} />
        )}
      </div>
    </li>
  )
}

function panLabel(pan: number): string {
  if (pan === 0) return 'C'
  return pan < 0 ? `L${Math.round((-pan / 64) * 100)}` : `R${Math.round((pan / 63) * 100)}`
}

export function TrackList(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const mixes = useAppStore((s) => s.mixes)
  const assignment = useAppStore((s) => s.assignment)
  const selectedTrackId = useAppStore((s) => s.selectedTrackId)
  if (!song) return null
  const anySolo = mixes.some((m) => m.solo)

  return (
    <ul className="track-list" role="listbox" aria-label="Tracks">
      {song.tracks.map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          mix={mixes[track.id]}
          selected={track.id === selectedTrackId}
          shared={assignment?.sharedTrackIds.has(track.id) ?? false}
          anySolo={anySolo}
        />
      ))}
    </ul>
  )
}

