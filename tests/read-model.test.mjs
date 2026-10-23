import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../src/server/readModel.js'

function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../migrations-attendance/0002_shared_read_model.sql', import.meta.url), 'utf8'))
  const db = {
    hook: null,
    prepare(text) {
      let args = []
      const execute = method => {
        db.hook?.(text)
        const statement = sql.prepare(text)
        const numbered = /\?\d/.test(text)
        const params = numbered ? [Object.fromEntries(args.map((value, i) => [String(i + 1), value]))] : args
        return statement[method](...params)
      }
      return {
        bind(...values) { args = values; return this },
        async first() { return execute('get') || null },
        async run() { return execute('run') },
        async all() { return { results: execute('all') } },
      }
    },
  }
  return { sql, db, env: { ATTENDANCE_DB: db, READ_MODEL_ENABLED: 'true' } }
}

function snapshot(balance = 1000, sourceUpdatedAt = new Date().toISOString()) {
  const customer = { customerCode: '0001', customerName: 'Test', currentBalance: balance, activeToday: true }
  return { schemaVersion: 1, businessDate: model.tokyoDate(), sourceUpdatedAt,
    resources: [
      { key: 'customers', payload: [customer] },
      { key: 'customer:0001', payload: customer },
      { key: 'history:0001', payload: [] },
      { key: 'todayHistory', payload: [] },
      { key: 'activeCustomers', payload: [customer] },
    ] }
}

test('shared read copies have no readable state until a complete snapshot is published', async () => {
  const s = setup()
  await assert.rejects(model.readResource(s.env, 'customers'), { code: 'READ_MODEL_UNAVAILABLE' })
  await model.publishReadModel(s.env, snapshot(), 0)
  const firstDevice = await model.readResource(s.env, 'customer:0001')
  const secondDevice = await model.readResource(s.env, 'customer:0001')
  assert.equal(firstDevice.data.currentBalance, 1000)
  assert.deepEqual(secondDevice, firstDevice)
})

test('unchanged reconciliation refreshes checkedAt without writing new blobs or changing source timestamp', async () => {
  const s = setup()
  const old = new Date(Date.now() - 60000).toISOString()
  const first = await model.publishReadModel(s.env, snapshot(1000, old), 0)
  const count = s.sql.prepare('SELECT COUNT(*) AS n FROM read_model_blobs').get().n
  const next = await model.publishReadModel(s.env, snapshot(1000), 0)
  assert.equal(next.sourceUpdatedAt, first.sourceUpdatedAt)
  assert.equal(next.revision, first.revision)
  assert.notEqual(next.checkedAt, first.checkedAt)
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM read_model_blobs').get().n, count)
})

test('older export and obsolete invalidation epochs cannot replace new data', async () => {
  const s = setup()
  const old = snapshot(500, new Date(Date.now() - 60000).toISOString())
  await model.publishReadModel(s.env, snapshot(1000), 0)
  await assert.rejects(model.publishReadModel(s.env, old, 0))
  const epoch = await model.invalidateReadModel(s.env)
  await assert.rejects(model.publishReadModel(s.env, snapshot(2000), 0))
  await model.publishReadModel(s.env, snapshot(3000), epoch)
  assert.equal((await model.readResource(s.env, 'customer:0001')).data.currentBalance, 3000)
})

test('write starting during import stops publication and leaves old data unreadable', async () => {
  const s = setup()
  await model.publishReadModel(s.env, snapshot(), 0)
  s.db.hook = text => {
    if (text.startsWith('UPDATE read_model_state SET\n')) {
      s.db.hook = null
      s.sql.exec('UPDATE read_model_state SET dirty=1, invalidation_epoch=invalidation_epoch+1')
    }
  }
  await assert.rejects(model.publishReadModel(s.env, snapshot(2000), 0),
    { syncReason: 'SNAPSHOT_CONFLICT', status: 409 })
  await assert.rejects(model.readResource(s.env, 'customer:0001'))
})

