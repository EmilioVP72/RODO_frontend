import { createRouter, createWebHistory } from 'vue-router'

import RestaurantRegister from '../views/public/RestaurantRegister.vue'
import OrderForm from '../views/restaurant/OrderForm.vue'
import PublicTicket from '../views/public/PublicTicket.vue'

const routes = [
  {
    path: '/',
    redirect: '/registro',
  },
  {
    path: '/registro',
    alias: ['/login'],
    name: 'restaurant-register',
    component: RestaurantRegister,
  },
  {
    path: '/pedidos/nuevo',
    name: 'new-order',
    component: OrderForm,
  },
  {
    path: '/admin',
    name: 'admin-dashboard',
    component: () => import('../views/admin/AdminDashboard.vue'),
  },
  {
    path: '/ticket/:token',
    name: 'public-ticket',
    component: PublicTicket,
  },
  {
    path: '/solicitud/:token',
    name: 'public-rider-request',
    component: () => import('../views/public/PublicRiderRequest.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
