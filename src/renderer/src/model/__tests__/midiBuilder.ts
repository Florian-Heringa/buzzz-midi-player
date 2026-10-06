import { writeMidi, type MidiEvent } from 'midi-file'

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** A MIDI event positioned at an absolute tick instead of a delta time. */
export type TimedEvent = { tick: number } & DistributiveOmit<MidiEvent, 'deltaTime'>

export function note(
  tick: number,
  noteNumber: number,
  duration: number,
  channel = 0,
  velocity = 100
): TimedEvent[] {
  return [
    { tick, type: 'noteOn', channel, noteNumber, velocity },
    { tick: tick + duration, type: 'noteOff', channel, noteNumber, velocity: 0 }
  ]
}

export function tempo(tick: number, bpm: number): TimedEvent {
  return { tick, type: 'setTempo', microsecondsPerBeat: Math.round(60_000_000 / bpm), meta: true }
}

export function trackName(text: string): TimedEvent {
  return { tick: 0, type: 'trackName', text, meta: true }
}

export function program(tick: number, channel: number, programNumber: number): TimedEvent {
  return { tick, type: 'programChange', channel, programNumber }
}

/** Builds a Standard MIDI File from tracks of absolutely-timed events. */
export function buildMidi(
  tracks: TimedEvent[][],
  options: { format?: 0 | 1; ppq?: number } = {}
): Uint8Array {
  const ppq = options.ppq ?? 480
  const midiTracks = tracks.map((events) => {
    // Stable sort keeps note-offs before note-ons on the same tick when listed first.
    const sorted = [...events].sort((a, b) => a.tick - b.tick)
    let last = 0
    const out = sorted.map(({ tick, ...rest }) => {
      const deltaTime = tick - last
      last = tick
      return { ...rest, deltaTime } as MidiEvent
    })
    out.push({ deltaTime: 0, type: 'endOfTrack', meta: true })
    return out
  })
  const bytes = writeMidi({
    header: { format: options.format ?? 1, numTracks: tracks.length, ticksPerBeat: ppq },
    tracks: midiTracks
  })
  return new Uint8Array(bytes)
}
