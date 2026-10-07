import type { ChannelAssignment } from '../model/channels'
import type { Song, Track } from '../model/song'

export const DEFAULT_VOLUME = 100

/** User-controlled mix settings for one track. */
export interface TrackMix {
  /** MIDI volume (CC7), 0–127. */
  volume: number
  /** Pan, -64 (left) to 63 (right). */
  pan: number
  /** GM program, 0–127. */
  program: number
  muted: boolean
  solo: boolean
}

/** Values sent to one synth channel: CC7, CC10 (0–127) and program. */
export interface ChannelState {
  volume: number
  pan: number
  program: number
}

export function defaultMix(track: Track): TrackMix {
  return { volume: DEFAULT_VOLUME, pan: 0, program: track.program, muted: false, solo: false }
}

/** Volume a track actually plays at, taking mute and solo into account. */
export function effectiveVolume(mix: TrackMix, anySolo: boolean): number {
  return mix.muted || (anySolo && !mix.solo) ? 0 : mix.volume
}

/**
 * Resolves track mixes to per-channel synth state (index = channel; undefined for unused
 * channels). When tracks share a channel, the loudest wins and the first sets pan and program.
 */
export function channelStates(
  song: Song,
  assignment: ChannelAssignment,
  mixes: readonly TrackMix[]
): (ChannelState | undefined)[] {
  const anySolo = mixes.some((m) => m.solo)
  const states: (ChannelState | undefined)[] = new Array(16).fill(undefined)
  for (const track of song.tracks) {
    const channel = assignment.channels.get(track.id)
    const mix = mixes[track.id]
    if (channel === undefined || !mix) continue
    const volume = effectiveVolume(mix, anySolo)
    const existing = states[channel]
    if (existing) {
      existing.volume = Math.max(existing.volume, volume)
    } else {
      states[channel] = { volume, pan: clampPan(mix.pan) + 64, program: mix.program }
    }
  }
  return states
}

function clampPan(pan: number): number {
  return Math.max(-64, Math.min(63, Math.round(pan)))
}

/** Acoustic Grand Piano: the instrument "All to piano" sets. */
export const PIANO_PROGRAM = 0

/** Mixer settings that can be reset for all tracks at once. */
export type MixReset = 'volume' | 'pan' | 'mute' | 'solo' | 'instrument' | 'all'

/** One track's mix with a setting reset. Drum tracks keep their kit when instruments reset. */
function resetMix(mix: TrackMix, track: Track, reset: MixReset): TrackMix {
  const all = reset === 'all'
  return {
    volume: all || reset === 'volume' ? DEFAULT_VOLUME : mix.volume,
    pan: all || reset === 'pan' ? 0 : mix.pan,
    muted: all || reset === 'mute' ? false : mix.muted,
    solo: all || reset === 'solo' ? false : mix.solo,
    program: (all || reset === 'instrument') && !track.isDrum ? PIANO_PROGRAM : mix.program
  }
}

/** Every track's mix with a setting reset. */
export function resetMixes(mixes: readonly TrackMix[], tracks: readonly Track[], reset: MixReset): TrackMix[] {
  return mixes.map((mix, id) => (tracks[id] ? resetMix(mix, tracks[id], reset) : mix))
}

/** Whether resetting would change anything (so the button can be disabled when not). */
export function canReset(mixes: readonly TrackMix[], tracks: readonly Track[], reset: MixReset): boolean {
  return resetMixes(mixes, tracks, reset).some((mix, id) => {
    const before = mixes[id]
    return (
      mix.volume !== before.volume ||
      mix.pan !== before.pan ||
      mix.muted !== before.muted ||
      mix.solo !== before.solo ||
      mix.program !== before.program
    )
  })
}
