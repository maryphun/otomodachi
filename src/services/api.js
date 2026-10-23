const API_URL = import.meta.env.VITE_API_URL || '/api'

const DEFAULT_API_TIMEOUT_MS = 15 * 1000
const WRITE_API_TIMEOUT_MS = 45 * 1000
const WRITE_ACTIONS = new Set([
  'addTransaction',
  'enterCustomer',
  'checkoutCustomer',
  'createCustomer',
  'updateCustomerProfilePublic',
])

let writesInFlight = 0
let editInProgress = false
let initialSync = null
let latestSync = null
let serverChanged = false

function readSync(sync) {
  if (!sync || !['string', 'number'].includes(typeof sync.sourceUpdatedAt) ||
      String(sync.sourceUpdatedAt).trim() === '' ||
      typeof sync.businessDate !== 'string' || !sync.businessDate) {
    return null
  }
  return {
    sourceUpdatedAt: String(sync.sourceUpdatedAt),
    businessDate: sync.businessDate,
  }
}

function observeSync(sync) {
  const next = readSync(sync)
  if (!next) return
  if (latestSync && next.sourceUpdatedAt < latestSync.sourceUpdatedAt &&
      next.sourceUpdatedAt !== 'legacy' && latestSync.sourceUpdatedAt !== 'legacy') {
    const error = new Error('新しい記録があります。再読み込みしてください。')
    error.code = 'STALE_SERVER_RESPONSE'
    throw error
  }
  latestSync = next
  if (!initialSync) {
    initialSync = next
  } else if (next.sourceUpdatedAt !== initialSync.sourceUpdatedAt ||
      next.businessDate !== initialSync.businessDate) {
    // Keep the baseline until reload so another read cannot hide a change.
    serverChanged = true
  }
}

export async function checkServerChanges(onWaiting) {
  await apiGet('getSyncStatus', {}, false, onWaiting)
  return serverChanged
}

// Only acknowledge after the visible screen has fetched its replacement data.
export function acknowledgeServerChanges() {
  initialSync = latestSync
  serverChanged = false
}

export function isEditInProgress() { return editInProgress }

export function hasBusinessDateChanged() {
  return Boolean(initialSync && latestSync && initialSync.businessDate !== latestSync.businessDate)
}

export function setEditInProgress(value) {
  editInProgress = Boolean(value)
}

export function isWriteInFlight() { return writesInFlight > 0 }

export function hasPendingWrites() {
  return editInProgress || hasUnresolvedWrites()
}

export function hasUnresolvedWrites() {
  if (writesInFlight > 0) return true
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      if (/^otomodachi-(checkout|transaction)-pending-/.test(sessionStorage.key(index))) {
        return true
      }
    }
    return false
  } catch {
    // Do not interrupt unresolved writes when storage is inaccessible.
    return true
  }
}

export function clearLegacyFinancialCaches() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[storageName]
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index)
        if (/^otomodachi-v\d+-(customers$|customer-|history-|today-history(?:-time)?$|today-active-customers(?:-time)?$)/.test(key)) {
          storage.removeItem(key)
        }
      }
    } catch (error) {
      console.error('Could not remove legacy financial caches', error)
    }
  }
}

function getApiTimeoutMs(action) {
  return WRITE_ACTIONS.has(action)
    ? WRITE_API_TIMEOUT_MS
    : DEFAULT_API_TIMEOUT_MS
}

function isLocalApiHost() {
  return [
    'localhost',
    '127.0.0.1',
  ].includes(window.location.hostname)
}

function buildApiProblemMessage(
  action,
  mainMessage,
  timeoutMs,
) {
  if (
    action === 'enterCustomer' &&
    String(mainMessage || '').includes(
      'Unknown action: enterCustomer',
    )
  ) {
    return [
      'Apps Script側に入店機能がまだデプロイされていません。',
      '',
      '必要な作業:',
      '- appscript-full/Webapp用.txt の内容を Apps Script の Webapp用.gs に貼り替える',
      '- Apps Script を新しいバージョンでデプロイする',
      '- APPS_SCRIPT_URL がその新しい /exec URL を向いているか確認する',
    ].join('\n')
  }

  const lines = [
    mainMessage,
    '',
    'Likely reasons:',
    '- Apps Script is still processing or cold starting',
    '- Apps Script was not deployed as a new version',
    '- APPS_SCRIPT_URL points to an old or different Apps Script',
    '- APPS_SCRIPT_SECRET does not match WEBAPP_API_SECRET',
  ]

  if (WRITE_ACTIONS.has(action)) {
    lines.push(
      '',
      'Before pressing again, check the sheet. The write may still finish after this timeout.',
    )
  }

  if (isLocalApiHost()) {
    lines.push(
      '',
      'Localhost checks:',
      '- Check .dev.vars APPS_SCRIPT_URL / APPS_SCRIPT_SECRET',
    )
  }

  lines.push(
    '',
    `Waited: ${Math.round(timeoutMs / 1000)} seconds`,
  )

  return lines.join('\n')
}

