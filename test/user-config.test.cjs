const test = require('node:test')
const assert = require('node:assert/strict')
const { UserUtilsService } = require('../dist/modules/user/user.utils.service')
const { SRM_USER_ALIAS_RANDOM_CHARACTERS } = require('../dist/modules/user/user.constants')
const aliasPattern = new RegExp(`^RSK1233[${SRM_USER_ALIAS_RANDOM_CHARACTERS}]{4}$`)

function createContext(config) {
    const calls = []
    const configRepository = {
        manager: {},
        merge(target, values) {
            Object.assign(target, values)
        },
        create(values) {
            return values
        },
        async save(value) {
            calls.push(['save-config', value])
            return value
        }
    }
    const manager = {
        getRepository() {
            return configRepository
        },
        create(_entity, values) {
            return values
        },
        async save(value) {
            calls.push(['save-user', value])
            return { keyId: 10241000, ...value }
        }
    }
    configRepository.manager = manager
    const repository = {
        manager: {
            transaction: callback => callback(manager)
        }
    }
    const queryBuilder = {
        where() {
            return this
        },
        setLock() {
            calls.push(['lock'])
            return this
        },
        async getOne() {
            return config
        },
        async getExists() {
            calls.push(['alias-exists'])
            return false
        }
    }
    const database = { builder: async (_repository, callback) => callback(queryBuilder) }
    return { calls, manager, service: new UserUtilsService(repository, configRepository, database) }
}

test('供应商未配置时返回默认配置', async () => {
    const { service } = createContext(null)
    assert.deepEqual(await service.findConfig(10241000), { userKeyId: 10241000, simbankLimit: 5 })
})

test('供应商已配置时返回配置，事务内查询加写锁', async () => {
    const { calls, manager, service } = createContext({ keyId: 3, userKeyId: 10241000, simbankLimit: 8, createBy: '1' })
    assert.deepEqual(await service.findConfig(10241000, manager), { userKeyId: 10241000, simbankLimit: 8 })
    assert.deepEqual(calls, [['lock']])
})

test('新增供应商时在同一事务内初始化默认配置并创建联系人', async () => {
    const { calls, service } = createContext(null)
    const contact = { name: '李逸飞', items: [{ type: 1024188, value: 'a@b.com' }], address: '深圳' }
    const user = await service.createUser({
        name: '测试供应商',
        currency: 'USD',
        ownerUserUid: '30001',
        ownerUserNumber: '1233',
        contact
    })
    assert.equal(user.keyId, 10241000)
    assert.deepEqual(
        calls.map(([method]) => method),
        ['alias-exists', 'save-user', 'lock', 'save-config', 'save-user']
    )
    assert.match(calls[1][1].alias, aliasPattern)
    assert.deepEqual(calls[3][1], { userKeyId: 10241000, createBy: '30001', modifyBy: '30001' })
    assert.deepEqual(calls[4][1], {
        userKeyId: 10241000,
        name: '李逸飞',
        items: contact.items,
        address: '深圳',
        status: 'enable',
        remark: undefined,
        createBy: '30001',
        modifyBy: '30001'
    })
})

test('新增供应商未填写联系人时拒绝创建', async () => {
    const { calls, service } = createContext(null)
    await assert.rejects(
        service.createUser({ name: '测试供应商', currency: 'USD', ownerUserUid: '30001', ownerUserNumber: '1233' }),
        /新增供应商必须填写联系人信息/
    )
    assert.equal(calls.length, 0)
})

test('供应商别名随机码碰撞时重新生成', async () => {
    const { manager, service } = createContext(null)
    let count = 0
    service.database.builder = async (_repository, callback) =>
        callback({
            where() {
                return this
            },
            async getExists() {
                count += 1
                return count === 1
            }
        })
    assert.match(await service.generateAlias(manager, '1233'), aliasPattern)
    assert.equal(count, 2)
})

test('创建人缺少有效工号时拒绝生成供应商别名', async () => {
    const { manager, service } = createContext(null)
    await assert.rejects(service.generateAlias(manager, ''), /当前登录账号缺少有效工号/)
})

test('供应商别名随机码只使用配置字符集', async () => {
    const { manager, service } = createContext(null)
    for (let index = 0; index < 200; index += 1) {
        assert.match(await service.generateAlias(manager, '1233'), aliasPattern)
    }
})

test('供应商详情返回供应商配置', async () => {
    const { UserService } = require('../dist/modules/user/user.service')
    const userUtilsService = {
        async findRequired(keyId) {
            return { keyId, ownerUserUid: '0' }
        },
        async findConfig(userKeyId) {
            return { userKeyId, simbankLimit: 5 }
        }
    }
    const configService = { get: key => (key === 'gateway.feign.service_token' ? 'service-token' : undefined) }
    const service = new UserService({}, {}, {}, userUtilsService, {}, configService)
    const user = await service.httpBaseSrmUserResolver({ keyId: 10241009 })
    assert.deepEqual(user.config, { userKeyId: 10241009, simbankLimit: 5 })
})
