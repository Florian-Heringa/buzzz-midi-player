import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useAppStore } from '../store/appStore'
import { getSettings, MAX_ZOOM, MIN_ZOOM, updateSettings } from '../ui/settings'

/** Fraction of the view width where the playhead sits while following playback. */
export const FOLLOW_POSITION = 0.3

/** Whether the note display is following the playhead right now. */
export function isFollowing(): boolean {
  return useAppStore.getState().transport === 'playing' && getSettings().followPlayhead
}

/** Part of the view at either edge where a jump target counts as out of sight (pinned clef). */
const REVEAL_MARGIN = 0.15

/**
 * After a jump of the play position (the position slider, loop buttons, looping, stop), scrolls
 * the view so the playhead is visible: placed where following keeps it, unless it already is
 * in sight. `xOfTick` maps a tick to an x in the scroller's content.
 */
export function useRevealJumps(
  scroller: RefObject<HTMLDivElement | null>,
  xOfTick: (tick: number) => number | null
): void {
  const xOfTickRef = useRef(xOfTick)
  useEffect(() => {
    xOfTickRef.current = xOfTick
  })
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        const el = scroller.current
        if (state.jumpCount === prev.jumpCount || !el) return
        const x = xOfTickRef.current(state.positionTick)
        if (x === null) return
        const margin = el.clientWidth * REVEAL_MARGIN
        if (x < el.scrollLeft + margin || x > el.scrollLeft + el.clientWidth - margin) {
          el.scrollLeft = x - el.clientWidth * FOLLOW_POSITION
        }
      }),
    [scroller]
  )
}

/** Zoom change per pixel of wheel movement (exponential, so each notch scales by the same %). */
const ZOOM_PER_PIXEL = 0.0015

/** A spot to keep in place across a zoom: this tick stays under this x (px from the view's left). */
export interface ZoomAnchor {
  tick: number
  offset: number
}

/**
 * Vertical wheel over the note display zooms it horizontally, keeping the music under the
 * mouse in place. Horizontal scrolling (shift+wheel, touchpad swipe) still scrolls.
 *
 * `tickAt` maps a view x (px from the scroller's left edge, scroll included) to a tick.
 * `takeAnchor` hands out the anchor to restore once the view has been laid out at the new zoom
 * (null when the zoom didn't come from the wheel), clearing it; `peekAnchor` leaves it.
 */
export function useWheelZoom(
  scroller: RefObject<HTMLDivElement | null>,
  tickAt: (x: number) => number | null
): { takeAnchor: () => ZoomAnchor | null; peekAnchor: () => ZoomAnchor | null } {
  const anchor = useRef<ZoomAnchor | null>(null)
  const tickAtRef = useRef(tickAt)
  useEffect(() => {
    tickAtRef.current = tickAt
  })

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return
      event.preventDefault()
      const offset = event.clientX - el.getBoundingClientRect().left
      const tick = tickAtRef.current(el.scrollLeft + offset)
      // Keep the first anchor of a burst of wheel events: the spot the user started on.
      if (tick !== null && !anchor.current) anchor.current = { tick, offset }
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
      const zoom = getSettings().zoom * Math.exp(-pixels * ZOOM_PER_PIXEL)
      // Not rounded, so small touchpad steps add up.
      updateSettings({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scroller])

  const takeAnchor = useCallback(() => {
    const taken = anchor.current
    anchor.current = null
    return taken
  }, [])
  const peekAnchor = useCallback(() => anchor.current, [])
  return { takeAnchor, peekAnchor }
}
