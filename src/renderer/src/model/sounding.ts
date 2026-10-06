import type { Track } from './song'

/** Per track: the latest end tick among notes 0..i (notes are sorted by start). */
const runningMaxEnd = new WeakMap<Track, Float64Array>()

function maxEnds(track: Track): Float64Array {
  let ends = runningMaxEnd.get(track)
  if (!ends) {
    ends = new Float64Array(track.notes.length)
    let max = -Infinity
    track.notes.forEach((note, i) => {
      max = Math.max(max, note.tick + note.durationTicks)
      ends![i] = max
    })
    runningMaxEnd.set(track, ends)
  }
  return ends
}

/** Whether any note of the track is sounding at `tick`. */
export function isSounding(track: Track, tick: number): boolean {
  const { notes } = track
  // Last note starting at or before tick.
  let low = 0
  let high = notes.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (notes[mid].tick <= tick) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found >= 0 && maxEnds(track)[found] > tick
}
