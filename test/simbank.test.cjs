const test = require('node:test')
const assert = require('node:assert/strict')
const { plainToInstance } = require('class-transformer')
const { validate } = require('class-validator')
const { SimbankUtilsService } = require('../dist/modules/simbank/simbank.utils.service')
const { SimbankService } = require('../dist/modules/simbank/simbank.service')

/** 测试中注入完整依赖；第 6 个参数是选路和发送配置变更广播。 */
function createSimbankService(repository = {}, database = {}, utils = {}, portRepository = {}, messageRepository = {}) {
    return new SimbankService(repository, database, utils, portRepository, messageRepository, { publish: async () => undefined })
}
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

test('MAC 地址统一大写冒号格式', () => {
    const { utils } = createUtils()
    assert.equal(utils.fetchNormalizeMac(' aa-bb-cc-dd-ee-0f '), 'AA:BB:CC:DD:EE:0F')
    assert.equal(utils.fetchNormalizeMac('aabb.ccdd.ee0f'), 'AA:BB:CC:DD:EE:0F')
    assert.equal(utils.fetchNormalizeMac('aa bb cc dd ee 0f'), 'AA:BB:CC:DD:EE:0F')
})

test('新增设备在命名锁内生成别名，写入端口数并同步创建端口，提交事务后释放锁', async () => {
    const calls = []
    const ports = []
    const manager = {
        create: (_entity, values) => values,
        async save(value) {
            calls.push(['save'])
            return { keyId: 100201, ...value }
        },
        async insert(_entity, values) {
            calls.push(['insert', values.length])
            ports.push(...values)
        }
    }
    const queryRunner = {
        manager,
        isTransactionActive: true,
        async commitTransaction() {
            calls.push(['commit'])
            this.isTransactionActive = false
        },
        async rollbackTransaction() {
            calls.push(['rollback'])
        },
        async release() {
            calls.push(['release'])
        }
    }
    const database = { transaction: async () => queryRunner }
    const simbankUtilsService = {
        fetchModelTotal: async () => 64,
        fetchNormalizeMac: mac => mac.toUpperCase(),
        acquireCreateLock: async () => calls.push(['lock']) > 0,
        releaseCreateLock: async () => calls.push(['unlock']),
        generateAlias: async (_manager, number) => `RSK${number}SMSA001`,
        fetchCheckUser: async keyId => calls.push(['user', keyId]),
        fetchCheckUnique: async (_manager, input) => calls.push(['unique', input])
    }
    const service = createSimbankService({}, database, simbankUtilsService)
    const result = await service.httpBaseSrmCreateSimbank(
        { uid: '30001', number: '1233' },
        { name: ' SIMBANK-01 ', model: 1024317, mac: 'aa:bb:cc:dd:ee:ff', userKeyId: 10241000, alias: 'IGNORED' }
    )
    assert.equal(result.alias, 'RSK1233SMSA001')
    assert.equal(result.total, 64)
    assert.equal(result.name, 'SIMBANK-01')
    assert.equal(result.mac, 'AA:BB:CC:DD:EE:FF')
    assert.equal(result.status, 'enable')
    assert.equal(result.online, 'offline')
    assert.equal(result.ownerUserUid, '30001')
    assert.equal(result.createBy, '30001')
    assert.deepEqual(ports[0], {
        simbankKeyId: 100201,
        port: 1,
        activateStatus: 'inactive',
        insertStatus: 'removed',
        status: 'enable',
        createBy: '30001',
        modifyBy: '30001'
    })
    assert.equal(ports[63].port, 64)
    assert.deepEqual(calls, [
        ['lock'],
        ['user', 10241000],
        ['unique', { mac: 'AA:BB:CC:DD:EE:FF' }],
        ['save'],
        ['insert', 64],
        ['commit'],
        ['unlock'],
        ['release']
    ])
})

