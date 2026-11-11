import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep, basename } from 'node:path'
import { once } from 'node:events'
import { createSyncServer } from './app.mjs'
import { SelfHostedSync, serverEndpoint } from '../src/store/selfHostedSync.mjs'

let fixture, directory, base
const password = 'fixture-password-123'
before(async () => {
    directory = await mkdtemp(resolve('.cache/sync-test-'))
    const webRoot = resolve(directory, 'public')
    await mkdir(webRoot)
    await writeFile(resolve(webRoot, 'index.html'), '<html>fixture website</html>')
    fixture = createSyncServer({ directory, webRoot, allowedOrigins: ['https://keviince.github.io'], loginLimit: 100 })
    fixture.server.listen(0, '127.0.0.1')
    await once(fixture.server, 'listening')
    base = `http://127.0.0.1:${fixture.server.address().port}`
    for (const account of [
        '123456789',
        'other-user',
        'offline-user',
        'conflict-user',
        'delete-user',
        'race-user',
        'restore-user',
        'inflight-user',
        'reset-user',
    ])
        await fixture.store.createAccount(account, password)
})
after(async () => {
    fixture.server.closeAllConnections()
    await new Promise((resolve) => fixture.server.close(resolve))
    assert.ok(directory.startsWith(resolve('.cache') + sep) && basename(directory).startsWith('sync-test-'))
    await rm(directory, { recursive: true, force: true })
})
const api = async (path, { token, method = 'GET', value, origin } = {}) => {
    const response = await fetch(base + '/api' + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(origin ? { Origin: origin } : {}),
        },
        ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    })
    return { status: response.status, data: await response.json() }
}
const login = async (account) => (await api('/auth/login', { method: 'POST', value: { account, password } })).data.token
const localStore = () => {
    const map = new Map()
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => map.set(key, value),
        removeItem: (key) => map.delete(key),
        keys: () => [...map.keys()],
    }
}
const client = (storage = localStore(), fetcher = fetch) => {
    const events = []
    const engine = new SelfHostedSync({
        storage,
        keys: storage.keys,
        fetcher,
        onState: (status, errors) => events.push({ status, errors }),
    })
    return { engine, storage, events }
}
const edit = (device, value, key = '123456789') => {
    if (value === null) device.storage.removeItem('cocogoat.v1.' + key)
    else device.storage.setItem('cocogoat.v1.' + key, JSON.stringify(value))
    device.engine.queue(key, value)
}

test('password authentication, account isolation, session revocation and hashed credentials', async () => {
    assert.equal((await api('/records')).status, 401)
    assert.equal(
        (await api('/auth/login', { method: 'POST', value: { account: '123456789', password: 'wrong' } })).status,
        401,
    )
    const token = await login('123456789')
    assert.equal(
        (
            await api('/records/123456789', {
                token,
                method: 'PUT',
                value: { value: { achievement2: { 1: true } }, revision: 0 },
            })
        ).status,
        200,
    )
    const other = await login('other-user')
    assert.deepEqual((await api('/records', { token: other })).data, {})
    const disk = await readFile(resolve(directory, 'accounts.json'), 'utf8')
    assert.equal(disk.includes(password), false)
    assert.equal(disk.includes(token), false)
    await api('/auth/logout', { token, method: 'POST' })
    assert.equal((await api('/records', { token })).status, 401)
})

test('origin restrictions and key validation protect the file API', async () => {
    assert.equal((await api('/health', { origin: 'https://evil.invalid' })).status, 403)
    assert.equal((await api('/health', { origin: 'https://keviince.github.io' })).status, 200)
    const token = await login('other-user')
    for (const key of ['__proto__', 'constructor', 'bad%2Fkey'])
        assert.equal(
            (await api('/records/' + key, { token, method: 'PUT', value: { value: {}, revision: 0 } })).status,
            400,
        )
    assert.equal((await api('/records/key', { token, method: 'PUT', value: null })).status, 400)
})

test('concurrent writes with the same revision cannot silently overwrite each other', async () => {
    const token = await login('race-user')
    const result = await Promise.all(
        [1, 2].map((number) => api('/records/key', { token, method: 'PUT', value: { value: number, revision: 0 } })),
    )
    assert.deepEqual(result.map((item) => item.status).sort(), [200, 409])
    assert.equal((await fixture.store.records('race-user')).key.revision, 1)
})

