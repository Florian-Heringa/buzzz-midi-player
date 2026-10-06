import { describe, expect, it } from 'vitest'
import { isSounding } from '../sounding'
import type { Track } from '../song'

const track = (notes: [number, number][]): Track => ({
  id: 0,
  name: 'T',
  sourceChannel: 0,
  program: 0,
  isDrum: false,
  notes: notes.map(([tick, durationTicks]) => ({ midi: 60, tick, durationTicks, velocity: 100 }))
})

describe('isSounding', () => {
  it('is true only between a note start and end', () => {
    const t = track([
      [100, 50],
      [300, 100]
    ])
    expect([0, 100, 149, 150, 250, 300, 399, 400].map((tick) => isSounding(t, tick))).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false
    ])
  })

  it('finds a long note that started before shorter ones', () => {
    const t = track([
      [0, 1000],
      [100, 10],
      [200, 10]
    ])
    expect(isSounding(t, 500)).toBe(true)
    expect(isSounding(t, 1000)).toBe(false)
  })

  it('handles empty tracks', () => {
    expect(isSounding(track([]), 0)).toBe(false)
  })
})
