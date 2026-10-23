import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'

const script = readFileSync(new URL('../appscript/Code.gs', import.meta.url), 'utf8')
const requestId = 'checkout-test-request-0001'

function makeSheet(rows = []) {
  return {
    rows,
    getLastRow: () => rows.length,
    getRange(r, c, height = 1, width = 1) {
      const range = {
        getRow: () => r,
        getValues: () => Array.from({ length: height }, (_, i) =>
          Array.from({ length: width }, (_, j) => rows[r + i - 1]?.[c + j - 1] ?? '')),
        getDisplayValues: () => range.getValues().map(row => row.map(String)),
        setValues(values) {
          values.forEach((row, i) => row.forEach((value, j) => {
            rows[r + i - 1] ??= []
            rows[r + i - 1][c + j - 1] = value
          }))
          return range
        },
        setValue: value => range.setValues([[value]]),
        setFontColor: () => range,
        createTextFinder(value) {
          const finder = {
            matchEntireCell: () => finder,
            matchCase: () => finder,
            useRegularExpression: () => finder,
            findNext() {
              const index = range.getValues().findIndex(row => String(row[0]) === value)
              return index < 0 ? null : { getRow: () => r + index }
            },
          }
          return finder
        },
      }
      return range
    },
  }
}

function setup() {
  const daily = makeSheet(Array.from({ length: 6 }, () => Array(22).fill('')))
  Object.assign(daily.rows[5], {
    1: '0079', 3: 'Test', 4: 1210100, 5: 1195100,
    6: 50000, 7: 10000, 8: 25000, 18: 1195100,
  })
  const sheets = new Map([['2026-10-13', daily]])
  const logs = []
  let balance = 1195100
  let locked = false
  const context = vm.createContext({
    console,
    SpreadsheetApp: { flush() {} },
    LockService: {
      getScriptLock: () => ({
        waitLock() { assert.equal(locked, false); locked = true },
        releaseLock() { locked = false },
      }),
    },
  })
  vm.runInContext(script, context)
  Object.assign(context, {
    getSpreadsheet_: () => ({
      getSheetByName: name => sheets.get(name),
      insertSheet(name) { const sheet = makeSheet(); sheets.set(name, sheet); return sheet },
    }),
    getCustomerMasterRecord_: () => ({
      rowNumber: 1,
      customer: {
        customerCode: '0079', customerName: 'Test', currentBalance: balance,
        lastVisit: '2026/10/13', visitCount: 1,
      },
    }),
    getTodaySheetName_: () => '2026-10-13',
    extractDateText_: () => '2026-10-13',
    formatTime_: () => '12:00:00',
    appendChangeLog_: (customer, previous, today, before, after) => {
      if (before !== after) logs.push({ before, after })
    },
    syncCustomerMasterAfterTransaction_: (code, row, date, increment, count, confirmed) => {
      balance = confirmed
      return count
    },
  })
  return { context, daily, sheets, logs, balance: () => balance, locked: () => locked }
}

test('four identical checkouts credit 45,000 once and return the original receipt', () => {
  const s = setup()
  for (let i = 0; i < 4; i++) {
    const result = s.context.checkoutCustomer_('0079', 45000, requestId)
    assert.equal(result.newBalance, 1240100)
    assert.equal(Boolean(result.replayed), i > 0)
  }
  assert.equal(s.balance(), 1240100)
  assert.equal(s.daily.rows.length, 6)
  assert.equal(s.logs.length, 1)
  assert.equal(s.locked(), false)
})

test('different request IDs and older clients cannot check out an ended visit', () => {
  const s = setup()
  s.context.checkoutCustomer_('0079', 45000, 'checkout-test-first-request')
  for (const id of [requestId, 'checkout-test-request-0002']) {
    assert.throws(() => s.context.checkoutCustomer_('0079', 45000, id),
      error => error.code === 'CHECKOUT_NOT_ACTIVE')
  }
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000),
    error => error.code === 'CLIENT_UPDATE_REQUIRED')
  assert.equal(s.balance(), 1240100)
  assert.equal(s.daily.rows.length, 6)
  assert.equal(s.logs.length, 1)
})

