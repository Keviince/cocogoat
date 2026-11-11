import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

// Use a dedicated project: cleanup must never touch a real deployment's volume.
const project = 'cocogoat-container-test'
const environment = { ...process.env, PORT: '18080', BIND_ADDRESS: '127.0.0.1' }
function compose(args, input) {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', ['compose', '-p', project, ...args], {
            env: environment,
            stdio: ['pipe', 'inherit', 'inherit'],
        })
        child.on('error', reject)
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Compose exited with ${code}`))))
        child.stdin.end(input)
    })
}
const base = 'http://127.0.0.1:18080'
async function api(path, token, value) {
    const response = await fetch(base + '/api' + path, {
        method: value ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(value ? { body: JSON.stringify(value) } : {}),
        signal: AbortSignal.timeout(15000),
    })
    assert.equal(response.status, 200, `Unexpected status for ${path}`)
    return response.json()
}
try {
    await compose(['build', 'sync'])
    await compose(
        ['run', '-T', '--rm', '--no-deps', 'sync', 'node', 'admin.mjs', 'create', 'container-test'],
        'container-fixture-password\n',
    )
    await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'sync'])
    assert.equal((await api('/health')).protocol, 1)
    const page = await fetch(base + '/')
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<html/)
    const login = await api('/auth/login', null, { account: 'container-test', password: 'container-fixture-password' })
    const saved = await fetch(base + '/api/records/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
        body: JSON.stringify({ value: { achievements: [1, 2, 3] }, revision: 0 }),
    })
    assert.equal(saved.status, 200)
    // Recreate the container as an upgrade would, retaining the named volume.
    await compose(['down'])
    await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'sync'])
    const records = await api('/records', login.token)
    assert.deepEqual(records.profile.value.achievements, [1, 2, 3])
    console.log('Container login, bundled website and persistent volume verified.')
} finally {
    await compose(['down', '--volumes', '--remove-orphans'])
}
