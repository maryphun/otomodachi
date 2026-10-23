import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../appscript/Code.gs', import.meta.url), 'utf8')

function sourceContext(count = 1) {
  let reads = 0
  let locked = false
  const sheet = rows => ({
    rows, getLastRow: () => rows.length,
    getRange(row, col, height, width) {
      const values = () => Array.from({ length: height }, (_, i) =>
        Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? ''))
      return { getValues() { reads++; return values() },
        getDisplayValues() { reads++; return values().map(r => r.map(String)) } }
    },
  })
  const master = sheet([...Array.from({ length: 5 }, () => []),
    ...Array.from({ length: count }, (_, i) => [String(i + 1).padStart(4, '0'), `Customer ${i + 1}`, '', 1000, '2026/10/23', 0, '', 1, '2026/10/23'])])
  const logs = sheet([[], ['2026-10-23', '0001', 'Customer 1', '', '2026-10-23', 0, 1000, 1000]])
  const daily = sheet([...Array.from({ length: 5 }, () => []),
    [1, '0001', '', 'Customer 1', 0, 1000, 0, 1000, '', '', '', '', '', '', '', '', '', '', 1000]])
  const sheets = new Map([['おともだちリスト', master], ['変動ログ', logs], ['2026-10-23', daily]])
  const properties = new Map()
  const c = vm.createContext({ console,
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true }, releaseLock() { locked = false } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
  })
  vm.runInContext(source, c)
  Object.assign(c, {
    getSpreadsheet_: () => ({ getSheetByName: name => sheets.get(name) }),
    getTodaySheetName_: () => '2026-10-23',
    formatSheetDate_: (value, display) => String(display || value).replaceAll('/', '-'),
  })
  return { c, sheets, sheet, master, daily, logs, reads: () => reads, locked: () => locked }
}

function resource(snapshot, key) { return snapshot.resources.find(r => r.key === key).payload }

test('source export reads 1,200 customers in bulk, preserves IDs and changes no spreadsheet values', () => {
  const s = sourceContext(1200)
  const before = JSON.stringify([...s.sheets].map(([key, value]) => [key, value.rows]))
  const result = s.c.exportReadModel_()
  assert.equal(result.resources.length, 2403)
  assert.equal(resource(result, 'customers').length, 1200)
  assert.equal(resource(result, 'customer:0001').currentBalance, 1000)
  assert.equal(resource(result, 'activeCustomers')[0].customerCode, '0001')
  assert.equal(resource(result, 'history:0001')[0].balanceAfter, 1000)
  assert.equal(s.reads(), 6)
  assert.equal(s.locked(), false)
  assert.equal(JSON.stringify([...s.sheets].map(([key, value]) => [key, value.rows])), before)
})

test('missing customer names identify the cell without modifying data or publishing a snapshot', () => {
  for (const name of ['', '   ']) {
    const s = sourceContext(2)
    s.master.rows[6][1] = name
    const before = JSON.stringify(s.master.rows)
    const errors = []
    const calls = []
    s.c.console = { error: message => errors.push(JSON.parse(message)), log() {} }
    s.c.readModelSyncConfig_ = () => ({})
    s.c.postReadModel_ = (_config, endpoint) => {
      calls.push(endpoint)
      return { invalidationEpoch: 12 }
    }
    assert.throws(() => s.c.runReadModelSync(), { code: 'RECORD_VERIFICATION_REQUIRED' })
    assert.deepEqual(errors.filter(error => error.code), [{ code: 'READ_MODEL_CUSTOMER_NAME_MISSING',
      sheet: 'おともだちリスト', cell: 'B7', customerCode: '0002' }])
    assert.deepEqual(calls, ['invalidate'])
    assert.equal(JSON.stringify(s.master.rows), before)
    assert.equal(s.locked(), false)
  }
})