test('ordinary additions and withdrawals apply once per request ID', () => {
  const s = setup()
  s.context.getOrCreateTodaySheet_ = () => s.daily
  for (let i = 0; i < 4; i++) s.context.addTransaction_('0079', 45000, requestId)
  assert.equal(s.balance(), 1240100)
  assert.equal(s.logs.length, 1)
  for (let i = 0; i < 2; i++) s.context.addTransaction_('0079', -46800, 'withdrawal-request-0001')
  assert.equal(s.balance(), 1193300)
  assert.equal(s.logs.length, 2)
  assert.throws(() => s.context.addTransaction_('0079', 45000), error => error.code === 'CLIENT_UPDATE_REQUIRED')
})

test('daily/master disagreement is rejected before changing any chip values', () => {
  const s = setup()
  s.daily.rows[5][18] = 2000000
  const before = JSON.stringify(s.daily.rows)
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000, requestId))
  assert.equal(JSON.stringify(s.daily.rows), before)
  assert.equal(s.logs.length, 0)
})

test('a dropped daily balance write fails verification and cannot be retried with a new ID', () => {
  const s = setup()
  s.context.writeDailyConfirmedBalance_ = () => {}
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000, requestId),
    error => error.code === 'RECORD_VERIFICATION_REQUIRED')
  assert.equal(s.sheets.get('_WebappCheckoutReceipts').rows[1][3], 'pending')
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000, 'checkout-test-request-0002'))
  s.context.getOrCreateTodaySheet_ = () => s.daily
  assert.throws(() => s.context.addTransaction_('0079', 1000, 'add-after-failed-checkout'))
  assert.throws(() => s.context.enterCustomer_('0079'))
  assert.equal(s.logs.length, 1)
})

test('a dropped movement cell write is not reported as a successful deposit', () => {
  const s = setup()
  s.context.getOrCreateTodaySheet_ = () => s.daily
  s.context.writeDailyMovement_ = () => {}
  assert.throws(() => s.context.addTransaction_('0079', 45000, requestId),
    error => error.code === 'RECORD_VERIFICATION_REQUIRED')
  assert.equal(s.sheets.get('_WebappTransactionReceipts').rows[1][3], 'pending')
})

test('change log persistence is read back, not assumed', () => {
  const c = vm.createContext({ console, SpreadsheetApp: { flush() {} } })
  vm.runInContext(script, c)
  const log = makeSheet([['header']])
  c.getChangeLogSheet_ = () => log
  const customer = { customerCode: '0079', customerName: 'Test' }
  c.appendChangeLog_(customer, '', '2026-10-13', 100, 150)
  assert.deepEqual(log.rows[1].slice(5), [100, 150, 50])
  const getRange = log.getRange.bind(log)
  log.getRange = (...args) => {
    const range = getRange(...args)
    range.setValues = () => range
    return range
  }
  assert.throws(() => c.appendChangeLog_(customer, '', '2026-10-13', 150, 200),
    error => error.code === 'RECORD_VERIFICATION_REQUIRED')
})

test('master verification rejects missing rows and mismatched balances', () => {
  const c = vm.createContext({ console, SpreadsheetApp: { flush() {} } })
  vm.runInContext(script, c)
  c.findCustomerMasterRows_ = () => [1]
  c.getCustomerSheet_ = () => makeSheet([['0079', 'Test', '', 100, '', '', '', 1]])
  for (const saved of [[], [{ balance: 100 }]]) {
    c.getCustomerMasterSyncRows_ = () => saved
    assert.throws(() => c.syncCustomerMasterAfterTransaction_('0079', 1, '2026-10-13', false, 1, 150))
  }
})

function historySetup() {
  const s = setup()
  const log = makeSheet(Array.from({ length: 8 }, () => []))
  for (const [before, after] of [[374500, 314500], [314500, 361300], [361300, 408100], [408100, 361300]]) {
    log.rows.push(['2026/10/16', '0079', 'Test', '', '', before, after, after - before])
  }
  s.context.getChangeLogSheet_ = () => log
  s.context.formatSheetDate_ = value => String(value).replaceAll('/', '-')
  s.context.readVerifiedCustomer_ = () => ({ currentBalance: 361300 })
  return { ...s, log }
}

