const test = require('node:test')
const assert = require('node:assert/strict')
const { RouteService } = require('../dist/modules/route/route.service')

const principal = { uid: '30001', number: '1024' }
const skyline = { httpBaseSkylineColumnCountryResolver: async () => [{ keyId: 1007 }] }
const crm = { httpBaseCrmColumnUserResolver: async (_auth, { keyIds }) => keyIds.filter(keyId => keyId !== 404).map(keyId => ({ keyId })) }

function createService(manager, overrides = {}) {
    const repository = { manager: { transaction: async callback => callback(manager) }, ...overrides.repository }
    return new RouteService(
        repository,
        overrides.routeChannelRepository ?? {},
        overrides.channelRepository ?? {},
        overrides.portRepository ?? {},
        overrides.database ?? {},
        overrides.skyline ?? skyline,
        overrides.crm ?? crm,
        { get: () => 'service-token' }
    )
}

test('新增路由：不传客户为默认路由，方向 + 类型 + 客户重复时拒绝', async () => {
    const manager = { existsBy: async () => false, create: (_entity, value) => value, save: async value => value }
    const route = await createService(manager).httpBaseSrmCreateRoute(principal, { countryKeyId: 1007, type: 'MRKT' })
    assert.equal(route.userKeyId, 0)
    assert.equal(route.status, 'enable')
    const duplicated = { existsBy: async () => true }
    await assert.rejects(
        () => createService(duplicated).httpBaseSrmCreateRoute(principal, { countryKeyId: 1007, type: 'MRKT' }),
        /已有默认路由/
    )
    await assert.rejects(
        () => createService(duplicated).httpBaseSrmCreateRoute(principal, { countryKeyId: 1007, type: 'MRKT', userKeyId: 10241000 }),
        /已有专属路由/
    )
})

test('新增专属路由时客户必须存在', async () => {
    await assert.rejects(
        () => createService({}).httpBaseSrmCreateRoute(principal, { countryKeyId: 1007, type: 'MRKT', userKeyId: 404 }),
        /客户不存在/
    )
})

test('路由只能加入方向和类型一致的通道，且不能重复加入', async () => {
    const route = { keyId: 1, countryKeyId: 1007, type: 'MRKT' }
    const mismatch = {
        findOneBy: async entity =>
            entity.name === 'TbSrmRoute' ? route : { keyId: 11, alias: '1024-460-SOTP-01', countryKeyId: 1007, type: 'SOTP' }
    }
    await assert.rejects(
        () => createService(mismatch).httpBaseSrmCreateRouteChannel(principal, { routeKeyId: 1, channelKeyId: 11 }),
        /方向或类型与路由不一致/
    )
    const channel = { keyId: 12, alias: '1024-460-MRKT-01', countryKeyId: 1007, type: 'MRKT' }
    const existed = { findOneBy: async entity => (entity.name === 'TbSrmRoute' ? route : channel), existsBy: async () => true }
    await assert.rejects(
        () => createService(existed).httpBaseSrmCreateRouteChannel(principal, { routeKeyId: 1, channelKeyId: 12 }),
        /已在该路由中/
    )
    const ok = {
        findOneBy: async entity => (entity.name === 'TbSrmRoute' ? route : channel),
        existsBy: async () => false,
        create: (_entity, value) => value,
        save: async value => value
    }
    const link = await createService(ok).httpBaseSrmCreateRouteChannel(principal, { routeKeyId: 1, channelKeyId: 12 })
    assert.deepEqual([link.priority, link.weight, link.status], [1, 100, 'enable'])
})

test('路由通道占比只在同优先级的可用通道之间计算', async () => {
    const links = [
        { keyId: 1, routeKeyId: 1, channelKeyId: 11, priority: 1, weight: 60, status: 'enable' },
        { keyId: 2, routeKeyId: 1, channelKeyId: 12, priority: 1, weight: 40, status: 'enable' },
        { keyId: 3, routeKeyId: 1, channelKeyId: 13, priority: 1, weight: 100, status: 'enable' },
        { keyId: 4, routeKeyId: 1, channelKeyId: 14, priority: 2, weight: 100, status: 'enable' },
        { keyId: 5, routeKeyId: 1, channelKeyId: 15, priority: 2, weight: 100, status: 'disable' }
    ]
    const channels = [
        { keyId: 11, status: 'enable' },
        { keyId: 12, status: 'enable' },
        { keyId: 13, status: 'disable' },
        { keyId: 14, status: 'enable' },
        { keyId: 15, status: 'enable' }
    ]
    const ports = [11, 12, 13, 14, 15].map(channelKeyId => ({ channelKeyId }))
    const service = createService(
        {},
        {
            routeChannelRepository: { find: async () => links },
            channelRepository: { find: async () => channels },
            portRepository: { find: async () => ports }
        }
    )
    const result = await service.httpBaseSrmListRouteChannel({ routeKeyId: 1 })
    const ratio = Object.fromEntries(result.map(item => [item.keyId, item.ratio]))
    assert.deepEqual(ratio, { 1: 60, 2: 40, 3: 0, 4: 100, 5: 0 })
    assert.equal(result.find(item => item.keyId === 3).active, false)
})
