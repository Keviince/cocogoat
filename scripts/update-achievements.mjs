import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, snapshot, mergeSnapshots } from './achievement-data.mjs'
import { fetchReleaseDates } from './release-dates.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataRepo = resolve(root, 'src/generated/amos-data')
const statePath = resolve(root, 'src/generated/achievementSync.json')
const metaPath = resolve(root, 'src/generated/versionMeta.json')
const datesPath = resolve(root, 'src/generated/versionObserved.json')
const releasePath = resolve(root, 'src/generated/versionRelease.json')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const state = read(statePath)
if (!/^[a-f0-9]{40}$/.test(state.commit)) throw new Error('Invalid synchronization cursor')
if (process.argv.includes('--fetch')) {
    if (git(dataRepo, 'rev-parse', '--is-shallow-repository') === 'true') {
        git(dataRepo, 'fetch', '--unshallow', 'origin')
    }
    git(dataRepo, 'fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main')
}
const head = git(dataRepo, 'rev-parse', 'refs/remotes/origin/main')
git(dataRepo, 'merge-base', '--is-ancestor', state.commit, head)
const baseline = snapshot(dataRepo, state.commit)
if (!baseline) throw new Error('Synchronization cursor must point to a formal release')
const commits = git(dataRepo, 'rev-list', '--first-parent', '--reverse', `${state.commit}..${head}`)
    .split('\n')
    .filter(Boolean)
const result = mergeSnapshots(
    read(metaPath),
    read(datesPath),
    baseline,
    commits.map((sha) => snapshot(dataRepo, sha)),
)
let releases = read(releasePath)
if (process.argv.includes('--fetch')) {
    try {
        releases = { ...releases, ...(await fetchReleaseDates()) }
    } catch (error) {
        console.warn(`Keeping archived official release dates: ${error.message}. Unknown versions stay hidden.`)
    }
}
// Resolve and validate everything before changing files or the checked-out data.
git(dataRepo, 'checkout', '--detach', result.latest.commit)
const write = (path, value) => fs.writeFileSync(path, JSON.stringify(value, null, 4) + '\n')
write(metaPath, result.versions)
write(datesPath, result.dates)
write(releasePath, releases)
write(statePath, { commit: result.latest.commit, version: result.latest.version.toFixed(1) })
const changed = !!git(root, 'status', '--porcelain', '--', 'src/generated')
const summary = `Upstream ${result.latest.commit}; version ${result.latest.version.toFixed(1)}; ${result.latest.ids.length} achievements; changed=${changed}`
console.log(summary)
if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nversion=${result.latest.version.toFixed(1)}\n`)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
