<script setup>

import QRCode from 'qrcode'

import {
  computed,
  nextTick,
  onMounted,
  ref,
} from 'vue'

import { useRoute, useRouter } from 'vue-router'
import {
  addTransaction,
  cacheCustomer,
  checkoutCustomer,
  clearCustomerHistoryCache,
  clearTodayHistoryCache,
  getCachedCustomer,
  getCachedHistory,
  getCustomer,
  getCustomerPublicProfile,
  getHistory,
  updateCustomerProfilePublic,
} from '../services/api'

import {
  recordRecentCustomer,
} from '../services/recentCustomers'
import {
  displayCustomerName,
} from '../utils/customerNames'


const historyChartScroll = ref(null)

const route = useRoute()
const router = useRouter()

const customer = ref(null)
const history = ref([])

const selectedAction = ref('')

const isLoading = ref(true)
const isHistoryLoading = ref(false)
const isSavingTransaction = ref(false)
const isPublicShareOpen = ref(false)
const isPublicShareLoading = ref(false)
const isPublicShareSaving = ref(false)

const errorMessage = ref('')
const transactionError = ref('')
const transactionSuccess = ref('')
const publicShareError = ref('')
const publicShareSuccess = ref('')

const amountText = ref('')
const publicProfile = ref(null)
const publicQrDataUrl = ref('')

const numberKeys = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]

const customerCode = computed(() => {
  return String(route.params.customerCode || '')
})

const publicShareUrl = computed(() => {
  const token = publicProfile.value?.publicToken

  if (!token) {
    return ''
  }

  return `${window.location.origin}/public/customer/${encodeURIComponent(token)}`
})

const hasPublicProfile = computed(() => {
  return Boolean(publicProfile.value?.profilePublic)
})

const publicProfileButtonLabel = computed(() => {
  if (
    hasPublicProfile.value ||
    customer.value?.profilePublic
  ) {
    return '発行済み'
  }

  return ''
})

const transactionAmount = computed(() => {
  return Number(amountText.value || 0)
})

const currentBalance = computed(() => {
  return numberValue(customer.value?.currentBalance)
})

const transactionChange = computed(() => {
  if (selectedAction.value === 'withdrawal') {
    return -transactionAmount.value
  }

  return transactionAmount.value
})

const expectedBalance = computed(() => {
  if (!customer.value) {
    return 0
  }

  return currentBalance.value + transactionChange.value
})

const isWithdrawalTooLarge = computed(() => {
  return (
    selectedAction.value === 'withdrawal' &&
    transactionAmount.value > 0 &&
    transactionAmount.value > currentBalance.value
  )
})

const transactionValidationMessage = computed(() => {
  if (isWithdrawalTooLarge.value) {
    return '現在のうにょを超えて引き出すことはできません'
  }

  return ''
})

const displayedTransactionError = computed(() => {
  return (
    transactionError.value ||
    transactionValidationMessage.value
  )
})

const canSaveTransaction = computed(() => {
  if (selectedAction.value === 'checkout') {
    return (
      !isSavingTransaction.value &&
      transactionAmount.value >= 0
    )
  }

  return (
    !isSavingTransaction.value &&
    transactionAmount.value > 0 &&
    !transactionValidationMessage.value
  )
})

const hasOldLastVisit = computed(() => {
  return isLastVisitOlderThanThreeMonths(
    customer.value?.lastVisit,
  )
})

const customerLedgerItems = computed(() => {
  if (!customer.value) {
    return []
  }

  const items = []

  if (hasDisplayValue(customer.value.customerReading)) {
    items.push({
      label: '読み方',
      value: customer.value.customerReading,
    })
  }

  if (hasDisplayValue(customer.value.otoPoints)) {
    items.push({
      label: 'おとぽいんと',
      value: formatNumber(customer.value.otoPoints),
    })
  }

  if (hasDisplayValue(customer.value.visitCount)) {
    items.push({
      label: '来店回数',
      value: `${formatNumber(customer.value.visitCount)}回`,
    })
  }

  if (hasDisplayValue(customer.value.firstVisit)) {
    items.push({
      label: '初回来店日',
      value: customer.value.firstVisit,
    })
  }

  if (hasDisplayValue(customer.value.memo)) {
    items.push({
      label: '備考',
      value: customer.value.memo,
      wide: true,
    })
  }

  return items
})

const chartWidth = 640
const chartHeight = 230
const chartPaddingX = 34
const chartPaddingY = 24
const chartLineOnlyThreshold = 28

const chartTransactions = computed(() => {
  return [...history.value]
    .filter((transaction) => {
      return Number.isFinite(
        Number(transaction.balanceAfter),
      )
    })
    .reverse()
})

const chartMinimumBalance = computed(() => {
  if (chartTransactions.value.length === 0) {
    return 0
  }

  return Math.min(
    0,
    ...chartTransactions.value.map((transaction) =>
      Number(transaction.balanceAfter || 0),
    ),
  )
})

const chartMaximumBalance = computed(() => {
  if (chartTransactions.value.length === 0) {
    return 1
  }

  const maximum = Math.max(
    ...chartTransactions.value.map((transaction) =>
      Number(transaction.balanceAfter || 0),
    ),
  )

  return maximum === chartMinimumBalance.value
    ? maximum + 1
    : maximum
})

const chartPoints = computed(() => {
  const transactions = chartTransactions.value

  if (transactions.length === 0) {
    return []
  }

  const usableWidth =
    chartWidth - chartPaddingX * 2

  const usableHeight =
    chartHeight - chartPaddingY * 2

  const balanceRange =
    chartMaximumBalance.value -
    chartMinimumBalance.value

  return transactions.map((transaction, index) => {
    const x =
      transactions.length === 1
        ? chartWidth / 2
        : chartPaddingX +
          (index / (transactions.length - 1)) *
            usableWidth

    const balance = Number(
      transaction.balanceAfter || 0,
    )

    const y =
      chartHeight -
      chartPaddingY -
      ((balance - chartMinimumBalance.value) /
        balanceRange) *
        usableHeight

    return {
      x,
      y,
      balance,
      timestamp: transaction.timestamp,
      transactionId: transaction.transactionId,
    }
  })
})

const chartPolylinePoints = computed(() => {
  return chartPoints.value
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
})

const isDenseChart = computed(() => {
  return chartPoints.value.length > chartLineOnlyThreshold
})

const visibleChartPoints = computed(() => {
  if (isDenseChart.value) {
    return []
  }

  return chartPoints.value
})

