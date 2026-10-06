// Worker thread: renders an MP3 export and writes it, reporting progress to the main process.
import { readFile, writeFile } from 'fs/promises'
import { parentPort, workerData } from 'worker_threads'
import { renderMp3 } from './renderMp3'

export interface ExportWorkerData {
  soundFontPath: string
  midi: Uint8Array
  durationTicks: number
  tempoFactor: number
  bitrate: number
  sampleRate: number
  outPath: string
}

export type ExportWorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; seconds: number }
  | { type: 'error'; message: string }

const post = (message: ExportWorkerMessage): void => parentPort?.postMessage(message)

async function run(data: ExportWorkerData): Promise<void> {
  const soundFont = await readFile(data.soundFontPath)
  const { mp3, seconds } = await renderMp3({
    soundFont: toArrayBuffer(soundFont),
    midi: toArrayBuffer(data.midi),
    durationTicks: data.durationTicks,
    tempoFactor: data.tempoFactor,
    bitrate: data.bitrate,
    sampleRate: data.sampleRate,
    onProgress: (fraction) => post({ type: 'progress', fraction })
  })
  await writeFile(data.outPath, mp3)
  post({ type: 'done', seconds })
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

run(workerData as ExportWorkerData).catch((err) =>
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
)
