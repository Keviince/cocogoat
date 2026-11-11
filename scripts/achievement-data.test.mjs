import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSnapshots, releaseVersion } from './achievement-data.mjs'

const entry = (version, ids, commit = String(version)) => ({ version, ids, commit, observedAt: '2026-11-11T00:00:00Z' })

test('only recognized formal releases are accepted', () => {
    assert.equal(releaseVersion('1.0.0-CNRELWin7.2.0'), 7.2)
    assert.equal(releaseVersion('1.0.0-CNBETAWin7.3.0'), null)
    assert.equal(releaseVersion('1.0.0-CNRELWin7.3.0_Unk_NoBin'), null)
    assert.throws(() => releaseVersion('1.0.0-CNRELWin7.10.0'))
})

test('missed releases are attributed separately and manual corrections survive', () => {
    const result = mergeSnapshots({ 1: 1, 2: 7.1 }, {}, entry(7.1, [1, 2]), [
        entry(7.2, [1, 2, 3]),
        entry(7.3, [1, 2, 3, 4]),
    ])
    assert.deepEqual(result.versions, { 1: 1, 2: 7.1, 3: 7.2, 4: 7.3 })
    assert.equal(result.latest.version, 7.3)
})

test('same version corrections and delayed data are synchronized', () => {
    const result = mergeSnapshots({ 1: 7.2 }, {}, entry(7.2, [1]), [entry(7.2, [1, 2], 'fix')])
    assert.equal(result.versions[2], 7.2)
    assert.equal(result.latest.commit, 'fix')
})

test('beta snapshots and rollbacks do not move the cursor', () => {
    const baseline = entry(7.2, [1])
    assert.equal(mergeSnapshots({ 1: 7.2 }, {}, baseline, [null, entry(7.1, [1])]).latest, baseline)
})

test('data removal and unmapped baseline fail instead of silently publishing', () => {
    assert.throws(() => mergeSnapshots({ 1: 7.1 }, {}, entry(7.1, [1]), [entry(7.2, [2])]), /removed/)
    assert.throws(() => mergeSnapshots({}, {}, entry(7.1, [1]), []), /no version/)
})

test('repeat runs preserve metadata and the first observation time', () => {
    const baseline = entry(7.2, [1])
    const first = mergeSnapshots({ 1: 7.2 }, { 7.2: '2026-11-04T00:00:00Z' }, baseline, [entry(7.2, [1, 2])])
    const second = mergeSnapshots(first.versions, first.dates, first.latest, [])
    assert.deepEqual(second, first)
    assert.equal(second.dates['7.2'], '2026-11-04T00:00:00Z')
})
