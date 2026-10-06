import { describe, expect, it } from 'vitest'
import { TempoMap } from '../tempoMap'

describe('TempoMap', () => {
  it('defaults to 120 BPM when there are no tempo events', () => {
    const map = new TempoMap(480, [])
    expect(map.bpmAt(0)).toBe(120)
    expect(map.tickToSeconds(480)).toBeCloseTo(0.5)
  })

  it('converts across tempo changes in both directions', () => {
    // 120 BPM for 4 beats (2 s), then 60 BPM.
    const map = new TempoMap(480, [
      { tick: 0, microsecondsPerBeat: 500_000 },
      { tick: 1920, microsecondsPerBeat: 1_000_000 }
    ])
    expect(map.tickToSeconds(1920)).toBeCloseTo(2)
    expect(map.tickToSeconds(2400)).toBeCloseTo(3)
    expect(map.secondsToTick(3)).toBeCloseTo(2400)
    expect(map.secondsToTick(1)).toBeCloseTo(960)
    expect(map.bpmAt(1919)).toBe(120)
    expect(map.bpmAt(1920)).toBe(60)
  })

  it('inserts the default tempo before a late first tempo event', () => {
    const map = new TempoMap(480, [{ tick: 960, microsecondsPerBeat: 1_000_000 }])
    expect(map.tickToSeconds(960)).toBeCloseTo(1)
    expect(map.tickToSeconds(1440)).toBeCloseTo(2)
  })

  it('uses the last of several tempo events on the same tick', () => {
    const map = new TempoMap(480, [
      { tick: 0, microsecondsPerBeat: 500_000 },
      { tick: 0, microsecondsPerBeat: 1_000_000 }
    ])
    expect(map.bpmAt(0)).toBe(60)
  })
})