test('pre-numbered empty rows are skipped without truncating later registered customers', () => {
  const s = sourceContext()
  s.master.rows.push(['1160'], [], ['1161', '   ', '', '', '', '', '', '', ''],
    ['1162', 'New customer', '', 0])
  const before = JSON.stringify(s.master.rows)
  const snapshot = s.c.exportReadModel_()
  assert.deepEqual(Array.from(resource(snapshot, 'customers'), c => c.customerCode), ['0001', '1162'])
  assert.equal(snapshot.resources.some(r => r.key === 'customer:1160'), false)
  assert.equal(snapshot.resources.some(r => r.key === 'history:1161'), false)
  assert.equal(resource(snapshot, 'customer:1162').currentBalance, 0)
  assert.equal(JSON.stringify(s.master.rows), before)
})

test('unnamed rows containing any customer data, including zero, are not skipped', () => {
  for (let column = 2; column < 9; column++) {
    const s = sourceContext()
    const row = Array(9).fill('')
    row[0] = '1160'
    row[column] = column === 3 ? 0 : 'existing data'
    s.master.rows.push(row)
    s.c.console = { error() {} }
    assert.throws(() => s.c.exportReadModel_(), { code: 'RECORD_VERIFICATION_REQUIRED' })
  }
})

test('diagnostic identifies mismatches without publishing or reserving a timestamp', () => {
  const s = sourceContext()
  s.master.rows[5][3] = 2000
  const before = JSON.stringify([...s.sheets].map(([key, value]) => [key, value.rows]))
  const messages = []
  s.c.console = { log: message => messages.push(message) }
  s.c.postReadModel_ = () => assert.fail('Diagnostic must not contact D1')
  s.c.nextReadModelTimestamp_ = () => assert.fail('Diagnostic must not write properties')
  s.c.diagnoseReadModel()
  const details = messages.filter(message => message.startsWith('{')).map(JSON.parse)
  assert.ok(details.some(d => d.reason === 'BALANCE_VERIFICATION_FAILED' &&
    d.customerCode === '0001' && d.masterBalance === 2000 && d.latestLogRow === 2))
  assert.ok(details.some(d => d.reason === 'HISTORY_END_MISMATCH' && d.row === 2))
  assert.equal(JSON.stringify([...s.sheets].map(([key, value]) => [key, value.rows])), before)
  assert.equal(s.locked(), false)
})

test('blank master balances mean zero but malformed values and contradictory history remain unverified', () => {
  for (const blank of ['', '   ', null]) {
    const s = sourceContext(2)
    s.master.rows[6][3] = blank
    const before = JSON.stringify(s.master.rows)
    const snapshot = s.c.exportReadModel_()
    assert.equal(resource(snapshot, 'customer:0002').currentBalance, 0)
    assert.equal(resource(snapshot, 'history:0002').length, 0)
    assert.equal(JSON.stringify(s.master.rows), before)
  }
  const invalid = sourceContext(2)
  invalid.master.rows[6][3] = '#VALUE!'
  assert.equal(resource(invalid.c.exportReadModel_(), 'customer:0002').readModelError.code,
    'RECORD_VERIFICATION_REQUIRED')
  const mismatch = sourceContext()
  mismatch.master.rows[5][3] = ''
  assert.equal(resource(mismatch.c.exportReadModel_(), 'customer:0001').readModelError.code,
    'RECORD_VERIFICATION_REQUIRED')
})

test('historical gaps warn without rejecting a separately verified current balance', () => {
  const s = sourceContext()
  s.logs.rows = [[],
    ['2026-08-11', '0001', 'Test', '', '', 0, 30500, 30500],
    ['2026-08-16', '0001', 'Test', '', '', 0, 1000, 1000]]
  // The fake sheet closes over its original array.
  s.sheets.set('変動ログ', s.sheet(s.logs.rows))
  const snapshot = s.c.exportReadModel_()
  assert.equal(resource(snapshot, 'customer:0001').currentBalance, 1000)
  const report = resource(snapshot, 'history:0001')
  assert.equal(report.transactions.length, 2)
  assert.equal(report.transactions[0].breakBefore, true)
  assert.equal(report.warnings[0].reason, 'HISTORY_CHAIN_MISMATCH')
  assert.equal(report.warnings[0].previousRow, 2)
  assert.equal(report.warnings[0].row, 3)
})

