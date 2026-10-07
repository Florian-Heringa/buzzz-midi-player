import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice
} from 'vexflow/bravura'
import type { Song, Track } from '../../model/song'
import { trackDisplayName, useAppStore } from '../../store/appStore'
import { useSettings } from '../../ui/settings'
import type { Clef } from '../staffLayout'
import { buildSheet, UNITS_PER_QUARTER, type Sheet, type SheetEvent } from './sheetModel'

/** Fraction of the view width where the playhead sits while following playback. */
const FOLLOW_POSITION = 0.3
/** Vertical distance between the treble and bass staves of a grand staff. */
const GRAND_STAFF_GAP = 120
const STAVE_TOP = 50
/** x where the first bar starts, in the drawing and in the pinned header alike. */
function drawingLeft(sheet: Sheet): number {
  // A grand staff's brace is drawn left of the staves.
  return sheet.clefs.length === 2 ? 26 : 10
}

const DURATIONS: Record<number, { duration: string; dots: number }> = {
  16: { duration: 'w', dots: 0 },
  12: { duration: 'h', dots: 1 },
  8: { duration: 'h', dots: 0 },
  6: { duration: 'q', dots: 1 },
  4: { duration: 'q', dots: 0 },
  3: { duration: '8', dots: 1 },
  2: { duration: '8', dots: 0 },
  1: { duration: '16', dots: 0 }
}

const KEY_SPECS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const ACCIDENTAL_CODES = { sharp: '#', flat: 'b', natural: 'n' } as const

/** VexFlow clef name and the octave shift used to write the notes. */
function clefInfo(clef: Clef): { name: string; annotation?: string; octaveShift: number } {
  if (clef === 'bass') return { name: 'bass', octaveShift: 0 }
  if (clef === 'treble8vb') return { name: 'treble', annotation: '8vb', octaveShift: 1 }
  return { name: 'treble', octaveShift: 0 }
}

/** Positions of notes and barlines, to map ticks to x and back. */
type Anchor = [tick: number, x: number]

interface Rendered {
  width: number
  /** Sorted by tick (and so by x: positions only move right as time goes on). */
  anchors: Anchor[]
  notes: { start: number; end: number; el: SVGElement }[]
  /** y range covered by the staves, for the playhead line. */
  top: number
  bottom: number
}

