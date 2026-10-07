import type { Accidentals } from '../model/keys'
import { measureStarts } from '../model/measures'
import type { KeySignature, Song, Track } from '../model/song'

export type Clef = 'treble' | 'treble8vb' | 'bass'
export type Accidental = 'sharp' | 'flat' | 'natural'

/** Diatonic letter index: C=0 … B=6. */
type Letter = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Diatonic step (octave * 7 + letter) of each clef's bottom staff line. */
const BOTTOM_LINE_STEP: Record<Clef, number> = {
  treble: 37, // E4
  treble8vb: 30, // E3 (sounds an octave below written treble)
  bass: 25 // G2
}

// Pitch class → [letter, alteration] when spelling with sharps or with flats.
const SHARP_SPELLING: [Letter, number][] = [
  [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]
]
const FLAT_SPELLING: [Letter, number][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]
]
const SHARP_ORDER: Letter[] = [3, 0, 4, 1, 5, 2, 6] // F C G D A E B
const FLAT_ORDER: Letter[] = [6, 2, 5, 1, 4, 0, 3] // B E A D G C F

/** Staff offsets (half line gaps above the bottom line) of key signature glyphs in treble clef. */
const TREBLE_SHARP_OFFSETS = [8, 5, 9, 6, 3, 7, 4]
const TREBLE_FLAT_OFFSETS = [4, 7, 3, 6, 2, 5, 1]

export interface SpelledPitch {
  /** Diatonic step: octave * 7 + letter, where C4 (MIDI 60) is step 35. */
  step: number
  alteration: number
}

/** Pitch class of each natural letter, C to B. */
const NATURAL_PITCH_CLASS = [0, 2, 4, 5, 7, 9, 11]

/**
 * Spells a MIDI note. Notes in the key use the key's spelling (including E♯, B♯, C♭ and F♭
 * in extreme keys); other notes use sharps or flats as preferred, by default the key's side.
 */
export function spellPitch(midi: number, fifths: number, prefer?: Accidentals): SpelledPitch {
  const pitchClass = midi % 12
  for (let letter = 0; letter < 7; letter++) {
    const alteration = keyAlteration(letter, fifths)
    if ((NATURAL_PITCH_CLASS[letter] + alteration + 12) % 12 === pitchClass) {
      return fromLetter(midi, letter, alteration)
    }
  }
  const useFlats = prefer ? prefer === 'flats' : fifths < 0
  const [letter, alteration] = (useFlats ? FLAT_SPELLING : SHARP_SPELLING)[pitchClass]
  return fromLetter(midi, letter, alteration)
}

/** Diatonic step from the letter and alteration (B♯3 sounds as C4 but sits on B3's step). */
function fromLetter(midi: number, letter: number, alteration: number): SpelledPitch {
  return { step: Math.floor((midi - alteration) / 12) * 7 + letter, alteration }
}

/** Alteration the key signature applies to a letter. */
export function keyAlteration(letter: number, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter as Letter) ? 1 : 0
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter as Letter) ? -1 : 0
  return 0
}

/** The accidental to draw, or null when the key signature already implies the alteration. */
export function accidentalFor(pitch: SpelledPitch, fifths: number): Accidental | null {
  if (pitch.alteration === keyAlteration(pitch.step % 7, fifths)) return null
  return pitch.alteration > 0 ? 'sharp' : pitch.alteration < 0 ? 'flat' : 'natural'
}

/** GM programs that are voices: Choir Aahs, Voice Oohs, Synth Voice, Lead 6 (voice), Pad 4 (choir). */
const VOICE_PROGRAMS = new Set([52, 53, 54, 85, 91])
const VOICE_NAME = /tenor|bariton|voice|vocal|choir|zang|stem/i

/** Whether a track is a sung part, which gets the octave treble clef in the tenor range. */
export function isVocalTrack(track: Track): boolean {
  return VOICE_PROGRAMS.has(track.program) || VOICE_NAME.test(track.name)
}

/** One clef for single-line ranges; treble + bass for wide (keyboard-like) ranges. */
export function chooseClefs(track: Track): Clef[] {
  if (track.notes.length === 0) return ['treble']
  const pitches = track.notes.map((n) => n.midi).sort((a, b) => a - b)
  const low = pitches[0]
  const high = pitches[pitches.length - 1]
  if (high - low > 28 && low < 55 && high > 64) return ['treble', 'bass']
  const median = pitches[Math.floor(pitches.length / 2)]
  if (isVocalTrack(track)) {
    if (median >= 64) return ['treble']
    if (median >= 53) return ['treble8vb']
    return ['bass']
  }
  return median >= 59 ? ['treble'] : ['bass']
}

export function keySignatureAt(song: Song, tick: number): KeySignature {
  let current = song.keySignatures[0]
  for (const key of song.keySignatures) if (key.tick <= tick) current = key
  return current
}

export interface StaffGeometry {
  clef: Clef
  /** y of the top staff line. */
  top: number
  /** y of the bottom staff line. */
  bottom: number
}

export interface LaidOutNote {
  index: number
  tick: number
  endTick: number
  x: number
  width: number
  y: number
  staff: number
  accidental: Accidental | null
  /** y positions of ledger lines this note needs. */
  ledgers: number[]
}

