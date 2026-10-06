import { existsSync, readFileSync } from 'fs'
import { writeMidi, type MidiEvent } from 'midi-file'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { renderMp3 } from '../renderMp3'

const SOUNDFONT = resolve('resources/soundfonts/GeneralUser-GS.sf2')
const SAMPLE_RATE = 44_100

/** One C4 lasting 4 beats at 120 BPM (2 s), followed by nothing. */
function oneNoteMidi(): ArrayBuffer {
  const track: MidiEvent[] = [
    { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 500_000, meta: true },
    { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
    { deltaTime: 1920, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
    { deltaTime: 0, type: 'endOfTrack', meta: true }
  ]
  const bytes = new Uint8Array(
    writeMidi({ header: { format: 0, numTracks: 1, ticksPerBeat: 480 }, tracks: [track] })
  )
  return bytes.buffer
}

/** Counts MPEG audio frames (each 1152 samples) by walking frame headers. */
function mp3Frames(mp3: Uint8Array, bitrate: number): number {
  let frames = 0
  let i = 0
  while (i + 4 <= mp3.length) {
    if (mp3[i] === 0xff && (mp3[i + 1] & 0xe0) === 0xe0) {
      const padding = (mp3[i + 2] >> 1) & 1
      frames++
      i += Math.floor((144 * bitrate * 1000) / SAMPLE_RATE) + padding
    } else {
      i++
    }
  }
  return frames
}

describe.skipIf(!existsSync(SOUNDFONT))('renderMp3 (with the bundled SoundFont)', () => {
  const soundFont = existsSync(SOUNDFONT) ? readFileSync(SOUNDFONT) : Buffer.alloc(0)
  const sfBuffer = (): ArrayBuffer =>
    soundFont.buffer.slice(soundFont.byteOffset, soundFont.byteOffset + soundFont.byteLength) as ArrayBuffer

  const render = (tempoFactor: number) =>
    renderMp3({
      soundFont: sfBuffer(),
      midi: oneNoteMidi(),
      durationTicks: 1920,
      tempoFactor,
      bitrate: 128,
      sampleRate: SAMPLE_RATE
    })

  it('renders the song plus a short tail and reports progress', { timeout: 60_000 }, async () => {
    const progress: number[] = []
    const { mp3, seconds } = await renderMp3({
      soundFont: sfBuffer(),
      midi: oneNoteMidi(),
      durationTicks: 1920,
      tempoFactor: 1,
      bitrate: 128,
      sampleRate: SAMPLE_RATE,
      onProgress: (f) => progress.push(f)
    })
    expect(seconds).toBeGreaterThan(2)
    expect(seconds).toBeLessThan(2 + 4.2)
    expect(progress.at(-1)).toBe(1)
    // Encoded audio covers the rendered length (within the encoder's frame padding).
    const encodedSeconds = (mp3Frames(mp3, 128) * 1152) / SAMPLE_RATE
    expect(Math.abs(encodedSeconds - seconds)).toBeLessThan(0.2)
  })

  it('stretches the song when slowed down', { timeout: 60_000 }, async () => {
    const normal = await render(1)
    const slow = await render(0.5)
    // The note part doubles from 2 s to 4 s; tails are similar.
    expect(slow.seconds - normal.seconds).toBeGreaterThan(1.7)
    expect(slow.seconds - normal.seconds).toBeLessThan(2.3)
  })
})
