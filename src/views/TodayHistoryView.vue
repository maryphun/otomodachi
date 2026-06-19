```vue
<script setup>
import {
  computed,
  onMounted,
  ref,
} from 'vue'
import { useRouter } from 'vue-router'

import {
  getTodayHistory,
} from '../services/api'

const router = useRouter()

const CACHE_KEY =
  'otomodachi-today-history'

const CACHE_TIME_KEY =
  'otomodachi-today-history-time'

const HISTORY_FRESH_MS = 5 * 60 * 1000

const transactions = ref([])
const isLoading = ref(true)
const isRefreshing = ref(false)
const errorMessage = ref('')
const lastUpdated = ref('')

const totalDeposit = computed(() => {
  return transactions.value
    .filter(
      (transaction) =>
        Number(transaction.chipChange) > 0,
    )
    .reduce(
      (total, transaction) =>
        total +
        Number(transaction.chipChange || 0),
      0,
    )
})

const totalWithdrawal = computed(() => {
  return Math.abs(
    transactions.value
      .filter(
        (transaction) =>
          Number(transaction.chipChange) < 0,
      )
      .reduce(
        (total, transaction) =>
          total +
          Number(transaction.chipChange || 0),
        0,
      ),
  )
})

const netChange = computed(() => {
  return transactions.value.reduce(
    (total, transaction) =>
      total +
      Number(transaction.chipChange || 0),
    0,
  )
})

function goBack() {
  router.back()
}

function goHome() {
  router.push('/')
}

function openCustomer(customerCode) {
  router.push(`/customer/${customerCode}`)
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(
    'ja-JP',
  )
}

function formatSignedNumber(value) {
  const number = Number(value || 0)

  if (number > 0) {
    return `+${formatNumber(number)}`
  }

  return formatNumber(number)
}

function formatTime(timestamp) {
  if (!timestamp) {
    return ''
  }

  const text = String(timestamp)

  const parts = text.split(' ')

  if (parts.length < 2) {
    return text
  }

  return parts[1].slice(0, 5)
}

function formatLastUpdated(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
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

function getCachedValue(key) {
  return (
    sessionStorage.getItem(key) ||
    localStorage.getItem(key)
  )
}

function setCachedValue(key, value) {
  sessionStorage.setItem(key, value)
  localStorage.setItem(key, value)
}

function loadCachedHistory() {
  try {
    const cached = getCachedValue(CACHE_KEY)

    const cachedTime = getCachedValue(
      CACHE_TIME_KEY,
    )

    if (!cached) {
      return false
    }

    if (
      cachedTime &&
      !isTodayInTokyo(cachedTime)
    ) {
      return false
    }

    const parsed = JSON.parse(cached)

    if (!Array.isArray(parsed)) {
      return false
    }

    transactions.value = parsed
    lastUpdated.value = cachedTime || ''
    isLoading.value = false

    return true
  } catch (error) {
    console.error(
      '履歴キャッシュの読み込みに失敗しました',
      error,
    )

    return false
  }
}

function saveHistoryCache(data) {
  const now = new Date().toISOString()

  setCachedValue(
    CACHE_KEY,
    JSON.stringify(data),
  )

  setCachedValue(
    CACHE_TIME_KEY,
    now,
  )

  lastUpdated.value = now
}

async function loadHistory(
  showMainLoading = true,
  forceRefresh = false,
) {
  if (showMainLoading) {
    isLoading.value = true
  } else {
    isRefreshing.value = true
  }

  errorMessage.value = ''

  try {
    const result = await getTodayHistory(
      forceRefresh,
    )

    transactions.value = Array.isArray(result)
      ? result
      : []

    saveHistoryCache(transactions.value)
  } catch (error) {
    console.error(error)

    /*
     * キャッシュがある場合は、
     * 古い表示を残したままにします。
     */
    if (transactions.value.length === 0) {
      errorMessage.value =
        error.message ||
        '本日の履歴を取得できませんでした'
    }
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

function isCachedHistoryFresh() {
  if (!lastUpdated.value) {
    return false
  }

  const date = new Date(lastUpdated.value)

  if (Number.isNaN(date.getTime())) {
    return false
  }

  return (
    isTodayInTokyo(lastUpdated.value) &&
    Date.now() - date.getTime() < HISTORY_FRESH_MS
  )
}

function refreshHistory() {
  loadHistory(false, true)
}

onMounted(() => {
  const hasCache = loadCachedHistory()

  if (!hasCache) {
    loadHistory(true, true)
    return
  }

  isLoading.value = false

  if (!isCachedHistoryFresh()) {
    loadHistory(false, true)
  }
})
</script>

<template>
  <main class="today-history-page">
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
        <p class="eyebrow">
          TODAY HISTORY
        </p>

        <h1>本日の増減履歴</h1>
      </div>

      <button
        type="button"
        class="home-button"
        @click="goHome"
      >
        ホーム
      </button>
    </header>

    <section class="summary-grid">
      <article class="summary-card">
        <span class="summary-icon summary-icon--deposit">
          ＋
        </span>

        <div>
          <small>本日の貯うにょ</small>

          <strong class="positive-value">
            +{{ formatNumber(totalDeposit) }}
          </strong>
        </div>
      </article>

      <article class="summary-card">
        <span class="summary-icon summary-icon--withdrawal">
          －
        </span>

        <div>
          <small>本日の引き出し</small>

          <strong class="negative-value">
            -{{ formatNumber(totalWithdrawal) }}
          </strong>
        </div>
      </article>

      <article class="summary-card summary-card--wide">
        <span class="summary-icon summary-icon--total">
          計
        </span>

        <div>
          <small>本日の合計増減</small>

          <strong
            :class="{
              'positive-value':
                netChange > 0,
              'negative-value':
                netChange < 0,
            }"
          >
            {{ formatSignedNumber(netChange) }}
          </strong>
        </div>

        <span class="transaction-count">
          {{ transactions.length }}件
        </span>
      </article>
    </section>

    <section class="history-section">
      <div class="history-heading">
        <div>
          <h2>取引一覧</h2>

          <p v-if="lastUpdated">
            最終更新：
            {{ formatLastUpdated(lastUpdated) }}
          </p>
        </div>

        <button
          type="button"
          class="refresh-button"
          :class="{
            'refresh-button--loading':
              isRefreshing,
          }"
          :disabled="isRefreshing"
          @click="refreshHistory"
        >
          <span class="refresh-icon">
            ↻
          </span>

          <span>
            {{
              isRefreshing
                ? '更新中'
                : '更新'
            }}
          </span>
        </button>
      </div>

      <div
        v-if="isLoading"
        class="state-card"
      >
        <span class="loading-spinner" />

        <p>
          本日の履歴を読み込み中...
        </p>
      </div>

      <div
        v-else-if="errorMessage"
        class="error-card"
      >
        <p>{{ errorMessage }}</p>

        <button
          type="button"
          @click="loadHistory(true, true)"
        >
          再読み込み
        </button>
      </div>

      <div
        v-else-if="transactions.length === 0"
        class="empty-card"
      >
        <span class="empty-icon">
          履
        </span>

        <h2>
          本日の履歴はありません
        </h2>

        <p>
          貯うにょまたは引き出しを行うと、
          ここに表示されます。
        </p>
      </div>

      <TransitionGroup
        v-else
        appear
        name="history"
        tag="div"
        class="transaction-list"
      >
        <button
          v-for="(transaction, index) in transactions"
          :key="transaction.transactionId"
          type="button"
          class="transaction-card"
          :style="{
            '--delay': `${Math.min(index, 10) * 45}ms`,
          }"
          @click="
            openCustomer(
              transaction.customerCode,
            )
          "
        >
          <span
            class="change-icon"
            :class="{
              'change-icon--positive':
                transaction.chipChange > 0,
              'change-icon--negative':
                transaction.chipChange < 0,
            }"
          >
            {{
              transaction.chipChange > 0
                ? '＋'
                : '－'
            }}
          </span>

          <span class="transaction-info">
            <strong class="customer-name">
              {{ transaction.customerName }}
              <span class="name-suffix">さん</span>
            </strong>

            <span class="transaction-meta">
              {{ formatTime(transaction.timestamp) }}
              ・
              おともだちコード
              {{ transaction.customerCode }}
            </span>
          </span>

          <span class="transaction-values">
            <strong
              :class="{
                'positive-value':
                  transaction.chipChange > 0,
                'negative-value':
                  transaction.chipChange < 0,
              }"
            >
              {{
                formatSignedNumber(
                  transaction.chipChange,
                )
              }}
            </strong>

            <small>
              変更後
              {{
                formatNumber(
                  transaction.balanceAfter,
                )
              }}
            </small>
          </span>
        </button>
      </TransitionGroup>
    </section>
  </main>
</template>

<style scoped>
.today-history-page {
  width: min(100%, 860px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 20px 16px 50px;
}

.page-header {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr)
    auto;

  align-items: center;
  gap: 14px;

  margin-bottom: 24px;
}

.back-button,
.home-button,
.refresh-button {
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

  transition: transform 180ms var(--ease-out);
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

  font-size: clamp(
    25px,
    6vw,
    38px
  );
}

.home-button {
  min-height: 42px;
  padding: 8px 14px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-weight: 750;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.summary-card {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr);

  align-items: center;
  gap: 14px;

  padding: 17px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  box-shadow: var(--shadow-card);
}

.summary-card--wide {
  grid-template-columns:
    auto
    minmax(0, 1fr)
    auto;
}

.summary-icon {
  display: grid;
  place-items: center;

  width: 50px;
  height: 50px;

  border-radius: 16px;

  font-size: 19px;
  font-weight: 900;
}

.summary-icon--deposit {
  color: #197044;
  background: #e8f7ef;
}

.summary-icon--withdrawal {
  color: #a62c36;
  background: #fff0f1;
}

.summary-icon--total {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.summary-card small,
.summary-card strong {
  display: block;
}

.summary-card small {
  color: var(--color-muted);
  font-size: 11px;
}

.summary-card strong {
  margin-top: 4px;
  font-size: 22px;
}

.positive-value {
  color: #197044;
}

.negative-value {
  color: #a62c36;
}

.transaction-count {
  display: grid;
  place-items: center;

  min-width: 56px;
  height: 36px;
  padding: 0 11px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 12px;
  font-weight: 850;
}

.history-section {
  margin-top: 24px;
}

.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;

  margin-bottom: 13px;
}

.history-heading h2,
.history-heading p {
  margin: 0;
}

.history-heading h2 {
  font-size: 19px;
}

.history-heading p {
  margin-top: 4px;

  color: var(--color-muted);
  font-size: 11px;
}

.refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;

  min-height: 42px;
  padding: 8px 14px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 13px;
  font-weight: 800;
}

.refresh-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.refresh-icon {
  display: inline-block;
  font-size: 18px;
}

.refresh-button--loading .refresh-icon {
  animation: refresh-spin 700ms linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.transaction-list {
  position: relative;

  display: grid;
  gap: 11px;
}

.transaction-card {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr)
    auto;

  align-items: center;
  gap: 14px;

  width: 100%;
  min-height: 94px;
  padding: 15px 17px;

  color: var(--color-text);
  text-align: left;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  box-shadow:
    0 4px 10px rgb(15 34 53 / 4%),
    0 10px 24px rgb(15 34 53 / 5%);

  cursor: pointer;

  transition:
    transform 200ms var(--ease-out),
    box-shadow 200ms var(--ease-out),
    border-color 180ms ease;
}

.transaction-card:hover {
  border-color: rgb(23 50 77 / 24%);

  box-shadow:
    0 7px 16px rgb(15 34 53 / 8%),
    0 18px 34px rgb(15 34 53 / 8%);

  transform: translateY(-3px);
}

.transaction-card:active {
  transform: scale(0.98);
}

.change-icon {
  display: grid;
  place-items: center;

  width: 50px;
  height: 50px;

  border-radius: 17px;

  font-size: 21px;
  font-weight: 900;
}

.change-icon--positive {
  color: #197044;
  background: #e8f7ef;
}

.change-icon--negative {
  color: #a62c36;
  background: #fff0f1;
}

.transaction-info {
  min-width: 0;
}

.customer-name,
.transaction-meta {
  display: block;
}

.customer-name {
  overflow: hidden;

  font-size: 17px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-suffix {
  margin-left: 2px;

  color: var(--color-muted);
  font-size: 0.78em;
  font-weight: 700;
}

.transaction-meta {
  margin-top: 5px;

  color: var(--color-muted);
  font-size: 12px;
}

.transaction-values {
  min-width: 100px;
  text-align: right;
}

.transaction-values strong,
.transaction-values small {
  display: block;
}

.transaction-values strong {
  font-size: 18px;
}

.transaction-values small {
  margin-top: 4px;

  color: var(--color-muted);
  font-size: 10px;
}

.state-card,
.error-card,
.empty-card {
  display: grid;
  justify-items: center;
  gap: 12px;

  padding: 38px 22px;

  color: var(--color-muted);
  text-align: center;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 24px;

  box-shadow: var(--shadow-card);
}

.state-card p,
.error-card p,
.empty-card p,
.empty-card h2 {
  margin: 0;
}

.empty-card h2 {
  color: var(--color-text);
  font-size: 20px;
}

.empty-card p {
  max-width: 420px;

  font-size: 13px;
  line-height: 1.8;
}

.empty-icon {
  display: grid;
  place-items: center;

  width: 62px;
  height: 62px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 20px;

  font-size: 22px;
  font-weight: 900;
}

.error-card {
  color: #9f3038;
  background: #fff1f2;
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

.loading-spinner {
  width: 28px;
  height: 28px;

  border: 3px solid rgb(23 50 77 / 16%);
  border-top-color: var(--color-primary);
  border-radius: 50%;

  animation: loading-spin 700ms linear infinite;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.history-move,
.history-enter-active,
.history-leave-active {
  transition:
    opacity 450ms ease,
    transform 450ms
      cubic-bezier(0.22, 1, 0.36, 1);
}

.history-enter-active {
  transition-delay: var(--delay);
}

.history-leave-active {
  position: absolute;
  right: 0;
  left: 0;
}

.history-enter-from {
  opacity: 0;
  transform: translateY(25px);
}

.history-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.history-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

@media (min-width: 700px) {
  .today-history-page {
    padding: 34px 28px 60px;
  }

  .summary-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .summary-card--wide {
    grid-column: 1 / -1;
  }
}

@media (max-width: 540px) {
  .transaction-card {
    grid-template-columns:
      auto
      minmax(0, 1fr);
  }

  .transaction-values {
    grid-column: 2;

    min-width: 0;
    text-align: left;
  }

  .transaction-values strong,
  .transaction-values small {
    display: inline;
  }

  .transaction-values small {
    margin-left: 8px;
  }
}

@media (hover: none) {
  .transaction-card:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .history-move,
  .history-enter-active,
  .history-leave-active {
    transition-duration: 1ms;
  }

  .loading-spinner,
  .refresh-button--loading .refresh-icon {
    animation-duration: 1ms;
  }
}
</style>
```
