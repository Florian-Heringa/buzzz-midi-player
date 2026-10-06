// Loaded into the AudioWorklet after js-synthesizer.worklet.js.
//
// FluidSynth's player resets the synth when it starts and replays volume/pan/program events
// on seek, which would overwrite live mixer changes. This hook rewrites those player events
// to the current mixer values, passed in as `data.channels` (index = channel).
const CONTROLLER = 0xb0
const PROGRAM_CHANGE = 0xc0
const CC_VOLUME = 7
const CC_PAN = 10

globalThis.midiPlayerMixerHook = function (_synth, type, event, data) {
  const state = data && data.channels[event.getChannel()]
  if (!state) return false
  if (type === CONTROLLER) {
    const control = event.getControl()
    if (control === CC_VOLUME) event.setValue(state.volume)
    else if (control === CC_PAN) event.setValue(state.pan)
  } else if (type === PROGRAM_CHANGE) {
    event.setProgram(state.program)
  }
  // Let FluidSynth process the (rewritten) event normally.
  return false
}
