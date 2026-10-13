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
  VexFlow,
  Voice,
  TickContext
} from 'vexflow/bravura'
import type { Song, Track } from '../../model/song'
import { trackDisplayName, useAppStore } from '../../store/appStore'
import { DEFAULT_SETTINGS, useSettings } from '../../ui/settings'
import { FOLLOW_POSITION, isFollowing, useRevealJumps, useWheelZoom, type ZoomAnchor } from '../useWheelZoom'
import type { Clef } from '../staffLayout'
import { buildSheet, UNITS_PER_QUARTER, type Sheet, type SheetEvent } from './sheetModel'

/** Vertical distance between the treble and bass staves of a grand staff. */
const GRAND_STAFF_GAP = 120
const STAVE_TOP = 50
/** x where the first bar starts, in the drawing and in the pinned header alike. */
function drawingLeft(sheet: Sheet): number {
  // A grand staff's brace is drawn left of the staves.
  return sheet.clefs.length === 2 ? 26 : 10
}

/**
 * How far right of the stave's note start (plus its beat's x) VexFlow draws a note: it adds the
 * stave padding from its metrics, which aren't exported. Measured once, so layout and drawing agree.
 */
let notePaddingPx: number | undefined
function notePadding(): number {
  if (notePaddingPx === undefined) {
    const stave = new Stave(0, 0, 100)
    const note = new StaveNote({ keys: ['b/4'], duration: 'q' }).setStave(stave)
    new TickContext().addTickable(note).preFormat().setX(0)
    notePaddingPx = note.getAbsoluteX() - stave.getNoteStartX()
  }
  return notePaddingPx
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
  /** The zoom (relative to the default) it was drawn at. */
  zoomFactor: number
  /** Start and end of every bar; time runs linearly between them. */
  anchors: Anchor[]
  notes: { start: number; end: number; el: SVGElement }[]
  /** y range covered by the staves, for the playhead line. */
  top: number
  bottom: number
}

/**
 * Beams a bar's notes by beat. The whole bar goes in, rests included: groups are found by
 * counting durations from the bar start, so leaving rests out would shift every group off the
 * beat. Rests still break beams.
 */
function beamBar(staffNotes: StaveNote[][], timeSig: string): Beam[] {
  return staffNotes.flatMap((list) =>
    Beam.generateBeams(list, { groups: Beam.getDefaultBeamGroups(timeSig) })
  )
}

/** A bar prepared for drawing: notes and voices, plus where its beats are. */
interface PreparedMeasure {
  staffNotes: StaveNote[][]
  voices: Voice[]
  formatter: Formatter
  /** Beat positions (grid units from the bar start) and their tick contexts. */
  contexts: { units: number; context: TickContext }[]
  units: number
  timeSig: string
  /**
   * Room each beat needs up to the next one (or, for the last, to the barline) so the
   * symbols don't collide, in px.
   */
  rooms: number[]
}

/** VexFlow ticks per grid unit (a sixteenth). */
const VEX_TICKS_PER_UNIT = VexFlow.RESOLUTION / (4 * UNITS_PER_QUARTER)
/** Space for a sixteenth at 100% zoom (more if its symbols need it). */
const SIXTEENTH_PX = 24
/**
 * How space grows with a note's length: length^exponent. 1 would be in proportion to time
 * (constant playhead speed but long notes take a lot of room); 0.6 gives a quarter about 2.3×
 * a sixteenth's room and a whole bar's rest about 5×, as engraved music roughly does.
 */
const SPACING_EXPONENT = 0.6
/** Space kept between neighbouring notes, and after the barline before the first note. */
const NOTE_GAP = 6
const MIN_LEAD = 12

/**
 * Draws the sheet into `container` (an empty div) and returns what playback needs.
 *
 * Each beat gets room for its length, growing less than in proportion (see SPACING_EXPONENT),
 * so long notes and rests don't spread the music out; never less than its symbols need to stay
 * clear. The playhead moves steadily from one beat to the next, so it slows down through long
 * notes. Zoom changes only the spacing, never the height: zooming in spreads the notes,
 * zooming out brings them closer, down to what keeps them clear of each other.
 */
