import { useCallback, useEffect } from 'react'
import type { LoadedMidiFile } from '@shared/api'
import { useAppStore } from '../store/appStore'

const MIDI_EXTENSION = /\.midi?$/i

/** Wires the menu, open dialog and drag-and-drop to the app store. */
export function useMidiLoader(): {
  openDialog: () => Promise<void>
  loadDroppedFile: (file: File) => Promise<void>
} {
  const loadFile = useAppStore((s) => s.loadFile)
  const setError = useAppStore((s) => s.setError)

  const load = useCallback(
    async (loader: () => Promise<LoadedMidiFile | null>) => {
      try {
        const file = await loader()
        if (file) await loadFile(file)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadFile, setError]
  )

  const openDialog = useCallback(() => load(() => window.api.openMidiDialog()), [load])

  const loadDroppedFile = useCallback(
    async (file: File) => {
      if (!MIDI_EXTENSION.test(file.name)) {
        setError(`"${file.name}" is not a MIDI file.`)
        return
      }
      await load(() => window.api.readMidiFile(window.api.getPathForFile(file)))
    },
    [load, setError]
  )

  useEffect(
    () =>
      window.api.onMenuCommand((command) => {
        const store = useAppStore.getState()
        if (command === 'open-midi') void openDialog()
        else if (command === 'save-preset') void store.savePresetAs()
        else if (command === 'load-preset') void store.loadPresetFromFile()
        else if (command === 'reset-settings') store.resetSettings()
      }),
    [openDialog]
  )

  return { openDialog, loadDroppedFile }
}
