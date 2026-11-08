const test = require('node:test')
const assert = require('node:assert/strict')
const { UserUtilsService } = require('../dist/modules/user/user.utils.service')
const { UserService } = require('../dist/modules/user/user.service')

function database(exists) {
    return {
        builder: async (_repository, callback) =>
            callback({
                where() {
                    return this
                },
                andWhere() {
                    return this
                },
                getExists: async () => exists
            })
    }
}

test('\u4f9b\u5e94\u5546\u90ae\u7bb1\u5df2\u88ab\u5ba2\u6237\u4f7f\u7528\u65f6\u62d2\u7edd\u6ce8\u518c', async () => {
    const crm = { httpBaseCrmUserEmailExists: async () => ({ exists: true }) }
    const service = new UserUtilsService({}, {}, database(false), {}, crm, { get: () => 'service-token' })
    await assert.rejects(() => service.assertEmailAvailable('a@b.com'), /\u8be5\u90ae\u7bb1\u5df2\u6ce8\u518c\u4e3a\u5ba2\u6237/)
})

test('\u4f9b\u5e94\u5546\u90ae\u7bb1\u6821\u9a8c\u63a5\u53e3\u628a\u51b2\u7a81\u8f6c\u6210\u53ef\u7528\u6027\u7ed3\u679c', async () => {
    const userUtilsService = {
        assertEmailAvailable: async () => {
            const { ConflictException } = require('@nestjs/common')
            throw new ConflictException('\u8be5\u90ae\u7bb1\u5df2\u6ce8\u518c\u4e3a\u4f9b\u5e94\u5546')
        }
    }
    const service = new UserService({}, {}, {}, userUtilsService, {}, {}, {})
    assert.deepEqual(await service.httpBaseSrmValidateUserEmail({ email: 'a@b.com' }), {
        available: false,
        message: '\u8be5\u90ae\u7bb1\u5df2\u6ce8\u518c\u4e3a\u4f9b\u5e94\u5546'
    })
})
