const test = require('node:test')
const assert = require('node:assert/strict')
const { RouteService } = require('../dist/modules/route/route.service')
const { RouteUtilsService } = require('../dist/modules/route/route.utils.service')

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

/** 按 order 排序，模拟 TypeORM 的 order 选项。 */
function sortRows(rows, order = {}) {
    const keys = Object.entries(order)
    return [...rows].sort((a, b) => {
        for (const [key, direction] of keys) {
            const diff = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0
            if (diff) return direction === 'DESC' ? -diff : diff
        }
        return 0
    })
}

function createManager(tables, overrides = {}) {
    const manager = {
        find: async (entity, options = {}) =>
            sortRows(
                (tables[entity.name] ?? []).filter(row => matches(row, options.where)),
                options.order
            ),
        findOneBy: async (entity, where) => (tables[entity.name] ?? []).find(row => matches(row, where)) ?? null,
        existsBy: async (entity, where) => (tables[entity.name] ?? []).some(row => matches(row, where)),
        create: (_entity, value) => value,
        merge: (_entity, target, value) => Object.assign(target, value),
        save: async value => value,
        insert: async (entity, value) => (tables[entity.name] ??= []).push(...[value].flat()),
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
    const configService = { get: () => 'service-token' }
    const utils = new RouteUtilsService(repository, skyline, configService)
    return new RouteService(repository, {}, skyline, crm, sms, configService, utils)
}

test('新增路由按传入类型保存，优先级默认 1；编辑不能修改类型', async () => {
    const tables = { TbSrmRoute: [] }
    const service = createService(createManager(tables))
    const route = await service.httpBaseSrmCreateRoute(principal, { name: ' 大客户线路 ', type: 'SOTP' })
    assert.deepEqual(
        [route.name, route.type, route.alias, route.priority, route.status],
        ['大客户线路', 'SOTP', 'LSK1024-SOTP-A001', 1, 'enable']
    )
    tables.TbSrmRoute.push({ ...route, keyId: 1 })
    const updated = await service.httpBaseSrmUpdateRoute(principal, {
        keyId: 1,
        name: '大客户线路',
        status: 'enable',
        priority: 3,
        type: 'MRKT'
    })
    assert.deepEqual([updated.type, updated.priority], ['SOTP', 3])
})

test('路由别名按工号和类型自增，有绑定应用的路由不能删除', async () => {
    const tables = {
        TbSrmRoute: [
            { keyId: 1, name: '通用', alias: 'LSK1024-SOTP-A001', type: 'SOTP', status: 'enable' },
            { keyId: 2, name: '专线', type: 'SOTP', status: 'enable' }
        ],
        TbSrmRouteApp: [{ keyId: 9, appKeyId: 1001, routeKeyId: 2 }]
    }
    const service = createService(createManager(tables))
    const created = await service.httpBaseSrmCreateRoute(principal, { name: 'B', type: 'SOTP', alias: 'RT-GENERAL' })
    assert.equal(created.alias, 'LSK1024-SOTP-A002')
    await assert.rejects(() => service.httpBaseSrmDeleteRoute({ keyId: 2 }), /仍有短信应用绑定/)
    assert.deepEqual(await service.httpBaseSrmDeleteRoute({ keyId: 1 }), { success: true })
})

test('短信应用只能绑定同类型路由，解绑不改变路由类型', async () => {
    const tables = {
        TbSrmRoute: [
            { keyId: 1, name: '营销', type: 'MRKT', status: 'enable' },
            { keyId: 2, name: '验证码', type: 'SOTP', status: 'enable' }
        ],
        TbSrmRouteApp: []
    }
    const service = createService(createManager(tables))
    await assert.rejects(() => service.httpBaseSrmBindRouteApp(principal, { routeKeyId: 1, appKeyIds: [1001] }), /类型不一致/)
    assert.deepEqual(await service.httpBaseSrmBindRouteApp(principal, { routeKeyId: 2, appKeyIds: [1001] }), { count: 1 })
    assert.equal(tables.TbSrmRouteApp[0].userKeyId, 10241000)
    await service.httpBaseSrmUnbindRouteApp({ keyIds: [1] })
    assert.equal(tables.TbSrmRoute[1].type, 'SOTP')
})

test('更新路由通道绑定：保留已选、移除未选、只新增新选通道', async () => {
    const tables = {
        TbSrmRoute: [{ keyId: 1, name: '通用', type: 'SOTP', status: 'enable' }],
        TbSrmChannel: [
            { keyId: 11, alias: 'A', countryKeyId: 1007, type: 'MRKT' },
            { keyId: 12, alias: 'B', countryKeyId: 1008, type: 'SOTP' }
        ],
        TbSrmRouteChannel: [{ keyId: 1, routeKeyId: 1, channelKeyId: 12, priority: 2, weight: 50, status: 'disable' }]
    }
    const service = createService(createManager(tables))
    assert.deepEqual(await service.httpBaseSrmBindRouteChannel(principal, { routeKeyId: 1, channelKeyIds: [11, 12] }), { count: 2 })
    assert.deepEqual(
        tables.TbSrmRouteChannel.map(item => [item.channelKeyId, item.priority, item.weight, item.status]),
        [
            [12, 2, 50, 'disable'],
            [11, 1, 100, 'enable']
        ]
    )
})

test('更新路由通道绑定：未选通道被移除', async () => {
    const tables = {
        TbSrmRoute: [{ keyId: 1, name: '通用', type: 'SOTP', status: 'enable' }],
        TbSrmChannel: [
            { keyId: 11, alias: 'A', countryKeyId: 1007, type: 'MRKT' },
            { keyId: 12, alias: 'B', countryKeyId: 1008, type: 'SOTP' }
        ],
        TbSrmRouteChannel: [
            { keyId: 1, routeKeyId: 1, channelKeyId: 11, priority: 1, weight: 100, status: 'enable' },
            { keyId: 2, routeKeyId: 1, channelKeyId: 12, priority: 1, weight: 100, status: 'enable' }
        ]
    }
    const deleted = []
    const manager = createManager(tables, {
        delete: async (entity, where) => {
            deleted.push([entity.name, where.keyId?._value])
            const ids = where.keyId?._value ?? []
            tables[entity.name] = (tables[entity.name] ?? []).filter(row => !ids.includes(row.keyId))
            return { affected: ids.length }
        }
    })
    const service = createService(manager)
    assert.deepEqual(await service.httpBaseSrmBindRouteChannel(principal, { routeKeyId: 1, channelKeyIds: [12] }), { count: 1 })
    assert.deepEqual(deleted, [['TbSrmRouteChannel', [1]]])
    assert.deepEqual(
        tables.TbSrmRouteChannel.map(item => item.channelKeyId),
        [12]
    )
})
function routeTables() {
    return {
        TbSrmRoute: [
            { keyId: 1, name: '专线', type: 'SOTP', priority: 1, status: 'enable' },
            { keyId: 2, name: '通用B', type: 'SOTP', priority: 2, status: 'enable' },
            { keyId: 3, name: '通用A', type: 'SOTP', priority: 1, status: 'enable' }
        ],
        TbSrmRouteApp: [{ keyId: 9, appKeyId: 1001, routeKeyId: 1 }],
        TbSrmChannel: [
            { keyId: 11, alias: 'HK-SOTP-1', countryKeyId: 1007, type: 'SOTP', status: 'enable' },
            { keyId: 12, alias: 'HK-SOTP-2', countryKeyId: 1007, type: 'SOTP', status: 'enable' },
            { keyId: 13, alias: 'HK-SOTP-3', countryKeyId: 1007, type: 'SOTP', status: 'enable' },
            { keyId: 14, alias: 'HK-MRKT-1', countryKeyId: 1007, type: 'MRKT', status: 'enable' },
            { keyId: 15, alias: 'PH-SOTP-1', countryKeyId: 1008, type: 'SOTP', status: 'enable' }
        ],
        TbSrmChannelPort: [11, 12, 13, 14, 15].map(channelKeyId => ({ channelKeyId, status: 'enable' })),
        TbSrmRouteRule: [1, 2, 3].map(routeKeyId => ({
            keyId: routeKeyId,
            routeKeyId,
            sort: 0,
            status: 'enable',
            conditions: [{ field: 'type', operator: 'in', value: ['MRKT', 'NTFY', 'SOTP'] }]
        })),
        TbSrmRouteChannel: [
            { keyId: 1, routeKeyId: 1, channelKeyId: 15, priority: 1, weight: 100, status: 'enable' },
            { keyId: 2, routeKeyId: 3, channelKeyId: 11, priority: 1, weight: 60, status: 'enable' },
            { keyId: 3, routeKeyId: 3, channelKeyId: 12, priority: 1, weight: 40, status: 'enable' },
            { keyId: 4, routeKeyId: 3, channelKeyId: 13, priority: 2, weight: 100, status: 'enable' },
            { keyId: 5, routeKeyId: 3, channelKeyId: 14, priority: 1, weight: 100, status: 'enable' },
            { keyId: 6, routeKeyId: 2, channelKeyId: 11, priority: 1, weight: 100, status: 'enable' }
        ]
    }
}

test('分流占比只在同路由、同方向、同类型、同优先级的可用通道之间计算', async () => {
    const result = await createService(createManager(routeTables())).httpBaseSrmListRouteChannel({ routeKeyId: 3 })
    const ratio = Object.fromEntries(result.map(item => [item.keyId, item.ratio]))
    assert.deepEqual(ratio, { 2: 60, 3: 40, 4: 100, 5: 100 })
})

test('选路：绑定路由没有该方向通道时，按优先级回落到同类型路由', async () => {
    const result = await createService(createManager(routeTables())).httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1007 })
    assert.equal(result.matched, true)
    assert.equal(result.fallback, true)
    assert.deepEqual(
        result.steps.map(step => [step.routeOptions.name, step.matched]),
        [
            ['专线', false],
            ['通用A', true]
        ]
    )
    const selected = result.steps[1].channels.filter(item => item.selected).map(item => item.channelOptions.alias)
    assert.deepEqual(selected, ['HK-SOTP-1', 'HK-SOTP-2'])
})

