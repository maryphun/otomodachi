// Optional browser smoke test. All API requests are mocked; no production data is touched.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../src/server/readModel.js'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = 'http://127.0.0.1:4193'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4193', '--strictPort'], { stdio: 'pipe', windowsHide: true })
let browser
const workerSource = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
  .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/server\/readModel.js'/, '')
  .replace('export default {', 'const worker = {')
const workerContext = vm.createContext({ ...model, URL, Response, TextEncoder, console, crypto })
vm.runInContext(workerSource, workerContext)
workerContext.getPublicCustomerByToken_ = async () => ({ success: true,
  data: { customerCode: '0001', customerName: '検証用', currentBalance: 1000 },
  sync: { revision: '1', businessDate: '2026-10-23' } })
const publicHtml = await (await workerContext.publicCustomerPage_(new URL('https://example.invalid/public/customer/' + 'a'.repeat(64)), {})).text()
const history = [
  { timestamp: '2026-10-01 00:00:00', balanceBefore: 0, balanceAfter: 100, chipChange: 100 },
  { timestamp: '2026-10-02 00:00:00', balanceBefore: 100, balanceAfter: 200, chipChange: 100 },
  { timestamp: '2026-10-03 00:00:00', balanceBefore: 0, balanceAfter: 50, chipChange: 50, breakBefore: true },
  { timestamp: '2026-10-04 00:00:00', balanceBefore: 50, balanceAfter: 60, chipChange: 10 },
].map((item, i) => ({ ...item, transactionId: String(i) })).reverse()
const warning = { reason: 'HISTORY_CHAIN_MISMATCH', sheet: '変動ログ', row: 6057,
  previousRow: 5983, previousDate: '2026-10-02', date: '2026-10-03', previousAfter: 200, before: 0 }
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview exited')
    try { if ((await fetch(base)).ok) break } catch { /* Wait for preview. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['tablet', { width: 1024, height: 768 }]]) {
    let balance = 1000
    let version = 1
    let unavailable = false
    let transientStatusFailures = 0
    let balanceConflict = false
    let historyWarnings = [warning]
    let writes = 0
    const errors = []
    const contexts = []
    const pages = []
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({ viewport })
      contexts.push(context)
      const page = await context.newPage()
      pages.push(page)
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install()
      await page.addInitScript(() => {
        localStorage.setItem('otomodachi-v2-customer-0001', JSON.stringify({ savedAt: Date.now(), data: { customerCode: '0001', customerName: 'Old', currentBalance: 9999999 } }))
      })
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        const action = url.searchParams.get('action')
        if (action) {
          const sync = { sourceUpdatedAt: `2026-10-23T00:00:0${version}.000Z`, businessDate: '2026-10-23', revision: String(version) }
          let data
          if (action === 'getSyncStatus') data = sync
          else if (action === 'getCustomer') data = { customerCode: '0001', customerName: '検証用', currentBalance: balance, activeToday: true, lastVisit: '2026/10/23' }
          else if (action === 'getHistory') data = history
          else if (action === 'getTodayHistory') data = []
          else { writes++; throw new Error('Unexpected mutation: ' + action) }
          if (action === 'getSyncStatus' && transientStatusFailures > 0) {
            transientStatusFailures--
            return route.fulfill({ status: 503, contentType: 'application/json',
              body: JSON.stringify({ success: false, code: 'READ_MODEL_UNAVAILABLE', error: 'Syncing' }) })
          }
          if (balanceConflict && action === 'getCustomer') return route.fulfill({ status: 503,
            contentType: 'application/json', body: JSON.stringify({ success: false,
              code: 'RECORD_VERIFICATION_REQUIRED', error: 'Original diagnostic' }) })
          return route.fulfill({ status: unavailable ? 503 : 200, contentType: 'application/json', body: JSON.stringify(unavailable ?
            { success: false, code: 'READ_MODEL_UNAVAILABLE', error: 'データを同期中です。' } : { success: true, data, sync,
              ...(action === 'getHistory' ? { historyWarnings } : {}) }) })
        }
        if (url.pathname.startsWith('/public/customer-history/')) return route.fulfill({ contentType: 'application/json',
          body: JSON.stringify({ success: true, data: history, historyIncomplete: true, sync: { revision: '1' } }) })
        if (url.pathname.startsWith('/public/customer/')) return route.fulfill({ contentType: 'text/html', body: publicHtml })
        if (url.hostname !== '127.0.0.1') return route.abort()
        return route.continue()
      })
      await page.goto(base + '/#/customer/0001')
      await page.locator('.balance-panel strong').filter({ hasText: /^1,000$/ }).waitFor()
      assert.equal(await page.getByText('9,999,999').count(), 0)
      assert.equal(await page.evaluate(() => localStorage.getItem('otomodachi-v2-customer-0001')), null)
    }
    const [first, second] = pages
    await first.locator('.action-button--history').click()
    await first.locator('.history-warning').waitFor()
    await first.locator('.history-warning summary').click()
    await first.getByText('変動ログ 6057行目', { exact: true }).waitFor()
    assert.equal(await first.locator('.history-chart polyline').count(), 2)
    assert.equal(await first.locator('.balance-panel strong').textContent(), '1,000')
    await first.screenshot({ path: join(tmpdir(), `otomodachi-history-${name}-warning.png`), fullPage: true })
    historyWarnings = []
    await first.reload()
    await first.locator('.action-button--history').click()
    await first.locator('.history-chart').waitFor()
    assert.equal(await first.locator('.history-warning').count(), 0)
    await first.goto(base + '/public/customer/' + 'a'.repeat(64))
    await first.locator('[data-history-button]').click()
    await first.getByText('履歴の一部を確認中です', { exact: true }).waitFor()
    assert.equal(await first.locator('[data-current-balance]').textContent(), '1,000')
    assert.equal(await first.locator('.history-chart polyline').count(), 2)
    // Reopening history must work after the panel DOM has been replaced.
    await first.locator('[data-history-button]').click()
    await first.getByText('履歴の一部を確認中です', { exact: true }).waitFor()
    assert.equal(await first.getByText('6057', { exact: false }).count(), 0)
    await first.screenshot({ path: join(tmpdir(), `otomodachi-history-${name}-public.png`), fullPage: true })
    balanceConflict = true
    await first.goto(base + '/#/customer/0001')
    await first.getByText('なんかおかしい...メリーに確認して', { exact: true }).waitFor()
    assert.equal(await first.locator('.balance-panel').count(), 0)
    assert.equal(await first.locator('.action-button--history').count(), 0)
    balanceConflict = false
    await first.reload()
    await first.locator('.balance-panel strong').filter({ hasText: /^1,000$/ }).waitFor()
    await second.getByRole('button', { name: '＋ 貯うにょ', exact: true }).click()
    await second.getByRole('button', { name: '1', exact: true }).click()
    await second.getByRole('button', { name: '0', exact: true }).click()
    await second.getByRole('button', { name: '0', exact: true }).click()
    balance = 2000
    version = 2
    await second.clock.fastForward(31000)
    await second.locator('.balance-preview strong').filter({ hasText: /^2,000$/ }).waitFor()
    assert.equal(await second.locator('.sync-unavailable').count(), 0)
    assert.equal(await second.locator('.amount-display strong').innerText(), '100')
    assert.equal(await second.locator('.balance-preview strong').last().innerText(), '2,100')
    await second.screenshot({ path: join(tmpdir(), `otomodachi-shared-${name}-changed.png`), fullPage: true })
    await first.clock.fastForward(31000)
    await first.locator('.balance-panel strong').filter({ hasText: /^2,000$/ }).waitFor()
    // An unchanged snapshot becoming readable again must restore the same draft.
    transientStatusFailures = 1
    await second.clock.fastForward(31000)
    await second.locator('.sync-spinner').waitFor()
    await second.screenshot({ path: join(tmpdir(), `otomodachi-shared-${name}-recovering.png`), fullPage: true })
    await second.clock.runFor(1500)
    await second.locator('.sync-unavailable').waitFor({ state: 'hidden' })
    assert.equal(await second.locator('.amount-display strong').innerText(), '100')

    unavailable = true
    await second.clock.fastForward(31000)
    await second.locator('.sync-unavailable').waitFor()
    assert.equal(await second.locator('.balance-panel').isVisible(), false)
    // Allow the bounded read retries to expire, then recover without clicking reload.
    for (let i = 0; i < 18; i++) {
      await second.clock.runFor(1000)
      await second.waitForTimeout(30)
    }
    await second.getByRole('heading', { name: '同期に時間がかかっています' }).waitFor()
    unavailable = false
    await second.clock.runFor(6000)
    await second.locator('.sync-unavailable').waitFor({ state: 'hidden' })
    assert.equal(await second.locator('.amount-display strong').innerText(), '100')
    unavailable = true
    await first.goto(base + '/#/today-history')
    for (let i = 0; i < 16; i++) {
      await first.clock.runFor(1000)
      await first.waitForTimeout(30)
    }
    assert.equal(await first.locator('.summary-grid').count(), 0)
    unavailable = false
    for (let i = 0; i < 12; i++) {
      await first.clock.runFor(1000)
      await first.waitForTimeout(30)
    }
    await first.locator('.summary-grid').waitFor()
    for (const page of pages) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(writes, 0)
    assert.deepEqual(errors, [])
    for (const context of contexts) await context.close()
    console.log(`${name}: two devices, timestamp refresh, draft protection, stale-cache removal and sync failures passed`)
  }
} finally {
  await browser?.close()
  server.kill()
}
