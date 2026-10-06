import { create } from 'zustand'
import type { LoadedMidiFile } from '@shared/api'

interface AppState {
  file: LoadedMidiFile | null
  error: string | null
  setFile(file: LoadedMidiFile): void
  setError(error: string | null): void
}

export const useAppStore = create<AppState>((set) => ({
  file: null,
  error: null,
  setFile: (file) => set({ file, error: null }),
  setError: (error) => set({ error })
}))
