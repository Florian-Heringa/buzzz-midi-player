import { describe, expect, it } from 'vitest'
import { accidentalFor, layoutStaff, spellPitch } from '../../notation/staffLayout'
import { enharmonicFifths, keyChoiceFromFile, keyName, withKeyChoice } from '../keys'
import { parseSong, type Song } from '../song'
import { buildMidi, note } from './midiBuilder'

describe('key interpretation', () => {
  it('starts from the key in the file', () => {
    expect(keyChoiceFromFile({ tick: 0, fifths: 1, mode: 'major' })).toEqual({ accidentals: 'sharps', mode: 'major' })
    expect(keyChoiceFromFile({ tick: 0, fifths: -3, mode: 'minor' })).toEqual({ accidentals: 'flats', mode: 'minor' })
    expect(keyChoiceFromFile({ tick: 0, fifths: 0, mode: 'major' })).toEqual({ accidentals: 'sharps', mode: 'major' })
  })

  it('switches to the enharmonic key only where one exists', () => {
    expect(enharmonicFifths(6, 'flats')).toBe(-6) // F♯ → G♭
    expect(enharmonicFifths(5, 'flats')).toBe(-7) // B → C♭
    expect(enharmonicFifths(-5, 'sharps')).toBe(7) // D♭ → C♯
    expect(enharmonicFifths(1, 'flats')).toBe(1) // G has no flat-side twin
    expect(enharmonicFifths(-3, 'sharps')).toBe(-3)
    expect(enharmonicFifths(0, 'flats')).toBe(0)
  })

  it('names keys for each choice', () => {
    const name = (fifths: number, accidentals: 'sharps' | 'flats', mode: 'major' | 'minor'): string =>
      keyName(enharmonicFifths(fifths, accidentals), mode)
    expect([name(6, 'sharps', 'major'), name(6, 'sharps', 'minor'), name(6, 'flats', 'major'), name(6, 'flats', 'minor')]).toEqual(
      ['F♯ major', 'D♯ minor', 'G♭ major', 'E♭ minor']
    )
    expect([name(1, 'sharps', 'major'), name(1, 'flats', 'minor')]).toEqual(['G major', 'E minor'])
  })

  it('applies the choice to every key signature of the song', () => {
    const song = parseSong(buildMidi([note(0, 60, 480)]), 'x.mid')
    const sixSharps = { ...song, keySignatures: [{ tick: 0, fifths: 6, mode: 'major' as const }] }
    expect(withKeyChoice(sixSharps, null)).toBe(sixSharps)
    expect(withKeyChoice(sixSharps, { accidentals: 'flats', mode: 'minor' }).keySignatures).toEqual([
      { tick: 0, fifths: -6, mode: 'minor' }
    ])
  })
})

describe('key signature space', () => {
  it('widens the clef area for keys with many accidentals', () => {
    const song = parseSong(buildMidi([note(0, 66, 480)]), 'x.mid')
    const withKey = (fifths: number): Song => ({ ...song, keySignatures: [{ tick: 0, fifths, mode: 'major' }] })
    expect(layoutStaff(withKey(1), song.tracks[0]).originX).toBe(90)
    expect(layoutStaff(withKey(-6), song.tracks[0]).originX).toBe(111)
    expect(layoutStaff(withKey(7), song.tracks[0]).originX).toBe(120)
  })
})

describe('spelling with a preference', () => {
  it('spells notes outside the key on the preferred side', () => {
    // G major: F♯ is in the key either way; C♯/D♭ follows the preference.
    expect(spellPitch(66, 1, 'flats')).toEqual({ step: 38, alteration: 1 }) // F♯4
    expect(spellPitch(61, 1, 'flats')).toEqual({ step: 36, alteration: -1 }) // D♭4
    expect(spellPitch(61, 1, 'sharps')).toEqual({ step: 35, alteration: 1 }) // C♯4
    expect(accidentalFor(spellPitch(70, 1, 'flats'), 1)).toBe('flat') // B♭ in G major
  })

  it('uses the key spelling for E♯, B♯ and C♭', () => {
    expect(spellPitch(65, 7)).toEqual({ step: 37, alteration: 1 }) // E♯4 in C♯ major
    expect(spellPitch(60, 7)).toEqual({ step: 34, alteration: 1 }) // B♯3 in C♯ major
    expect(spellPitch(71, -6)).toEqual({ step: 42, alteration: -1 }) // C♭5 in G♭ major
    expect(accidentalFor(spellPitch(65, 7), 7)).toBeNull()
  })
})
