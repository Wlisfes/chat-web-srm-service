const test = require('node:test')
const assert = require('node:assert/strict')
const { FeignClientSrmManager, FeignClientFactory } = require('@wlisfes/chat-web-base-schema/feign')

function config(values) {
    return {
        get: (key, fallback) => {
            const value = String(key)
                .split('.')
                .reduce((current, segment) => (current && typeof current === 'object' ? current[segment] : undefined), values)
            return value ?? fallback
        }
    }
}

test('SRM 强类型供应商端通过 Gateway 地址调用并使用服务间凭据', async () => {
    let request
    const factory = new FeignClientFactory(
        config({
            gateway: { feign: { url: 'http://gateway.internal:5000', timeout: 3000 } }
        }),
        async (url, init) => {
            request = { url: String(url), init }
            return new Response(JSON.stringify({ data: { keyId: 5181000, name: '演示供应商' }, code: 200, message: 'success' }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }
    )
    const service = factory.create(FeignClientSrmManager)
    const user = await service.httpBaseSrmUserResolver('Bearer service-token', { keyId: 5181000 })
    assert.equal(user.keyId, 5181000)
    assert.equal(request.url, 'http://gateway.internal:5000/feign/srm/user/resolve')
    assert.equal(request.init.headers.get('authorization'), 'Bearer service-token')
})