function renderSheet(container: HTMLDivElement, sheet: Sheet, zoomFactor: number): Rendered {
  const clefs = sheet.clefs.map(clefInfo)

  // Pass 1: build every bar and measure how much room its notes need.
  const prepared: PreparedMeasure[] = sheet.measures.map((measure) => {
    const timeSig = `${measure.numerator}/${measure.denominator}`
    const staffNotes = measure.staves.map((events, staff) =>
      events.map((event) => makeNote(event, sheet.clefs[staff], clefs[staff].octaveShift))
    )
    const voices = staffNotes.map((list) =>
      new Voice({ numBeats: measure.numerator, beatValue: measure.denominator })
        .setMode(Voice.Mode.SOFT)
        .addTickables(list)
    )
    // Beamed now so the measuring sees beamed notes (no flags, final stem directions).
    beamBar(staffNotes, timeSig)
    const formatter = new Formatter()
    voices.forEach((voice) => formatter.joinVoices([voice]))
    formatter.format(voices) // measures notes and creates the beat positions
    const tickContexts = formatter.getTickContexts()!
    const contexts = tickContexts.list.map((tick) => ({
      units: tick / tickContexts.resolutionMultiplier / VEX_TICKS_PER_UNIT,
      context: tickContexts.map[tick]
    }))
    const units = (measure.endTick - measure.startTick) / sheet.unitTicks
    return { staffNotes, voices, formatter, contexts, units, timeSig, rooms: [] }
  })

  // Room before a bar's first note (for its accidentals).
  const lead = Math.max(
    MIN_LEAD,
    ...prepared.map((bar) => (bar.contexts[0]?.context.getMetrics().modLeftPx ?? 0) + NOTE_GAP)
  )
  for (const bar of prepared) {
    bar.rooms = bar.contexts.map(({ context }, i) => {
      const metrics = context.getMetrics()
      const rightOfNote = metrics.width - metrics.modLeftPx
      const next = bar.contexts[i + 1]
      // To the next note; the last note only has to clear the barline (the next bar's first
      // note sits `lead` past it).
      return next
        ? rightOfNote + next.context.getMetrics().modLeftPx + NOTE_GAP
        : rightOfNote + NOTE_GAP + lead
    })
  }
  /** Room for a beat lasting `units` sixteenths, at this zoom, before collisions are checked. */
  const spaceFor = (units: number): number => SIXTEENTH_PX * zoomFactor * units ** SPACING_EXPONENT

  // Pass 2: place everything by time and draw.
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  const context = renderer.getContext()
  // Everything in currentColor so the theme's CSS decides the colors.
  context.setFillStyle('currentColor')
  context.setStrokeStyle('currentColor')

  const staffYs = sheet.clefs.map((_, i) => STAVE_TOP + i * GRAND_STAFF_GAP)
  const anchors: Anchor[] = []
  const notes: Rendered['notes'] = []
  const ties: { first: StaveNote; last: StaveNote; count: number }[] = []
  const pendingTie: (StaveNote | null)[] = sheet.clefs.map(() => null)
  // Vertical extent of what is drawn: staff lines, then widened by notes and stems.
  const lineTop = new Stave(0, staffYs[0], 10).getYForLine(0)
  const lineBottom = new Stave(0, staffYs[staffYs.length - 1], 10).getYForLine(4)
  let minY = lineTop - 28 // measure numbers
  let maxY = lineBottom + 16

  let x = drawingLeft(sheet)
  let previous = { fifths: NaN, timeSig: '' }
  sheet.measures.forEach((measure, m) => {
    const bar = prepared[m]
    const first = m === 0
    // Where each beat goes (px from the first beat), and the width up to the barline.
    const offsets: number[] = []
    let notesWidth = 0
    bar.contexts.forEach(({ units }, i) => {
      offsets.push(notesWidth)
      const span = (bar.contexts[i + 1]?.units ?? bar.units) - units
      notesWidth += Math.max(bar.rooms[i], spaceFor(span))
    })

    // Staves with the modifiers this bar needs (clef only at the start).
    const staves = staffYs.map((y, staff) => {
      const stave = new Stave(x, y, 100)
      if (first) stave.addClef(clefs[staff].name, undefined, clefs[staff].annotation)
      if (measure.fifths !== previous.fifths) stave.addKeySignature(KEY_SPECS[measure.fifths + 7])
      if (bar.timeSig !== previous.timeSig) stave.addTimeSignature(bar.timeSig)
      if (staff === 0) stave.setMeasure(measure.index + 1)
      return stave
    })
    previous = { fifths: measure.fifths, timeSig: bar.timeSig }
    const noteStart = Math.max(...staves.map((s) => s.getNoteStartX()))
    const width = noteStart - x + notesWidth
    // Notes are drawn at noteStart + their beat's x, as the spacing above assumes.
    staves.forEach((stave) => stave.setWidth(width).setNoteStartX(noteStart - notePadding()))

    // Beats at their places; a whole-bar rest centred in the bar.
    bar.contexts.forEach(({ context: tickContext }, i) => tickContext.setX(lead + offsets[i]))
    measure.staves.forEach((events, staff) => {
      if (events.length === 1 && events[0].fullBar) {
        const rest = bar.staffNotes[staff][0]
        const tickContext = rest.getTickContext()
        tickContext.setX(notesWidth / 2 - tickContext.getMetrics().width / 2)
      }
    })
    bar.voices.forEach((voice, staff) => voice.setStave(staves[staff]))
    bar.formatter.postFormat()

    staves.forEach((stave) => stave.setContext(context).draw())
    if (staves.length === 2) {
      new StaveConnector(staves[0], staves[1]).setType(first ? 'brace' : 'singleLeft').setContext(context).draw()
      new StaveConnector(staves[0], staves[1]).setType('singleRight').setContext(context).draw()
    }
    bar.voices.forEach((voice, staff) => voice.draw(context, staves[staff]))
    // Beamed again now that the notes have their staff and place: a beam fixes its slope and
    // stem lengths the first time it is laid out, which for the first beams was before that.
    beamBar(bar.staffNotes, bar.timeSig).forEach((beam) => beam.setContext(context).draw())

    // Time runs linearly from each beat to the next (across the barline to the next bar's first
    // beat); after the last bar, to where a next bar's first beat would be.
    bar.contexts.forEach(({ units }, i) =>
      anchors.push([measure.startTick + units * sheet.unitTicks, noteStart + lead + offsets[i]])
    )
    if (m === sheet.measures.length - 1) anchors.push([measure.endTick, noteStart + lead + notesWidth])
    measure.staves.forEach((events, staff) =>
      events.forEach((event, i) => {
        const note = bar.staffNotes[staff][i]
        if (!event.rest) {
          const ys = note.getYs()
          minY = Math.min(minY, ...ys.map((y) => y - 14)) // room for accidentals and ties
          maxY = Math.max(maxY, ...ys.map((y) => y + 14))
          if (note.hasStem()) {
            const stem = note.getStemExtents()
            minY = Math.min(minY, stem.topY - 6, stem.baseY - 6)
            maxY = Math.max(maxY, stem.topY + 6, stem.baseY + 6)
          }
          const el = note.getSVGElement()
          if (el) {
            el.classList.add('sheet-note')
            notes.push({ start: event.tick, end: event.tick + event.units * sheet.unitTicks, el })
          }
        }
        const waiting = pendingTie[staff]
        if (waiting && !event.rest) ties.push({ first: waiting, last: note, count: event.pitches.length })
        pendingTie[staff] = event.tieToNext ? note : null
      })
    )
    x += width
  })

  // Ties last: they can join notes in different bars.
  for (const { first, last, count } of ties) {
    const indexes = Array.from({ length: count }, (_, i) => i)
    new StaveTie({ firstNote: first, lastNote: last, firstIndexes: indexes, lastIndexes: indexes })
      .setContext(context)
      .draw()
  }

  const width = x + lead + 10
  renderer.resize(width, STAVE_TOP + (sheet.clefs.length - 1) * GRAND_STAFF_GAP + 120)
  const svg = container.querySelector('svg')!
  // Fit to the computed extent. (getBBox can't be used: music glyphs are text whose boxes
  // span the font's full line height, far beyond the visible symbol.)
  const height = maxY - minY
  svg.setAttribute('viewBox', `0 ${minY} ${width} ${height}`)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.style.width = `${width}px`
  svg.style.height = `${height}px`

  return { width, zoomFactor, anchors, notes, top: lineTop - 14, bottom: lineBottom + 14 }
}

