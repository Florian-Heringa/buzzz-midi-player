import { Children, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const DIVIDER_PX = 6
/** Arrow keys move a divider by this fraction of the available height. */
const KEY_STEP = 0.02

interface SplitPanesProps {
  /** Initial pane sizes as fractions; one per child. */
  defaultSizes: number[]
  /** Smallest height a pane can be dragged to. */
  minPanePx?: number
  /** Per pane: never smaller than its content ('content') or the default minimum. */
  minSizes?: ('content' | 'default')[]
  /** localStorage key to remember sizes per viewer. */
  storageKey?: string
  /** Accessible names of the panes, used to label the dividers. */
  labels?: string[]
  children: ReactNode
}

/** Vertically stacked panes separated by draggable dividers. */
export function SplitPanes({
  defaultSizes,
  minPanePx = 48,
  minSizes = [],
  storageKey,
  labels = [],
  children
}: SplitPanesProps): React.JSX.Element {
  const panes = Children.toArray(children)
  const [sizes, setSizes] = useState(() => loadSizes(storageKey, defaultSizes))
  const container = useRef<HTMLDivElement>(null)

  const update = (next: number[]): void => {
    setSizes(next)
    saveSizes(storageKey, next)
  }

  /**
   * Content minimums are enforced by the grid, so the requested fractions can disagree with
   * what is shown. Re-reading the rendered heights keeps further drags from having a dead zone.
   */
  const syncToRendered = (): void => {
    const heights = [...(container.current?.children ?? [])]
      .filter((el) => el.classList.contains('split-panes__pane'))
      .map((el) => el.getBoundingClientRect().height)
    if (heights.length === panes.length && heights.every((h) => h > 0)) {
      const total = heights.reduce((a, b) => a + b, 0)
      update(heights.map((h) => h / total))
    }
  }

  /** Height available to panes, excluding dividers. */
  const availablePx = (): number =>
    (container.current?.clientHeight ?? 0) - DIVIDER_PX * (panes.length - 1)

  /** Moves the divider below pane `index` by `delta` (fraction of available height). */
  const moveDivider = (start: number[], index: number, delta: number): number[] => {
    const total = start.reduce((a, b) => a + b, 0)
    const min = (minPanePx / Math.max(availablePx(), 1)) * total
    const pair = start[index] + start[index + 1]
    const above = Math.max(min, Math.min(pair - min, start[index] + delta * total))
    const next = [...start]
    next[index] = above
    next[index + 1] = pair - above
    return next
  }

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const divider = event.currentTarget
    divider.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startSizes = sizes
    let latest = sizes
    const onMove = (move: globalThis.PointerEvent): void => {
      const delta = (move.clientY - startY) / Math.max(availablePx(), 1)
      latest = moveDivider(startSizes, index, delta)
      setSizes(latest)
    }
    const onUp = (): void => {
      saveSizes(storageKey, latest)
      requestAnimationFrame(syncToRendered)
      divider.removeEventListener('pointermove', onMove)
      divider.removeEventListener('pointerup', onUp)
      divider.removeEventListener('pointercancel', onUp)
    }
    divider.addEventListener('pointermove', onMove)
    divider.addEventListener('pointerup', onUp)
    divider.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowUp' ? -KEY_STEP : event.key === 'ArrowDown' ? KEY_STEP : 0
    if (!delta) return
    event.preventDefault()
    update(moveDivider(sizes, index, delta))
    requestAnimationFrame(syncToRendered)
  }

  const total = sizes.reduce((a, b) => a + b, 0)
  const rows = sizes
    .map((size, i) => `minmax(${minSizes[i] === 'content' ? 'min-content' : `${minPanePx}px`}, ${size}fr)`)
    .join(` ${DIVIDER_PX}px `)

  return (
    <div className="split-panes" ref={container} style={{ gridTemplateRows: rows }}>
      {panes.map((pane, index) => [
        <div key={`pane-${index}`} className="split-panes__pane">
          {pane}
        </div>,
        index < panes.length - 1 && (
          <div
            key={`divider-${index}`}
            className="split-panes__divider"
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize ${labels[index] ?? `pane ${index + 1}`} and ${labels[index + 1] ?? `pane ${index + 2}`}`}
            aria-valuenow={Math.round((sizes[index] / total) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={onPointerDown(index)}
            onKeyDown={onKeyDown(index)}
            onDoubleClick={() => update(defaultSizes)}
          />
        )
      ])}
    </div>
  )
}

function loadSizes(key: string | undefined, defaults: number[]): number[] {
  if (!key) return defaults
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (
      Array.isArray(saved) &&
      saved.length === defaults.length &&
      saved.every((n) => typeof n === 'number' && n > 0)
    ) {
      return saved
    }
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return defaults
}

function saveSizes(key: string | undefined, sizes: number[]): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(sizes))
  } catch {
    // Not persisting sizes is fine.
  }
}
