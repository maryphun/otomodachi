import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import { setImmediate } from 'node:timers'

function setup() {
  const source = readFileSync(new URL('../src/services/syncMonitor.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/api'/, '').replace('export ', '')
  const events = []
  const listeners = new Map()
  const timers = new Map()
  let interval
  let reloads = 0
  let acknowledged = 0
  const state = { changed: false, editing: false, writing: false, unresolved: false, dayChanged: false }
  const window = {
    location: { reload() { reloads++ } },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
    dispatchEvent(event) { events.push(event); listeners.get(event.type)?.(event) },
    setInterval(fn) { interval = fn; return 1 }, clearInterval() {},
    setTimeout(fn) { const id = {}; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const document = { ...window, visibilityState: 'visible' }
  const context = vm.createContext({ window, document, console: { error() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    checkServerChanges: async () => state.changed,
    acknowledgeServerChanges() { acknowledged++; state.changed = false },
    isWriteInFlight: () => state.writing, hasUnresolvedWrites: () => state.unresolved,
    isEditInProgress: () => state.editing, hasBusinessDateChanged: () => state.dayChanged,
  })
  vm.runInContext(source, context)
  context.startSyncMonitor()
  const settle = () => new Promise(resolve => setImmediate(resolve))
  return { context, state, events, window, document, listeners,
    reloads: () => reloads, acknowledged: () => acknowledged,
    async tick() { interval(); await settle() },
    async retry() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await settle() },
  }
}

test('unchanged status is quiet; a changed view without a draft refreshes automatically', async () => {
  const s = setup()
  await s.tick()
  assert.equal(s.events.length, 0)
  s.state.changed = true
  await s.tick()
  assert.equal(s.reloads(), 1)
})

test('changed drafts wait for fresh data, then restore without a full reload', async () => {
  const s = setup()
  s.state.changed = s.state.editing = true
  let finish
  s.window.addEventListener('otomo-sync-refresh-draft', event => {
    event.detail.waitUntil(new Promise(resolve => { finish = resolve }))
  })
  await s.tick()
  assert.equal(s.events[0].detail.recovering, true)
  assert.equal(s.acknowledged(), 0)
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.acknowledged(), 1)
  assert.equal(s.reloads(), 0)
  assert.equal(s.events.at(-1).type, 'otomo-sync-restored')
})

test('failed draft refresh retries automatically and never acknowledges unverified data', async () => {
  const s = setup()
  s.state.changed = s.state.editing = true
  let fail = true
  s.window.addEventListener('otomo-sync-refresh-draft', event => {
    event.detail.waitUntil(fail ? Promise.reject(new Error('syncing')) : Promise.resolve())
  })
  await s.tick()
  assert.equal(s.acknowledged(), 0)
  assert.equal(s.events.at(-1).detail.recovering, false)
  fail = false
  await s.retry()
  assert.equal(s.acknowledged(), 1)
  assert.equal(s.events.at(-1).type, 'otomo-sync-restored')
})

test('transient status failure waits automatically, including unchanged recovered data', async () => {
  const s = setup()
  s.context.checkServerChanges = async onWaiting => { onWaiting(); return false }
  await s.tick()
  assert.equal(s.events[0].detail.recovering, true)
  assert.equal(s.reloads(), 1)
})

test('initial route failures recover even when no prior timestamp was available', async () => {
  const s = setup()
  s.window.dispatchEvent({ type: 'otomo-read-recovery-needed' })
  await s.retry()
  assert.equal(s.reloads(), 1)
})

test('real record conflicts are not presented as ordinary synchronization delays', async () => {
  const s = setup()
  s.state.changed = s.state.editing = true
  s.window.addEventListener('otomo-sync-refresh-draft', event => {
    const error = Object.assign(new Error('Record conflict'), { code: 'RECORD_VERIFICATION_REQUIRED' })
    event.detail.waitUntil(Promise.reject(error))
  })
  await s.tick()
  assert.equal(s.events.at(-1).detail.problem, 'Record conflict')
  assert.equal(s.acknowledged(), 0)
})

test('unresolved receipts are never cleared or mistaken for an unsaved draft', async () => {
  const s = setup()
  s.state.changed = s.state.unresolved = s.state.editing = true
  await s.tick()
  assert.equal(s.events.at(-1).detail.unresolved, true)
  assert.equal(s.reloads(), 0)
  assert.equal(s.acknowledged(), 0)
  assert.equal(s.events.some(event => event.type === 'otomo-sync-refresh-draft'), false)
})

test('a save starting during a status request is not interrupted', async () => {
  const s = setup()
  s.context.checkServerChanges = async () => { s.state.writing = true; return true }
  await s.tick()
  assert.equal(s.events.length, 0)
  assert.equal(s.reloads(), 0)
  s.state.writing = false
  s.context.checkServerChanges = async () => false
  await s.retry()
  assert.equal(s.reloads(), 1)
})

test('day changes are passed to the draft and visibility checks cannot overlap', async () => {
  const s = setup()
  s.state.editing = s.state.dayChanged = true
  s.window.addEventListener('otomo-sync-refresh-draft', event => {
    assert.equal(event.detail.dayChanged, true)
    event.detail.waitUntil(Promise.resolve())
  })
  s.document.visibilityState = 'hidden'
  s.listeners.get('visibilitychange')()
  s.document.visibilityState = 'visible'
  s.listeners.get('visibilitychange')()
  await s.tick()
  assert.equal(s.acknowledged(), 1)
})
