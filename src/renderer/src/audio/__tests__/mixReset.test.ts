import { describe, expect, it } from 'vitest'
import type { Track } from '../../model/song'
import { canReset, resetMixes, type TrackMix } from '../mixer'

const track = (id: number, isDrum = false): Track => ({
  id,
  name: `T${id}`,
  sourceChannel: isDrum ? 9 : id,
  program: 0,
  isDrum,
  notes: []
})
const tracks = [track(0), track(1), track(2, true)]
const mixes: TrackMix[] = [
  { volume: 60, pan: -20, program: 52, muted: true, solo: false },
  { volume: 100, pan: 0, program: 40, muted: false, solo: true },
  { volume: 90, pan: 10, program: 25, muted: false, solo: false }
]

describe('resetting the mix for all tracks', () => {
  it('resets one setting and leaves the others', () => {
    expect(resetMixes(mixes, tracks, 'volume').map((m) => m.volume)).toEqual([100, 100, 100])
    expect(resetMixes(mixes, tracks, 'pan').map((m) => m.pan)).toEqual([0, 0, 0])
    expect(resetMixes(mixes, tracks, 'mute').map((m) => m.muted)).toEqual([false, false, false])
    expect(resetMixes(mixes, tracks, 'solo').map((m) => m.solo)).toEqual([false, false, false])
    expect(resetMixes(mixes, tracks, 'volume')[0]).toMatchObject({ pan: -20, program: 52, muted: true })
  })

  it('sets every instrument to piano except drum kits', () => {
    expect(resetMixes(mixes, tracks, 'instrument').map((m) => m.program)).toEqual([0, 0, 25])
  })

  it('resets everything with "all"', () => {
    expect(resetMixes(mixes, tracks, 'all')).toEqual([
      { volume: 100, pan: 0, program: 0, muted: false, solo: false },
      { volume: 100, pan: 0, program: 0, muted: false, solo: false },
      { volume: 100, pan: 0, program: 25, muted: false, solo: false }
    ])
  })

  it('knows when there is nothing to reset', () => {
    const fresh = resetMixes(mixes, tracks, 'all')
    expect(canReset(fresh, tracks, 'all')).toBe(false)
    expect(canReset(mixes, tracks, 'pan')).toBe(true)
    expect(canReset(resetMixes(mixes, tracks, 'solo'), tracks, 'solo')).toBe(false)
  })
})
