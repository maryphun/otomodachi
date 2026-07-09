<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  getCachedTodayActiveCustomers,
  getTodayActiveCustomers,
} from '../services/api'
import todayActiveBackground from '../assets/today-active-background.jpg'
import {
  displayCustomerName,
} from '../utils/customerNames'

const router = useRouter()

const customers = ref([])
const isLoading = ref(true)
const isRefreshing = ref(false)
const errorMessage = ref('')
const lastUpdated = ref('')

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
  return Number(value || 0).toLocaleString('ja-JP')
}

function formatSignedNumber(value) {
  const number = Number(value || 0)

  if (number > 0) {
    return `+${formatNumber(number)}`
  }

  return formatNumber(number)
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

function applyCachedCustomers(cached) {
  if (!cached) {
    return false
  }

  customers.value = Array.isArray(cached.customers)
    ? cached.customers
    : []
  lastUpdated.value = cached.savedAt || ''
  isLoading.value = false

  return true
}

async function loadCustomers(
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
    const result = await getTodayActiveCustomers(
      forceRefresh,
    )

    customers.value = Array.isArray(result)
      ? result
      : []
    lastUpdated.value =
      getCachedTodayActiveCustomers()?.savedAt ||
      new Date().toISOString()
  } catch (error) {
    console.error(error)

    if (customers.value.length === 0) {
      errorMessage.value =
        error.message ||
        '店内のおともだちを取得できませんでした'
    }
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

function refreshCustomers() {
  loadCustomers(false, true)
}

onMounted(() => {
  const hasCache = applyCachedCustomers(
    getCachedTodayActiveCustomers(),
  )

  if (!hasCache) {
    loadCustomers(true, true)
  }
})
</script>

<template>
  <main
    class="active-page"
    :style="{
      '--active-background': `url(${todayActiveBackground})`,
    }"
  >
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
        <p class="eyebrow">IN SHOP NOW</p>
        <h1>来店中</h1>
      </div>

      <button
        type="button"
        class="home-button"
        @click="goHome"
      >
        ホーム
      </button>
    </header>

    <section class="summary-card">
      <span class="summary-icon">店</span>

      <div>
        <small>ただいまおともだち数</small>
        <strong>{{ customers.length }}名</strong>
      </div>

    </section>

    <section class="active-section">
      <div class="section-heading">
        <div>
          <h2 class="visually-hidden">店内一覧</h2>

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
          @click="refreshCustomers"
        >
          <span class="refresh-icon">↻</span>
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
        <p>店内のおともだちを確認中...</p>
      </div>

      <div
        v-else-if="errorMessage"
        class="error-card"
      >
        <p>{{ errorMessage }}</p>

        <button
          type="button"
          @click="loadCustomers(true, true)"
        >
          再読み込み
        </button>
      </div>

      <div
        v-else-if="customers.length === 0"
        class="empty-card"
      >
        <span class="empty-icon">店</span>
        <h2>だれもいません...　ぴえん</h2>
        <p>
          人類滅亡！！！
        </p>
      </div>

      <TransitionGroup
        v-else
        appear
        name="active"
        tag="div"
        class="customer-list"
      >
        <button
          v-for="(customer, index) in customers"
          :key="customer.customerCode"
          type="button"
          class="customer-card"
          :style="{
            '--delay': `${Math.min(index, 10) * 45}ms`,
          }"
          @click="openCustomer(customer.customerCode)"
        >
          <span class="customer-status">店</span>

          <span class="customer-info">
            <strong class="customer-name">
              {{ displayCustomerName(customer.customerName) }}
              <span class="name-suffix">さん</span>
            </strong>

            <span class="customer-meta">
              おともだちコード
              {{ customer.customerCode }}
              ・
              本日{{ customer.movementCount }}回入力
            </span>
          </span>

          <em
            class="customer-change"
            :class="{
              'positive-value':
                customer.chipChange > 0,
              'negative-value':
                customer.chipChange < 0,
            }"
          >
            本日{{
              formatSignedNumber(
                customer.chipChange,
              )
            }}
          </em>
        </button>
      </TransitionGroup>
    </section>
  </main>
</template>

