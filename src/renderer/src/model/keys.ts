import type { KeySignature, Song } from './song'

export type Accidentals = 'sharps' | 'flats'
export type Mode = 'major' | 'minor'

/** How the user wants the song's key read: sharp or flat side, and major or minor. */
export interface KeyChoice {
  accidentals: Accidentals
  mode: Mode
}

/** The interpretation that matches the key signature in the file. */
export function keyChoiceFromFile(key: KeySignature): KeyChoice {
  return { accidentals: key.fifths < 0 ? 'flats' : 'sharps', mode: key.mode }
}

/**
 * Number of sharps (+) or flats (−) after choosing a side. Keys with an enharmonic twin
 * switch signature (B ↔ C♭, F♯ ↔ G♭, C♯ ↔ D♭); other keys keep theirs.
 */
export function enharmonicFifths(fifths: number, accidentals: Accidentals): number {
  if (accidentals === 'flats' && fifths >= 5) return fifths - 12
  if (accidentals === 'sharps' && fifths <= -5) return fifths + 12
  return fifths
}

/** The song with every key signature read according to the choice (or unchanged without one). */
export function withKeyChoice(song: Song, choice: KeyChoice | null): Song {
  if (!choice) return song
  return {
    ...song,
    keySignatures: song.keySignatures.map((key) => ({
      ...key,
      fifths: enharmonicFifths(key.fifths, choice.accidentals),
      mode: choice.mode
    }))
  }
}

const MAJOR_SHARP = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']
const MAJOR_FLAT = ['C', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭']
const MINOR_SHARP = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯']
const MINOR_FLAT = ['A', 'D', 'G', 'C', 'F', 'B♭', 'E♭', 'A♭']

/** Key name, e.g. (1, 'major') → "G major", (−6, 'minor') → "E♭ minor". */
export function keyName(fifths: number, mode: Mode): string {
  const names =
    mode === 'major'
      ? fifths >= 0
        ? MAJOR_SHARP
        : MAJOR_FLAT
      : fifths >= 0
        ? MINOR_SHARP
        : MINOR_FLAT
  return `${names[Math.min(Math.abs(fifths), 7)]} ${mode}`
}
