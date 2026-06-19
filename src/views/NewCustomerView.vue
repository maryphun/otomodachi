<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  cacheCustomer,
  createCustomer,
} from '../services/api'
import {
  recordRecentCustomer,
} from '../services/recentCustomers'

const router = useRouter()

const customerName = ref('')
const initialBalanceText = ref('')
const profilePublic = ref(false)

const isSaving = ref(false)
const errorMessage = ref('')

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

const normalizedName = computed(() => {
  return customerName.value.trim()
})

const initialBalance = computed(() => {
  return Number(initialBalanceText.value || 0)
})

const canSubmit = computed(() => {
  return (
    normalizedName.value.length > 0 &&
    Number.isInteger(initialBalance.value) &&
    initialBalance.value >= 0 &&
    !isSaving.value
  )
})

function goBack() {
  router.back()
}

function goHome() {
  router.push('/')
}

function addAmountDigit(digit) {
  if (isSaving.value) {
    return
  }

  const currentValue = String(
    initialBalanceText.value || '',
  )

  if (currentValue.length >= 10) {
    return
  }

  if (currentValue === '0') {
    initialBalanceText.value = String(digit)
    return
  }

  initialBalanceText.value =
    currentValue + String(digit)
}

function clearAmount() {
  if (isSaving.value) {
    return
  }

  initialBalanceText.value = ''
}

function removeAmountDigit() {
  if (isSaving.value) {
    return
  }

  initialBalanceText.value = String(
    initialBalanceText.value || '',
  ).slice(0, -1)
}

function clearName() {
  if (isSaving.value) {
    return
  }

  customerName.value = ''
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ja-JP')
}

async function submitCustomer() {
  errorMessage.value = ''

  if (!normalizedName.value) {
    errorMessage.value =
      'お名前を入力してください'
    return
  }

  if (
    !Number.isInteger(initialBalance.value) ||
    initialBalance.value < 0
  ) {
    errorMessage.value =
      '初期うにょは0以上の整数で入力してください'
    return
  }

  const confirmed = window.confirm(
    [
      `お名前：${normalizedName.value}さん`,
      `初期うにょ：${formatNumber(initialBalance.value)}`,
      `プロフィール公開：${profilePublic.value ? 'する' : 'しない'}`,
      '',
      'この内容で登録しますか？',
    ].join('\n'),
  )

  if (!confirmed) {
    return
  }

  isSaving.value = true
  errorMessage.value = ''

  try {
    const result = await createCustomer(
      normalizedName.value,
      initialBalance.value,
      profilePublic.value,
    )

    const newCustomer = {
      customerCode: String(result.customerCode),
      customerName:
        result.customerName ||
        normalizedName.value,
      currentBalance: Number(
        result.currentBalance ??
          result.initialBalance ??
          initialBalance.value,
      ),
      lastVisit: result.lastVisit || '',
      profilePublic: Boolean(
        result.profilePublic ?? profilePublic.value,
      ),
    }

    /*
     * 最近アクセスしたおともだちにも記録します。
     */
    recordRecentCustomer(newCustomer)
    cacheCustomer(newCustomer)

    /*
     * 登録したおともだちの詳細ページへ移動します。
     */
    router.replace(
      `/customer/${newCustomer.customerCode}`,
    )
  } catch (error) {
    console.error(error)

    errorMessage.value =
      error.message ||
      'おともだち登録に失敗しました'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <main class="new-customer-page">
    <header class="page-header">
      <button
        type="button"
        class="back-button"
        aria-label="戻る"
        :disabled="isSaving"
        @click="goBack"
      >
        ←
      </button>

      <div class="header-copy">
        <p class="eyebrow">
          NEW CUSTOMER
        </p>

        <h1>新しいおともだち</h1>
      </div>

      <button
        type="button"
        class="home-button"
        :disabled="isSaving"
        @click="goHome"
      >
        ホーム
      </button>
    </header>

    <form
      class="registration-card"
      @submit.prevent="submitCustomer"
    >
      <section class="form-section">
        <div class="section-heading">
          <span class="section-number">
            1
          </span>

          <div>
            <h2>お名前</h2>

            <p>
              お名前を入力してください
            </p>
          </div>
        </div>

        <div class="name-input-wrapper">
          <span class="name-icon">
            名
          </span>

          <input
            v-model="customerName"
            type="text"
            class="name-input"
            placeholder="例：メリー"
            autocomplete="name"
            maxlength="50"
            :disabled="isSaving"
          />

          <button
            v-if="customerName"
            type="button"
            class="clear-name-button"
            aria-label="名前を消去"
            :disabled="isSaving"
            @click="clearName"
          >
            ×
          </button>
        </div>
      </section>

      <section class="form-section">
        <div class="section-heading">
          <span class="section-number">
            2
          </span>

          <div>
            <h2>初期うにょ</h2>

            <p>
              登録時に持たせるうにょ数です
            </p>
          </div>
        </div>

        <div class="amount-display">
          <span>初期残高</span>

          <strong>
            {{ formatNumber(initialBalance) }}
          </strong>

          <small>うにょ</small>
        </div>

        <div class="amount-number-pad">
          <button
            v-for="number in numberKeys"
            :key="number"
            type="button"
            class="amount-key"
            :disabled="isSaving"
            @click="addAmountDigit(number)"
          >
            {{ number }}
          </button>

          <button
            type="button"
            class="amount-key amount-key--utility"
            :disabled="isSaving"
            @click="clearAmount"
          >
            C
          </button>

          <button
            type="button"
            class="amount-key"
            :disabled="isSaving"
            @click="addAmountDigit('0')"
          >
            0
          </button>

          <button
            type="button"
            class="amount-key amount-key--utility"
            aria-label="1文字削除"
            :disabled="isSaving"
            @click="removeAmountDigit"
          >
            ⌫
          </button>
        </div>
      </section>

      <section class="form-section">
        <div class="section-heading">
          <span class="section-number">
            3
          </span>

          <div>
            <h2>プロフィール公開</h2>

            <p>
              おともだち向けページで情報を公開するか設定します
            </p>
          </div>
        </div>

        <label class="profile-public-setting">
          <span class="profile-public-copy">
            <strong>
              プロフィールを公開する
            </strong>
          </span>

          <input
            v-model="profilePublic"
            type="checkbox"
            class="switch-input"
            :disabled="isSaving"
          />

          <span
            class="switch-control"
            aria-hidden="true"
          ></span>
        </label>
      </section>

      <p
        v-if="errorMessage"
        class="error-message"
      >
        {{ errorMessage }}
      </p>

      <section class="registration-preview">
        <p class="preview-label">
          登録内容
        </p>

        <div class="preview-row">
          <span>お名前</span>

          <strong>
            <template v-if="normalizedName">
              {{ normalizedName }}
              <span class="name-suffix">さん</span>
            </template>

            <template v-else>
              未入力
            </template>
          </strong>
        </div>

        <div class="preview-row">
          <span>初期うにょ</span>

          <strong>
            {{ formatNumber(initialBalance) }}
          </strong>
        </div>

        <div class="preview-row">
          <span>プロフィール公開</span>

          <strong
            :class="{
              'public-value': profilePublic,
              'private-value': !profilePublic,
            }"
          >
            {{ profilePublic ? '公開する' : '公開しない' }}
          </strong>
        </div>

        <div class="preview-row">
          <span>おともだちコード</span>

          <strong class="automatic-value">
            自動発行
          </strong>
        </div>
      </section>

      <button
        type="submit"
        class="register-button"
        :class="{
          'register-button--saving':
            isSaving,
        }"
        :disabled="!canSubmit"
      >
        <span v-if="isSaving">
          登録しています…
        </span>

        <span v-else>
          この内容で登録
        </span>
      </button>
    </form>
  </main>
