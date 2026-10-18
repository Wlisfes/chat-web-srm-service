const test = require('node:test')
const assert = require('node:assert/strict')

const { assertSrmDatabase, getDatabaseName, SRM_DATABASE_NAME } = require('../dist/cli/database-config')

test('SRM Schema 只允许在 chat-web-srm 库执行', () => {
    const previous = process.env.SRM_MYSQL_DATABASE
    delete process.env.SRM_MYSQL_DATABASE
    try {
        assert.equal(SRM_DATABASE_NAME, 'chat-web-srm')
        assert.equal(assertSrmDatabase('chat-web-srm'), 'chat-web-srm')
        assert.equal(getDatabaseName({ host: 'mysql', username: 'u', password: 'p', name: 'chat-web-srm' }), 'chat-web-srm')
        assert.throws(() => assertSrmDatabase('chat-web-account'), /只能在 chat-web-srm 库执行，当前目标库：chat-web-account/)
        assert.throws(() => assertSrmDatabase(null), /当前目标库：未选择/)
        assert.throws(() => getDatabaseName({ host: 'mysql', username: 'u', password: 'p', database: 'chat-web-account' }), /chat-web-srm/)
        process.env.SRM_MYSQL_DATABASE = 'chat-web-finance'
        assert.throws(() => getDatabaseName({ host: 'mysql', username: 'u', password: 'p', database: 'chat-web-srm' }), /chat-web-finance/)
    } finally {
        if (previous === undefined) {
            delete process.env.SRM_MYSQL_DATABASE
        } else {
            process.env.SRM_MYSQL_DATABASE = previous
        }
    }
})
