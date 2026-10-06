import { parseMidi, type MidiControllerEvent, type MidiProgramChangeEvent } from 'midi-file'
import { describe, expect, it } from 'vitest'
import { assignChannels } from '../../model/channels'
import { parseSong } from '../../model/song'
import { buildMidi, note, program, tempo, trackName } from '../../model/__tests__/midiBuilder'
import { channelStates, defaultMix, effectiveVolume } from '../mixer'
import { buildPlaybackMidi } from '../playbackMidi'

// Two tracks that both use channel 0 in the source file (so both get program 52), plus a
// tempo change.
const source = parseSong(
  buildMidi([
    [tempo(0, 100), tempo(960, 50)],
    [trackName('Melody'), program(0, 0, 52), ...note(0, 72, 480), ...note(480, 72, 480)],
    [trackName('Accomp'), ...note(0, 48, 960)]
  ]),
  'src.mid'
)

describe('mixer', () => {
  it('silences muted tracks and non-solo tracks while anything is soloed', () => {
    const mix = defaultMix(source.tracks[0])
    expect(effectiveVolume(mix, false)).toBe(100)
    expect(effectiveVolume({ ...mix, muted: true }, false)).toBe(0)
    expect(effectiveVolume(mix, true)).toBe(0)
    expect(effectiveVolume({ ...mix, solo: true }, true)).toBe(100)
  })

  it('resolves per-channel state with MIDI pan values', () => {
    const assignment = assignChannels(source.tracks)
    const mixes = source.tracks.map(defaultMix)
    mixes[1] = { ...mixes[1], pan: -64, volume: 80 }
    const states = channelStates(source, assignment, mixes)
    expect(states[assignment.channels.get(0)!]).toEqual({ volume: 100, pan: 64, program: 52 })
    expect(states[assignment.channels.get(1)!]).toEqual({ volume: 80, pan: 0, program: 52 })
  })
})

describe('buildPlaybackMidi', () => {
  const assignment = assignChannels(source.tracks)
  const mixes = source.tracks.map(defaultMix)
  mixes[0] = { ...mixes[0], solo: true }
  const bytes = buildPlaybackMidi(source, assignment, channelStates(source, assignment, mixes))

  it('round-trips notes and tempo, with each track on its assigned channel', () => {
    const played = parseSong(bytes, 'playback.mid')
    expect(played.tracks.map((t) => [t.name, t.sourceChannel, t.notes])).toEqual(
      source.tracks.map((t) => [t.name, assignment.channels.get(t.id), t.notes])
    )
    expect(played.tempoMap.tempos).toEqual(source.tempoMap.tempos)
    expect(played.durationTicks).toBe(source.durationTicks)
  })

  it('writes the mix as volume, pan and program at tick 0', () => {
    const raw = parseMidi(bytes)
    const setup = (trackIndex: number): Array<[string, number, number]> =>
      raw.tracks[trackIndex]
        .filter((e): e is MidiControllerEvent | MidiProgramChangeEvent =>
          e.type === 'controller' || e.type === 'programChange'
        )
        .map((e) =>
          e.type === 'controller'
            ? ['cc', e.controllerType, e.value]
            : ['program', e.programNumber, e.deltaTime]
        )
    expect(setup(1)).toEqual([
      ['cc', 7, 100],
      ['cc', 10, 64],
      ['program', 52, 0]
    ])
    // Accompaniment is silenced by the melody's solo.
    expect(setup(2)[0]).toEqual(['cc', 7, 0])
  })
})
