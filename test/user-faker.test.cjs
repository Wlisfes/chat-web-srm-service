const test = require('node:test')
const assert = require('node:assert/strict')
const { UserUtilsService } = require('../dist/modules/user/user.utils.service')

test('createFakerUser 生成新增供应商表单数据', () => {
    const service = new UserUtilsService({}, {}, {})
    for (let index = 0; index < 50; index++) {
        const data = service.createFakerUser()
        assert.ok(data.name)
        assert.equal(data.currency, 'USD')
        assert.equal(data.payMode, 'prepaid')
        assert.match(data.email, /@/)
        assert.match(data.phone, /^1[3-9]\d{9}$/)
        assert.ok(data.remark)
        assert.ok(data.contact.name)
        assert.deepEqual(data.contact.items, [{ type: '1024188', value: data.email }])
        assert.match(data.contact.address, /^.+?(省|市|自治区|特别行政区).+\d+号/)
        assert.doesNotMatch(data.contact.address, /市辖区|直辖县级行政区划/)
    }
})