test('选路：主通道都不可用时降级到下一优先级', async () => {
    const tables = routeTables()
    tables.TbSrmChannel.find(item => item.keyId === 11).status = 'disable'
    tables.TbSrmRouteChannel.find(item => item.keyId === 3).status = 'disable'
    const result = await createService(createManager(tables)).httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1007 })
    const step = result.steps.find(item => item.routeOptions.name === '通用A')
    assert.deepEqual(
        step.channels.filter(item => item.selected).map(item => item.channelOptions.alias),
        ['HK-SOTP-3']
    )
})

test('选路：定向路由命中时不回落', async () => {
    const result = await createService(createManager(routeTables())).httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1008 })
    assert.deepEqual([result.matched, result.fallback, result.steps.length], [true, false, 1])
})

test('规则组：组内且、组间或，路由没有命中规则时跳过', async () => {
    const tables = routeTables()
    tables.TbSrmRouteRule = [
        { keyId: 1, routeKeyId: 1, sort: 0, status: 'enable', conditions: [{ field: 'country', operator: 'in', value: ['1008'] }] },
        {
            keyId: 2,
            routeKeyId: 3,
            sort: 0,
            status: 'enable',
            conditions: [
                { field: 'country', operator: 'in', value: ['1007'] },
                { field: 'type', operator: 'in', value: ['SOTP'] },
                { field: 'prefix', operator: 'not_prefix', value: ['85290'] }
            ]
        },
        {
            keyId: 3,
            routeKeyId: 2,
            sort: 0,
            status: 'enable',
            conditions: [{ field: 'prefix', operator: 'prefix', value: ['85290'] }]
        },
        { keyId: 4, routeKeyId: 2, sort: 1, status: 'disable', conditions: [{ field: 'country', operator: 'in', value: ['1007'] }] }
    ]
    const service = createService(createManager(tables))
    const normal = await service.httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1007, phone: '+85291234567' })
    assert.deepEqual(
        normal.steps.map(step => [step.routeOptions.name, step.admitted, step.matched]),
        [
            ['专线', false, false],
            ['通用A', true, true]
        ]
    )
    const blocked = await service.httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1007, phone: '85290123456' })
    assert.deepEqual(
        blocked.steps.map(step => [step.routeOptions.name, step.admitted, step.matched]),
        [
            ['专线', false, false],
            ['通用A', false, false],
            ['通用B', true, true]
        ]
    )
    const marketing = await service.httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1007, type: 'MRKT', phone: '85291234567' })
    assert.equal(marketing.matched, false)
    assert.match(marketing.message, /没有启用的同类型路由/)
})

