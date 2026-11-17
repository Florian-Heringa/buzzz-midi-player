import { useCallback, useEffect } from 'react'
import type { LoadedMidiFile, MenuCommand } from '@shared/api'
import { useAppStore } from '../store/appStore'

const MIDI_EXTENSION = /\.midi?$/i

/** Wires the menu, open dialog, drag-and-drop and Explorer file opening to the app store. */
export function useMidiLoader(): {
  openDialog: () => Promise<void>
  openRecent: (path: string) => Promise<void>
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
  const openRecent = useCallback(
    (path: string) => load(() => window.api.openRecentFile(path)),
    [load]
  )

  const loadDroppedFile = useCallback(
    async (file: File) => {
      if (!MIDI_EXTENSION.test(file.name)) {
        setError(`"${file.name}" is not a MIDI file.`)
        return
      }
      await load(() => window.api.readDroppedFile(file))
    },
    [load, setError]
  )

  // Files opened from Explorer: the one the app started with, then any opened while running.
  // takeLaunchFile returns the file only once, so StrictMode's double effect is harmless.
  useEffect(() => {
    void load(() => window.api.takeLaunchFile())
    return window.api.onOpenFile((file) => void load(async () => file))
  }, [load])

  useEffect(() => {
    const run = (command: MenuCommand): void => {
      const store = useAppStore.getState()
      if (command === 'open-midi') void openDialog()
      else if (command === 'save-preset') void store.savePresetAs()
      else if (command === 'load-preset') void store.loadPresetFromFile()
      else if (command === 'reset-settings') store.resetSettings()
      else if (command === 'export-mp3') store.openExportDialog()
      else if (command === 'open-settings') store.openSettings()
    }
    if (window.api.platform === 'electron') return window.api.onMenuCommand(run)

    // The web version has no application menu, so the page handles its shortcuts.
    const onKey = (event: KeyboardEvent): void => {
      const command = shortcutCommand(event)
      if (!command) return
      event.preventDefault()
      run(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDialog])

  return { openDialog, openRecent, loadDroppedFile }
}

/** The menu command for a key press, using the desktop app's menu shortcuts. */
function shortcutCommand(event: KeyboardEvent): MenuCommand | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const key = event.key.toLowerCase()
  if (event.shiftKey) {
    if (key === 's') return 'save-preset'
    if (key === 'o') return 'load-preset'
    return null
  }
  if (key === 'o') return 'open-midi'
  if (key === 'e') return 'export-mp3'
  if (key === ',') return 'open-settings'
  return null
}
