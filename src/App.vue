<script setup>
import { RouterView } from 'vue-router'

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
</template>

<style>
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

.page-slide-enter-active :where(button, .menu-card, .suggestion-card, .transaction-card, .customer-card, .action-button, .search-card, .registration-card, .profile-public-card) {
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

  .page-slide-enter-active :where(button, .menu-card, .suggestion-card, .transaction-card, .customer-card, .action-button, .search-card, .registration-card, .profile-public-card) {
    animation-duration: 1ms;
  }
}
</style>
