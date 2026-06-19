<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  getAllCustomers,
  getCachedCustomers,
} from '../services/api'

const router = useRouter()

const enteredCode = ref('')
const customers = ref([])
const isLoading = ref(true)
const errorMessage = ref('')

const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

const suggestedCustomers = computed(() => {
  const input = enteredCode.value.trim()

  if (!input) {
    return []
  }

  const normalizedInput = input.replace(/^0+/, '') || '0'

  return customers.value
    .filter((customer) => {
      const customerCode = String(customer.customerCode)
      const normalizedCode =
        customer.normalizedCustomerCode ||
        customerCode.replace(/^0+/, '') ||
        '0'

      return (
        customerCode.startsWith(input) ||
        normalizedCode.startsWith(normalizedInput)
      )
    })
    .slice(0, 6)
})

function addNumber(number) {
  if (enteredCode.value.length >= 10) {
    return
  }

  enteredCode.value += number
}

function removeLastNumber() {
  enteredCode.value = enteredCode.value.slice(0, -1)
}

function clearCode() {
  enteredCode.value = ''
}

function openCustomer(customerCode) {
  router.push(`/customer/${customerCode}`)
}

function goBack() {
  router.push('/')
}

async function loadCustomers(forceRefresh = false) {
  const cachedCustomers = forceRefresh
    ? []
    : getCachedCustomers()
  const hasCachedCustomers = cachedCustomers.length > 0

  if (hasCachedCustomers) {
    customers.value = cachedCustomers
  }

  isLoading.value = !hasCachedCustomers
  errorMessage.value = ''

  try {
    customers.value =
      await getAllCustomers(forceRefresh)
  } catch (error) {
    console.error(error)

    if (!hasCachedCustomers) {
      errorMessage.value = error.message
    }
  } finally {
    isLoading.value = false
  }
}

onMounted(loadCustomers)
</script>

<template>
  <main class="code-search-page">
    <header class="page-header">
      <button
        type="button"
        class="back-button"
        aria-label="戻る"
        @click="goBack"
      >
        ←
      </button>

      <div>
        <p class="eyebrow">CUSTOMER SEARCH</p>
        <h1>コードで検索</h1>
      </div>
    </header>

    <div class="search-layout">
      <section class="input-panel">
        <div class="code-display">
          <span class="code-label">おともだちコード</span>

          <div
            class="code-line"
            :class="{ 'code-line--empty': !enteredCode }">
            {{ enteredCode || 'コード' }}
          </div>

          <input
            :value="enteredCode"
            class="hidden-code-input"
            type="text"
            inputmode="none"
            readonly
            aria-label="入力されたおともだちコード"
          />
        </div>

        <div class="number-pad">
          <button
            v-for="number in numberKeys"
            :key="number"
            type="button"
            class="number-button"
            @click="addNumber(number)"
          >
            {{ number }}
          </button>

          <button
            type="button"
            class="number-button number-button--utility"
            @click="clearCode"
          >
            C
          </button>

          <button
            type="button"
            class="number-button"
            @click="addNumber('0')"
          >
            0
          </button>

          <button
            type="button"
            class="number-button number-button--utility"
            aria-label="1文字削除"
            @click="removeLastNumber"
          >
            ⌫
          </button>
        </div>
      </section>

      <section class="suggestions-panel">
        <div class="suggestions-header">
          <div>
            <h2>候補</h2>
            <p>入力中のコードに一致するおともだち</p>
          </div>

          <span
            v-if="enteredCode"
            class="result-count"
          >
            {{ suggestedCustomers.length }}件
          </span>
        </div>

        <p
          v-if="isLoading"
          class="state-message"
        >
          おともだち情報を読み込み中...
        </p>

        <div
          v-else-if="errorMessage"
          class="error-box"
        >
          <p>{{ errorMessage }}</p>

          <button
            type="button"
            @click="loadCustomers(true)"
          >
            再読み込み
          </button>
        </div>

        <div
          v-else-if="!enteredCode"
          class="empty-state"
        >
          <span class="empty-icon">#</span>
          <p>番号を入力すると候補が表示されます</p>
        </div>

        <div
          v-else-if="suggestedCustomers.length === 0"
          class="empty-state"
        >
          <span class="empty-icon">?</span>
          <p>一致するおともだちが見つかりません</p>
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
    :style="{ '--delay': `${index * 30}ms` }"
    @click="openCustomer(customer.customerCode)"
  >
            <span class="suggestion-code">
              {{ customer.customerCode }}
            </span>

            <span class="suggestion-info">
              <strong class="friend-name">
                {{ customer.customerName }}
                <span class="name-suffix">さん</span>
              </strong>

              <small>
                {{
                  customer.lastVisit
                    ? `最終来店 ${customer.lastVisit}`
                    : '来店記録なし'
                }}
              </small>
            </span>

            <span class="suggestion-balance">
              <strong>
                {{
                  customer.currentBalance.toLocaleString(
                    'ja-JP',
                  )
                }}
              </strong>

              <small>うにょ</small>
            </span>

            <span class="suggestion-arrow">→</span>
          </button>
        </TransitionGroup>
      </section>
    </div>
  </main>