async function apiGet(action, parameters = {}, includeEnvelope = false, onWaiting) {
  // Retry reads only. Never replay a chip operation, even if its response was lost.
  const delays = [1000, 2000, 3000, 3000, 3000]
  const deadline = Date.now() + getApiTimeoutMs(action)
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiGetOnce(action, parameters, includeEnvelope, Math.max(1, deadline - Date.now()))
    } catch (error) {
      if (WRITE_ACTIONS.has(action) || attempt >= delays.length ||
          Date.now() + delays[attempt] >= deadline ||
          !['READ_MODEL_UNAVAILABLE', 'STALE_SERVER_RESPONSE'].includes(error.code)) {
        if (!WRITE_ACTIONS.has(action) && action !== 'getSyncStatus' &&
            ['READ_MODEL_UNAVAILABLE', 'STALE_SERVER_RESPONSE'].includes(error.code)) {
          window.dispatchEvent?.(new CustomEvent('otomo-read-recovery-needed'))
        }
        throw error
      }
      onWaiting?.()
      await new Promise(resolve => window.setTimeout(resolve, delays[attempt]))
    }
  }
}

function apiGetOnce(action, parameters = {}, includeEnvelope = false, timeoutMs = getApiTimeoutMs(action)) {
  const url = new URL(API_URL, window.location.origin)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  url.searchParams.set('action', action)

  for (const [key, value] of Object.entries(
    parameters,
  )) {
    url.searchParams.set(key, String(value))
  }

  url.searchParams.set('clientVersion', 'd1-v1')

  const isWrite = WRITE_ACTIONS.has(action)
  if (isWrite) writesInFlight++

  return Promise.resolve().then(() => fetch(url.toString(), {
    method: 'GET',
    signal: controller.signal,
    credentials: 'same-origin',
    cache: 'no-store',
  }))
    .then(async (response) => {
      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        const error = new Error(
          result?.code === 'RECORD_VERIFICATION_REQUIRED' ? 'なんかおかしい...メリーに確認して' : result?.code ? result.error : buildApiProblemMessage(
            action,
            result?.error || 'Request failed',
            timeoutMs,
          ),
        )
        error.code = result?.code
        throw error
      }

      if (!isWrite) {
        if (action === 'getSyncStatus' && !readSync(result.sync)) {
          const error = new Error('Server sync metadata is unavailable')
          error.code = 'SYNC_CONTRACT_INVALID'
          throw error
        }
        observeSync(result.sync)
      }
      return includeEnvelope ? result : result.data
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        throw new Error(
          buildApiProblemMessage(
            action,
            'Server connection timed out',
            timeoutMs,
          ),
        )
      }

      throw error
    })
    .catch((error) => {
      if (error.code || String(error.message || '').includes('Likely reasons:')) {
        throw error
      }

      throw new Error(
        buildApiProblemMessage(
          action,
          error.message || 'Request failed',
          timeoutMs,
        ),
      )
    })
    .finally(() => {
      window.clearTimeout(timeoutId)
      if (isWrite) writesInFlight--
    })
}

function normalizeCustomerCode(value) {
  return String(value || '').trim().padStart(4, '0')
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /[\u30a1-\u30f6]/g,
      (character) =>
        String.fromCharCode(
          character.charCodeAt(0) - 0x60,
        ),
    )
    .replace(/\s+/g, '')
}

function normalizeCustomer(customer) {
  if (!customer?.customerCode || !Number.isSafeInteger(customer.currentBalance)) {
    throw new Error('なんかおかしい...メリーに確認して')
  }
  return {
    ...customer,
    customerCode: normalizeCustomerCode(customer.customerCode),
    normalizedCustomerCode: normalizeCustomerCode(customer.customerCode).replace(/^0+/, ''),
    normalizedCustomerName: normalizeSearchText([customer.customerName, customer.customerReading].join(' ')),
  }
}

function requireList(data) {
  if (!Array.isArray(data)) throw new Error('取得結果を確認できません')
  if (data.some(item => item?.readModelError)) throw new Error('記録の整合性を確認できません。スタッフに確認してください。')
  return data
}

// Compatibility for callers being migrated separately; never retain financial data.
export function getCachedCustomers() { return [] }
export function getCachedCustomer() { return null }
export function getCachedHistory() { return [] }
export function getCachedTodayActiveCustomers() { return null }
export function cacheCustomer() {}
export function clearCustomerHistoryCache() {}
export function clearTodayHistoryCache() {}
export function clearTodayActiveCustomersCache() {}

