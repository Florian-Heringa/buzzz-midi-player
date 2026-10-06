import { create } from 'zustand'
import type { LoadedMidiFile } from '@shared/api'
import { AudioEngine } from '../audio/engine'
import { buildExportMidi } from '../audio/exportMix'
import { channelStates, defaultMix, type TrackMix } from '../audio/mixer'
import { buildPlaybackMidi } from '../audio/playbackMidi'
import { assignChannels, type ChannelAssignment } from '../model/channels'
import { updateLoop, type LoopRange } from '../model/loop'
import { measureCount } from '../model/measures'
import { parseSong, type Song } from '../model/song'
import {
  applyPreset,
  createPreset,
  DEFAULT_EXPORT_SETTINGS,
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
  engineStatus: EngineStatus
  transport: TransportStatus
  positionTick: number
  /** Playback speed relative to the file's tempo (1 = original). */
  tempoFactor: number
  exportSettings: ExportSettings
  exportDialogOpen: boolean
  /** Export render progress 0–1, or null when no export is running. */
  exportProgress: number | null
  /** Loop range chosen in the UI. Not yet applied to playback. */
  loop: LoopRange
  error: string | null
  /** Short-lived confirmation message, e.g. "Preset saved". */
  notice: string | null

  loadFile(file: LoadedMidiFile): Promise<void>
  selectTrack(trackId: number): void
  play(): Promise<void>
  pause(): Promise<void>
  togglePlay(): Promise<void>
  stop(): Promise<void>
  seek(tick: number): void
  setTempoFactor(factor: number): void
  updateMix(trackId: number, change: Partial<TrackMix>): void
  setExportSettings(change: Partial<ExportSettings>): void
  openExportDialog(): void
  closeExportDialog(): void
  startExport(): Promise<void>
  cancelExport(): void
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
      exportSettings: settings.exportSettings
    })
    engine?.setTempoFactor(settings.tempoFactor)
    void engine?.setChannels(currentChannelStates())
  }

  const defaultSettings = (song: Song): PlayerSettings => ({
    mixes: song.tracks.map(defaultMix),
    tempoFactor: 1,
    selectedTrackId: song.tracks[0]?.id ?? null,
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS }
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
    engineStatus: 'idle',
    transport: 'stopped',
    positionTick: 0,
    tempoFactor: 1,
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
    exportDialogOpen: false,
    exportProgress: null,
    loop: { enabled: false, startBar: 1, endBar: 1 },
    error: null,
    notice: null,

    loadFile: async (file) => {
      let song: Song
      try {
        song = parseSong(file.data, file.name)
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
      set({ transport: 'stopped', positionTick: 0 })
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

    updateMix: (trackId, change) => {
      const mixes = get().mixes.map((mix, id) => (id === trackId ? { ...mix, ...change } : mix))
      set({ mixes })
      void engine?.setChannels(currentChannelStates())
    },

    setExportSettings: (change) => set({ exportSettings: { ...get().exportSettings, ...change } }),

    openExportDialog: () => {
      if (get().song) set({ exportDialogOpen: true })
    },

    closeExportDialog: () => {
      get().cancelExport()
      set({ exportDialogOpen: false })
    },

    startExport: async () => {
      const { song, assignment, file, mixes, selectedTrackId, tempoFactor, exportSettings } = get()
      if (!song || !assignment || !file || get().exportProgress !== null) return

      const practice = selectedTrackId !== null ? song.tracks[selectedTrackId]?.name : undefined
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
          get().showNotice(`Exported ${result.path.split(/[\\/]/).pop()}`)
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
      applySettings(defaultSettings(song))
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
    state.exportSettings !== prev.exportSettings
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
