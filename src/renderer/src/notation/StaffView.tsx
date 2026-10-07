import { memo, useEffect, useMemo, useRef, type MouseEvent } from 'react'
import type { Song, Track } from '../model/song'
import { trackDisplayName, useAppStore } from '../store/appStore'
import { useSettings } from '../ui/settings'
import { FOLLOW_POSITION, isFollowing, useWheelZoom } from './useWheelZoom'
import { layoutStaff, type Accidental, type Clef, type StaffLayout } from './staffLayout'

// U+FE0E requests the text (not emoji) presentation, which Windows otherwise draws in color.
const ACCIDENTAL_GLYPH: Record<Accidental, string> = {
  sharp: '\u266F\uFE0E',
  flat: '\u266D\uFE0E',
  natural: '\u266E\uFE0E'
}

export function StaffView({ song, track }: { song: Song; track: Track }): React.JSX.Element {
  const { zoom, followPlayhead } = useSettings()
  const accidentals = useAppStore((s) => s.keyChoice?.accidentals)
  const layout = useMemo(
    () => layoutStaff(song, track, { pxPerBeat: zoom, accidentals }),
    [song, track, zoom, accidentals]
  )
  const scroller = useRef<HTMLDivElement>(null)
  const seek = useAppStore((s) => s.seek)
  const name = useAppStore((s) => trackDisplayName(s, track.id))

  // Back to the start when switching track or song (not when the key is read differently).
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = 0
  }, [song.tracks, track])

  // Wheel zoom keeps the music under the mouse in place.
  const { takeAnchor: takeZoomAnchor } = useWheelZoom(scroller, (x) => (x - layout.originX) / layout.pxPerTick)

  // After zooming: keep the spot under the mouse (wheel) or bring the playhead into view.
  // While following playback the playhead stays put instead, so the view doesn't jump to it.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const anchor = takeZoomAnchor()
    if (anchor && !isFollowing()) {
      el.scrollLeft = layout.originX + anchor.tick * layout.pxPerTick - anchor.offset
      return
    }
    const tick = useAppStore.getState().positionTick
    if (tick > 0) el.scrollLeft = layout.originX + tick * layout.pxPerTick - el.clientWidth * FOLLOW_POSITION
  }, [layout, takeZoomAnchor])

  // Keep the playhead in view while playing (store subscription: no re-render needed).
  useEffect(() => {
    if (!followPlayhead) return
    return useAppStore.subscribe((state) => {
      const el = scroller.current
      if (state.transport !== 'playing' || !el) return
      const x = layout.originX + state.positionTick * layout.pxPerTick
      el.scrollLeft = x - el.clientWidth * FOLLOW_POSITION
    })
  }, [layout, followPlayhead])

  /** Staff x of the pointer, clamped to the start of the music. */
  const pointerX = (event: MouseEvent<SVGSVGElement>): number =>
    Math.max(layout.originX, event.clientX - event.currentTarget.getBoundingClientRect().left)

  const onClick = (event: MouseEvent<SVGSVGElement>): void => {
    seek((pointerX(event) - layout.originX) / layout.pxPerTick)
  }

  // Ghost playhead showing where a click will seek; updated directly to avoid re-renders.
  const hoverLine = useRef<SVGLineElement>(null)
  const onMouseMove = (event: MouseEvent<SVGSVGElement>): void => {
    const line = hoverLine.current
    if (!line) return
    const x = String(pointerX(event))
    line.setAttribute('x1', x)
    line.setAttribute('x2', x)
    line.style.visibility = 'visible'
  }
  const onMouseLeave = (): void => {
    if (hoverLine.current) hoverLine.current.style.visibility = 'hidden'
  }

  const { staves, lineGap } = layout
  return (
    <div className="staff-view">
      <div className="staff-view__scroller" ref={scroller}>
        <svg
          className="staff-view__svg"
          width={layout.width}
          height={layout.height}
          onClick={onClick}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          role="img"
          aria-label={`Staff for ${name}. Click to move the playhead.`}
        >
          <StaticStaff layout={layout} />
          <line
            ref={hoverLine}
            className="staff__hover-line"
            y1={staves[0].top - lineGap * 2}
            y2={staves[staves.length - 1].bottom + lineGap * 2}
            style={{ visibility: 'hidden' }}
          />
          <PlaybackOverlay layout={layout} />
        </svg>
      </div>
      <StaffHeader layout={layout} />
    </div>
  )
}