const chartAxisLabels = computed(() => {
  const points = chartPoints.value

  if (points.length === 0) {
    return []
  }

  const candidates = []
  const labels = []
  let lastDate = ''

  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    const dateText = formatChartDate(point.timestamp)

    if (dateText && dateText !== lastDate) {
      candidates.push({
        ...point,
        anchor: getChartTextAnchor(point.x),
        text: dateText,
      })

      lastDate = dateText
    }
  }

  const minimumGap = getChartDateLabelGap(points.length)
  let lastLabelX = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    if (candidate.x - lastLabelX < minimumGap) {
      continue
    }

    labels.push(candidate)
    lastLabelX = candidate.x
  }

  return labels
})

const chartValueLabels = computed(() => {
  const points = chartPoints.value

  if (points.length === 0) {
    return []
  }

  const labels = []
  let lastLabelX = Number.NEGATIVE_INFINITY
  const minimumGap = getChartValueLabelGap(points.length)

  for (const point of points) {
    if (point.x - lastLabelX < minimumGap) {
      continue
    }

    labels.push({
      ...point,
      anchor: getChartTextAnchor(point.x),
      labelY: getChartValueLabelY(point),
      text: formatNumber(point.balance),
    })

    lastLabelX = point.x
  }

  return labels
})

function getChartTextAnchor(x) {
  if (x <= chartPaddingX + 4) {
    return 'start'
  }

  if (x >= chartWidth - chartPaddingX - 4) {
    return 'end'
  }

  return 'middle'
}

function getChartDateLabelGap(pointCount) {
  if (pointCount > 48) {
    return 94
  }

  if (pointCount > chartLineOnlyThreshold) {
    return 78
  }

  return 54
}

function getChartValueLabelGap(pointCount) {
  if (pointCount > 48) {
    return 170
  }

  if (pointCount > chartLineOnlyThreshold) {
    return 136
  }

  return 92
}

function getChartValueLabelY(point) {
  const labelAboveY = point.y - 11

  if (labelAboveY < 11) {
    return point.y + 20
  }

  return labelAboveY
}

function formatChartDate(timestamp) {
  const value = String(timestamp || '')
  const parts = value.split(' ')
  const datePart = parts[0] || ''

  const dateParts = datePart
    .replaceAll('-', '/')
    .split('/')

  if (dateParts.length < 3) {
    return datePart
  }

  return `${Number(dateParts[1])}/${Number(dateParts[2])}`
}

async function scrollChartToNewest() {
  await nextTick()
}

function clearTransactionFeedback() {
  transactionError.value = ''
  transactionSuccess.value = ''
}

function addAmountDigit(digit) {
  clearTransactionFeedback()

  if (amountText.value.length >= 10) {
    return
  }

  if (amountText.value === '0') {
    amountText.value = digit
    return
  }

  amountText.value += digit
}

function clearAmount() {
  clearTransactionFeedback()
  amountText.value = ''
}

function removeAmountDigit() {
  clearTransactionFeedback()
  amountText.value = amountText.value.slice(0, -1)
}

function openTransaction(action) {
  if (isSavingTransaction.value) {
    return
  }

  selectedAction.value = action
  amountText.value = ''
  transactionError.value = ''
  transactionSuccess.value = ''
}

function closeAction() {
  if (isSavingTransaction.value) {
    return
  }

  selectedAction.value = ''
  amountText.value = ''
  transactionError.value = ''
  transactionSuccess.value = ''
}

async function openPublicShare() {
  if (isPublicShareSaving.value) {
    return
  }

  isPublicShareOpen.value = true
  publicShareError.value = ''
  publicShareSuccess.value = ''

  if (!publicProfile.value) {
    await loadPublicProfile()
    return
  }

  await renderPublicQr()
}

function closePublicShare() {
  if (isPublicShareSaving.value) {
    return
  }

  isPublicShareOpen.value = false
  publicShareError.value = ''
  publicShareSuccess.value = ''
}

async function loadPublicProfile() {
  isPublicShareLoading.value = true
  publicShareError.value = ''

  try {
    publicProfile.value =
      await getCustomerPublicProfile(
        customerCode.value,
      )

    if (customer.value) {
      customer.value = {
        ...customer.value,
        profilePublic: Boolean(
          publicProfile.value?.profilePublic,
        ),
      }
      cacheCustomer(customer.value)
    }

    await renderPublicQr()
  } catch (error) {
    console.error(error)
    publicShareError.value =
      error.message || '公開QRの確認に失敗しました'
  } finally {
    isPublicShareLoading.value = false
  }
}

async function enablePublicShare() {
  isPublicShareSaving.value = true
  publicShareError.value = ''
  publicShareSuccess.value = ''

  try {
    publicProfile.value =
      await updateCustomerProfilePublic(
        customerCode.value,
        true,
      )

    if (customer.value) {
      customer.value = {
        ...customer.value,
        profilePublic: true,
      }
      cacheCustomer(customer.value)
    }

    await renderPublicQr()
    publicShareSuccess.value = '個人QRコードを発行しました'
  } catch (error) {
    console.error(error)
    publicShareError.value =
      error.message || '公開QRの発行に失敗しました'
  } finally {
    isPublicShareSaving.value = false
  }
}

async function disablePublicShare() {
  const confirmed = window.confirm(
    'このおともだちの個人QRコードを停止しますか？\n今までのQRリンクは使えなくなります。',
  )

  if (!confirmed) {
    return
  }

  isPublicShareSaving.value = true
  publicShareError.value = ''
  publicShareSuccess.value = ''

  try {
    publicProfile.value =
      await updateCustomerProfilePublic(
        customerCode.value,
        false,
      )
    publicQrDataUrl.value = ''

    if (customer.value) {
      customer.value = {
        ...customer.value,
        profilePublic: false,
      }
      cacheCustomer(customer.value)
    }

    publicShareSuccess.value = '公開を停止しました'
  } catch (error) {
    console.error(error)
    publicShareError.value =
      error.message || '公開停止に失敗しました'
  } finally {
    isPublicShareSaving.value = false
  }
}

async function renderPublicQr() {
  if (!publicShareUrl.value) {
    publicQrDataUrl.value = ''
    return
  }

  publicQrDataUrl.value = await QRCode.toDataURL(
    publicShareUrl.value,
    {
      width: 260,
      margin: 1,
      color: {
        dark: '#173754',
        light: '#ffffff',
      },
    },
  )
}

