import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReleaseDates, fetchReleaseDates } from './release-dates.mjs'

const notice = (id, title = '7.2版本更新说明') => ({ ann_id: id, title, start_time: '2026-11-04 07:00:00' })
const list = (...items) => ({ retcode: 0, data: { list: [{ list: items }] } })
const content = (html, id = 1) => ({ retcode: 0, data: { list: [{ ann_id: id, content: html }] } })
const body =
    '补偿范围2026/11/01 06:00前。〓更新时间〓&lt;t&gt;2026/11/04 06:00&lt;/t&gt;开始，预计5个小时完成。〓客户端更新方式〓其他日期2026/11/07 06:00'

test('extracts maintenance section, ignores announcement and compensation times, and uses China timezone', () => {
    const value = parseReleaseDates(list(notice(1)), content(body))['7.2']
    assert.equal(value.maintenanceStart, '2026-11-03T22:00:00.000Z')
    assert.equal(value.expectedReleaseAt, '2026-11-04T03:00:00.000Z')
    assert.equal(value.announcementId, 1)
})

test('supports maintenance previews and a duration crossing midnight', () => {
    const value = parseReleaseDates(
        list(notice(1, '7.3版本更新维护预告')),
        content('〓更新维护信息〓2026/12/15 23:30开始，预计2小时完成。'),
    )['7.3']
    assert.equal(value.expectedReleaseAt, '2026-12-15T17:30:00.000Z')
})

test('does not treat preload dates, unrelated notices or malformed official responses as release dates', () => {
    assert.throws(() => parseReleaseDates(list(notice(1)), content('预下载2026/11/02 06:00')))
    assert.throws(() => parseReleaseDates(list(notice(1, '7.2版本预下载')), content(body)))
    assert.throws(() => parseReleaseDates({ retcode: -1 }, content(body)))
})

test('final update announcement overrides the preview', () => {
    const result = parseReleaseDates(list(notice(1), notice(2, '7.2版本更新维护预告')), {
        retcode: 0,
        data: {
            list: [
                { ann_id: 1, content: body },
                { ann_id: 2, content: body.replace('5个小时', '4个小时') },
            ],
        },
    })
    assert.equal(result['7.2'].announcementId, 1)
})

test('HTTP errors are surfaced so the caller can retain its archived dates', async () => {
    await assert.rejects(
        fetchReleaseDates(async () => ({ ok: false, status: 503 })),
        /503/,
    )
})
