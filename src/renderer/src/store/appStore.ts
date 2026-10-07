import { create } from 'zustand'
import type { LoadedMidiFile } from '@shared/api'
import { AudioEngine } from '../audio/engine'
import { buildExportMidi } from '../audio/exportMix'
import { channelStates, defaultMix, resetMixes, type MixReset, type TrackMix } from '../audio/mixer'
import { buildPlaybackMidi } from '../audio/playbackMidi'
import { assignChannels, type ChannelAssignment } from '../model/channels'
import { keyChoiceFromFile, withKeyChoice, type KeyChoice } from '../model/keys'
import { stopPosition, updateLoop, type LoopRange } from '../model/loop'
import { measureCount } from '../model/measures'
import { parseSong, type Song } from '../model/song'
import { getSettings } from '../ui/settings'
import {
  applyPreset,
  createPreset,
  DEFAULT_EXPORT_SETTINGS,
  MAX_TRACK_LABEL_LENGTH,
  parsePreset,
  type ExportSettings,
  type PlayerSettings
} from '../presets/preset'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'
export type TransportStatus = 'stopped' | 'playing' | 'paused'

export const MIN_TEMPO_FACTOR = 0.25
export const MAX_TEMPO_FACTOR = 2
/** Delay before changed settings are auto-saved for the open file. */
const AUTO_SAVE_DELAY_MS = 500
/** How long transient notices stay visible. */
const NOTICE_MS = 3000

interface AppState {
  file: LoadedMidiFile | null
  song: Song | null
  assignment: ChannelAssignment | null
  /** The track being practiced: shown on the staff. */
  selectedTrackId: number | null
  /** Mix settings, indexed by track id. */
  mixes: TrackMix[]
  /** Custom track names, indexed by track id; '' keeps the name from the file. */
  trackLabels: string[]
  /** How the key is read; null follows the key signature in the file. */
  keyChoice: KeyChoice | null
  engineStatus: EngineStatus
  transport: TransportStatus
  positionTick: number
  /** Playback speed relative to the file's tempo (1 = original). */
  tempoFactor: number
  exportSettings: ExportSettings
  exportDialogOpen: boolean
  settingsOpen: boolean
  /** Export render progress 0–1, or null when no export is running. */
  exportProgress: number | null
  /** The most recently exported file, shown until dismissed or replaced by the next export. */
  lastExport: { path: string; name: string } | null
  /** Loop range chosen in the UI. Not yet applied to playback. */
  loop: LoopRange
  error: string | null
  /** Short-lived confirmation message, e.g. "Preset saved". */
  notice: string | null

  loadFile(file: LoadedMidiFile): Promise<void>
  /** Parses the open file again, e.g. after a setting that affects its tracks changed. */
  reloadFile(): Promise<void>
  selectTrack(trackId: number): void
  play(): Promise<void>
  pause(): Promise<void>
  togglePlay(): Promise<void>
  stop(): Promise<void>
  seek(tick: number): void
  setTempoFactor(factor: number): void
  updateMix(trackId: number, change: Partial<TrackMix>): void
  /** Resets a mixer setting (or all of them) for every track. */
  resetAllTracks(reset: MixReset): void
  /** Renames a track; an empty name (or the file's own name) restores the file's name. */
  renameTrack(trackId: number, label: string): void
  /** Chooses how the key is read; picking the file's own reading clears the override. */
  setKeyChoice(choice: KeyChoice): void
  setExportSettings(change: Partial<ExportSettings>): void
  openExportDialog(): void
  openSettings(): void
  closeSettings(): void
  closeExportDialog(): void
  startExport(): Promise<void>
  cancelExport(): void
  /** Opens the file explorer at the last exported file. */
  showLastExport(): Promise<void>
  dismissLastExport(): void
  /** Updates the loop range, keeping start ≤ end within the song's bars. */
  setLoop(change: Partial<LoopRange>): void
  savePresetAs(): Promise<void>
  loadPresetFromFile(): Promise<void>
  resetSettings(): void
  setError(error: string | null): void
  showNotice(notice: string): void
}

let engine: AudioEngine | null = null
let enginePromise: Promise<AudioEngine> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let exportCancelled = false

