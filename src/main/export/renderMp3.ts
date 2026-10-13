import { Mp3Encoder } from '@breezystack/lamejs'
import { disableLogging, Synthesizer, waitForReady } from 'js-synthesizer'
import libfluidsynth from 'js-synthesizer/libfluidsynth'

/** `PlayerSetTempoType.Internal`: tempo value is a multiplier of the file's own tempo. */
const TEMPO_TYPE_INTERNAL = 0
/** Frames per render call; a multiple of the MP3 frame size (1152). */
const BLOCK_FRAMES = 1152 * 4
/** After the last note, keep rendering until the release/reverb tail is this quiet… */
const TAIL_SILENCE = 1e-4
/** …or for at most this long. */
const MAX_TAIL_SECONDS = 4

export interface RenderOptions {
  soundFont: ArrayBuffer
  /** Playback MIDI file with the export mix written at tick 0. */
  midi: ArrayBuffer
  /** Tick to start rendering at (0 for the whole song). */
  startTick?: number
  /** Tick where the music ends; rendering continues until the sound has faded. */
  durationTicks: number
  tempoFactor: number
  /** MP3 bitrate in kbps. */
  bitrate: number
  sampleRate: number
  onProgress?: (fraction: number) => void
}

let fluidSynthReady: Promise<void> | null = null

function ensureFluidSynth(): Promise<void> {
  if (!fluidSynthReady) {
    Synthesizer.initializeWithFluidSynthModule(libfluidsynth)
    fluidSynthReady = waitForReady().then(() => disableLogging())
  }
  return fluidSynthReady
}

/** Renders a MIDI file offline with FluidSynth and encodes it to stereo MP3. */
export async function renderMp3(options: RenderOptions): Promise<{ mp3: Uint8Array; seconds: number }> {
  await ensureFluidSynth()
  const synth = new Synthesizer()
  synth.init(options.sampleRate)
  try {
    await synth.loadSFont(options.soundFont)
    await synth.addSMFDataToPlayer(options.midi)
    // Seeking only takes effect before the player starts. It still applies the mix, tempo and
    // program events before the start; only notes are skipped.
    const startTick = Math.max(0, Math.round(options.startTick ?? 0))
    if (startTick > 0) synth.seekPlayer(startTick)
    await synth.playPlayer()
    synth.setPlayerTempo(TEMPO_TYPE_INTERNAL, options.tempoFactor)

    const encoder = new Mp3Encoder(2, options.sampleRate, options.bitrate)
    const chunks: Uint8Array[] = []
    const left = new Float32Array(BLOCK_FRAMES)
    const right = new Float32Array(BLOCK_FRAMES)
    const left16 = new Int16Array(BLOCK_FRAMES)
    const right16 = new Int16Array(BLOCK_FRAMES)
    let frames = 0
    let tailFrames = 0
    let lastProgress = 0

    for (;;) {
      synth.render([left, right])
      frames += BLOCK_FRAMES
      toInt16(left, left16)
      toInt16(right, right16)
      const chunk = encoder.encodeBuffer(left16, right16)
      if (chunk.length > 0) chunks.push(chunk.slice())

      // The player keeps ticking past the last event, so the song end is detected by tick.
      const tick = synth.getPlayerCurrentTick()
      if (tick < options.durationTicks) {
        const fraction = Math.max(0, tick - startTick) / (options.durationTicks - startTick)
        if (fraction - lastProgress >= 0.01) {
          lastProgress = fraction
          options.onProgress?.(fraction)
        }
        continue
      }
      tailFrames += BLOCK_FRAMES
      if (peak(left, right) < TAIL_SILENCE || tailFrames >= MAX_TAIL_SECONDS * options.sampleRate) {
        break
      }
    }

    chunks.push(encoder.flush())
    options.onProgress?.(1)
    return { mp3: concat(chunks), seconds: frames / options.sampleRate }
  } finally {
    synth.stopPlayer()
    synth.close()
  }
}

function toInt16(input: Float32Array, output: Int16Array): void {
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]))
    output[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
}

function peak(left: Float32Array, right: Float32Array): number {
  let max = 0
  for (let i = 0; i < left.length; i++) max = Math.max(max, Math.abs(left[i]), Math.abs(right[i]))
  return max
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