test('没有启用规则组的路由不接收短信', async () => {
    const tables = routeTables()
    tables.TbSrmRouteRule = []
    const result = await createService(createManager(tables)).httpBaseSrmRoutePreview({ appKeyId: 1001, countryKeyId: 1007 })
    assert.equal(result.matched, false)
    assert.ok(result.steps.every(step => !step.admitted))
})

test('新增规则组校验字段与操作符、类型取值、号码段和方向', async () => {
    const tables = { TbSrmRoute: [{ keyId: 1, name: '通用', type: 'SOTP', status: 'enable' }], TbSrmRouteRule: [] }
    const service = createService(createManager(tables))
    const create = conditions => service.httpBaseSrmCreateRouteRule(principal, { routeKeyId: 1, sort: 2, conditions })
    await assert.rejects(() => create([{ field: 'prefix', operator: 'in', value: ['852'] }]), /不支持操作符/)
    await assert.rejects(() => create([{ field: 'type', operator: 'in', value: ['XXXX'] }]), /短信类型取值/)
    await assert.rejects(() => create([{ field: 'prefix', operator: 'prefix', value: ['85a'] }]), /号码段只能是/)
    await assert.rejects(() => create([{ field: 'country', operator: 'in', value: ['9999'] }]), /方向不存在：9999/)
    const rule = await create([
        { field: 'country', operator: 'in', value: ['1007', '1007', ' '] },
        { field: 'prefix', operator: 'prefix', value: ['+85291'] }
    ])
    assert.equal(rule.sort, 2)
    assert.deepEqual(rule.conditions, [
        { field: 'country', operator: 'in', value: ['1007'] },
        { field: 'prefix', operator: 'prefix', value: ['85291'] }
    ])
})
test('路由详情返回路由本身和绑定的通道列表', async () => {
    const route = { keyId: 1, name: '通用营销', alias: 'LSK1233-MRKT-A001', type: 'MRKT', priority: 1, status: 'enable' }
    const service = createService(createManager({ TbSrmRoute: [route] }))
    const channels = [{ keyId: 9, routeKeyId: 1, channelKeyId: 11, priority: 1, weight: 100, status: 'enable', active: true, ratio: 100 }]
    service.routeUtilsService.findRouteChannels = async routeKeyIds => {
        assert.deepEqual(routeKeyIds, [1])
        return channels
    }
    service.skylineFeignClient = { httpBaseSkylineColumnCountryResolver: async () => [] }
    const detail = await service.httpBaseSrmRouteResolver({ keyId: 1 })
    assert.equal(detail.alias, 'LSK1233-MRKT-A001')
    assert.deepEqual(detail.channels, channels)
})
