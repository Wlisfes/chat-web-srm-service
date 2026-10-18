const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createSrmConfig, sanitizeSrmConfig } = require('../deploy/bootstrap-nacos-config.cjs')

test('SRM Nacos 配置只包含本服务数据库边界', () => {
    const content = createSrmConfig({
        SRM_MYSQL_HOST: 'mysql',
        SRM_MYSQL_PORT: '3306',
        SRM_MYSQL_DATABASE: 'chat-web-srm',
        SRM_MYSQL_USERNAME: 'srm-service',
        SRM_MYSQL_PASSWORD: 'redacted',
        FINANCE_SERVICE_TOKEN: 'redacted-token',
        GATEWAY_PRINCIPAL_SECRET: '0123456789abcdef0123456789abcdef'
    })
    assert.match(content, /server:\n  port: 5070\ngateway:/)
    assert.match(content, /database:\n  chat-web-srm:/)
    assert.match(content, /name: "chat-web-srm"/)
    assert.match(content, /redis:\n  host: "chat-web-redis"\n  port: 6379\n  database: 4/)
    assert.match(content, /gateway:\n  feign:\n    service_token: "redacted-token"/)
    assert.match(content, /url: "http:\/\/chat-web-gateway-service:5000"/)
    assert.match(content, /timeout: 3000/)
    assert.doesNotMatch(content, /chat-web-account:|chat-web-finance:|chat-web-skyline:/)
    assert.match(content, /  principal:\n    secret: "0123456789abcdef0123456789abcdef"/)
    const sanitized = sanitizeSrmConfig(content)
    assert.equal(sanitized, content)
    assert.match(sanitized, /redis:\n  host: "chat-web-redis"\n  port: 6379\n  database: 4/)
    assert.throws(() => sanitizeSrmConfig(content.replace('port: 5070', 'port: 3000')), /server\.port: 5070/)
})

test('SRM 部署运行时只生成启动与 Nacos 参数', () => {
    const script = readFileSync(resolve(__dirname, '../deploy/bootstrap-runtime.sh'), 'utf8')
    assert.doesNotMatch(script, /mysql_query|ALTER DATABASE|GRANT ALL PRIVILEGES/)
    assert.doesNotMatch(script, /ACCOUNT_SERVICE_URL|FINANCE_SERVICE_URL|REDIS_HOST|SRM_MYSQL_PASSWORD/)
    assert.match(script, /resolve_value NACOS_USERNAME/)
    assert.match(script, /resolve_value NACOS_PASSWORD/)
    assert.doesNotMatch(script, /10\.66\.0\.2/)
    assert.doesNotMatch(script, /resolve_value NACOS_REGISTER_IP/)
    assert.match(script, /read_value NACOS_REGISTER_IP "\$ENV_FILE"/)
})

test('SRM 部署前先准备运行环境再切换容器', () => {
    const workflow = readFileSync(resolve(__dirname, '../.github/workflows/deploy.yml'), 'utf8')
    const bootstrapIndex = workflow.indexOf('sh deploy/bootstrap-runtime.sh "$DEPLOY_PATH"')
    const deployIndex = workflow.indexOf('./deploy.sh "$IMAGE" compose.yml')
    assert.ok(bootstrapIndex >= 0)
    assert.ok(deployIndex > bootstrapIndex)
    assert.match(workflow, /NACOS_REGISTER_IP is unset; SRM will register the container network IP/)
    assert.doesNotMatch(workflow, /register_ip="\$\{register_ip:-10\.66\.0\.2\}"/)
})
