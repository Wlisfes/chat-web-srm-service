const test = require('node:test')
const assert = require('node:assert/strict')
const { RouteService } = require('../dist/modules/route/route.service')

const principal = { uid: '30001', number: '1024' }
const countries = { 1007: { keyId: 1007, code: '852', cnName: '中国香港' }, 1008: { keyId: 1008, code: '63', cnName: '菲律宾' } }
const skyline = {
    httpBaseSkylineColumnCountryResolver: async (_auth, { keyIds }) => keyIds.map(keyId => countries[keyId]).filter(Boolean),
    httpBaseSkylineColumnUserResolver: async () => []
}
const crm = { httpBaseCrmColumnUserResolver: async (_auth, { keyIds }) => keyIds.map(keyId => ({ keyId, name: '客户' })) }
const apps = { 1001: { keyId: 1001, userKeyId: 10241000, type: 'SOTP', appName: '登录验证码' } }
const sms = { httpBaseSmsColumnAppResolver: async (_auth, { keyIds }) => keyIds.map(keyId => apps[keyId]).filter(Boolean) }

/** 按实体名过滤内存数据，模拟 TypeORM 的 find/findOneBy/existsBy。 */
function matches(row, where = {}) {
    return Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && '_type' in value) {
            if (value._type === 'in') return value._value.includes(row[key])
            if (value._type === 'not') return row[key] !== value._value
        }
        return row[key] === value
    })
}

function createManager(tables, overrides = {}) {
    const manager = {
        find: async (entity, options = {}) => (tables[entity.name] ?? []).filter(row => matches(row, options.where)),
        findOneBy: async (entity, where) => (tables[entity.name] ?? []).find(row => matches(row, where)) ?? null,
        existsBy: async (entity, where) => (tables[entity.name] ?? []).some(row => matches(row, where)),
        create: (_entity, value) => value,
        merge: (_entity, target, value) => Object.assign(target, value),
        save: async value => value,
        insert: async (entity, value) => (tables[entity.name] ??= []).push(value),
        update: async (entity, where, value) =>
            (tables[entity.name] ?? []).filter(row => matches(row, where)).forEach(row => Object.assign(row, value)),
        delete: async () => ({ affected: 1 }),
        ...overrides
    }
    manager.transaction = async callback => callback(manager)
    return manager
}

function createService(manager) {
    const repository = {
        manager,
        find: options => manager.find({ name: 'TbSrmRoute' }, options),
        findOneBy: where => manager.findOneBy({ name: 'TbSrmRoute' }, where)
    }
    return new RouteService(repository, {}, skyline, crm, sms, { get: () => 'service-token' })
}

test('新增路由一律为通用路由，传入 type 也不会生效', async () => {
    const route = await createService(createManager({})).httpBaseSrmCreateRoute(principal, { name: ' 标准线路 ', type: 'targeted' })
    assert.equal(route.name, '标准线路')
    assert.equal(route.type, 'general')
    assert.equal(RouteService.prototype.httpBaseSrmRouteDefaultUpdate, undefined)
})

test('路由别名重复时拒绝，通用路由可以停用和删除，有绑定应用的定向路由不能删除', async () => {
    const tables = {
        TbSrmRoute: [
            { keyId: 1, name: '通用', alias: 'RT-GENERAL', type: 'general', status: 'enable' },
            { keyId: 2, name: '专线', type: 'targeted', status: 'enable' }
        ],
        TbSrmRouteApp: [{ keyId: 9, appKeyId: 1001, routeKeyId: 2 }]
    }
    const service = createService(createManager(tables))
    await assert.rejects(() => service.httpBaseSrmCreateRoute(principal, { name: 'B', alias: 'RT-GENERAL' }), /已存在/)
    assert.equal((await service.httpBaseSrmUpdateRoute(principal, { keyId: 1, name: '通用', status: 'disable' })).status, 'disable')
    assert.deepEqual(await service.httpBaseSrmDeleteRoute({ keyId: 1 }), { success: true })
    await assert.rejects(() => service.httpBaseSrmDeleteRoute({ keyId: 2 }), /仍有短信应用绑定/)
})

