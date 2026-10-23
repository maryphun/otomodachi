const RECENT_CUSTOMERS_KEY = 'otomodachi-recent-customers'
const MAX_RECENT_CUSTOMERS = 20

function saveRecentCustomers(ids) {
  try {
    localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(ids))
  } catch (error) {
    console.error('Could not save recent customer IDs', error)
  }
}

export function getRecentCustomers() {
  try {
    const saved = localStorage.getItem(RECENT_CUSTOMERS_KEY)
    if (!saved) return []
    const records = JSON.parse(saved)
    const ids = Array.isArray(records)
      ? [...new Set(records.map((record) => {
          const code = typeof record === 'object' ? record?.customerCode : record
          return typeof code === 'string' || typeof code === 'number' ? String(code).trim() : ''
        }).filter(Boolean))].slice(0, MAX_RECENT_CUSTOMERS)
      : []
    // Migrate old snapshots without exposing any of their customer data.
    saveRecentCustomers(ids)
    return ids
  } catch (error) {
    console.error('Could not read recent customer IDs', error)
    saveRecentCustomers([])
    return []
  }
}

export function recordRecentCustomer(customer) {
  const code = String(customer?.customerCode || '').trim()
  if (!code) return
  saveRecentCustomers([code, ...getRecentCustomers().filter((id) => id !== code)].slice(0, MAX_RECENT_CUSTOMERS))
}

export function removeRecentCustomer(customerCode) {
  saveRecentCustomers(getRecentCustomers().filter((id) => id !== String(customerCode)))
}

export function clearRecentCustomers() {
  localStorage.removeItem(RECENT_CUSTOMERS_KEY)
}
