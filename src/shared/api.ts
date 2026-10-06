/** A MIDI file loaded from disk by the main process. */
export interface LoadedMidiFile {
  name: string
  path: string
  /** SHA-1 of the file contents (hex); identifies the file for auto-saved presets. */
  hash: string
  data: Uint8Array
}

/** Commands sent from the application menu to the renderer. */
export type MenuCommand = 'open-midi' | 'save-preset' | 'load-preset' | 'reset-settings'

/** API exposed to the renderer through the preload script as `window.api`. */
export interface ElectronApi {
  /** Shows an open dialog and reads the chosen MIDI file. Resolves to null when cancelled. */
  openMidiDialog(): Promise<LoadedMidiFile | null>
  /** Reads a MIDI file from a known path (e.g. after drag-and-drop). */
  readMidiFile(path: string): Promise<LoadedMidiFile>
  /** Reads the bundled General MIDI SoundFont. */
  loadSoundFont(): Promise<Uint8Array>
  /** Reads the settings auto-saved for a MIDI file, or null if there are none. */
  readAutoPreset(hash: string): Promise<unknown>
  /** Auto-saves settings for a MIDI file. */
  writeAutoPreset(hash: string, preset: unknown): Promise<void>
  /** Shows a save dialog and writes the preset. Resolves to false when cancelled. */
  savePresetDialog(preset: unknown, defaultName: string): Promise<boolean>
  /** Shows an open dialog and reads a preset file. Resolves to null when cancelled. */
  openPresetDialog(): Promise<unknown>
  /** Resolves the filesystem path of a File dropped onto the window. */
  getPathForFile(file: File): string
  /** Subscribes to application menu commands. Returns an unsubscribe function. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

export const IpcChannels = {
  openMidiDialog: 'midi:open-dialog',
  readMidiFile: 'midi:read-file',
  loadSoundFont: 'soundfont:load',
  readAutoPreset: 'preset:read-auto',
  writeAutoPreset: 'preset:write-auto',
  savePresetDialog: 'preset:save-dialog',
  openPresetDialog: 'preset:open-dialog',
  menuCommand: 'menu:command'
} as const
