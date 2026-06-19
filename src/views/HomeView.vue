<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAllCustomers } from '../services/api'
import homeBackground from '../assets/home-background.jpg'

import {
  APP_UPDATE_DATE,
  APP_VERSION,
} from '../config/appInfo'

const router = useRouter()

const isRefreshingCustomers = ref(false)
const refreshMessage = ref('')

const now = new Date()

const formattedUpdateDate =
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(
    new Date(`${APP_UPDATE_DATE}T00:00:00+09:00`),
  )

const datePart = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(now)

const weekdayPart = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  weekday: 'long',
}).format(now)

const todayText = `${datePart}(${weekdayPart})`

const menuItems = [
  {
    title: 'コードで検索',
    description: '顧客コードから検索',
    route: '/code-search',
    symbol: '#',
  },
  {
    title: '名前で検索',
    description: '名前から検索',
    route: '/search/name',
    symbol: '名',
  },
  {
    title: '新規登録',
    description: '新しいおともだち！！！',
    route: '/new-customer',
    symbol: '+',
  },
  {
    title: '常連さん',
    description: '最近来店した顧客',
    route: '/recent-customers',
    symbol: '常',
  },
  {
    title: '本日の増減履歴',
    description: '今日のチップ増減を確認',
    route: '/today-history',
    symbol: '履',
    wide: true,
  },
]

function openPage(route) {
  router.push(route)
}

function warmCustomerList() {
  getAllCustomers().catch((error) => {
    console.error(error)
  })
}

async function refreshCustomerList() {
  if (isRefreshingCustomers.value) {
    return
  }

  isRefreshingCustomers.value = true
  refreshMessage.value = ''

  try {
    const customers = await getAllCustomers(true)

    refreshMessage.value =
      `${customers.length}名の顧客情報を更新しました`

    window.setTimeout(() => {
      refreshMessage.value = ''
    }, 2500)
  } catch (error) {
    console.error(error)

    refreshMessage.value =
      error.message ||
      '顧客情報の更新に失敗しました'
  } finally {
    isRefreshingCustomers.value = false
  }
}

onMounted(warmCustomerList)
</script>

<template>
  <main
  class="home-page"
  :style="{
    '--home-background': `url(${homeBackground})`,
  }"
>
    <div class="home-content">
      <header class="home-header">
        <p class="eyebrow">UNYO MANAGEMENT</p>
        <h1>おともだちポーカー</h1>
      </header>

      <section class="refresh-section">
  <button
    type="button"
    class="refresh-customers-button"
    :class="{
      'refresh-customers-button--loading':
        isRefreshingCustomers,
    }"
    :disabled="isRefreshingCustomers"
    @click="refreshCustomerList"
  >
    <span class="refresh-customers-icon">
      ↻
    </span>

    <span>
      {{
        isRefreshingCustomers
          ? '顧客情報を更新中…'
          : '顧客情報を再読み込み'
      }}
    </span>
  </button>

  <Transition name="refresh-message">
    <p
      v-if="refreshMessage"
      class="refresh-message"
    >
      {{ refreshMessage }}
    </p>
  </Transition>
</section>

      <section class="menu-grid">
        <button
          v-for="item in menuItems"
          :key="item.route"
          type="button"
          class="menu-card"
          :class="{ 'menu-card--wide': item.wide }"
          @click="openPage(item.route)"
        >
          <span class="menu-symbol">
            {{ item.symbol }}
          </span>

          <span class="menu-copy">
            <strong>{{ item.title }}</strong>
            <small>{{ item.description }}</small>
          </span>

          <span class="menu-arrow">→</span>
        </button>
      </section>
    </div>

    <footer class="home-footer">
      <span class="today-date">
        {{ todayText }}
      </span>
     <span class="version-info">
        Ver. {{ APP_VERSION }}
        ・
        更新日 {{ formattedUpdateDate }}
      </span>
    </footer>

  </main>
</template>