test('设备别名按工号自增：RSK + 工号 + SMS + A001-Z999，之后 AA01-ZZ99', async () => {
    const make = aliases => {
        const database = {
            builder: async (_repository, callback) => {
                const qb = { select: () => qb, where: () => qb, getMany: async () => aliases.map((alias, keyId) => ({ keyId, alias })) }
                return callback(qb)
            }
        }
        return new SimbankUtilsService({}, database, {}, {}, {})
    }
    const manager = { getRepository: () => ({}) }
    assert.equal(await make([]).generateAlias(manager, '1233'), 'RSK1233SMSA001')
    assert.equal(await make(['RSK1233SMSA001', 'RSK1233SMSA007', 'OTHER']).generateAlias(manager, '1233'), 'RSK1233SMSA008')
    assert.equal(await make(['RSK1233SMSA999']).generateAlias(manager, '1233'), 'RSK1233SMSB001')
    assert.equal(await make(['RSK1233SMSZ999']).generateAlias(manager, '1233'), 'RSK1233SMSAA01')
    assert.equal(make([]).formatAliasSequence(92898), 'ZZ99')
    await assert.rejects(make([]).generateAlias(manager, ''), /缺少有效工号/)
    assert.throws(() => make([]).formatAliasSequence(92899), /序号已用完/)
})

test('新增设备入参校验 MAC 格式，在线状态不在入参中', async () => {
    const base = { name: 'SIMBANK-01', model: 1024316, mac: 'AA:BB:CC:DD:EE:FF', userKeyId: 10241000 }
    assert.equal((await validate(plainToInstance(SimbankDto.CreateSimbankDto, base))).length, 0)
    const errors = await validate(plainToInstance(SimbankDto.CreateSimbankDto, { ...base, mac: 'AABBCC' }))
    assert.ok(errors.some(error => error.property === 'mac'))
    assert.equal(Object.prototype.hasOwnProperty.call(new SimbankDto.UpdateSimbankDto(), 'online'), false)
})