export interface StaffLayout {
  width: number
  height: number
  lineGap: number
  pxPerTick: number
  /** Horizontal offset of tick 0, leaving room for clef and key signature. */
  originX: number
  staves: StaffGeometry[]
  notes: LaidOutNote[]
  barlines: { x: number; number: number }[]
  /** x of every beat that isn't on a barline. */
  beatlines: number[]
  keySignature: { staff: number; accidental: 'sharp' | 'flat'; y: number }[]
}

export interface LayoutOptions {
  /** Distance between staff lines in px. */
  lineGap?: number
  /** Horizontal space per quarter note in px. */
  pxPerBeat?: number
  /** Width reserved before tick 0 (clef + key signature). */
  originX?: number
  /** How to spell notes outside the key; defaults to the key's own side. */
  accidentals?: Accidentals
}

/** Positions a track's notes on one or two staves, proportionally to time. */
export function layoutStaff(song: Song, track: Track, options: LayoutOptions = {}): StaffLayout {
  const lineGap = options.lineGap ?? 10
  const pxPerTick = (options.pxPerBeat ?? 80) / song.ppq
  const half = lineGap / 2
  const clefs = chooseClefs(track)
  const fifths = song.keySignatures[0].fifths
  // Room for the clef plus every accidental of the key signature (StaffView spaces them
  // 0.85 line gaps apart, starting 3.6 gaps in); never less than the usual 90px.
  const originX =
    options.originX ?? Math.max(90, Math.ceil(lineGap * (3.6 + 0.85 * Math.abs(fifths) + 2.4)))

  // Notes are assigned to a staff first so each staff can grow to fit its ledger lines.
  const staffOf = (midi: number): number => (clefs.length === 2 && midi < 60 ? 1 : 0)
  const spelled = track.notes.map((note) =>
    spellPitch(note.midi, keySignatureAt(song, note.tick).fifths, options.accidentals)
  )

  // Vertical extent per staff, in half line gaps above the bottom line.
  // The octave clef's "8" hangs below the staff, so reserve room for it.
  const extent = clefs.map((clef) => ({ min: clef === 'treble8vb' ? -3 : 0, max: 8 }))
  track.notes.forEach((note, i) => {
    const staff = staffOf(note.midi)
    const offset = spelled[i].step - BOTTOM_LINE_STEP[clefs[staff]]
    extent[staff].min = Math.min(extent[staff].min, offset)
    extent[staff].max = Math.max(extent[staff].max, offset)
  })

  const margin = lineGap * 2
  const staves: StaffGeometry[] = []
  // The first row holds measure numbers.
  let y = margin + lineGap
  clefs.forEach((clef, i) => {
    const top = y + (extent[i].max - 8) * half
    const bottom = top + 4 * lineGap
    staves.push({ clef, top, bottom })
    y = bottom - extent[i].min * half + margin * 1.5
  })
  const height = y - margin * 0.5

  const notes: LaidOutNote[] = track.notes.map((note, index) => {
    const staff = staffOf(note.midi)
    const offset = spelled[index].step - BOTTOM_LINE_STEP[clefs[staff]]
    const ledgers: number[] = []
    for (let o = -2; o >= offset; o -= 2) ledgers.push(staves[staff].bottom - o * half)
    for (let o = 10; o <= offset; o += 2) ledgers.push(staves[staff].bottom - o * half)
    return {
      index,
      tick: note.tick,
      endTick: note.tick + note.durationTicks,
      x: originX + note.tick * pxPerTick,
      width: Math.max(note.durationTicks * pxPerTick, 2),
      y: staves[staff].bottom - offset * half,
      staff,
      accidental: accidentalFor(spelled[index], keySignatureAt(song, note.tick).fifths),
      ledgers
    }
  })

  const barlines = measureStarts(song).map((tick, i) => ({
    x: originX + tick * pxPerTick,
    number: i + 1
  }))

  // Beats inside each measure (not on a barline), for themes that draw a beat grid.
  const beatlines: number[] = []
  song.timeSignatures.forEach((ts, i) => {
    const end = song.timeSignatures[i + 1]?.tick ?? song.durationTicks
    const beat = (song.ppq * 4) / ts.denominator
    for (let n = 0, tick = ts.tick; tick < end; n++, tick += beat) {
      if (n % ts.numerator !== 0) beatlines.push(originX + tick * pxPerTick)
    }
  })

  const keySignature: StaffLayout['keySignature'] = []
  staves.forEach((staff, staffIndex) => {
    const accidental = fifths >= 0 ? 'sharp' : 'flat'
    const offsets = (fifths >= 0 ? TREBLE_SHARP_OFFSETS : TREBLE_FLAT_OFFSETS).slice(0, Math.abs(fifths))
    const shift = staff.clef === 'bass' ? -2 : 0
    for (const offset of offsets) {
      keySignature.push({ staff: staffIndex, accidental, y: staff.bottom - (offset + shift) * half })
    }
  })

  return {
    width: originX + song.durationTicks * pxPerTick + lineGap * 4,
    height,
    lineGap,
    pxPerTick,
    originX,
    staves,
    notes,
    barlines,
    beatlines,
    keySignature
  }
}
