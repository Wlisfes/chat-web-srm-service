import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import mysql, { RowDataPacket } from 'mysql2/promise'
import { assertSrmDatabase, getDatabaseName, loadSrmDatabaseConfig, loadLocalEnvironment } from '@/cli/database-config'

import { assertMysqlDatabaseIsolation } from '@wlisfes/chat-web-base-schema/database'
type MigrationRow = RowDataPacket & { checksum: string }
const MIGRATION_TABLE = 'tb_srm_schema_migration'

function changesDirectory(): string {
    const schemaEntry = createRequire(__filename).resolve('@wlisfes/chat-web-base-schema/chat-web-srm-mysql')
    return path.join(path.resolve(path.dirname(schemaEntry), '../../../..'), 'src/schema/chat-web-srm-mysql/sql/changes')
}

/** 按文件名顺序幂等执行 SRM 数据库增量 SQL。 */
export async function applySchema(): Promise<void> {
    loadLocalEnvironment()
    const config = await loadSrmDatabaseConfig()
    const database = getDatabaseName(config)
    const connection = await mysql.createConnection({
        host: process.env.SRM_MYSQL_HOST?.trim() || config.host,
        port: Number(process.env.SRM_MYSQL_PORT || config.port || 3306),
        user: process.env.SRM_MYSQL_USERNAME?.trim() || config.username,
        password: process.env.SRM_MYSQL_PASSWORD ?? config.password,
        database,
        charset: process.env.SRM_MYSQL_CHARSET || config.charset || 'utf8mb4',
        multipleStatements: true
    })
    try {
        /**以连接实际选中的库为准再次校验，避免配置解析与连接结果不一致**/
        const [[current]] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS name')
        assertSrmDatabase(current?.name)
        const [grantRows] = await connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()')
        assertMysqlDatabaseIsolation(
            grantRows.flatMap(row => Object.values(row).filter((value): value is string => typeof value === 'string')),
            database
        )
        await connection.query(
            `CREATE TABLE IF NOT EXISTS \`${MIGRATION_TABLE}\` (
                \`filename\` varchar(255) NOT NULL,
                \`checksum\` char(64) NOT NULL,
                \`applied_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (\`filename\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SRM库Schema增量记录表'`
        )
        const directory = changesDirectory()
        const filenames = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()
        for (const filename of filenames) {
            const sql = await readFile(path.join(directory, filename), 'utf8')
            const checksum = createHash('sha256').update(sql).digest('hex')
            const [rows] = await connection.execute<MigrationRow[]>(`SELECT checksum FROM \`${MIGRATION_TABLE}\` WHERE filename = ?`, [
                filename
            ])
            if (rows.length) {
                if (rows[0].checksum !== checksum) throw new Error(`已应用增量 SQL 校验和变化：${filename}`)
                process.stdout.write(`Schema migration skipped: ${filename}\n`)
                continue
            }
            await connection.query(sql)
            await connection.execute(`INSERT INTO \`${MIGRATION_TABLE}\` (filename, checksum) VALUES (?, ?)`, [filename, checksum])
            process.stdout.write(`Schema migration applied: ${filename}\n`)
        }
    } finally {
        await connection.end()
    }
}

if (require.main === module) {
    applySchema().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}