async function copyPublicShareUrl() {
  if (!publicShareUrl.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(
      publicShareUrl.value,
    )
    publicShareSuccess.value = 'リンクをコピーしました'
    publicShareError.value = ''
  } catch (error) {
    console.error(error)
    publicShareError.value =
      'コピーできませんでした。リンクを長押しでコピーしてください。'
  }
}

function goBack() {
  router.back()
}

function goHome() {
  router.push('/')
}

function formatNumber(value) {
  return numberValue(value).toLocaleString('ja-JP')
}

function formatSignedNumber(value) {
  const number = numberValue(value)

  if (number > 0) {
    return `+${formatNumber(number)}`
  }

  return formatNumber(number)
}

function numberValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  const normalized = String(value || '').replace(
    /[^0-9.-]/g,
    '',
  )
  const number = Number(normalized)

  return Number.isFinite(number) ? number : 0
}

function hasDisplayValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0
  }

  return String(value || '').trim().length > 0
}

function formatLedgerDate(timestamp) {
  const text = String(timestamp || '')
  const datePart = text.split(' ')[0]

  return datePart || text
}

function parseVisitDate(value) {
  const dateText = String(value || '').trim()

  if (!dateText) {
    return null
  }

  const match = dateText.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/,
  )

  if (!match) {
    return null
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )

  return Number.isNaN(date.getTime()) ? null : date
}

function isLastVisitOlderThanThreeMonths(value) {
  const visitDate = parseVisitDate(value)

  if (!visitDate) {
    return false
  }

  const threeMonthsAgo = new Date()
  threeMonthsAgo.setHours(0, 0, 0, 0)
  threeMonthsAgo.setMonth(
    threeMonthsAgo.getMonth() - 3,
  )

  return visitDate < threeMonthsAgo
}

function getBalanceBefore(transaction) {
  const balanceBefore = Number(
    transaction.balanceBefore,
  )

  if (Number.isFinite(balanceBefore)) {
    return balanceBefore
  }

  return (
    Number(transaction.balanceAfter || 0) -
    Number(transaction.chipChange || 0)
  )
}

async function loadCustomer() {
  const cachedCustomer = getCachedCustomer(
    customerCode.value,
  )

  if (cachedCustomer) {
    customer.value = cachedCustomer
    recordRecentCustomer(cachedCustomer)
  }

  isLoading.value = !cachedCustomer
  errorMessage.value = ''

  try {
    customer.value = await getCustomer(
      customerCode.value,
    )
    cacheCustomer(customer.value)
    recordRecentCustomer(customer.value)
  } catch (error) {
    console.error(error)

    if (!cachedCustomer) {
      errorMessage.value =
        error.message ||
        'おともだち情報の取得に失敗しました'
    }
  } finally {
    isLoading.value = false
  }
}

async function showHistory() {
  selectedAction.value = 'history'
  transactionError.value = ''
  transactionSuccess.value = ''

  if (history.value.length > 0) {
    await scrollChartToNewest()
    return
  }

  const cachedHistory = getCachedHistory(
    customerCode.value,
    'all',
  )
  const hasCachedHistory = cachedHistory.length > 0

  if (hasCachedHistory) {
    history.value = cachedHistory
    await scrollChartToNewest()
  }

  isHistoryLoading.value = !hasCachedHistory

  try {
    history.value = await getHistory(
      customerCode.value,
      'all',
    )

    await scrollChartToNewest()
  } catch (error) {
    console.error(error)

    if (!hasCachedHistory) {
      transactionError.value =
        error.message ||
        '履歴の取得に失敗しました'
    }
  } finally {
    isHistoryLoading.value = false

    await scrollChartToNewest()
  }
}


async function saveTransaction() {
  transactionError.value = ''
  transactionSuccess.value = ''

  const amount = transactionAmount.value

  const isCheckout = selectedAction.value === 'checkout'

  if (
    !Number.isInteger(amount) ||
    (isCheckout ? amount < 0 : amount <= 0)
  ) {
    transactionError.value =
      isCheckout
        ? '0以上のうにょ数を入力してください'
        : '1以上のうにょ数を入力してください'
    return
  }

  if (transactionValidationMessage.value) {
    transactionError.value =
      transactionValidationMessage.value
    return
  }

  const actionName = getActionName(selectedAction.value)

  const change = transactionChange.value
  const oldBalance = currentBalance.value
  const newBalance = oldBalance + change
  const oldLastVisit = customer.value.lastVisit

  const confirmed = window.confirm(
    [
      `おともだち：${customer.value.customerCode} ${displayCustomerName(customer.value.customerName)}さん`,
      `操作：${actionName}`,
      isCheckout
        ? `退店時：${formatNumber(amount)}`
        : `増減：${formatSignedNumber(change)}`,
      `現在：${formatNumber(oldBalance)}`,
      `変更後：${formatNumber(newBalance)}`,
      '',
      'この内容で実行しますか？',
    ].join('\n'),
  )

  if (!confirmed) {
    return
  }

  isSavingTransaction.value = true
  transactionError.value = ''
  transactionSuccess.value = '保存しています…'

  try {
    const result = isCheckout
      ? await checkoutCustomer(
          customerCode.value,
          amount,
        )
      : await addTransaction(
          customerCode.value,
          change,
        )

    /*
     * Use the confirmed value returned by Apps Script.
     */
    customer.value = {
      ...customer.value,
      currentBalance: result.newBalance,
      lastVisit: result.timestamp.slice(0, 10),
      visitCount:
        result.visitCount ?? customer.value.visitCount,
    }

    recordRecentCustomer(customer.value)
    cacheCustomer(customer.value)

    /*
     * The old history is now outdated.
     * It will be loaded again next time history opens.
     */
    history.value = []
    
    clearCustomerHistoryCache(customerCode.value)
    clearTodayHistoryCache()

    transactionSuccess.value = '保存しました'
    amountText.value = ''

    window.setTimeout(() => {
      transactionSuccess.value = ''
      closeAction()
    }, 650)
  } catch (error) {
    console.error(error)

    customer.value = {
      ...customer.value,
      currentBalance: oldBalance,
      lastVisit: oldLastVisit,
    }

    transactionSuccess.value = ''

    transactionError.value =
      error.message || '保存に失敗しました'
  } finally {
    isSavingTransaction.value = false
  }
}

