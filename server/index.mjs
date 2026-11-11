import { createSyncServer } from './app.mjs'
const { server } = createSyncServer({
    directory: process.env.DATA_DIR || '/data',
    webRoot: process.env.WEB_ROOT || '/app/public',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
})
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Cocogoat self-hosted server is ready'))
const stop = () => server.close(() => process.exit(0))
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
