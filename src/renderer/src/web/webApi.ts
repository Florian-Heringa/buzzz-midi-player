// The host API for the web version (GitHub Pages): browser file pickers and downloads instead of
// native dialogs, browser storage instead of the user data folder, and MP3 export in a Web
// Worker instead of the main process. Things only the desktop app can do are no-ops.
import fluidSynthUrl from 'js-synthesizer/externals/libfluidsynth-2.4.6.js?url'
import type { ExportRequest, ExportResult, HostApi, LoadedMidiFile, RecentFile } from '@shared/api'
import type { ExportJob, ExportJobMessage } from './exportWorker'
import ExportWorker from './exportWorker?worker'
import { download, pickFile, sha1Hex } from './files'
import * as recent from './recentFiles'

/** Served next to the page (see vite.web.config.ts). */
const SOUNDFONT_URL = 'soundfonts/GeneralUser-GS.sf2'
const EXPORT_SAMPLE_RATE = 44_100
const MIDI_ACCEPT = '.mid,.midi,audio/midi,audio/x-midi'
const PRESET_ACCEPT = '.json,application/json'
/** Auto-saved settings per MIDI file, like the desktop app's presets folder. */
const AUTO_PRESET_KEY = (hash: string): string => `buzzz.preset.${hash}`

const noop = (): void => {}
const unsubscribed = (): (() => void) => noop

export function createWebApi(): HostApi {
  const recentListeners = new Set<(files: RecentFile[]) => void>()
  const progressListeners = new Set<(fraction: number) => void>()
  let soundFont: Promise<Uint8Array> | null = null
  let runningExport: { worker: Worker; cancel: () => void } | null = null

  const recentChanged = async (): Promise<void> => {
    const files = await recent.getRecentFiles()
    for (const listener of recentListeners) listener(files)
  }

  /** Every way of opening a file goes here, so it lands in the recent list. */
  const loadMidi = async (name: string, data: Uint8Array): Promise<LoadedMidiFile> => {
    const file: LoadedMidiFile = { name, path: name, hash: await sha1Hex(data), data }
    // The file opens even if the browser refuses to store it (e.g. private browsing).
    void recent
      .addRecentFile(file)
      .then(recentChanged)
      .catch((err) => console.warn('Could not remember recent file:', err))
    return file
  }

  const readFile = async (file: File): Promise<LoadedMidiFile> =>
    loadMidi(file.name, new Uint8Array(await file.arrayBuffer()))

  const loadSoundFont = (): Promise<Uint8Array> => {
    if (!soundFont) {
      soundFont = fetch(SOUNDFONT_URL).then(async (response) => {
        if (!response.ok) throw new Error(`Could not download the SoundFont (${response.status})`)
        return new Uint8Array(await response.arrayBuffer())
      })
      soundFont.catch(() => (soundFont = null))
    }
    return soundFont
  }

  const exportMp3 = async (request: ExportRequest): Promise<ExportResult | null> => {
    if (runningExport) return null
    const sf = await loadSoundFont()
    const job: ExportJob = {
      fluidSynthUrl: new URL(fluidSynthUrl, document.baseURI).href,
      // Copies: the SoundFont stays cached here for playback and later exports.
      soundFont: sf.slice().buffer,
      midi: request.midi.slice().buffer,
      startTick: Math.max(0, Math.min(request.startTick, request.durationTicks)),
      durationTicks: request.durationTicks,
      tempoFactor: request.tempoFactor,
      bitrate: request.bitrate,
      sampleRate: EXPORT_SAMPLE_RATE
    }

    return new Promise<ExportResult>((resolve, reject) => {
      const worker = new ExportWorker()
      const finish = (): void => {
        runningExport = null
        worker.terminate()
      }
      runningExport = {
        worker,
        cancel: () => {
          finish()
          reject(new Error('Export cancelled'))
        }
      }
      worker.onmessage = (event: MessageEvent<ExportJobMessage>) => {
        const message = event.data
        if (message.type === 'progress') {
          for (const listener of progressListeners) listener(message.fraction)
        } else if (message.type === 'done') {
          finish()
          download(request.defaultName, message.mp3 as Uint8Array<ArrayBuffer>, 'audio/mpeg')
          resolve({ path: request.defaultName, seconds: message.seconds })
        } else {
          finish()
          reject(new Error(message.message))
        }
      }
      worker.onerror = (event) => {
        finish()
        reject(new Error(event.message || 'The export worker failed'))
      }
      worker.postMessage(job)
    })
  }

  return {
    platform: 'web',

    openMidiDialog: async () => {
      const file = await pickFile(MIDI_ACCEPT)
      return file ? readFile(file) : null
    },
    readDroppedFile: readFile,
    // No operating system integration: nothing opens the page with a file.
    takeLaunchFile: async () => null,
    onOpenFile: unsubscribed,

    getRecentFiles: () => recent.getRecentFiles().catch(() => []),
    openRecentFile: async (hash) => {
      const file = await recent.readRecentFile(hash)
      return loadMidi(file.name, file.data)
    },
    removeRecentFile: async (hash) => {
      await recent.removeRecentFile(hash)
      await recentChanged()
    },
    clearRecentFiles: async () => {
      await recent.clearRecentFiles()
      await recentChanged()
    },
    onRecentFilesChanged: (listener) => {
      recentListeners.add(listener)
      return () => recentListeners.delete(listener)
    },

    loadSoundFont,

    readAutoPreset: async (hash) => {
      const saved = localStorage.getItem(AUTO_PRESET_KEY(hash))
      return saved === null ? null : JSON.parse(saved)
    },
    writeAutoPreset: async (hash, preset) => {
      localStorage.setItem(AUTO_PRESET_KEY(hash), JSON.stringify(preset))
    },
    savePresetDialog: async (preset, defaultName) => {
      download(defaultName, JSON.stringify(preset, null, 2), 'application/json')
      return true
    },
    openPresetDialog: async () => {
      const file = await pickFile(PRESET_ACCEPT)
      return file ? JSON.parse(await file.text()) : null
    },

    exportMp3,
    cancelExport: async () => runningExport?.cancel(),
    // Downloads cannot be revealed; the UI does not offer it on the web.
    showExportInFolder: async () => false,
    onExportProgress: (listener) => {
      progressListeners.add(listener)
      return () => progressListeners.delete(listener)
    },

    // No window frame or native menus to theme.
    setNativeTheme: async () => {},
    onMenuCommand: unsubscribed,

    // The page is always the latest version.
    getAvailableUpdate: async () => null,
    onAvailableUpdate: unsubscribed,
    openReleasePage: async (url) => {
      window.open(url, '_blank', 'noopener')
    }
  }
}
