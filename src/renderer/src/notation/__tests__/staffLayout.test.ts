import { describe, expect, it } from 'vitest'
import { measureCount, measureStarts } from '../../model/measures'
import { parseSong, type Track } from '../../model/song'
import { buildMidi, note } from '../../model/__tests__/midiBuilder'
import { accidentalFor, chooseClefs, keyAlteration, layoutStaff, spellPitch } from '../staffLayout'

const CHOIR = 52
const trackOf = (pitches: number[], program = CHOIR, name = 'T'): Track => ({
  id: 0,
  name,
  sourceChannel: 0,
  program,
  isDrum: false,
  notes: pitches.map((midi, i) => ({ midi, tick: i * 480, durationTicks: 480, velocity: 100 }))
})

describe('pitch spelling', () => {
  it('uses sharps in sharp and C keys, flats in flat keys', () => {
    expect(spellPitch(61, 0)).toEqual({ step: 35, alteration: 1 }) // C#4
    expect(spellPitch(61, -2)).toEqual({ step: 36, alteration: -1 }) // Db4
    expect(spellPitch(60, 0).step).toBe(35) // C4
    expect(spellPitch(71, 0).step).toBe(41) // B4
    expect(spellPitch(72, 0).step).toBe(42) // C5
  })

  it('knows which letters a key signature alters', () => {
    expect(keyAlteration(3, 1)).toBe(1) // F# in G major
    expect(keyAlteration(0, 1)).toBe(0) // C natural in G major
    expect(keyAlteration(6, -1)).toBe(-1) // Bb in F major
    expect(keyAlteration(2, -1)).toBe(0) // E natural in F major
  })

  it('draws accidentals only where the note differs from the key', () => {
    expect(accidentalFor(spellPitch(66, 1), 1)).toBeNull() // F# in G major
    expect(accidentalFor(spellPitch(65, 1), 1)).toBe('natural') // F natural in G major
    expect(accidentalFor(spellPitch(66, 0), 0)).toBe('sharp')
    expect(accidentalFor(spellPitch(70, -1), -1)).toBeNull() // Bb in F major
    expect(accidentalFor(spellPitch(63, -1), -1)).toBe('flat') // Eb in F major
  })
})

describe('chooseClefs', () => {
  it('picks a clef per voice range', () => {
    expect(chooseClefs(trackOf([67, 72, 76]))).toEqual(['treble']) // soprano
    expect(chooseClefs(trackOf([57, 60, 64]))).toEqual(['treble8vb']) // tenor
    expect(chooseClefs(trackOf([59, 62, 62, 64, 71]))).toEqual(['treble8vb']) // tenor around D4
    expect(chooseClefs(trackOf([62, 67, 69]))).toEqual(['treble']) // alto
    expect(chooseClefs(trackOf([43, 48, 52]))).toEqual(['bass']) // bass
    expect(chooseClefs(trackOf([36, 48, 72, 84], 0))).toEqual(['treble', 'bass']) // piano
  })

  it('uses the octave treble clef only for sung parts', () => {
    expect(chooseClefs(trackOf([55, 59, 62, 64], 0))).toEqual(['treble']) // piano, middle range
    expect(chooseClefs(trackOf([55, 59, 62, 64], 0, 'Tenor'))).toEqual(['treble8vb'])
    expect(chooseClefs(trackOf([40, 45, 50], 0))).toEqual(['bass'])
  })
})

describe('layoutStaff', () => {
  const song = parseSong(
    buildMidi([[...note(0, 64, 480), ...note(480, 77, 480), ...note(960, 60, 960)]]),
    's.mid'
  )
  const layout = layoutStaff(song, song.tracks[0], { lineGap: 10, pxPerBeat: 80, originX: 100 })
  const [e4, f5, c4] = layout.notes
  const staff = layout.staves[0]

  it('places notes on the staff by diatonic step', () => {
    expect(e4.y).toBe(staff.bottom) // E4 on the bottom treble line
    expect(f5.y).toBe(staff.top) // F5 on the top line
    expect(c4.y).toBe(staff.bottom + 10) // C4 one ledger below
    expect(c4.ledgers).toEqual([staff.bottom + 10])
    expect(e4.ledgers).toEqual([])
  })

  it('positions notes proportionally to time', () => {
    expect([e4.x, f5.x, c4.x]).toEqual([100, 180, 260])
    expect(c4.width).toBe(160)
  })

  it('puts barlines at every measure', () => {
    expect(measureStarts(song)).toEqual([0])
    const twoBars = parseSong(buildMidi([note(0, 60, 1920 * 2)]), 'x.mid')
    expect(measureStarts(twoBars)).toEqual([0, 1920])
    expect(measureCount(twoBars)).toBe(2)
  })

  it('leaves room above the staff for high notes', () => {
    const high = parseSong(buildMidi([note(0, 84, 480)]), 'x.mid') // C6: 2 ledgers above
    const highLayout = layoutStaff(high, high.tracks[0], { lineGap: 10 })
    expect(highLayout.notes[0].y).toBeGreaterThan(0)
    expect(highLayout.notes[0].ledgers).toHaveLength(2)
  })
})
