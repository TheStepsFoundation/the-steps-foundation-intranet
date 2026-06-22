/**
 * Self-contained test for effectiveTestStatus (src/lib/test-client.ts).
 *
 * This repo has no test runner (the gate is `tsc` + live-DB verification), so
 * this file is written to compile and run standalone with the repo's own
 * TypeScript + Node, no new dependencies:
 *
 *   node node_modules/typescript/bin/tsc --target es2020 --module commonjs \
 *     --moduleResolution node --outDir /tmp/ttest \
 *     scripts/effective-test-status.test.ts src/lib/test-client.ts
 *   node /tmp/ttest/scripts/effective-test-status.test.js
 *
 * It asserts the derivation cases AND proves parity with the pre-refactor
 * testOpenNow() logic, so the access gate is guaranteed unchanged.
 */
import assert from 'node:assert/strict'
import { effectiveTestStatus } from '../src/lib/test-client'

const HOUR = 3_600_000
const now = Date.parse('2026-06-22T18:00:00Z')
const past = new Date(now - 24 * HOUR).toISOString()
const future = new Date(now + 24 * HOUR).toISOString()

// status='open' is open (within window)
assert.equal(effectiveTestStatus('open', null, null, now), 'open')
assert.equal(effectiveTestStatus('open', past, future, now), 'open')
// ...but a passed closes_at always wins
assert.equal(effectiveTestStatus('open', past, past, now), 'closed')
// status='closed' is always closed
assert.equal(effectiveTestStatus('closed', past, future, now), 'closed')
// THE Man Group case: draft + opens_at already passed => open (auto-open)
assert.equal(effectiveTestStatus('draft', past, future, now), 'open')
// draft, opened then closed => closed
assert.equal(effectiveTestStatus('draft', past, past, now), 'closed')
// draft + future opens_at => scheduled (locked preview)
assert.equal(effectiveTestStatus('draft', future, future, now), 'scheduled')
// draft + no opens_at => draft (not scheduled yet)
assert.equal(effectiveTestStatus('draft', null, null, now), 'draft')
assert.equal(effectiveTestStatus('draft', null, future, now), 'draft')
// boundary: opens_at exactly now => open
assert.equal(effectiveTestStatus('draft', new Date(now).toISOString(), null, now), 'open')

// Parity: (effective === 'open') must equal the old testOpenNow() for every
// combination of status x opens_at x closes_at.
let checks = 0
for (const status of ['draft', 'open', 'closed'] as const) {
  for (const o of [null, past, future]) {
    for (const c of [null, past, future]) {
      const open = effectiveTestStatus(status, o, c, now) === 'open'
      let legacy: boolean
      if (status === 'closed') legacy = false
      else if (c && now > Date.parse(c)) legacy = false
      else if (status === 'open') legacy = true
      else legacy = !!o && now >= Date.parse(o)
      assert.equal(open, legacy, `parity failed: status=${status} opens=${o} closes=${c}`)
      checks++
    }
  }
}

console.log(`effectiveTestStatus: all assertions passed (+${checks} parity checks)`)
