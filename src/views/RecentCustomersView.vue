```vue
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  clearRecentCustomers,
  getRecentCustomers,
} from '../services/recentCustomers'

const router = useRouter()

const recentCustomers = ref([])

function loadRecentCustomers() {
  recentCustomers.value = getRecentCustomers()
}

function openCustomer(customerCode) {
  router.push(`/customer/${customerCode}`)
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

function formatAccessTime(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function clearHistory() {
  const confirmed = window.confirm(
    '最近アクセスしたおともだちの記録を削除しますか？',
  )

  if (!confirmed) {
    return
  }

  clearRecentCustomers()
  recentCustomers.value = []
}

onMounted(loadRecentCustomers)
</script>

<template>
  <main class="recent-page">
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
        <p class="eyebrow">RECENT CUSTOMERS</p>
        <h1>常連さん</h1>
      </div>

      <button
        type="button"
        class="home-button"
        @click="goHome"
      >
        ホーム
      </button>
    </header>

    <section class="page-intro">
      <div>
        <strong>最近アクセスしたおともだち</strong>

        <p>
          おともだち情報を開いた順に最大20名表示します
        </p>
      </div>

      <span class="customer-count">
        {{ recentCustomers.length }}名
      </span>
    </section>

    <section
      v-if="recentCustomers.length === 0"
      class="empty-card"
    >
      <span class="empty-icon">時</span>

      <h2>まだ記録がありません</h2>

      <p>
        コード検索または名前検索からおともだち情報を開くと、
        ここに表示されます。
      </p>

      <button
        type="button"
        class="search-button"
        @click="router.push('/code-search')"
      >
        おともだちを検索
      </button>
    </section>

    <template v-else>
      <TransitionGroup
        appear
        name="recent"
        tag="div"
        class="customer-list"
      >
        <button
          v-for="(customer, index) in recentCustomers"
          :key="customer.customerCode"
          type="button"
          class="customer-card"
          :style="{
            '--delay': `${index * 45}ms`,
          }"
          @click="openCustomer(customer.customerCode)"
        >
          <span class="customer-rank">
            {{ index + 1 }}
          </span>

          <span class="customer-info">
            <strong class="customer-name">
              {{ customer.customerName }}
              <span class="name-suffix">さん</span>
            </strong>

            <span class="customer-meta">
              おともだちコード
              {{ customer.customerCode }}
            </span>

            <span
              v-if="customer.accessedAt"
              class="access-time"
            >
              最終アクセス：
              {{
                formatAccessTime(
                  customer.accessedAt,
                )
              }}
            </span>
          </span>

          <span class="customer-balance">
            <small>現在のうにょ</small>

            <strong>
              {{
                formatNumber(
                  customer.currentBalance,
                )
              }}
            </strong>
          </span>
        </button>
      </TransitionGroup>

      <button
        type="button"
        class="clear-history-button"
        @click="clearHistory"
      >
        アクセス履歴を削除
      </button>
    </template>
  </main>
</template>

<style scoped>
.recent-page {
  width: min(100%, 760px);
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
.home-button {
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

.home-button {
  min-height: 42px;
  padding: 8px 14px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-weight: 750;
}

.page-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;

  margin-bottom: 18px;
  padding: 20px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 24px;

  box-shadow: var(--shadow-card);
}

.page-intro strong {
  display: block;
  font-size: 17px;
}

.page-intro p {
  margin: 6px 0 0;

  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.customer-count {
  display: grid;
  flex: 0 0 auto;
  place-items: center;

  min-width: 58px;
  height: 38px;
  padding: 0 12px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 13px;
  font-weight: 850;
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

.customer-rank {
  display: grid;
  place-items: center;

  width: 48px;
  height: 48px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 16px;

  font-size: 16px;
  font-weight: 900;
}

.customer-info {
  min-width: 0;
}

.customer-name,
.customer-meta,
.access-time {
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
  margin-top: 4px;

  color: var(--color-muted);
  font-size: 12px;
}

.access-time {
  margin-top: 4px;

  color: var(--color-muted);
  font-size: 11px;
}

.customer-balance {
  min-width: 92px;
  text-align: right;
}

.customer-balance small,
.customer-balance strong {
  display: block;
}

.customer-balance small {
  color: var(--color-muted);
  font-size: 10px;
}

.customer-balance strong {
  margin-top: 3px;

  color: var(--color-primary);
  font-size: 19px;
}

.empty-card {
  display: grid;
  justify-items: center;
  gap: 12px;

  padding: 40px 24px;

  color: var(--color-muted);
  text-align: center;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 24px;

  box-shadow: var(--shadow-card);
}

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

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 20px;

  font-size: 22px;
  font-weight: 900;
}

.search-button {
  min-height: 48px;
  padding: 10px 20px;

  color: white;
  background: var(--color-primary);
  border: 0;
  border-radius: 15px;

  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.clear-history-button {
  display: block;

  margin: 24px auto 0;
  padding: 10px 16px;

  color: var(--color-muted);
  background: transparent;
  border: 0;

  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.clear-history-button:hover {
  color: #a62c36;
}

.recent-move,
.recent-enter-active,
.recent-leave-active {
  transition:
    opacity 450ms ease,
    transform 450ms
      cubic-bezier(0.22, 1, 0.36, 1);
}

.recent-enter-active {
  transition-delay: var(--delay);
}

.recent-leave-active {
  position: absolute;
  right: 0;
  left: 0;
}

.recent-enter-from {
  opacity: 0;
  transform: translateY(26px);
}

.recent-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.recent-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

@media (min-width: 700px) {
  .recent-page {
    padding: 34px 28px 60px;
  }
}

@media (max-width: 520px) {
  .customer-card {
    grid-template-columns:
      auto
      minmax(0, 1fr);
  }

  .customer-balance {
    grid-column: 2;

    min-width: 0;
    text-align: left;
  }

  .customer-balance small,
  .customer-balance strong {
    display: inline;
  }

  .customer-balance strong {
    margin-left: 6px;
    font-size: 15px;
  }
}

@media (hover: none) {
  .customer-card:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .recent-move,
  .recent-enter-active,
  .recent-leave-active {
    transition-duration: 1ms;
  }
}
</style>
