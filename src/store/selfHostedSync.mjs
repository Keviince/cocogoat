const SESSION_KEY = 'cocogoat.selfhost.session.v1'
const PREFIX = 'cocogoat.v1.'
const TIME_PREFIX = 'cocogoat.v1-t.'
const validKey = (key) => /^[a-zA-Z0-9_.-]{1,80}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)
export function serverEndpoint(value) {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol))
        throw new Error('服务器地址格式不正确')
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw new Error('请使用 HTTPS 服务器地址')
    return url.href.replace(/\/$/, '')
}
const failure = (message, code = 'offline') => Object.assign(new Error(message), { code })

// No Vue or DOM dependencies: the same synchronization engine is exercised in tests.
export class SelfHostedSync {
    constructor({ storage, keys, fetcher = fetch, onState = (_status, _errors) => {}, onRemote = async () => {} }) {
        this.storage = storage
        this.keys = keys
        this.fetcher = fetcher
        this.onState = onState
        this.onRemote = onRemote
        this.session = null
        this.running = null
        this.state = { revisions: {}, clean: {}, pending: {} }
    }
    stateKey() {
        return 'cocogoat.selfhost.state.v1.' + encodeURIComponent(this.session.endpoint + '|' + this.session.account)
    }
    persist() {
        if (this.session) this.storage.setItem(this.stateKey(), JSON.stringify(this.state))
    }
    connection() {
        return this.session ? { endpoint: this.session.endpoint, account: this.session.account } : null
    }
    restore() {
        try {
            const saved = JSON.parse(this.storage.getItem(SESSION_KEY))
            if (!saved) return
            saved.endpoint = serverEndpoint(saved.endpoint)
            this.useSession(saved)
        } catch {
            this.storage.removeItem(SESSION_KEY)
        }
    }
    useSession(session) {
        this.session = session
        try {
            const saved = JSON.parse(this.storage.getItem(this.stateKey()))
            if (
                !saved ||
                ['revisions', 'clean', 'pending'].some(
                    (key) => !saved[key] || typeof saved[key] !== 'object' || Array.isArray(saved[key]),
                )
            )
                throw new Error('Invalid state')
            this.state = saved
        } catch {
            this.state = { revisions: {}, clean: {}, pending: {} }
        }
        this.storage.setItem(SESSION_KEY, JSON.stringify(session))
    }
    async request(path, options = {}, session = this.session) {
        if (!session) throw failure('请先登录自己的服务器', 'auth')
        let response
        try {
            response = await this.fetcher(session.endpoint + '/api' + path, {
                ...options,
                signal: AbortSignal.timeout(15000),
                headers: {
                    'Content-Type': 'application/json',
                    ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
                },
            })
        } catch {
            throw failure('无法连接服务器，数据仍保存在本地')
        }
        let data
        try {
            data = await response.json()
        } catch {
            throw failure('服务器响应格式不正确，请检查地址')
        }
        if (!response.ok)
            throw failure(
                data?.error || '服务器请求失败',
                response.status === 401 ? 'auth' : response.status === 409 ? 'conflict' : 'offline',
            )
        return data
    }
    async login(endpoint, account, password) {
        if (this.running) await this.running
        const normalized = serverEndpoint(endpoint)
        const session = await this.request(
            '/auth/login',
            { method: 'POST', body: JSON.stringify({ account, password }) },
            { endpoint: normalized },
        )
        if (typeof session.token !== 'string' || typeof session.account !== 'string')
            throw failure('服务器登录响应格式无效')
        this.useSession({ ...session, endpoint: normalized })
        return this.sync()
    }
    async logout() {
        const session = this.session
        this.session = null
        this.storage.removeItem(SESSION_KEY)
        this.onState('offline', [])
        if (session) await this.request('/auth/logout', { method: 'POST' }, session).catch(() => {})
    }
    queue(key, value) {
        if (!this.session || !validKey(key)) return
        const raw = value === null ? null : JSON.stringify(value)
        if (this.state.clean[key] === raw) delete this.state.pending[key]
        else this.state.pending[key] = raw
        this.persist()
        this.onState('waitng', [])
    }
    scan() {
        const keys = new Set([
            ...this.keys()
                .filter((name) => name.startsWith(PREFIX))
                .map((name) => name.slice(PREFIX.length)),
            ...Object.keys(this.state.clean),
            ...Object.keys(this.state.pending),
        ])
        for (const key of keys) {
            if (!validKey(key)) continue
            const raw = this.storage.getItem(PREFIX + key)
            if (raw === this.state.clean[key]) delete this.state.pending[key]
            else this.state.pending[key] = raw
        }
        this.persist()
    }
    sync(mode = 'normal') {
        if (this.running) return this.running
        this.running = this.perform(mode).finally(() => {
            this.running = null
        })
        return this.running
    }
    async perform(mode) {
        if (!this.session) return
        const session = this.session
        this.onState('syncing', [])
        try {
            this.scan()
            const remote = await this.request('/records')
            if (this.session !== session) return
            if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw failure('服务器数据格式无效')
            if (mode === 'download') this.state = { revisions: {}, clean: {}, pending: {} }
            const conflicts = new Set()
            let applied = false
            for (const [key, record] of Object.entries(remote)) {
                if (
                    !validKey(key) ||
                    !Number.isSafeInteger(record?.revision) ||
                    record.revision < 1 ||
                    !Object.hasOwn(record, 'value')
                )
                    throw failure('服务器数据格式无效')
                const raw = record.value === null ? null : JSON.stringify(record.value)
                const local = this.storage.getItem(PREFIX + key)
                const dirty = Object.hasOwn(this.state.pending, key)
                if (mode !== 'download' && dirty && local !== raw) {
                    if (mode !== 'upload' && record.revision !== (this.state.revisions[key] || 0)) conflicts.add(key)
                    continue
                }
                if (local !== raw) {
                    if (raw === null) this.storage.removeItem(PREFIX + key)
                    else this.storage.setItem(PREFIX + key, raw)
                    this.storage.setItem(TIME_PREFIX + key, record.lastModified)
                    applied = true
                }
                this.state.revisions[key] = record.revision
                this.state.clean[key] = raw
                delete this.state.pending[key]
            }
            if (mode === 'download') {
                // The explicit restore action replaces the local snapshot entirely.
                for (const name of this.keys().filter((key) => key.startsWith(PREFIX))) {
                    const key = name.slice(PREFIX.length)
                    if (validKey(key) && !Object.hasOwn(remote, key)) {
                        this.storage.removeItem(name)
                        this.storage.removeItem(TIME_PREFIX + key)
                        applied = true
                    }
                }
                this.state.pending = {}
            }
            this.persist()
            if (applied) await this.onRemote()
            if (this.session !== session) return
            for (const [key, raw] of Object.entries({ ...this.state.pending })) {
                if (conflicts.has(key)) continue
                try {
                    const record = await this.request('/records/' + encodeURIComponent(key), {
                        method: 'PUT',
                        body: JSON.stringify({
                            value: raw === null ? null : JSON.parse(raw),
                            revision: this.state.revisions[key] || 0,
                            force: mode === 'upload',
                        }),
                    })
                    if (this.session !== session) return
                    this.state.revisions[key] = record.revision
                    this.state.clean[key] = raw
                    if (this.state.pending[key] === raw) delete this.state.pending[key]
                    if (this.storage.getItem(PREFIX + key) === raw)
                        this.storage.setItem(TIME_PREFIX + key, record.lastModified)
                    this.persist()
                } catch (error) {
                    if (error.code !== 'conflict') throw error
                    conflicts.add(key)
                }
            }
            if (this.session !== session) return
            this.persist()
            if (conflicts.size)
                this.onState('failed', [
                    {
                        code: 'conflict',
                        message: `以下数据在其他设备上发生了变化：${[...conflicts].join('、')}。请选择保留哪一份。`,
                    },
                ])
            else this.onState(Object.keys(this.state.pending).length ? 'waitng' : 'synced', [])
        } catch (error) {
            if (this.session === session) {
                this.persist()
                this.onState('failed', [{ code: error.code || 'offline', message: error.message }])
            }
        }
    }
}
