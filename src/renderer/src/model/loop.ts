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
