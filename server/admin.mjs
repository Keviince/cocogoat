import { FileStore } from './storage.mjs'

const [command, name] = process.argv.slice(2)
if (!['create', 'password'].includes(command) || !name) {
    console.error('用法：node admin.mjs create <UID或账户名>，或 node admin.mjs password <账户名>')
    process.exit(1)
}
const password = await new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write('请输入密码（至少 10 个字符，不会显示）：')
    const raw = process.stdin.isTTY
    if (raw) process.stdin.setRawMode(true)
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    const finish = (error) => {
        if (raw) process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', read)
        process.stdout.write('\n')
        if (error) reject(error)
        else resolve(value)
    }
    const read = (chunk) => {
        for (const char of chunk) {
            if (char === '\u0003') return finish(new Error('已取消'))
            if (char === '\r' || char === '\n') return finish()
            if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
            else value += char
        }
    }
    process.stdin.on('data', read)
    process.stdin.once('end', () => finish())
})
try {
    await new FileStore(process.env.DATA_DIR || '/data').createAccount(name, password, command === 'password')
    console.log(command === 'create' ? '账号已创建' : '密码已更新，旧登录会话已失效')
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
}
