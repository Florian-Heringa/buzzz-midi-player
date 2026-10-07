import type { KeySignature, Song } from './song'

export type Accidentals = 'sharps' | 'flats'
export type Mode = 'major' | 'minor'

/** Where the key comes from: the file's key signature or the estimate from the notes. */
export type KeySource = 'file' | 'estimate'

/** How the user wants the song's key read: sharp or flat side, and major or minor. */
export interface KeyChoice {
  accidentals: Accidentals
  mode: Mode
  /** Defaults to 'file'. */
  source?: KeySource
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

/**
 * True when the file has a key signature and the notes suggest a different one (not just its
 * enharmonic twin or relative major/minor, which the sharps/flats and mode choices cover).
 */
export function estimateDiffersFromFile(song: Song): boolean {
  const fileKey = song.keySignatures[0]
  const estimate = song.estimatedKey
  if (!estimate || fileKey.estimated) return false
  return enharmonicFifths(estimate.fifths, 'sharps') !== enharmonicFifths(fileKey.fifths, 'sharps')
}

/** The key a source starts from: the file's first key signature or the estimate. */
export function sourceKey(song: Song, source: KeySource): KeySignature {
  if (source === 'estimate' && song.estimatedKey) return { tick: 0, ...song.estimatedKey, estimated: true }
  return song.keySignatures[0]
}

/** The song with every key signature read according to the choice (or unchanged without one). */
export function withKeyChoice(song: Song, choice: KeyChoice | null): Song {
  if (!choice) return song
  if (choice.source === 'estimate' && song.estimatedKey) {
    // The estimate covers the whole song, replacing the file's key signatures.
    return {
      ...song,
      keySignatures: [
        {
          tick: 0,
          fifths: enharmonicFifths(song.estimatedKey.fifths, choice.accidentals),
          mode: choice.mode,
          estimated: true
        }
      ]
    }
  }
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
