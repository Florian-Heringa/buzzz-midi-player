// Web Worker (classic): renders an MP3 export off the main thread, reporting progress.
import { renderMp3 } from '@shared/export/renderMp3'

export interface ExportJob {
  /** Absolute URL of libfluidsynth-*.js, loaded as a classic script that defines `Module`. */
  fluidSynthUrl: string
  soundFont: ArrayBuffer
  midi: ArrayBuffer
  startTick: number
  durationTicks: number
  tempoFactor: number
  bitrate: number
  sampleRate: number
}

export type ExportJobMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; mp3: Uint8Array; seconds: number }
  | { type: 'error'; message: string }

/** The worker's global scope (typed by hand: the WebWorker lib clashes with the DOM lib). */
const scope = self as unknown as {
  Module?: unknown
  importScripts(url: string): void
  postMessage(message: ExportJobMessage, transfer: Transferable[]): void
  onmessage: ((event: MessageEvent<ExportJob>) => void) | null
}

const post = (message: ExportJobMessage, transfer: Transferable[] = []): void =>
  scope.postMessage(message, transfer)

scope.onmessage = async (event) => {
  const job = event.data
  try {
    if (!scope.Module) scope.importScripts(job.fluidSynthUrl)
    const { mp3, seconds } = await renderMp3({
      fluidSynth: scope.Module,
      soundFont: job.soundFont,
      midi: job.midi,
      startTick: job.startTick,
      durationTicks: job.durationTicks,
      tempoFactor: job.tempoFactor,
      bitrate: job.bitrate,
      sampleRate: job.sampleRate,
      onProgress: (fraction) => post({ type: 'progress', fraction })
    })
    post({ type: 'done', mp3, seconds }, [mp3.buffer])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
