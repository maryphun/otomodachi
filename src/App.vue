<script setup>
import { RouterView } from 'vue-router'
import { onMounted, onBeforeUnmount, ref } from 'vue'

const syncUnavailable = ref(false)
const syncRecovering = ref(false)
const unresolvedSave = ref(false)
const syncProblem = ref('')
function hideUnverifiedData(event) {
  syncUnavailable.value = true
  syncRecovering.value = Boolean(event.detail?.recovering)
  unresolvedSave.value = Boolean(event.detail?.unresolved)
  syncProblem.value = event.detail?.problem || ''
}
function restoreVerifiedData() { syncUnavailable.value = false }
function reloadPage() { window.location.reload() }
function retrySync() { window.dispatchEvent(new CustomEvent('otomo-sync-retry')) }
onMounted(() => {
  window.addEventListener('otomo-sync-unavailable', hideUnverifiedData)
  window.addEventListener('otomo-sync-restored', restoreVerifiedData)
})
onBeforeUnmount(() => {
  window.removeEventListener('otomo-sync-unavailable', hideUnverifiedData)
  window.removeEventListener('otomo-sync-restored', restoreVerifiedData)
})

function resetPageScroll() {
  document.getElementById('app')?.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto',
  })
}
</script>

<template>
  <div class="app-shell">
    <section v-if="syncUnavailable" class="sync-unavailable" role="status" aria-live="polite" :aria-busy="syncRecovering">
      <template v-if="unresolvedSave">
        <h1>操作結果の確認が必要です</h1>
        <p>前回の保存結果を確認できません。操作を繰り返さず、スタッフに記録の確認をお願いしてください。</p>
        <button type="button" @click="reloadPage">再読み込み</button>
      </template>
      <template v-else-if="syncProblem">
        <h1>記録を確認してください</h1>
        <p>{{ syncProblem }}</p>
        <button type="button" @click="retrySync">もう一度確認</button>
      </template>
      <template v-else>
        <span v-if="syncRecovering" class="sync-spinner" aria-hidden="true"></span>
        <h1>{{ syncRecovering ? '最新の記録を確認しています…' : '同期に時間がかかっています' }}</h1>
        <p>{{ syncRecovering ? '入力した内容はそのままでお待ちください。' : '接続を自動で確認しています。入力した内容は保持されています。' }}</p>
        <button v-if="!syncRecovering" type="button" @click="retrySync">もう一度確認</button>
      </template>
    </section>
    <div :inert="syncUnavailable" :hidden="syncUnavailable">
    <RouterView v-slot="{ Component, route }">
      <Transition
        name="page-slide"
        @before-enter="resetPageScroll"
      >
        <component
          :is="Component"
          :key="route.fullPath"
        />
      </Transition>
    </RouterView>
    </div>
  </div>
</template>

<style>
.sync-unavailable {
  max-width: 540px;
  margin: 0 auto;
  padding: 64px 24px;
  color: #10233a;
  overflow-wrap: anywhere;
}
.sync-unavailable h1 { font-size: 24px; }
.sync-spinner {
  display: block;
  width: 28px;
  height: 28px;
  margin-bottom: 20px;
  border: 3px solid #d9e2ea;
  border-top-color: #193b56;
  border-radius: 50%;
  animation: sync-spin 900ms linear infinite;
}
@keyframes sync-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sync-spinner { animation: none; } }
.sync-unavailable p { font-size: 16px; line-height: 1.6; }
.sync-unavailable button {
  margin-top: 16px;
  padding: 14px 24px;
  border: 0;
  border-radius: 8px;
  color: white;
  background: #193b56;
  cursor: pointer;
}
.sync-unavailable button:hover { background: #245273; }
.sync-unavailable button:focus-visible { outline: 3px solid #d61c84; outline-offset: 3px; }
.app-shell {
  position: relative;
  min-height: 100dvh;
  isolation: isolate;
}

.page-slide-enter-active {
  transition:
    opacity 130ms ease,
    transform 160ms var(--ease-out);
}

.page-slide-leave-active {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;

  pointer-events: none;

  transition:
    opacity 90ms ease,
    transform 110ms ease;
}

.page-slide-enter-from {
  opacity: 0;
  transform: translate3d(16px, 0, 0) scale(0.996);
}

.page-slide-leave-to {
  opacity: 0;
  transform: translate3d(-10px, 0, 0) scale(0.998);
}

.page-slide-enter-active :where(button, .menu-card, .suggestion-card, .transaction-card, .customer-card, .action-button, .search-card, .registration-card, .ledger-info-card) {
  animation: page-control-in 170ms var(--ease-out) both;
}

@keyframes page-control-in {
  from {
    opacity: 0;
    transform: translate3d(0, 8px, 0) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-slide-enter-active,
  .page-slide-leave-active {
    transition-duration: 1ms;
  }

  .page-slide-enter-from,
  .page-slide-leave-to {
    transform: none;
  }

  .page-slide-enter-active :where(button, .menu-card, .suggestion-card, .transaction-card, .customer-card, .action-button, .search-card, .registration-card, .ledger-info-card) {
    animation-duration: 1ms;
  }
}
</style>