function getActionName(action) {
  if (action === 'deposit') {
    return '貯うにょ'
  }

  if (action === 'withdrawal') {
    return '引き出し'
  }

  if (action === 'checkout') {
    return '退店'
  }

  return 'うにょ履歴'
}

onMounted(loadCustomer)
</script>

<template>
  <main class="customer-page">
    <header class="page-header">
      <button
        type="button"
        class="back-button"
        aria-label="戻る"
        @click="goBack"
      >
        ←
      </button>

      <div class="header-copy">
        <p class="eyebrow">CUSTOMER</p>
        <h1>おともだち情報</h1>
      </div>

      <button
        type="button"
        class="home-button"
        @click="goHome"
      >
        ホーム
      </button>
    </header>

    <section
      v-if="isLoading"
      class="state-card"
    >
      おともだち情報を読み込み中...
    </section>

    <section
      v-else-if="errorMessage"
      class="error-card"
    >
      <p>{{ errorMessage }}</p>

      <button
        type="button"
        @click="loadCustomer"
      >
        再読み込み
      </button>
    </section>

    <template v-else-if="customer">
      <section class="customer-summary">
        <div class="customer-identity">
          <span class="customer-code">
            {{ customer.customerCode }}
          </span>

          <h2>
            {{ displayCustomerName(customer.customerName) }}
            <span class="name-suffix">さん</span>
          </h2>

          <p class="last-visit-text">
            {{
              customer.lastVisit
                ? `最終来店日：${customer.lastVisit}`
                : '最終来店日の記録なし'
            }}
          </p>

          <p
            v-if="hasOldLastVisit"
            class="last-visit-warning"
          >
            3ヶ月以上来店がありません
          </p>
        </div>

        <div class="balance-panel">
          <span>現在のうにょ</span>

          <strong>
            {{ formatNumber(customer.currentBalance) }}
          </strong>

          <small>うにょ</small>
        </div>
      </section>

      <section
        v-if="customerLedgerItems.length"
        class="ledger-info-card"
      >
        <div
          v-for="item in customerLedgerItems"
          :key="item.label"
          class="ledger-info-item"
          :class="{
            'ledger-info-item--wide': item.wide,
          }"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </section>

      <section class="action-section">
        <p class="section-label">操作を選択</p>

        <div class="action-grid">
          <button
            type="button"
            class="action-button action-button--deposit"
            @click="openTransaction('deposit')"
          >
            <span class="action-icon">＋</span>

            <span class="action-copy">
              <strong>貯うにょ</strong>
            </span>
          </button>

          <button
            type="button"
            class="action-button action-button--withdrawal"
            @click="openTransaction('withdrawal')"
          >
            <span class="action-icon">－</span>

            <span class="action-copy">
              <strong>引き出し</strong>
            </span>
          </button>

          <button
            type="button"
            class="action-button action-button--checkout"
            @click="openTransaction('checkout')"
          >
            <span class="action-icon">退</span>

            <span class="action-copy">
              <strong>退店</strong>
            </span>
          </button>

          <button
            type="button"
            class="action-button action-button--history"
            @click="showHistory"
          >
            <span class="action-icon">履</span>

            <span class="action-copy">
              <strong>うにょ履歴を見る</strong>
            </span>
          </button>

          <button
            type="button"
            class="action-button action-button--public"
            @click="openPublicShare"
          >
            <span class="action-icon">QR</span>

            <span class="action-copy">
              <strong>個人QRコード</strong>
              <small v-if="publicProfileButtonLabel">
                {{ publicProfileButtonLabel }}
              </small>
            </span>
          </button>
        </div>
      </section>

      <div
        v-if="selectedAction"
        class="modal-backdrop"
        @click.self="closeAction"
      >
        <section class="transaction-modal">
              <div class="selected-action-header">
                <div>
                  <p class="modal-eyebrow">
                    {{
                      selectedAction === 'history'
                        ? 'UNYO HISTORY'
                        : selectedAction === 'checkout'
                          ? 'CHECK OUT'
                          : 'UNYO TRANSACTION'
                    }}
                  </p>

                  <h3
                    v-if="selectedAction === 'deposit'"
                  >
                    貯うにょ
                  </h3>

                  <h3
                    v-else-if="
                      selectedAction === 'withdrawal'
                    "
                  >
                    引き出し
                  </h3>

                  <h3
                    v-else-if="
                      selectedAction === 'checkout'
                    "
                  >
                    退店
                  </h3>

                  <h3 v-else>
                    うにょ履歴
                  </h3>
                </div>

                <button
                  type="button"
                  class="close-button"
                  aria-label="閉じる"
                  :disabled="isSavingTransaction"
                  @click="closeAction"
                >
                  ×
                </button>
              </div>

              <div
                v-if="
                  selectedAction === 'deposit' ||
                  selectedAction === 'withdrawal' ||
                  selectedAction === 'checkout'
                "
                class="transaction-form"
              >
                <div class="amount-display">
                  <span>
                    {{
                      selectedAction === 'deposit'
                        ? '追加するうにょ'
                        : selectedAction === 'withdrawal'
                          ? '引き出すうにょ'
                          : '退店時のうにょ'
                    }}
                  </span>

                  <strong>
                    {{
                      amountText
                        ? formatNumber(amountText)
                        : '0'
                    }}
                  </strong>
                </div>

                <div class="balance-preview">
                  <div>
                    <span>現在</span>

                    <strong>
                      {{
                        formatNumber(currentBalance)
                      }}
                    </strong>
                  </div>

                  <span class="preview-arrow">
                    →
                  </span>

                  <div>
                    <span>変更後</span>

                    <strong
                      :class="{
                        'invalid-balance':
                          isWithdrawalTooLarge,
                      }"
                    >
                      {{ formatNumber(expectedBalance) }}
                    </strong>
                  </div>
                </div>

                <div class="amount-number-pad">
                  <button
                    v-for="number in numberKeys"
                    :key="number"
                    type="button"
                    class="amount-key"
                    :disabled="isSavingTransaction"
                    @click="addAmountDigit(number)"
                  >
                    {{ number }}
                  </button>

                  <button
                    type="button"
                    class="amount-key amount-key--utility"
                    :disabled="isSavingTransaction"
                    @click="clearAmount"
                  >
                    C
                  </button>

                  <button
                    type="button"
                    class="amount-key"
                    :disabled="isSavingTransaction"
                    @click="addAmountDigit('0')"
                  >
                    0
                  </button>

                  <button
                    type="button"
                    class="amount-key amount-key--utility"
                    aria-label="1文字削除"
                    :disabled="isSavingTransaction"
                    @click="removeAmountDigit"
                  >
                    ⌫
                  </button>
                </div>

                <p
                  v-if="displayedTransactionError"
                  class="transaction-message transaction-message--error"
                >
                  {{ displayedTransactionError }}
                </p>

                <p
                  v-if="transactionSuccess"
                  class="transaction-message transaction-message--success"
                >
                  {{ transactionSuccess }}
                </p>

                <button
                  type="button"
                  class="save-transaction-button"
                  :class="{
                    'save-transaction-button--withdrawal':
                      selectedAction === 'withdrawal',
                    'save-transaction-button--checkout':
                      selectedAction === 'checkout',
                    'save-transaction-button--saving':
                      isSavingTransaction,
                  }"
                  :disabled="!canSaveTransaction"
                  @click="saveTransaction"
                >
                  <span v-if="isSavingTransaction">
                    保存しています…
                  </span>

                  <span
                    v-else-if="
                      selectedAction === 'deposit'
                    "
                  >
                    ＋ 貯うにょを実行
                  </span>

                  <span
                    v-else-if="
                      selectedAction === 'checkout'
                    "
                  >
                    退店を記録
                  </span>

                  <span v-else>
                    － 引き出しを実行
                  </span>
                </button>
              </div>

