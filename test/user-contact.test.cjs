const test = require('node:test')
const assert = require('node:assert/strict')
const { plainToInstance } = require('class-transformer')
const { validate } = require('class-validator')
const { UserService } = require('../dist/modules/user/user.service')
const UserDto = require('../dist/modules/user/dto/user.dto')

const principal = { uid: '30001' }

function createContext(contact) {
    const calls = []
    const contactRepository = {
        create: values => values,
        async save(value) {
            calls.push(['save-contact', value])
            return { keyId: 1, ...value }
        },
        async find(options) {
            calls.push(['find-contact', options])
            return [{ keyId: 1, userKeyId: 10241000, name: '李逸飞', items: [], createBy: '0', modifyBy: '0' }]
        }
    }
    const manager = {
        merge: (_entity, target, values) => Object.assign(target, values),
        async save(value) {
            calls.push(['save-contact', value])
            return value
        }
    }
    const repository = { manager: { transaction: callback => callback(manager) } }
    const userUtilsService = {
        async findRequired(keyId) {
            calls.push(['find-user', keyId])
            return { keyId }
        },
        async findContactRequired(keyId, txManager) {
            calls.push(['find-contact-required', keyId, txManager === manager])
            return contact
        }
    }
    const service = new UserService(
        repository,
        contactRepository,
        {},
        userUtilsService,
        {},
        {},
        {},
        { fetchAppendBalance: async list => list }
    )
    return { calls, service }
}

test('新增联系人校验供应商存在，状态默认有效并记录创建人', async () => {
    const { calls, service } = createContext()
    const items = [{ type: 1024188, value: 'a@b.com' }]
    const result = await service.httpBaseSrmCreateUserContact(principal, { userKeyId: 10241000, name: '李逸飞', items })
    assert.deepEqual(calls[0], ['find-user', 10241000])
    assert.equal(result.status, 'enable')
    assert.deepEqual(result.items, items)
    assert.equal(result.createBy, '30001')
    assert.equal(result.modifyBy, '30001')
})

test('编辑联系人在事务内加锁读取并记录更新人，未传联系方式时清空为空数组', async () => {
    const contact = { keyId: 1, userKeyId: 10241000, name: '旧名称', items: [{ type: 1024188, value: 'a@b.com' }], status: 'enable' }
    const { calls, service } = createContext(contact)
    const result = await service.httpBaseSrmUpdateUserContact(principal, { keyId: 1, name: '新名称', address: '深圳' })
    assert.deepEqual(calls[0], ['find-contact-required', 1, true])
    assert.equal(result.name, '新名称')
    assert.deepEqual(result.items, [])
    assert.equal(result.userKeyId, 10241000)
    assert.equal(result.modifyBy, '30001')
})

test('修改联系人状态记录更新人', async () => {
    const { service } = createContext({ keyId: 1, status: 'enable' })
    const result = await service.httpBaseSrmUserContactStatusUpdate(principal, { keyId: 1, status: 'disable' })
    assert.equal(result.status, 'disable')
    assert.equal(result.modifyBy, '30001')
})

test('联系方式 type 必须是正整数、value 必填', async () => {
    const valid = plainToInstance(UserDto.CreateUserContactDto, {
        userKeyId: 10241000,
        name: '李逸飞',
        items: [{ type: '1024188', value: 'a@b.com' }]
    })
    assert.equal((await validate(valid)).length, 0)
    const invalid = plainToInstance(UserDto.CreateUserContactDto, { userKeyId: 10241000, name: '李逸飞', items: [{ type: 0, value: '' }] })
    const errors = await validate(invalid)
    assert.equal(errors[0].property, 'items')
})

test('新增供应商入参缺少联系人或联系人名称时校验失败', async () => {
    const base = { name: '测试供应商', currency: 'USD', email: 'a@b.com', payMode: 'prepaid' }
    const missing = await validate(plainToInstance(UserDto.CreateUserDto, base))
    assert.ok(missing.some(error => error.property === 'contact'))
    const emptyName = await validate(plainToInstance(UserDto.CreateUserDto, { ...base, contact: { name: '' } }))
    assert.ok(emptyName.some(error => error.property === 'contact'))
    const valid = await validate(plainToInstance(UserDto.CreateUserDto, { ...base, contact: { name: '李逸飞', items: [] } }))
    assert.equal(valid.length, 0)
})

test('编辑供应商入参不包含联系人字段', async () => {
    const errors = await validate(
        plainToInstance(UserDto.UpdateUserDto, {
            keyId: 10241000,
            name: '测试供应商',
            currency: 'USD',
            email: 'a@b.com',
            payMode: 'prepaid'
        })
    )
    assert.equal(errors.length, 0)
})