/** Draws the sheet into `container` (an empty div) and returns what playback needs. */
function renderSheet(container: HTMLDivElement, sheet: Sheet, pxPerUnit: number): Rendered {
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  const context = renderer.getContext()
  // Everything in currentColor so the theme's CSS decides the colors.
  context.setFillStyle('currentColor')
  context.setStrokeStyle('currentColor')

  const clefs = sheet.clefs.map(clefInfo)
  const staffYs = sheet.clefs.map((_, i) => STAVE_TOP + i * GRAND_STAFF_GAP)
  const anchors: Anchor[] = []
  const notes: Rendered['notes'] = []
  const ties: { first: StaveNote; last: StaveNote; count: number }[] = []
  const pendingTie: (StaveNote | null)[] = sheet.clefs.map(() => null)

  let x = drawingLeft(sheet)
  let previous = { fifths: NaN, timeSig: '' }
  // Vertical extent of what is drawn: staff lines, then widened by notes, stems and beams.
  const lineTop = new Stave(0, staffYs[0], 10).getYForLine(0)
  const lineBottom = new Stave(0, staffYs[staffYs.length - 1], 10).getYForLine(4)
  let minY = lineTop - 28 // measure numbers
  let maxY = lineBottom + 16

  for (const measure of sheet.measures) {
    const timeSig = `${measure.numerator}/${measure.denominator}`
    const first = measure.index === 0

    // Staves with the modifiers this bar needs (clef only at the start).
    const staves = staffYs.map((y, staff) => {
      const stave = new Stave(x, y, 100)
      if (first) stave.addClef(clefs[staff].name, undefined, clefs[staff].annotation)
      if (measure.fifths !== previous.fifths) stave.addKeySignature(KEY_SPECS[measure.fifths + 7])
      if (timeSig !== previous.timeSig) stave.addTimeSignature(timeSig)
      if (staff === 0) stave.setMeasure(measure.index + 1)
      return stave
    })
    previous = { fifths: measure.fifths, timeSig }

    // Notes and voices.
    const staffNotes = measure.staves.map((events, staff) =>
      events.map((event) => makeNote(event, sheet.clefs[staff], clefs[staff].octaveShift))
    )
    const voices = staffNotes.map((list) =>
      new Voice({ numBeats: measure.numerator, beatValue: measure.denominator }).setMode(Voice.Mode.SOFT).addTickables(list)
    )
    const beams = staffNotes.flatMap((list) =>
      Beam.generateBeams(
        list.filter((n) => !n.isRest()),
        { groups: Beam.getDefaultBeamGroups(timeSig) }
      )
    )

    const formatter = new Formatter()
    voices.forEach((voice) => formatter.joinVoices([voice]))
    const minWidth = formatter.preCalculateMinTotalWidth(voices)
    const units = (measure.endTick - measure.startTick) / sheet.unitTicks
    const contentWidth = Math.max(minWidth + 24, units * pxPerUnit)
    // All staves of the bar start their notes at the same x.
    const noteStart = Math.max(...staves.map((s) => s.getNoteStartX()))
    const width = noteStart - x + contentWidth
    staves.forEach((stave) => {
      stave.setWidth(width)
      stave.setNoteStartX(noteStart)
    })
    formatter.format(voices, contentWidth - 16)

    // Draw.
    staves.forEach((stave) => stave.setContext(context).draw())
    if (staves.length === 2) {
      const brace = new StaveConnector(staves[0], staves[1])
      brace.setType(first ? 'brace' : 'singleLeft').setContext(context).draw()
      new StaveConnector(staves[0], staves[1]).setType('singleRight').setContext(context).draw()
    }
    voices.forEach((voice, staff) => voice.draw(context, staves[staff]))
    beams.forEach((beam) => beam.setContext(context).draw())

    // Remember positions and elements for playback, and ties to draw at the end.
    anchors.push([measure.startTick, noteStart])
    measure.staves.forEach((events, staff) =>
      events.forEach((event, i) => {
        const note = staffNotes[staff][i]
        if (!event.fullBar) anchors.push([event.tick, note.getAbsoluteX()])
        if (!event.rest) {
          const ys = note.getYs()
          minY = Math.min(minY, ...ys.map((y) => y - 14)) // room for accidentals and ties
          maxY = Math.max(maxY, ...ys.map((y) => y + 14))
          if (note.hasStem()) {
            const stem = note.getStemExtents()
            minY = Math.min(minY, stem.topY - 6, stem.baseY - 6)
            maxY = Math.max(maxY, stem.topY + 6, stem.baseY + 6)
          }
        }
        const el = note.getSVGElement()
        if (el && !event.rest) {
          el.classList.add('sheet-note')
          notes.push({ start: event.tick, end: event.tick + event.units * sheet.unitTicks, el })
        }
        const waiting = pendingTie[staff]
        if (waiting && !event.rest) ties.push({ first: waiting, last: note, count: event.pitches.length })
        pendingTie[staff] = event.tieToNext ? note : null
      })
    )
    x += width
    anchors.push([measure.endTick, x])
  }

  // Ties last: they can join notes in different bars.
  for (const { first, last, count } of ties) {
    const indexes = Array.from({ length: count }, (_, i) => i)
    new StaveTie({ firstNote: first, lastNote: last, firstIndexes: indexes, lastIndexes: indexes })
      .setContext(context)
      .draw()
  }

  const width = x + 10
  renderer.resize(width, STAVE_TOP + (sheet.clefs.length - 1) * GRAND_STAFF_GAP + 120)
  const svg = container.querySelector('svg')!
  // Fit to the computed extent. (getBBox can't be used: music glyphs are text whose boxes
  // span the font's full line height, far beyond the visible symbol.)
  const top = minY
  const height = maxY - minY
  svg.setAttribute('viewBox', `0 ${top} ${width} ${height}`)
  svg.setAttribute('height', String(height))
  svg.style.height = `${height}px`

  // Keep x rising with time (staves of a grand staff can place the same beat slightly apart).
  anchors.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (let i = 1; i < anchors.length; i++) anchors[i][1] = Math.max(anchors[i][1], anchors[i - 1][1])
  return {
    width,
    anchors,
    notes,
    top: lineTop - 14,
    bottom: lineBottom + 14
  }
}