test('invalid legacy signs remain recorded in warnings and are never silently corrected', () => {
  const s = sourceContext()
  s.logs.rows.push(['2026-10-23', '0001', 'Test', '', '', -200400, 160400, -40000])
  const before = JSON.stringify(s.logs.rows)
  const snapshot = s.c.exportReadModel_()
  assert.equal(resource(snapshot, 'customer:0001').currentBalance, 1000)
  const report = resource(snapshot, 'history:0001')
  assert.equal(report.transactions.length, 1)
  assert.equal(report.warnings[0].reason, 'INVALID_LOG_VALUES')
  assert.equal(report.warnings[0].recordedBefore, '-200400')
  assert.equal(JSON.stringify(s.logs.rows), before)
})

test('manual expiry does not invent a transaction or replace the current master balance', () => {
  const s = sourceContext()
  s.master.rows[5][3] = 0
  s.sheets.delete('2026-10-23')
  const snapshot = s.c.exportReadModel_()
  assert.equal(resource(snapshot, 'customer:0001').currentBalance, 0)
  const report = resource(snapshot, 'history:0001')
  assert.equal(report.transactions.length, 1)
  assert.equal(report.transactions[0].balanceAfter, 1000)
  assert.equal(report.warnings[0].reason, 'HISTORY_END_MISMATCH')
  // Correcting the source clears the warning on the next snapshot.
  s.master.rows[5][3] = 1000
  assert.ok(Array.isArray(resource(s.c.exportReadModel_(), 'history:0001')))
})

test('source timestamps increase under the lock even when exported immediately twice', () => {
  const s = sourceContext()
  const first = s.c.exportReadModel_()
  const second = s.c.exportReadModel_()
  assert.ok(second.sourceUpdatedAt > first.sourceUpdatedAt)
})

test('daily/master disagreement and pending receipts are explicit unverified resources, not invented zeros', () => {
  for (const pending of [false, true]) {
    const s = sourceContext()
    if (pending) s.sheets.set('_WebappTransactionReceipts', s.sheet([[], ['pending-request-00001', '0001', 1000, 'pending', '', '']]))
    else s.master.rows[5][3] = 2000
    const result = s.c.exportReadModel_()
    assert.equal(resource(result, 'customer:0001').readModelError.code, 'RECORD_VERIFICATION_REQUIRED')
    assert.equal(resource(result, 'customers')[0].currentBalance, undefined)
    assert.equal(resource(result, 'activeCustomers')[0].currentBalance, undefined)
  }
})

test('source rejects duplicate customer IDs and a snapshot crossing midnight', () => {
  const s = sourceContext(2)
  s.master.rows[6][0] = '0001'
  assert.throws(() => s.c.exportReadModel_(), { code: 'RECORD_VERIFICATION_REQUIRED' })
  const next = sourceContext()
  let calls = 0
  next.c.getTodaySheetName_ = () => ++calls === 1 ? '2026-10-23' : '2026-10-24'
  assert.throws(() => next.c.exportReadModel_(), { code: 'RECORD_VERIFICATION_REQUIRED' })
  assert.equal(next.locked(), false)
})

test('completed Sheets receipts are exported for lost-response recovery, pending receipts are not', () => {
  const s = sourceContext()
  s.sheets.set('_WebappTransactionReceipts', s.sheet([[], ['receipt-request-00001', '0001', 1000, 'complete', '{"verified":true,"customerCode":"0001","newBalance":1000}', '']]))
  const snapshot = s.c.exportReadModel_()
  assert.equal(snapshot.completedWrites.length, 1)
  assert.equal(snapshot.completedWrites[0].action, 'addTransaction')
  assert.equal(snapshot.completedWrites[0].customerCode, '0001')
})