<div v-else>
  <p
    v-if="isHistoryLoading"
    class="state-message"
  >
    履歴を読み込み中...
  </p>

  <p
    v-else-if="transactionError"
    class="transaction-message transaction-message--error"
  >
    {{ transactionError }}
  </p>

  <p
    v-else-if="history.length === 0"
    class="state-message"
  >
    履歴はありません
  </p>

  <template v-else>
    <section class="history-chart-card">
      <div class="history-chart-header">
        <div>
          <span>残高推移</span>

          <strong>
            {{
              formatNumber(
                customer.currentBalance,
              )
            }}
          </strong>
        </div>
      </div>

    <div ref="historyChartScroll" class="history-chart-scroll">
        <svg
          class="history-chart"
          :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
          role="img"
          aria-label="うにょ残高の推移グラフ"
        >
          <line
            :x1="chartPaddingX"
            :y1="chartPaddingY"
            :x2="chartPaddingX"
            :y2="chartHeight - chartPaddingY"
            class="chart-axis"
          />

          <line
            :x1="chartPaddingX"
            :y1="chartHeight - chartPaddingY"
            :x2="chartWidth - chartPaddingX"
            :y2="chartHeight - chartPaddingY"
            class="chart-axis"
          />

          <line
            :x1="chartPaddingX"
            :y1="chartPaddingY"
            :x2="chartWidth - chartPaddingX"
            :y2="chartPaddingY"
            class="chart-grid-line"
          />

          <line
            :x1="chartPaddingX"
            :y1="chartHeight / 2"
            :x2="chartWidth - chartPaddingX"
            :y2="chartHeight / 2"
            class="chart-grid-line"
          />

          <polyline
            v-if="chartPoints.length > 1"
            :points="chartPolylinePoints"
            class="chart-line"
            :class="{
              'chart-line--dense': isDenseChart,
            }"
          />

          <g
            v-for="point in visibleChartPoints"
            :key="point.transactionId"
            class="chart-point-group"
          >
            <circle
              :cx="point.x"
              :cy="point.y"
              r="6"
              class="chart-point"
            />

            <title>
              {{
                `${point.timestamp}・${formatNumber(
                  point.balance,
                )}うにょ`
              }}
            </title>
          </g>

          <text
            v-for="label in chartValueLabels"
            :key="`value-${label.transactionId}`"
            :x="label.x"
            :y="label.labelY"
            :text-anchor="label.anchor"
            class="chart-value-label"
          >
            {{ label.text }}
          </text>

          <text
            v-for="label in chartAxisLabels"
            :key="`time-${label.transactionId}`"
            :x="label.x"
            :y="chartHeight - 5"
            :text-anchor="label.anchor"
            class="chart-time-label"
          >
            {{
              label.text
            }}
          </text>
        </svg>
      </div>
    </section>

    <div class="history-list-heading">
      <strong>取引履歴</strong>

      <span>{{ history.length }}件</span>
    </div>

    <div class="history-list">
      <div
        v-for="transaction in history"
        :key="transaction.transactionId"
        class="history-item"
      >
        <div class="history-date">
          {{ formatLedgerDate(transaction.timestamp) }}
        </div>

        <div class="history-values">
          <div
            class="history-change"
            :class="{
              'history-change--positive':
                transaction.chipChange > 0,
              'history-change--negative':
                transaction.chipChange < 0,
            }"
          >
            {{
              formatSignedNumber(
                transaction.chipChange,
              )
            }}
          </div>

          <div class="history-balance-flow">
            <span class="history-balance-before">
              {{
                formatNumber(
                  getBalanceBefore(transaction),
                )
              }}
            </span>

            <span class="history-balance-arrow">→</span>

            <strong class="history-balance-after">
              {{
                formatNumber(
                  transaction.balanceAfter,
                )
              }}
            </strong>
          </div>
        </div>
      </div>
    </div>
  </template>
