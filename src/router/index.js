import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import CodeSearchView from '../views/CodeSearchView.vue'
import CustomerView from '../views/CustomerView.vue'
import NameSearchView from '../views/NameSearchView.vue'
import RecentCustomersView from '../views/RecentCustomersView.vue'
import NewCustomerView from '../views/NewCustomerView.vue'
import TodayHistoryView from '../views/TodayHistoryView.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/about',
      name: 'about',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/AboutView.vue'),
    },
    {
      path: '/code-search',
      name: 'code-search',
      component: CodeSearchView,
    },
    {
      path: '/customer/:customerCode',
      name: 'customer',
      component: CustomerView,
    },
    {
      path: '/search/name',
      name: 'name-search',
      component: NameSearchView,
    },
    {
      path: '/recent-customers',
      name: 'recent-customers',
      component: RecentCustomersView,
    },
    {
      path: '/new-customer',
      name: 'new-customer',
      component: NewCustomerView,
    },
    {
      path: '/today-history',
      name: 'today-history',
      component: TodayHistoryView,
    },
  ],
})

export default router
