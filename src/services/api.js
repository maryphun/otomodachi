const API_URL =
  'https://script.google.com/macros/s/AKfycbyjoYPTRMj5lTuC6uPdJMXh0I_pgkCZOodOJOarGhW6caKwNbzUkqSHHurJo0dFCUdq/exec'

const CUSTOMER_CACHE_KEY = 'otomodachi-customers'

function apiGet(action, parameters = {}) {
  return new Promise((resolve, reject) => {
    const callbackName =
      `jsonp_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`

    const url = new URL(API_URL)

    url.searchParams.set('action', action)
    url.searchParams.set('callback', callbackName)

    for (const [key, value] of Object.entries(parameters)) {
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

export async function getAllCustomers(
  forceRefresh = false,
) {
  if (!forceRefresh) {
    const cached = sessionStorage.getItem(
      CUSTOMER_CACHE_KEY,
    )

    if (cached) {
      return JSON.parse(cached)
    }
  }

  const customers = await apiGet(
    'getAllCustomers',
  )

  sessionStorage.setItem(
    CUSTOMER_CACHE_KEY,
    JSON.stringify(customers),
  )

  return customers
}

export function getCustomer(customerCode) {
  return apiGet('getCustomer', {
    customerCode,
  })
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

export function addTransaction(customerCode, chipChange) {
  return apiGet('addTransaction', {
    customerCode,
    chipChange,
  })
}

export function createCustomer(
  customerName,
  initialBalance = 0,
) {
  return apiGet('createCustomer', {
    customerName,
    initialBalance,
  })
}

export function getTodayHistory() {
  return apiGet('getTodayHistory')
}