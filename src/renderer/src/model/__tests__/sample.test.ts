/// <reference types="node" />
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { assignChannels } from '../channels'
import { parseSong } from '../song'

// samples/satb-chorale.mid is produced by scripts/make-samples.mjs.
describe('samples/satb-chorale.mid', () => {
  const song = parseSong(readFileSync(resolve('samples/satb-chorale.mid')), 'satb-chorale.mid')

  it('has the four voices and piano as separate tracks', () => {
    expect(song.tracks.map((t) => [t.name, t.program, t.notes.length])).toEqual([
      ['Soprano', 52, 23],
      ['Alto', 52, 17],
      ['Tenor', 52, 19],
      ['Bass', 52, 18],
      ['Piano', 0, 48]
    ])
  })

  it('is eight bars of 4/4 in G major with a ritardando', () => {
    expect(song.durationTicks).toBe(8 * 4 * 480)
    expect(song.keySignatures[0]).toEqual({ tick: 0, fifths: 1, mode: 'major' })
    expect(song.tempoMap.tempos.map((t) => Math.round(60_000_000 / t.microsecondsPerBeat))).toEqual([
      80, 70, 60
    ])
    // 6 bars at 80 + 1 bar at 70 + 1 bar at 60 BPM.
    expect(song.tempoMap.tickToSeconds(song.durationTicks)).toBeCloseTo(18 + 24 / 7 + 4, 2)
  })

  it('gets one synth channel per track', () => {
    const { channels, sharedTrackIds } = assignChannels(song.tracks)
    expect(new Set(channels.values()).size).toBe(5)
    expect(sharedTrackIds.size).toBe(0)
  })
})
