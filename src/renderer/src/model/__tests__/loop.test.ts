import { describe, expect, it } from 'vitest'
import { updateLoop, type LoopRange } from '../loop'

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
