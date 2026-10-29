
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'

const router = useRouter()

const restaurantName = ref('')
const loading = ref(false)
const error = ref('')

async function registerRestaurant() {
  error.value = ''

  const name = restaurantName.value.trim()

  if (name.length < 2) {
    error.value = 'El nombre debe tener al menos 2 caracteres.'
    return
  }

  if (name.length > 150) {
    error.value = 'El nombre no puede superar los 150 caracteres.'
    return
  }

  loading.value = true

  try {
    await initializeCsrf()

    const response = await api.post('/restaurants', {
      name,
    })

    const restaurant = response.data.data

    sessionStorage.setItem(
      'rodo_registration_result',
      JSON.stringify({
        id: restaurant.id,
        name: restaurant.name,
        code: restaurant.code,
      })
    )

    await router.push('/registro/exitoso')

  } catch (err) {
    console.error('Error al registrar restaurante:', err)

    if (err.response?.status === 422) {
      const errors = err.response.data?.errors || {}

      error.value =
        Object.values(errors).flat().join(' ') ||
        'Verifica los datos del formulario.'

    } else if (err.response?.status === 419) {
      error.value =
        'La sesión de seguridad expiró. Recarga la página e inténtalo nuevamente.'

    } else if (err.response?.status === 429) {
      error.value =
        'Demasiados intentos de registro. Espera un momento.'

    } else if (err.response?.status >= 500) {
      error.value =
        'Ocurrió un error en el servidor. Inténtalo más tarde.'

    } else if (!err.response) {
      error.value =
        'No se pudo conectar con el servidor de RODO.'

    } else {
      error.value =
        err.response?.data?.message ||
        'No fue posible registrar el restaurante.'
    }

  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="register-page">
    <div class="register-container">

      <header class="brand-header">
        <div class="brand-logo">R</div>

        <h1>RODO</h1>
        <p class="brand-subtitle">Moto Mandados</p>
      </header>

      <section class="register-card">
        <div class="card-heading">
          <h2>Registro de restaurante</h2>

          <p>
            Registra tu establecimiento para comenzar
            a solicitar servicios de entrega.
          </p>
        </div>

        <form @submit.prevent="registerRestaurant">
          <div class="form-group">
            <label for="restaurantName">
              Nombre del restaurante
            </label>

            <input
              id="restaurantName"
              v-model="restaurantName"
              type="text"
              placeholder="Ej. Tacos El Buen Sabor"
              minlength="2"
              maxlength="150"
              autocomplete="organization"
              :disabled="loading"
              required
            />

            <small>
              Este nombre aparecerá en tus pedidos
              y tickets digitales.
            </small>
          </div>

          <div
            v-if="error"
            class="error-message"
            role="alert"
          >
            {{ error }}
          </div>

          <button
            type="submit"
            class="submit-button"
            :disabled="loading || !restaurantName.trim()"
          >
            <span v-if="loading">
              Registrando restaurante...
            </span>

            <span v-else>
              Registrar restaurante
            </span>
          </button>
        </form>
      </section>

      <footer class="register-footer">
        <p>
          © {{ new Date().getFullYear() }}
          RODO Moto Mandados
        </p>
      </footer>

    </div>
  </main>
</template>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #f6f7f9;
}

.register-container {
  width: 100%;
  max-width: 460px;
}

.brand-header {
  text-align: center;
  margin-bottom: 28px;
}

.brand-logo {
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: #d71920;
  color: #fff;
  font-size: 36px;
  font-weight: 800;
}

.brand-header h1 {
  margin: 0;
  color: #d71920;
  font-size: 36px;
  font-weight: 800;
  letter-spacing: 2px;
}

.brand-subtitle {
  margin: 4px 0 0;
  color: #555;
  font-size: 14px;
  font-weight: 600;
}

.register-card {
  background: #fff;
  padding: 32px;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.07);
}

.card-heading {
  margin-bottom: 28px;
}

.card-heading h2 {
  margin: 0 0 10px;
  font-size: 23px;
  color: #222;
}

.card-heading p {
  margin: 0;
  color: #666;
  font-size: 14px;
  line-height: 1.6;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.form-group input {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid #d5d8dc;
  border-radius: 9px;
  font-size: 15px;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #d71920;
  box-shadow: 0 0 0 3px rgba(215, 25, 32, 0.1);
}

.form-group input:disabled {
  background: #f5f5f5;
}

.form-group small {
  color: #888;
  font-size: 12px;
  line-height: 1.5;
}

.error-message {
  margin-top: 18px;
  padding: 13px;
  border-radius: 8px;
  background: #fff0f0;
  color: #a00000;
  font-size: 13px;
  line-height: 1.5;
}

.submit-button {
  width: 100%;
  margin-top: 24px;
  padding: 14px 16px;
  border: none;
  border-radius: 9px;
  background: #d71920;
  color: white;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.submit-button:hover:not(:disabled) {
  background: #b8151b;
}

.submit-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.register-footer {
  margin-top: 26px;
  text-align: center;
}

.register-footer p {
  color: #999;
  font-size: 12px;
}

@media (max-width: 480px) {
  .register-card {
    padding: 24px 20px;
  }

  .brand-header h1 {
    font-size: 30px;
  }

  .card-heading h2 {
    font-size: 21px;
  }
}
</style>
