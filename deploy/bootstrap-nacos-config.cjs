'use strict'

/** SRM 部署前 Nacos 配置校验；只读，不创建、清理或回写人工配置。 */

function required(name, environment = process.env, trim = true) {
    const raw = environment[name]
    if (typeof raw !== 'string' || raw.length === 0 || (trim && !raw.trim())) throw new Error(`缺少环境变量：${name}`)
    return trim ? raw.trim() : raw
}

function getBaseUrl() {
    const server = required('NACOS_SERVER')
    return (/^https?:\/\//i.test(server) ? server : `http://${server}`).replace(/\/$/, '')
}

async function getNacosAccessToken() {
    const username = process.env.NACOS_USERNAME?.trim()
    const password = process.env.NACOS_PASSWORD
    if (!username || password === undefined) return undefined
    const response = await fetch(`${getBaseUrl()}/nacos/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password })
    })
    if (!response.ok) throw new Error(`Nacos 鉴权失败：HTTP ${response.status}`)
    const result = await response.json()
    if (typeof result.accessToken !== 'string' || !result.accessToken.trim()) throw new Error('Nacos 鉴权响应缺少 accessToken')
    return result.accessToken
}

async function configUrl(dataId) {
    const parameters = new URLSearchParams({
        dataId,
        group: process.env.NACOS_CONFIG_GROUP?.trim() || process.env.NACOS_GROUP?.trim() || 'DEFAULT_GROUP',
        tenant: process.env.NACOS_NAMESPACE?.trim() || 'public'
    })
    const accessToken = await getNacosAccessToken()
    if (accessToken) parameters.set('accessToken', accessToken)
    return `${getBaseUrl()}/nacos/v1/cs/configs?${parameters}`
}

async function readConfig(dataId) {
    const response = await fetch(await configUrl(dataId))
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`读取 SRM Nacos 配置失败：HTTP ${response.status}`)
    const content = await response.text()
    return content.trim() ? content : undefined
}

function normalizeContent(content) {
    return `${content.replace(/\r\n?/g, '\n').trim()}\n`
}

function scalar(value) {
    return JSON.stringify(value)
}

function createRedisConfig(environment = process.env) {
    const port = Number(environment.REDIS_PORT || 6379)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('REDIS_PORT 必须是 1-65535 之间的整数')
    const timeout = Number(environment.REDIS_CONNECT_TIMEOUT_MS || 5000)
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000)
        throw new Error('REDIS_CONNECT_TIMEOUT_MS 必须是 100-60000 之间的整数')
    const tls = environment.REDIS_TLS === undefined || environment.REDIS_TLS === '' ? false : environment.REDIS_TLS === 'true'
    if (environment.REDIS_TLS !== undefined && environment.REDIS_TLS !== '' && !['true', 'false'].includes(environment.REDIS_TLS))
        throw new Error('REDIS_TLS 必须是 true 或 false')
    const database = Number(environment.REDIS_DATABASE || 4)
    if (!Number.isInteger(database) || database < 0 || database > 15) throw new Error('REDIS_DATABASE 必须是 0-15 之间的整数')
    const lines = [
        'redis:',
        `  host: ${scalar(environment.REDIS_HOST?.trim() || 'chat-web-redis')}`,
        `  port: ${port}`,
        `  database: ${database}`,
        `  tls: ${tls}`,
        `  connectTimeoutMs: ${timeout}`
    ]
    for (const [key, name] of [
        ['REDIS_URL', 'url'],
        ['REDIS_USERNAME', 'username'],
        ['REDIS_PASSWORD', 'password']
    ]) {
        if (environment[key] !== undefined && environment[key] !== '') lines.push(`  ${name}: ${scalar(environment[key])}`)
    }
    return `${lines.join('\n')}\n`
}

function createSrmConfig(environment = process.env) {
    const database = required('SRM_MYSQL_DATABASE', environment)
    if (database !== 'chat-web-srm') throw new Error('SRM_MYSQL_DATABASE 必须为 chat-web-srm')
    const port = Number(environment.SRM_MYSQL_PORT || 3306)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SRM_MYSQL_PORT 必须是 1-65535 之间的整数')
    const token = environment.SRM_SERVICE_TOKEN || environment.FINANCE_SERVICE_TOKEN
    const gateway =
        token || environment.GATEWAY_PRINCIPAL_SECRET
            ? `gateway:\n${
                  token
                      ? `  feign:\n    service_token: ${scalar(token)}\n    url: ${scalar(environment.GATEWAY_SERVICE_URL || 'http://chat-web-gateway-service:5000')}\n    timeout: ${Number(environment.GATEWAY_SERVICE_TIMEOUT_MS || 3000)}\n`
                      : ''
              }${
                  environment.GATEWAY_PRINCIPAL_SECRET
                      ? `  principal:\n    secret: ${scalar(environment.GATEWAY_PRINCIPAL_SECRET)}\n    maxAgeSeconds: ${Number(environment.GATEWAY_PRINCIPAL_MAX_AGE_SECONDS || 60)}\n`
                      : ''
              }`
            : ''
    const server = `server:\n  port: 5070\n`
    return `${server}${gateway}database:\n  chat-web-srm:\n    host: ${scalar(required('SRM_MYSQL_HOST', environment))}\n    port: ${port}\n    name: ${scalar(database)}\n    username: ${scalar(required('SRM_MYSQL_USERNAME', environment))}\n    password: ${scalar(required('SRM_MYSQL_PASSWORD', environment, false))}\n    charset: ${scalar(environment.SRM_MYSQL_CHARSET?.trim() || 'utf8mb4')}\n    timezone: ${scalar(environment.SRM_MYSQL_TIMEZONE?.trim() || '+08:00')}\n${createRedisConfig(environment)}`
}

function findServiceBlock(lines, name) {
    const start = lines.findIndex(line => line.trim() === `${name}:` && line.startsWith('  '))
    if (start < 0) return undefined
    const end = lines.findIndex((line, index) => index > start && line.trim() && !line.startsWith('    '))
    return { start, end: end < 0 ? lines.length : end }
}

function validateGatewayFeign(lines) {
    const block = findServiceBlock(lines, 'feign')
    if (!block) throw new Error('SRM Nacos 配置缺少 gateway.feign')
    const scoped = lines.slice(block.start + 1, block.end)
    const tokenLine = scoped.find(line => /^    service_token:\s*/.test(line))
    const urlLine = scoped.find(line => /^    url:\s*/.test(line))
    const timeoutLine = scoped.find(line => /^    timeout:\s*/.test(line))
    if (!tokenLine || !tokenLine.replace(/^    service_token:\s*/, '').trim()) {
        throw new Error('SRM Nacos 配置缺少 gateway.feign.service_token')
    }
    if (!urlLine || !urlLine.replace(/^    url:\s*/, '').trim()) throw new Error('SRM Nacos 配置缺少 gateway.feign.url')
    const url = urlLine
        .replace(/^    url:\s*/, '')
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2')
    try {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch {
        throw new Error('SRM Nacos 配置 gateway.feign.url 必须使用 http:// 或 https://')
    }
    const timeout = timeoutLine?.replace(/^    timeout:\s*/, '').trim()
    if (!timeout || !/^\d+$/.test(timeout) || Number(timeout) < 100 || Number(timeout) > 30_000)
        throw new Error('SRM Nacos 配置 gateway.feign.timeout 必须是 100-30000 之间的整数')
}

/** 校验网关身份上下文签名配置；密钥缺失会让所有受保护接口在启动后立即失败。 */
function validateGatewayPrincipal(lines) {
    const gateway = lines.findIndex(line => line.trim() === 'gateway:' && !line.startsWith(' '))
    if (gateway < 0) throw new Error('SRM Nacos 配置缺少 gateway.principal.secret')
    const end = lines.findIndex((line, index) => index > gateway && line.trim() && !line.startsWith(' '))
    const scoped = lines.slice(gateway + 1, end < 0 ? lines.length : end)
    if (!scoped.some(line => line.trim() === 'principal:')) throw new Error('SRM Nacos 配置缺少 gateway.principal')
    const secret = scoped
        .find(line => /^\s{4}secret:\s*/.test(line))
        ?.replace(/^\s{4}secret:\s*/, '')
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2')
    if (!secret || secret.length < 32) throw new Error('SRM Nacos 配置 gateway.principal.secret 必须至少32位')
}

function validateSrmConfig(content) {
    if (typeof content !== 'string' || !content.trim()) throw new Error('SRM Nacos 配置不能为空')
    const normalized = normalizeContent(content)
    const lines = normalized.trimEnd().split('\n')
    if (!lines.some(line => line.trim() === 'server:') || !lines.some(line => /^  port:\s*5070\s*$/.test(line)))
        throw new Error('SRM Nacos 配置必须包含 server.port: 5070')
    if (!lines.some(line => line.trim() === 'database:') || !lines.some(line => line.trim() === 'chat-web-srm:'))
        throw new Error('SRM Nacos 配置必须包含 database.chat-web-srm')
    validateGatewayFeign(lines)
    validateGatewayPrincipal(lines)
    return normalized
}

function sanitizeSrmConfig(content) {
    return validateSrmConfig(content)
}

async function main() {
    const dataId = required('NACOS_CONFIG_DATA_ID')
    const existing = await readConfig(dataId)
    if (!existing) throw new Error(`未找到 SRM Nacos 配置：${dataId}；请先在 Nacos 中完成人工配置`)
    const normalized = sanitizeSrmConfig(existing)
    process.stdout.write(
        normalized === existing ? `SRM Nacos 配置校验通过且未修改：${dataId}\n` : `SRM Nacos 配置格式已规范化但未回写：${dataId}\n`
    )
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}

module.exports = { createSrmConfig, createRedisConfig, sanitizeSrmConfig, validateSrmConfig }
