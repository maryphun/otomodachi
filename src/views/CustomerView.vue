<script setup>

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
  clearCustomerHistoryCache,
  clearTodayHistoryCache,
  getCachedCustomer,
  getCachedHistory,
  getCustomer,
  getHistory,
  updateCustomerProfilePublic,
} from '../services/api'

import {
  recordRecentCustomer,
} from '../services/recentCustomers'


const historyChartScroll = ref(null)

const route = useRoute()
const router = useRouter()

const customer = ref(null)
const history = ref([])

const selectedAction = ref('')

const isLoading = ref(true)
const isHistoryLoading = ref(false)
const isSavingTransaction = ref(false)
const isSavingProfilePublic = ref(false)

const errorMessage = ref('')
const transactionError = ref('')
const transactionSuccess = ref('')
const profilePublicError = ref('')
const profilePublicSuccess = ref('')

const amountText = ref('')

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

const transactionAmount = computed(() => {
  return Number(amountText.value || 0)
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

  return (
    Number(customer.value.currentBalance) +
    transactionChange.value
  )
})

const chartWidth = 640
const chartHeight = 230
const chartPaddingX = 34
const chartPaddingY = 24

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

const chartAxisLabels = computed(() => {
  const points = chartPoints.value

  if (points.length === 0) {
    return []
  }

  const labels = []
  let lastDate = ''

  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    const dateText = formatChartDate(point.timestamp)

    if (dateText && dateText !== lastDate) {
      labels.push({
        ...point,
        anchor: getChartTextAnchor(point.x),
        text: dateText,
      })

      lastDate = dateText
    }
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
  const minimumGap = 92

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

function addAmountDigit(digit) {
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
  amountText.value = ''
}

function removeAmountDigit() {
  amountText.value = amountText.value.slice(0, -1)
}

function openTransaction(action) {
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

function goBack() {
  router.back()
}

function goHome() {
  router.push('/')
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ja-JP')
}

function formatSignedNumber(value) {
  const number = Number(value || 0)

  if (number > 0) {
    return `+${formatNumber(number)}`
  }

  return formatNumber(number)
}

function getBalanceBefore(transaction) {
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

async function saveProfilePublic(event) {
  if (!customer.value || isSavingProfilePublic.value) {
    return
  }

  const checkbox = event.currentTarget
  const previousValue = Boolean(
    customer.value.profilePublic,
  )
  const nextValue = Boolean(checkbox.checked)

  const confirmed = window.confirm(
    nextValue
      ? 'このおともだちのプロフィールを公開しますか？'
      : 'このおともだちのプロフィールを非公開にしますか？',
  )

  if (!confirmed) {
    checkbox.checked = previousValue
    return
  }

  isSavingProfilePublic.value = true
  profilePublicError.value = ''
  profilePublicSuccess.value = ''

  customer.value = {
    ...customer.value,
    profilePublic: nextValue,
  }

  try {
    const result =
      await updateCustomerProfilePublic(
        customerCode.value,
        nextValue,
      )

    customer.value = {
      ...customer.value,
      profilePublic: Boolean(
        result.profilePublic ?? nextValue,
      ),
    }

    recordRecentCustomer(customer.value)
    cacheCustomer(customer.value)

    profilePublicSuccess.value =
      nextValue
        ? 'プロフィールを公開しました'
        : 'プロフィールを非公開にしました'
  } catch (error) {
    console.error(error)

    customer.value = {
      ...customer.value,
      profilePublic: previousValue,
    }

    checkbox.checked = previousValue

    profilePublicError.value =
      error.message ||
      'プロフィール公開設定の保存に失敗しました'
  } finally {
    isSavingProfilePublic.value = false
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

  if (!Number.isInteger(amount) || amount <= 0) {
    transactionError.value =
      '1以上のうにょ数を入力してください'
    return
  }

  if (expectedBalance.value < 0) {
    transactionError.value =
      '現在のうにょを超えて引き出すことはできません'
    return
  }

  const actionName =
    selectedAction.value === 'deposit'
      ? '貯うにょ'
      : '引き出し'

  const change = transactionChange.value
  const oldBalance = Number(
    customer.value.currentBalance,
  )
  const newBalance = oldBalance + change
  const oldLastVisit = customer.value.lastVisit

  const confirmed = window.confirm(
    [
      `おともだち：${customer.value.customerCode} ${customer.value.customerName}さん`,
      `操作：${actionName}`,
      `増減：${formatSignedNumber(change)}`,
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

  /*
   * Optimistic update:
   * Change the displayed balance immediately.
   */
  customer.value = {
    ...customer.value,
    currentBalance: newBalance,
  }

  amountText.value = ''

  try {
    const result = await addTransaction(
      customerCode.value,
      change,
    )

    /*
     * Replace the temporary optimistic value with
     * the confirmed value returned by Apps Script.
     */
    customer.value = {
      ...customer.value,
      currentBalance: result.newBalance,
      lastVisit: result.timestamp.slice(0, 10),
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

    window.setTimeout(() => {
      transactionSuccess.value = ''
      closeAction()
    }, 650)
  } catch (error) {
    console.error(error)

    /*
     * Saving failed, so restore the previous balance.
     */
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
            {{ customer.customerName }}
            <span class="name-suffix">さん</span>
          </h2>

          <p>
            {{
              customer.lastVisit
                ? `最終来店日：${customer.lastVisit}`
                : '最終来店日の記録なし'
            }}
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

      <section class="profile-public-card">
        <div class="profile-public-header">
          <div>
            <p class="profile-public-label">
              プロフィール公開
            </p>

            <strong
              class="profile-public-status"
              :class="{
                'profile-public-status--on':
                  customer.profilePublic,
              }"
            >
              {{
                customer.profilePublic
                  ? '公開中'
                  : '非公開'
              }}
            </strong>
          </div>

          <label class="profile-public-switch">
            <input
              type="checkbox"
              class="profile-public-input"
              :checked="customer.profilePublic"
              :disabled="isSavingProfilePublic"
              @change="saveProfilePublic"
            />

            <span
              class="profile-public-control"
              aria-hidden="true"
            ></span>
          </label>
        </div>

        <p
          v-if="profilePublicSuccess"
          class="profile-public-message profile-public-message--success"
        >
          {{ profilePublicSuccess }}
        </p>

        <p
          v-if="profilePublicError"
          class="profile-public-message profile-public-message--error"
        >
          {{ profilePublicError }}
        </p>
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
            class="action-button action-button--history"
            @click="showHistory"
          >
            <span class="action-icon">履</span>

            <span class="action-copy">
              <strong>うにょ履歴を見る</strong>
            </span>
          </button>
        </div>
      </section>

      <Teleport to="body">
        <Transition name="modal">
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
                  selectedAction === 'withdrawal'
                "
                class="transaction-form"
              >
                <div class="amount-display">
                  <span>
                    {{
                      selectedAction === 'deposit'
                        ? '追加するうにょ'
                        : '引き出すうにょ'
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
                        formatNumber(
                          customer.currentBalance -
                            transactionChange,
                        )
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
                          expectedBalance < 0,
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
                  v-if="transactionError"
                  class="transaction-message transaction-message--error"
                >
                  {{ transactionError }}
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
                    'save-transaction-button--saving':
                      isSavingTransaction,
                  }"
                  :disabled="
                    isSavingTransaction ||
                    transactionAmount <= 0 ||
                    expectedBalance < 0
                  "
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
          />

          <g
            v-for="point in chartPoints"
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
          {{ transaction.timestamp }}
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
        </Transition>
      </Teleport>
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

.customer-identity p {
  margin: 9px 0 0;

  color: var(--color-muted);
  font-size: 14px;
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

.profile-public-card {
  margin-top: 16px;
  padding: 18px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  box-shadow:
    0 4px 10px rgb(15 34 53 / 4%),
    0 10px 24px rgb(15 34 53 / 4%);
}

.profile-public-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.profile-public-label {
  margin: 0 0 5px;

  color: var(--color-muted);
  font-size: 12px;
  font-weight: 750;
}

.profile-public-status {
  color: var(--color-muted);
  font-size: 18px;
}

.profile-public-status--on {
  color: #197044;
}

.profile-public-description {
  margin: 12px 0 0;

  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.7;
}

.profile-public-switch {
  position: relative;
  flex: 0 0 auto;

  display: block;

  cursor: pointer;
}

.profile-public-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.profile-public-control {
  position: relative;

  display: block;

  width: 60px;
  height: 34px;

  background: #c8cdd3;
  border-radius: 999px;

  transition: background-color 180ms ease;
}

.profile-public-control::after {
  content: '';

  position: absolute;
  top: 4px;
  left: 4px;

  width: 26px;
  height: 26px;

  background: white;
  border-radius: 50%;
  box-shadow: 0 2px 7px rgb(15 34 53 / 22%);

  transition: transform 180ms var(--ease-out);
}

.profile-public-input:checked + .profile-public-control {
  background: #2b7a4b;
}

.profile-public-input:checked +
.profile-public-control::after {
  transform: translateX(26px);
}

.profile-public-input:focus-visible +
.profile-public-control {
  outline: 3px solid rgb(23 50 77 / 24%);
  outline-offset: 3px;
}

.profile-public-input:disabled +
.profile-public-control {
  cursor: wait;
  opacity: 0.55;
}

.profile-public-message {
  margin: 12px 0 0;
  padding: 10px 12px;

  border-radius: 12px;

  font-size: 13px;
  font-weight: 750;
}

.profile-public-message--success {
  color: #17643d;
  background: #e8f7ef;
}

.profile-public-message--error {
  color: #9a3039;
  background: #fff0f1;
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

.action-button--history .action-icon {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.action-copy {
  min-width: 0;
}

.action-copy strong {
  display: block;
  font-size: 18px;
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
}

.transaction-message--error {
  color: #9a3039;
  background: #fff0f1;
}

.transaction-message--success {
  color: #17683f;
  background: #e8f7ef;
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

  .action-grid {
    grid-template-columns:
      repeat(3, minmax(0, 1fr));
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
