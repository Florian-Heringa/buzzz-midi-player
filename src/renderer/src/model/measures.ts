import type { Song } from './song'

/** Tick positions of every barline (start of each measure) up to the end of the song. */
export function measureStarts(song: Song): number[] {
  const starts: number[] = []
  song.timeSignatures.forEach((ts, i) => {
    const next = song.timeSignatures[i + 1]?.tick ?? song.durationTicks
    const length = (song.ppq * 4 * ts.numerator) / ts.denominator
    for (let tick = ts.tick; tick < next; tick += length) starts.push(tick)
  })
  if (starts.length === 0) starts.push(0)
  return starts
}

/** Number of measures (bars) in the song. */
export function measureCount(song: Song): number {
  return measureStarts(song).length
}