test('internal sync reports conflicts safely and epoch lookup does not invalidate or bypass authentication', async () => {
  const s = setup()
  s.env.READ_MODEL_SYNC_SECRET = 'test-sync-secret'
  await model.publishReadModel(s.env, snapshot(), 0)
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
    .replace('export default {', 'const worker = {')
  const messages = []
  const c = vm.createContext({ ...model, URL, Response, TextEncoder, TextDecoder, crypto,
    console: { error: value => messages.push(value) } })
  vm.runInContext(source, c)
  const request = (path, payload = {}, authenticated = true) => new Request(
    'https://example.invalid/internal/read-model/' + path,
    { method: 'POST', headers: authenticated ? { 'x-otomo-sync-secret': s.env.READ_MODEL_SYNC_SECRET } : {},
      body: JSON.stringify(payload) })
  const unauthorized = await c.handleReadModelSync_(request('epoch', {}, false), s.env)
  assert.equal(unauthorized.status, 401)
  const epoch = await c.handleReadModelSync_(request('epoch'), s.env)
  assert.equal((await epoch.json()).data.invalidationEpoch, 0)
  assert.equal(s.sql.prepare('SELECT dirty FROM read_model_state').get().dirty, 0)
  await model.invalidateReadModel(s.env)
  const conflict = await c.handleReadModelSync_(request('sync', { ...snapshot(), invalidationEpoch: 0 }), s.env)
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).reason, 'SNAPSHOT_CONFLICT')
  assert.equal(s.sql.prepare('SELECT dirty FROM read_model_state').get().dirty, 1)
  s.db.hook = () => { throw new Error('private-value') }
  const failure = await c.handleReadModelSync_(request('sync', { ...snapshot(), invalidationEpoch: 1 }), s.env)
  const body = await failure.text()
  assert.equal(JSON.parse(body).reason, 'SYNC_INTERNAL_ERROR')
  assert.equal((body + messages.join('')).includes('private-value'), false)
  assert.equal(messages.join('').includes(s.env.READ_MODEL_SYNC_SECRET), false)
})

test('interrupted blob writes do not expose a partial snapshot', async () => {
  const s = setup()
  await model.publishReadModel(s.env, snapshot(), 0)
  const epoch = await model.invalidateReadModel(s.env)
  s.db.hook = text => { if (text.startsWith('INSERT OR IGNORE INTO read_model_blobs')) throw new Error('Dropped write') }
  await assert.rejects(model.publishReadModel(s.env, snapshot(2000), epoch))
  s.db.hook = null
  await assert.rejects(model.readResource(s.env, 'customer:0001'))
  assert.equal(s.sql.prepare('SELECT dirty FROM read_model_state').get().dirty, 1)
})

test('unknown writes remain blocked until a matching durable Sheets receipt proves completion', async () => {
  const s = setup()
  await model.publishReadModel(s.env, snapshot(), 0)
  const requestId = 'receipt-test-0000000001'
  await model.beginReadModelWrite(s.env, { requestId, action: 'addTransaction', customerCode: '0001' })
  await model.publishReadModel(s.env, snapshot(2000), 1)
  await assert.rejects(model.readResource(s.env, 'customer:0001'))
  const data = snapshot(2000)
  data.completedWrites = [{ requestId, action: 'checkoutCustomer', customerCode: '0001' }]
  await model.publishReadModel(s.env, data, 1)
  await assert.rejects(model.readResource(s.env, 'customer:0001'))
  data.sourceUpdatedAt = new Date().toISOString()
  data.completedWrites[0].action = 'addTransaction'
  await model.publishReadModel(s.env, data, 1)
  assert.equal((await model.readResource(s.env, 'customer:0001')).data.currentBalance, 2000)
})

test('stale, wrong-day, incomplete and unverified snapshots never become trusted balances', async () => {
  const s = setup()
  const data = snapshot()
  data.businessDate = '2020-01-01'
  await assert.rejects(model.publishReadModel(s.env, data, 0))
  await assert.rejects(model.publishReadModel(s.env, snapshot(0, new Date(Date.now() - 660000).toISOString()), 0))
  const missing = snapshot()
  missing.resources.pop()
  await assert.rejects(model.publishReadModel(s.env, missing, 0))
  const invalid = snapshot()
  invalid.resources[1].payload = { readModelError: { code: 'RECORD_VERIFICATION_REQUIRED', error: 'Mismatch' } }
  await model.publishReadModel(s.env, invalid, 0)
  await assert.rejects(model.readResource(s.env, 'customer:0001'), { code: 'RECORD_VERIFICATION_REQUIRED' })
  s.sql.exec("UPDATE read_model_state SET checked_at='2020-01-01T00:00:00.000Z'")
  await assert.rejects(model.readModelStatus(s.env))
})

