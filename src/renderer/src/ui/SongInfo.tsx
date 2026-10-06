import { useAppStore } from '../store/appStore'

const SHARP_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const FLAT_KEYS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
const SHARP_MINOR_KEYS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']
const FLAT_MINOR_KEYS = ['A', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab']

function keyName(fifths: number, mode: 'major' | 'minor'): string {
  const names =
    mode === 'major'
      ? fifths >= 0
        ? SHARP_KEYS
        : FLAT_KEYS
      : fifths >= 0
        ? SHARP_MINOR_KEYS
        : FLAT_MINOR_KEYS
  return `${names[Math.min(Math.abs(fifths), 7)]} ${mode}`
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function SongInfo(): React.JSX.Element | null {
  const song = useAppStore((s) => s.song)
  if (!song) return null

  const timeSig = song.timeSignatures[0]
  const key = song.keySignatures[0]
  const tempoChanges = song.tempoMap.tempos.length > 1 ? ' (varies)' : ''
  const duration = song.tempoMap.tickToSeconds(song.durationTicks)

  return (
    <dl className="song-info">
      <dt>Tempo</dt>
      <dd>
        {Math.round(song.tempoMap.bpmAt(0))} BPM{tempoChanges}
      </dd>
      <dt>Time</dt>
      <dd>
        {timeSig.numerator}/{timeSig.denominator}
      </dd>
      <dt>Key</dt>
      <dd>{keyName(key.fifths, key.mode)}</dd>
      <dt>Length</dt>
      <dd>{formatTime(duration)}</dd>
      <dt>Tracks</dt>
      <dd>{song.tracks.length}</dd>
    </dl>
  )
}
