<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const restaurant = computed(() => {
  try {
    const data = sessionStorage.getItem(
      'rodo_registration_result'
    )

    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
})

function continueToOrders() {
  router.push('/pedidos/nuevo')
}
</script>

<template>
  <main class="page">
    <section v-if="restaurant" class="card center">
      <div class="success-icon">✓</div>

      <h2>¡Registro exitoso!</h2>

      <p class="description">
        {{ restaurant.name }} se ha registrado
        correctamente en RODO.
      </p>

      <div class="code-box">
        <span>Tu código de identificación</span>

        <strong>{{ restaurant.code }}</strong>

        <small>
          Conserva este código para identificar
          tu restaurante.
        </small>
      </div>

      <button @click="continueToOrders">
        Continuar al formulario de pedidos
      </button>
    </section>

    <section v-else class="card center">
      <h2>Registro no encontrado</h2>
      <p class="description">
        No hay una confirmación de registro
        disponible en esta sesión.
      </p>

      <button @click="router.push('/registro')">
        Ir al registro
      </button>
    </section>
  </main>
</template>