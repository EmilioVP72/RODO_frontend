import { createRouter, createWebHistory } from 'vue-router'

import RestaurantRegister from '../views/public/RestaurantRegister.vue'
import RegistrationSuccess from '../views/restaurant/RegistrationSuccess.vue'

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
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router