<style scoped>
.home-page {
  position: relative;

  display: flex;
  flex-direction: column;

  width: min(100%, 960px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 28px 16px 24px;
}

.home-page::before {
  content: '';

  position: absolute;
  inset: 0;

  background-image: var(--home-background);
  background-repeat: no-repeat;
  background-size: auto;
  background-position: right bottom;

  opacity: 0.5;
  pointer-events: none;
}

.home-content,
.today-date {
  position: relative;
  z-index: 1;
}

.home-header {
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 8px;

  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

h1 {
  margin: 0;

  color: var(--color-text);
  font-size: clamp(28px, 7vw, 44px);
  line-height: 1.2;
}

.subtitle {
  margin: 10px 0 0;
  color: var(--color-muted);
}

.menu-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.menu-card {
  position: relative;

  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;

  width: 100%;
  min-height: 92px;
  padding: 17px 18px;

  overflow: hidden;

  color: var(--color-text);
  text-align: left;

  background: linear-gradient(
    180deg,
    var(--color-surface),
    #f8fafc
  );

  border: 1px solid rgb(23 50 77 / 10%);
  border-radius: 999px;

  box-shadow:
    0 3px 8px rgb(15 34 53 / 5%),
    0 10px 24px rgb(15 34 53 / 6%);

  transition:
    transform 200ms var(--ease-out),
    box-shadow 200ms var(--ease-out),
    border-color 180ms ease;
}

.menu-card::before {
  content: "";

  position: absolute;
  inset: 0;

  pointer-events: none;

  background: radial-gradient(
    circle at 15% 20%,
    rgb(23 50 77 / 6%),
    transparent 48%
  );

  opacity: 0;

  transition: opacity 220ms ease;
}

.menu-card:hover {
  border-color: rgb(23 50 77 / 24%);

  box-shadow:
    0 6px 14px rgb(15 34 53 / 8%),
    0 18px 36px rgb(15 34 53 / 10%);

  transform: translateY(-3px) scale(1.01);
}

.menu-card:hover::before {
  opacity: 1;
}

.menu-card:active {
  box-shadow:
    0 2px 6px rgb(15 34 53 / 8%),
    0 6px 12px rgb(15 34 53 / 8%);

  transform: translateY(1px) scale(0.975);
  transition-duration: 90ms;
}

.menu-card:focus-visible {
  outline: 3px solid var(--color-primary-soft);
  outline-offset: 3px;
}

.menu-symbol {
  position: relative;
  z-index: 1;

  display: grid;
  place-items: center;

  width: 54px;
  height: 54px;

  color: var(--color-primary);
  background: var(--color-primary-soft);

  border: 1px solid rgb(23 50 77 / 7%);
  border-radius: 50%;

  font-size: 21px;
  font-weight: 900;

  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 80%),
    0 4px 10px rgb(23 50 77 / 5%);

  transition: transform 260ms var(--ease-spring);
}

.menu-card:hover .menu-symbol {
  transform: scale(1.08) rotate(-3deg);
}

.menu-copy {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.menu-copy strong {
  display: block;
  font-size: 18px;
  line-height: 1.4;
}

.menu-copy small {
  display: block;
  margin-top: 4px;

  overflow: hidden;

  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;

  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-arrow {
  position: relative;
  z-index: 1;

  display: grid;
  place-items: center;

  width: 38px;
  height: 38px;

  color: white;
  background: var(--color-primary);
  border-radius: 50%;

  font-size: 18px;
  font-weight: 700;

  transition:
    transform 220ms var(--ease-out),
    background-color 180ms ease;
}

.menu-card:hover .menu-arrow {
  background: var(--color-primary-dark);
  transform: translateX(4px);
}

.home-page {
  display: flex;
  flex-direction: column;

  width: min(100%, 960px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 28px 16px 24px;

  background-repeat: no-repeat;
  background-size: auto;
  background-position: right bottom;
}

.home-footer {
  position: relative;
  z-index: 1;

  display: grid;
  justify-items: center;
  gap: 6px;

  margin-top: 32px;
  padding-top: 18px;

  color: var(--color-muted);
  text-align: center;

  border-top: 1px solid var(--color-border);
}

.today-date {
  font-size: 14px;
  font-weight: 600;
}

.version-info {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.03em;
  opacity: 0.78;
}

.refresh-section {
  display: grid;
  justify-items: start;
  gap: 9px;

  margin-bottom: 20px;
}

.refresh-customers-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;

  min-height: 44px;
  padding: 9px 16px;

  color: var(--color-primary);
  background: var(--color-primary-soft);

  border: 1px solid rgb(23 50 77 / 10%);
  border-radius: 999px;

  font-size: 13px;
  font-weight: 800;

  cursor: pointer;

  box-shadow:
    0 3px 8px rgb(15 34 53 / 5%);

  transition:
    transform 180ms var(--ease-out),
    background-color 180ms ease,
    opacity 180ms ease;
}

.refresh-customers-button:hover:not(:disabled) {
  background: #e2edf6;
  transform: translateY(-2px);
}

.refresh-customers-button:active:not(:disabled) {
  transform: scale(0.97);
}

.refresh-customers-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.refresh-customers-icon {
  display: inline-block;
  font-size: 19px;
  line-height: 1;
}

.refresh-customers-button--loading
.refresh-customers-icon {
  animation: refresh-customers-spin 700ms linear infinite;
}

.refresh-message {
  margin: 0;
  padding-left: 4px;

  color: var(--color-muted);
  font-size: 12px;
  font-weight: 650;
}

.refresh-message-enter-active,
.refresh-message-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms var(--ease-out);
}

.refresh-message-enter-from,
.refresh-message-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

@keyframes refresh-customers-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 700px) {
  .home-page {
    padding: 48px 28px 28px;
  }

  .menu-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }

  .menu-card {
    min-height: 116px;
    padding: 22px;
    border-radius: 32px;
  }

  .menu-card--wide {
    grid-column: 1 / -1;
  }
}

@media (min-width: 900px) {
  .menu-card {
    min-height: 126px;
  }

  .menu-symbol {
    width: 60px;
    height: 60px;
  }
}

@media (hover: none) {
  .menu-card:hover {
    box-shadow:
      0 3px 8px rgb(15 34 53 / 5%),
      0 10px 24px rgb(15 34 53 / 6%);

    transform: none;
  }

  .menu-card:hover .menu-symbol,
  .menu-card:hover .menu-arrow {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-card,
  .menu-symbol,
  .menu-arrow {
    transition-duration: 1ms;
  }
}
</style>