</template>

<style scoped>
.code-search-page {
  width: min(100%, 1000px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 24px;
}

.back-button {
  display: grid;
  flex: 0 0 auto;
  place-items: center;

  width: 48px;
  height: 48px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border: 0;
  border-radius: 50%;

  font-size: 22px;
  font-weight: 800;

  transition:
    transform 180ms var(--ease-out),
    background-color 180ms ease;
}

.back-button:hover {
  background: #dfeaf4;
  transform: translateX(-3px);
}

.back-button:active {
  transform: scale(0.92);
}

.eyebrow {
  margin: 2px 0 6px;

  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.13em;
}

h1 {
  margin: 0;
  color: var(--color-text);
  font-size: clamp(26px, 6vw, 38px);
}

.subtitle {
  margin: 7px 0 0;
  color: var(--color-muted);
}

.search-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.input-panel,
.suggestions-panel {
  padding: 18px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 24px;

  box-shadow: var(--shadow-card);
}

.code-display {
  position: relative;
  padding: 18px;

  background: var(--color-primary-soft);
  border-radius: 18px;
}

.code-label {
  display: block;
  margin-bottom: 14px;

  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.code-line {
  display: flex;
  align-items: center;

  width: 100%;
  min-height: 96px;
  padding: 16px 20px;

  overflow-x: auto;

  color: var(--color-primary);
  background: white;
  border: 2px solid var(--color-primary);
  border-radius: 16px;

  font-size: 40px;
  font-weight: 850;
  line-height: 1;
  letter-spacing: 0.08em;
  white-space: nowrap;

  box-shadow:
    0 3px 8px rgb(15 34 53 / 5%),
    0 0 0 5px rgb(23 50 77 / 7%);
}

.code-line--empty {
  color: var(--color-muted);
  border-color: rgb(23 50 77 / 18%);

  font-size: 16px;
  font-weight: 650;
  letter-spacing: normal;
}

.hidden-code-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.number-pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 11px;
  margin-top: 18px;
}

.number-button {
  min-height: 64px;

  color: var(--color-text);
  background: linear-gradient(180deg, #ffffff, #f5f8fa);

  border: 1px solid rgb(23 50 77 / 12%);
  border-radius: 18px;

  font-size: 24px;
  font-weight: 750;

  box-shadow:
    0 3px 7px rgb(15 34 53 / 6%),
    0 7px 16px rgb(15 34 53 / 5%);

  transition:
    transform 120ms var(--ease-out),
    box-shadow 160ms var(--ease-out),
    background-color 160ms ease;
}

.number-button:hover {
  border-color: rgb(23 50 77 / 25%);

  box-shadow:
    0 5px 12px rgb(15 34 53 / 9%),
    0 11px 22px rgb(15 34 53 / 7%);

  transform: translateY(-2px);
}

.number-button:active {
  box-shadow: 0 2px 5px rgb(15 34 53 / 8%);
  transform: translateY(2px) scale(0.96);
}

.number-button--utility {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.suggestions-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;

  margin-bottom: 16px;
}

.suggestions-header h2 {
  margin: 0;
  font-size: 20px;
}

.suggestions-header p {
  margin: 5px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}

.result-count {
  padding: 5px 10px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 999px;

  font-size: 12px;
  font-weight: 800;
}

.suggestion-list {
  position: relative;
  display: grid;
  gap: 10px;
}

.suggestion-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;

  width: 100%;
  padding: 13px;

  color: var(--color-text);
  text-align: left;

  background: #fafbfd;
  border: 1px solid var(--color-border);
  border-radius: 17px;

  box-shadow: 0 4px 12px rgb(15 34 53 / 5%);

  transition:
    transform 180ms var(--ease-out),
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.suggestion-card:hover {
  background: var(--color-primary-soft);
  border-color: rgb(23 50 77 / 22%);
  box-shadow: 0 8px 18px rgb(15 34 53 / 8%);
  transform: translateX(3px);
}

.suggestion-card:active {
  transform: scale(0.98);
}

.suggestion-code {
  padding: 7px 9px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 10px;

  font-size: 13px;
  font-weight: 900;
}

.suggestion-info {
  min-width: 0;
}

.suggestion-info strong,
.suggestion-info small {
  display: block;
}

.friend-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-suffix {
  margin-left: 2px;

  color: var(--color-muted);
  font-size: 0.78em;
  font-weight: 700;
}

.suggestion-info small {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 11px;
}

.suggestion-balance {
  text-align: right;
}

.suggestion-balance strong,
.suggestion-balance small {
  display: block;
}

.suggestion-balance strong {
  color: var(--color-primary);
  font-size: 16px;
}

.suggestion-balance small {
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 10px;
}

.suggestion-arrow {
  color: var(--color-primary);
  font-size: 18px;
}

.suggestion-move,
.suggestion-enter-active,
.suggestion-leave-active {
  transition:
    opacity 500ms ease,
    transform 500ms cubic-bezier(0.22, 1, 0.36, 1);
}

.suggestion-enter-active {
  transition-delay: var(--delay);
}

.suggestion-leave-active {
  position: absolute;
  left: 0;
  right: 0;
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
  transform: translateY(30px);
}

.state-message,
.empty-state {
  padding: 28px 16px;
  color: var(--color-muted);
  text-align: center;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.empty-state p {
  margin: 0;
}

.empty-icon {
  display: grid;
  place-items: center;

  width: 52px;
  height: 52px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 50%;

  font-size: 21px;
  font-weight: 900;
}

.error-box {
  padding: 18px;

  color: #922c35;
  background: #fff1f2;
  border: 1px solid #f3c5c9;
  border-radius: 16px;
}

.error-box p {
  margin: 0 0 12px;
}

.error-box button {
  min-height: 42px;
  padding: 8px 14px;

  color: white;
  background: #922c35;
  border: 0;
  border-radius: 10px;

  font-weight: 700;
}

@media (min-width: 760px) {
  .code-search-page {
    padding: 34px 26px 54px;
  }

  .search-layout {
    grid-template-columns: minmax(300px, 0.85fr) minmax(0, 1.15fr);
    align-items: start;
  }

  .input-panel,
  .suggestions-panel {
    padding: 22px;
  }

  .suggestions-panel {
    min-height: 600px;
  }

  .number-button {
    min-height: 74px;
  }
}

@media (hover: none) {
  .number-button:hover,
  .suggestion-card:hover,
  .open-customer-button:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .code-slot--active {
    animation: none;
  }
}
</style>
