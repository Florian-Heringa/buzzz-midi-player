import { describe, expect, it } from 'vitest'
import { exportMixes } from '../exportMix'
import { effectiveVolume, type TrackMix } from '../mixer'

const mix = (change: Partial<TrackMix> = {}): TrackMix => ({
  volume: 100,
  pan: 0,
  program: 0,
  muted: false,
  solo: false,
  ...change
})

/** Effective volume per track, as the synth would play it. */
const heard = (mixes: TrackMix[]): number[] => {
  const anySolo = mixes.some((m) => m.solo)
  return mixes.map((m) => effectiveVolume(m, anySolo))
}

describe('exportMixes', () => {
  const current = [mix({ volume: 90 }), mix({ volume: 70, pan: -20 }), mix({ muted: true })]

  it('keeps the current mix', () => {
    expect(heard(exportMixes(current, 0, 'mix'))).toEqual([90, 70, 0])
  })

  it('renders only the practice part, even if it was muted', () => {
    expect(heard(exportMixes(current, 2, 'practice-solo'))).toEqual([0, 0, 100])
  })

  it('renders everything but the practice part', () => {
    expect(heard(exportMixes(current, 0, 'practice-muted'))).toEqual([0, 70, 0])
  })

  it('drops the practice part solo but keeps solos on other tracks', () => {
    const soloed = [mix(), mix({ solo: true }), mix()]
    // Practice part was soloed: without it, the rest of the song plays.
    expect(heard(exportMixes(soloed, 1, 'practice-muted'))).toEqual([100, 0, 100])
    // Another track is soloed: that solo still applies.
    expect(heard(exportMixes(soloed, 0, 'practice-muted'))).toEqual([0, 100, 0])
  })

  it('does not modify the current mixes', () => {
    exportMixes(current, 0, 'practice-muted')
    expect(current[0].muted).toBe(false)
  })
})
