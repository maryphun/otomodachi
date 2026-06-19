const API_URL =
  'https://script.google.com/macros/s/AKfycbyjoYPTRMj5lTuC6uPdJMXh0I_pgkCZOodOJOarGhW6caKwNbzUkqSHHurJo0dFCUdq/exec'

const CUSTOMER_CACHE_KEY = 'otomodachi-customers'
const CUSTOMER_DETAIL_CACHE_PREFIX =
  'otomodachi-customer-'
const TODAY_HISTORY_CACHE_KEY =
  'otomodachi-today-history'
const TODAY_HISTORY_CACHE_TIME_KEY =
  'otomodachi-today-history-time'
const CUSTOMER_HISTORY_CACHE_PREFIX =
  'otomodachi-history-'

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

let allCustomersRequest = null
const customerRequests = new Map()

function apiGet(action, parameters = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`

    const url = new URL(API_URL)

    url.searchParams.set('action', action)
    url.searchParams.set('callback', callbackName)

    for (const [key, value] of Object.entries(
      parameters,
    )) {
      url.searchParams.set(key, String(value))
    }

    const script = document.createElement('script')

    const cleanup = () => {
      delete window[callbackName]
      script.remove()
    }

    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(
        new Error(
          'サーバーへの接続がタイムアウトしました',
        ),
      )
    }, 15000)

    window[callbackName] = (result) => {
      window.clearTimeout(timeoutId)
      cleanup()

      if (!result.success) {
        reject(
          new Error(
            result.error ||
              'データの取得に失敗しました',
          ),
        )
        return
      }

      resolve(result.data)
    }

    script.onerror = () => {
      window.clearTimeout(timeoutId)
      cleanup()

      reject(
        new Error(
          'サーバーに接続できませんでした',
        ),
      )
    }

    script.src = url.toString()
    document.body.appendChild(script)
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
    currentBalance: Number(customer.currentBalance || 0),
    profilePublic: Boolean(customer.profilePublic),
    lastVisit: String(customer.lastVisit || ''),
    normalizedCustomerCode: normalizeCustomerCode(
      customer.customerCode,
    ).replace(/^0+/, ''),
    normalizedCustomerName: normalizeSearchText(
      customer.customerName,
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
  })
}

export function createCustomer(
  customerName,
  initialBalance = 0,
  profilePublic = false,
) {
  return apiGet('createCustomer', {
    customerName,
    initialBalance,
    profilePublic,
  })
}

export function updateCustomerProfilePublic(
  customerCode,
  profilePublic,
) {
  return apiGet('updateCustomerProfilePublic', {
    customerCode,
    profilePublic,
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
