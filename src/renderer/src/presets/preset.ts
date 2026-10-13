import { DEFAULT_VOLUME, type TrackMix } from '../audio/mixer'
import type { KeyChoice } from '../model/keys'
import { updateLoop, type LoopRange } from '../model/loop'
import { measureCount } from '../model/measures'
import type { Song } from '../model/song'

export type ExportMode = 'mix' | 'practice-solo' | 'practice-muted'
/** The whole song, or only the loop's bars (whether or not looping is switched on). */
export type ExportRange = 'song' | 'loop'

export interface ExportSettings {
  /** MP3 bitrate in kbps. */
  bitrate: number
  /** What the export contains: the current mix, only the practice part, or everything but it. */
  mode: ExportMode
  range: ExportRange
  /** How many times the loop plays in a loop export. */
  repeats: number
}

export const EXPORT_BITRATES = [96, 128, 160, 192, 256, 320] as const
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { bitrate: 192, mode: 'mix', range: 'song', repeats: 1 }
export const MAX_EXPORT_REPEATS = 20
/** Range for a base tempo set by the user (for files with wrong tempo information). */
export const MIN_BASE_BPM = 20
export const MAX_BASE_BPM = 400

export const PRESET_VERSION = 1

export interface PresetTrack extends TrackMix {
  index: number
  /** The track's name in the MIDI file; used to match tracks when the preset is applied. */
  name: string
  /** Custom name given in the player, if any. */
  label?: string
}

/** Longest custom track name kept. */
export const MAX_TRACK_LABEL_LENGTH = 60

/** Saved player settings for a MIDI file. */
export interface Preset {
  version: typeof PRESET_VERSION
  midiFileName?: string
  midiFileHash?: string
  tempoFactor: number
  selectedTrack: { index: number; name: string } | null
  tracks: PresetTrack[]
  export: ExportSettings
  /** How the key is read, if the user changed it from the file's key. */
  key?: KeyChoice
  /** The song's starting tempo in BPM, if the user corrected the file's. */
  baseBpm?: number
  /** Loop range and whether looping is on. */
  loop?: LoopRange
}

export interface PlayerSettings {
  mixes: TrackMix[]
  tempoFactor: number
  selectedTrackId: number | null
  exportSettings: ExportSettings
  /** Custom track names, indexed by track id; '' keeps the name from the file. */
  trackLabels: string[]
  /** How the key is read; null follows the key signature in the file. */
  keyChoice: KeyChoice | null
  /** The song's starting tempo in BPM; null follows the file's tempo. */
  baseBpm: number | null
  loop: LoopRange
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
      ...settings.mixes[track.id],
      ...(settings.trackLabels[track.id] ? { label: settings.trackLabels[track.id] } : {})
    })),
    export: { ...settings.exportSettings },
    ...(settings.keyChoice ? { key: { ...settings.keyChoice } } : {}),
    ...(settings.baseBpm !== null ? { baseBpm: settings.baseBpm } : {}),
    loop: { ...settings.loop }
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
    exportSettings: preset.export,
    trackLabels: song.tracks.map((track) => matched[track.id]?.label ?? ''),
    keyChoice: preset.key ?? null,
    baseBpm: preset.baseBpm ?? null,
    // Kept within the song's bars, in case the file changed.
    loop: updateLoop(defaultLoop(song), preset.loop ?? {}, measureCount(song))
  }
}

/** Looping off, over the whole song. */
export function defaultLoop(song: Song): LoopRange {
  return { enabled: false, startBar: 1, endBar: measureCount(song) }
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
      solo: t.solo === true,
      ...(typeof t.label === 'string' && t.label.trim()
        ? { label: t.label.trim().slice(0, MAX_TRACK_LABEL_LENGTH) }
        : {})
    }
  })

  const selected = isObject(json.selectedTrack) ? json.selectedTrack : null
  const exportJson = isObject(json.export) ? json.export : {}
  const keyJson = isObject(json.key) ? json.key : null
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
      mode: mode === 'mix' || mode === 'practice-solo' || mode === 'practice-muted' ? mode : 'mix',
      range: exportJson.range === 'loop' ? 'loop' : 'song',
      repeats: integer(exportJson.repeats, 1, MAX_EXPORT_REPEATS, 1)
    },
    ...(isObject(json.loop)
      ? {
          loop: {
            enabled: json.loop.enabled === true,
            startBar: integer(json.loop.startBar, 1, 100_000, 1),
            endBar: integer(json.loop.endBar, 1, 100_000, 1)
          }
        }
      : {}),
    ...(typeof json.baseBpm === 'number' && Number.isFinite(json.baseBpm)
      ? { baseBpm: number(json.baseBpm, MIN_BASE_BPM, MAX_BASE_BPM, 120) }
      : {}),
    ...(keyJson &&
    (keyJson.accidentals === 'sharps' || keyJson.accidentals === 'flats') &&
    (keyJson.mode === 'major' || keyJson.mode === 'minor')
      ? {
          key: {
            accidentals: keyJson.accidentals,
            mode: keyJson.mode,
            ...(keyJson.source === 'estimate' ? { source: 'estimate' as const } : {})
          }
        }
      : {})
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