</template>

<style scoped>
.new-customer-page {
  width: min(100%, 760px);
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
.clear-name-button {
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

.back-button:hover:not(:disabled) {
  transform: translateX(-3px);
}

.back-button:active:not(:disabled) {
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

.back-button:disabled,
.home-button:disabled {
  cursor: wait;
  opacity: 0.5;
}

.registration-card {
  display: grid;
  gap: 20px;

  padding: 22px;

  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 28px;

  box-shadow: var(--shadow-card);
}

.form-section {
  display: grid;
  gap: 15px;
}

.form-section + .form-section {
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-number {
  display: grid;
  flex: 0 0 auto;
  place-items: center;

  width: 40px;
  height: 40px;

  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 14px;

  font-size: 15px;
  font-weight: 900;
}

.section-heading h2,
.section-heading p {
  margin: 0;
}

.section-heading h2 {
  font-size: 18px;
}

.section-heading p {
  margin-top: 3px;

  color: var(--color-muted);
  font-size: 12px;
}

.name-input-wrapper {
  display: grid;
  grid-template-columns:
    auto
    minmax(0, 1fr)
    auto;

  align-items: center;
  gap: 12px;

  min-height: 68px;
  padding: 8px 10px 8px 14px;

  background: #f7f9fb;
  border: 2px solid transparent;
  border-radius: 20px;

  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.name-input-wrapper:focus-within {
  background: white;
  border-color: rgb(23 50 77 / 28%);

  box-shadow:
    0 0 0 5px rgb(23 50 77 / 7%),
    0 10px 26px rgb(15 34 53 / 8%);
}

.name-icon {
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

.name-input {
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

.name-input::placeholder {
  color: #9ba1a8;
  font-weight: 500;
}

.clear-name-button {
  display: grid;
  place-items: center;

  width: 42px;
  height: 42px;

  color: var(--color-muted);
  background: #e9edf1;
  border-radius: 50%;

  font-size: 22px;

  transition:
    transform 140ms var(--ease-out),
    background-color 140ms ease;
}

.clear-name-button:hover:not(:disabled) {
  background: #dde3e8;
}

.clear-name-button:active:not(:disabled) {
  transform: scale(0.9);
}

.amount-display {
  padding: 18px;

  color: white;
  background: var(--color-primary);
  border-radius: 21px;

  box-shadow:
    0 12px 28px
    rgb(15 34 53 / 16%);
}

.amount-display span,
.amount-display small {
  display: block;
}

.amount-display span {
  color: rgb(255 255 255 / 72%);
  font-size: 12px;
  font-weight: 750;
}

.amount-display strong {
  display: block;
  margin-top: 6px;

  font-size: clamp(
    38px,
    11vw,
    58px
  );

  line-height: 1.05;
  text-align: right;
}

.amount-display small {
  margin-top: 5px;

  color: rgb(255 255 255 / 72%);
  text-align: right;
}

.amount-number-pad {
  display: grid;
  grid-template-columns:
    repeat(3, 1fr);

  gap: 11px;
}

.amount-key {
  min-height: 62px;

  color: var(--color-text);
  background: linear-gradient(
    180deg,
    #ffffff,
    #f5f8fa
  );

  border: 1px solid rgb(23 50 77 / 12%);
  border-radius: 18px;

  font-size: 22px;
  font-weight: 850;

  box-shadow:
    0 3px 7px rgb(15 34 53 / 6%),
    0 7px 16px rgb(15 34 53 / 5%);

  cursor: pointer;

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

.profile-public-setting {
  position: relative;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;

  min-height: 82px;
  padding: 16px;

  background: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 18px;

  cursor: pointer;
}

.profile-public-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.profile-public-copy strong {
  font-size: 15px;
}

.profile-public-copy small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.switch-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.switch-control {
  position: relative;
  flex: 0 0 auto;

  width: 56px;
  height: 32px;

  background: #c8cdd3;
  border-radius: 999px;

  transition: background-color 180ms ease;
}

.switch-control::after {
  content: '';

  position: absolute;
  top: 4px;
  left: 4px;

  width: 24px;
  height: 24px;

  background: white;
  border-radius: 50%;
  box-shadow: 0 2px 7px rgb(15 34 53 / 22%);

  transition: transform 180ms var(--ease-out);
}

.switch-input:checked + .switch-control {
  background: #2b7a4b;
}

.switch-input:checked + .switch-control::after {
  transform: translateX(24px);
}

.switch-input:focus-visible + .switch-control {
  outline: 3px solid rgb(23 50 77 / 24%);
  outline-offset: 3px;
}

.switch-input:disabled + .switch-control {
  opacity: 0.55;
}

.public-value {
  color: #197044;
}

.private-value {
  color: var(--color-muted);
}

.registration-preview {
  display: grid;
  gap: 11px;

  padding: 17px;

  background: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 18px;
}

.preview-label {
  margin: 0 0 2px;

  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.preview-row span {
  color: var(--color-muted);
  font-size: 13px;
}

.preview-row strong {
  overflow: hidden;

  font-size: 14px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-row .name-suffix {
  margin-left: 2px;

  color: var(--color-muted);
  font-size: 0.82em;
  font-weight: 700;
}

.automatic-value {
  color: var(--color-primary);
}

.error-message {
  margin: 0;
  padding: 12px 14px;

  color: #9a3039;
  background: #fff0f1;
  border-radius: 13px;

  font-size: 14px;
  font-weight: 750;
}

.register-button {
  min-height: 60px;
  padding: 14px 20px;

  color: white;
  background: var(--color-primary);
  border: 0;
  border-radius: 19px;

  font-size: 17px;
  font-weight: 850;

  box-shadow:
    0 11px 25px
    rgb(23 50 77 / 22%);

  cursor: pointer;

  transition:
    transform 180ms var(--ease-out),
    opacity 180ms ease;
}

.register-button:hover:not(:disabled) {
  transform: translateY(-2px);
}

.register-button:active:not(:disabled) {
  transform: scale(0.98);
}

.register-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.register-button--saving:disabled {
  cursor: wait;
  opacity: 0.75;
}

.register-button--saving::after {
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

@media (min-width: 700px) {
  .new-customer-page {
    padding: 34px 28px 60px;
  }

  .registration-card {
    padding: 28px;
  }
}

@media (hover: none) {
  .amount-key:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .register-button--saving::after {
    animation-duration: 1ms;
  }
}
</style>