test('source synchronization invalidates before exporting and never repeats financial operations', () => {
  const s = sourceContext()
  const calls = []
  const progress = []
  s.c.console = { log: message => progress.push(JSON.parse(message)), error() {} }
  const build = s.c.buildReadModelSnapshot_
  s.c.buildReadModelSnapshot_ = (...args) => {
    assert.equal(s.locked(), true, 'Sheet snapshot must be built under the mutation lock')
    return build(...args)
  }
  s.c.readModelSyncConfig_ = () => ({})
  s.c.postReadModel_ = (_config, endpoint, payload) => {
    assert.equal(s.locked(), false, 'Cloudflare network waits must not hold the mutation lock')
    calls.push(endpoint)
    if (endpoint === 'invalidate') return { invalidationEpoch: 12 }
    assert.equal(payload.invalidationEpoch, 12)
    assert.equal(payload.resources.length, 5)
    return {}
  }
  s.c.runReadModelSync()
  assert.deepEqual(calls, ['invalidate', 'sync'])
  assert.equal(s.locked(), false)
  assert.deepEqual(progress.filter(item => item.stage).map(item => item.stage), [
    'starting', 'cloudflare_invalidate_start', 'cloudflare_invalidate_done',
    'sheet_lock_wait', 'sheet_lock_acquired', 'sheet_customer_read_start',
    'sheet_customer_read_done', 'sheet_receipt_read_start', 'sheet_receipt_read_done',
    'sheet_history_read_start', 'history_range_values_start', 'history_range_values_done',
    'history_range_displays_done', 'history_parse_start', 'sheet_history_read_done', 'sheet_today_read_start',
    'sheet_today_read_done', 'snapshot_build_start', 'snapshot_build_done',
    'cloudflare_publish_start', 'cloudflare_publish_done',
  ])
  assert.ok(progress.every(item => Number.isFinite(item.elapsedMs ?? item.durationMs)))
})

test('sync failures identify their stage and leave no spreadsheet lock held', () => {
  for (const endpoint of ['invalidate', 'sync']) {
    const s = sourceContext()
    const errors = []
    s.c.console = { log() {}, error: message => errors.push(JSON.parse(message)) }
    s.c.readModelSyncConfig_ = () => ({})
    s.c.postReadModel_ = (_config, target) => {
      assert.equal(s.locked(), false)
      if (target === endpoint) throw new Error('Transport failed')
      return { invalidationEpoch: 12 }
    }
    assert.throws(() => s.c.runReadModelSync(), /Transport failed/)
    assert.equal(s.locked(), false)
    assert.equal(errors[0].stage, endpoint === 'invalidate'
      ? 'cloudflare_invalidate_start' : 'cloudflare_publish_start')
    assert.equal(errors[0].status, 'failed')
  }
})

test('overlapping sync rebuilds against the latest epoch without invalidating or repeating chip writes', () => {
  const s = sourceContext()
  const calls = []
  const snapshots = []
  s.c.console = { log() {}, error() {} }
  s.c.readModelSyncConfig_ = () => ({})
  s.c.addTransaction_ = s.c.checkoutCustomer_ = () => assert.fail('No chip mutations during sync recovery')
  s.c.postReadModel_ = (_config, endpoint, payload) => {
    assert.equal(s.locked(), false)
    calls.push(endpoint)
    if (endpoint === 'invalidate') return { invalidationEpoch: 12 }
    if (endpoint === 'epoch') return { invalidationEpoch: 13 }
    snapshots.push(payload)
    if (snapshots.length === 1) {
      s.master.rows[5][1] = 'Changed during another sync'
      throw Object.assign(new Error('Conflict'), { syncReason: 'SNAPSHOT_CONFLICT' })
    }
    return {}
  }
  s.c.runReadModelSync()
  assert.deepEqual(calls, ['invalidate', 'sync', 'epoch', 'sync'])
  assert.equal(snapshots[0].invalidationEpoch, 12)
  assert.equal(snapshots[1].invalidationEpoch, 13)
  assert.equal(resource(snapshots[0], 'customer:0001').customerName, 'Customer 1')
  assert.equal(resource(snapshots[1], 'customer:0001').customerName, 'Changed during another sync')
  assert.ok(snapshots[1].sourceUpdatedAt > snapshots[0].sourceUpdatedAt)
  assert.equal(s.locked(), false)
})

