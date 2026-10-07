import type { KeySignature, Track } from './song'

/**
 * Krumhansl–Kessler key profiles: how strongly each scale degree (from the tonic) is felt
 * to belong to a major or minor key.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/**
 * Key signature (sharps +, flats −) of the major key on each tonic pitch class, choosing the
 * conventional spelling with the fewest accidentals (D♭ rather than C♯, F♯ rather than G♭).
 */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]

/** Total sounding time (ticks) of each pitch class over the melodic tracks. */
export function pitchClassDurations(tracks: readonly Track[]): number[] {
  const durations = new Array(12).fill(0)
  for (const track of tracks) {
    if (track.isDrum) continue
    for (const note of track.notes) durations[note.midi % 12] += note.durationTicks
  }
  return durations
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length
  const ma = mean(a)
  const mb = mean(b)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

/**
 * Estimates the key from how long each pitch class sounds (Krumhansl–Schmuckler method).
 * Returns null when there are no pitched notes to go on.
 */
export function estimateKey(tracks: readonly Track[]): Omit<KeySignature, 'tick'> | null {
  const durations = pitchClassDurations(tracks)
  if (durations.every((d) => d === 0)) return null

  let best = { score: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' }
  for (let tonic = 0; tonic < 12; tonic++) {
    // Rotate so index 0 is this tonic.
    const relative = durations.map((_, degree) => durations[(tonic + degree) % 12])
    for (const [mode, profile] of [
      ['major', MAJOR_PROFILE],
      ['minor', MINOR_PROFILE]
    ] as const) {
      const score = correlation(relative, profile)
      if (score > best.score) best = { score, tonic, mode }
    }
  }
  // A minor key shares its signature with the major key a minor third above.
  const majorTonic = best.mode === 'major' ? best.tonic : (best.tonic + 3) % 12
  return { fifths: MAJOR_FIFTHS[majorTonic], mode: best.mode }
}
