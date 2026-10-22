const test = require('node:test')
const assert = require('node:assert/strict')
const { ChannelService } = require('../dist/modules/channel/channel.service')

const principal = { uid: '30001', number: '1024' }

function createService(manager, overrides = {}) {
    const repository = { manager: { transaction: async callback => callback(manager), ...overrides.manager }, ...overrides.repository }
    return new ChannelService(
        repository,
        overrides.portRepository ?? {},
        overrides.simbankPortRepository ?? {},
        {},
        overrides.database ?? {},
        overrides.skyline ?? {},
        { get: () => 'service-token' }
    )
}

function aliasQuery(aliases) {
    const qb = {
        setLock: () => qb,
        select: () => qb,
        where: (_sql, params) => ((qb.prefix = params.prefix), qb),
        getMany: async () => aliases.filter(alias => alias.startsWith(qb.prefix.slice(0, -1))).map(alias => ({ alias }))
    }
    return () => qb
}

const skyline = {
    httpBaseSkylineColumnCountryResolver: async () => [{ keyId: 1007, mcc: '460' }],
    httpBaseSkylineColumnUserResolver: async ({}, { uids }) => uids.filter(uid => uid !== 'missing').map(uid => ({ uid }))
}

test('新增通道按 TSK+归属人工号+类型+分段序号 生成别名，归属人默认当前登录人，默认停用', async () => {
    const manager = {
        createQueryBuilder: aliasQuery(['TSK1024-MRKT-A001', 'TSK1024-MRKT-A003', 'TSK1024-SOTP-A007']),
        create: (_entity, value) => value,
        save: async value => value
    }
    const result = await createService(manager, { skyline }).httpBaseSrmCreateChannel(principal, {
        name: ' 香港营销主通道 ',
        countryKeyId: 1007,
        type: 'MRKT',
        sendInterval: 3000,
        maxRetry: 3
    })
    assert.equal(result.alias, 'TSK1024-MRKT-A004')
    assert.equal(result.name, '香港营销主通道')
    assert.equal(result.countryKeyId, 1007)
    assert.equal(result.ownerUserUid, '30001')
    assert.equal(result.status, 'disable')
})

test('新增通道时方向或归属人不存在则拒绝', async () => {
    const noCountry = { ...skyline, httpBaseSkylineColumnCountryResolver: async () => [] }
    await assert.rejects(
        () => createService({}, { skyline: noCountry }).httpBaseSrmCreateChannel(principal, { countryKeyId: 1, type: 'MRKT' }),
        /方向不存在/
    )
    await assert.rejects(
        () =>
            createService({}, { skyline }).httpBaseSrmCreateChannel(principal, {
                countryKeyId: 1007,
                type: 'MRKT',
                ownerUserUid: 'missing'
            }),
        /归属人不存在/
    )
})

test('通道没有启用端口时不能启用', async () => {
    const manager = { findOneBy: async () => ({ keyId: 1, status: 'disable' }), countBy: async () => 0, save: async value => value }
    await assert.rejects(
        () => createService(manager).httpBaseSrmChannelStatusUpdate(principal, { keyId: 1, status: 'enable' }),
        /没有启用的端口/
    )
    const ok = { findOneBy: async () => ({ keyId: 1, status: 'disable' }), countBy: async () => 2, save: async value => value }
    const result = await createService(ok).httpBaseSrmChannelStatusUpdate(principal, { keyId: 1, status: 'enable' })
    assert.equal(result.status, 'enable')
})

test('删除通道前必须停用、从路由移除并解绑端口', async () => {
    const enabled = { findOneBy: async () => ({ keyId: 1, status: 'enable' }) }
    await assert.rejects(() => createService(enabled).httpBaseSrmDeleteChannel({ keyId: 1 }), /请先停用通道/)
    const inRoute = {
        findOneBy: async () => ({ keyId: 1, status: 'disable' }),
        existsBy: async entity => entity.name === 'TbSrmRouteChannel'
    }
    await assert.rejects(() => createService(inRoute).httpBaseSrmDeleteChannel({ keyId: 1 }), /仍被路由使用/)
    const hasPort = {
        findOneBy: async () => ({ keyId: 1, status: 'disable' }),
        existsBy: async entity => entity.name === 'TbSrmChannelPort'
    }
    await assert.rejects(() => createService(hasPort).httpBaseSrmDeleteChannel({ keyId: 1 }), /仍绑定端口/)
})

test('只能绑定已激活且方向与通道一致的端口', async () => {
    const manager = {
        findOneBy: async () => ({ keyId: 1, countryKeyId: 1007 }),
        find: async () => [
            { keyId: 11, port: 1, simbankKeyId: 100, activateStatus: 'active', countryKeyId: 1007 },
            { keyId: 12, port: 2, simbankKeyId: 100, activateStatus: 'active', countryKeyId: 1008 },
            { keyId: 13, port: 3, simbankKeyId: 100, activateStatus: 'inactive', countryKeyId: null }
        ]
    }
    await assert.rejects(
        () => createService(manager).httpBaseSrmBindChannelPort(principal, { channelKeyId: 1, portKeyIds: [11, 12, 13] }),
        /激活方向与通道不一致：2、3/
    )
})

test('端口已绑定其他通道时整批拒绝', async () => {
    const port = { simbankKeyId: 100, activateStatus: 'active', countryKeyId: 1007 }
    const manager = {
        findOneBy: async () => ({ keyId: 1, countryKeyId: 1007 }),
        find: async entity =>
            entity.name === 'TbSrmSimbankPort'
                ? [
                      { ...port, keyId: 11, port: 1 },
                      { ...port, keyId: 12, port: 2 }
                  ]
                : [{ portKeyId: 12, channelKeyId: 2 }]
    }
    await assert.rejects(
        () => createService(manager).httpBaseSrmBindChannelPort(principal, { channelKeyId: 1, portKeyIds: [11, 12] }),
        /端口已绑定其他通道：2/
    )
})

test('绑定端口写入设备快照，默认权重 1 并启用', async () => {
    const inserted = []
    const manager = {
        findOneBy: async () => ({ keyId: 1, countryKeyId: 1007 }),
        find: async entity =>
            entity.name === 'TbSrmSimbankPort'
                ? [{ keyId: 11, port: 1, simbankKeyId: 100, activateStatus: 'active', countryKeyId: 1007 }]
                : [],
        insert: async (_entity, rows) => inserted.push(...rows)
    }
    const result = await createService(manager).httpBaseSrmBindChannelPort(principal, { channelKeyId: 1, portKeyIds: [11, 11] })
    assert.equal(result.count, 1)
    assert.deepEqual(inserted[0], {
        channelKeyId: 1,
        portKeyId: 11,
        simbankKeyId: 100,
        weight: 1,
        status: 'enable',
        createBy: '30001',
        modifyBy: '30001'
    })
})

test('启用中的通道不能解绑或停用到一个启用端口都不剩', async () => {
    const manager = {
        find: async () => [{ keyId: 5, channelKeyId: 1 }],
        findOneBy: async () => ({ keyId: 1, alias: '1024-460-MRKT-01', status: 'enable' }),
        countBy: async () => 0
    }
    await assert.rejects(() => createService(manager).httpBaseSrmUnbindChannelPort({ keyIds: [5] }), /至少保留一个启用端口/)
})
