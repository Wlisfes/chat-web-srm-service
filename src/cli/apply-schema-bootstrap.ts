import { randomBytes } from 'node:crypto'
import mysql, { RowDataPacket } from 'mysql2/promise'
import { applySchema } from '@/cli/apply-schema'
import { getDatabaseName, loadSrmDatabaseConfig, loadLocalEnvironment } from '@/cli/database-config'

import { assertMysqlDatabaseIsolation } from '@wlisfes/chat-web-base-schema/database'
const MIGRATION_USER_PREFIX = 'srm_mig_'
const MYSQL_ACCOUNT_HOST = '%'

type MigrationCredentials = {
    username: string
    password: string
}

/** 生成长度符合 MySQL 账号限制的临时迁移账号。 */
export function createMigrationCredentials(random = randomBytes(18)): MigrationCredentials {
    return {
        username: `${MIGRATION_USER_PREFIX}${random.toString('hex')}`.slice(0, 32),
        password: randomBytes(32).toString('base64url')
    }
}

/** 使用管理员账号创建仅能访问 SRM 数据库的临时迁移账号。 */
export async function createMigrationUser(
    connection: mysql.Connection,
    database: string,
    credentials: MigrationCredentials
): Promise<void> {
    const account = `${mysql.escape(credentials.username)}@${mysql.escape(MYSQL_ACCOUNT_HOST)}`
    await connection.query(`CREATE USER ${account} IDENTIFIED BY ${mysql.escape(credentials.password)}`)
    await connection.query(`GRANT ALL PRIVILEGES ON ${mysql.escapeId(database)}.* TO ${account}`)
}

/** 删除临时迁移账号，避免管理员账号授权长期留存。 */
export async function dropMigrationUser(connection: mysql.Connection, credentials: MigrationCredentials): Promise<void> {
    const account = `${mysql.escape(credentials.username)}@${mysql.escape(MYSQL_ACCOUNT_HOST)}`
    await connection.query(`DROP USER IF EXISTS ${account}`)
}

/** 判断当前连接是否已经是仅限 SRM 数据库的业务账号。 */
export function isDatabaseAccountIsolated(grants: readonly string[], database: string): boolean {
    try {
        assertMysqlDatabaseIsolation(grants, database)
        return true
    } catch {
        return false
    }
}

async function currentGrants(connection: mysql.Connection): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()')
    return rows.flatMap(row => Object.values(row).filter((value): value is string => typeof value === 'string'))
}

/** 使用 Nacos 中的管理员连接临时授权，再以受限账号执行 Schema。 */
async function main(): Promise<void> {
    loadLocalEnvironment()
    const config = await loadSrmDatabaseConfig()
    const database = getDatabaseName(config)
    const host = process.env.SRM_MYSQL_HOST?.trim() || config.host
    const port = Number(process.env.SRM_MYSQL_PORT || config.port || 3306)
    const adminUsername = process.env.SRM_MYSQL_USERNAME?.trim() || config.username
    const adminPassword = process.env.SRM_MYSQL_PASSWORD ?? config.password
    const adminConnection = await mysql.createConnection({
        host,
        port,
        user: adminUsername,
        password: adminPassword,
        charset: process.env.SRM_MYSQL_CHARSET || config.charset || 'utf8mb4'
    })
    const credentials = createMigrationCredentials()

    if (isDatabaseAccountIsolated(await currentGrants(adminConnection), database)) {
        await adminConnection.end()
        await applySchema()
        return
    }

    try {
        await createMigrationUser(adminConnection, database, credentials)
        const previousEnvironment = {
            host: process.env.SRM_MYSQL_HOST,
            port: process.env.SRM_MYSQL_PORT,
            username: process.env.SRM_MYSQL_USERNAME,
            password: process.env.SRM_MYSQL_PASSWORD,
            database: process.env.SRM_MYSQL_DATABASE
        }
        process.env.SRM_MYSQL_HOST = host
        process.env.SRM_MYSQL_PORT = String(port)
        process.env.SRM_MYSQL_USERNAME = credentials.username
        process.env.SRM_MYSQL_PASSWORD = credentials.password
        process.env.SRM_MYSQL_DATABASE = database
        try {
            await applySchema()
        } finally {
            for (const [key, value] of Object.entries(previousEnvironment)) {
                if (value === undefined) delete process.env[key]
                else process.env[key] = value
            }
        }
    } finally {
        try {
            await dropMigrationUser(adminConnection, credentials)
        } finally {
            await adminConnection.end()
        }
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}