test('编辑设备只更新设备名称、设备状态', async () => {
    const simbank = { keyId: 100201, name: 'OLD', model: 1024316, mac: 'AA:BB:CC:DD:EE:FF', total: 64, status: 'enable' }
    const manager = {
        merge: (_entity, target, values) => Object.assign(target, values),
        save: async value => value
    }
    const repository = { manager: { transaction: async callback => callback(manager) } }
    const service = createSimbankService(repository, {}, { findRequired: async () => simbank })
    const result = await service.httpBaseSrmUpdateSimbank(
        { uid: '30002' },
        { keyId: 100201, name: ' NEW ', status: 'disable', model: 1, mac: 'BB:BB:BB:BB:BB:BB', userKeyId: 1 }
    )
    assert.deepEqual(result, { ...simbank, name: 'NEW', status: 'disable', modifyBy: '30002' })
    assert.equal(result.model, 1024316)
    assert.equal(result.mac, 'AA:BB:CC:DD:EE:FF')
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

test('端口分页没有匹配供应商设备时直接返回空列表', async () => {
    const calls = []
    const database = {
        async builder(repo, callback) {
            calls.push(repo)
            const qb = {
                select: () => qb,
                andWhere: () => qb,
                getMany: async () => []
            }
            return callback(qb)
        }
    }
    const service = createSimbankService('device-repo', database, {}, 'port-repo')
    const result = await service.httpBaseSrmColumnSimbankPort({ page: 1, size: 20, userKeyId: 9 })
    assert.deepEqual(calls, ['device-repo'])
    assert.equal(result.total, 0)
    assert.deepEqual(result.list, [])
})

test('端口分页关键词同时匹配卡号和设备，并还原所属设备', async () => {
    const wheres = []
    const database = {
        async builder(repo, callback) {
            const qb = {
                select: () => qb,
                andWhere: (sql, params) => {
                    wheres.push([repo, sql, params])
                    return qb
                },
                orderBy: () => qb,
                addOrderBy: () => qb,
                skip: () => qb,
                take: () => qb,
                getMany: async () => (repo === 'device' ? [{ keyId: 9 }] : []),
                getManyAndCount: async () => [[{ keyId: 1, simbankKeyId: 9, port: 2 }], 1]
            }
            return callback(qb)
        }
    }
    const service = createSimbankService(
        'device',
        database,
        {
            fetchAppendPortColumnOptions: async list => {
                list[0].simbankOptions = { name: 'SIMBANK-01' }
            }
        },
        'port'
    )
    const result = await service.httpBaseSrmColumnSimbankPort({ page: 1, size: 10, name: ' 8986 ' })
    assert.equal(result.total, 1)
    assert.equal(result.list[0].simbankOptions.name, 'SIMBANK-01')
    assert.equal(
        wheres.some(item => item[0] === 'device' && item[1].includes('t.name LIKE :keyword')),
        true
    )
    assert.equal(
        wheres.some(item => item[0] === 'port' && item[1].includes('t.iccid LIKE :keyword') && item[1].includes('keywordSimbankKeyIds')),
        true
    )
    assert.equal(wheres.find(item => item[0] === 'port')[2].keyword, '%8986%')
})

test('更新端口状态写入修改人，端口不存在时拒绝', async () => {
    const saved = []
    const missing = {
        manager: { transaction: async callback => callback({ findOneBy: async () => null, save: async value => value }) }
    }
    await assert.rejects(
        () =>
            createSimbankService({}, {}, {}, missing).httpBaseSrmSimbankPortStatusUpdate({ uid: '30001' }, { keyId: 1, status: 'disable' }),
        /端口不存在/
    )
    const port = { keyId: 1, status: 'enable', modifyBy: '1' }
    const found = {
        manager: {
            transaction: async callback =>
                callback({
                    findOneBy: async () => port,
                    save: async value => {
                        saved.push(value)
                        return value
                    }
                })
        }
    }
    const result = await createSimbankService({}, {}, {}, found).httpBaseSrmSimbankPortStatusUpdate(
        { uid: '30001' },
        { keyId: 1, status: 'disable' }
    )
    assert.equal(result.status, 'disable')
    assert.equal(saved[0].modifyBy, '30001')
})

test('插卡模拟数据按激活方向国际区号生成', () => {
    const { utils } = createUtils()
    const china = utils.createPortCardFaker('86')
    const britain = utils.createPortCardFaker('44')
    assert.match(china.sim, /^86[0-9]{6,12}$/)
    assert.match(china.iccid, /^8986[0-9]+$/)
    assert.match(britain.sim, /^44[0-9]{6,12}$/)
    assert.match(britain.iccid, /^8944[0-9]+$/)
    assert.match(china.imei, /^[0-9]{15}$/)
    assert.throws(() => utils.fetchCardMatchesDialCode('+8613800138000', '8986001234567890123', '44'), /SIM 卡号码必须属于国际区号 \+44/)
})

test('插入 SIM 卡必须已激活且卡号属于激活方向', async () => {
    const card = { keyId: 1, sim: '+8613800138000', iccid: '89860012345678901234', imei: '860000000000000' }
    const dials = []
    const utils = {
        fetchCardMatchesDialCode(_sim, _iccid, dial) {
            dials.push(dial)
        },
        fetchNormalizeSim: sim => sim.trim().replace(/^\+/, ''),
        async fetchCountryDialCode(countryKeyId) {
            return countryKeyId === 86 ? '86' : '44'
        }
    }
    await assert.rejects(
        () =>
            createSimbankService({}, {}, utils, {
                manager: {
                    transaction: async callback =>
                        callback({ findOneBy: async () => ({ keyId: 1, activateStatus: 'inactive' }), save: async value => value })
                }
            }).httpBaseSrmSimbankPortInsert({ uid: '30001' }, card),
        /请先激活并选择激活方向/
    )
    await assert.rejects(
        () =>
            createSimbankService({}, {}, utils, {
                manager: {
                    transaction: async callback =>
                        callback({
                            findOneBy: async () => ({ keyId: 1, activateStatus: 'active', countryKeyId: 86, insertStatus: 'inserted' }),
                            save: async value => value
                        })
                }
            }).httpBaseSrmSimbankPortInsert({ uid: '30001' }, card),
        /端口已插入 SIM 卡/
    )
    const port = { keyId: 1, insertStatus: 'removed', activateStatus: 'active', countryKeyId: 86 }
    const result = await createSimbankService({}, {}, utils, {
        manager: {
            transaction: async callback =>
                callback({
                    findOneBy: async (_entity, where) => (where.iccid ? null : port),
                    save: async value => value
                })
        }
    }).httpBaseSrmSimbankPortInsert(
        { uid: '30001' },
        { keyId: 1, sim: ' +8613800138000 ', iccid: ' 89860012345678901234 ', imei: ' 860000000000000 ' }
    )
    assert.equal(result.insertStatus, 'inserted')
    assert.equal(result.sim, '8613800138000')
    assert.deepEqual(dials, ['86'])
    assert.equal(result.modifyBy, '30001')
})

test('激活不要求先插卡，已激活时拒绝并写入激活方向', async () => {
    await assert.rejects(
        () =>
            createSimbankService(
                {},
                {},
                {},
                {
                    manager: {
                        transaction: async callback => callback({ findOneBy: async () => ({ keyId: 1, activateStatus: 'active' }) })
                    }
                }
            ).httpBaseSrmSimbankPortActivate({ uid: '30001' }, { keyId: 1, countryKeyId: 1024 }),
        /SIM 卡已激活/
    )
    const port = { keyId: 1, insertStatus: 'removed', activateStatus: 'inactive' }
    const result = await createSimbankService(
        {},
        {},
        {},
        {
            manager: {
                transaction: async callback => callback({ findOneBy: async () => port, save: async value => value })
            }
        }
    ).httpBaseSrmSimbankPortActivate({ uid: '30001' }, { keyId: 1, countryKeyId: 1024 })
    assert.equal(result.activateStatus, 'active')
    assert.equal(result.countryKeyId, 1024)
    assert.equal(result.insertStatus, 'removed')
    assert.equal(result.modifyBy, '30001')
})

test('拔卡清除卡号但保留激活方向，未插卡时拒绝', async () => {
    await assert.rejects(
        () =>
            createSimbankService(
                {},
                {},
                {},
                {
                    manager: {
                        transaction: async callback => callback({ findOneBy: async () => ({ keyId: 1, insertStatus: 'removed' }) })
                    }
                }
            ).httpBaseSrmSimbankPortRemove({ uid: '30001' }, { keyId: 1 }),
        /端口未插入 SIM 卡/
    )
    const port = {
        keyId: 1,
        insertStatus: 'inserted',
        activateStatus: 'active',
        countryKeyId: 1024,
        sim: '+8613800138000',
        iccid: '89860012345678901234',
        imei: '860000000000000'
    }
    const result = await createSimbankService(
        {},
        {},
        {},
        {
            manager: { transaction: async callback => callback({ findOneBy: async () => port, save: async value => value }) }
        }
    ).httpBaseSrmSimbankPortRemove({ uid: '30001' }, { keyId: 1 })
    assert.equal(result.insertStatus, 'removed')
    assert.equal(result.sim, null)
    assert.equal(result.iccid, null)
    assert.equal(result.imei, null)
    assert.equal(result.activateStatus, 'active')
    assert.equal(result.countryKeyId, 1024)
    assert.equal(result.modifyBy, '30001')
})

test('释放已激活端口时清除卡号、激活状态和激活方向，已绑定通道的端口需先解绑', async () => {
    await assert.rejects(
        () =>
            createSimbankService(
                {},
                {},
                {},
                {
                    manager: {
                        transaction: async callback => callback({ findOneBy: async () => ({ keyId: 1, activateStatus: 'inactive' }) })
                    }
                }
            ).httpBaseSrmSimbankPortRelease({ uid: '30001' }, { keyId: 1 }),
        /端口未激活/
    )
    const port = {
        keyId: 1,
        insertStatus: 'inserted',
        activateStatus: 'active',
        countryKeyId: 1024,
        sim: '+8613800138000',
        iccid: '89860012345678901234',
        imei: '860000000000000'
    }
    const bound = createSimbankService(
        {},
        {},
        {},
        {
            manager: { transaction: async callback => callback({ findOneBy: async () => ({ ...port }), existsBy: async () => true }) }
        }
    ).httpBaseSrmSimbankPortRelease({ uid: '30001' }, { keyId: 1 })
    await assert.rejects(() => bound, /端口已绑定短信通道，请先解绑/)
    const result = await createSimbankService(
        {},
        {},
        {},
        {
            manager: {
                transaction: async callback =>
                    callback({ findOneBy: async () => port, existsBy: async () => false, save: async value => value })
            }
        }
    ).httpBaseSrmSimbankPortRelease({ uid: '30001' }, { keyId: 1 })
    assert.equal(result.activateStatus, 'inactive')
    assert.equal(result.insertStatus, 'removed')
    assert.equal(result.countryKeyId, null)
    assert.equal(result.sim, null)
    assert.equal(result.iccid, null)
    assert.equal(result.imei, null)
    assert.equal(result.modifyBy, '30001')
})

test('插卡模拟数据按激活方向 countryKeyId 查询 Skyline 国际区号', async () => {
    const calls = []
    const skylineFeignClient = {
        async httpBaseSkylineCountryResolver(authorization, input) {
            calls.push({ authorization, input })
            return { keyId: input.keyId, code: '86', mcc: '460', cnName: '中国', enName: 'China', status: 'enable' }
        }
    }
    const utils = new SimbankUtilsService({}, {}, {}, skylineFeignClient, { get: () => 'service-token' })
    assert.equal(await utils.fetchCountryDialCode(1077), '86')
    assert.deepEqual(calls[0], { authorization: 'Bearer service-token', input: { keyId: 1077 } })
    const result = await createSimbankService({}, {}, utils, {}).httpBaseSrmSimbankPortFaker({ countryKeyId: 1077 })
    assert.match(result.sim, /^86[0-9]{6,12}$/)
    assert.match(result.iccid, /^8986[0-9]+$/)
})

test('插卡模拟数据入参只接受 countryKeyId，插卡入参不再包含 code', async () => {
    const valid = plainToInstance(SimbankDto.SimbankPortFakerQueryDto, { countryKeyId: '1077' })
    assert.deepEqual(await validate(valid), [])
    assert.equal(valid.countryKeyId, 1077)
    assert.equal(valid.code, undefined)
    assert.equal((await validate(plainToInstance(SimbankDto.SimbankPortFakerQueryDto, {}))).length, 1)
    const insert = plainToInstance(SimbankDto.InsertSimbankPortDto, {
        keyId: 1,
        sim: '8613800138000',
        iccid: '89860012345678901234',
        imei: '860000000000000'
    })
    assert.deepEqual(await validate(insert), [])
})
test('短信历史分页按 MCC 精确过滤', async () => {
    const wheres = []
    const database = {
        async builder(_repo, callback) {
            const qb = {
                andWhere: (sql, params) => {
                    wheres.push([sql, params])
                    return qb
                },
                orderBy: () => qb,
                addOrderBy: () => qb,
                skip: () => qb,
                take: () => qb,
                getManyAndCount: async () => [[{ keyId: 1, ownerUserUid: '0' }], 1]
            }
            return callback(qb)
        }
    }
    const service = createSimbankService(
        {},
        database,
        {},

        {},
        {}
    )
    const result = await service.httpBaseSrmColumnSimbankMessage({
        page: 1,
        size: 20,
        source: 'down',
        mcc: ' 460 ',
        msgId: ' msg-1 ',
        channelKeyId: 1001,
        startTime: '2026-10-31 00:00:00',
        endTime: '2026-10-31 23:59:59'
    })
    assert.equal(result.total, 1)
    assert.deepEqual(wheres, [
        ['t.msgId = :msgId', { msgId: 'msg-1' }],
        ['t.channelKeyId = :channelKeyId', { channelKeyId: 1001 }],
        ['t.mcc = :mcc', { mcc: '460' }],
        ['t.source = :source', { source: 'down' }],
        ['t.sendTime >= :sendTimeStart', { sendTimeStart: '2026-10-31 00:00:00' }],
        ['t.sendTime <= :sendTimeEnd', { sendTimeEnd: '2026-10-31 23:59:59' }]
    ])
})
test('按方向和归属人查询可绑定端口：不分页，附带设备，关键词模糊匹配 SIM、IMEI、ICCID', async () => {
    const calls = []
    const qb = {
        where: (sql, params) => (calls.push([sql, params]), qb),
        andWhere: (sql, params) => (calls.push([sql, params]), qb),
        orderBy: () => qb,
        addOrderBy: () => qb,
        skip: () => {
            throw new Error('不应分页')
        },
        take: () => {
            throw new Error('不应分页')
        },
        getMany: async () => [
            { keyId: 1002401, port: 1, sim: '8613800000001', simbankKeyId: 100202, countryKeyId: 1077 },
            { keyId: 1002402, port: 2, sim: '8613800000002', simbankKeyId: 100202, countryKeyId: 1077 }
        ]
    }
    const database = { builder: async (_repository, callback) => callback(qb), selection: async () => qb }
    const simbank = { keyId: 100202, alias: 'RSK1233SMSA002', name: '昊天科技-澜沧' }
    const service = createSimbankService(
        {},
        database,
        {
            findByOwnerUserUid: async () => ({ simbanks: [simbank], simbankOptions: new Map([[simbank.keyId, simbank]]) })
        },
        {}
    )
    const list = await service.httpBaseSrmSelectSimbankPort({ countryKeyId: 1077, ownerUserUid: '30001', vague: ' +86138 ' })
    assert.equal(list.length, 2)
    assert.equal(list[0].simbankOptions.name, '昊天科技-澜沧')
    assert.equal(list[0].showName, 'RSK1233SMSA002 - 端口[1]')
    assert.deepEqual(calls.find(([sql]) => sql.includes('t.imei LIKE'))[1], { vague: '%+86138%' })
})

test('可绑定端口默认排除已绑定通道端口，传入通道时保留该通道端口，传入设备时只查该设备', async () => {
    const simbanks = [
        { keyId: 100201, alias: 'RSK1233SMSA001' },
        { keyId: 100202, alias: 'RSK1233SMSA002' }
    ]
    async function select(input) {
        const calls = []
        const qb = {
            where: (sql, params) => (calls.push([sql, params]), qb),
            andWhere: (sql, params) => (calls.push([sql, params]), qb),
            orderBy: () => qb,
            addOrderBy: () => qb,
            getMany: async () => []
        }
        const service = createSimbankService(
            {},
            { builder: async (_repository, callback) => callback(qb), selection: async () => qb },
            { findByOwnerUserUid: async () => ({ simbanks, simbankOptions: new Map(simbanks.map(item => [item.keyId, item])) }) },
            {}
        )
        await service.httpBaseSrmSelectSimbankPort({ ownerUserUid: '30001', ...input })
        return calls
    }

    const defaults = await select({})
    assert.deepEqual(defaults[0][1], { simbankKeyIds: [100201, 100202] })
    assert.ok(defaults.some(([sql, params]) => sql === 't.keyId NOT IN (SELECT cp.port_key_id FROM tb_srm_channel_port cp)' && !params))

    const channel = await select({ channelKeyId: 3001 })
    const bound = channel.find(([sql]) => sql.includes('tb_srm_channel_port'))
    assert.match(bound[0], /cp\.channel_key_id <> :boundChannelKeyId/)
    assert.deepEqual(bound[1], { boundChannelKeyId: 3001 })

    const device = await select({ simbankKeyId: '100202' })
    assert.deepEqual(device[0][1], { simbankKeyIds: [100202] })
    assert.ok(device.some(([sql]) => sql === 't.keyId NOT IN (SELECT cp.port_key_id FROM tb_srm_channel_port cp)'))
})

test('传入的设备不属于归属人时直接返回空列表', async () => {
    const simbank = { keyId: 100201, alias: 'RSK1233SMSA001' }
    const service = createSimbankService(
        {},
        { builder: async () => assert.fail('不应查询端口') },
        { findByOwnerUserUid: async () => ({ simbanks: [simbank], simbankOptions: new Map([[simbank.keyId, simbank]]) }) },
        {}
    )
    assert.deepEqual(await service.httpBaseSrmSelectSimbankPort({ ownerUserUid: '30001', simbankKeyId: 999999 }), [])
})

test('可绑定端口入参通道ID和设备ID可选，传入时必须是正整数', async () => {
    const ok = plainToInstance(SimbankDto.ListOwnerCountryPortDto, { ownerUserUid: '30001', channelKeyId: '3001', simbankKeyId: '100201' })
    const okErrors = await validate(ok, { skipMissingProperties: false })
    assert.ok(!okErrors.some(item => ['channelKeyId', 'simbankKeyId'].includes(item.property)))
    assert.equal(ok.channelKeyId, 3001)
    const bad = plainToInstance(SimbankDto.ListOwnerCountryPortDto, { ownerUserUid: '30001', channelKeyId: 0, simbankKeyId: 'x' })
    const badErrors = await validate(bad)
    assert.ok(badErrors.some(item => item.property === 'channelKeyId'))
    assert.ok(badErrors.some(item => item.property === 'simbankKeyId'))
})

test('归属人名下没有设备时直接返回空列表', async () => {
    const service = createSimbankService(
        {},
        { builder: async () => assert.fail('不应查询端口') },
        { findByOwnerUserUid: async () => ({ simbanks: [], simbankOptions: new Map() }) },
        {}
    )
    assert.deepEqual(await service.httpBaseSrmSelectSimbankPort({ countryKeyId: 1077, ownerUserUid: '30001' }), [])
})

test('设备下拉 vague 为空字符串时不校验必填', async () => {
    assert.deepEqual(await validate(plainToInstance(SimbankDto.SelectSimbankDto, { vague: '' })), [])
})
