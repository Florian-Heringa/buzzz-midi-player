import { Children, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const DIVIDER_PX = 6
/** Arrow keys move a divider by this many pixels. */
const KEY_STEP_PX = 16

/** A pane's height: 'fit' sizes it to its content; a number is a height in px set by dragging. */
export type PaneSize = 'fit' | number

interface SplitPanesProps {
  /** Index of the pane that takes the remaining height. */
  fillPane: number
  /** Per pane minimum: 'content' (never smaller than its content) or a height in px. */
  minSizes: ('content' | number)[]
  /** localStorage key to remember sizes per viewer. */
  storageKey?: string
  /** Accessible names of the panes, used to label the dividers. */
  labels?: string[]
  children: ReactNode
}

/**
 * Vertically stacked panes separated by draggable dividers. Panes fit their content until
 * resized; the fill pane takes what is left. A divider resizes the adjacent pane that isn't
 * the fill pane; double-clicking it returns that pane to fitting its content.
 */
export function SplitPanes({
  fillPane,
  minSizes,
  storageKey,
  labels = [],
  children
}: SplitPanesProps): React.JSX.Element {
  const panes = Children.toArray(children)
  const [sizes, setSizes] = useState<PaneSize[]>(() => loadSizes(storageKey, panes.length))
  const paneRefs = useRef<(HTMLDivElement | null)[]>([])

  const update = (next: PaneSize[], persist = true): void => {
    setSizes(next)
    if (persist) saveSizes(storageKey, next)
  }

  /** The pane a divider resizes: the neighbour that isn't the fill pane. */
  const resizedPane = (divider: number): number => (divider === fillPane ? divider + 1 : divider)

  /** Range of heights the pane can take without squeezing the others below their minimum. */
  const limits = (pane: number): { start: number; min: number; max: number } => {
    const heights = paneRefs.current.map((el) => el?.getBoundingClientRect().height ?? 0)
    const container = paneRefs.current[0]?.parentElement?.clientHeight ?? 0
    const minOf = (i: number): number => {
      const min = minSizes[i] ?? 0
      return min === 'content' ? minContentHeight(paneRefs.current[i]) : min
    }
    const others = heights.reduce(
      (sum, h, i) => (i === pane ? sum : i === fillPane ? sum + minOf(i) : sum + h),
      0
    )
    const min = minOf(pane)
    const max = Math.max(min, container - others - DIVIDER_PX * (panes.length - 1))
    return { start: heights[pane], min, max }
  }

  const onPointerDown = (divider: number) => (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const pane = resizedPane(divider)
    // Dragging down grows the pane above the divider and shrinks the one below.
    const direction = pane === divider ? 1 : -1
    const { start, min, max } = limits(pane)
    const startY = event.clientY
    let latest = sizes
    const onMove = (move: globalThis.PointerEvent): void => {
      const height = clamp(start + direction * (move.clientY - startY), min, max)
      latest = sizes.map((size, i) => (i === pane ? Math.round(height) : size))
      update(latest, false)
    }
    const onUp = (): void => {
      saveSizes(storageKey, latest)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (divider: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowUp' ? -KEY_STEP_PX : event.key === 'ArrowDown' ? KEY_STEP_PX : 0
    if (!delta) return
    event.preventDefault()
    const pane = resizedPane(divider)
    const { start, min, max } = limits(pane)
    const height = clamp(start + (pane === divider ? delta : -delta), min, max)
    update(sizes.map((size, i) => (i === pane ? Math.round(height) : size)))
  }

  const fit = (divider: number): void => {
    const pane = resizedPane(divider)
    update(sizes.map((size, i) => (i === pane ? 'fit' : size)))
  }

  const rows = panes
    .map((_, i) => {
      const min = minSizes[i] === 'content' ? 'min-content' : `${minSizes[i] ?? 0}px`
      if (i === fillPane) return `minmax(${min}, 1fr)`
      const size = sizes[i] ?? 'fit'
      // Fitting panes grow to their content only as far as the fill pane's minimum allows.
      return size === 'fit' ? `minmax(${min}, max-content)` : `minmax(${min}, ${size}px)`
    })
    .join(` ${DIVIDER_PX}px `)

  return (
    <div className="split-panes" style={{ gridTemplateRows: rows }}>
      {panes.map((pane, index) => [
        <div
          key={`pane-${index}`}
          className="split-panes__pane"
          ref={(el) => {
            paneRefs.current[index] = el
          }}
        >
          {pane}
        </div>,
        index < panes.length - 1 && (
          <div
            key={`divider-${index}`}
            className="split-panes__divider"
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize ${labels[index] ?? `pane ${index + 1}`} and ${labels[index + 1] ?? `pane ${index + 2}`}`}
            tabIndex={0}
            title="Drag to resize · double-click to fit the content"
            onPointerDown={onPointerDown(index)}
            onKeyDown={onKeyDown(index)}
            onDoubleClick={() => fit(index)}
          />
        )
      ])}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Height the element needs for its content when it can't stretch. */
function minContentHeight(el: HTMLElement | null | undefined): number {
  if (!el) return 0
  const previous = el.style.height
  el.style.height = 'min-content'
  const height = el.getBoundingClientRect().height
  el.style.height = previous
  return height
}

function loadSizes(key: string | undefined, count: number): PaneSize[] {
  const defaults: PaneSize[] = new Array(count).fill('fit')
  if (!key) return defaults
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (
      Array.isArray(saved) &&
      saved.length === count &&
      saved.every((s) => s === 'fit' || (typeof s === 'number' && s > 0))
    ) {
      return saved
    }
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return defaults
}

function saveSizes(key: string | undefined, sizes: PaneSize[]): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(sizes))
  } catch {
    // Not persisting sizes is fine.
  }
}