test('46,800 incident history follows numeric log order and is identical across midnight', () => {
  const s = historySetup()
  s.context.getTodaySheetName_ = () => '2026-10-16'
  const today = s.context.getHistory_('0079')
  assert.deepEqual(Array.from(today, row => row.chipChange), [-46800, 46800, 46800, -60000])
  assert.deepEqual(Array.from(today, row => row.sourceRow), [12, 11, 10, 9])
  s.context.getTodaySheetName_ = () => '2026-10-17'
  assert.equal(JSON.stringify(s.context.getHistory_('0079')), JSON.stringify(today))
  assert.equal(s.locked(), false)
})

test('history rejects arithmetic errors, broken chains, malformed rows and a stale ending balance', () => {
  for (const corrupt of [
    s => { s.log.rows[9][7] = 0 },
    s => { s.log.rows[9][5] = 300000; s.log.rows[9][7] = 61300 },
    s => { s.log.rows[9][6] = 'broken' },
    s => { s.context.readVerifiedCustomer_ = () => ({ currentBalance: 1 }) },
  ]) {
    const s = historySetup()
    corrupt(s)
    assert.throws(() => s.context.getHistory_('0079'), error => error.code === 'RECORD_VERIFICATION_REQUIRED')
    assert.equal(s.locked(), false)
  }
})

test('customer detail refuses to hide disagreement between daily and master balances', () => {
  const s = setup()
  s.context.readCustomers_ = () => [s.context.getCustomerMasterRecord_().customer]
  s.context.getDailyBalanceMap_ = () => new Map([['79', { balanceAfter: 1, activeToday: false }]])
  assert.throws(() => s.context.getCustomer_('0079'), error => error.code === 'RECORD_VERIFICATION_REQUIRED')
})

test('a stale confirmation balance cannot overwrite a newer chip operation', () => {
  const s = setup()
  s.context.getOrCreateTodaySheet_ = () => s.daily
  s.context.addTransaction_('0079', 1000, requestId, 1195100)
  for (const operation of [
    () => s.context.addTransaction_('0079', 1000, 'new-request-same-old-screen', 1195100),
    () => s.context.checkoutCustomer_('0079', 45000, 'checkout-old-screen-value', 1195100),
  ]) assert.throws(operation, error => error.code === 'BALANCE_CHANGED')
  assert.equal(s.balance(), 1196100)
  assert.equal(s.logs.length, 1)
})

test('real re-entry can check out; replay of the first visit cannot close it', () => {
  const s = setup()
  s.context.checkoutCustomer_('0079', 45000, requestId)
  const customer = s.context.getCustomerMasterRecord_().customer
  const row = s.context.getOrCreateDailyCustomerRow_(s.daily, customer)
  assert.equal(row, 7)
  s.context.checkoutCustomer_('0079', 45000, requestId)
  assert.equal(s.daily.rows[6][17], undefined)
  assert.equal(s.balance(), 1240100)
  const next = s.context.checkoutCustomer_('0079', 45000, 'checkout-test-request-0002')
  assert.equal(next.newBalance, 1285100)
  assert.equal(s.logs.length, 2)
})

test('zero-chip checkout closes the visit exactly once', () => {
  const s = setup()
  s.context.checkoutCustomer_('0079', 0, requestId)
  assert.equal(s.daily.rows[5][17], 0)
  s.context.checkoutCustomer_('0079', 0, requestId)
  assert.throws(() => s.context.checkoutCustomer_('0079', 0))
  assert.equal(s.balance(), 1195100)
  assert.equal(s.logs.length, 0)
})

test('checkout does not create a daily sheet or a visit when none exists', () => {
  const s = setup()
  s.sheets.delete('2026-10-13')
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000, requestId),
    error => error.code === 'CHECKOUT_NOT_ACTIVE')
  assert.equal(s.sheets.has('2026-10-13'), false)
  assert.equal(s.balance(), 1195100)
})

test('an interrupted checkout stays blocked even if a new visit is opened', () => {
  const s = setup()
  s.context.appendChangeLog_ = () => { throw new Error('simulated log failure') }
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000, requestId), /log failure/)
  assert.equal(s.daily.rows[5][17], 45000)
  s.context.getOrCreateDailyCustomerRow_(s.daily, s.context.getCustomerMasterRecord_().customer)
  const before = JSON.stringify(s.daily.rows)
  assert.throws(() => s.context.checkoutCustomer_('0079', 45000, requestId), /再実行せず/)
  assert.equal(JSON.stringify(s.daily.rows), before)
  assert.equal(s.locked(), false)
})

