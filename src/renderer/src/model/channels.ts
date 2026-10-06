import { DRUM_CHANNEL } from './gm'
import type { Track } from './song'

export interface ChannelAssignment {
  /** Synth channel per track id. */
  channels: Map<number, number>
  /** Track ids that share a synth channel with another melodic track (mixer is not independent). */
  sharedTrackIds: Set<number>
}

const MELODIC_CHANNELS = Array.from({ length: 16 }, (_, i) => i).filter((c) => c !== DRUM_CHANNEL)

/**
 * Gives every track its own synth channel so volume, pan and program can be set per track.
 * Drum tracks share the GM drum channel. Tracks keep their source channel when possible;
 * beyond 15 melodic tracks, channels are reused round-robin and those tracks are flagged.
 */
export function assignChannels(tracks: readonly Track[]): ChannelAssignment {
  const channels = new Map<number, number>()
  const sharedTrackIds = new Set<number>()
  const used = new Set<number>()
  const melodic = tracks.filter((t) => !t.isDrum)

  for (const track of tracks) {
    if (track.isDrum) channels.set(track.id, DRUM_CHANNEL)
  }

  // First pass: keep the source channel when it is free.
  for (const track of melodic) {
    if (track.sourceChannel !== DRUM_CHANNEL && !used.has(track.sourceChannel)) {
      channels.set(track.id, track.sourceChannel)
      used.add(track.sourceChannel)
    }
  }

  // Second pass: remaining tracks take the next free channel, then share.
  const free = MELODIC_CHANNELS.filter((c) => !used.has(c))
  let shareIndex = 0
  for (const track of melodic) {
    if (channels.has(track.id)) continue
    const channel = free.shift()
    if (channel !== undefined) {
      channels.set(track.id, channel)
      continue
    }
    const sharedChannel = MELODIC_CHANNELS[shareIndex++ % MELODIC_CHANNELS.length]
    channels.set(track.id, sharedChannel)
    for (const other of melodic) {
      if (channels.get(other.id) === sharedChannel) sharedTrackIds.add(other.id)
    }
  }

  return { channels, sharedTrackIds }
}
