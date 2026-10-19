const test = require('node:test')
const assert = require('node:assert/strict')
const { plainToInstance } = require('class-transformer')
const { validate } = require('class-validator')
const { SimbankUtilsService } = require('../dist/modules/simbank/simbank.utils.service')
const { SimbankService } = require('../dist/modules/simbank/simbank.service')
const SimbankDto = require('../dist/modules/simbank/dto/simbank.dto')

const principal = { uid: '30001' }

function createUtils(options = [{ keyId: 1024316, label: 'T32', json: { total: 32 } }]) {
    const calls = []
    const skylineFeignClient = {
        async httpBaseSkylineChunkOptionColumn(authorization, input) {
            calls.push(['chunk', input])
            return { CHUNK_SRM_SIMBANK_MODEL: { type: 'CHUNK_SRM_SIMBANK_MODEL', count: options.length, options } }
        }
    }
    const configService = { get: () => 'service-token' }
    const utils = new SimbankUtilsService({}, {}, {}, skylineFeignClient, configService)
    return { calls, utils }
}

test('设备型号按 Skyline 枚举 json.total 解析端口数', async () => {
    const { calls, utils } = createUtils()
    assert.equal(await utils.fetchModelTotal(1024316), 32)
    assert.deepEqual(calls[0][1], { module: 'CHUNK_SRM', types: ['CHUNK_SRM_SIMBANK_MODEL'] })
    await assert.rejects(() => utils.fetchModelTotal(1), /设备型号不存在或已禁用/)
})

test('设备型号未配置端口数时拒绝', async () => {
    const { utils } = createUtils([{ keyId: 1024316, label: 'T32', json: {} }])
    await assert.rejects(() => utils.fetchModelTotal(1024316), /未配置有效的端口数/)
})

test('MAC 地址统一大写冒号格式，空别名按未设置处理', () => {
    const { utils } = createUtils()
    assert.equal(utils.fetchNormalizeMac(' aa-bb-cc-dd-ee-0f '), 'AA:BB:CC:DD:EE:0F')
    assert.equal(utils.fetchNormalizeMac('aabb.ccdd.ee0f'), 'AA:BB:CC:DD:EE:0F')
    assert.equal(utils.fetchNormalizeMac('aa bb cc dd ee 0f'), 'AA:BB:CC:DD:EE:0F')
    assert.equal(utils.fetchNormalizeAlias('  '), null)
    assert.equal(utils.fetchNormalizeAlias(' SB-01 '), 'SB-01')
})

test('新增设备写入端口数、默认启用离线，归属人默认当前账号', async () => {
    const calls = []
    const manager = {
        create: (_entity, values) => values,
        async save(value) {
            return { keyId: 100201, ...value }
        }
    }
    const repository = { manager: { transaction: callback => callback(manager) } }
    const simbankUtilsService = {
        fetchModelTotal: async () => 64,
        fetchNormalizeMac: mac => mac.toUpperCase(),
        fetchNormalizeAlias: alias => alias ?? null,
        fetchCheckUser: async keyId => calls.push(['user', keyId]),
        fetchCheckUnique: async (_manager, input) => calls.push(['unique', input])
    }
    const service = new SimbankService(repository, {}, simbankUtilsService)
    const result = await service.httpBaseSrmCreateSimbank(principal, {
        name: ' SIMBANK-01 ',
        model: 1024317,
        mac: 'aa:bb:cc:dd:ee:ff',
        userKeyId: 10241000
    })
    assert.equal(result.total, 64)
    assert.equal(result.name, 'SIMBANK-01')
    assert.equal(result.mac, 'AA:BB:CC:DD:EE:FF')
    assert.equal(result.alias, null)
    assert.equal(result.status, 'enable')
    assert.equal(result.online, 'offline')
    assert.equal(result.ownerUserUid, '30001')
    assert.equal(result.createBy, '30001')
    assert.deepEqual(calls, [
        ['user', 10241000],
        ['unique', { mac: 'AA:BB:CC:DD:EE:FF', alias: null }]
    ])
})

test('新增设备入参校验 MAC 格式，在线状态不在入参中', async () => {
    const base = { name: 'SIMBANK-01', model: 1024316, mac: 'AA:BB:CC:DD:EE:FF', userKeyId: 10241000 }
    assert.equal((await validate(plainToInstance(SimbankDto.CreateSimbankDto, base))).length, 0)
    const errors = await validate(plainToInstance(SimbankDto.CreateSimbankDto, { ...base, mac: 'AABBCC' }))
    assert.ok(errors.some(error => error.property === 'mac'))
    assert.equal(Object.prototype.hasOwnProperty.call(new SimbankDto.UpdateSimbankDto(), 'online'), false)
})
test('MAC 地址使用 isMACAddress 校验，兼容多种分隔写法', async () => {
    const base = { name: 'SIMBANK-01', model: 1024316, userKeyId: 10241000 }
    for (const mac of ['aa:bb:cc:dd:ee:ff', 'AA-BB-CC-DD-EE-FF', 'aabb.ccdd.eeff']) {
        assert.equal((await validate(plainToInstance(SimbankDto.CreateSimbankDto, { ...base, mac }))).length, 0, mac)
    }
    for (const mac of ['AA:BB:CC:DD:EE', 'GG:BB:CC:DD:EE:FF', 'AA:BB-CC:DD:EE:FF']) {
        const errors = await validate(plainToInstance(SimbankDto.CreateSimbankDto, { ...base, mac }))
        assert.ok(
            errors.some(error => error.property === 'mac'),
            mac
        )
    }
})
