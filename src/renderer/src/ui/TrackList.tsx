import { gmProgramName, midiNoteName } from '../model/gm'
import { noteRange, type Track } from '../model/song'
import { useAppStore } from '../store/appStore'

function describeTrack(track: Track): string {
  const instrument = track.isDrum ? 'Drums' : gmProgramName(track.program)
  const range = noteRange(track)
  const rangeText = range && !track.isDrum ? ` · ${midiNoteName(range.low)}–${midiNoteName(range.high)}` : ''
  return `${instrument} · ${track.notes.length} notes${rangeText}`
}

export function TrackList(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  const selectedTrackId = useAppStore((s) => s.selectedTrackId)
  const selectTrack = useAppStore((s) => s.selectTrack)
  if (!song) return null

  return (
    <ul className="track-list" role="listbox" aria-label="Tracks">
      {song.tracks.map((track) => (
        <li
          key={track.id}
          role="option"
          aria-selected={track.id === selectedTrackId}
          className={`track-list__item${track.id === selectedTrackId ? ' track-list__item--selected' : ''}`}
          onClick={() => selectTrack(track.id)}
        >
          <span className="track-list__name">{track.name}</span>
          <span className="track-list__meta">{describeTrack(track)}</span>
        </li>
      ))}
    </ul>
  )
}
