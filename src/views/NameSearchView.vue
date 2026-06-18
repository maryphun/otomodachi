```vue
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAllCustomers } from '../services/api'

const router = useRouter()

const customers = ref([])
const searchText = ref('')

const isLoading = ref(true)
const errorMessage = ref('')

const normalizedSearchText = computed(() => {
  return normalizeText(searchText.value)
})

const suggestedCustomers = computed(() => {
  const keyword = normalizedSearchText.value

  if (!keyword) {
    return []
  }

  return customers.value
    .filter((customer) => {
      const customerName = normalizeText(
        customer.customerName,
      )

      return customerName.includes(keyword)
    })
    .slice(0, 6)
})

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
}

function clearSearch() {
  searchText.value = ''
}

function goBack() {
  router.back()
}

function goHome() {
  router.push('/')
}

function openCustomer(customerCode) {
  router.push(`/customer/${customerCode}`)
}

async function loadCustomers() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    customers.value = await getAllCustomers()
  } catch (error) {
    console.error(error)

    errorMessage.value =
      error.message || '顧客情報の取得に失敗しました'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadCustomers)
</script>

<template>
  <main class="name-search-page">
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
        <p class="eyebrow">NAME SEARCH</p>
        <h1>名前で検索</h1>
      </div>

      <button
        type="button"
        class="home-button"
        @click="goHome"
      >
        ホーム
      </button>
    </header>

    <section class="search-card">
      <div class="search-input-wrapper">
        <span class="search-icon">
          検
        </span>

        <input
          id="customer-name-search"
          v-model="searchText"
          type="search"
          class="search-input"
          placeholder="名前を入力してください"
          autocomplete="off"
          enterkeyhint="search"
        />

        <button
          v-if="searchText"
          type="button"
          class="clear-button"
          aria-label="入力を消去"
          @click="clearSearch"
        >
          ×
        </button>
      </div>

      <p class="search-help">
        ひらがな・カタカナ・漢字で検索できます
      </p>
    </section>

    <section class="result-section">
      <div class="result-heading">
        <p class="section-label">
          検索結果
        </p>

        <span
          v-if="normalizedSearchText"
          class="result-count"
        >
          {{ suggestedCustomers.length }}件
        </span>
      </div>

      <div
        v-if="isLoading"
        class="state-card"
      >
        <span class="loading-spinner" />
        <p>顧客情報を読み込み中...</p>
      </div>

      <div
        v-else-if="errorMessage"
        class="error-card"
      >
        <p>{{ errorMessage }}</p>

        <button
          type="button"
          @click="loadCustomers"
        >
          再読み込み
        </button>
      </div>

      <div
        v-else-if="!normalizedSearchText"
        class="empty-card"
      >
        <span class="empty-icon">名</span>

        <p>
          名前を入力すると<br />
          候補がここに表示されますよん～
        </p>
      </div>

      <div
        v-else-if="suggestedCustomers.length === 0"
        class="empty-card"
      >
        <span class="empty-icon">？</span>

        <p>
          「{{ searchText }}」に一致する<br />
          お客様が見つかりません
        </p>
      </div>

      <TransitionGroup
        v-else
        appear
        name="suggestion"
        tag="div"
        class="suggestion-list"
      >
        <button
          v-for="(customer, index) in suggestedCustomers"
          :key="customer.customerCode"
          type="button"
          class="suggestion-card"
          :style="{
            '--delay': `${index * 70}ms`,
          }"
          @click="openCustomer(customer.customerCode)"
        >
          <span class="suggestion-avatar">
            {{
              String(customer.customerName || '?')
                .slice(0, 1)
            }}
          </span>

          <span class="suggestion-info">
            <span class="suggestion-name">
              {{ customer.customerName }}
            </span>

            <span class="suggestion-code">
              顧客コード
              {{ customer.customerCode }}
            </span>
          </span>

          <span class="suggestion-balance">
            <small>現在のうにょ</small>

            <strong>
              {{
                Number(
                  customer.currentBalance || 0,
                ).toLocaleString('ja-JP')
              }}
            </strong>
          </span>
        </button>
      </TransitionGroup>
    </section>
  </main>
</template>

<style scoped>
.name-search-page {
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
.home-button,
.clear-button {
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

.search-card {
  padding: 22px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 26px;

  box-shadow: var(--shadow-card);
}

.search-label {
  display: block;
  margin-bottom: 10px;

  color: var(--color-muted);
  font-size: 13px;
  font-weight: 750;
}

.search-input-wrapper {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;

  min-height: 68px;
  padding: 8px 10px 8px 16px;

  background: #f7f9fb;
  border: 2px solid transparent;
  border-radius: 20px;

  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.search-input-wrapper:focus-within {
  background: white;
  border-color: rgb(23 50 77 / 28%);

  box-shadow:
    0 0 0 5px rgb(23 50 77 / 7%),
    0 10px 26px rgb(15 34 53 / 8%);
}

.search-icon {
  display: grid;
  place-items: center;

  width: 42px;
  height: 42px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 14px;

  font-size: 15px;
  font-weight: 900;
}

.search-input {
  width: 100%;
  min-width: 0;

  color: var(--color-text);
  background: transparent;
  border: 0;
  outline: 0;

  font: inherit;
  font-size: 18px;
  font-weight: 700;
}

.search-input::placeholder {
  color: #9ba1a8;
  font-weight: 500;
}

.search-input::-webkit-search-cancel-button {
  display: none;
}

.clear-button {
  display: grid;
  place-items: center;

  width: 42px;
  height: 42px;

  color: var(--color-muted);
  background: #e9edf1;
  border-radius: 50%;

  font-size: 22px;

  transition:
    transform 130ms var(--ease-out),
    background-color 130ms ease;
}

.clear-button:hover {
  background: #dde3e8;
}

.clear-button:active {
  transform: scale(0.9);
}

.search-help {
  margin: 11px 0 0;

  color: var(--color-muted);
  font-size: 12px;
}

.result-section {
  margin-top: 24px;
}

.result-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-bottom: 12px;
}

.section-label {
  margin: 0;

  color: var(--color-muted);
  font-size: 13px;
  font-weight: 750;
}

.result-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-width: 42px;
  height: 28px;
  padding: 0 10px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 12px;
  font-weight: 800;
}

.suggestion-list {
  position: relative;

  display: grid;
  gap: 11px;
}

.suggestion-card {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr)
    auto;

  align-items: center;
  gap: 14px;

  width: 100%;
  min-height: 90px;
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

.suggestion-card:hover {
  border-color: rgb(23 50 77 / 24%);

  box-shadow:
    0 7px 16px rgb(15 34 53 / 8%),
    0 18px 34px rgb(15 34 53 / 8%);

  transform: translateY(-3px);
}

.suggestion-card:active {
  transform: scale(0.98);
}

.suggestion-avatar {
  display: grid;
  place-items: center;

  width: 52px;
  height: 52px;

  color: white;
  background: var(--color-primary);
  border-radius: 17px;

  font-size: 20px;
  font-weight: 900;
}

.suggestion-info {
  min-width: 0;
}

.suggestion-name,
.suggestion-code {
  display: block;
}

.suggestion-name {
  overflow: hidden;

  font-size: 18px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-code {
  margin-top: 5px;

  color: var(--color-muted);
  font-size: 12px;
}

.suggestion-balance {
  min-width: 84px;
  text-align: right;
}

.suggestion-balance small,
.suggestion-balance strong {
  display: block;
}

.suggestion-balance small {
  color: var(--color-muted);
  font-size: 10px;
}

.suggestion-balance strong {
  margin-top: 3px;

  color: var(--color-primary);
  font-size: 18px;
}

.state-card,
.error-card,
.empty-card {
  display: grid;
  justify-items: center;
  gap: 12px;

  padding: 34px 20px;

  color: var(--color-muted);
  text-align: center;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 22px;

  box-shadow: var(--shadow-card);
}

.state-card p,
.error-card p,
.empty-card p {
  margin: 0;
}

.empty-icon {
  display: grid;
  place-items: center;

  width: 58px;
  height: 58px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 19px;

  font-size: 21px;
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
  width: 26px;
  height: 26px;

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

.suggestion-move,
.suggestion-enter-active,
.suggestion-leave-active {
  transition:
    opacity 500ms ease,
    transform 500ms
      cubic-bezier(0.22, 1, 0.36, 1);
}

.suggestion-enter-active {
  transition-delay: var(--delay);
}

.suggestion-leave-active {
  position: absolute;
  right: 0;
  left: 0;

  transition-delay: 0ms;
}

.suggestion-enter-from {
  opacity: 0;
  transform: translateY(30px);
}

.suggestion-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.suggestion-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.suggestion-leave-to {
  opacity: 0;
  transform: translateY(24px);
}

@media (min-width: 700px) {
  .name-search-page {
    padding: 34px 28px 60px;
  }

  .search-card {
    padding: 26px;
  }
}

@media (max-width: 520px) {
  .suggestion-card {
    grid-template-columns:
      auto
      minmax(0, 1fr);

    min-height: 86px;
  }

  .suggestion-balance {
    grid-column: 2;

    min-width: 0;
    text-align: left;
  }

  .suggestion-balance small,
  .suggestion-balance strong {
    display: inline;
  }

  .suggestion-balance strong {
    margin-left: 6px;
    font-size: 15px;
  }
}

@media (hover: none) {
  .suggestion-card:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .suggestion-move,
  .suggestion-enter-active,
  .suggestion-leave-active {
    transition-duration: 1ms;
  }

  .loading-spinner {
    animation-duration: 1ms;
  }
}
</style>
```
