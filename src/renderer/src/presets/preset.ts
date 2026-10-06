import { DEFAULT_VOLUME, type TrackMix } from '../audio/mixer'
import type { Song } from '../model/song'

export type ExportMode = 'mix' | 'practice-solo' | 'practice-muted'

export interface ExportSettings {
  /** MP3 bitrate in kbps. */
  bitrate: number
  /** What the export contains: the current mix, only the practice part, or everything but it. */
  mode: ExportMode
}

export const EXPORT_BITRATES = [96, 128, 160, 192, 256, 320] as const
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { bitrate: 192, mode: 'mix' }

export const PRESET_VERSION = 1

export interface PresetTrack extends TrackMix {
  index: number
  name: string
}

/** Saved player settings for a MIDI file. */
export interface Preset {
  version: typeof PRESET_VERSION
  midiFileName?: string
  midiFileHash?: string
  tempoFactor: number
  selectedTrack: { index: number; name: string } | null
  tracks: PresetTrack[]
  export: ExportSettings
}

export interface PlayerSettings {
  mixes: TrackMix[]
  tempoFactor: number
  selectedTrackId: number | null
  exportSettings: ExportSettings
}

export function createPreset(
  song: Song,
  settings: PlayerSettings,
  file?: { name: string; hash: string }
): Preset {
  const selected = settings.selectedTrackId === null ? null : song.tracks[settings.selectedTrackId]
  return {
    version: PRESET_VERSION,
    midiFileName: file?.name,
    midiFileHash: file?.hash,
    tempoFactor: settings.tempoFactor,
    selectedTrack: selected ? { index: selected.id, name: selected.name } : null,
    tracks: song.tracks.map((track) => ({
      index: track.id,
      name: track.name,
      ...settings.mixes[track.id]
    })),
    export: { ...settings.exportSettings }
  }
}

/**
 * Maps preset tracks onto song tracks: first by name (in order of appearance, so repeated
 * names pair up), then by position for tracks whose names changed.
 * Returns the matched preset track per song track id.
 */
export function matchTracks(song: Song, presetTracks: readonly PresetTrack[]): (PresetTrack | undefined)[] {
  const matched: (PresetTrack | undefined)[] = new Array(song.tracks.length).fill(undefined)
  const used = new Set<PresetTrack>()

  for (const track of song.tracks) {
    const candidate = presetTracks.find((p) => p.name === track.name && !used.has(p))
    if (candidate) {
      matched[track.id] = candidate
      used.add(candidate)
    }
  }
  for (const track of song.tracks) {
    if (matched[track.id]) continue
    const candidate = presetTracks.find((p) => p.index === track.id && !used.has(p))
    if (candidate) {
      matched[track.id] = candidate
      used.add(candidate)
    }
  }
  return matched
}

/** Settings for a song from a preset; tracks the preset does not cover keep their defaults. */
export function applyPreset(song: Song, preset: Preset, defaults: TrackMix[]): PlayerSettings {
  const matched = matchTracks(song, preset.tracks)
  const mixes = song.tracks.map((track) => {
    const saved = matched[track.id]
    if (!saved) return defaults[track.id]
    return {
      volume: saved.volume,
      pan: saved.pan,
      program: saved.program,
      muted: saved.muted,
      solo: saved.solo
    }
  })

  let selectedTrackId: number | null = null
  if (preset.selectedTrack) {
    const { name, index } = preset.selectedTrack
    const target = preset.tracks.find((t) => t.index === index && t.name === name)
    const id = target ? matched.indexOf(target) : -1
    selectedTrackId = id >= 0 ? id : (song.tracks.find((t) => t.name === name)?.id ?? null)
  }

  return {
    mixes,
    tempoFactor: preset.tempoFactor,
    selectedTrackId: selectedTrackId ?? song.tracks[0]?.id ?? null,
    exportSettings: preset.export
  }
}

/** Validates untrusted JSON (a preset file) and returns a well-formed preset. */
export function parsePreset(json: unknown): Preset {
  const fail = (reason: string): never => {
    throw new Error(`Not a valid preset: ${reason}`)
  }
  if (!isObject(json)) return fail('expected a JSON object')
  if (json.version !== PRESET_VERSION) return fail(`unsupported version ${String(json.version)}`)
  if (!Array.isArray(json.tracks)) return fail('missing tracks')

  const tracks = json.tracks.map((t, i): PresetTrack => {
    if (!isObject(t) || typeof t.name !== 'string') return fail(`track ${i + 1} is malformed`)
    return {
      index: integer(t.index, 0, 1023, i),
      name: t.name,
      volume: integer(t.volume, 0, 127, DEFAULT_VOLUME),
      pan: integer(t.pan, -64, 63, 0),
      program: integer(t.program, 0, 127, 0),
      muted: t.muted === true,
      solo: t.solo === true
    }
  })

  const selected = isObject(json.selectedTrack) ? json.selectedTrack : null
  const exportJson = isObject(json.export) ? json.export : {}
  const bitrate = Number(exportJson.bitrate)
  const mode = exportJson.mode

  return {
    version: PRESET_VERSION,
    midiFileName: typeof json.midiFileName === 'string' ? json.midiFileName : undefined,
    midiFileHash: typeof json.midiFileHash === 'string' ? json.midiFileHash : undefined,
    tempoFactor: number(json.tempoFactor, 0.25, 2, 1),
    selectedTrack:
      selected && typeof selected.name === 'string'
        ? { index: integer(selected.index, 0, 1023, 0), name: selected.name }
        : null,
    tracks,
    export: {
      bitrate: (EXPORT_BITRATES as readonly number[]).includes(bitrate)
        ? bitrate
        : DEFAULT_EXPORT_SETTINGS.bitrate,
      mode: mode === 'mix' || mode === 'practice-solo' || mode === 'practice-muted' ? mode : 'mix'
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(number(value, min, max, fallback))
}
