import { writeMidi, type MidiEvent } from 'midi-file'
import type { ChannelAssignment } from '../model/channels'
import type { Song } from '../model/song'
import type { ChannelState } from './mixer'

const CC_VOLUME = 7
const CC_PAN = 10

type TimedEvent = { tick: number; order: number; event: MidiEvent }

/**
 * Builds the Standard MIDI File that FluidSynth's player plays: a conductor track with the
 * tempo map, then one track per song track on its assigned synth channel. Volume, pan and
 * program are written at tick 0. During live playback a worklet hook replaces these with
 * the current mixer values (the player resets the synth when it starts). For export the
 * written values are used as-is.
 */
export function buildPlaybackMidi(
  song: Song,
  assignment: ChannelAssignment,
  states: readonly (ChannelState | undefined)[]
): Uint8Array {
  const conductor: TimedEvent[] = [
    ...song.tempoMap.tempos.map((t) => ({
      tick: t.tick,
      order: 0,
      event: { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: t.microsecondsPerBeat, meta: true } as MidiEvent
    })),
    ...song.timeSignatures.map((ts) => ({
      tick: ts.tick,
      order: 0,
      event: {
        deltaTime: 0,
        type: 'timeSignature',
        numerator: ts.numerator,
        denominator: ts.denominator,
        metronome: 24,
        thirtyseconds: 8,
        meta: true
      } as MidiEvent
    }))
  ]

  const tracks = song.tracks.map((track) => {
    const channel = assignment.channels.get(track.id) ?? 0
    const state = states[channel] ?? { volume: 100, pan: 64, program: track.program }
    const events: TimedEvent[] = [
      { tick: 0, order: 0, event: { deltaTime: 0, type: 'trackName', text: track.name, meta: true } },
      {
        tick: 0,
        order: 1,
        event: { deltaTime: 0, type: 'controller', channel, controllerType: CC_VOLUME, value: state.volume }
      },
      {
        tick: 0,
        order: 1,
        event: { deltaTime: 0, type: 'controller', channel, controllerType: CC_PAN, value: state.pan }
      },
      {
        tick: 0,
        order: 1,
        event: { deltaTime: 0, type: 'programChange', channel, programNumber: state.program }
      }
    ]
    for (const note of track.notes) {
      events.push({
        tick: note.tick,
        order: 3,
        event: { deltaTime: 0, type: 'noteOn', channel, noteNumber: note.midi, velocity: note.velocity }
      })
      // Note-offs sort before note-ons on the same tick so repeated pitches re-trigger.
      events.push({
        tick: note.tick + note.durationTicks,
        order: 2,
        event: { deltaTime: 0, type: 'noteOff', channel, noteNumber: note.midi, velocity: 0 }
      })
    }
    return events
  })

  const bytes = writeMidi({
    header: { format: 1, numTracks: tracks.length + 1, ticksPerBeat: song.ppq },
    tracks: [conductor, ...tracks].map(toDeltaTimes)
  })
  return new Uint8Array(bytes)
}

function toDeltaTimes(events: TimedEvent[]): MidiEvent[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order)
  let last = 0
  const out = sorted.map(({ tick, event }) => {
    const withDelta = { ...event, deltaTime: tick - last }
    last = tick
    return withDelta
  })
  out.push({ deltaTime: 0, type: 'endOfTrack', meta: true })
  return out
}