test('a saved request cannot be reused with another amount or customer', () => {
  const s = setup()
  s.context.checkoutCustomer_('0079', 45000, requestId)
  assert.throws(() => s.context.checkoutCustomer_('0079', 46000, requestId))
  assert.throws(() => s.context.checkoutCustomer_('0080', 45000, requestId))
  assert.equal(s.balance(), 1240100)
})

test('receipt replay works on a later date without creating another daily sheet', () => {
  const s = setup()
  s.context.checkoutCustomer_('0079', 45000, requestId)
  s.context.getTodaySheetName_ = () => '2026-10-14'
  const result = s.context.checkoutCustomer_('0079', 45000, requestId)
  assert.equal(result.replayed, true)
  assert.equal(s.balance(), 1240100)
  assert.equal(s.sheets.has('2026-10-14'), false)
})

function workerContext() {
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
    .replace('export default {', 'const worker = {')
  const context = vm.createContext({ URL, Response, TextEncoder, readModelEnabled: () => false, console: { error() {} } })
  vm.runInContext(source, context)
  return context
}

test('D1 failure after checkout returns saved balance with an attendance warning', async () => {
  const c = workerContext()
  let writes = 0
  c.fetchAppsScriptJson_ = async () => {
    writes++
    return { success: true, data: { customerCode: '0079', newBalance: 1240100 } }
  }
  c.markCustomerOutOfShop_ = async () => { throw new Error('simulated D1 failure') }
  const response = await c.handleApi_(new URL('https://example.invalid/api?action=checkoutCustomer'), {})
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.success, true)
  assert.equal(result.data.newBalance, 1240100)
  assert.equal(result.data.attendanceSyncPending, true)
  assert.equal(writes, 1)
})

test('receipt replay does not overwrite attendance for a subsequent visit', async () => {
  const c = workerContext()
  c.fetchAppsScriptJson_ = async () => ({ success: true, data: { replayed: true } })
  c.markCustomerOutOfShop_ = async () => assert.fail('Replay must not change D1 attendance')
  const response = await c.handleApi_(new URL('https://example.invalid/api?action=checkoutCustomer'), {})
  assert.equal((await response.json()).success, true)
})

