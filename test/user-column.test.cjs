const test = require('node:test')
const assert = require('node:assert/strict')
const { UserService } = require('../dist/modules/user/user.service')

function createQueryBuilder(calls) {
    const qb = {
        andWhere: (sql, params) => (calls.push([sql, params]), qb),
        orderBy: () => qb,
        skip: () => qb,
        take: () => qb,
        getManyAndCount: async () => [[], 0]
    }
    return qb
}

const userUtilsService = { fetchAppendBalance: async list => list }
const configService = { get: (key, fallback) => ({ 'gateway.feign.service_token': 'service-token' })[key] ?? fallback }

test('供应商列表按别名、邮箱模糊查询，按归属人精确查询', async () => {
    const calls = []
    const database = { builder: async (_repository, callback) => callback(createQueryBuilder(calls)) }
    const service = new UserService({}, {}, database, userUtilsService, {}, configService, {})
    await service.httpBaseSrmColumnUser({ page: 1, size: 20, alias: ' SSK1233 ', email: 'gmail', ownerUserUid: '2001' })
    assert.deepEqual(calls.find(([sql]) => sql.includes('t.alias'))[1], { alias: '%SSK1233%' })
    assert.deepEqual(calls.find(([sql]) => sql.includes('t.email'))[1], { email: '%gmail%' })
    assert.deepEqual(calls.find(([sql]) => sql === 't.ownerUserUid = :ownerUserUid')[1], { ownerUserUid: '2001' })
})

test('供应商列表按归属部门查询时通过 Skyline 换成成员 UID 过滤', async () => {
    const calls = []
    let received
    const skylineFeignClient = {
        async httpBaseSkylineColumnOrganizationUserUid(authorization, input) {
            received = { authorization, input }
            return ['2001', '2002']
        }
    }
    const database = { builder: async (_repository, callback) => callback(createQueryBuilder(calls)) }
    const service = new UserService({}, {}, database, userUtilsService, skylineFeignClient, configService, {})
    await service.httpBaseSrmColumnUser({ page: 1, size: 20, ownerOrganizationKeyIds: [1001] })
    assert.deepEqual(received.input, { organizationKeyIds: [1001] })
    assert.deepEqual(calls.find(([sql]) => sql.includes('IN (:...ownerUserUids)'))[1], { ownerUserUids: ['2001', '2002'] })
})

test('供应商列表归属部门下没有成员时直接返回空分页', async () => {
    const skylineFeignClient = { httpBaseSkylineColumnOrganizationUserUid: async () => [] }
    const database = { builder: async () => assert.fail('不应查询供应商') }
    const service = new UserService({}, {}, database, userUtilsService, skylineFeignClient, configService, {})
    const result = await service.httpBaseSrmColumnUser({ page: 1, size: 20, ownerOrganizationKeyIds: [1001] })
    assert.equal(result.total, 0)
    assert.deepEqual(result.list, [])
})
