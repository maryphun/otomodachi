const API_URL = import.meta.env.VITE_API_URL || '/api'

const CACHE_VERSION = 'v2'
const CUSTOMER_CACHE_KEY = `otomodachi-${CACHE_VERSION}-customers`
const CUSTOMER_DETAIL_CACHE_PREFIX =
  `otomodachi-${CACHE_VERSION}-customer-`
const TODAY_HISTORY_CACHE_KEY =
  `otomodachi-${CACHE_VERSION}-today-history`
const TODAY_HISTORY_CACHE_TIME_KEY =
  `otomodachi-${CACHE_VERSION}-today-history-time`
const TODAY_ACTIVE_CUSTOMERS_CACHE_KEY =
  `otomodachi-${CACHE_VERSION}-today-active-customers`
const TODAY_ACTIVE_CUSTOMERS_CACHE_TIME_KEY =
  `otomodachi-${CACHE_VERSION}-today-active-customers-time`
const CUSTOMER_HISTORY_CACHE_PREFIX =
  `otomodachi-${CACHE_VERSION}-history-`

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const CUSTOMER_LIST_FRESH_MS = 6 * HOUR_MS
const CUSTOMER_LIST_STALE_MS = 30 * DAY_MS
const CUSTOMER_DETAIL_FRESH_MS = 30 * MINUTE_MS
const CUSTOMER_DETAIL_STALE_MS = 30 * DAY_MS
const CUSTOMER_HISTORY_FRESH_MS = 10 * MINUTE_MS
const CUSTOMER_HISTORY_STALE_MS = 14 * DAY_MS
const TODAY_HISTORY_FRESH_MS = 5 * MINUTE_MS
const DEFAULT_API_TIMEOUT_MS = 15 * 1000
const WRITE_API_TIMEOUT_MS = 45 * 1000
const WRITE_ACTIONS = new Set([
  'addTransaction',
  'checkoutCustomer',
  'createCustomer',
  'updateCustomerProfilePublic',
])

let allCustomersRequest = null
const customerRequests = new Map()

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

function apiGet(action, parameters = {}) {
  const url = new URL(API_URL, window.location.origin)
  const controller = new AbortController()
  const timeoutMs = getApiTimeoutMs(action)
  const timeoutId = window.setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  url.searchParams.set('action', action)

  for (const [key, value] of Object.entries(
    parameters,
  )) {
    url.searchParams.set(key, String(value))
  }

  return fetch(url.toString(), {
    method: 'GET',
    signal: controller.signal,
    credentials: 'same-origin',
  })
    .then(async (response) => {
      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        throw new Error(
          buildApiProblemMessage(
            action,
            result?.error || 'Request failed',
            timeoutMs,
          ),
        )
      }

      return result.data
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
      if (String(error.message || '').includes('Likely reasons:')) {
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
    })
}

function getStoredValue(storage, key) {
  try {
    return storage.getItem(key)
  } catch (error) {
    console.error('キャッシュの読み込みに失敗しました', error)
    return null
  }
}

function setStoredValue(storage, key, value) {
  try {
    storage.setItem(key, value)
  } catch (error) {
    console.error('キャッシュの保存に失敗しました', error)
  }
}

function removeStoredValue(storage, key) {
  try {
    storage.removeItem(key)
  } catch (error) {
    console.error('キャッシュの削除に失敗しました', error)
  }
}

function parseCacheValue(
  rawValue,
  maxAgeMs = Number.POSITIVE_INFINITY,
) {
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)
    const hasPayload =
      parsed &&
      typeof parsed === 'object' &&
      Object.hasOwn(parsed, 'data') &&
      Object.hasOwn(parsed, 'savedAt')

    const data = hasPayload ? parsed.data : parsed
    const savedAt = hasPayload
      ? Number(parsed.savedAt)
      : Date.now()

    if (
      !Number.isFinite(savedAt) ||
      Date.now() - savedAt > maxAgeMs
    ) {
      return null
    }

    return {
      data,
      savedAt,
    }
  } catch (error) {
    console.error('キャッシュの解析に失敗しました', error)
    return null
  }
}

function readCache(key, maxAgeMs = Number.POSITIVE_INFINITY) {
  return (
    parseCacheValue(
      getStoredValue(sessionStorage, key),
      maxAgeMs,
    ) ||
    parseCacheValue(
      getStoredValue(localStorage, key),
      maxAgeMs,
    )
  )
}

