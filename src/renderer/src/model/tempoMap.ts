/** Default MIDI tempo when a file has no tempo event: 120 BPM. */
export const DEFAULT_MICROSECONDS_PER_BEAT = 500_000

export interface TempoEvent {
  tick: number
  microsecondsPerBeat: number
}

interface TempoSegment {
  tick: number
  seconds: number
  secondsPerTick: number
}

/**
 * Converts between ticks and seconds for a song's tempo changes.
 * Seconds are at the original tempo; playback speed scaling is applied by callers.
 */
export class TempoMap {
  readonly ppq: number
  readonly tempos: readonly TempoEvent[]
  private readonly segments: TempoSegment[]

  constructor(ppq: number, tempos: readonly TempoEvent[]) {
    this.ppq = ppq
    const sorted = [...tempos].sort((a, b) => a.tick - b.tick)
    if (sorted.length === 0 || sorted[0].tick > 0) {
      sorted.unshift({ tick: 0, microsecondsPerBeat: DEFAULT_MICROSECONDS_PER_BEAT })
    }
    // When several tempo events share a tick, the last one wins.
    const deduped: TempoEvent[] = []
    for (const tempo of sorted) {
      if (deduped.length > 0 && deduped[deduped.length - 1].tick === tempo.tick) {
        deduped[deduped.length - 1] = tempo
      } else {
        deduped.push(tempo)
      }
    }
    this.tempos = deduped

    this.segments = []
    let seconds = 0
    for (let i = 0; i < deduped.length; i++) {
      const tempo = deduped[i]
      if (i > 0) {
        const prev = this.segments[i - 1]
        seconds = prev.seconds + (tempo.tick - prev.tick) * prev.secondsPerTick
      }
      this.segments.push({
        tick: tempo.tick,
        seconds,
        secondsPerTick: tempo.microsecondsPerBeat / 1_000_000 / ppq
      })
    }
  }

  tickToSeconds(tick: number): number {
    const segment = this.segments[this.segmentIndexForTick(tick)]
    return segment.seconds + (tick - segment.tick) * segment.secondsPerTick
  }

  secondsToTick(seconds: number): number {
    let index = 0
    for (let i = 1; i < this.segments.length && this.segments[i].seconds <= seconds; i++) index = i
    const segment = this.segments[index]
    return segment.tick + (seconds - segment.seconds) / segment.secondsPerTick
  }

  bpmAt(tick: number): number {
    const tempo = this.tempos[this.segmentIndexForTick(tick)]
    return 60_000_000 / tempo.microsecondsPerBeat
  }

  private segmentIndexForTick(tick: number): number {
    let index = 0
    for (let i = 1; i < this.segments.length && this.segments[i].tick <= tick; i++) index = i
    return index
  }
}
