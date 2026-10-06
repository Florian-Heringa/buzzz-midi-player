import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { Worker } from 'worker_threads'
import { IpcChannels, type ExportRequest, type ExportResult } from '../../shared/api'
import createExportWorker from './exportWorker?nodeWorker'
import type { ExportWorkerData, ExportWorkerMessage } from './exportWorker'

const MP3_FILTERS = [{ name: 'MP3 audio', extensions: ['mp3'] }]
const EXPORT_SAMPLE_RATE = 44_100

let running: { worker: Worker; cancel: () => void } | null = null

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
}