export const useAppStore = create<AppState>((set, get) => {
  /** Creates the audio engine once, loading the SoundFont from the main process. */
  const ensureEngine = (): Promise<AudioEngine> => {
    if (!enginePromise) {
      set({ engineStatus: 'loading' })
      enginePromise = window.api
        .loadSoundFont()
        .then((data) => AudioEngine.create(data.slice().buffer))
        .then((created) => {
          engine = created
          engine.setTempoFactor(get().tempoFactor)
          set({ engineStatus: 'ready' })
          return created
        })
        .catch((err) => {
          enginePromise = null
          set({ engineStatus: 'error', error: `Audio engine failed to start: ${errorText(err)}` })
          throw err
        })
    }
    return enginePromise
  }

  const currentChannelStates = (): ReturnType<typeof channelStates> => {
    const { song, assignment, mixes } = get()
    return song && assignment ? channelStates(song, assignment, mixes) : []
  }

  /**
   * Replaces mix, tempo, practice track and export settings, and updates the engine.
   * `extra` is merged into the same store update (so subscribers see one change).
   */
  const applySettings = (settings: PlayerSettings, extra: Partial<AppState> = {}): void => {
    set({
      ...extra,
      mixes: settings.mixes,
      tempoFactor: settings.tempoFactor,
      selectedTrackId: settings.selectedTrackId,
      exportSettings: settings.exportSettings,
      trackLabels: settings.trackLabels,
      keyChoice: settings.keyChoice
    })
    engine?.setTempoFactor(settings.tempoFactor)
    void engine?.setChannels(currentChannelStates())
  }

  const defaultSettings = (song: Song): PlayerSettings => ({
    mixes: song.tracks.map(defaultMix),
    tempoFactor: 1,
    selectedTrackId: song.tracks[0]?.id ?? null,
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
    trackLabels: song.tracks.map(() => ''),
    keyChoice: null
  })

  /** Follows the player position while playing and stops at the end of the song. */
  const trackPosition = (): void => {
    let pending = false
    const step = (): void => {
      const { transport, song } = get()
      if (transport !== 'playing' || !engine || !song) return
      if (!pending) {
        pending = true
        void engine.currentTick().then((tick) => {
          pending = false
          if (get().transport !== 'playing') return
          if (tick >= song.durationTicks) void get().stop()
          else set({ positionTick: tick })
        })
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  return {
    file: null,
    song: null,
    assignment: null,
    selectedTrackId: null,
    mixes: [],
    trackLabels: [],
    keyChoice: null,
    engineStatus: 'idle',
    transport: 'stopped',
    positionTick: 0,
    tempoFactor: 1,
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
    exportDialogOpen: false,
    settingsOpen: false,
    exportProgress: null,
    lastExport: null,
    loop: { enabled: false, startBar: 1, endBar: 1 },
    error: null,
    notice: null,

    loadFile: async (file) => {
      let song: Song
      try {
        song = parseSong(file.data, file.name, { channelTracks: getSettings().channelTracks })
        if (song.tracks.length === 0) throw new Error('This MIDI file contains no notes.')
      } catch (err) {
        set({ error: `Could not open ${file.name}: ${errorText(err)}` })
        return
      }

      if (get().transport !== 'stopped') await get().stop()
      const assignment = assignChannels(song.tracks)
      let settings = defaultSettings(song)
      let restored = false
      try {
        const saved = await window.api.readAutoPreset(file.hash)
        if (saved) {
          settings = applyPreset(song, parsePreset(saved), settings.mixes)
          restored = true
        }
      } catch {
        // An unreadable auto-saved preset is ignored; the file opens with defaults.
      }
      applySettings(settings, {
        file,
        song,
        assignment,
        transport: 'stopped',
        positionTick: 0,
        loop: { enabled: false, startBar: 1, endBar: measureCount(song) },
        error: null
      })
      if (restored) get().showNotice('Restored your settings for this file')

      try {
        const audio = await ensureEngine()
        const states = currentChannelStates()
        await audio.loadSong(buildPlaybackMidi(song, assignment, states), states)
      } catch (err) {
        set({ error: `Could not prepare playback: ${errorText(err)}` })
      }
    },

    reloadFile: async () => {
      const { file } = get()
      if (file) await get().loadFile(file)
    },

    selectTrack: (selectedTrackId) => set({ selectedTrackId }),

    play: async () => {
      const { song, transport, positionTick } = get()
      if (!song || transport === 'playing') return
      const audio = await ensureEngine()
      await audio.play(positionTick >= song.durationTicks ? 0 : positionTick)
      set({ transport: 'playing' })
      trackPosition()
    },

    pause: async () => {
      if (get().transport !== 'playing' || !engine) return
      set({ transport: 'paused' })
      const tick = await engine.pause()
      set({ positionTick: tick })
    },

    togglePlay: () => (get().transport === 'playing' ? get().pause() : get().play()),

    stop: async () => {
      const { song, loop } = get()
      set({ transport: 'stopped', positionTick: song ? stopPosition(song, loop) : 0 })
      if (engine?.isPlaying) await engine.pause()
    },

    seek: (tick) => {
      const { song } = get()
      if (!song) return
      const clamped = Math.max(0, Math.min(tick, song.durationTicks))
      set({ positionTick: clamped })
      engine?.seek(clamped)
    },

    setTempoFactor: (factor) => {
      const clamped = Math.max(MIN_TEMPO_FACTOR, Math.min(MAX_TEMPO_FACTOR, factor))
      set({ tempoFactor: clamped })
      engine?.setTempoFactor(clamped)
    },

    setKeyChoice: (choice) => {
      const { song } = get()
      if (!song) return
      const fromFile = keyChoiceFromFile(song.keySignatures[0])
      const same =
        (choice.source ?? 'file') === 'file' &&
        fromFile.accidentals === choice.accidentals &&
        fromFile.mode === choice.mode
      set({ keyChoice: same ? null : choice })
    },

    renameTrack: (trackId, label) => {
      const { song, trackLabels } = get()
      const track = song?.tracks[trackId]
      if (!track) return
      const trimmed = label.trim().slice(0, MAX_TRACK_LABEL_LENGTH)
      const next = trimmed === track.name ? '' : trimmed
      if (next === trackLabels[trackId]) return
      set({ trackLabels: trackLabels.map((l, id) => (id === trackId ? next : l)) })
    },

    resetAllTracks: (reset) => {
      const { song, mixes } = get()
      if (!song) return
      set({ mixes: resetMixes(mixes, song.tracks, reset) })
      void engine?.setChannels(currentChannelStates())
    },

    updateMix: (trackId, change) => {
      const mixes = get().mixes.map((mix, id) => (id === trackId ? { ...mix, ...change } : mix))
      set({ mixes })
      void engine?.setChannels(currentChannelStates())
    },

    setExportSettings: (change) => set({ exportSettings: { ...get().exportSettings, ...change } }),

    openExportDialog: () => {
      if (get().song) set({ exportDialogOpen: true })
    },

    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),

    closeExportDialog: () => {
      get().cancelExport()
      set({ exportDialogOpen: false })
    },

    startExport: async () => {
      const { song, assignment, file, mixes, selectedTrackId, tempoFactor, exportSettings } = get()
      if (!song || !assignment || !file || get().exportProgress !== null) return

      const practice = trackDisplayName(get(), selectedTrackId)
      const suffix =
        exportSettings.mode === 'practice-solo'
          ? ` - ${practice}`
          : exportSettings.mode === 'practice-muted'
            ? ` - without ${practice}`
            : ''
      const tempo = tempoFactor === 1 ? '' : ` (${Math.round(tempoFactor * 100)}%)`
      const defaultName = `${file.name.replace(/\.midi?$/i, '')}${suffix}${tempo}.mp3`

      exportCancelled = false
      set({ exportProgress: 0, error: null })
      const unsubscribe = window.api.onExportProgress((fraction) => set({ exportProgress: fraction }))
      try {
        const result = await window.api.exportMp3({
          defaultName,
          midi: buildExportMidi(song, assignment, mixes, selectedTrackId, exportSettings.mode),
          durationTicks: song.durationTicks,
          tempoFactor,
          bitrate: exportSettings.bitrate
        })
        if (result) {
          set({ exportDialogOpen: false })
          const name = result.path.split(/[\\/]/).pop() ?? result.path
          // The top bar lists the file (instead of a transient notice) so it can be opened later.
          set({ lastExport: { path: result.path, name } })
        }
      } catch (err) {
        if (!exportCancelled) set({ error: `Export failed: ${errorText(err)}` })
      } finally {
        unsubscribe()
        set({ exportProgress: null })
      }
    },

    setLoop: (change) => {
      const { song, loop } = get()
      if (song) set({ loop: updateLoop(loop, change, measureCount(song)) })
    },

    showLastExport: async () => {
      const { lastExport } = get()
      if (!lastExport) return
      try {
        const found = await window.api.showExportInFolder(lastExport.path)
        if (!found) set({ error: `${lastExport.name} was moved or deleted; opened its folder instead.` })
      } catch (err) {
        set({ error: `Could not open the folder: ${errorText(err)}` })
      }
    },

    dismissLastExport: () => set({ lastExport: null }),

    cancelExport: () => {
      if (get().exportProgress === null) return
      exportCancelled = true
      void window.api.cancelExport()
    },

    savePresetAs: async () => {
      const { song, file } = get()
      if (!song || !file) return
      const preset = createPreset(song, get(), file)
      const name = file.name.replace(/\.midi?$/i, '') + ' preset.json'
      try {
        if (await window.api.savePresetDialog(preset, name)) get().showNotice('Preset saved')
      } catch (err) {
        set({ error: `Could not save preset: ${errorText(err)}` })
      }
    },

    loadPresetFromFile: async () => {
      const { song } = get()
      if (!song) return
      try {
        const json = await window.api.openPresetDialog()
        if (json === null) return
        applySettings(applyPreset(song, parsePreset(json), song.tracks.map(defaultMix)))
        get().showNotice('Preset loaded')
      } catch (err) {
        set({ error: `Could not load preset: ${errorText(err)}` })
      }
    },

    resetSettings: () => {
      const { song } = get()
      if (!song) return
      // Custom track names and the key reading are not part of the mix, so they stay.
      applySettings({
        ...defaultSettings(song),
        trackLabels: get().trackLabels,
        keyChoice: get().keyChoice
      })
      get().showNotice('Mix and tempo reset')
    },

    setError: (error) => set({ error }),

    showNotice: (notice) => {
      clearTimeout(noticeTimer)
      set({ notice })
      noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS)
    }
  }
})

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Auto-saves settings for the open file shortly after the user changes them. */
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined
useAppStore.subscribe((state, prev) => {
  // Opening a file applies its saved settings; that is not a change worth saving.
  if (!state.file || !state.song || state.file !== prev.file) return
  const changed =
    state.mixes !== prev.mixes ||
    state.tempoFactor !== prev.tempoFactor ||
    state.selectedTrackId !== prev.selectedTrackId ||
    state.exportSettings !== prev.exportSettings ||
    state.trackLabels !== prev.trackLabels ||
    state.keyChoice !== prev.keyChoice
  if (!changed) return
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    const { song, file } = useAppStore.getState()
    if (!song || !file || file !== state.file) return
    window.api
      .writeAutoPreset(file.hash, createPreset(song, useAppStore.getState(), file))
      .catch((err) => console.warn('Auto-save failed:', err))
  }, AUTO_SAVE_DELAY_MS)
})

/** Name shown for a track: its custom name, or the name from the MIDI file. */
export function trackDisplayName(state: Pick<AppState, 'song' | 'trackLabels'>, trackId: number | null): string {
  if (trackId === null) return ''
  return state.trackLabels[trackId] || state.song?.tracks[trackId]?.name || ''
}

/** The song with its key read according to the user's choice; stable while neither changes. */
let interpreted: { song: Song | null; choice: KeyChoice | null; result: Song | null } = {
  song: null,
  choice: null,
  result: null
}
export function interpretedSong(state: Pick<AppState, 'song' | 'keyChoice'>): Song | null {
  if (state.song !== interpreted.song || state.keyChoice !== interpreted.choice) {
    interpreted = {
      song: state.song,
      choice: state.keyChoice,
      result: state.song ? withKeyChoice(state.song, state.keyChoice) : null
    }
  }
  return interpreted.result
}
