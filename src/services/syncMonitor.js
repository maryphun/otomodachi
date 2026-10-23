import {
  checkServerChanges, acknowledgeServerChanges, isWriteInFlight,
  hasUnresolvedWrites, isEditInProgress, hasBusinessDateChanged,
} from './api'

export function startSyncMonitor() {
  let wasHidden = document.visibilityState === 'hidden'
  let refreshPending = false
  let checking = false
  let recoveryTimer

  function notify(recovering, unresolved = false, problem = '') {
    window.dispatchEvent(new CustomEvent('otomo-sync-unavailable', { detail: { recovering, unresolved, problem } }))
  }

  function retryLater() {
    window.clearTimeout(recoveryTimer)
    recoveryTimer = window.setTimeout(() => { void refresh() }, 5000)
  }

  async function refresh() {
    if (document.visibilityState !== 'visible' || checking) return
    if (isWriteInFlight()) {
      if (refreshPending) retryLater()
      return
    }
    checking = true
    try {
      refreshPending = (await checkServerChanges(() => {
        refreshPending = true
        if (!isWriteInFlight()) notify(true, hasUnresolvedWrites())
      })) || refreshPending
      // A save can start while the status request is in flight. Never interrupt it.
      if (isWriteInFlight()) {
        if (refreshPending) retryLater()
        return
      }
      if (!refreshPending || document.visibilityState !== 'visible') return
      if (hasUnresolvedWrites()) {
        notify(false, true)
        return
      }
      if (isEditInProgress()) {
        notify(true)
        const refreshes = []
        window.dispatchEvent(new CustomEvent('otomo-sync-refresh-draft', {
          detail: { dayChanged: hasBusinessDateChanged(), waitUntil(promise) { refreshes.push(promise) } },
        }))
        if (!refreshes.length) throw new Error('No active draft refresh handler')
        await Promise.all(refreshes)
        if (isWriteInFlight() || hasUnresolvedWrites()) {
          retryLater()
          return
        }
        acknowledgeServerChanges()
        refreshPending = false
        window.dispatchEvent(new CustomEvent('otomo-sync-restored'))
      } else {
        // Preserve visibility refresh behavior, but never reload a draft or a save.
        window.location.reload()
      }
    } catch (error) {
      console.error('Could not refresh server data', error)
      refreshPending = true
      if (!isWriteInFlight()) {
        notify(false, hasUnresolvedWrites(), error.code === 'RECORD_VERIFICATION_REQUIRED' ? error.message : '')
      }
      retryLater()
    } finally {
      checking = false
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') wasHidden = true
    else if (document.visibilityState === 'visible' && wasHidden) {
      wasHidden = false
      refreshPending = true
      void refresh()
    }
  }
  function onReadUnavailable() {
    // An initial route load may have failed before any timestamp was observed.
    refreshPending = true
    retryLater()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('otomo-sync-retry', refresh)
  window.addEventListener('otomo-read-recovery-needed', onReadUnavailable)
  const interval = window.setInterval(() => { void refresh() }, 30000)
  return () => {
    window.clearInterval(interval)
    window.clearTimeout(recoveryTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('otomo-sync-retry', refresh)
    window.removeEventListener('otomo-read-recovery-needed', onReadUnavailable)
  }
}
