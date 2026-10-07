import { describe, expect, it } from 'vitest'
import { parseSong, type Song } from '../../../model/song'
import { buildMidi, note, type TimedEvent } from '../../../model/__tests__/midiBuilder'
import { buildSheet, meterOf, quantizeChords, splitIntoValues, type SheetEvent } from '../sheetModel'

const Q = 480 // ticks per quarter in these tests

/** A one-track song (4/4 unless a time signature is given). */
function songOf(events: TimedEvent[], timeSig?: [number, number], fifths = 0): Song {
  const meta: TimedEvent[] = [{ tick: 0, type: 'keySignature', key: fifths, scale: 0, meta: true }]
  if (timeSig) {
    meta.push({
      tick: 0,
      type: 'timeSignature',
      numerator: timeSig[0],
      denominator: timeSig[1],
      metronome: 24,
      thirtyseconds: 8,
      meta: true
    })
  }
  return parseSong(buildMidi([meta, events]), 'x.mid')
}

/** Compact view: "C4:4" notes, "r:4" rests, "~" for ties, "!#" accidentals. */
const describe_ = (events: SheetEvent[]): string =>
  events
    .map((e) => {
      if (e.rest) return `r:${e.units}${e.fullBar ? 'bar' : ''}`
      const names = e.pitches.map((p) => {
        const letter = 'CDEFGAB'[p.step % 7]
        const acc = p.accidental === 'sharp' ? '!#' : p.accidental === 'flat' ? '!b' : p.accidental === 'natural' ? '!n' : ''
        return `${letter}${Math.floor(p.step / 7) - 1}${acc}`
      })
      return `${names.join('+')}:${e.units}${e.tieToNext ? '~' : ''}`
    })
    .join(' ')

describe('splitIntoValues', () => {
  it('uses one value when it fits the beat', () => {
    expect(splitIntoValues(0, 16)).toEqual([16])
    expect(splitIntoValues(0, 12)).toEqual([12])
    expect(splitIntoValues(4, 8)).toEqual([4])
    expect(splitIntoValues(0, 6)).toEqual([6])
  })

  it('splits notes that would hide the beat', () => {
    expect(splitIntoValues(2, 6)).toEqual([2, 2]) // quarter on the "and" → two tied eighths
    expect(splitIntoValues(1, 4)).toEqual([3]) // dotted eighth after a sixteenth: within the beat
    expect(splitIntoValues(4, 16)).toEqual([12]) // dotted half from beat 2
    expect(splitIntoValues(2, 16)).toEqual([2, 12]) // off the beat: eighth, then from beat 2
    expect(splitIntoValues(0, 5)).toEqual([4, 1])
  })

  it('writes rests by the beat', () => {
    const fourFour = meterOf(4, 4)
    expect(splitIntoValues(4, 16, fourFour, true)).toEqual([4, 8]) // quarter + half rest
    expect(splitIntoValues(6, 16, fourFour, true)).toEqual([2, 8])
    expect(splitIntoValues(0, 12, fourFour, true)).toEqual([8, 4]) // no dotted rests in 4/4
    expect(splitIntoValues(6, 12, meterOf(6, 8), true)).toEqual([6]) // a whole beat in 6/8
  })

  it('knows compound meters', () => {
    expect(meterOf(6, 8)).toEqual({ beat: 6, compound: true })
    expect(meterOf(3, 8)).toEqual({ beat: 2, compound: false })
    expect(meterOf(2, 2)).toEqual({ beat: 8, compound: false })
  })
})

describe('quantizeChords', () => {
  it('snaps to sixteenths and merges simultaneous notes into chords', () => {
    const chords = quantizeChords(
      [
        { midi: 60, tick: 5, durationTicks: 470, velocity: 90 },
        { midi: 64, tick: 0, durationTicks: 480, velocity: 90 },
        { midi: 67, tick: 470, durationTicks: 470, velocity: 90 }
      ],
      120
    )
    expect(chords.map((c) => [c.start, c.end, c.notes.map((n) => n.midi)])).toEqual([
      [0, 4, [60, 64]],
      [4, 8, [67]]
    ])
  })

  it('cuts a chord short where the next one starts', () => {
    const chords = quantizeChords(
      [
        { midi: 60, tick: 0, durationTicks: 1920, velocity: 90 },
        { midi: 62, tick: 480, durationTicks: 480, velocity: 90 }
      ],
      120
    )
    expect(chords.map((c) => [c.start, c.end])).toEqual([
      [0, 4],
      [4, 8]
    ])
  })
})

describe('buildSheet', () => {
  it('writes quarter notes and fills the rest of the bar', () => {
    const song = songOf([...note(0, 60, Q), ...note(Q, 62, Q), ...note(2 * Q, 64, Q)])
    const sheet = buildSheet(song, song.tracks[0])
    expect(sheet.clefs).toEqual(['treble'])
    expect(describe_(sheet.measures[0].staves[0])).toBe('C4:4 D4:4 E4:4 r:4')
  })

  it('ties a note across the barline', () => {
    const song = songOf([...note(3 * Q, 67, 2 * Q)])
    const sheet = buildSheet(song, song.tracks[0])
    expect(describe_(sheet.measures[0].staves[0])).toBe('r:8 r:4 G4:4~')
    expect(describe_(sheet.measures[1].staves[0])).toBe('G4:4 r:4 r:8')
  })

  it('writes off-beat notes with the beat visible', () => {
    // An eighth rest, then a quarter on the "and" of beat 1.
    const song = songOf([...note(Q / 2, 72, Q)])
    expect(describe_(buildSheet(song, song.tracks[0]).measures[0].staves[0])).toBe('r:2 C5:2~ C5:2 r:2 r:8')
  })

  it('uses dotted values in compound time', () => {
    const song = songOf([...note(0, 65, 3 * (Q / 2)), ...note(3 * (Q / 2), 67, 3 * (Q / 2))], [6, 8])
    const sheet = buildSheet(song, song.tracks[0])
    expect(describe_(sheet.measures[0].staves[0])).toBe('F4:6 G4:6')
  })

  it('shows an accidental once per bar and cancels it with a natural', () => {
    // G major: F♯ is in the key; F natural needs a natural, which carries; next bar resets.
    const melody = [66, 65, 65, 66, 65].flatMap((midi, i) => note(i * Q, midi, Q))
    const song = songOf(melody, undefined, 1)
    const sheet = buildSheet(song, song.tracks[0])
    expect(describe_(sheet.measures[0].staves[0])).toBe('F4:4 F4!n:4 F4:4 F4!#:4')
    expect(describe_(sheet.measures[1].staves[0])).toBe('F4!n:4 r:4 r:8')
  })

  it('marks empty bars with a whole-bar rest', () => {
    const song = songOf([...note(4 * Q * 2, 60, Q)], [3, 4])
    const sheet = buildSheet(song, song.tracks[0])
    expect(describe_(sheet.measures[0].staves[0])).toBe('r:12bar')
  })

  it('splits a wide-range part over a grand staff', () => {
    const song = songOf([...note(0, 36, Q), ...note(0, 84, Q)])
    const sheet = buildSheet(song, song.tracks[0])
    expect(sheet.clefs).toEqual(['treble', 'bass'])
    expect(describe_(sheet.measures[0].staves[0])).toBe('C6:4 r:4 r:8')
    expect(describe_(sheet.measures[0].staves[1])).toBe('C2:4 r:4 r:8')
  })
})
