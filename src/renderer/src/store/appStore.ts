import { create } from 'zustand'
import type { LoadedMidiFile } from '@shared/api'
import { AudioEngine } from '../audio/engine'
import { channelStates, defaultMix, type TrackMix } from '../audio/mixer'
import { buildPlaybackMidi } from '../audio/playbackMidi'
import { assignChannels, type ChannelAssignment } from '../model/channels'
import { parseSong, type Song } from '../model/song'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'
export type TransportStatus = 'stopped' | 'playing' | 'paused'

export const MIN_TEMPO_FACTOR = 0.25
export const MAX_TEMPO_FACTOR = 2

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
  error: string | null

  loadFile(file: LoadedMidiFile): Promise<void>
  selectTrack(trackId: number): void
  play(): Promise<void>
  pause(): Promise<void>
  togglePlay(): Promise<void>
  stop(): Promise<void>
  seek(tick: number): void
  setTempoFactor(factor: number): void
  updateMix(trackId: number, change: Partial<TrackMix>): void
  setError(error: string | null): void
}

let engine: AudioEngine | null = null
let enginePromise: Promise<AudioEngine> | null = null

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
    error: null,

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
      set({
        file,
        song,
        assignment,
        selectedTrackId: song.tracks[0].id,
        mixes: song.tracks.map(defaultMix),
        transport: 'stopped',
        positionTick: 0,
        error: null
      })

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

    setError: (error) => set({ error })
  }
})

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