test('persistent snapshot conflicts stop after three fresh attempts', () => {
  const s = sourceContext()
  const calls = []
  s.c.console = { log() {}, error() {} }
  s.c.readModelSyncConfig_ = () => ({})
  s.c.postReadModel_ = (_config, endpoint) => {
    calls.push(endpoint)
    if (endpoint !== 'sync') return { invalidationEpoch: 12 }
    throw Object.assign(new Error('Conflict'), { syncReason: 'SNAPSHOT_CONFLICT' })
  }
  assert.throws(() => s.c.runReadModelSync(), /Conflict/)
  assert.deepEqual(calls, ['invalidate', 'sync', 'epoch', 'sync', 'epoch', 'sync'])
  assert.equal(s.locked(), false)
})

test('sync errors expose only known diagnostic codes, never response secrets or arbitrary text', () => {
  const s = sourceContext()
  const config = { url: 'https://example.invalid/internal/read-model/sync', secret: 'private-value' }
  for (const body of [JSON.stringify({ reason: 'SNAPSHOT_CONFLICT', error: 'private-value' }),
    JSON.stringify({ reason: 'private-value', error: 'private-value' }), '<html>private-value</html>']) {
    s.c.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 409, getContentText: () => body }) }
    assert.throws(() => s.c.postReadModel_(config, 'sync', {}), error => {
      assert.equal(error.httpStatus, 409)
      assert.equal(error.message.includes('private-value'), false)
      assert.equal(error.syncReason, body.includes('SNAPSHOT_CONFLICT') ? 'SNAPSHOT_CONFLICT' : '')
      return true
    })
  }
})

test('change trigger avoids duplicate EDIT imports but retains structural and format changes', () => {
  const s = sourceContext()
  let calls = 0
  s.c.runReadModelSync = () => { calls++ }
  s.c.readModelOnChange({ changeType: 'EDIT' })
  assert.equal(calls, 0)
  s.c.readModelOnEdit({})
  for (const changeType of ['INSERT_ROW', 'REMOVE_ROW', 'FORMAT', 'OTHER']) {
    s.c.readModelOnChange({ changeType })
  }
  assert.equal(calls, 5)
})

test('modern date conversion preserves Tokyo dates at midnight, leap days and year boundaries', () => {
  const s = sourceContext()
  const reference = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit' })
  for (const iso of ['2026-10-22T14:59:59.999Z', '2026-10-22T15:00:00.000Z',
    '2024-02-28T15:00:00.000Z', '2025-12-31T15:00:00.000Z', '2026-07-07T00:00:00.000Z']) {
    const value = new Date(iso)
    assert.equal(s.c.readModelDate_(value, 'ignored display'), reference.format(value))
  }
  assert.equal(s.c.readModelDate_(new Date(NaN), ''), '')
  assert.equal(s.c.readModelDate_('2026/10/23', ''), '2026-10-23')
  s.c.formatSheetDate_ = () => 'fallback'
  assert.equal(s.c.readModelDate_(new Date('1950-01-01'), ''), 'fallback')
})

test('8,259 real date rows avoid Utilities date formatting and preserve history without source writes', () => {
  const s = sourceContext()
  // Restore the real parser, which the other fixtures replace for convenience.
  vm.runInContext(source.slice(source.indexOf('function formatSheetDate_('),
    source.indexOf('function getTodaySheetName_(')), s.c)
  s.c.Utilities = { formatDate() { assert.fail('No per-row Apps Script date service calls') } }
  const rows = [[], ...Array.from({ length: 8259 }, (_, index) => [
    new Date('2026-10-22T15:00:00Z'), '0001', 'Test', '', '', index, index + 1, 1])]
  s.sheets.set('変動ログ', s.sheet(rows))
  s.sheets.delete('2026-10-23')
  s.master.rows[5][3] = 8259
  const before = JSON.stringify(rows)
  const snapshot = s.c.exportReadModel_()
  const history = resource(snapshot, 'history:0001')
  assert.equal(history.length, 8259)
  assert.equal(history[0].balanceAfter, 8259)
  assert.equal(history[0].timestamp, '2026-10-23 00:00:00')
  assert.equal(history[0].breakBefore, false)
  assert.equal(JSON.stringify(rows), before)
})
