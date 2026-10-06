/** A MIDI file loaded from disk by the main process. */
export interface LoadedMidiFile {
  name: string
  path: string
  /** SHA-1 of the file contents (hex); identifies the file for auto-saved presets. */
  hash: string
  data: Uint8Array
}

/** What the renderer asks the main process to export as MP3. */
export interface ExportRequest {
  /** Suggested file name for the save dialog. */
  defaultName: string
  /** Playback MIDI file with the export mix written at tick 0. */
  midi: Uint8Array
  durationTicks: number
  tempoFactor: number
  /** MP3 bitrate in kbps. */
  bitrate: number
}

export interface ExportResult {
  path: string
  seconds: number
}

/** Commands sent from the application menu to the renderer. */
export type MenuCommand = 'open-midi' | 'save-preset' | 'load-preset' | 'reset-settings' | 'export-mp3'

/** API exposed to the renderer through the preload script as `window.api`. */
export interface ElectronApi {
  /** Shows an open dialog and reads the chosen MIDI file. Resolves to null when cancelled. */
  openMidiDialog(): Promise<LoadedMidiFile | null>
  /** Reads a MIDI file from a known path (e.g. after drag-and-drop). */
  readMidiFile(path: string): Promise<LoadedMidiFile>
  /** The MIDI file the app was launched with (e.g. from Explorer); returns it only once. */
  takeLaunchFile(): Promise<LoadedMidiFile | null>
  /** Subscribes to MIDI files opened from Explorer while the app is running. */
  onOpenFile(listener: (file: LoadedMidiFile) => void): () => void
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
  /**
   * Asks where to save, then renders and writes the MP3. Resolves to null when the save
   * dialog is cancelled; rejects if rendering fails or `cancelExport` is called.
   */
  exportMp3(request: ExportRequest): Promise<ExportResult | null>
  /** Stops a running export. */
  cancelExport(): Promise<void>
  /**
   * Opens the file explorer with an exported file selected. Resolves to false (after opening
   * its folder) when the file no longer exists.
   */
  showExportInFolder(path: string): Promise<boolean>
  /** Subscribes to export progress (0–1). Returns an unsubscribe function. */
  onExportProgress(listener: (fraction: number) => void): () => void
  /** Resolves the filesystem path of a File dropped onto the window. */
  getPathForFile(file: File): string
  /** Subscribes to application menu commands. Returns an unsubscribe function. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

export const IpcChannels = {
  openMidiDialog: 'midi:open-dialog',
  readMidiFile: 'midi:read-file',
  takeLaunchFile: 'midi:take-launch-file',
  openFile: 'midi:open-file',
  loadSoundFont: 'soundfont:load',
  readAutoPreset: 'preset:read-auto',
  writeAutoPreset: 'preset:write-auto',
  savePresetDialog: 'preset:save-dialog',
  openPresetDialog: 'preset:open-dialog',
  exportMp3: 'export:mp3',
  cancelExport: 'export:cancel',
  exportProgress: 'export:progress',
  showExportInFolder: 'export:show-in-folder',
  menuCommand: 'menu:command'
} as const
