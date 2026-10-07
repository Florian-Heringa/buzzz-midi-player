import { describe, expect, it } from 'vitest'
import { noteRange, parseSong } from '../song'
import { buildMidi, note, program, tempo, trackName, type TimedEvent } from './midiBuilder'

describe('parseSong', () => {
  it('reads a Type 1 SATB file with a conductor track', () => {
    const voice = (name: string, channel: number, pitch: number): TimedEvent[] => [
      trackName(name),
      program(0, channel, 52),
      ...note(0, pitch, 480, channel),
      ...note(480, pitch + 2, 480, channel)
    ]
    const data = buildMidi([
      [
        trackName('Conductor'),
        tempo(0, 90),
        {
          tick: 0,
          type: 'timeSignature',
          numerator: 3,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
          meta: true
        },
        { tick: 0, type: 'keySignature', key: -1, scale: 0, meta: true }
      ],
      voice('Soprano', 0, 72),
      voice('Alto', 1, 67),
      voice('Tenor', 2, 60),
      voice('Bass', 3, 48)
    ])

    const song = parseSong(data, 'satb.mid')
    expect(song.tracks.map((t) => t.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    expect(song.tracks.every((t) => t.program === 52 && t.notes.length === 2)).toBe(true)
    expect(song.tracks.map((t) => t.id)).toEqual([0, 1, 2, 3])
    expect(song.tempoMap.bpmAt(0)).toBeCloseTo(90)
    expect(song.timeSignatures).toEqual([{ tick: 0, numerator: 3, denominator: 4 }])
    expect(song.keySignatures).toEqual([{ tick: 0, fifths: -1, mode: 'major' }])
    expect(song.durationTicks).toBe(960)
    expect(noteRange(song.tracks[0])).toEqual({ low: 72, high: 74 })
  })

  it('splits a Type 0 file into one track per channel', () => {
    const data = buildMidi(
      [[trackName('Song'), ...note(0, 72, 480, 0), ...note(0, 48, 960, 1), ...note(0, 36, 240, 9)]],
      { format: 0 }
    )
    const song = parseSong(data, 'type0.mid')
    expect(song.tracks.map((t) => [t.name, t.sourceChannel, t.isDrum])).toEqual([
      ['Song (ch 1)', 0, false],
      ['Song (ch 2)', 1, false],
      ['Song (ch 10)', 9, true]
    ])
  })

  it('combines a multi-channel track into one track by default, keeping drums apart', () => {
    // Type 1: one track mostly on channel 3 (strings), with stray notes on channel 1 and drums.
    const data = buildMidi([
      [tempo(0, 120)],
      [
        trackName('Keys'),
        program(0, 2, 48),
        ...note(0, 60, 480, 2),
        ...note(480, 62, 480, 2),
        ...note(960, 64, 480, 0),
        ...note(0, 36, 240, 9)
      ]
    ])
    const combined = parseSong(data, 'x.mid')
    expect(combined.tracks.map((t) => [t.name, t.sourceChannel, t.program, t.isDrum, t.notes.length])).toEqual([
      ['Keys', 2, 48, false, 3],
      ['Keys (drums)', 9, 0, true, 1]
    ])
    const split = parseSong(data, 'x.mid', { channelTracks: 'split' })
    expect(split.tracks.map((t) => t.name)).toEqual(['Keys (ch 1)', 'Keys (ch 3)', 'Keys (ch 10)'])
  })

  it('always splits a Type 0 file by channel', () => {
    const data = buildMidi([[...note(0, 72, 480, 0), ...note(0, 48, 480, 1)]], { format: 0 })
    expect(parseSong(data, 'x.mid', { channelTracks: 'combine' }).tracks).toHaveLength(2)
  })

  it('treats note-on with velocity 0 as note-off and pairs repeated pitches in order', () => {
    const data = buildMidi([
      [
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 80 },
        { tick: 100, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 90 },
        { tick: 200, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 0 },
        { tick: 300, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 }
      ]
    ])
    const [track] = parseSong(data, 'x.mid').tracks
    expect(track.notes).toEqual([
      { midi: 60, tick: 0, durationTicks: 200, velocity: 80 },
      { midi: 60, tick: 100, durationTicks: 200, velocity: 90 }
    ])
  })

  it('closes notes left hanging at the end of the track', () => {
    const data = buildMidi([
      [
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 64, velocity: 80 },
        { tick: 960, type: 'trackName', text: 'late', meta: true }
      ]
    ])
    const [track] = parseSong(data, 'x.mid').tracks
    expect(track.notes[0].durationTicks).toBe(960)
  })

  it('names unnamed tracks after their instrument and skips tracks without notes', () => {
    const data = buildMidi([[tempo(0, 120)], [program(0, 0, 40), ...note(0, 76, 480, 0)]])
    const song = parseSong(data, 'x.mid')
    expect(song.tracks).toHaveLength(1)
    expect(song.tracks[0].name).toBe('Violin 2')
  })

  it('applies a program change from another track on the same channel', () => {
    const data = buildMidi([[program(0, 3, 19)], [trackName('Organ'), ...note(0, 60, 480, 3)]])
    expect(parseSong(data, 'x.mid').tracks[0].program).toBe(19)
  })

  it('defaults to 4/4 and 120 BPM, estimating the key when the file has none', () => {
    const song = parseSong(buildMidi([note(0, 60, 480)]), 'x.mid')
    expect(song.timeSignatures).toEqual([{ tick: 0, numerator: 4, denominator: 4 }])
    expect(song.keySignatures).toEqual([{ tick: 0, fifths: 0, mode: 'major', estimated: true }])
    expect(song.tempoMap.bpmAt(0)).toBe(120)
  })

  it('keeps the key signature from the file', () => {
    const song = parseSong(
      buildMidi([[{ tick: 0, type: 'keySignature', key: 0, scale: 0, meta: true }, ...note(0, 61, 480)]]),
      'x.mid'
    )
    expect(song.keySignatures).toEqual([{ tick: 0, fifths: 0, mode: 'major' }])
  })
})
