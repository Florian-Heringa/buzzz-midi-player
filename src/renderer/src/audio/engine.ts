import { AudioWorkletNodeSynthesizer } from 'js-synthesizer'
import fluidsynthUrl from 'js-synthesizer/externals/libfluidsynth-2.4.6.js?url'
import synthWorkletUrl from 'js-synthesizer/dist/js-synthesizer.worklet.min.js?url'
// no-inline: a data: URL would be blocked by the page's Content-Security-Policy.
import mixerHookUrl from './worklet/mixerHook.js?url&no-inline'
import type { ChannelState } from './mixer'

/** Name of the hook function that worklet/mixerHook.js defines on the worklet global scope. */
const MIXER_HOOK = 'midiPlayerMixerHook'
/** `PlayerSetTempoType.Internal`: tempo value is a multiplier of the file's own tempo. */
const TEMPO_TYPE_INTERNAL = 0

/**
 * Live playback through FluidSynth (WASM) running in an AudioWorklet.
 *
 * FluidSynth quirks this class works around (verified with a prototype):
 * - a seek issued right after `playPlayer()` is ignored, so position is always set before play;
 * - seeking does not silence sounding notes, so all notes are released first;
 * - the player resets channel settings when it starts (see worklet/mixerHook.js).
 */
export class AudioEngine {
  private readonly context: AudioContext
  private readonly synth: AudioWorkletNodeSynthesizer
  private channels: readonly (ChannelState | undefined)[] = []
  private tempoFactor = 1
  private playing = false
  private hasSong = false

  private constructor(context: AudioContext, synth: AudioWorkletNodeSynthesizer) {
    this.context = context
    this.synth = synth
  }

  static async create(soundFont: ArrayBuffer): Promise<AudioEngine> {
    const context = new AudioContext({ latencyHint: 'playback' })
    await context.audioWorklet.addModule(fluidsynthUrl)
    await context.audioWorklet.addModule(synthWorkletUrl)
    await context.audioWorklet.addModule(mixerHookUrl)

    const synth = new AudioWorkletNodeSynthesizer()
    synth.init(context.sampleRate)
    const node = synth.createAudioNode(context)
    node.connect(context.destination)
    await synth.loadSFont(soundFont)
    return new AudioEngine(context, synth)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** Replaces the player's song. Playback stops and the position returns to the start. */
  async loadSong(playbackMidi: Uint8Array, channels: readonly (ChannelState | undefined)[]): Promise<void> {
    this.stopSound()
    await this.synth.resetPlayer()
    // Copy into a standalone ArrayBuffer: the message to the worklet transfers whole buffers.
    await this.synth.addSMFDataToPlayer(playbackMidi.slice().buffer)
    this.hasSong = true
    await this.setChannels(channels)
  }

  async play(fromTick: number): Promise<void> {
    if (!this.hasSong || this.playing) return
    await this.context.resume()
    this.synth.seekPlayer(Math.max(0, Math.round(fromTick)))
    await this.synth.playPlayer()
    this.synth.setPlayerTempo(TEMPO_TYPE_INTERNAL, this.tempoFactor)
    this.playing = true
  }

  /** Pauses playback and resolves with the tick where it stopped. */
  async pause(): Promise<number> {
    const tick = await this.currentTick()
    this.stopSound()
    return tick
  }

  /** Moves the play position. While paused, the next `play` call passes the position instead. */
  seek(tick: number): void {
    if (!this.playing) return
    this.synth.midiAllNotesOff()
    this.synth.seekPlayer(Math.max(0, Math.round(tick)))
  }

  currentTick(): Promise<number> {
    return this.synth.retrievePlayerCurrentTick()
  }

  setTempoFactor(factor: number): void {
    this.tempoFactor = factor
    if (this.playing) this.synth.setPlayerTempo(TEMPO_TYPE_INTERNAL, factor)
  }

  /** Applies mixer state immediately and to events the player sends later. */
  async setChannels(channels: readonly (ChannelState | undefined)[]): Promise<void> {
    const previous = this.channels
    this.channels = channels
    channels.forEach((state, channel) => {
      if (!state) return
      const old = previous[channel]
      if (old?.volume !== state.volume) this.synth.midiControl(channel, 7, state.volume)
      if (old?.pan !== state.pan) this.synth.midiControl(channel, 10, state.pan)
      if (old?.program !== state.program) this.synth.midiProgramChange(channel, state.program)
    })
    await this.synth.hookPlayerMIDIEventsByName(MIXER_HOOK, { channels })
  }

  async close(): Promise<void> {
    this.stopSound()
    this.synth.close()
    await this.context.close()
  }

  private stopSound(): void {
    if (this.playing) this.synth.stopPlayer()
    this.playing = false
    this.synth.midiAllNotesOff()
  }
}
