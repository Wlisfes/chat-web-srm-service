const test = require('node:test')
const assert = require('node:assert/strict')
const { SimbankQuoteService } = require('../dist/modules/quote/quote.service')
const { SimbankQuoteUtilsService } = require('../dist/modules/quote/quote.utils.service')

const principal = { uid: '30001' }
const supplier = { keyId: 10241000, alias: 'SSK1233A7K9', currency: 'CNY' }
const simbank = { keyId: 100201, alias: 'SSK1233SMSA002', userKeyId: 10241000 }

/** 构造报价服务：草稿写入走假事务，Finance 价格与汇率由 finance 桩返回。 */
function createService({ existing = new Map(), rates, user = supplier, device = simbank, saved = [] } = {}) {
    const draftRepository = {
        manager: {
            async transaction(callback) {
                return callback({
                    getRepository: () => ({
                        create: values => ({ ...values }),
                        save: async drafts => (saved.push(...drafts), drafts)
                    })
                })
            }
        }
    }
    const finance = {
        calls: [],
        async httpBaseFinanceColumnFrozenSimbankResolver(_authorization, input) {
            finance.calls.push(input.countryKeyIds)
            return (rates ?? [{ countryKeyId: 1077, code: '86', mcc: '460', upUsd: 1500, downUsd: 4500 }]).filter(rate =>
                input.countryKeyIds.includes(rate.countryKeyId)
            )
        },
        async httpBaseFinanceCurrencyExchangeResolver(_authorization, input) {
            return { currency: input.currency, rate: 7.2, date: '2026-10-26' }
        }
    }
    const utils = { findExistingQuoteMap: async () => existing }
    const users = { findRequired: async () => user, findByKeyIds: async () => [] }
    const simbanks = { findRequired: async () => device }
    const config = { get: () => 'service-token' }
    const service = new SimbankQuoteService(draftRepository, {}, {}, users, simbanks, utils, finance, config)
    return { service, finance, saved }
}

test('初始化草稿：取 Finance simbank 基础成本价，按供应商币种换算本币价', async () => {
    const { service, finance, saved } = createService()
    const result = await service.httpBaseSrmSimbankInitQuoteDraft(principal, {
        userKeyId: supplier.keyId,
        simbankKeyId: simbank.keyId,
        countryKeyIds: [1077, 1077]
    })
    assert.equal(result.total, 1)
    assert.deepEqual(finance.calls, [[1077]])
    const [draft] = saved
    assert.equal(draft.draftBatchId, result.draftBatchId)
    assert.deepEqual(
        [draft.userKeyId, draft.simbankKeyId, draft.userAlias, draft.simbankAlias, draft.upUsd, draft.downUsd],
        [10241000, 100201, 'SSK1233A7K9', 'SSK1233SMSA002', 1500, 4500]
    )
    assert.deepEqual([draft.currency, draft.upLocal, draft.downLocal, draft.source], ['CNY', 10800, 32400, 'addition'])
})

test('初始化草稿：已有现行报价的国家沿用现行价和生效时间', async () => {
    const existing = new Map([[1077, { upUsd: 1200, downUsd: 3000, effectiveTime: '2026-11-01 00:00:00', remark: '旧价' }]])
    const { service, saved } = createService({ existing })
    await service.httpBaseSrmSimbankInitQuoteDraft(principal, {
        userKeyId: supplier.keyId,
        simbankKeyId: simbank.keyId,
        countryKeyIds: [1077]
    })
    assert.deepEqual([saved[0].upUsd, saved[0].downUsd, saved[0].source, saved[0].remark], [1200, 3000, 'existing', '旧价'])
})

test('初始化草稿：simbank 不属于该供应商、国家未配置基础成本价时拒绝', async () => {
    const other = createService({ device: { ...simbank, userKeyId: 99 } })
    await assert.rejects(
        () =>
            other.service.httpBaseSrmSimbankInitQuoteDraft(principal, {
                userKeyId: supplier.keyId,
                simbankKeyId: simbank.keyId,
                countryKeyIds: [1077]
            }),
        /不属于该供应商/
    )
    const missing = createService()
    await assert.rejects(
        () =>
            missing.service.httpBaseSrmSimbankInitQuoteDraft(principal, {
                userKeyId: supplier.keyId,
                simbankKeyId: simbank.keyId,
                countryKeyIds: [1077, 1008]
            }),
        /simbank 基础成本价格：1008/
    )
})

test('现行报价按 供应商 + simbank 查询，每个国家取生效时间最新一条', async () => {
    const params = []
    const database = {
        async builder(_repository, callback) {
            const qb = {
                where: (_sql, value) => (params.push(value), qb),
                andWhere: () => qb,
                orderBy: () => qb,
                addOrderBy: () => qb,
                getMany: async () => [
                    { countryKeyId: 1077, upUsd: 2000, keyId: 3 },
                    { countryKeyId: 1077, upUsd: 1000, keyId: 2 }
                ]
            }
            return callback(qb)
        }
    }
    const utils = new SimbankQuoteUtilsService({ manager: { getRepository: () => ({}) } }, database)
    const map = await utils.findExistingQuoteMap({ userKeyId: 10241000, simbankKeyId: 100201, countryKeyIds: [1077] })
    assert.equal(map.get(1077).upUsd, 2000)
    assert.equal(params[0].simbankKeyId, 100201)
})