</div>

        </section>
      </div>

      <div
        v-if="isPublicShareOpen"
        class="modal-backdrop"
        @click.self="closePublicShare"
      >
        <section class="transaction-modal public-share-modal">
          <div class="selected-action-header">
            <div>
              <p class="modal-eyebrow">
                Otomodachi profile QR
              </p>
              <h3>個人QRコード</h3>
            </div>

            <button
              type="button"
              class="close-button"
              aria-label="閉じる"
              :disabled="isPublicShareSaving"
              @click="closePublicShare"
            >
              ×
            </button>
          </div>

          <div
            v-if="isPublicShareLoading"
            class="state-message"
          >
            個人QRコードを確認しています...
          </div>

          <div
            v-else
            class="public-share-body"
          >
            <div
              v-if="hasPublicProfile && publicQrDataUrl"
              class="public-qr-area"
            >
              <div class="public-qr-frame">
                <img
                  :src="publicQrDataUrl"
                  alt="個人QRコード"
                >
              </div>

              <button
                type="button"
                class="public-url-button"
                @click="copyPublicShareUrl"
              >
                {{ publicShareUrl }}
              </button>
            </div>

            <div
              v-else
              class="public-share-empty"
            >
              <strong>まだ公開されていません</strong>
              <span>
                発行すると、専用リンクとQRコードが作成され、そこからうにょデータを確認できるようになります。
              </span>
              <span class="public-share-consent">
                発行前に、うにょデータが外部閲覧可能になる可能性があることをお客様へ説明し、同意を得てもらいましょう
              </span>
            </div>

            <p
              v-if="publicShareError"
              class="transaction-message transaction-message--error"
            >
              {{ publicShareError }}
            </p>

            <p
              v-if="publicShareSuccess"
              class="transaction-message transaction-message--success"
            >
              {{ publicShareSuccess }}
            </p>

            <div class="public-share-actions">
              <button
                v-if="!hasPublicProfile"
                type="button"
                class="save-transaction-button public-share-primary"
                :disabled="isPublicShareSaving"
                @click="enablePublicShare"
              >
                個人QRコードを発行
              </button>

              <template v-else>
                <button
                  type="button"
                  class="save-transaction-button public-share-primary"
                  :disabled="isPublicShareSaving"
                  @click="copyPublicShareUrl"
                >
                  リンクをコピー
                </button>

                <button
                  type="button"
                  class="public-share-danger"
                  :disabled="isPublicShareSaving"
                  @click="disablePublicShare"
                >
                  公開を停止
                </button>
              </template>
            </div>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.customer-page {
  width: min(100%, 960px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 20px 16px 50px;
}

.page-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.back-button,
.home-button,
.close-button {
  border: 0;
  cursor: pointer;
}

.back-button {
  display: grid;
  place-items: center;

  width: 48px;
  height: 48px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 50%;

  font-size: 22px;
  font-weight: 800;

  transition:
    transform 180ms var(--ease-out),
    background-color 180ms ease;
}

.back-button:hover {
  transform: translateX(-3px);
}

.back-button:active {
  transform: scale(0.92);
}

.header-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 4px;

  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

h1 {
  margin: 0;
  font-size: clamp(25px, 6vw, 38px);
}

.home-button {
  min-height: 42px;
  padding: 8px 14px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-weight: 750;
}

.customer-summary {
  display: grid;
  gap: 16px;
  padding: 22px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 26px;

  box-shadow: var(--shadow-card);
}

.customer-code {
  display: inline-flex;
  padding: 6px 11px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 13px;
  font-weight: 850;
}

.customer-identity h2 {
  margin: 13px 0 0;

  font-size: clamp(28px, 7vw, 42px);
  line-height: 1.25;
}

.name-suffix {
  margin-left: 3px;

  color: var(--color-muted);
  font-size: 0.52em;
  font-weight: 700;
}

.customer-identity .last-visit-text {
  margin: 9px 0 0;

  color: var(--color-muted);
  font-size: 14px;
}

.last-visit-warning {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin: 10px 0 0;
  padding: 7px 10px;

  color: #a62c36;
  background: #fff0f1;
  border: 1px solid rgb(166 44 54 / 24%);
  border-radius: 999px;

  font-size: 13px;
  font-weight: 850;
}

.balance-panel {
  padding: 18px;

  color: white;
  background: var(--color-primary);
  border-radius: 21px;

  box-shadow: 0 12px 30px rgb(15 34 53 / 18%);
}

.balance-panel span,
.balance-panel small {
  display: block;
}

.balance-panel span {
  color: rgb(255 255 255 / 75%);
  font-size: 13px;
  font-weight: 700;
}

.balance-panel strong {
  display: inline-block;
  margin-top: 5px;

  font-size: clamp(38px, 11vw, 58px);
  line-height: 1.1;
}

.balance-panel small {
  margin-top: 4px;

  color: rgb(255 255 255 / 75%);
  font-size: 13px;
}

.ledger-info-card {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-top: 16px;
  padding: 18px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  box-shadow:
    0 4px 10px rgb(15 34 53 / 4%),
    0 10px 24px rgb(15 34 53 / 4%);
}

.ledger-info-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;

  min-height: 38px;
  padding: 10px 12px;

  background: #f8fafc;
  border: 1px solid rgb(23 50 77 / 7%);
  border-radius: 14px;
}

.ledger-info-item span {
  flex: 0 0 auto;

  color: var(--color-muted);
  font-size: 12px;
  font-weight: 750;
}

.ledger-info-item strong {
  min-width: 0;

  font-size: 14px;
  text-align: right;
  overflow-wrap: anywhere;
}

.ledger-info-item--wide {
  display: grid;
  gap: 5px;
}

.ledger-info-item--wide strong {
  text-align: left;
  line-height: 1.6;
}

.action-section {
  margin-top: 24px;
}

.section-label {
  margin: 0 0 12px;

  color: var(--color-muted);
  font-size: 13px;
  font-weight: 750;
}

.action-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 13px;
}

.action-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;

  width: 100%;
  min-height: 92px;
  padding: 17px 18px;

  color: var(--color-text);
  text-align: left;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  box-shadow:
    0 4px 10px rgb(15 34 53 / 5%),
    0 10px 24px rgb(15 34 53 / 5%);

  cursor: pointer;

  transition:
    transform 200ms var(--ease-out),
    box-shadow 200ms var(--ease-out),
    border-color 180ms ease;
}

.action-button:hover {
  border-color: rgb(23 50 77 / 24%);

  box-shadow:
    0 7px 16px rgb(15 34 53 / 8%),
    0 18px 34px rgb(15 34 53 / 8%);

  transform: translateY(-3px);
}

.action-button:active {
  transform: scale(0.975);
  transition-duration: 90ms;
}

.action-icon {
  display: grid;
  place-items: center;

  width: 52px;
  height: 52px;

  border-radius: 17px;

  font-size: 22px;
  font-weight: 900;
}

.action-button--deposit .action-icon {
  color: #197044;
  background: #e8f7ef;
}

.action-button--withdrawal .action-icon {
  color: #a62c36;
  background: #fff0f1;
}

.action-button--checkout .action-icon {
  color: #7a4d00;
  background: #fff5d8;
}

