import { parseMidi, type MidiEvent } from 'midi-file'
import { DRUM_CHANNEL, gmProgramName } from './gm'
import { estimateKey } from './keyEstimate'
import { TempoMap, type TempoEvent } from './tempoMap'

export interface Note {
  midi: number
  tick: number
  durationTicks: number
  /** MIDI velocity, 1–127. */
  velocity: number
}

export interface Track {
  /** Stable index into `Song.tracks`. */
  id: number
  name: string
  /** Channel the notes were written on in the source file (0–15). */
  sourceChannel: number
  /** GM program (0–127) in effect at the first note. */
  program: number
  isDrum: boolean
  /** Notes sorted by start tick. */
  notes: Note[]
}

export interface TimeSignature {
  tick: number
  numerator: number
  denominator: number
}

export interface KeySignature {
  tick: number
  /** Number of sharps (positive) or flats (negative), -7..7. */
  fifths: number
  mode: 'major' | 'minor'
  /** True when the file has no key signature and this one was estimated from the notes. */
  estimated?: boolean
}

export interface Song {
  name: string
  format: 0 | 1 | 2
  ppq: number
  durationTicks: number
  tempoMap: TempoMap
  timeSignatures: TimeSignature[]
  keySignatures: KeySignature[]
  tracks: Track[]
}

interface PendingNote {
  tick: number
  velocity: number
}

interface ChannelPart {
  notes: Note[]
  program: number | null
}

/** Notes and metadata collected from one source track, grouped by channel. */
interface SourceTrack {
  name: string | null
  parts: Map<number, ChannelPart>
}

export function parseSong(data: ArrayLike<number>, name: string): Song {
  const midi = parseMidi(data)
  const ppq = midi.header.ticksPerBeat
  if (!ppq) {
    throw new Error('SMPTE-timed MIDI files are not supported.')
  }

  const tempos: TempoEvent[] = []
  const timeSignatures: TimeSignature[] = []
  const keySignatures: KeySignature[] = []
  // Program changes on a channel apply across source tracks (common in Type 1 files
  // where a conductor track sets up instruments), so track them globally per channel.
  const channelPrograms = new Map<number, number>()
  const sourceTracks: SourceTrack[] = []
  let durationTicks = 0

  for (const events of midi.tracks) {
    const source: SourceTrack = { name: null, parts: new Map() }
    const pending = new Map<number, PendingNote[]>()
    let tick = 0

    const partFor = (channel: number): ChannelPart => {
      let part = source.parts.get(channel)
      if (!part) {
        part = { notes: [], program: null }
        source.parts.set(channel, part)
      }
      return part
    }

    const closeNote = (channel: number, noteNumber: number, endTick: number): void => {
      const queue = pending.get(channel * 128 + noteNumber)
      const start = queue?.shift()
      if (!start) return
      partFor(channel).notes.push({
        midi: noteNumber,
        tick: start.tick,
        durationTicks: Math.max(0, endTick - start.tick),
        velocity: start.velocity
      })
    }

    for (const event of events as MidiEvent[]) {
      tick += event.deltaTime
      switch (event.type) {
        case 'noteOn': {
          if (event.velocity === 0) {
            closeNote(event.channel, event.noteNumber, tick)
            break
          }
          const part = partFor(event.channel)
          if (part.program === null) part.program = channelPrograms.get(event.channel) ?? 0
          const key = event.channel * 128 + event.noteNumber
          const queue = pending.get(key) ?? []
          queue.push({ tick, velocity: event.velocity })
          pending.set(key, queue)
          break
        }
        case 'noteOff':
          closeNote(event.channel, event.noteNumber, tick)
          break
        case 'programChange':
          channelPrograms.set(event.channel, event.programNumber)
          break
        case 'trackName':
          if (source.name === null && event.text.trim()) source.name = event.text.trim()
          break
        case 'setTempo':
          tempos.push({ tick, microsecondsPerBeat: event.microsecondsPerBeat })
          break
        case 'timeSignature':
          timeSignatures.push({ tick, numerator: event.numerator, denominator: event.denominator })
          break
        case 'keySignature':
          keySignatures.push({
            tick,
            fifths: event.key,
            mode: event.scale === 1 ? 'minor' : 'major'
          })
          break
      }
    }

    // Close notes that never received a note-off at the end of the track.
    for (const [key, queue] of pending) {
      while (queue.length > 0) closeNote(Math.floor(key / 128), key % 128, tick)
    }
    durationTicks = Math.max(durationTicks, tick)
    sourceTracks.push(source)
  }

  const tracks = buildTracks(sourceTracks)
  for (const track of tracks) {
    for (const note of track.notes) {
      durationTicks = Math.max(durationTicks, note.tick + note.durationTicks)
    }
  }

  return {
    name,
    format: midi.header.format,
    ppq,
    durationTicks,
    tempoMap: new TempoMap(ppq, tempos),
    timeSignatures: normalizeByTick(timeSignatures, { tick: 0, numerator: 4, denominator: 4 }),
    keySignatures: resolveKeySignatures(keySignatures, tracks),
    tracks
  }
}

/**
 * The file's key signatures; when it has none (common in exported MIDI), the key is
 * estimated from the notes instead of assuming C major.
 */
function resolveKeySignatures(fromFile: KeySignature[], tracks: Track[]): KeySignature[] {
  if (fromFile.length > 0) return normalizeByTick(fromFile, { tick: 0, fifths: 0, mode: 'major' })
  const estimate = estimateKey(tracks)
  return [estimate ? { tick: 0, ...estimate, estimated: true } : { tick: 0, fifths: 0, mode: 'major' }]
}

/** One Track per (source track, channel) that has notes; multi-channel tracks are split. */
function buildTracks(sourceTracks: SourceTrack[]): Track[] {
  const tracks: Track[] = []
  sourceTracks.forEach((source, sourceIndex) => {
    const channels = [...source.parts.entries()]
      .filter(([, part]) => part.notes.length > 0)
      .sort(([a], [b]) => a - b)
    const split = channels.length > 1

    for (const [channel, part] of channels) {
      const isDrum = channel === DRUM_CHANNEL
      const program = part.program ?? 0
      const baseName =
        source.name ?? (isDrum ? 'Drums' : `${gmProgramName(program)} ${sourceIndex + 1}`)
      tracks.push({
        id: tracks.length,
        name: split ? `${baseName} (ch ${channel + 1})` : baseName,
        sourceChannel: channel,
        program,
        isDrum,
        notes: part.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi)
      })
    }
  })
  return tracks
}

/** Sorts events by tick, keeps the last event per tick, and ensures one exists at tick 0. */
function normalizeByTick<T extends { tick: number }>(events: T[], fallback: T): T[] {
  const byTick = new Map<number, T>()
  for (const event of [...events].sort((a, b) => a.tick - b.tick)) byTick.set(event.tick, event)
  if (!byTick.has(0)) byTick.set(0, fallback)
  return [...byTick.values()].sort((a, b) => a.tick - b.tick)
}

/** Lowest and highest MIDI note in a track, or null when empty. */
export function noteRange(track: Track): { low: number; high: number } | null {
  if (track.notes.length === 0) return null
  let low = 127
  let high = 0
  for (const note of track.notes) {
    low = Math.min(low, note.midi)
    high = Math.max(high, note.midi)
  }
  return { low, high }
}
