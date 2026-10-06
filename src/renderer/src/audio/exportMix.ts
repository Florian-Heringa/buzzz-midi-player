import type { ChannelAssignment } from '../model/channels'
import type { Song } from '../model/song'
import type { ExportMode } from '../presets/preset'
import { channelStates, type TrackMix } from './mixer'
import { buildPlaybackMidi } from './playbackMidi'

/** The MIDI file to render for an export, with the export mix written at tick 0. */
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
