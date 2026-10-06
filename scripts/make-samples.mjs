// Generates sample MIDI files in samples/ for manual testing.
// Usage: node scripts/make-samples.mjs
import { mkdirSync, writeFileSync } from 'fs'
import { writeMidi } from 'midi-file'

const PPQ = 480
const BEAT = PPQ

/** Converts absolutely-timed events to a delta-timed MIDI track. */
function toTrack(events) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || order(a) - order(b))
  let last = 0
  const track = sorted.map(({ tick, ...rest }) => {
    const deltaTime = tick - last
    last = tick
    return { ...rest, deltaTime }
  })
  track.push({ deltaTime: 0, type: 'endOfTrack', meta: true })
  return track
}

// Note-offs before note-ons on the same tick so repeated pitches re-trigger cleanly.
const order = (event) => (event.type === 'noteOff' ? 0 : 1)

/** Builds a voice track from [midi, beats] pairs; midi null is a rest. */
function voice(name, channel, programNumber, notes) {
  const events = [
    { tick: 0, type: 'trackName', text: name, meta: true },
    { tick: 0, type: 'programChange', channel, programNumber }
  ]
  let tick = 0
  for (const [midi, beats] of notes) {
    const length = beats * BEAT
    if (midi !== null) {
      events.push({ tick, type: 'noteOn', channel, noteNumber: midi, velocity: 90 })
      events.push({ tick: tick + length, type: 'noteOff', channel, noteNumber: midi, velocity: 0 })
    }
    tick += length
  }
  return toTrack(events)
}

// A short chorale in G major, 4/4: 8 bars, with a ritardando into the last bar.
const soprano = [
  [67, 1], [67, 1], [69, 1], [71, 1],
  [72, 2], [71, 2],
  [69, 1], [71, 1], [72, 1], [74, 1],
  [71, 3], [null, 1],
  [71, 1], [72, 1], [74, 1], [76, 1],
  [74, 2], [72, 1], [71, 1],
  [69, 1.5], [71, 0.5], [69, 1], [66, 1],
  [67, 4]
]
const alto = [
  [62, 2], [66, 1], [67, 1],
  [67, 2], [67, 2],
  [66, 1], [67, 1], [69, 2],
  [67, 3], [null, 1],
  [67, 2], [69, 1], [67, 1],
  [66, 2], [67, 2],
  [64, 2], [62, 2],
  [62, 4]
]
const tenor = [
  [59, 2], [62, 1], [62, 1],
  [64, 2], [62, 2],
  [62, 2], [64, 1], [66, 1],
  [62, 3], [null, 1],
  [62, 2], [64, 1], [71, 1],
  [69, 2], [64, 1], [62, 1],
  [60, 2], [60, 1], [57, 1],
  [59, 4]
]
const bass = [
  [43, 2], [50, 1], [55, 1],
  [52, 2], [55, 2],
  [50, 2], [48, 1], [50, 1],
  [55, 3], [null, 1],
  [55, 2], [53, 1], [52, 1],
  [50, 2], [52, 1], [55, 1],
  [48, 2], [50, 2],
  [43, 4]
]

// Piano: block chords on beats 1 and 3, following the bass.
function pianoTrack() {
  const channel = 4
  const events = [
    { tick: 0, type: 'trackName', text: 'Piano', meta: true },
    { tick: 0, type: 'programChange', channel, programNumber: 0 }
  ]
  const chords = [
    [55, 59, 62], [55, 59, 62], [60, 64, 67], [55, 59, 62],
    [62, 66, 69], [62, 66, 69], [55, 59, 62], [55, 59, 62],
    [55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 64],
    [60, 64, 67], [62, 66, 69], [55, 59, 62], [55, 59, 62]
  ]
  chords.forEach((chord, i) => {
    const tick = i * 2 * BEAT
    for (const midi of chord) {
      events.push({ tick, type: 'noteOn', channel, noteNumber: midi, velocity: 60 })
      events.push({ tick: tick + 2 * BEAT, type: 'noteOff', channel, noteNumber: midi, velocity: 0 })
    }
  })
  return toTrack(events)
}

const bar = 4 * BEAT
const conductor = toTrack([
  { tick: 0, type: 'trackName', text: 'Chorale', meta: true },
  { tick: 0, type: 'timeSignature', numerator: 4, denominator: 4, metronome: 24, thirtyseconds: 8, meta: true },
  { tick: 0, type: 'keySignature', key: 1, scale: 0, meta: true },
  { tick: 0, type: 'setTempo', microsecondsPerBeat: 750_000, meta: true }, // 80 BPM
  { tick: 6 * bar, type: 'setTempo', microsecondsPerBeat: 857_143, meta: true }, // 70 BPM
  { tick: 7 * bar, type: 'setTempo', microsecondsPerBeat: 1_000_000, meta: true } // 60 BPM
])

const CHOIR = 52
const midi = {
  header: { format: 1, numTracks: 6, ticksPerBeat: PPQ },
  tracks: [
    conductor,
    voice('Soprano', 0, CHOIR, soprano),
    voice('Alto', 1, CHOIR, alto),
    voice('Tenor', 2, CHOIR, tenor),
    voice('Bass', 3, CHOIR, bass),
    pianoTrack()
  ]
}

mkdirSync('samples', { recursive: true })
writeFileSync('samples/satb-chorale.mid', Buffer.from(writeMidi(midi)))
console.log('Wrote samples/satb-chorale.mid')
