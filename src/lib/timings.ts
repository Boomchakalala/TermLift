/**
 * Server timings for the analysis routes (2026-09-11).
 *
 * One timer per request; every stage records its wall-clock milliseconds under a
 * stable key (parse_ms, extract_ms, flags_ms, assemble_ms, email_ms, ...). The
 * result goes on the JSON response as `timings`, into a `Server-Timing` header
 * (visible in the browser's network panel) and into one log line.
 */
export type Timings = Record<string, number>

export interface Timer {
  readonly t: Timings
  /** Time an async stage under `key`; the value is added to any earlier value under the same key. */
  time<T>(key: string, fn: () => Promise<T>): Promise<T>
  /** Record a measured duration directly. */
  mark(key: string, ms: number): void
  /** Milliseconds since the timer was created. */
  elapsed(): number
  /** Snapshot with `total_ms` added. */
  done(): Timings
}

export function createTimer(now: () => number = Date.now): Timer {
  const start = now()
  const t: Timings = {}
  const mark = (key: string, ms: number) => { t[key] = Math.round((t[key] ?? 0) + ms) }
  return {
    t,
    mark,
    async time<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const s = now()
      try { return await fn() } finally { mark(key, now() - s) }
    },
    elapsed: () => now() - start,
    done: () => ({ ...t, total_ms: Math.round(now() - start) }),
  }
}

/** `Server-Timing` header value: `parse;dur=120, extract;dur=4300, ...` (the `_ms` suffix is dropped). */
export function serverTimingHeader(timings: Timings): string {
  return Object.entries(timings)
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => `${k.replace(/_ms$/, '')};dur=${Math.round(v)}`)
    .join(', ')
}

export function logTimings(scope: string, timings: Timings): void {
  console.log(`[TermLift timing] ${scope} ${JSON.stringify(timings)}`)
}