test('file data and valid sessions survive a server restart', async () => {
    const token = await login('other-user')
    await api('/records/persistent', { token, method: 'PUT', value: { value: { count: 12 }, revision: 0 } })
    const another = createSyncServer({ directory })
    another.server.listen(0, '127.0.0.1')
    await once(another.server, 'listening')
    try {
        const response = await fetch(`http://127.0.0.1:${another.server.address().port}/api/records`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        assert.equal((await response.json()).persistent.value.count, 12)
    } finally {
        another.server.closeAllConnections()
        await new Promise((resolve) => another.server.close(resolve))
    }
    assert.ok((await readdir(directory)).some((name) => name.endsWith('.bak')))
})

test('two devices preserve offline changes and require an explicit choice for conflicts', async () => {
    const a = client()
    const b = client()
    edit(a, { count: 1 })
    await a.engine.login(base, 'conflict-user', password)
    await b.engine.login(base, 'conflict-user', password)
    assert.deepEqual(JSON.parse(b.storage.getItem('cocogoat.v1.123456789')), { count: 1 })
    edit(a, { count: 2 })
    await a.engine.sync()
    edit(b, { count: 3 })
    await b.engine.sync()
    assert.equal(b.events.at(-1).errors[0].code, 'conflict')
    assert.equal((await fixture.store.records('conflict-user'))['123456789'].value.count, 2)
    assert.equal(JSON.parse(b.storage.getItem('cocogoat.v1.123456789')).count, 3)
    await b.engine.sync('upload')
    await a.engine.sync()
    assert.equal(JSON.parse(a.storage.getItem('cocogoat.v1.123456789')).count, 3)
})

test('pending edits survive a page reload and retry after the network recovers', async () => {
    let offline = false
    const fetcher = (...args) => {
        if (offline) throw new Error('offline')
        return fetch(...args)
    }
    const a = client(localStore(), fetcher)
    await a.engine.login(base, 'offline-user', password)
    offline = true
    edit(a, { count: 7 })
    await a.engine.sync()
    assert.equal(a.events.at(-1).status, 'failed')
    const reopened = client(a.storage, fetcher)
    reopened.engine.restore()
    offline = false
    await reopened.engine.sync()
    assert.equal((await fixture.store.records('offline-user'))['123456789'].value.count, 7)
    assert.equal(reopened.events.at(-1).status, 'synced')
})

test('revisioned deletions propagate to clean devices without resurrection', async () => {
    const a = client()
    const b = client()
    edit(a, { count: 1 })
    await a.engine.login(base, 'delete-user', password)
    await b.engine.login(base, 'delete-user', password)
    edit(a, null)
    await a.engine.sync()
    await b.engine.sync()
    assert.equal(b.storage.getItem('cocogoat.v1.123456789'), null)
    assert.equal((await fixture.store.records('delete-user'))['123456789'].value, null)
    await b.engine.sync()
    assert.equal((await fixture.store.records('delete-user'))['123456789'].revision, 2)
})

test('explicit cloud restore replaces conflicting local data; logout retains local progress', async () => {
    const a = client()
    const b = client()
    edit(a, { count: 4 })
    await a.engine.login(base, 'restore-user', password)
    edit(b, { count: 8 })
    edit(b, { localOnly: true }, 'local-user')
    await b.engine.login(base, 'restore-user', password)
    assert.equal(b.events.at(-1).status, 'failed')
    await b.engine.sync('download')
    assert.equal(JSON.parse(b.storage.getItem('cocogoat.v1.123456789')).count, 4)
    await b.engine.logout()
    assert.equal(b.storage.getItem('cocogoat.selfhost.session.v1'), null)
    assert.equal(JSON.parse(b.storage.getItem('cocogoat.v1.123456789')).count, 4)
})

test('credentials never go into a URL and insecure remote server addresses are rejected', () => {
    assert.throws(() => serverEndpoint('http://example.com'))
    assert.throws(() => serverEndpoint('https://user:password@example.com'))
    assert.throws(() => serverEndpoint('https://example.com?token=secret'))
    assert.equal(serverEndpoint('https://example.com/'), 'https://example.com')
})

test('bundled pages allow the offline worker and cannot expose account files', async () => {
    const page = await fetch(base + '/')
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('Service-Worker-Allowed'), '/')
    assert.match(await page.text(), /fixture website/)
    assert.equal((await fetch(base + '/..%2Faccounts.json')).status, 404)
    const apiResponse = await fetch(base + '/api/records')
    assert.equal(apiResponse.status, 401)
    assert.match(apiResponse.headers.get('Content-Type'), /application\/json/)
})

test('password reset revokes old sessions without deleting progress', async () => {
    const token = await login('reset-user')
    await api('/records/profile', { token, method: 'PUT', value: { value: { count: 9 }, revision: 0 } })
    await fixture.store.createAccount('reset-user', 'replacement-fixture-password', true)
    assert.equal((await api('/records', { token })).status, 401)
    assert.equal((await api('/auth/login', { method: 'POST', value: { account: 'reset-user', password } })).status, 401)
    const replacement = await api('/auth/login', {
        method: 'POST',
        value: { account: 'reset-user', password: 'replacement-fixture-password' },
    })
    assert.equal(replacement.status, 200)
    assert.equal((await api('/records', { token: replacement.data.token })).data.profile.value.count, 9)
    await assert.rejects(fixture.store.createAccount('missing-user', password, true), /账号不存在/)
})

test('edits made while an upload is in flight remain pending and upload on the next pass', async () => {
    let hold = false,
        release,
        arrived
    const fetcher = async (url, options) => {
        if (hold && options.method === 'PUT') {
            hold = false
            arrived()
            await new Promise((resolve) => {
                release = resolve
            })
        }
        return fetch(url, options)
    }
    const a = client(localStore(), fetcher)
    await a.engine.login(base, 'inflight-user', password)
    edit(a, { count: 1 })
    hold = true
    const uploading = new Promise((resolve) => {
        arrived = resolve
    })
    const running = a.engine.sync()
    await uploading
    edit(a, { count: 2 })
    release()
    await running
    assert.equal(a.events.at(-1).status, 'waitng')
    await a.engine.sync()
    assert.equal((await fixture.store.records('inflight-user'))['123456789'].value.count, 2)
    assert.equal(a.events.at(-1).status, 'synced')
})

test('failed login attempts are rate limited', async () => {
    const limited = createSyncServer({ directory, loginLimit: 2 })
    limited.server.listen(0, '127.0.0.1')
    await once(limited.server, 'listening')
    try {
        const endpoint = `http://127.0.0.1:${limited.server.address().port}/api/auth/login`
        for (const status of [401, 401, 429]) {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account: 'unknown-user', password }),
            })
            assert.equal(response.status, status)
            await response.text()
        }
    } finally {
        limited.server.closeAllConnections()
        await new Promise((resolve) => limited.server.close(resolve))
    }
})
