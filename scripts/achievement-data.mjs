import { execFileSync } from 'node:child_process'

export function git(repo, ...args) {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

export function releaseVersion(packageVersion) {
    const match = /^1\.0\.0-CNRELWin(\d+)\.(\d+)\.\d+$/.exec(packageVersion)
    if (!match) return null // Do not publish beta or unrecognized builds.
    if (Number(match[2]) > 9) throw new Error('The UI needs string versions before minor versions reach 10')
    return Number(`${Number(match[1])}.${Number(match[2])}`)
}

export function snapshot(repo, commit) {
    const pkg = JSON.parse(git(repo, 'show', `${commit}:package.json`))
    const version = releaseVersion(pkg.version)
    if (version === null) return null
    const categories = JSON.parse(git(repo, 'show', `${commit}:json/achievements/index.json`))
    const ids = []
    const seen = new Set()
    if (!Array.isArray(categories) || !categories.length) throw new Error('Empty achievement data')
    for (const category of categories) {
        if (!Array.isArray(category.achievements)) throw new Error('Invalid achievement category')
        for (const achievement of category.achievements) {
            if (!Number.isSafeInteger(achievement.id) || achievement.id <= 0 || seen.has(achievement.id)) {
                throw new Error(`Invalid or duplicate achievement ID: ${achievement.id}`)
            }
            seen.add(achievement.id)
            ids.push(achievement.id)
        }
    }
    if (!ids.length) throw new Error('Empty achievement list')
    return { commit, version, ids, observedAt: git(repo, 'show', '-s', '--format=%cI', commit) }
}

// Keep existing manual corrections. Replay every release snapshot so missed runs
// cannot assign several versions of new achievements to the newest version.
export function mergeSnapshots(metadata, observations, baseline, snapshots) {
    const versions = { ...metadata }
    const dates = { ...observations }
    let latest = baseline
    for (const id of baseline.ids) {
        if (!Number.isFinite(versions[id])) throw new Error(`Baseline achievement ${id} has no version`)
    }
    for (const item of snapshots) {
        if (!item || item.version < latest.version) continue
        const missing = latest.ids.filter((id) => !item.ids.includes(id))
        if (missing.length)
            throw new Error(`Upstream removed ${missing.length} achievements; refusing automatic publication`)
        for (const id of item.ids) {
            if (!(id in versions)) versions[id] = item.version
        }
        const key = item.version.toFixed(1)
        if (!dates[key]) dates[key] = item.observedAt
        latest = item
    }
    for (const id of latest.ids) {
        if (!Number.isFinite(versions[id])) throw new Error(`Achievement ${id} has no version`)
    }
    return { versions, dates, latest }
}