export async function getAllCustomers() {
  return requireList(await apiGet('getAllCustomers')).map(normalizeCustomer)
}

export async function getCustomer(customerCode) {
  const customer = await apiGet('getCustomer', { customerCode })
  if (!customer || normalizeCustomerCode(customer.customerCode) !== normalizeCustomerCode(customerCode) ||
      !Number.isSafeInteger(customer.currentBalance)) {
    throw new Error('なんかおかしい...メリーに確認して')
  }
  return normalizeCustomer(customer)
}

export function getCustomerPresence(customerCode) {
  return apiGet('getCustomerPresence', { customerCode })
}

export async function getHistory(customerCode, period = 'all') {
  return (await getHistoryReport(customerCode, period)).transactions
}

export async function getHistoryReport(customerCode, period = 'all') {
  const result = await apiGet('getHistory', { customerCode, period }, true)
  if (result.historyWarnings !== undefined && !Array.isArray(result.historyWarnings)) {
    throw new Error('履歴の取得結果を確認できません')
  }
  return { transactions: requireList(result.data), warnings: result.historyWarnings || [] }
}

export function addTransaction(customerCode, chipChange, expectedBalance) {
  return saveChipOperation('addTransaction', customerCode, chipChange, expectedBalance)
}

export function enterCustomer(customerCode) {
  return apiGet('enterCustomer', { customerCode })
}

export function checkoutCustomer(customerCode, endingAmount, expectedBalance) {
  return saveChipOperation('checkoutCustomer', customerCode, endingAmount, expectedBalance)
}

function saveChipOperation(action, customerCode, amount, expectedBalance) {
  const isCheckout = action === 'checkoutCustomer'
  const prefix = isCheckout ? 'checkout' : 'transaction'
  const otherPrefix = isCheckout ? 'transaction' : 'checkout'
  const key = `otomodachi-${prefix}-pending-${normalizeCustomerCode(customerCode)}`
  let pending
  try {
    if (sessionStorage.getItem(`otomodachi-${otherPrefix}-pending-${normalizeCustomerCode(customerCode)}`)) {
      throw new Error('Unresolved chip operation')
    }
    pending = JSON.parse(sessionStorage.getItem(key) || 'null')
  } catch {
    throw new Error('前回のうにょ操作を確認できません。別の操作をせず、スタッフに確認してください。')
  }
  if (pending && pending.amount !== amount) {
    throw new Error('前回の操作結果が未確認です。同じ操作・金額で結果を確認してから操作してください。')
  }
  if (!pending) {
    pending = { requestId: crypto.randomUUID(), amount, expectedBalance }
    // Persist before sending so a timeout or reload retains the same receipt.
    sessionStorage.setItem(key, JSON.stringify(pending))
  }
  // Include readback in the in-flight window so a poll cannot interrupt a confirmed save.
  writesInFlight++
  return apiGet(action, {
    customerCode,
    [isCheckout ? 'endingAmount' : 'chipChange']: amount,
    requestId: pending.requestId,
    ...(pending.expectedBalance === undefined ? {} : { expectedBalance: pending.expectedBalance }),
  }).then(async (result) => {
    if (result?.verified !== true || !Number.isSafeInteger(result.newBalance) ||
        normalizeCustomerCode(result.customerCode) !== normalizeCustomerCode(customerCode)) {
      throw new Error('保存結果を確認できません。操作を繰り返さず、スタッフに確認してください。')
    }
    // A replay acknowledges an older operation, not necessarily today's balance or visit.
    const customer = await getCustomer(customerCode, true)
    sessionStorage.removeItem(key)
    clearCustomerHistoryCache(customerCode)
    clearTodayHistoryCache()
    clearTodayActiveCustomersCache()
    return { ...result, customer }
  }).catch((error) => {
    if (['CHECKOUT_NOT_ACTIVE', 'BALANCE_CHANGED', 'CLIENT_UPDATE_REQUIRED'].includes(error.code)) {
      sessionStorage.removeItem(key)
    }
    throw error
  }).finally(() => { writesInFlight-- })
}

export function createCustomer(customerName, initialBalance = 0) {
  return apiGet('createCustomer', { customerName, initialBalance })
}

export function getCustomerPublicProfile(customerCode) {
  return apiGet('getCustomerPublicProfile', { customerCode })
}

export function updateCustomerProfilePublic(customerCode, profilePublic) {
  return apiGet('updateCustomerProfilePublic', { customerCode, profilePublic })
}

export async function getTodayHistory() {
  return requireList(await apiGet('getTodayHistory'))
}

export async function getTodayActiveCustomers() {
  return requireList(await apiGet('getTodayActiveCustomers'))
}