.action-button--history .action-icon {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.action-button--public .action-icon {
  color: #7a4d00;
  background: #fff5d8;
  font-size: 16px;
}

.action-copy {
  min-width: 0;
}

.action-copy strong {
  display: block;
  font-size: 18px;
}

.action-copy small {
  display: block;
  margin-top: 4px;

  color: var(--color-muted);
  font-size: 12px;
  font-weight: 750;
}

.modal-backdrop {
 position: fixed;
 z-index: 1000;
 inset: 0;

 display: flex;
 align-items: center;
 justify-content: center;

 width: 100%;
 height: 100dvh;
 padding: 16px;

 overflow: hidden;
 overscroll-behavior: none;

 background: rgb(10 24 38 / 58%);
 backdrop-filter: blur(6px);
}

 .transaction-modal {
 width: min(100%, 520px);
 max-width: 100%;
 max-height: calc(100dvh - 32px);
 padding: 22px;

 overflow-x: hidden;
 overflow-y: auto;

 overscroll-behavior: contain;
 -webkit-overflow-scrolling: touch;

 background: var(--color-surface);
 border-radius: 28px;
}

.public-share-modal {
  width: min(100%, 480px);
}

.public-share-body {
  display: grid;
  gap: 14px;
}

.public-share-note {
  margin: 0;

  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.7;
}

.public-qr-area {
  display: grid;
  gap: 12px;
  justify-items: center;
}

.public-qr-frame {
  padding: 14px;

  background: white;
  border: 1px solid rgb(23 50 77 / 10%);
  border-radius: 22px;

  box-shadow:
    0 5px 13px rgb(15 34 53 / 7%),
    0 14px 30px rgb(15 34 53 / 7%);
}

.public-qr-frame img {
  display: block;

  width: min(58vw, 260px);
  height: auto;
}

.public-url-button {
  width: 100%;
  padding: 12px 14px;

  color: var(--color-primary);
  text-align: left;
  overflow-wrap: anywhere;

  background: var(--color-primary-soft);
  border: 1px solid rgb(23 50 77 / 10%);
  border-radius: 14px;

  font-size: 12px;
  font-weight: 750;
}

.public-share-empty {
  display: grid;
  gap: 8px;
  padding: 20px;

  background: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 18px;

  text-align: center;
}

.public-share-empty strong {
  font-size: 18px;
}

.public-share-empty span {
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.7;
}

.public-share-empty .public-share-consent {
  color: #9a3039;
  font-weight: 850;
}

.public-share-actions {
  display: grid;
  gap: 10px;
}

.public-share-primary {
  background: var(--color-primary);
  box-shadow: 0 10px 24px rgb(23 55 84 / 18%);
}

.public-share-danger {
  min-height: 52px;
  padding: 12px 18px;

  color: #a62c36;
  background: #fff0f1;
  border: 1px solid rgb(166 44 54 / 14%);
  border-radius: 16px;

  font-size: 16px;
  font-weight: 850;
}

.public-share-danger:disabled {
  cursor: wait;
  opacity: 0.5;
}


.modal-eyebrow {
  margin: 0 0 5px;

  color: var(--color-primary);
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.13em;
}

.selected-action-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  margin-bottom: 18px;
}

.selected-action-header h3 {
  margin: 0;
  font-size: 24px;
}

.close-button {
  display: grid;
  flex: 0 0 auto;
  place-items: center;

  width: 42px;
  height: 42px;

  color: var(--color-muted);
  background: #eef2f5;
  border-radius: 50%;

  font-size: 24px;

  transition:
    transform 150ms var(--ease-out),
    background-color 150ms ease;
}

.close-button:hover:not(:disabled) {
  background: #e2e8ed;
  transform: rotate(5deg);
}

.close-button:active:not(:disabled) {
  transform: scale(0.92);
}

.close-button:disabled {
  cursor: wait;
  opacity: 0.5;
}

.transaction-form {
  display: grid;
  gap: 16px;
}

.amount-display {
  padding: 18px;

  background: var(--color-primary-soft);
  border-radius: 20px;
}

.amount-display span {
  display: block;

  color: var(--color-muted);
  font-size: 13px;
  font-weight: 750;
}

.amount-display strong {
  display: block;
  margin-top: 8px;

  color: var(--color-primary);
  font-size: clamp(40px, 12vw, 58px);
  line-height: 1;
  text-align: right;
}

.balance-preview {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;

  padding: 14px;

  background: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 17px;
}

.balance-preview div:last-child {
  text-align: right;
}

.balance-preview div > span {
  display: block;

  color: var(--color-muted);
  font-size: 11px;
}

.balance-preview strong {
  display: block;
  margin-top: 3px;

  font-size: 19px;
}

.preview-arrow {
  color: var(--color-muted);
}

.invalid-balance {
  color: #a62c36;
}

.amount-number-pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 11px;
}

.amount-key {
  min-height: 64px;

  color: var(--color-text);
  background: linear-gradient(
    180deg,
    #ffffff,
    #f5f8fa
  );

  border: 1px solid rgb(23 50 77 / 12%);
  border-radius: 18px;

  font-size: 23px;
  font-weight: 850;

  box-shadow:
    0 3px 7px rgb(15 34 53 / 6%),
    0 7px 16px rgb(15 34 53 / 5%);

  transition:
    transform 120ms var(--ease-out),
    box-shadow 160ms var(--ease-out);
}

.amount-key:hover:not(:disabled) {
  transform: translateY(-2px);

  box-shadow:
    0 5px 12px rgb(15 34 53 / 9%),
    0 11px 22px rgb(15 34 53 / 7%);
}

.amount-key:active:not(:disabled) {
  transform: translateY(2px) scale(0.96);
}

.amount-key:disabled {
  cursor: wait;
  opacity: 0.55;
}