function writeCache(key, data, savedAt = Date.now()) {
  const value = JSON.stringify({
    data,
    savedAt,
  })

  setStoredValue(sessionStorage, key, value)
  setStoredValue(localStorage, key, value)
}

function removeCache(key) {
  removeStoredValue(sessionStorage, key)
  removeStoredValue(localStorage, key)
}

function getTokyoDateKey(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isTodayInTokyo(value) {
  return (
    getTokyoDateKey(value) ===
    getTokyoDateKey(new Date())
  )
}

function getCustomerDetailCacheKey(customerCode) {
  return `${CUSTOMER_DETAIL_CACHE_PREFIX}${String(
    customerCode,
  )}`
}

function getCustomerHistoryCacheKey(
  customerCode,
  period = 'all',
) {
  return `${CUSTOMER_HISTORY_CACHE_PREFIX}${String(
    customerCode,
  )}-${String(period)}`
}

function normalizeCustomerCode(value) {
  return String(value || '').trim()
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

function customerCodesMatch(left, right) {
  const normalizedLeft = normalizeCustomerCode(left)
  const normalizedRight = normalizeCustomerCode(right)

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.replace(/^0+/, '') ===
      normalizedRight.replace(/^0+/, '')
  )
}

function normalizeCustomer(customer) {
  if (!customer?.customerCode) {
    return null
  }

  return {
    ...customer,
    customerCode: normalizeCustomerCode(
      customer.customerCode,
    ),
    customerName: String(customer.customerName || ''),
    customerReading: String(
      customer.customerReading || '',
    ),
    currentBalance: Number(customer.currentBalance || 0),
    lastVisit: String(customer.lastVisit || ''),
    otoPoints: Number(customer.otoPoints || 0),
    memo: String(customer.memo || ''),
    visitCount: Number(customer.visitCount || 0),
    firstVisit: String(customer.firstVisit || ''),
    profilePublic: Boolean(customer.profilePublic),
    normalizedCustomerCode: normalizeCustomerCode(
      customer.customerCode,
    ).replace(/^0+/, ''),
    normalizedCustomerName: normalizeSearchText(
      [
        customer.customerName,
        customer.customerReading,
      ].join(' '),
    ),
  }
}

function writeCustomersCache(customers, savedAt = Date.now()) {
  writeCache(CUSTOMER_CACHE_KEY, customers, savedAt)
}

function writeCustomerDetailCache(customer) {
  writeCache(
    getCustomerDetailCacheKey(customer.customerCode),
    customer,
  )

  if (
    customer.normalizedCustomerCode &&
    customer.normalizedCustomerCode !==
      customer.customerCode
  ) {
    writeCache(
      getCustomerDetailCacheKey(
        customer.normalizedCustomerCode,
      ),
      customer,
    )
  }
}

function updateCustomerListCache(customer) {
  const cached = readCache(
    CUSTOMER_CACHE_KEY,
    CUSTOMER_LIST_STALE_MS,
  )

  if (!cached || !Array.isArray(cached.data)) {
    return
  }

  const customers = [...cached.data]
  const index = customers.findIndex((item) =>
    customerCodesMatch(
      item.customerCode,
      customer.customerCode,
    ),
  )

  if (index >= 0) {
    customers[index] = {
      ...customers[index],
      ...customer,
    }
  } else {
    customers.push(customer)
  }

  customers.sort((a, b) =>
    String(a.customerCode || '').localeCompare(
      String(b.customerCode || ''),
      'ja-JP',
      { numeric: true },
    ),
  )

  writeCustomersCache(customers)
}

export function getCachedCustomers() {
  const cached = readCache(
    CUSTOMER_CACHE_KEY,
    CUSTOMER_LIST_STALE_MS,
  )

  if (!cached || !Array.isArray(cached.data)) {
    return []
  }

  return cached.data
}

export function getCachedCustomer(customerCode) {
  const cached = readCache(
    getCustomerDetailCacheKey(customerCode),
    CUSTOMER_DETAIL_STALE_MS,
  )

  if (cached?.data) {
    return cached.data
  }

  return getCachedCustomers().find((customer) =>
    customerCodesMatch(
      customer.customerCode,
      customerCode,
    ),
  )
}

export function getCachedHistory(
  customerCode,
  period = 'all',
) {
  const cached = readCache(
    getCustomerHistoryCacheKey(customerCode, period),
    CUSTOMER_HISTORY_STALE_MS,
  )

  if (!cached || !Array.isArray(cached.data)) {
    return []
  }

  return cached.data
}

export function getCachedTodayActiveCustomers() {
  const cached = readTodayActiveCustomersCacheRecord()

  if (!cached) {
    return null
  }

  return {
    customers: cached.data,
    savedAt: cached.savedAt,
  }
}

export function cacheCustomer(customer) {
  const normalizedCustomer = normalizeCustomer(customer)

  if (!normalizedCustomer) {
    return
  }

  writeCustomerDetailCache(normalizedCustomer)

  updateCustomerListCache(normalizedCustomer)
}

export function clearCustomerHistoryCache(customerCode) {
  removeCache(
    getCustomerHistoryCacheKey(customerCode, 'all'),
  )
}

export function clearTodayHistoryCache() {
  removeCache(TODAY_HISTORY_CACHE_KEY)
  removeCache(TODAY_HISTORY_CACHE_TIME_KEY)
}

export function clearTodayActiveCustomersCache() {
  removeCache(TODAY_ACTIVE_CUSTOMERS_CACHE_KEY)
  removeCache(TODAY_ACTIVE_CUSTOMERS_CACHE_TIME_KEY)
}

function readTodayHistoryCache(maxAgeMs) {
  const cached =
    getStoredValue(
      sessionStorage,
      TODAY_HISTORY_CACHE_KEY,
    ) ||
    getStoredValue(localStorage, TODAY_HISTORY_CACHE_KEY)

  const cachedTime =
    getStoredValue(
      sessionStorage,
      TODAY_HISTORY_CACHE_TIME_KEY,
    ) ||
    getStoredValue(
      localStorage,
      TODAY_HISTORY_CACHE_TIME_KEY,
    )

  if (!cached || !cachedTime) {
    return null
  }

  const savedAt = new Date(cachedTime).getTime()

  if (
    Number.isNaN(savedAt) ||
    Date.now() - savedAt > maxAgeMs
  ) {
    return null
  }

  try {
    const data = JSON.parse(cached)

    if (!Array.isArray(data)) {
      return null
    }

    return data
  } catch (error) {
    console.error('本日履歴キャッシュの解析に失敗しました', error)
    return null
  }
}

function writeTodayHistoryCache(data) {
  const now = new Date().toISOString()

  setStoredValue(
    sessionStorage,
    TODAY_HISTORY_CACHE_KEY,
    JSON.stringify(data),
  )
  setStoredValue(
    localStorage,
    TODAY_HISTORY_CACHE_KEY,
    JSON.stringify(data),
  )
  setStoredValue(
    sessionStorage,
    TODAY_HISTORY_CACHE_TIME_KEY,
    now,
  )
  setStoredValue(
    localStorage,
    TODAY_HISTORY_CACHE_TIME_KEY,
    now,
  )
}

function readTodayActiveCustomersCacheRecord(
  maxAgeMs = Number.POSITIVE_INFINITY,
) {
  const cached =
    getStoredValue(
      sessionStorage,
      TODAY_ACTIVE_CUSTOMERS_CACHE_KEY,
    ) ||
    getStoredValue(
      localStorage,
      TODAY_ACTIVE_CUSTOMERS_CACHE_KEY,
    )

  const cachedTime =
    getStoredValue(
      sessionStorage,
      TODAY_ACTIVE_CUSTOMERS_CACHE_TIME_KEY,
    ) ||
    getStoredValue(
      localStorage,
      TODAY_ACTIVE_CUSTOMERS_CACHE_TIME_KEY,
    )

  if (!cached || !cachedTime) {
    return null
  }

  const savedAt = new Date(cachedTime).getTime()

  if (
    Number.isNaN(savedAt) ||
    Date.now() - savedAt > maxAgeMs ||
    !isTodayInTokyo(cachedTime)
  ) {
    return null
  }

  try {
    const data = JSON.parse(cached)

    if (!Array.isArray(data)) {
      return null
    }

    return {
      data,
      savedAt: cachedTime,
    }
  } catch (error) {
    console.error('店内キャッシュの解析に失敗しました', error)
    return null
  }
}

function readTodayActiveCustomersCache(
  maxAgeMs = Number.POSITIVE_INFINITY,
) {
  return (
    readTodayActiveCustomersCacheRecord(maxAgeMs)
      ?.data || null
  )
}

function writeTodayActiveCustomersCache(data) {
  const now = new Date().toISOString()

  setStoredValue(
    sessionStorage,
    TODAY_ACTIVE_CUSTOMERS_CACHE_KEY,
    JSON.stringify(data),
  )
  setStoredValue(
    localStorage,
    TODAY_ACTIVE_CUSTOMERS_CACHE_KEY,
    JSON.stringify(data),
  )
  setStoredValue(
    sessionStorage,
    TODAY_ACTIVE_CUSTOMERS_CACHE_TIME_KEY,
    now,
  )
  setStoredValue(
    localStorage,
    TODAY_ACTIVE_CUSTOMERS_CACHE_TIME_KEY,
    now,
  )
}

function updateTodayActiveCustomersCacheFromTransaction(
  transaction,
) {
  const customerCode = normalizeCustomerCode(
    transaction?.customerCode,
  )
  const chipChange = Number(transaction?.chipChange || 0)
  const newBalance = Number(transaction?.newBalance)

  if (
    !customerCode ||
    !Number.isFinite(chipChange) ||
    chipChange === 0 ||
    !Number.isFinite(newBalance)
  ) {
    return
  }

  const cached = readTodayActiveCustomersCacheRecord()
  const customers = cached ? [...cached.data] : []
  const index = customers.findIndex((customer) =>
    customerCodesMatch(
      customer.customerCode,
      customerCode,
    ),
  )
  const existing = index >= 0 ? customers[index] : null
  const cachedCustomer = getCachedCustomer(customerCode)
  const balanceBefore = Number(
    existing?.balanceBefore,
  )
  const previousChipChange = Number(
    existing?.chipChange || 0,
  )
  const previousMovementCount = Number(
    existing?.movementCount || 0,
  )
  const nextCustomer = {
    ...existing,
    customerCode,
    customerName: String(
      transaction.customerName ||
        existing?.customerName ||
        cachedCustomer?.customerName ||
        '',
    ),
    date: String(transaction.timestamp || '').slice(0, 10),
    balanceBefore: Number.isFinite(balanceBefore)
      ? balanceBefore
      : newBalance - chipChange,
    currentBalance: newBalance,
    chipChange: previousChipChange + chipChange,
    movementCount: previousMovementCount + 1,
    lastMovementAmount: chipChange,
  }

  if (index >= 0) {
    customers[index] = nextCustomer
  } else {
    customers.push(nextCustomer)
  }

  writeTodayActiveCustomersCache(customers)
}

function updateTodayActiveCustomersCacheFromNewCustomer(
  customer,
) {
  const customerCode = normalizeCustomerCode(
    customer?.customerCode,
  )

  if (!customerCode) {
    return
  }

  const cached = readTodayActiveCustomersCacheRecord()
  const customers = cached ? [...cached.data] : []
  const index = customers.findIndex((cachedCustomer) =>
    customerCodesMatch(
      cachedCustomer.customerCode,
      customerCode,
    ),
  )
  const existing = index >= 0 ? customers[index] : null
  const nextCustomer = {
    ...existing,
    customerCode,
    customerName: String(
      customer.customerName ||
        existing?.customerName ||
        '',
    ),
    date: new Date().toISOString().slice(0, 10),
    balanceBefore: 0,
    currentBalance: 0,
    chipChange: 0,
    movementCount: 0,
    lastMovementAmount: 0,
  }

  if (index >= 0) {
    customers[index] = nextCustomer
  } else {
    customers.push(nextCustomer)
  }

  writeTodayActiveCustomersCache(customers)
}

function removeTodayActiveCustomerFromCache(customerCode) {
  const cached = readTodayActiveCustomersCacheRecord()

  if (!cached) {
    return
  }

  const customers = cached.data.filter(
    (customer) =>
      !customerCodesMatch(
        customer.customerCode,
        customerCode,
      ),
  )

  writeTodayActiveCustomersCache(customers)
}

export async function getAllCustomers(
  forceRefresh = false,
) {
  if (!forceRefresh) {
    const cached = readCache(
      CUSTOMER_CACHE_KEY,
      CUSTOMER_LIST_FRESH_MS,
    )

    if (cached && Array.isArray(cached.data)) {
      return cached.data
    }
  }

  if (!allCustomersRequest) {
    allCustomersRequest = apiGet(
      'getAllCustomers',
    )
      .then((customers) => {
        const normalizedCustomers = Array.isArray(
          customers,
        )
          ? customers
              .map((customer) =>
                normalizeCustomer(customer),
              )
              .filter(Boolean)
          : []

        writeCustomersCache(normalizedCustomers)

        for (const customer of normalizedCustomers) {
          writeCustomerDetailCache(customer)
        }

        return normalizedCustomers
      })
      .finally(() => {
        allCustomersRequest = null
      })
  }

  return allCustomersRequest
}

export function getCustomer(customerCode) {
  const normalizedCode =
    normalizeCustomerCode(customerCode)
  const cached = readCache(
    getCustomerDetailCacheKey(customerCode),
    CUSTOMER_DETAIL_FRESH_MS,
  )

  if (cached?.data) {
    return Promise.resolve(cached.data)
  }

  if (!customerRequests.has(normalizedCode)) {
    const request = apiGet('getCustomer', {
      customerCode,
    })
      .then((customer) => {
        const normalizedCustomer =
          normalizeCustomer(customer)

        if (normalizedCustomer) {
          cacheCustomer(normalizedCustomer)
          return normalizedCustomer
        }

        return customer
      })
      .finally(() => {
        customerRequests.delete(normalizedCode)
      })

    customerRequests.set(normalizedCode, request)
  }

  return customerRequests.get(normalizedCode)
}

export function getHistory(
  customerCode,
  period = 'all',
  forceRefresh = false,
) {
  if (!forceRefresh) {
    const cached = readCache(
      getCustomerHistoryCacheKey(customerCode, period),
      CUSTOMER_HISTORY_FRESH_MS,
    )

    if (cached && Array.isArray(cached.data)) {
      return Promise.resolve(cached.data)
    }
  }

  return apiGet('getHistory', {
    customerCode,
    period,
  }).then((history) => {
    const normalizedHistory = Array.isArray(history)
      ? history
      : []

    writeCache(
      getCustomerHistoryCacheKey(customerCode, period),
      normalizedHistory,
    )

    return normalizedHistory
  })
}

export function addTransaction(
  customerCode,
  chipChange,
) {
  return apiGet('addTransaction', {
    customerCode,
    chipChange,
  }).then((result) => {
    updateTodayActiveCustomersCacheFromTransaction(
      result,
    )

    return result
  })
}

export function checkoutCustomer(
  customerCode,
  endingAmount,
) {
  return apiGet('checkoutCustomer', {
    customerCode,
    endingAmount,
  }).then((result) => {
    removeTodayActiveCustomerFromCache(
      result.customerCode || customerCode,
    )

    return result
  })
}

export function createCustomer(
  customerName,
  initialBalance = 0,
) {
  return apiGet('createCustomer', {
    customerName,
    initialBalance,
  }).then((result) => {
    updateTodayActiveCustomersCacheFromNewCustomer(
      result,
    )

    return result
  })
}

export function getCustomerPublicProfile(customerCode) {
  return apiGet('getCustomerPublicProfile', {
    customerCode,
  })
}

export function updateCustomerProfilePublic(
  customerCode,
  profilePublic,
) {
  return apiGet('updateCustomerProfilePublic', {
    customerCode,
    profilePublic,
  }).then((result) => {
    const cachedCustomer = getCachedCustomer(
      result.customerCode || customerCode,
    )

    if (cachedCustomer) {
      cacheCustomer({
        ...cachedCustomer,
        profilePublic: Boolean(
          result.profilePublic,
        ),
      })
    }

    return result
  })
}

export function getTodayHistory(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readTodayHistoryCache(
      TODAY_HISTORY_FRESH_MS,
    )

    if (cached) {
      return Promise.resolve(cached)
    }
  }

  return apiGet('getTodayHistory').then((history) => {
    const normalizedHistory = Array.isArray(history)
      ? history
      : []

    writeTodayHistoryCache(normalizedHistory)

    return normalizedHistory
  })
}

export function getTodayActiveCustomers(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readTodayActiveCustomersCache()

    if (cached) {
      return Promise.resolve(cached)
    }
  }

  return apiGet('getTodayActiveCustomers').then((customers) => {
    const normalizedCustomers = Array.isArray(customers)
      ? customers
      : []

    writeTodayActiveCustomersCache(normalizedCustomers)

    return normalizedCustomers
  })
}
