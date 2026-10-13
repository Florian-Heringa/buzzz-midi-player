import type { ChannelAssignment } from '../model/channels'
import type { Song } from '../model/song'
import type { ExportMode } from '../presets/preset'
import { channelStates, type TrackMix } from './mixer'
import { buildPlaybackMidi } from './playbackMidi'

/** A stretch of the song in ticks: from `start` up to (not including) `end`. */
export interface TickRange {
  start: number
  end: number
}

/**
 * The MIDI file to render for an export, with the export mix written at tick 0. With a range,
 * only notes starting inside it are kept, cut off at its end (rendering starts at its start).
 */
export function buildExportMidi(
  song: Song,
  assignment: ChannelAssignment,
  mixes: readonly TrackMix[],
  practiceTrackId: number | null,
  mode: ExportMode,
  range?: TickRange
): Uint8Array {
  const exportMix = exportMixes(mixes, practiceTrackId, mode)
  const states = channelStates(song, assignment, exportMix)
  return buildPlaybackMidi(range ? songWithin(song, range) : song, assignment, states)
}

/** The song with only the notes that start within `range`, ending by its end. */
export function songWithin(song: Song, range: TickRange): Song {
  return {
    ...song,
    durationTicks: Math.min(song.durationTicks, range.end),
    tracks: song.tracks.map((track) => ({
      ...track,
      notes: track.notes
        .filter((n) => n.tick >= range.start && n.tick < range.end)
        .map((n) => ({ ...n, durationTicks: Math.min(n.durationTicks, range.end - n.tick) }))
    }))
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
