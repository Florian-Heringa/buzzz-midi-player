import type { Accidentals } from '../../model/keys'
import { measureStarts } from '../../model/measures'
import type { Note, Song, Track } from '../../model/song'
import {
  chooseClefs,
  keyAlteration,
  keySignatureAt,
  spellPitch,
  type Accidental,
  type Clef
} from '../staffLayout'

/**
 * Turns a track into notation: notes snapped to a grid, grouped into chords and bars, gaps
 * filled with rests, lengths split into standard note values (tied where needed) and
 * accidentals that carry through the bar. Rendering (VexFlow) happens elsewhere.
 */

/** Grid units per quarter note: 4 = sixteenth-note grid. */
export const UNITS_PER_QUARTER = 4

/** A pitch in a chord, spelled for the staff. */
export interface SheetPitch {
  midi: number
  /** Diatonic step (octave * 7 + letter), C4 = 35. */
  step: number
  alteration: number
  /** Accidental to draw (only on the first piece of a tied note). */
  accidental: Accidental | null
}

/** One notated note/chord or rest with a single note value (possibly dotted). */
export interface SheetEvent {
  /** Start in ticks (quantized). */
  tick: number
  /** Length in grid units: 16 whole … 1 sixteenth; 12, 6, 3 are dotted. */
  units: number
  rest: boolean
  /** Pitches, low to high; empty for rests. */
  pitches: SheetPitch[]
  /** Tied to the next event on this staff. */
  tieToNext: boolean
  /** A rest filling a whole empty bar (drawn centered, whatever the time signature). */
  fullBar?: boolean
}

export interface SheetMeasure {
  index: number
  startTick: number
  endTick: number
  numerator: number
  denominator: number
  /** Key signature in effect (sharps +, flats −). */
  fifths: number
  /** Events per staff (one staff, or treble + bass for a grand staff). */
  staves: SheetEvent[][]
}

export interface Sheet {
  clefs: Clef[]
  measures: SheetMeasure[]
  /** Ticks per grid unit. */
  unitTicks: number
}

/** Note values in grid units, longest first: 16 whole, 12 dotted half, … 1 sixteenth. */
const NOTE_VALUES = [16, 12, 8, 6, 4, 3, 2, 1]
const DOTTED = new Set([12, 6, 3])

/** The beat a bar is felt in, in grid units: a dotted quarter in compound meters like 6/8. */
export interface Meter {
  beat: number
  compound: boolean
}

export function meterOf(numerator: number, denominator: number): Meter {
  const unit = (4 * UNITS_PER_QUARTER) / denominator
  const compound = denominator === 8 && numerator % 3 === 0 && numerator > 3
  return { beat: compound ? unit * 3 : unit, compound }
}

/**
 * Whether a value may be written as one note/rest starting at `position` (relative to the
 * bar), so the beat stays visible:
 * - a note up to a beat long stays within its beat; a longer one starts on a beat;
 * - rests are stricter: plain values on their own multiple (beats 2–4 of 4/4 rest as quarter
 *   + half, not a dotted half), dotted rests only as whole beats of a compound meter.
 */
function fits(value: number, position: number, meter: Meter, rest: boolean): boolean {
  const { beat } = meter
  if (rest) {
    if (DOTTED.has(value)) return meter.compound && value % beat === 0 && position % beat === 0
    return position % value === 0 && (value <= beat ? Math.floor(position / beat) === Math.floor((position + value - 1) / beat) : true)
  }
  if (value <= beat) return Math.floor(position / beat) === Math.floor((position + value - 1) / beat)
  return position % beat === 0
}

/**
 * Splits a span of a bar into note values, longest first wherever the value fits the beat
 * (so a quarter note off the beat becomes two tied eighths).
 */
export function splitIntoValues(
  start: number,
  end: number,
  meter: Meter = meterOf(4, 4),
  rest = false
): number[] {
  const values: number[] = []
  let position = start
  while (position < end) {
    const value =
      NOTE_VALUES.find((v) => position + v <= end && fits(v, position, meter, rest)) ?? 1
    values.push(value)
    position += value
  }
  return values
}

interface Chord {
  start: number
  end: number
  notes: Note[]
}

/**
 * Snaps notes to the grid and reduces them to one voice: notes starting together form a
 * chord, and a chord ends where the next one starts.
 */
export function quantizeChords(notes: readonly Note[], unitTicks: number): Chord[] {
  const byStart = new Map<number, Chord>()
  for (const note of notes) {
    const start = Math.round(note.tick / unitTicks)
    const end = Math.max(start + 1, Math.round((note.tick + note.durationTicks) / unitTicks))
    const chord = byStart.get(start)
    if (chord) {
      chord.end = Math.max(chord.end, end)
      if (!chord.notes.some((n) => n.midi === note.midi)) chord.notes.push(note)
    } else {
      byStart.set(start, { start, end, notes: [note] })
    }
  }
  const chords = [...byStart.values()].sort((a, b) => a.start - b.start)
  chords.forEach((chord, i) => {
    const next = chords[i + 1]
    if (next) chord.end = Math.min(chord.end, next.start)
    chord.notes.sort((a, b) => a.midi - b.midi)
  })
  return chords
}

