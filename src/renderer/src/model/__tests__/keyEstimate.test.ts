import { describe, expect, it } from 'vitest'
import { estimateKey } from '../keyEstimate'
import type { Track } from '../song'

/** A track playing the given pitches in turn, each `beats` quarter notes long. */
const melody = (pitches: number[], beats: number[] = pitches.map(() => 1), isDrum = false): Track => {
  let tick = 0
  return {
    id: 0,
    name: 'T',
    sourceChannel: isDrum ? 9 : 0,
    program: 0,
    isDrum,
    notes: pitches.map((midi, i) => {
      const note = { midi, tick, durationTicks: beats[i] * 480, velocity: 100 }
      tick += note.durationTicks
      return note
    })
  }
}

// Scale degrees with tonic and dominant emphasised, as in real music.
const majorTune = (tonic: number): Track =>
  melody(
    [0, 2, 4, 5, 7, 9, 11, 12, 7, 4, 0].map((d) => tonic + d),
    [2, 1, 1, 1, 2, 1, 1, 2, 2, 1, 3]
  )
const minorTune = (tonic: number): Track =>
  melody(
    [0, 2, 3, 5, 7, 8, 10, 12, 7, 3, 0].map((d) => tonic + d),
    [2, 1, 2, 1, 2, 1, 1, 2, 2, 2, 3]
  )

describe('estimateKey', () => {
  it('finds major keys', () => {
    expect(estimateKey([majorTune(60)])).toEqual({ fifths: 0, mode: 'major' }) // C
    expect(estimateKey([majorTune(57)])).toEqual({ fifths: 3, mode: 'major' }) // A
    expect(estimateKey([majorTune(63)])).toEqual({ fifths: -3, mode: 'major' }) // E♭
    expect(estimateKey([majorTune(61)])).toEqual({ fifths: -5, mode: 'major' }) // D♭, not C♯
  })

  it('finds minor keys with their relative major signature', () => {
    expect(estimateKey([minorTune(57)])).toEqual({ fifths: 0, mode: 'minor' }) // A minor
    expect(estimateKey([minorTune(54)])).toEqual({ fifths: 3, mode: 'minor' }) // F♯ minor
    expect(estimateKey([minorTune(62)])).toEqual({ fifths: -1, mode: 'minor' }) // D minor
  })

  it('ignores drums and returns null without pitched notes', () => {
    expect(estimateKey([melody([36, 38, 42], undefined, true)])).toBeNull()
    expect(estimateKey([])).toBeNull()
    expect(estimateKey([majorTune(57), melody([36, 37, 38, 39, 40, 41], undefined, true)])).toEqual({
      fifths: 3,
      mode: 'major'
    })
  })
})
