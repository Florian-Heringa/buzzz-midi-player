import { measureStarts } from './measures'
import type { Song } from './song'

/** Loop range in bars (1-based, inclusive). */
export interface LoopRange {
  enabled: boolean
  startBar: number
  endBar: number
}

/**
 * Applies a change to a loop range and keeps it valid: both bars within 1..barCount and
 * start ≤ end. Moving one end past the other drags the other end along.
 */
export function updateLoop(loop: LoopRange, change: Partial<LoopRange>, barCount: number): LoopRange {
  const clamp = (bar: number): number => Math.max(1, Math.min(barCount, Math.round(bar) || 1))
  let startBar = clamp(change.startBar ?? loop.startBar)
  let endBar = clamp(change.endBar ?? loop.endBar)
  if (startBar > endBar) {
    if (change.endBar !== undefined && change.startBar === undefined) startBar = endBar
    else endBar = startBar
  }
  return { enabled: change.enabled ?? loop.enabled, startBar, endBar }
}

/** Where Stop returns to: the start of the loop when looping is on, otherwise the song start. */
export function stopPosition(song: Song, loop: LoopRange): number {
  if (!loop.enabled) return 0
  return loopTicks(song, loop).start
}

/** The loop's ticks: from the first beat of its start bar to the end of its end bar. */
export function loopTicks(song: Song, loop: LoopRange): { start: number; end: number } {
  const starts = measureStarts(song)
  return {
    start: starts[loop.startBar - 1] ?? 0,
    end: starts[loop.endBar] ?? song.durationTicks
  }
}

/** First beat of the loop's last bar. */
export function lastLoopBarStart(song: Song, loop: LoopRange): number {
  return measureStarts(song)[loop.endBar - 1] ?? 0
}

/**
 * Where playback continues after moving from `previousTick` to `tick`: back at the loop start
 * when it just crossed the loop end, otherwise null (keep going). Playback that started past
 * the loop end (after a seek there) is left alone.
 */
export function loopJump(song: Song, loop: LoopRange, previousTick: number, tick: number): number | null {
  if (!loop.enabled) return null
  const { start, end } = loopTicks(song, loop)
  return previousTick < end && tick >= end ? start : null
}
