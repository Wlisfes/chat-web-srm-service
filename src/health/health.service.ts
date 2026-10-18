import { Injectable } from '@nestjs/common'
import { RedisService } from '@wlisfes/chat-web-base-schema/redis'
import * as HealthDto from '@/health/dto/health.dto'

import { InjectDataSource, DataSource } from '@wlisfes/chat-web-base-schema/database'
type TableRow = { tableName: string }

@Injectable()
export class HealthService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly redisService: RedisService
    ) {}

    /**SRM 服务存活状态。*/
    public async getLiveness(): Promise<HealthDto.ServiceLivenessResponseDto> {
        return { status: 'UP', timestamp: new Date().toISOString() }
    }

    /**SRM 服务就绪状态。*/
    public async getReadiness(): Promise<HealthDto.ServiceReadinessResponseDto> {
        const requiredTables = [...new Set(this.dataSource.entityMetadatas.map(metadata => metadata.tableName))].sort()
        let databaseReady = false
        let database: HealthDto.ServiceDependencyResponseDto
        try {
            const rows = (await this.dataSource.query(
                `SELECT table_name AS tableName FROM information_schema.tables
                 WHERE table_schema = DATABASE() AND table_name IN (${requiredTables.map(() => '?').join(', ')})`,
                requiredTables
            )) as TableRow[]
            const existing = new Set(rows.map(row => row.tableName))
            const missingTables = requiredTables.filter(table => !existing.has(table))
            databaseReady = this.dataSource.isInitialized && missingTables.length === 0
            database = { connected: this.dataSource.isInitialized, requiredTableCount: requiredTables.length, missingTables }
        } catch (error) {
            database = { connected: false, error: error instanceof Error ? error.message : String(error) }
        }
        let redisReady = false
        try {
            redisReady = await this.redisService.ping()
        } catch {
            redisReady = false
        }
        return {
            status: databaseReady && redisReady ? 'UP' : 'DOWN',
            database,
            redis: { connected: redisReady },
            // 用户 Token 已由 Gateway 校验，SRM 只验证网关签发的身份上下文。
            auth: { mode: 'gateway-principal' },
            timestamp: new Date().toISOString()
        }
    }
}