export interface SheetOptions {
  /** How to spell notes outside the key. */
  accidentals?: Accidentals
}

/** Builds the notation for one track of a song. */
export function buildSheet(song: Song, track: Track, options: SheetOptions = {}): Sheet {
  const unitTicks = song.ppq / UNITS_PER_QUARTER
  const clefs = chooseClefs(track)
  const staffOf = (midi: number): number => (clefs.length === 2 && midi < 60 ? 1 : 0)

  // Bars in grid units, from the time signatures.
  const starts = measureStarts(song)
  const timeSigAt = (tick: number): { numerator: number; denominator: number } => {
    let current = song.timeSignatures[0]
    for (const ts of song.timeSignatures) if (ts.tick <= tick) current = ts
    return current
  }
  const lastNoteEnd = Math.ceil(
    Math.max(0, ...track.notes.map((n) => n.tick + n.durationTicks)) / unitTicks
  )
  const bars = starts.map((tick, index) => {
    const ts = timeSigAt(tick)
    const start = Math.round(tick / unitTicks)
    const length = (ts.numerator * 4 * UNITS_PER_QUARTER) / ts.denominator
    return { index, start, end: start + length, ...ts }
  })
  // The quantized notes may run past the song's last barline: add bars to fit them.
  while (bars.length > 0 && bars[bars.length - 1].end < lastNoteEnd) {
    const last = bars[bars.length - 1]
    bars.push({ ...last, index: last.index + 1, start: last.end, end: last.end * 2 - last.start })
  }

  const staffChords = clefs.map((_, staff) =>
    quantizeChords(
      track.notes.filter((n) => staffOf(n.midi) === staff),
      unitTicks
    )
  )

  const measures: SheetMeasure[] = bars.map((bar) => {
    const startTick = bar.start * unitTicks
    const fifths = keySignatureAt(song, startTick).fifths
    const meter = meterOf(bar.numerator, bar.denominator)
    const staves = staffChords.map((chords) => {
      const events: SheetEvent[] = []
      // Accidentals carry through the bar on the same staff position.
      const carried = new Map<number, number>()
      const addRests = (from: number, to: number): void => {
        let position = from
        for (const value of splitIntoValues(from - bar.start, to - bar.start, meter, true)) {
          events.push({ tick: position * unitTicks, units: value, rest: true, pitches: [], tieToNext: false })
          position += value
        }
      }

      let cursor = bar.start
      for (const chord of chords) {
        if (chord.end <= bar.start || chord.start >= bar.end) continue
        const from = Math.max(chord.start, bar.start)
        const to = Math.min(chord.end, bar.end)
        if (from > cursor) addRests(cursor, from)
        const continuesFromPrevious = chord.start < bar.start
        const pitches: SheetPitch[] = chord.notes.map((note) => {
          const spelled = spellPitch(note.midi, fifths, options.accidentals)
          let accidental: Accidental | null = null
          if (!continuesFromPrevious) {
            const expected = carried.get(spelled.step) ?? keyAlteration(spelled.step % 7, fifths)
            if (spelled.alteration !== expected) {
              accidental =
                spelled.alteration > 0 ? 'sharp' : spelled.alteration < 0 ? 'flat' : 'natural'
            }
            carried.set(spelled.step, spelled.alteration)
          }
          return { midi: note.midi, ...spelled, accidental }
        })
        const values = splitIntoValues(from - bar.start, to - bar.start, meter)
        let position = from
        values.forEach((value, i) => {
          events.push({
            tick: position * unitTicks,
            units: value,
            rest: false,
            pitches: i === 0 ? pitches : pitches.map((p) => ({ ...p, accidental: null })),
            tieToNext: i < values.length - 1 || (to === bar.end && chord.end > bar.end)
          })
          position += value
        })
        cursor = to
      }

      if (events.length === 0) {
        return [
          {
            tick: startTick,
            units: bar.end - bar.start,
            rest: true,
            pitches: [],
            tieToNext: false,
            fullBar: true
          }
        ]
      }
      if (cursor < bar.end) addRests(cursor, bar.end)
      return events
    })
    return {
      index: bar.index,
      startTick,
      endTick: bar.end * unitTicks,
      numerator: bar.numerator,
      denominator: bar.denominator,
      fifths,
      staves
    }
  })

  return { clefs, measures, unitTicks }
}