function apiContext(storage, fetch) {
  const source = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8')
    .replace("import.meta.env.VITE_API_URL", 'undefined').replaceAll('export ', '')
  const context = vm.createContext({
    URL, AbortController, crypto: webcrypto, console, fetch,
    sessionStorage: storage, localStorage: storage,
    window: { location: { origin: 'https://example.invalid', hostname: 'example.invalid' }, setTimeout, clearTimeout },
  })
  vm.runInContext(source, context)
  return context
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

test('readback failure retains the receipt; retry displays current state, not the old receipt balance', async () => {
  const storage = memoryStorage()
  const ids = []
  let readbackFails = true
  const c = apiContext(storage, async url => {
    const params = new URL(url).searchParams
    if (params.get('action') === 'getCustomer') {
      if (readbackFails) throw new Error('readback unavailable')
      return Response.json({ success: true, data: { customerCode: '0079', currentBalance: 1300000, activeToday: true } })
    }
    ids.push(params.get('requestId'))
    assert.equal(params.get('expectedBalance'), '1195100')
    return Response.json({ success: true, data: { customerCode: '0079', verified: true, newBalance: 1240100, replayed: ids.length > 1 } })
  })
  await assert.rejects(c.checkoutCustomer('0079', 45000, 1195100))
  assert.throws(() => c.addTransaction('0079', 1000, 1195100))
  readbackFails = false
  const result = await c.checkoutCustomer('0079', 45000, 1300000)
  assert.equal(ids[0], ids[1])
  assert.equal(result.customer.currentBalance, 1300000)
  assert.equal(result.customer.activeToday, true)
})

test('unverified or mismatched write responses are never accepted as success', async () => {
  for (const data of [
    { customerCode: '0079', newBalance: 1240100 },
    { customerCode: '0080', newBalance: 1240100, verified: true },
    { customerCode: '0079', newBalance: 'bad', verified: true },
  ]) {
    const storage = memoryStorage()
    const c = apiContext(storage, async () => Response.json({ success: true, data }))
    await assert.rejects(c.checkoutCustomer('0079', 45000))
    assert.ok(storage.getItem('otomodachi-checkout-pending-0079'))
  }
})

test('forced history refresh bypasses a cached response and rejects malformed results', async () => {
  let calls = 0
  const c = apiContext(memoryStorage(), async () => {
    calls++
    return Response.json({ success: true, data: calls === 1 ? [{ balanceAfter: 100 }] : null })
  })
  await c.getHistory('0079')
  await assert.rejects(c.getHistory('0079', 'all', true))
  assert.equal(calls, 2)
})

test('an apparently successful D1 write that fails readback is reported as unconfirmed attendance', async () => {
  for (const action of ['checkoutCustomer', 'addTransaction']) {
    const c = workerContext()
    c.fetchAppsScriptJson_ = async () => ({ success: true, data: { customerCode: '0079', newBalance: 1240100, verified: true } })
    c.markCustomerOutOfShop_ = async () => {}
    c.markCustomerInShop_ = async () => {}
    c.getCustomerPresence_ = async () => ({ success: true, data: { activeToday: action === 'checkoutCustomer' } })
    const response = await c.handleApi_(new URL(`https://example.invalid/api?action=${action}`), {})
    const result = await response.json()
    assert.equal(result.success, true)
    assert.equal(result.data.attendanceSyncPending, true)
  }
})

test('browser retries and reloads keep the same receipt; success permits a new one', async () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const ids = []
  let fail = true
  const fetch = async url => {
    const params = new URL(url).searchParams
    if (params.get('action') === 'getCustomer') {
      return Response.json({ success: true, data: { customerCode: '0079', currentBalance: 1240100, activeToday: false } })
    }
    ids.push(params.get('requestId'))
    if (fail) throw new Error('simulated lost response')
    return Response.json({ success: true, data: { customerCode: '0079', newBalance: 1240100, verified: true } })
  }
  await assert.rejects(apiContext(storage, fetch).checkoutCustomer('0079', 45000))
  const reloaded = apiContext(storage, fetch)
  assert.throws(() => reloaded.checkoutCustomer('0079', 46000))
  fail = false
  await reloaded.checkoutCustomer('0079', 45000)
  assert.equal(ids[0], ids[1])
  await reloaded.checkoutCustomer('0079', 45000)
  assert.notEqual(ids[1], ids[2])
})

test('source and Apps Script deployment copy stay identical', () => {
  const mirror = readFileSync(new URL('../appscript-full/Webapp用.txt', import.meta.url), 'utf8')
  assert.equal(script, mirror)
})

test('a confirmed not-active rejection releases the browser receipt for later entry', async () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const c = apiContext(storage, async () => Response.json({
    success: false, error: 'No active visit', code: 'CHECKOUT_NOT_ACTIVE',
  }))
  await assert.rejects(c.checkoutCustomer('0079', 45000), error => error.code === 'CHECKOUT_NOT_ACTIVE')
  assert.equal(values.size, 0)
})

test('transaction balance previews stay visible during saving but hide on unconfirmed failure', () => {
  const source = readFileSync(new URL('../src/views/CustomerView.vue', import.meta.url), 'utf8')
  const state = source.slice(source.indexOf('const showTransactionBalances ='), source.indexOf('const isWithdrawalTooLarge ='))
  const context = vm.createContext({
    computed: getter => ({ get value() { return getter() } }),
    isSavingTransaction: { value: false }, isBalanceUnverified: { value: true },
    transactionError: { value: '' },
  })
  vm.runInContext(state, context)
  const visible = () => vm.runInContext('showTransactionBalances.value', context)
  assert.equal(visible(), false)
  context.isBalanceUnverified.value = false
  assert.equal(visible(), true)
  context.isSavingTransaction.value = true
  context.isBalanceUnverified.value = true
  assert.equal(visible(), true)
  context.transactionError.value = 'Save result could not be verified'
  assert.equal(visible(), false)
  context.isSavingTransaction.value = false
  assert.equal(visible(), false)
  context.transactionError.value = ''
  assert.equal(visible(), false)
  context.isBalanceUnverified.value = false
  assert.equal(visible(), true)
})

