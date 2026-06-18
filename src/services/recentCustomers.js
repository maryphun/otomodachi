const RECENT_CUSTOMERS_KEY =
  'otomodachi-recent-customers'

const MAX_RECENT_CUSTOMERS = 20

export function getRecentCustomers() {
  try {
    const saved = localStorage.getItem(
      RECENT_CUSTOMERS_KEY,
    )

    if (!saved) {
      return []
    }

    const customers = JSON.parse(saved)

    if (!Array.isArray(customers)) {
      return []
    }

    return customers.slice(
      0,
      MAX_RECENT_CUSTOMERS,
    )
  } catch (error) {
    console.error(
      '最近の顧客キャッシュを読み込めませんでした',
      error,
    )

    return []
  }
}

export function recordRecentCustomer(customer) {
  if (!customer?.customerCode) {
    return
  }

  const customers = getRecentCustomers()

  const filteredCustomers = customers.filter(
    (item) =>
      String(item.customerCode) !==
      String(customer.customerCode),
  )

  const recentCustomer = {
    customerCode: String(
      customer.customerCode,
    ),

    customerName: String(
      customer.customerName || '名前未登録',
    ),

    currentBalance: Number(
      customer.currentBalance || 0,
    ),

    lastVisit: customer.lastVisit || '',

    accessedAt: new Date().toISOString(),
  }

  const updatedCustomers = [
    recentCustomer,
    ...filteredCustomers,
  ].slice(0, MAX_RECENT_CUSTOMERS)

  localStorage.setItem(
    RECENT_CUSTOMERS_KEY,
    JSON.stringify(updatedCustomers),
  )
}

export function removeRecentCustomer(
  customerCode,
) {
  const customers = getRecentCustomers()

  const updatedCustomers = customers.filter(
    (customer) =>
      String(customer.customerCode) !==
      String(customerCode),
  )

  localStorage.setItem(
    RECENT_CUSTOMERS_KEY,
    JSON.stringify(updatedCustomers),
  )
}

export function clearRecentCustomers() {
  localStorage.removeItem(
    RECENT_CUSTOMERS_KEY,
  )
}