/** A MIDI file loaded from disk by the main process. */
export interface LoadedMidiFile {
  name: string
  path: string
  data: Uint8Array
}

/** Commands sent from the application menu to the renderer. */
export type MenuCommand = 'open-midi'

/** API exposed to the renderer through the preload script as `window.api`. */
export interface ElectronApi {
  /** Shows an open dialog and reads the chosen MIDI file. Resolves to null when cancelled. */
  openMidiDialog(): Promise<LoadedMidiFile | null>
  /** Reads a MIDI file from a known path (e.g. after drag-and-drop). */
  readMidiFile(path: string): Promise<LoadedMidiFile>
  /** Reads the bundled General MIDI SoundFont. */
  loadSoundFont(): Promise<Uint8Array>
  /** Resolves the filesystem path of a File dropped onto the window. */
  getPathForFile(file: File): string
  /** Subscribes to application menu commands. Returns an unsubscribe function. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

export const IpcChannels = {
  openMidiDialog: 'midi:open-dialog',
  readMidiFile: 'midi:read-file',
  loadSoundFont: 'soundfont:load',
  menuCommand: 'menu:command'
} as const
