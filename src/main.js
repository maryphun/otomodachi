import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { clearLegacyFinancialCaches } from './services/api'
import { startSyncMonitor } from './services/syncMonitor'
import { getRecentCustomers } from './services/recentCustomers'

clearLegacyFinancialCaches()
getRecentCustomers()

const stopSyncMonitor = startSyncMonitor()
if (import.meta.hot) import.meta.hot.dispose(stopSyncMonitor)

const app = createApp(App)

app.use(router)

app.mount('#app')