test('Worker serves staff/public reads from D1 and rejects legacy mutations before calling Sheets', async () => {
  const s = setup()
  await model.publishReadModel(s.env, snapshot(), 0)
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
    .replace('export default {', 'const worker = {')
  const c = vm.createContext({ ...model, URL, Response, TextEncoder, console, crypto })
  vm.runInContext(source, c)
  c.fetchAppsScriptJson_ = () => assert.fail('Read must not call Apps Script')
  c.getPublicCustomerCodeByToken_ = async () => ({ success: true, data: '0001' })
  assert.equal((await c.getPublicCustomerByToken_(s.env, 'token')).data.currentBalance, 1000)
  assert.equal((await c.getPublicCustomerHistoryByToken_(s.env, 'token')).data.length, 0)
  const response = await c.handleApi_(new URL('https://example.invalid/api?action=getCustomer&customerCode=0001'), s.env)
  assert.equal((await response.json()).data.currentBalance, 1000)
  const write = await c.handleApi_(new URL('https://example.invalid/api?action=addTransaction'), s.env)
  assert.equal((await write.json()).code, 'CLIENT_UPDATE_REQUIRED')
})

test('history warnings stay available to staff but public responses omit diagnostic details', async () => {
  const s = setup()
  const data = snapshot()
  data.resources.find(r => r.key === 'history:0001').payload = {
    transactions: [{ transactionId: '2026-08-16-6057-0001', sourceRow: 6057,
      timestamp: '2026-08-16 00:00:00', balanceBefore: 0, chipChange: 67500,
      balanceAfter: 67500, breakBefore: true }],
    warnings: [{ reason: 'HISTORY_CHAIN_MISMATCH', sheet: '変動ログ', row: 6057 }],
  }
  const report = await model.publishReadModel(s.env, data, 0)
  assert.deepEqual(report.unverifiedCustomers, [])
  assert.deepEqual(report.unverifiedHistories, [])
  assert.deepEqual(report.historyWarnings, ['0001'])
  const staff = await model.readResource(s.env, 'history:0001')
  assert.equal(staff.historyWarnings[0].row, 6057)
  assert.equal((await model.readResource(s.env, 'customer:0001')).data.currentBalance, 1000)
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
    .replace('export default {', 'const worker = {')
  const c = vm.createContext({ ...model, URL, Response, TextEncoder, console, crypto })
  vm.runInContext(source, c)
  c.getPublicCustomerCodeByToken_ = async () => ({ success: true, data: '0001' })
  const publicResult = await c.getPublicCustomerHistoryByToken_(s.env, 'token')
  assert.equal(publicResult.historyIncomplete, true)
  assert.equal(publicResult.data[0].breakBefore, true)
  assert.ok(!JSON.stringify(publicResult).includes('6057'))
  assert.ok(!JSON.stringify(publicResult).includes('変動ログ'))
  assert.equal(publicResult.historyWarnings, undefined)
})

test('confirmed Sheets save plus failed sync never calls the chip mutation again', async () => {
  const s = setup()
  await model.publishReadModel(s.env, snapshot(), 0)
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
    .replace('export default {', 'const worker = {')
  const c = vm.createContext({ ...model, URL, Response, TextEncoder, console, crypto })
  vm.runInContext(source, c)
  const calls = []
  c.fetchAppsScriptJson_ = async parameters => {
    calls.push(parameters.action)
    return parameters.action === 'exportReadModel' ? { success: false } : {
      success: true, data: { customerCode: '0001', newBalance: 2000, verified: true },
    }
  }
  const result = await c.saveAndSynchronize_(new URL('https://example.invalid/api?action=addTransaction&customerCode=0001&clientVersion=d1-v1&requestId=receipt-test-0000000002'), s.env)
  assert.equal(result.success, true)
  assert.equal(result.data.readModelSyncPending, true)
  assert.deepEqual(calls, ['addTransaction', 'exportReadModel'])
  await assert.rejects(model.readResource(s.env, 'customer:0001'))
})

test('public profile HTML contains valid script and timestamp checks, not a lifetime history cache', async () => {
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
    .replace('export default {', 'const worker = {')
  const c = vm.createContext({ ...model, URL, Response, TextEncoder, console, crypto })
  vm.runInContext(source, c)
  c.getPublicCustomerByToken_ = async () => ({ success: true,
    data: { customerCode: '0001', customerName: 'Test', currentBalance: 1000 },
    sync: { revision: 'revision1', businessDate: model.tokyoDate() } })
  const response = await c.publicCustomerPage_(new URL('https://example.invalid/public/customer/' + 'a'.repeat(64)), {})
  const html = await response.text()
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  assert.doesNotThrow(() => new vm.Script(script))
  assert.ok(script.includes('customer-status/'))
  assert.ok(!script.includes('historyLoaded'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
