const SHARP_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const FLAT_KEYS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
const SHARP_MINOR_KEYS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']
const FLAT_MINOR_KEYS = ['A', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab']

/** Key name from a key signature, e.g. (1, 'major') → "G major". */
export function keyName(fifths: number, mode: 'major' | 'minor'): string {
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

/** Minutes and seconds, e.g. 75 → "1:15". */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Pan as L/C/R percentage, e.g. -32 → "L50". */
export function panLabel(pan: number): string {
  if (pan === 0) return 'C'
  return pan < 0 ? `L${Math.round((-pan / 64) * 100)}` : `R${Math.round((pan / 63) * 100)}`
}
