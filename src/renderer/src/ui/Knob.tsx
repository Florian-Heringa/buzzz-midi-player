import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

/** The knob turns through 270°, from -135° (min) to +135° (max); 0° points up. */
const SWEEP = 270
/** Vertical drag distance (px) that covers the full range; Shift makes it 5× finer. */
const DRAG_RANGE_PX = 160
const FINE_FACTOR = 5

interface KnobProps {
  value: number
  min: number
  max: number
  /** Value restored by double-click. */
  defaultValue: number
  onChange: (value: number) => void
  /** Accessible name. */
  label: string
  /** Text for the value, shown below the knob and announced to screen readers. */
  format: (value: number) => string
  /** Fill the arc from the center (for pan) instead of from the minimum. */
  bipolar?: boolean
  size?: number
}

/** Rotary control: drag up/down, scroll, or use the arrow keys. */
export function Knob({
  value,
  min,
  max,
  defaultValue,
  onChange,
  label,
  format,
  bipolar = false,
  size = 40
}: KnobProps): React.JSX.Element {
  const drag = useRef<{ startY: number; startValue: number } | null>(null)
  const dial = useRef<HTMLDivElement>(null)
  const span = max - min
  const set = (next: number): void => {
    const clamped = Math.max(min, Math.min(max, Math.round(next)))
    if (clamped !== value) onChange(clamped)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
    drag.current = { startY: event.clientY, startValue: value }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const pixels = drag.current.startY - event.clientY
    const scale = event.shiftKey ? FINE_FACTOR : 1
    set(drag.current.startValue + (pixels / (DRAG_RANGE_PX * scale)) * span)
  }
  const endDrag = (): void => {
    drag.current = null
  }

  // Native listener: React's wheel listeners are passive, so they can't stop the pane scrolling.
  const wheelStep = useRef<(deltaY: number) => void>(() => {})
  useEffect(() => {
    wheelStep.current = (deltaY) =>
      set(value + (deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(span / 64)))
  })
  useEffect(() => {
    const el = dial.current
    if (!el) return
    const onWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault()
      wheelStep.current(event.deltaY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const big = Math.max(1, Math.round(span / 10))
    const steps: Record<string, number> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: big,
      PageDown: -big
    }
    if (event.key in steps) set(value + steps[event.key] * (event.shiftKey ? big : 1))
    else if (event.key === 'Home') set(min)
    else if (event.key === 'End') set(max)
    else return
    event.preventDefault()
  }

  const angleOf = (v: number): number => ((v - min) / span) * SWEEP - SWEEP / 2
  const radius = size / 2 - 4
  const center = size / 2
  const startAngle = bipolar ? angleOf(defaultValue) : -SWEEP / 2
  const valueAngle = angleOf(value)
  const pointer = polar(center, radius - 5, valueAngle)
  const text = format(value)

  return (
    <div className="knob">
      <div
        ref={dial}
        className="knob__dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        title={`${label}: ${text} · drag or scroll · double-click to reset`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => set(defaultValue)}
      >
        <svg width={size} height={size} aria-hidden>
          <path className="knob__track" d={arc(center, radius, -SWEEP / 2, SWEEP / 2)} />
          {valueAngle !== startAngle && (
            <path
              className="knob__value"
              d={arc(center, radius, Math.min(startAngle, valueAngle), Math.max(startAngle, valueAngle))}
            />
          )}
          <circle className="knob__cap" cx={center} cy={center} r={radius - 3} />
          <line className="knob__pointer" x1={center} y1={center} x2={pointer.x} y2={pointer.y} />
        </svg>
      </div>
      <span className="knob__text">{text}</span>
    </div>
  )
}

function polar(center: number, radius: number, degrees: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) }
}

/** SVG arc path between two angles (degrees, clockwise from 12 o'clock). */
function arc(center: number, radius: number, from: number, to: number): string {
  const start = polar(center, radius, from)
  const end = polar(center, radius, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`
}