test('新增规则：号码段必须以国际区号开头，相同匹配条件不能重复', async () => {
    const tables = {
        TbSrmRoute: [{ keyId: 1 }],
        TbSrmRouteRule: [{ keyId: 1, routeKeyId: 1, countryKeyId: 1007, type: 'SOTP', mnc: '', prefix: '' }]
    }
    const service = createService(createManager(tables))
    await assert.rejects(
        () => service.httpBaseSrmCreateRouteRule(principal, { routeKeyId: 1, countryKeyId: 1007, type: 'SOTP', prefix: '6391' }),
        /国际区号 852/
    )
    await assert.rejects(
        () => service.httpBaseSrmCreateRouteRule(principal, { routeKeyId: 1, countryKeyId: 1007, type: 'SOTP' }),
        /相同匹配条件/
    )
    const rule = await service.httpBaseSrmCreateRouteRule(principal, { routeKeyId: 1, countryKeyId: 1007, type: 'SOTP', prefix: '85291' })
    assert.deepEqual([rule.mnc, rule.prefix, rule.status], ['', '85291', 'enable'])
})

test('规则只能加入方向和类型一致的通道', async () => {
    const tables = {
        TbSrmRouteRule: [{ keyId: 1, countryKeyId: 1007, type: 'SOTP' }],
        TbSrmChannel: [
            { keyId: 11, alias: '1024-454-MRKT-01', countryKeyId: 1007, type: 'MRKT' },
            { keyId: 12, alias: '1024-454-SOTP-01', countryKeyId: 1007, type: 'SOTP' }
        ]
    }
    const service = createService(createManager(tables))
    await assert.rejects(
        () => service.httpBaseSrmCreateRouteChannel(principal, { ruleKeyId: 1, channelKeyId: 11 }),
        /方向或类型与规则不一致/
    )
    const link = await service.httpBaseSrmCreateRouteChannel(principal, { ruleKeyId: 1, channelKeyId: 12 })
    assert.deepEqual([link.priority, link.weight, link.status], [1, 100, 'enable'])
})

test('短信应用绑定：应用不存在时拒绝，已绑定的应用改绑', async () => {
    const tables = { TbSrmRoute: [{ keyId: 2 }], TbSrmRouteApp: [{ keyId: 9, appKeyId: 1001, userKeyId: 10241000, routeKeyId: 1 }] }
    const service = createService(createManager(tables))
    await assert.rejects(() => service.httpBaseSrmBindRouteApp(principal, { routeKeyId: 2, appKeyIds: [404] }), /部分短信应用不存在/)
    assert.deepEqual(await service.httpBaseSrmBindRouteApp(principal, { routeKeyId: 2, appKeyIds: [1001, 1001] }), { count: 1 })
    assert.equal(tables.TbSrmRouteApp.length, 1)
    assert.equal(tables.TbSrmRouteApp[0].routeKeyId, 2)
})

test('绑定应用后路由变为定向路由，改绑或解绑到没有应用后变回通用路由', async () => {
    const tables = {
        TbSrmRoute: [
            { keyId: 1, type: 'targeted' },
            { keyId: 2, type: 'general' }
        ],
        TbSrmRouteApp: [{ keyId: 9, appKeyId: 1001, userKeyId: 10241000, routeKeyId: 1 }]
    }
    const manager = createManager(tables, {
        delete: async (entity, where) => {
            const ids = where.keyId._value
            const before = tables[entity.name].length
            tables[entity.name] = tables[entity.name].filter(row => !ids.includes(row.keyId))
            return { affected: before - tables[entity.name].length }
        }
    })
    const service = createService(manager)
    await service.httpBaseSrmBindRouteApp(principal, { routeKeyId: 2, appKeyIds: [1001] })
    assert.deepEqual(
        tables.TbSrmRoute.map(item => [item.keyId, item.type]),
        [
            [1, 'general'],
            [2, 'targeted']
        ]
    )
    assert.deepEqual(await service.httpBaseSrmUnbindRouteApp(principal, { keyIds: [9] }), { count: 1 })
    assert.equal(tables.TbSrmRoute[1].type, 'general')
})

function previewTables() {
    return {
        TbSrmRoute: [
            { keyId: 1, name: '通用线路', type: 'general', status: 'enable' },
            { keyId: 2, name: '大客户专线', type: 'targeted', status: 'enable' }
        ],
        TbSrmRouteApp: [{ keyId: 9, appKeyId: 1001, userKeyId: 10241000, routeKeyId: 2 }],
        TbSrmRouteRule: [
            { keyId: 21, routeKeyId: 2, countryKeyId: 1007, type: 'SOTP', mnc: '', prefix: '', status: 'enable' },
            { keyId: 22, routeKeyId: 2, countryKeyId: 1007, type: 'SOTP', mnc: '', prefix: '85291', status: 'enable' },
            { keyId: 11, routeKeyId: 1, countryKeyId: 1008, type: 'SOTP', mnc: '', prefix: '', status: 'enable' }
        ],
        TbSrmRouteChannel: [
            { keyId: 1, ruleKeyId: 21, channelKeyId: 101, priority: 1, weight: 100, status: 'enable' },
            { keyId: 2, ruleKeyId: 22, channelKeyId: 102, priority: 1, weight: 100, status: 'enable' },
            { keyId: 3, ruleKeyId: 22, channelKeyId: 103, priority: 2, weight: 100, status: 'enable' },
            { keyId: 4, ruleKeyId: 11, channelKeyId: 104, priority: 1, weight: 100, status: 'enable' }
        ],
        TbSrmChannel: [101, 102, 103, 104].map(keyId => ({ keyId, alias: `CH-${keyId}`, status: 'enable' })),
        TbSrmChannelPort: [101, 102, 103, 104].map(channelKeyId => ({ channelKeyId, status: 'enable' }))
    }
}

