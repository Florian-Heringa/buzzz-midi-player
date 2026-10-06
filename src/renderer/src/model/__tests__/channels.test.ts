import { describe, expect, it } from 'vitest'
import { assignChannels } from '../channels'
import type { Track } from '../song'

const track = (id: number, sourceChannel: number, isDrum = false): Track => ({
  id,
  name: `T${id}`,
  sourceChannel,
  program: 0,
  isDrum,
  notes: []
})

describe('assignChannels', () => {
  it('keeps distinct source channels', () => {
    const { channels, sharedTrackIds } = assignChannels([track(0, 0), track(1, 1), track(2, 5)])
    expect([0, 1, 2].map((id) => channels.get(id))).toEqual([0, 1, 5])
    expect(sharedTrackIds.size).toBe(0)
  })

  it('separates tracks that share a source channel, skipping the drum channel', () => {
    const tracks = Array.from({ length: 11 }, (_, i) => track(i, 0))
    const assigned = [...assignChannels(tracks).channels.values()]
    expect(new Set(assigned).size).toBe(11)
    expect(assigned).not.toContain(9)
  })

  it('puts drum tracks on channel 10', () => {
    const { channels } = assignChannels([track(0, 9, true), track(1, 9, true), track(2, 0)])
    expect(channels.get(0)).toBe(9)
    expect(channels.get(1)).toBe(9)
    expect(channels.get(2)).toBe(0)
  })

  it('shares channels and flags tracks beyond 15 melodic tracks', () => {
    const tracks = Array.from({ length: 17 }, (_, i) => track(i, 0))
    const { channels, sharedTrackIds } = assignChannels(tracks)
    expect(channels.size).toBe(17)
    // Tracks 15 and 16 reuse channels 0 and 1, so tracks 0, 1, 15 and 16 are flagged.
    expect([...sharedTrackIds].sort((a, b) => a - b)).toEqual([0, 1, 15, 16])
  })
})
