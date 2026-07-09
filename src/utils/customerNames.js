export function displayCustomerName(name) {
  const text = String(name || '').trim()
  const withoutSuffix = text.replace(/\s*さん$/u, '')

  return withoutSuffix || text
}