/** Staff lines, barlines and notes; only re-renders when the layout changes. */
const StaticStaff = memo(function StaticStaff({ layout }: { layout: StaffLayout }) {
  const { lineGap, staves, notes, barlines, width } = layout
  const headRx = lineGap * 0.62
  const headRy = lineGap * 0.45
  return (
    <g>
      {staves.map((staff, i) => (
        <g key={i} className="staff__lines">
          {[0, 1, 2, 3, 4].map((line) => (
            <line key={line} x1={0} x2={width} y1={staff.top + line * lineGap} y2={staff.top + line * lineGap} />
          ))}
        </g>
      ))}

      {layout.beatlines.map((x) => (
        <line
          key={`beat-${x}`}
          className="staff__beatline"
          x1={x}
          x2={x}
          y1={staves[0].top}
          y2={staves[staves.length - 1].bottom}
        />
      ))}
      {barlines.map((bar) => (
        <g key={bar.number}>
          <line
            className="staff__barline"
            x1={bar.x}
            x2={bar.x}
            y1={staves[0].top}
            y2={staves[staves.length - 1].bottom}
          />
          <text className="staff__measure-number" x={bar.x + 3} y={lineGap * 1.3}>
            {bar.number}
          </text>
        </g>
      ))}
      <line
        className="staff__barline staff__barline--final"
        x1={width - lineGap * 2}
        x2={width - lineGap * 2}
        y1={staves[0].top}
        y2={staves[staves.length - 1].bottom}
      />

      {notes.map((note) => (
        <g key={note.index}>
          <rect
            className="staff__duration"
            x={note.x}
            y={note.y - headRy * 0.6}
            width={note.width}
            height={headRy * 1.2}
            rx={headRy * 0.6}
          />
          {note.ledgers.map((y) => (
            <line key={y} className="staff__ledger" x1={note.x - headRx * 1.6} x2={note.x + headRx * 1.6} y1={y} y2={y} />
          ))}
          {note.accidental && (
            <text className="staff__accidental" x={note.x - headRx * 1.3} y={note.y} fontSize={lineGap * 1.8}>
              {ACCIDENTAL_GLYPH[note.accidental]}
            </text>
          )}
          <ellipse
            className="staff__notehead"
            cx={note.x}
            cy={note.y}
            rx={headRx}
            ry={headRy}
            transform={`rotate(-20 ${note.x} ${note.y})`}
          />
        </g>
      ))}
    </g>
  )
})

/** Playhead and highlighted sounding notes. */
function PlaybackOverlay({ layout }: { layout: StaffLayout }): React.JSX.Element {
  const positionTick = useAppStore((s) => s.positionTick)
  const x = layout.originX + positionTick * layout.pxPerTick

  const { lineGap, staves, notes } = layout
  const sounding = notes.filter((n) => n.tick <= positionTick && positionTick < n.endTick)
  return (
    <g pointerEvents="none">
      {sounding.map((note) => (
        <ellipse
          key={note.index}
          className="staff__notehead staff__notehead--sounding"
          cx={note.x}
          cy={note.y}
          rx={lineGap * 0.62}
          ry={lineGap * 0.45}
          transform={`rotate(-20 ${note.x} ${note.y})`}
        />
      ))}
      <line
        className="staff__playhead"
        x1={x}
        x2={x}
        y1={staves[0].top - lineGap * 2}
        y2={staves[staves.length - 1].bottom + lineGap * 2}
      />
    </g>
  )
}

/** Clef and key signature, pinned to the left edge over the scrolling staff. */
function StaffHeader({ layout }: { layout: StaffLayout }): React.JSX.Element {
  const { lineGap, staves, keySignature, originX, height } = layout
  return (
    <svg className="staff-view__header" width={originX - lineGap} height={height} aria-hidden>
      <rect className="staff-view__header-bg" x={0} y={0} width={originX - lineGap} height={height} />
      {staves.map((staff, i) => (
        <g key={i}>
          <g className="staff__lines">
            {[0, 1, 2, 3, 4].map((line) => (
              <line key={line} x1={0} x2={originX} y1={staff.top + line * lineGap} y2={staff.top + line * lineGap} />
            ))}
          </g>
          <ClefGlyph clef={staff.clef} top={staff.top} lineGap={lineGap} />
        </g>
      ))}
      {keySignature.map((glyph, i) => {
        const perStaff = keySignature.filter((k) => k.staff === glyph.staff)
        const index = perStaff.indexOf(glyph)
        return (
          <text
            key={i}
            className="staff__accidental"
            x={lineGap * 3.6 + index * lineGap * 0.85}
            y={glyph.y}
            fontSize={lineGap * 1.8}
          >
            {ACCIDENTAL_GLYPH[glyph.accidental]}
          </text>
        )
      })}
    </svg>
  )
}

function ClefGlyph({ clef, top, lineGap }: { clef: Clef; top: number; lineGap: number }): React.JSX.Element {
  if (clef === 'bass') {
    // Baseline placed so the F clef's dots straddle the F line (second from top).
    return (
      <text className="staff__clef" x={lineGap * 0.4} y={top + lineGap * 3.05} fontSize={lineGap * 3.2}>
        𝄢
      </text>
    )
  }
  // The G clef curls around the G line (second from bottom).
  return (
    <g>
      <text className="staff__clef" x={lineGap * 0.3} y={top + lineGap * 3.45} fontSize={lineGap * 4.4}>
        𝄞
      </text>
      {clef === 'treble8vb' && (
        <text className="staff__clef-octave" x={lineGap * 1.25} y={top + lineGap * 5.5} fontSize={lineGap * 1.1}>
          8
        </text>
      )}
    </g>
  )
}