test('saving hides provisional validation warnings without allowing another save or hiding failures', () => {
  const source = readFileSync(new URL('../src/views/CustomerView.vue', import.meta.url), 'utf8')
  const computedState = source.slice(source.indexOf('const transactionValidationMessage ='), source.indexOf('const isCustomerActiveToday ='))
  const context = vm.createContext({
    computed: getter => ({ get value() { return getter() } }),
    isSavingTransaction: { value: false }, isBalanceUnverified: { value: false },
    isWithdrawalTooLarge: { value: false }, transactionError: { value: '' },
    selectedAction: { value: 'deposit' }, transactionAmount: { value: 1000 },
  })
  vm.runInContext(computedState, context)
  const displayedError = () => vm.runInContext('displayedTransactionError.value', context)
  const canSave = () => vm.runInContext('canSaveTransaction.value', context)
  for (const action of ['deposit', 'withdrawal', 'checkout']) {
    context.selectedAction.value = action
    context.isSavingTransaction.value = false
    context.isBalanceUnverified.value = false
    assert.equal(displayedError(), '')
    assert.equal(canSave(), true)

    context.isSavingTransaction.value = true
    context.isBalanceUnverified.value = true
    assert.equal(displayedError(), '')
    assert.equal(canSave(), false)

    context.transactionError.value = 'Save result could not be verified'
    assert.equal(displayedError(), context.transactionError.value)
    context.isSavingTransaction.value = false
    assert.equal(displayedError(), context.transactionError.value)
    assert.equal(canSave(), false)

    context.transactionError.value = ''
    assert.equal(displayedError(), 'なんかおかしい...メリーに確認して')
    context.isBalanceUnverified.value = false
    assert.equal(displayedError(), '')
    assert.equal(canSave(), true)
  }
  context.isWithdrawalTooLarge.value = true
  assert.equal(displayedError(), '現在のうにょを超えて引き出すことはできません')
})

