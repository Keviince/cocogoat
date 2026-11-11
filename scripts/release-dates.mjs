const base = 'https://hk4e-api.mihoyo.com/common/hk4e_cn/announcement/api/'
const query =
    '?game=hk4e&game_biz=hk4e_cn&lang=zh-cn&bundle_id=hk4e_cn&platform=pc&region=cn_gf01&level=55&uid=100000000'

export function announcementText(html) {
    // Some announcement bodies encode the time markup as HTML entities.
    return html
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
}

export function parseReleaseDates(list, content) {
    if (
        list.retcode !== 0 ||
        content.retcode !== 0 ||
        !Array.isArray(list.data?.list) ||
        !Array.isArray(content.data?.list)
    ) {
        throw new Error('Invalid official announcement response')
    }
    const bodies = new Map(content.data.list.map((item) => [item.ann_id, item.content]))
    const releases = {}
    const notices = list.data.list
        .flatMap((group) => group.list)
        .filter((item) => /版本更新(?:说明|维护预告)/.test(`${item.title} ${item.subtitle}`))
        // Previews fill gaps; the final update notice takes precedence.
        .sort((a, b) => Number(/更新说明/.test(a.title)) - Number(/更新说明/.test(b.title)))
    for (const notice of notices) {
        const version = /(\d+\.\d+)\s*版本更新(?:说明|维护预告)/.exec(`${notice.title} ${notice.subtitle}`)?.[1]
        if (!version) continue
        const text = announcementText(bodies.get(notice.ann_id) || notice.content || '')
        const section = /〓(?:更新时间|更新维护信息)〓(.*?)(?:〓|$)/.exec(text)?.[1]
        if (!section) throw new Error(`Official ${version} announcement has no maintenance section`)
        const match =
            /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*开始[，,]?\s*预计\s*(\d+(?:\.\d+)?)\s*个?小时(?:完成|结束)/.exec(
                section,
            )
        if (!match) throw new Error(`Cannot parse official ${version} maintenance time`)
        const [, year, month, day, hour, minute, second = '00', duration] = match
        const start = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+08:00`
        const startMs = Date.parse(start)
        const hours = Number(duration)
        if (!Number.isFinite(startMs) || hours <= 0 || hours > 24)
            throw new Error('Invalid maintenance date or duration')
        releases[version] = {
            maintenanceStart: new Date(startMs).toISOString(),
            expectedReleaseAt: new Date(startMs + hours * 3600000).toISOString(),
            announcementId: notice.ann_id,
            title: notice.title,
            source: base + 'getAnnContent' + query,
        }
    }
    if (!Object.keys(releases).length) throw new Error('No numeric version dates in official announcements')
    return releases
}

export async function fetchReleaseDates(fetcher = fetch) {
    const get = async (method) => {
        const response = await fetcher(base + method + query, { signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error(`Official announcement request failed: ${response.status}`)
        return response.json()
    }
    const [list, content] = await Promise.all([get('getAnnList'), get('getAnnContent')])
    return parseReleaseDates(list, content)
}