.amount-key--utility {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.save-transaction-button {
  min-height: 58px;
  padding: 13px 18px;

  color: white;
  background: #197044;
  border: 0;
  border-radius: 18px;

  font-size: 17px;
  font-weight: 850;

  box-shadow: 0 10px 24px rgb(25 112 68 / 20%);

  transition:
    transform 180ms var(--ease-out),
    opacity 180ms ease;
}

.save-transaction-button--withdrawal {
  background: #a62c36;
  box-shadow: 0 10px 24px rgb(166 44 54 / 20%);
}

.save-transaction-button--checkout {
  background: #a56516;
  box-shadow: 0 10px 24px rgb(165 101 22 / 20%);
}

.save-transaction-button:hover:not(:disabled) {
  transform: translateY(-2px);
}

.save-transaction-button:active:not(:disabled) {
  transform: scale(0.98);
}

.save-transaction-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.save-transaction-button--saving:disabled {
  cursor: wait;
  opacity: 0.75;
}

.save-transaction-button--saving::after {
  content: '';

  display: inline-block;

  width: 15px;
  height: 15px;
  margin-left: 10px;

  vertical-align: -2px;

  border: 2px solid rgb(255 255 255 / 40%);
  border-top-color: white;
  border-radius: 50%;

  animation: saving-spin 700ms linear infinite;
}

@keyframes saving-spin {
  to {
    transform: rotate(360deg);
  }
}

.transaction-message {
  margin: 0;
  padding: 12px 14px;

  border-radius: 13px;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.55;
  white-space: pre-line;
}

.transaction-message--error {
  color: #9a3039;
  background: #fff0f1;
}

.transaction-message--success {
  color: #17683f;
  background: #e8f7ef;
}

@media (min-width: 561px) and (max-width: 1100px) and (max-height: 900px) {
  .transaction-modal {
    padding: 18px;
  }

  .selected-action-header {
    margin-bottom: 14px;
  }

  .transaction-form {
    gap: 12px;
  }

  .amount-display {
    padding: 15px;
  }

  .amount-display strong {
    margin-top: 5px;
    font-size: clamp(36px, 7vw, 52px);
  }

  .balance-preview {
    padding: 11px 13px;
  }

  .amount-number-pad {
    gap: 8px;
  }

  .amount-key {
    min-height: 54px;
    border-radius: 16px;
    font-size: 21px;
  }

  .save-transaction-button {
    min-height: 52px;
    padding-block: 11px;
  }
}

.history-list {
  display: grid;
  gap: 10px;

  max-height: 60vh;
  overflow-y: auto;
}

.history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;

  padding: 14px;

  background: #fafbfd;
  border: 1px solid var(--color-border);
  border-radius: 16px;
}

.history-date {
  color: var(--color-muted);
  font-size: 12px;
}

.history-change {
  min-width: 88px;

  font-size: 17px;
  font-weight: 850;
  text-align: right;
}

.history-change--positive {
  color: #197044;
}

.history-change--negative {
  color: #a62c36;
}

.history-values {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 18px;

  min-width: 245px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.history-balance-flow {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;

  color: var(--color-muted);
  font-size: 14px;
  font-weight: 750;
  white-space: nowrap;
}

.history-balance-before {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 750;
}

.history-balance-arrow {
  color: var(--color-muted);
  font-size: 12px;
  opacity: 0.72;
}

.history-balance-after {
  color: var(--color-text);
  font-size: 16px;
  font-weight: 850;
}

@media (max-width: 460px) {
  .history-item {
    grid-template-columns: 1fr;
  }

  .history-values {
    justify-content: space-between;

    min-width: 0;
    width: 100%;
  }

  .history-change {
    min-width: 0;
    text-align: left;
  }
}

.state-card,
.error-card {
  padding: 28px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  text-align: center;
}

.error-card {
  color: #9f3038;
  background: #fff1f2;
}

.error-card p {
  margin: 0 0 14px;
}

.error-card button {
  min-height: 42px;
  padding: 8px 14px;

  color: white;
  background: #9f3038;
  border: 0;
  border-radius: 11px;

  font-weight: 750;
}

.state-message {
  padding: 28px 14px;

  color: var(--color-muted);
  text-align: center;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 240ms ease;
}

.modal-enter-active .transaction-modal,
.modal-leave-active .transaction-modal {
  transition:
    transform 300ms var(--ease-spring),
    opacity 240ms ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .transaction-modal {
  opacity: 0;
  transform: translateY(28px) scale(0.94);
}

.modal-leave-to .transaction-modal {
  opacity: 0;
  transform: translateY(18px) scale(0.96);
}

.history-chart-card {
  margin-bottom: 20px;
  padding: 16px;

  background: linear-gradient(
    180deg,
    #f8fbfd,
    #ffffff
  );

  border: 1px solid var(--color-border);
  border-radius: 20px;
}

.history-chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;

  margin-bottom: 12px;
}

.history-chart-header span,
.history-chart-header strong {
  display: block;
}

.history-chart-header span {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 750;
}

.history-chart-header strong {
  margin-top: 3px;

  color: var(--color-primary);
  font-size: 24px;
}

.history-chart-header small {
  padding: 6px 10px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 11px;
  font-weight: 800;
}

.history-chart-scroll {
  width: 100%;
  max-width: 100%;

  overflow: hidden;

  overscroll-behavior: none;

  touch-action: auto;
}

.history-chart {
  display: block;

  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: auto;
}

.chart-axis {
  stroke: rgb(23 50 77 / 26%);
  stroke-width: 1.5;
}

.chart-grid-line {
  stroke: rgb(23 50 77 / 9%);
  stroke-width: 1;
  stroke-dasharray: 5 6;
}

.chart-line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chart-line--dense {
  stroke-width: 3;
}

.chart-point {
  fill: white;
  stroke: var(--color-primary);
  stroke-width: 4;

  transition:
    r 150ms var(--ease-out),
    fill 150ms ease;
}

.chart-point-group:hover .chart-point {
  r: 9;
  fill: var(--color-primary-soft);
}

.chart-label {
  fill: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
}

.chart-value-label {
  fill: var(--color-primary-dark);
  font-size: 10px;
  font-weight: 850;
  paint-order: stroke;
  stroke: white;
  stroke-linejoin: round;
  stroke-width: 4px;
}

.chart-time-label {
  fill: var(--color-muted);
  font-size: 9px;
  font-weight: 700;
}

.history-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin: 0 2px 10px;
}

.history-list-heading strong {
  font-size: 15px;
}

.history-list-heading span {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 750;
}

@media (min-width: 700px) {
  .customer-page {
    padding: 34px 28px 60px;
  }

  .customer-summary {
    grid-template-columns:
      minmax(0, 1fr)
      minmax(260px, 0.7fr);

    align-items: stretch;
    padding: 26px;
  }

  .balance-panel {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .ledger-info-card {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .ledger-info-item--wide {
    grid-column: 1 / -1;
  }

  .action-grid {
    grid-template-columns:
      repeat(4, minmax(0, 1fr));
  }

  .action-button {
    grid-template-columns: 1fr;
    justify-items: start;

    min-height: 150px;
  }
}

@media (max-width: 560px) {
.modal-backdrop {
    align-items: flex-end;
    padding: 0;
    }

    .transaction-modal {
        width: 100%;
        max-height: 92dvh;

        border-radius: 26px 26px 0 0;
    }
}

@media (hover: none) {
  .action-button:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .transaction-modal,
  .modal-leave-active .transaction-modal {
    transition-duration: 1ms;
  }

  .save-transaction-button--saving::after {
    animation-duration: 1ms;
  }
}
</style>
