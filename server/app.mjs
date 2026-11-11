import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { FileStore } from './storage.mjs'

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
}
const body = async (request) => {
    if (!(request.headers['content-type'] || '').startsWith('application/json'))
        throw Object.assign(new Error('需要 JSON 请求'), { status: 415 })
    const chunks = []
    let bytes = 0
    for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 2 * 1024 * 1024) throw Object.assign(new Error('请求超过 2 MB'), { status: 413 })
        chunks.push(chunk)
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw Object.assign(new Error('JSON 格式无效'), { status: 400 })
    }
}

export function createSyncServer({ directory, webRoot, allowedOrigins = [], loginLimit = 10 } = {}) {
    const store = new FileStore(directory || './data')
    const attempts = new Map()
    let loginRequests = 0
    const server = createServer(async (request, response) => {
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.setHeader('Referrer-Policy', 'no-referrer')
        response.setHeader('Cache-Control', 'no-store')
        const send = (status, value) => {
            response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
            response.end(JSON.stringify(value))
        }
        try {
            const url = new URL(request.url, 'http://localhost')
            const origin = request.headers.origin
            if (origin) {
                let sameHost = false
                try {
                    sameHost = new URL(origin).host === request.headers.host
                } catch {}
                if (!sameHost && !allowedOrigins.includes(origin))
                    return send(403, { error: '该网页来源未获允许，请检查 ALLOWED_ORIGINS' })
                response.setHeader('Access-Control-Allow-Origin', origin)
                response.setHeader('Vary', 'Origin')
                response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
                response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            }
            if (request.method === 'OPTIONS') {
                response.writeHead(204)
                return response.end()
            }
            if (request.method === 'GET' && url.pathname === '/api/health')
                return send(200, { service: 'cocogoat-selfhost', protocol: 1 })
            if (request.method === 'POST' && url.pathname === '/api/auth/login') {
                const address = request.socket.remoteAddress || 'local'
                const now = Date.now()
                for (const [key, value] of attempts) if (value.until < now) attempts.delete(key)
                const attempt = attempts.get(address) || { count: 0, until: now + 15 * 60000 }
                if (attempt.count >= loginLimit || loginRequests >= 4 || attempts.size > 10000)
                    return send(429, { error: '登录尝试过于频繁，请稍后再试' })
                attempt.count++
                attempts.set(address, attempt)
                const credentials = await body(request)
                if (!credentials || typeof credentials !== 'object') return send(400, { error: '登录数据格式无效' })
                if (loginRequests >= 4) return send(429, { error: '登录尝试过于频繁，请稍后再试' })
                loginRequests++
                let session
                try {
                    session = await store.login(credentials.account, credentials.password)
                } finally {
                    loginRequests--
                }
                if (!session) return send(401, { error: '账号或密码不正确' })
                attempts.delete(address)
                return send(200, session)
            }
            if (url.pathname.startsWith('/api/')) {
                const token = (request.headers.authorization || '').replace(/^Bearer /, '')
                const session = await store.session(token)
                if (!session) return send(401, { error: '登录已失效，请重新登录' })
                if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
                    await store.logout(token)
                    return send(200, { ok: true })
                }
                if (request.method === 'GET' && url.pathname === '/api/records')
                    return send(200, await store.records(session.account))
                const match = /^\/api\/records\/([^/]+)$/.exec(url.pathname)
                if (request.method === 'PUT' && match) {
                    const payload = await body(request)
                    if (
                        !payload ||
                        !Object.hasOwn(payload, 'value') ||
                        !Number.isSafeInteger(payload.revision) ||
                        payload.revision < 0
                    )
                        return send(400, { error: '数据格式无效' })
                    const value = await store.save(
                        session.account,
                        decodeURIComponent(match[1]),
                        payload.value,
                        payload.revision,
                        payload.force === true,
                    )
                    return send(200, value)
                }
                return send(404, { error: '接口不存在' })
            }
            if (!webRoot || !['GET', 'HEAD'].includes(request.method)) return send(404, { error: '页面不存在' })
            const root = resolve(webRoot)
            const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
            if (!path.startsWith(root + sep)) return send(404, { error: '页面不存在' })
            const info = await stat(path).catch(() => null)
            if (!info?.isFile()) return send(404, { error: '页面不存在' })
            response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream')
            if (/\.[a-f0-9]{8}\./.test(path)) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            response.setHeader('Content-Length', info.size)
            response.end(request.method === 'HEAD' ? undefined : await readFile(path))
        } catch (error) {
            if (!response.headersSent)
                send(error.status || 500, {
                    error: error.status ? error.message : '服务器处理失败，请检查日志与数据目录',
                })
            if (!error.status) console.error('Request failed:', error.code || error.name) // Never log request bodies or credentials.
        }
    })
    server.requestTimeout = 30000
    server.headersTimeout = 15000
    return { server, store }
}