test('transaction handler ignores a second call while checkout is saving and closes on success', async () => {
  const source = readFileSync(new URL('../src/views/CustomerView.vue', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('async function saveTransaction()'), source.indexOf('function getActionName('))
  let finish
  let requests = 0
  let confirmations = 0
  const context = vm.createContext({
    console,
    isSavingTransaction: { value: false },
    isBalanceUnverified: { value: false },
    customer: { value: { customerCode: '0079', customerName: 'Test', currentBalance: 1195100, lastVisit: '', visitCount: 1 } },
    transactionError: { value: '' }, transactionSuccess: { value: '' },
    transactionAmount: { value: 45000 }, selectedAction: { value: 'checkout' },
    transactionValidationMessage: { value: '' }, transactionChange: { value: 45000 },
    currentBalance: { value: 1195100 }, customerCode: { value: '0079' },
    presenceActiveToday: { value: true }, history: { value: [] }, amountText: { value: '45000' },
    getActionName: () => 'checkout', displayCustomerName: String, formatNumber: String, formatSignedNumber: String,
    recordRecentCustomer() {}, cacheCustomer() {}, clearCustomerHistoryCache() {}, clearTodayHistoryCache() {},
    checkoutCustomer() { requests++; return new Promise(resolve => { finish = resolve }) },
    window: { confirm() { confirmations++; return true }, alert() {}, setTimeout() { assert.fail('Checkout should close immediately') } },
  })
  vm.runInContext(handler, context)
  const first = context.saveTransaction()
  await context.saveTransaction()
  assert.equal(requests, 1)
  assert.equal(confirmations, 1)
  finish({ customer: { customerCode: '0079', currentBalance: 1240100, activeToday: false } })
  await first
  assert.equal(context.isSavingTransaction.value, false)
  assert.equal(context.selectedAction.value, '')
  assert.equal(context.customer.value.currentBalance, 1240100)
})

test('failed save hides the balance and cannot be submitted a second time as a new operation', async () => {
  const source = readFileSync(new URL('../src/views/CustomerView.vue', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('async function saveTransaction()'), source.indexOf('function getActionName('))
  let calls = 0
  const context = vm.createContext({
    console: { error() {} },
    isSavingTransaction: { value: false }, isBalanceUnverified: { value: false },
    customer: { value: { customerCode: '0079', customerName: 'Test', currentBalance: 1195100 } },
    transactionError: { value: '' }, transactionSuccess: { value: '' },
    transactionAmount: { value: 45000 }, selectedAction: { value: 'checkout' },
    transactionValidationMessage: { value: '' }, transactionChange: { value: 45000 },
    currentBalance: { value: 1195100 }, customerCode: { value: '0079' }, history: { value: [1] },
    getActionName: () => 'checkout', displayCustomerName: String, formatNumber: String, formatSignedNumber: String,
    clearCustomerHistoryCache() {},
    checkoutCustomer() { calls++; throw new Error('lost response') },
    window: { confirm: () => true },
  })
  vm.runInContext(handler, context)
  await context.saveTransaction()
  assert.equal(context.isBalanceUnverified.value, true)
  assert.equal(context.transactionSuccess.value, '')
  assert.match(context.transactionError.value, /未確認/)
  assert.equal(context.history.value.length, 0)
  await context.saveTransaction()
  assert.equal(calls, 1)
})

test('draft refresh verifies new balances without changing the typed amount and closes obsolete checkouts', async () => {
  const source = readFileSync(new URL('../src/views/CustomerView.vue', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('async function refreshTransactionDraft('), source.indexOf('function handleDraftRefresh('))
  const context = vm.createContext({
    isSavingTransaction: { value: false }, isBalanceUnverified: { value: false },
    customer: { value: { currentBalance: 1000, activeToday: true } },
    customerCode: { value: '0001' }, presenceActiveToday: { value: true },
    history: { value: [1] }, historyWarnings: { value: [1] },
    selectedAction: { value: 'withdrawal' }, transactionSuccess: { value: '' },
    amountText: { value: '100' }, recordRecentCustomer() {},
    getCustomer: async () => ({ currentBalance: 50, activeToday: true }),
  })
  context.closeAction = () => { context.selectedAction.value = ''; context.amountText.value = '' }
  vm.runInContext(handler, context)
  await context.refreshTransactionDraft(false)
  assert.equal(context.customer.value.currentBalance, 50)
  assert.equal(context.amountText.value, '100')
  assert.equal(context.isBalanceUnverified.value, false)
  assert.equal(context.history.value.length, 0)
  assert.match(context.transactionSuccess.value, /確認/)
  context.selectedAction.value = 'checkout'
  context.getCustomer = async () => ({ currentBalance: 50, activeToday: false })
  await context.refreshTransactionDraft(false)
  assert.equal(context.selectedAction.value, '')
  context.selectedAction.value = 'deposit'
  await context.refreshTransactionDraft(true)
  assert.equal(context.selectedAction.value, '')
  context.getCustomer = async () => { throw new Error('Invalid record') }
  await assert.rejects(context.refreshTransactionDraft(false))
  assert.equal(context.isBalanceUnverified.value, true)
})

test('opening history clears old data and waits for fresh verified history', async () => {
  const source = readFileSync(new URL('../src/views/CustomerView.vue', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('async function showHistory()'), source.indexOf('async function saveTransaction()'))
  let finish
  const context = vm.createContext({
    console: { error() {} },
    selectedAction: { value: '' }, transactionError: { value: '' }, transactionSuccess: { value: '' },
    history: { value: [{ balanceAfter: 1 }] }, historyWarnings: { value: [{ reason: 'old' }] }, isHistoryLoading: { value: false }, customerCode: { value: '0079' },
    getHistoryReport(code, period, force) {
      assert.equal(code, '0079'); assert.equal(period, 'all'); assert.equal(force, true)
      return new Promise((resolve, reject) => { finish = reject })
    },
    scrollChartToNewest: async () => {},
  })
  vm.runInContext(handler, context)
  const request = context.showHistory()
  assert.equal(context.history.value.length, 0)
  assert.equal(context.isHistoryLoading.value, true)
  assert.equal(context.historyWarnings.value.length, 0)
  finish(new Error('verification failed'))
  await request
  assert.equal(context.history.value.length, 0)
  assert.match(context.transactionError.value, /verification failed/)
})
