import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { setImmediate } from 'node:timers'

function storage() {
  const values = new Map()
  return { get length() { return values.size }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) }
}

function setup(fetch, fastRetries = false) {
  const sessionStorage = storage()
  const localStorage = storage()
  const c = vm.createContext({ URL, AbortController, crypto: webcrypto, console, fetch,
    sessionStorage, localStorage,
    window: { location: { origin: 'https://example.invalid', hostname: 'example.invalid' },
      setTimeout: (callback, delay) => setTimeout(callback, fastRetries && delay <= 3000 ? 0 : delay),
      clearTimeout, sessionStorage, localStorage } })
  const source = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_API_URL', 'undefined').replaceAll('export ', '')
  vm.runInContext(source, c)
  return c
}

const customer = { customerCode: '0001', customerName: 'Test', currentBalance: 1000 }
function response(data, sourceUpdatedAt = '2026-10-23T00:00:00.000Z') {
  return Response.json({ success: true, data, sync: { sourceUpdatedAt, businessDate: '2026-10-23' } })
}

test('legacy cache purge removes financial copies but preserves pending receipt and preferences', () => {
  const c = setup(() => assert.fail('No network needed'))
  for (const name of ['sessionStorage', 'localStorage']) {
    c[name].setItem('otomodachi-v2-customer-0001', 'stale')
    c[name].setItem('otomodachi-v3-today-history', 'stale')
    c[name].setItem('otomodachi-transaction-pending-0001', 'receipt')
    c[name].setItem('theme', 'light')
  }
  c.clearLegacyFinancialCaches()
  for (const name of ['sessionStorage', 'localStorage']) {
    assert.equal(c[name].getItem('otomodachi-v2-customer-0001'), null)
    assert.equal(c[name].getItem('otomodachi-v3-today-history'), null)
    assert.equal(c[name].getItem('otomodachi-transaction-pending-0001'), 'receipt')
    assert.equal(c[name].getItem('theme'), 'light')
  }
})

test('all customer reads contact the server, and do not persist a financial cache', async () => {
  let requests = 0
  const c = setup(async () => { requests++; return response(customer) })
  await c.getCustomer('0001')
  await c.getCustomer('0001')
  assert.equal(requests, 2)
  assert.equal(c.localStorage.length, 0)
  assert.equal(c.sessionStorage.length, 0)
})

test('history diagnostics refresh and current conflicts use the approved staff wording', async () => {
  let warnings = [{ reason: 'HISTORY_CHAIN_MISMATCH', row: 6057 }]
  const c = setup(async () => Response.json({ success: true, data: [], historyWarnings: warnings }))
  assert.equal((await c.getHistoryReport('0001')).warnings.length, 1)
  warnings = []
  assert.equal((await c.getHistoryReport('0001')).warnings.length, 0)
  const failed = setup(async () => Response.json({ success: false,
    code: 'RECORD_VERIFICATION_REQUIRED', error: 'Original diagnostic' }, { status: 503 }))
  await assert.rejects(failed.getCustomer('0001'), { message: 'なんかおかしい...メリーに確認して' })
})

test('delayed older results are replaced with a fresh read after newer timestamps were observed', async () => {
  let finishOld
  let calls = 0
  const c = setup(() => {
    if (++calls === 1) return new Promise(resolve => { finishOld = resolve })
    return response({ ...customer, currentBalance: 2000 }, '2026-10-23T00:00:01.000Z')
  }, true)
  const old = c.getCustomer('0001')
  await Promise.resolve()
  const next = await c.getCustomer('0001')
  assert.equal(next.currentBalance, 2000)
  finishOld(response(customer))
  assert.equal((await old).currentBalance, 2000)
  assert.equal(calls, 3)
})

test('temporary synchronization gaps retry only reads and remain bounded', async () => {
  let calls = 0
  const c = setup(async () => {
    if (++calls <= 2) return Response.json({ success: false, code: 'READ_MODEL_UNAVAILABLE', error: 'Syncing' }, { status: 503 })
    return response(customer)
  }, true)
  assert.equal((await c.getCustomer('0001')).currentBalance, 1000)
  assert.equal(calls, 3)
  calls = 0
  const failing = setup(async () => {
    calls++
    return Response.json({ success: false, code: 'READ_MODEL_UNAVAILABLE', error: 'Syncing' }, { status: 503 })
  }, true)
  await assert.rejects(failing.getCustomer('0001'), { code: 'READ_MODEL_UNAVAILABLE' })
  assert.equal(calls, 6)
  calls = 0
  await assert.rejects(failing.addTransaction('0001', 100, 1000), { code: 'READ_MODEL_UNAVAILABLE' })
  assert.equal(calls, 1)
  assert.equal(failing.hasUnresolvedWrites(), true)
})

test('readback remains in-flight until the saved customer is verified', async () => {
  let finish
  const c = setup(async url => {
    if (new URL(url).searchParams.get('action') === 'addTransaction') {
      return response({ verified: true, newBalance: 1100, customerCode: '0001' })
    }
    return new Promise(resolve => { finish = resolve })
  })
  const saving = c.addTransaction('0001', 100, 1000)
  while (!finish) await new Promise(resolve => setImmediate(resolve))
  assert.equal(c.isWriteInFlight(), true)
  finish(response({ ...customer, currentBalance: 1100 }))
  await saving
  assert.equal(c.isWriteInFlight(), false)
  assert.equal(c.hasUnresolvedWrites(), false)
})

test('timestamp checks notice changes without losing the baseline on subsequent reads', async () => {
  let stamp = '2026-10-23T00:00:00.000Z'
  const c = setup(async url => response(new URL(url).searchParams.get('action') === 'getCustomer' ? customer : {}, stamp))
  await c.getCustomer('0001')
  assert.equal(await c.checkServerChanges(), false)
  stamp = '2026-10-23T00:00:01.000Z'
  await c.getCustomer('0001')
  assert.equal(await c.checkServerChanges(), true)
  c.setEditInProgress(true)
  assert.equal(c.hasPendingWrites(), true)
  c.setEditInProgress(false)
  assert.equal(c.hasPendingWrites(), false)
  c.acknowledgeServerChanges()
  assert.equal(await c.checkServerChanges(), false)
})