function makeNote(event: SheetEvent, clef: Clef, octaveShift: number): StaveNote {
  const { duration, dots } = DURATIONS[event.units] ?? DURATIONS[1]
  const vexClef = clef === 'bass' ? 'bass' : 'treble'
  if (event.rest) {
    return new StaveNote({
      keys: [vexClef === 'bass' ? 'd/3' : 'b/4'],
      duration: event.fullBar ? 'wr' : `${duration}r`,
      dots: event.fullBar ? 0 : dots,
      clef: vexClef,
      alignCenter: event.fullBar
    }).addClass('sheet-rest') as StaveNote
  }
  const keys = event.pitches.map((p) => `${'cdefgab'[p.step % 7]}/${Math.floor(p.step / 7) - 1 + octaveShift}`)
  const note = new StaveNote({ keys, duration, dots, clef: vexClef, autoStem: true })
  event.pitches.forEach((pitch, index) => {
    if (pitch.accidental) note.addModifier(new Accidental(ACCIDENTAL_CODES[pitch.accidental]), index)
  })
  if (dots > 0) Dot.buildAndAttach([note], { all: true })
  return note
}

/** Linear interpolation over anchors (sorted by `from`). */
function interpolate(anchors: Anchor[], value: number, from: 0 | 1): number {
  const to = from === 0 ? 1 : 0
  if (anchors.length === 0) return 0
  if (value <= anchors[0][from]) return anchors[0][to]
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]
    const b = anchors[i]
    if (value <= b[from]) {
      if (b[from] === a[from]) return b[to]
      return a[to] + ((value - a[from]) / (b[from] - a[from])) * (b[to] - a[to])
    }
  }
  return anchors[anchors.length - 1][to]
}

