const test = require('node:test')
const assert = require('node:assert/strict')
const { HealthService } = require('../dist/health/health.service')

test('就绪检查覆盖三张 SRM 表、独立 Redis 与远程鉴权模式', async () => {
    const service = new HealthService(
        {
            isInitialized: true,
            entityMetadatas: [{ tableName: 'tb_srm_user' }, { tableName: 'tb_srm_user_config' }, { tableName: 'tb_srm_user_contact' }],
            async query() {
                return [{ tableName: 'tb_srm_user' }, { tableName: 'tb_srm_user_config' }]
            }
        },
        {
            async ping() {
                return true
            }
        }
    )
    const result = await service.getReadiness()
    assert.equal(result.status, 'DOWN')
    assert.deepEqual(result.database.missingTables, ['tb_srm_user_contact'])
    assert.equal(result.auth.mode, 'gateway-principal')
})