<style scoped>
.active-page {
  position: relative;

  width: min(100%, 820px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 20px 16px 50px;
}

.active-page::before {
  content: '';

  position: fixed;
  top: 0;
  bottom: 0;
  left: 50%;
  z-index: 0;
  width: min(100vw, 820px);
  height: 100vh;
  transform: translateX(-50%);

  background-image: var(--active-background);
  background-repeat: no-repeat;
  background-size: auto;
  background-position: right bottom;

  opacity: 0.5;
  pointer-events: none;
}

.page-header,
.summary-card,
.active-section {
  position: relative;
  z-index: 1;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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
  font-size: clamp(25px, 6vw, 38px);
}

.home-button,
.refresh-button {
  min-height: 42px;
  padding: 8px 14px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;
  font-weight: 750;
}

.summary-card {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 18px;
  background: rgb(255 255 255 / 82%);
  border: 1px solid rgb(255 255 255 / 58%);
  border-radius: 24px;
  box-shadow:
    0 10px 28px rgb(15 34 53 / 12%),
    inset 0 1px 0 rgb(255 255 255 / 52%);
  backdrop-filter: blur(10px);
}

.summary-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  color: #7a4d00;
  background: #fff5d8;
  border-radius: 17px;
  font-size: 20px;
  font-weight: 900;
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
  font-size: 23px;
}

.active-section {
  margin-top: 24px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 13px;
}

.section-heading h2,
.section-heading p {
  margin: 0;
}

.section-heading h2 {
  font-size: 19px;
}

.section-heading p {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 11px;
}

.refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
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

.customer-list {
  position: relative;
  display: grid;
  gap: 11px;
}

.customer-card {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr)
    auto;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 98px;
  padding: 15px 17px;
  color: var(--color-text);
  text-align: left;
  background: rgb(255 255 255 / 82%);
  border: 1px solid rgb(255 255 255 / 58%);
  border-radius: 22px;
  box-shadow:
    0 7px 18px rgb(15 34 53 / 8%),
    inset 0 1px 0 rgb(255 255 255 / 52%);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition:
    transform 200ms var(--ease-out),
    box-shadow 200ms var(--ease-out),
    border-color 180ms ease;
}

.customer-card:hover {
  border-color: rgb(23 50 77 / 24%);
  box-shadow:
    0 7px 16px rgb(15 34 53 / 8%),
    0 18px 34px rgb(15 34 53 / 8%);
  transform: translateY(-3px);
}

.customer-card:active {
  transform: scale(0.98);
}

.customer-status {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  color: #7a4d00;
  background: #fff5d8;
  border-radius: 17px;
  font-size: 19px;
  font-weight: 900;
}

.customer-info {
  min-width: 0;
}

.customer-name,
.customer-meta {
  display: block;
}

.customer-name {
  overflow: hidden;
  font-size: 18px;
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

.customer-meta {
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 12px;
}

.customer-change {
  min-width: 86px;
  text-align: right;
  color: var(--color-muted);
  font-size: 13px;
  font-style: normal;
  font-weight: 850;
}

.positive-value {
  color: #197044 !important;
}

.negative-value {
  color: #a62c36 !important;
}

.state-card,
.error-card,
.empty-card {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 40px 24px;
  color: var(--color-muted);
  text-align: center;
  background: rgb(255 255 255 / 82%);
  border: 1px solid rgb(255 255 255 / 58%);
  border-radius: 24px;
  box-shadow:
    0 10px 28px rgb(15 34 53 / 12%),
    inset 0 1px 0 rgb(255 255 255 / 52%);
  backdrop-filter: blur(10px);
}

.state-card p,
.error-card p,
.empty-card h2,
.empty-card p {
  margin: 0;
}

.empty-card h2 {
  color: var(--color-text);
  font-size: 20px;
}

.empty-card p {
  max-width: 430px;
  font-size: 13px;
  line-height: 1.8;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  color: #7a4d00;
  background: #fff5d8;
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

.active-move,
.active-enter-active,
.active-leave-active {
  transition:
    opacity 450ms ease,
    transform 450ms
      cubic-bezier(0.22, 1, 0.36, 1);
}

.active-enter-active {
  transition-delay: var(--delay);
}

.active-leave-active {
  position: absolute;
  right: 0;
  left: 0;
}

.active-enter-from {
  opacity: 0;
  transform: translateY(24px);
}

.active-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.active-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 700px) {
  .active-page {
    padding: 34px 28px 60px;
  }
}

@media (max-width: 560px) {
  .customer-card {
    grid-template-columns:
      auto
      minmax(0, 1fr);
  }

  .customer-change {
    grid-column: 2;
    min-width: 0;
    text-align: left;
  }
}

@media (hover: none) {
  .customer-card:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .active-move,
  .active-enter-active,
  .active-leave-active {
    transition-duration: 1ms;
  }

  .loading-spinner,
  .refresh-button--loading .refresh-icon {
    animation-duration: 1ms;
  }
}
</style>
