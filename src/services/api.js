const API_URL =
  'https://script.google.com/macros/s/AKfycbyjoYPTRMj5lTuC6uPdJMXh0I_pgkCZOodOJOarGhW6caKwNbzUkqSHHurJo0dFCUdq/exec'

const CUSTOMER_CACHE_KEY = 'otomodachi-customers'
const CUSTOMER_DETAIL_CACHE_PREFIX =
  'otomodachi-customer-'
const TODAY_HISTORY_CACHE_KEY =
  'otomodachi-today-history'
const TODAY_HISTORY_CACHE_TIME_KEY =
  'otomodachi-today-history-time'

const CUSTOMER_LIST_FRESH_MS = 5 * 60 * 1000
const CUSTOMER_LIST_STALE_MS = 24 * 60 * 60 * 1000
const CUSTOMER_DETAIL_STALE_MS = 60 * 60 * 1000

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

function readCache(key, maxAgeMs = Number.POSITIVE_INFINITY) {
  const rawValue =
    getStoredValue(sessionStorage, key) ||
    getStoredValue(localStorage, key)

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

function normalizeCustomerCode(value) {
  return String(value || '').trim()
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
  }
}

function writeCustomersCache(customers, savedAt = Date.now()) {
  writeCache(CUSTOMER_CACHE_KEY, customers, savedAt)
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

  writeCustomersCache(customers, cached.savedAt)
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

export function cacheCustomer(customer) {
  const normalizedCustomer = normalizeCustomer(customer)

  if (!normalizedCustomer) {
    return
  }

  writeCache(
    getCustomerDetailCacheKey(
      normalizedCustomer.customerCode,
    ),
    normalizedCustomer,
  )

  updateCustomerListCache(normalizedCustomer)
}

export function clearTodayHistoryCache() {
  removeCache(TODAY_HISTORY_CACHE_KEY)
  removeCache(TODAY_HISTORY_CACHE_TIME_KEY)
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
          writeCache(
            getCustomerDetailCacheKey(
              customer.customerCode,
            ),
            customer,
          )
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
) {
  return apiGet('getHistory', {
    customerCode,
    period,
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

export function getTodayHistory() {
  return apiGet('getTodayHistory')
}
