import { create } from 'zustand'
import type { LoadedMidiFile } from '@shared/api'
import { parseSong, type Song } from '../model/song'

interface AppState {
  file: LoadedMidiFile | null
  song: Song | null
  /** The track being practiced: shown on the staff. */
  selectedTrackId: number | null
  error: string | null
  loadFile(file: LoadedMidiFile): void
  selectTrack(trackId: number): void
  setError(error: string | null): void
}

export const useAppStore = create<AppState>((set) => ({
  file: null,
  song: null,
  selectedTrackId: null,
  error: null,
  loadFile: (file) => {
    try {
      const song = parseSong(file.data, file.name)
      if (song.tracks.length === 0) throw new Error('This MIDI file contains no notes.')
      set({ file, song, selectedTrackId: song.tracks[0].id, error: null })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      set({ error: `Could not open ${file.name}: ${reason}` })
    }
  },
  selectTrack: (selectedTrackId) => set({ selectedTrackId }),
  setError: (error) => set({ error })
}))
