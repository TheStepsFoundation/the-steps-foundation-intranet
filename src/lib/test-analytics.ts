// ---------------------------------------------------------------------------
// Pure, client-safe analytics helpers for the selection-test dashboard.
// No imports, no side effects — safe to unit-test standalone and to import
// into the admin test page (a client component).
// ---------------------------------------------------------------------------

export type HistogramBin = { score: number; count: number }

/**
 * Number of students at each integer score from 0..max, with empty scores
 * filled in as 0 so the distribution's shape (ideally a bell) reads correctly
 * rather than collapsing gaps. Non-finite values are dropped; scores are
 * rounded and floored at 0.
 */
export function scoreHistogram(scores: number[]): HistogramBin[] {
  const clean = scores.filter(s => Number.isFinite(s)).map(s => Math.max(0, Math.round(s)))
  if (clean.length === 0) return []
  const max = Math.max(...clean)
  const bins = new Array<number>(max + 1).fill(0)
  for (const s of clean) bins[s] += 1
  return bins.map((count, score) => ({ score, count }))
}

export type ScoreStats = {
  n: number
  mean: number
  median: number
  min: number
  max: number
  stdev: number
}

/** Summary stats over a set of scores (population standard deviation). */
export function scoreStats(scores: number[]): ScoreStats {
  const clean = scores.filter(s => Number.isFinite(s))
  const n = clean.length
  if (n === 0) return { n: 0, mean: 0, median: 0, min: 0, max: 0, stdev: 0 }
  const sorted = [...clean].sort((a, b) => a - b)
  const mean = clean.reduce((a, b) => a + b, 0) / n
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  return { n, mean, median, min: sorted[0], max: sorted[n - 1], stdev: Math.sqrt(variance) }
}

/**
 * Normal (Gaussian) probability density — used to overlay a fitted bell curve
 * on the score histogram. With stdev <= 0 it degenerates to a spike at the mean.
 */
export function normalPdf(x: number, mean: number, stdev: number): number {
  if (stdev <= 0) return x === mean ? 1 : 0
  const z = (x - mean) / stdev
  return Math.exp(-0.5 * z * z) / (stdev * Math.sqrt(2 * Math.PI))
}
