import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { dirname } from 'path'
import type { Worker } from 'worker_threads'
import { IpcChannels, type ExportRequest, type ExportResult } from '../../shared/api'
import createExportWorker from './exportWorker?nodeWorker'
import type { ExportWorkerData, ExportWorkerMessage } from './exportWorker'

const MP3_FILTERS = [{ name: 'MP3 audio', extensions: ['mp3'] }]
const EXPORT_SAMPLE_RATE = 44_100

let running: { worker: Worker; cancel: () => void } | null = null
/** Files written by exports; the renderer may only reveal these in Explorer. */
const exportedPaths = new Set<string>()

/**
 * MP3 export: asks for a destination, then renders and writes the file in a worker thread
 * (keeping the main process responsive) while forwarding progress to the window.
 */
export function registerExportHandlers(
  getWindow: () => BrowserWindow | null,
  soundFontPath: () => string
): void {
  ipcMain.handle(
    IpcChannels.exportMp3,
    async (event, request: ExportRequest): Promise<ExportResult | null> => {
      const window = getWindow()
      if (!window || running) return null
      const choice = await dialog.showSaveDialog(window, {
        defaultPath: request.defaultName,
        filters: MP3_FILTERS
      })
      if (choice.canceled || !choice.filePath) return null
      const outPath = choice.filePath

      const workerData: ExportWorkerData = {
        soundFontPath: soundFontPath(),
        midi: request.midi,
        // From an untrusted renderer: keep the range sane.
        startTick: Math.max(0, Math.min(Number(request.startTick) || 0, request.durationTicks)),
        durationTicks: request.durationTicks,
        tempoFactor: request.tempoFactor,
        bitrate: request.bitrate,
        sampleRate: EXPORT_SAMPLE_RATE,
        outPath
      }

      return new Promise<ExportResult>((resolve, reject) => {
        const worker = createExportWorker({ workerData })
        const finish = (): void => {
          running = null
          void worker.terminate()
        }
        running = {
          worker,
          cancel: () => {
            finish()
            reject(new Error('Export cancelled'))
          }
        }
        worker.on('message', (message: ExportWorkerMessage) => {
          if (message.type === 'progress') {
            event.sender.send(IpcChannels.exportProgress, message.fraction)
          } else if (message.type === 'done') {
            finish()
            exportedPaths.add(outPath)
            resolve({ path: outPath, seconds: message.seconds })
          } else {
            finish()
            reject(new Error(message.message))
          }
        })
        worker.on('error', (err) => {
          finish()
          reject(err)
        })
      })
    }
  )

  ipcMain.handle(IpcChannels.cancelExport, () => running?.cancel())

  // Opens Explorer with the exported file selected; if it was moved or deleted since, opens
  // its folder instead and reports that the file is gone.
  ipcMain.handle(IpcChannels.showExportInFolder, async (_event, path: string): Promise<boolean> => {
    if (!exportedPaths.has(path)) throw new Error('Not an exported file')
    if (existsSync(path)) {
      shell.showItemInFolder(path)
      return true
    }
    await shell.openPath(dirname(path))
    return false
  })
}
