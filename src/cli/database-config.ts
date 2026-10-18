import { loadEnvFile } from 'node:process'
import yaml from 'js-yaml'

/** SRM 增量 SQL 只允许落在该数据库，防止误连其他服务库后在其中建表。 */
export const SRM_DATABASE_NAME = 'chat-web-srm'

export type DatabaseConfig = {
    host: string
    port?: number | string
    username: string
    password: string
    database?: string
    name?: string
    charset?: string
    timezone?: string
}

export function loadLocalEnvironment(): void {
    try {
        loadEnvFile()
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
}

function required(key: string): string {
    const value = process.env[key]?.trim()
    if (!value) throw new Error(`缺少环境变量：${key}`)
    return value
}

async function getNacosAccessToken(baseUrl: string): Promise<string | undefined> {
    const username = process.env.NACOS_USERNAME?.trim()
    const password = process.env.NACOS_PASSWORD
    if (!username || password === undefined) return undefined

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/nacos/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password })
    })
    if (!response.ok) throw new Error(`Nacos 鉴权失败：HTTP ${response.status}`)
    const result = (await response.json()) as { accessToken?: unknown }
    if (typeof result.accessToken !== 'string' || !result.accessToken.trim()) {
        throw new Error('Nacos 鉴权响应缺少 accessToken')
    }
    return result.accessToken
}

export function identifier(value: string, label: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label}只能包含字母、数字、下划线和连字符`)
    return value
}

export async function loadSrmDatabaseConfig(): Promise<DatabaseConfig> {
    const directHost = process.env.SRM_MYSQL_HOST?.trim()
    const directUser = process.env.SRM_MYSQL_USERNAME?.trim()
    const directPassword = process.env.SRM_MYSQL_PASSWORD
    const directDatabase = process.env.SRM_MYSQL_DATABASE?.trim()
    if (directHost && directUser && directPassword !== undefined && directDatabase) {
        return {
            host: directHost,
            port: process.env.SRM_MYSQL_PORT || 3306,
            username: directUser,
            password: directPassword,
            database: directDatabase,
            charset: process.env.SRM_MYSQL_CHARSET || 'utf8mb4',
            timezone: process.env.SRM_MYSQL_TIMEZONE || '+08:00'
        }
    }

    const server = required('NACOS_SERVER')
    const baseUrl = /^https?:\/\//i.test(server) ? server : `http://${server}`
    const params = new URLSearchParams({
        dataId: required('NACOS_CONFIG_DATA_ID'),
        group: process.env.NACOS_CONFIG_GROUP?.trim() || process.env.NACOS_GROUP?.trim() || 'DEFAULT_GROUP',
        tenant: process.env.NACOS_NAMESPACE?.trim() || 'public'
    })
    const accessToken = await getNacosAccessToken(baseUrl)
    if (accessToken) params.set('accessToken', accessToken)
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/nacos/v1/cs/configs?${params}`)
    if (!response.ok) throw new Error(`读取 Nacos 配置失败：HTTP ${response.status}`)
    const parsed = yaml.load(await response.text()) as Record<string, unknown>
    const databaseRoot = parsed?.database as Record<string, unknown> | undefined
    const database = databaseRoot?.['chat-web-srm']
    if (!database || typeof database !== 'object' || Array.isArray(database)) {
        throw new Error('缺少 Nacos 数据库配置节点：database.chat-web-srm')
    }
    return database as DatabaseConfig
}

export function getDatabaseName(config: DatabaseConfig): string {
    const name = process.env.SRM_MYSQL_DATABASE?.trim() || config.database?.trim() || config.name?.trim()
    if (!name) {
        throw new Error('SRM数据库名称不能为空')
    }
    return assertSrmDatabase(identifier(name, 'SRM数据库名称'))
}

/** 校验目标库必须是 SRM 自有库，拒绝在 Account、Finance 等其他服务库执行 SRM 增量 SQL。 */
export function assertSrmDatabase(name: string | null | undefined): string {
    if (name !== SRM_DATABASE_NAME) {
        throw new Error(`SRM Schema 只能在 ${SRM_DATABASE_NAME} 库执行，当前目标库：${name || '未选择'}`)
    }
    return name
}
