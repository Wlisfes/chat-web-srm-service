const test = require('node:test')
const assert = require('node:assert/strict')
const { UserBalanceService } = require('../dist/modules/user/user.balance.service')

const config = { get: () => 'service-token' }

test('供应商余额来自 Finance：覆盖 balanceUsd，没有账户的供应商为 0', async () => {
    const calls = []
    const finance = {
        httpBaseFinanceColumnSrmUserResolver: async (authorization, input) => {
            calls.push({ authorization, input })
            return [{ userKeyId: 1, balanceUsd: -108200, billedUsd: 108200, billCount: 1 }]
        }
    }
    const list = [
        { keyId: 1, balanceUsd: 999 },
        { keyId: 2, balanceUsd: 999 }
    ]
    const result = await new UserBalanceService(finance, config).fetchAppendBalance(list)
    assert.equal(result, list, '直接修改并返回原列表')
    assert.deepEqual(result, [
        { keyId: 1, balanceUsd: -108200, billedUsd: 108200, billCount: 1 },
        { keyId: 2, balanceUsd: 0, billedUsd: 0, billCount: 0 }
    ])
    assert.deepEqual(calls[0].input, { userKeyIds: [1, 2] })
})

test('供应商超过 100 个时分批查询 Finance', async () => {
    const batches = []
    const finance = { httpBaseFinanceColumnSrmUserResolver: async (_a, input) => (batches.push(input.userKeyIds.length), []) }
    const list = Array.from({ length: 150 }, (_, index) => ({ keyId: index + 1 }))
    await new UserBalanceService(finance, config).fetchAppendBalance(list)
    assert.deepEqual(batches, [100, 50])
})

test('Finance 不可用时余额为 null，不影响供应商列表', async () => {
    const finance = {
        httpBaseFinanceColumnSrmUserResolver: async () => {
            throw new Error('ECONNREFUSED')
        }
    }
    const [item] = await new UserBalanceService(finance, config).fetchAppendBalance([{ keyId: 1, balanceUsd: 999, name: '供应商' }])
    assert.deepEqual(item, { keyId: 1, balanceUsd: null, billedUsd: null, billCount: null, name: '供应商' })
})
