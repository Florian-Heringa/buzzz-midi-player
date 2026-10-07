import { useSyncExternalStore } from 'react'
import type { ChannelTracks } from '../model/song'

/** How the practice track's notes are shown. */
export type NoteDisplay = 'piano-roll' | 'sheet-music'

/** App-wide preferences, remembered per viewer (not per MIDI file). */
export interface Settings {
  noteDisplay: NoteDisplay
  /** Horizontal staff space per quarter note, in px. */
  zoom: number
  /** Scroll the staff to keep the playhead in view while playing. */
  followPlayhead: boolean
  /** Whether a MIDI track with notes on several channels shows as one track or one per channel. */
  channelTracks: ChannelTracks
}

export const CHANNEL_TRACK_OPTIONS: { value: ChannelTracks; label: string; hint: string }[] = [
  {
    value: 'combine',
    label: 'Combine into one track',
    hint: 'Notes on any channel of a MIDI track stay together. Drums stay separate.'
  },
  {
    value: 'split',
    label: 'Split into a track per channel',
    hint: 'Each channel of a MIDI track gets its own strip.'
  }
]

export const NOTE_DISPLAYS: { value: NoteDisplay; label: string; hint: string; available: boolean }[] = [
  {
    value: 'piano-roll',
    label: 'Piano roll',
    hint: 'Notes placed by pitch on the staff, with bars showing how long each note lasts.',
    available: true
  },
  {
    value: 'sheet-music',
    label: 'Sheet music',
    hint: 'Standard notation with note values, rests, ties and beams. Rhythms are rounded to sixteenth notes.',
    available: true
  }
]

export const MIN_ZOOM = 40
export const MAX_ZOOM = 200
export const DEFAULT_SETTINGS: Settings = {
  noteDisplay: 'piano-roll',
  zoom: 80,
  followPlayhead: true,
  channelTracks: 'combine'
}

const STORAGE_KEY = 'settings'

let settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof saved === 'object' && saved !== null) {
      const s = saved as Record<string, unknown>
      return {
        noteDisplay: NOTE_DISPLAYS.some((d) => d.value === s.noteDisplay && d.available)
          ? (s.noteDisplay as NoteDisplay)
          : DEFAULT_SETTINGS.noteDisplay,
        zoom:
          typeof s.zoom === 'number' && s.zoom >= MIN_ZOOM && s.zoom <= MAX_ZOOM
            ? s.zoom
            : DEFAULT_SETTINGS.zoom,
        followPlayhead: typeof s.followPlayhead === 'boolean' ? s.followPlayhead : DEFAULT_SETTINGS.followPlayhead,
        channelTracks: s.channelTracks === 'split' ? 'split' : DEFAULT_SETTINGS.channelTracks
      }
    }
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return DEFAULT_SETTINGS
}

export function getSettings(): Settings {
  return settings
}

export function updateSettings(change: Partial<Settings>): void {
  settings = { ...settings, ...change }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Not persisting settings is fine.
  }
  listeners.forEach((listener) => listener())
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => settings
  )
}
