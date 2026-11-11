import { mkdir, readFile, open, rename, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const accountName = (value) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{2,63}$/.test(value)) {
        throw Object.assign(new Error('账号名须为 3–64 位字母、数字、下划线、点或横线，也可以使用 UID'), {
            status: 400,
        })
    }
    const name = value.toLowerCase()
    if (['__proto__', 'constructor', 'prototype'].includes(name))
        throw Object.assign(new Error('账号名不可用'), { status: 400 })
    return name
}
export const validKey = (key) =>
    /^[a-zA-Z0-9_.-]{1,80}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)

export class FileStore {
    constructor(directory) {
        this.directory = resolve(directory)
        this.locks = new Map()
    }
    async read(name, fallback) {
        try {
            return JSON.parse(await readFile(resolve(this.directory, name), 'utf8'))
        } catch (error) {
            if (error.code === 'ENOENT') return fallback
            throw error
        }
    }
    async write(name, value) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const target = resolve(this.directory, name)
        const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
        const handle = await open(temporary, 'wx', 0o600)
        try {
            await handle.writeFile(JSON.stringify(value))
            await handle.sync()
        } finally {
            await handle.close()
        }
        try {
            await copyFile(target, `${target}.bak`)
        } catch (error) {
            if (error.code !== 'ENOENT') throw error
        }
        await rename(temporary, target)
    }
    async locked(name, action) {
        const previous = this.locks.get(name) || Promise.resolve()
        const task = previous.catch(() => {}).then(action)
        this.locks.set(name, task)
        try {
            return await task
        } finally {
            if (this.locks.get(name) === task) this.locks.delete(name)
        }
    }
    async createAccount(name, password, reset = false) {
        const account = accountName(name)
        if (typeof password !== 'string' || password.length < 10 || password.length > 128)
            throw new Error('密码须为 10–128 个字符')
        const salt = randomBytes(16).toString('hex')
        const hash = (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString(
            'hex',
        )
        await this.locked('auth', async () => {
            const auth = await this.read('accounts.json', { accounts: {}, sessions: {} })
            if (reset && !Object.hasOwn(auth.accounts, account)) throw new Error('账号不存在')
            if (Object.hasOwn(auth.accounts, account) && !reset)
                throw new Error('账号已存在，修改密码请使用 password 命令')
            auth.accounts[account] = { salt, hash }
            for (const [key, session] of Object.entries(auth.sessions))
                if (session.account === account) delete auth.sessions[key]
            await this.write('accounts.json', auth)
        })
    }
    async login(name, password) {
        let account
        try {
            account = accountName(name)
        } catch {
            account = ''
        }
        if (typeof password !== 'string' || password.length > 128) return null
        const auth = await this.read('accounts.json', { accounts: {}, sessions: {} })
        const user = Object.hasOwn(auth.accounts, account) ? auth.accounts[account] : null
        // Derive a hash even for unknown accounts to avoid an enumeration shortcut.
        const computed = await derive(password, user?.salt || '00000000000000000000000000000000', 64, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 64 * 1024 * 1024,
        })
        if (!user || !timingSafeEqual(computed, Buffer.from(user.hash, 'hex'))) return null
        return this.locked('auth', async () => {
            const latest = await this.read('accounts.json', { accounts: {}, sessions: {} })
            if (latest.accounts[account]?.hash !== user.hash) return null
            const token = randomBytes(32).toString('base64url')
            const expiresAt = Date.now() + 30 * 86400000
            for (const [key, session] of Object.entries(latest.sessions))
                if (session.expiresAt < Date.now()) delete latest.sessions[key]
            const existing = Object.entries(latest.sessions)
                .filter(([, session]) => session.account === account)
                .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
            for (const [key] of existing.slice(0, Math.max(0, existing.length - 19))) delete latest.sessions[key]
            latest.sessions[digest(token)] = { account, expiresAt }
            await this.write('accounts.json', latest)
            return { account, token, expiresAt }
        })
    }
    async session(token) {
        if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return null
        const auth = await this.read('accounts.json', { accounts: {}, sessions: {} })
        const session = auth.sessions[digest(token)]
        return session?.expiresAt > Date.now() ? session : null
    }
    async logout(token) {
        await this.locked('auth', async () => {
            const auth = await this.read('accounts.json', { accounts: {}, sessions: {} })
            delete auth.sessions[digest(token)]
            await this.write('accounts.json', auth)
        })
    }
    file(account) {
        return `records-${digest(accountName(account))}.json`
    }
    async records(account) {
        return this.read(this.file(account), {})
    }
    async save(account, key, value, expectedRevision, force = false) {
        if (!validKey(key)) throw Object.assign(new Error('无效的数据名称'), { status: 400 })
        const file = this.file(account)
        return this.locked(file, async () => {
            const records = await this.read(file, {})
            const current = records[key]?.revision || 0
            if (!force && current !== expectedRevision)
                throw Object.assign(new Error('服务器数据已更新，请处理同步冲突'), { status: 409 })
            const record = { value, revision: current + 1, lastModified: new Date().toISOString() }
            records[key] = record // null values are revisioned tombstones, never silently resurrected.
            if (Buffer.byteLength(JSON.stringify(records)) > 16 * 1024 * 1024)
                throw Object.assign(new Error('账号数据超过 16 MB'), { status: 413 })
            await this.write(file, records)
            return record
        })
    }
}
