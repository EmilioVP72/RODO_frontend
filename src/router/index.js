import { createRouter, createWebHistory } from 'vue-router'

import RestaurantRegister from '../views/public/RestaurantRegister.vue'
import RegistrationSuccess from '../views/restaurant/RegistrationSuccess.vue'
import OrderForm from '../views/restaurant/OrderForm.vue'
import PublicTicket from '../views/public/PublicTicket.vue'

const routes = [
  {
    path: '/',
    redirect: '/registro',
  },
  {
    path: '/registro',
    name: 'restaurant-register',
    component: RestaurantRegister,
  },
  {
    path: '/registro/exitoso',
    name: 'registration-success',
    component: RegistrationSuccess,
  },
  {
    path: '/pedidos/nuevo',
    name: 'new-order',
    component: OrderForm,
  },
  {
    path: '/ticket/:token',
    name: 'public-ticket',
    component: PublicTicket,
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router