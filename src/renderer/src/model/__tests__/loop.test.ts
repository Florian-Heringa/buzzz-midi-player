import { describe, expect, it } from 'vitest'
import { parseSong } from '../song'
import { lastLoopBarStart, loopJump, loopTicks, stopPosition, updateLoop, type LoopRange } from '../loop'
import { buildMidi, note } from './midiBuilder'

const loop: LoopRange = { enabled: false, startBar: 3, endBar: 6 }

describe('updateLoop', () => {
  it('applies changes within range', () => {
    expect(updateLoop(loop, { startBar: 2 }, 8)).toEqual({ enabled: false, startBar: 2, endBar: 6 })
    expect(updateLoop(loop, { enabled: true }, 8)).toEqual({ ...loop, enabled: true })
  })

  it('clamps bars to the song', () => {
    expect(updateLoop(loop, { startBar: 0, endBar: 99 }, 8)).toMatchObject({ startBar: 1, endBar: 8 })
    expect(updateLoop(loop, { startBar: Number.NaN }, 8).startBar).toBe(1)
  })

  it('drags the other end along when the range would invert', () => {
    expect(updateLoop(loop, { startBar: 7 }, 8)).toMatchObject({ startBar: 7, endBar: 7 })
    expect(updateLoop(loop, { endBar: 2 }, 8)).toMatchObject({ startBar: 2, endBar: 2 })
  })
})

describe('stopPosition', () => {
  // Four bars of 4/4 at 480 ppq.
  const song = parseSong(buildMidi([note(0, 60, 4 * 1920)]), 'x.mid')

  it('returns to the song start when looping is off', () => {
    expect(stopPosition(song, { enabled: false, startBar: 3, endBar: 4 })).toBe(0)
  })

  it('returns to the first beat of the loop start bar when looping is on', () => {
    expect(stopPosition(song, { enabled: true, startBar: 3, endBar: 4 })).toBe(2 * 1920)
  })
})

describe('loop ticks and jumps', () => {
  // Four bars of 4/4 at 480 ppq.
  const song = parseSong(buildMidi([note(0, 60, 4 * 1920)]), 'x.mid')
  const on: LoopRange = { enabled: true, startBar: 2, endBar: 3 }

  it('spans from the start bar to the end of the end bar', () => {
    expect(loopTicks(song, on)).toEqual({ start: 1920, end: 3 * 1920 })
    expect(loopTicks(song, { ...on, endBar: 4 }).end).toBe(song.durationTicks)
    expect(lastLoopBarStart(song, on)).toBe(2 * 1920)
  })

  it('jumps back to the loop start when playback crosses the loop end', () => {
    expect(loopJump(song, on, 3 * 1920 - 10, 3 * 1920 + 5)).toBe(1920)
    expect(loopJump(song, on, 2000, 2100)).toBeNull()
  })

  it('leaves playback alone when looping is off or it started past the loop end', () => {
    expect(loopJump(song, { ...on, enabled: false }, 3 * 1920 - 10, 3 * 1920 + 5)).toBeNull()
    expect(loopJump(song, on, 3 * 1920 + 5, 3 * 1920 + 50)).toBeNull()
  })
})
