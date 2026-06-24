/**
 * Self-contained tests for the selection-test analytics helpers.
 * Compile + run with the repo's own TypeScript (no test runner):
 *   node node_modules/typescript/bin/tsc --target es2020 --module commonjs \
 *     --moduleResolution node --esModuleInterop --skipLibCheck --outDir /tmp/at \
 *     scripts/test-analytics.test.ts src/lib/test-analytics.ts
 *   node /tmp/at/scripts/test-analytics.test.js
 */
import assert from 'node:assert/strict'
import { scoreHistogram, scoreStats, normalPdf } from '../src/lib/test-analytics'

// scoreHistogram: gap-filled, integer-binned
{
  const h = scoreHistogram([0, 2, 2, 3])
  assert.deepEqual(h, [
    { score: 0, count: 1 },
    { score: 1, count: 0 }, // gap filled
    { score: 2, count: 2 },
    { score: 3, count: 1 },
  ])
  assert.deepEqual(scoreHistogram([]), [])
  assert.equal(scoreHistogram([5, 5, 5]).reduce((a, b) => a + b.count, 0), 3)
}

// scoreStats
{
  const s = scoreStats([1, 2, 3, 4])
  assert.equal(s.n, 4)
  assert.equal(s.mean, 2.5)
  assert.equal(s.median, 2.5)
  assert.equal(s.min, 1)
  assert.equal(s.max, 4)
  assert.equal(scoreStats([2, 4, 4, 4, 5, 5, 7]).median, 4)
  assert.equal(Math.round(scoreStats([2, 4, 4, 4, 5, 5, 7]).stdev * 100) / 100, 1.4)
  const empty = scoreStats([])
  assert.equal(empty.n, 0)
}

// normalPdf: peak at mean, symmetric, falls off
{
  const peak = normalPdf(10, 10, 3)
  assert.ok(normalPdf(7, 10, 3) < peak && normalPdf(13, 10, 3) < peak)
  assert.ok(Math.abs(normalPdf(7, 10, 3) - normalPdf(13, 10, 3)) < 1e-9) // symmetric
  assert.equal(normalPdf(5, 5, 0), 1) // degenerate spike
}

console.log('test-analytics: all assertions passed')
