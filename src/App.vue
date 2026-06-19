<script setup>
import {
  onBeforeUnmount,
  ref,
} from 'vue'
import {
  RouterView,
  useRouter,
} from 'vue-router'

const router = useRouter()
const isRouteLoading = ref(false)

let routeLoadingTimer

function showRouteLoading() {
  window.clearTimeout(routeLoadingTimer)
  isRouteLoading.value = true
}

function hideRouteLoading() {
  window.clearTimeout(routeLoadingTimer)

  routeLoadingTimer = window.setTimeout(() => {
    isRouteLoading.value = false
  }, 280)
}

function resetPageScroll() {
  document.getElementById('app')?.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto',
  })
}

const removeBeforeGuard = router.beforeEach((to, from) => {
  if (to.fullPath !== from.fullPath) {
    showRouteLoading()
  }
})

const removeAfterGuard = router.afterEach(() => {
  hideRouteLoading()
})

onBeforeUnmount(() => {
  window.clearTimeout(routeLoadingTimer)
  removeBeforeGuard()
  removeAfterGuard()
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-shell--loading': isRouteLoading,
    }"
  >
    <div
      class="route-progress"
      aria-hidden="true"
    >
      <span />
    </div>

    <RouterView v-slot="{ Component, route }">
      <Transition
        name="page-slide"
        mode="out-in"
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

.route-progress {
  position: fixed;
  z-index: 3000;
  top: 0;
  right: 0;
  left: 0;

  height: 3px;

  pointer-events: none;
  opacity: 0;

  transform: translateY(-3px);

  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.route-progress span {
  display: block;
  width: 100%;
  height: 100%;

  background:
    linear-gradient(
      90deg,
      transparent,
      rgb(23 50 77 / 35%),
      transparent
    ),
    var(--color-primary);

  border-radius: 0 999px 999px 0;
  box-shadow: 0 0 18px rgb(23 50 77 / 26%);

  transform: translateX(-100%) scaleX(0.48);
  transform-origin: left center;
}

.app-shell--loading .route-progress {
  opacity: 1;
  transform: translateY(0);
}

.app-shell--loading .route-progress span {
  animation: route-progress-sweep 900ms var(--ease-out)
    infinite;
}

.page-slide-enter-active {
  transition:
    opacity 230ms ease,
    transform 280ms var(--ease-out),
    filter 280ms ease;
}

.page-slide-leave-active {
  transition:
    opacity 150ms ease,
    transform 160ms ease,
    filter 160ms ease;
}

.page-slide-enter-from {
  opacity: 0;
  filter: blur(5px);
  transform: translate3d(0, 16px, 0) scale(0.992);
}

.page-slide-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: translate3d(0, -8px, 0) scale(0.998);
}

@keyframes route-progress-sweep {
  0% {
    transform: translateX(-100%) scaleX(0.45);
  }

  55% {
    transform: translateX(-12%) scaleX(0.82);
  }

  100% {
    transform: translateX(100%) scaleX(0.45);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-shell--loading .route-progress span {
    animation-duration: 1ms;
  }

  .page-slide-enter-active,
  .page-slide-leave-active {
    transition-duration: 1ms;
  }

  .page-slide-enter-from,
  .page-slide-leave-to {
    filter: none;
    transform: none;
  }
}
</style>