function makeNote(event: SheetEvent, clef: Clef, octaveShift: number): StaveNote {
  const { duration, dots } = DURATIONS[event.units] ?? DURATIONS[1]
  const vexClef = clef === 'bass' ? 'bass' : 'treble'
  if (event.rest) {
    return new StaveNote({
      keys: [vexClef === 'bass' ? 'd/3' : 'b/4'],
      duration: event.fullBar ? 'wr' : `${duration}r`,
      dots: event.fullBar ? 0 : dots,
      clef: vexClef
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
  const renderedRef = useRef<Rendered | null>(null)
  /** Horizontal stretch of the drawing while a zoom waits to be drawn (1 otherwise). */
  const stretch = useRef(1)
  const { takeAnchor: takeZoomAnchor, peekAnchor: peekZoomAnchor } = useWheelZoom(scroller, (px) => {
    const current = renderedRef.current
    return current ? interpolate(current.anchors, px / stretch.current, 1) : null
  })

  useRevealJumps(scroller, (tick) => {
    const current = renderedRef.current
    return current ? interpolate(current.anchors, tick, 0) * stretch.current : null
  })

  // VexFlow measures with the music font, so it has to be loaded first.
  useEffect(() => {
    let cancelled = false
    void document.fonts.load('30px Bravura').then(() => !cancelled && setFontReady(true))
    return () => {
      cancelled = true
    }
  }, [])

  // Drawing a whole song takes a moment, so zoom changes (a burst while wheeling) are drawn
  // once they settle, meanwhile stretching the current drawing to roughly the new width; a new
  // song, track or key is drawn straight away.
  const drawnSheet = useRef<Sheet | null>(null)
  useEffect(() => {
    const el = drawing.current
    if (!el || !fontReady) return
    const zoomFactor = zoom / DEFAULT_SETTINGS.zoom

    /**
     * After a zoom: the playhead stays put while following playback, otherwise the spot under
     * the mouse (wheel zoom) stays put or the playhead comes into view.
     */
    const keepInView = (result: Rendered, anchor: ZoomAnchor | null): void => {
      const view = scroller.current
      if (!view) return
      const xOf = (tick: number): number => interpolate(result.anchors, tick, 0) * stretch.current
      const position = useAppStore.getState().positionTick
      if (anchor && !isFollowing()) view.scrollLeft = xOf(anchor.tick) - anchor.offset
      else if (position > 0) view.scrollLeft = xOf(position) - view.clientWidth * FOLLOW_POSITION
    }

    const draw = (): void => {
      el.replaceChildren()
      const result = renderSheet(el, sheet, zoomFactor)
      drawnSheet.current = sheet
      renderedRef.current = result
      stretch.current = 1
      setRendered(result)
      if (header.current) renderHeader(header.current, sheet, el.querySelector('svg')!)
      keepInView(result, takeZoomAnchor())
    }

    const current = renderedRef.current
    const svg = el.querySelector('svg')
    if (drawnSheet.current === sheet && current && svg) {
      // Spacing scales with the zoom, so stretching is close to what will be drawn.
      stretch.current = zoomFactor / current.zoomFactor
      const width = current.width * stretch.current
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.setAttribute('width', String(width))
      svg.style.width = `${width}px`
      keepInView(current, peekZoomAnchor())
      const timer = setTimeout(draw, 90)
      return () => clearTimeout(timer)
    }
    draw()
  }, [sheet, zoom, fontReady, takeZoomAnchor, peekZoomAnchor])

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
      // A redraw replaces this drawing before React gets to unsubscribe it.
      if (renderedRef.current !== rendered) return
      const x = interpolate(rendered.anchors, tick, 0)
      line.setAttribute('x1', String(x))
      line.setAttribute('x2', String(x))
      const now = new Set(rendered.notes.filter((n) => n.start <= tick && tick < n.end).map((n) => n.el))
      sounding.forEach((el) => !now.has(el) && el.classList.remove('sheet-note--sounding'))
      now.forEach((el) => el.classList.add('sheet-note--sounding'))
      sounding = now
      const el = scroller.current
      if (playing && followPlayhead && el) {
        el.scrollLeft = x * stretch.current - el.clientWidth * FOLLOW_POSITION
      }
    }
    const state = useAppStore.getState()
    update(state.positionTick, state.transport === 'playing')
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

/** Clef and key signature pinned to the left edge, matching the drawing's offset. */
function renderHeader(
  container: HTMLDivElement,
  sheet: Sheet,
  drawing: SVGSVGElement
): void {
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
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(viewBox[3]))
  svg.style.width = `${width}px`
  svg.style.height = `${viewBox[3]}px`
}