/** Sheet music for the practice track, drawn with VexFlow on one scrolling line. */
export function SheetView({ song, track }: { song: Song; track: Track }): React.JSX.Element {
  const { zoom, followPlayhead } = useSettings()
  const accidentals = useAppStore((s) => s.keyChoice?.accidentals)
  const name = useAppStore((s) => trackDisplayName(s, track.id))
  const seek = useAppStore((s) => s.seek)
  const sheet = useMemo(() => buildSheet(song, track, { accidentals }), [song, track, accidentals])
  const scroller = useRef<HTMLDivElement>(null)
  const drawing = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [fontReady, setFontReady] = useState(false)

  // VexFlow measures with the music font, so it has to be loaded first.
  useEffect(() => {
    let cancelled = false
    void document.fonts.load('30px Bravura').then(() => !cancelled && setFontReady(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const el = drawing.current
    if (!el || !fontReady) return
    el.replaceChildren()
    const result = renderSheet(el, sheet, zoom / UNITS_PER_QUARTER)
    setRendered(result)
    if (header.current) renderHeader(header.current, sheet, el.querySelector('svg')!)
  }, [sheet, zoom, fontReady])

  // Back to the start when switching track or song.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = 0
  }, [song.tracks, track])

  // Playhead, sounding notes and following: DOM updates from a store subscription.
  useEffect(() => {
    const svg = drawing.current?.querySelector('svg')
    if (!rendered || !svg) return
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.classList.add('staff__playhead')
    line.setAttribute('y1', String(rendered.top))
    line.setAttribute('y2', String(rendered.bottom))
    svg.appendChild(line)
    let sounding = new Set<SVGElement>()

    const update = (tick: number, playing: boolean): void => {
      const x = interpolate(rendered.anchors, tick, 0)
      line.setAttribute('x1', String(x))
      line.setAttribute('x2', String(x))
      const now = new Set(rendered.notes.filter((n) => n.start <= tick && tick < n.end).map((n) => n.el))
      sounding.forEach((el) => !now.has(el) && el.classList.remove('sheet-note--sounding'))
      now.forEach((el) => el.classList.add('sheet-note--sounding'))
      sounding = now
      const el = scroller.current
      if (playing && followPlayhead && el) el.scrollLeft = x - el.clientWidth * FOLLOW_POSITION
    }
    const state = useAppStore.getState()
    update(state.positionTick, false)
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.positionTick !== prev.positionTick || s.transport !== prev.transport) {
        update(s.positionTick, s.transport === 'playing')
      }
    })
    return () => {
      unsubscribe()
      line.remove()
    }
  }, [rendered, followPlayhead])

  /** Pointer x in drawing coordinates. */
  const drawingX = (event: MouseEvent<HTMLDivElement>): number | null => {
    const svg = drawing.current?.querySelector('svg')
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return point.x
  }
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const x = drawingX(event)
    if (x === null || !rendered) return
    seek(Math.max(0, interpolate(rendered.anchors, x, 1)))
  }

  return (
    <div className="staff-view sheet-view">
      <div className="staff-view__scroller" ref={scroller}>
        <div
          className="sheet-view__drawing"
          ref={drawing}
          onClick={onClick}
          role="img"
          aria-label={`Sheet music for ${name}. Click to move the playhead.`}
        />
      </div>
      <div className="sheet-view__header" ref={header} aria-hidden />
      {!fontReady && <p className="placeholder sheet-view__loading">Loading music font…</p>}
    </div>
  )
}

/** Clef and key signature pinned to the left edge, matching the drawing's scale and offset. */
function renderHeader(container: HTMLDivElement, sheet: Sheet, drawing: SVGSVGElement): void {
  container.replaceChildren()
  const first = sheet.measures[0]
  if (!first) return
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  const context = renderer.getContext()
  context.setFillStyle('currentColor')
  context.setStrokeStyle('currentColor')
  // Same x as the drawing's first bar, so at the start the header lies exactly on top of it.
  const left = drawingLeft(sheet)
  let width = 0
  sheet.clefs.forEach((clef, staff) => {
    const info = clefInfo(clef)
    const stave = new Stave(left, STAVE_TOP + staff * GRAND_STAFF_GAP, 10)
    stave.addClef(info.name, undefined, info.annotation).addKeySignature(KEY_SPECS[first.fifths + 7])
    width = Math.max(width, stave.getNoteStartX())
  })
  const staves = sheet.clefs.map((clef, staff) => {
    const info = clefInfo(clef)
    const stave = new Stave(left, STAVE_TOP + staff * GRAND_STAFF_GAP, width - left)
    stave.addClef(info.name, undefined, info.annotation).addKeySignature(KEY_SPECS[first.fifths + 7])
    // No barline at the header's edge: the music continues underneath.
    stave.setEndBarType(BarlineType.NONE)
    stave.setContext(context).draw()
    return stave
  })
  if (staves.length === 2) new StaveConnector(staves[0], staves[1]).setType('brace').setContext(context).draw()
  const viewBox = drawing.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, width, 200]
  renderer.resize(width, viewBox[3])
  const svg = container.querySelector('svg')!
  svg.setAttribute('viewBox', `0 ${viewBox[1]} ${width} ${viewBox[3]}`)
  svg.style.height = `${viewBox[3]}px`
}