test('选路预览：号码段规则优先于方向规则，只选最高可用优先级', async () => {
    const result = await createService(createManager(previewTables())).httpBaseSrmRoutePreview({ appKeyId: 1001, phone: '+85291234567' })
    assert.equal(result.matched, true)
    assert.equal(result.fallback, false)
    assert.equal(result.ruleOptions.keyId, 22)
    assert.deepEqual(
        result.channels.map(item => [item.channelKeyId, item.selected]),
        [
            [102, true],
            [103, false]
        ]
    )
})

test('选路预览：细粒度规则无可用通道时退到方向规则，定向路由无规则时回落通用路由', async () => {
    const tables = previewTables()
    tables.TbSrmChannelPort = tables.TbSrmChannelPort.filter(port => ![102, 103].includes(port.channelKeyId))
    const service = createService(createManager(tables))
    const coarse = await service.httpBaseSrmRoutePreview({ appKeyId: 1001, phone: '85291234567' })
    assert.equal(coarse.ruleOptions.keyId, 21)
    const fallback = await service.httpBaseSrmRoutePreview({ appKeyId: 1001, phone: '00639171234567' })
    assert.deepEqual([fallback.matched, fallback.fallback, fallback.routeOptions.keyId, fallback.phone], [true, true, 1, '639171234567'])
    const missing = await service.httpBaseSrmRoutePreview({ appKeyId: 1001, phone: '8613800000000' })
    assert.equal(missing.matched, false)
})

test('规则通道占比只在同规则同优先级的可用通道之间计算', async () => {
    const tables = {
        TbSrmRouteChannel: [
            { keyId: 1, ruleKeyId: 1, channelKeyId: 11, priority: 1, weight: 60, status: 'enable' },
            { keyId: 2, ruleKeyId: 1, channelKeyId: 12, priority: 1, weight: 40, status: 'enable' },
            { keyId: 3, ruleKeyId: 1, channelKeyId: 13, priority: 1, weight: 100, status: 'enable' },
            { keyId: 4, ruleKeyId: 1, channelKeyId: 14, priority: 2, weight: 100, status: 'disable' }
        ],
        TbSrmChannel: [
            { keyId: 11, status: 'enable' },
            { keyId: 12, status: 'enable' },
            { keyId: 13, status: 'disable' },
            { keyId: 14, status: 'enable' }
        ],
        TbSrmChannelPort: [11, 12, 13, 14].map(channelKeyId => ({ channelKeyId, status: 'enable' }))
    }
    const result = await createService(createManager(tables)).httpBaseSrmListRouteChannel({ ruleKeyId: 1 })
    assert.deepEqual(Object.fromEntries(result.map(item => [item.keyId, item.ratio])), { 1: 60, 2: 40, 3: 0, 4: 0 })
})
test('规则分页不传路由时查询全部路由的规则，并附带所属路由', async () => {
    const wheres = []
    const qb = {
        andWhere: (sql, params) => {
            wheres.push([sql, params])
            return qb
        },
        orderBy: () => qb,
        addOrderBy: () => qb,
        skip: () => qb,
        take: () => qb,
        getManyAndCount: async () => [[{ keyId: 21, routeKeyId: 2, countryKeyId: 1007, type: 'SOTP', mnc: '', prefix: '' }], 1]
    }
    const tables = previewTables()
    const manager = createManager(tables)
    manager.getRepository = () => ({})
    const service = createService(manager)
    service.database = { builder: async (_repository, callback) => callback(qb) }
    const result = await service.httpBaseSrmColumnRouteRule({ page: 1, size: 20, prefix: ' 852 ' })
    assert.equal(
        wheres.some(([sql]) => sql.includes('routeKeyId')),
        false
    )
    assert.equal(wheres.find(([sql]) => sql.includes('prefix'))[1].prefix, '%852%')
    assert.equal(result.list[0].routeKeyIdOptions.name, '大客户专线')
    assert.equal(result.list[0].channelCount, 1)
})
