import type { ChannelAssignment } from '../model/channels'
import type { Song } from '../model/song'
import { TempoMap } from '../model/tempoMap'
import type { ExportMode } from '../presets/preset'
import { channelStates, type TrackMix } from './mixer'
import { buildPlaybackMidi } from './playbackMidi'

/** A stretch of the song in ticks: from `start` up to (not including) `end`. */
export interface TickRange {
  start: number
  end: number
}

/**
 * The MIDI file to render for an export, with the export mix written at tick 0. For part of the
 * song, pass it through `songWithin` first.
 */
export function buildExportMidi(
  song: Song,
  assignment: ChannelAssignment,
  mixes: readonly TrackMix[],
  practiceTrackId: number | null,
  mode: ExportMode
): Uint8Array {
  const exportMix = exportMixes(mixes, practiceTrackId, mode)
  return buildPlaybackMidi(song, assignment, channelStates(song, assignment, exportMix))
}

/**
 * The song with only the notes that start within `range`, cut off at its end, and that part
 * played `repeats` times in a row. Tempo and time signature changes inside the range repeat
 * along; each repeat starts with the tempo and meter the range starts with.
 */
export function songWithin(song: Song, range: TickRange, repeats = 1): Song {
  const end = Math.min(range.end, song.durationTicks)
  const length = end - range.start
  const offsets = Array.from({ length: Math.max(1, Math.round(repeats)) }, (_, i) => i * length)
  const inRange = (tick: number): boolean => tick >= range.start && tick < end
  /** Events before the range as they are, then per repeat: the one in effect at its start and those inside. */
  const repeated = <T extends { tick: number }>(events: readonly T[]): T[] => {
    const atStart = events.filter((e) => e.tick <= range.start).at(-1)
    const inside = events.filter((e) => inRange(e.tick) && e.tick > range.start)
    return [
      ...events.filter((e) => e.tick < range.start),
      ...offsets.flatMap((offset) => [
        ...(atStart ? [{ ...atStart, tick: range.start + offset }] : []),
        ...inside.map((e) => ({ ...e, tick: e.tick + offset }))
      ])
    ]
  }

  return {
    ...song,
    durationTicks: range.start + offsets.length * length,
    tempoMap: new TempoMap(song.ppq, repeated(song.tempoMap.tempos)),
    timeSignatures: repeated(song.timeSignatures),
    tracks: song.tracks.map((track) => {
      const notes = track.notes
        .filter((n) => inRange(n.tick))
        .map((n) => ({ ...n, durationTicks: Math.min(n.durationTicks, end - n.tick) }))
      return { ...track, notes: offsets.flatMap((offset) => notes.map((n) => ({ ...n, tick: n.tick + offset }))) }
    })
  }
}

/** Mixes to render for an export mode, based on the current mixes and practice track. */
export function exportMixes(
  mixes: readonly TrackMix[],
  practiceTrackId: number | null,
  mode: ExportMode
): TrackMix[] {
  if (mode === 'mix' || practiceTrackId === null) return mixes.map((m) => ({ ...m }))
  return mixes.map((mix, id) => {
    const isPractice = id === practiceTrackId
    if (mode === 'practice-solo') {
      return { ...mix, muted: !isPractice, solo: false }
    }
    // practice-muted: everything as mixed, minus the practice part.
    return isPractice ? { ...mix, muted: true, solo: false } : { ...mix }
  })
}
