const test = require('node:test')
const assert = require('node:assert/strict')
const { UserUtilsService } = require('../dist/modules/user/user.utils.service')

const config = { get: () => 'service-token' }

test('供应商余额来自 Finance：覆盖钱包金额并保留供应商币种，没有钱包的供应商金额为 0', async () => {
    const calls = []
    const finance = {
        httpBaseFinanceColumnSrmUserResolver: async (authorization, input) => {
            calls.push({ authorization, input })
            return [{ userKeyId: 1, balance: -108200, credit: 500000 }]
        }
    }
    const list = [
        { keyId: 1, currency: 'CNY', balance: 999, credit: 999 },
        { keyId: 2, currency: 'CNY', balance: 999, credit: 999 }
    ]
    const result = await new UserUtilsService({}, {}, {}, finance, config).fetchAppendBalance(list)
    assert.equal(result, list, '直接修改并返回原列表')
    assert.deepEqual(result, [
        { keyId: 1, currency: 'CNY', balance: -108200, credit: 500000 },
        { keyId: 2, currency: 'CNY', balance: 0, credit: 0 }
    ])
    assert.deepEqual(calls[0].input, { userKeyIds: [1, 2] })
})

test('供应商超过 100 个时分批查询 Finance', async () => {
    const batches = []
    const finance = { httpBaseFinanceColumnSrmUserResolver: async (_a, input) => (batches.push(input.userKeyIds.length), []) }
    const list = Array.from({ length: 150 }, (_, index) => ({ keyId: index + 1 }))
    await new UserUtilsService({}, {}, {}, finance, config).fetchAppendBalance(list)
    assert.deepEqual(batches, [100, 50])
})

test('Finance 不可用时余额为 null，不影响供应商列表', async () => {
    const finance = {
        httpBaseFinanceColumnSrmUserResolver: async () => {
            throw new Error('ECONNREFUSED')
        }
    }
    const [item] = await new UserUtilsService({}, {}, {}, finance, config).fetchAppendBalance([
        { keyId: 1, currency: 'USD', balance: 999, credit: 999, name: '供应商' }
    ])
    assert.deepEqual(item, { keyId: 1, currency: 'USD', balance: null, credit: null, name: '供应商' })
})
