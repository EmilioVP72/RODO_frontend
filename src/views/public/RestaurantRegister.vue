<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'

const router = useRouter()

// Modo de pantalla: 'register' o 'login'
const activeTab = ref('register')

// Formulario de registro
const restaurantName = ref('')
const loading = ref(false)
const error = ref('')

// Formulario de login / ingreso
const loginIdentifier = ref('')
const loginLoading = ref(false)
const loginError = ref('')

// Detectar si el error es de restaurante duplicado para ofrecer login rápido
const isDuplicateError = ref(false)

async function registerRestaurant() {
  error.value = ''
  isDuplicateError.value = false

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

    // Guardar tokens y datos para persistencia robusta cross-domain
    if (restaurant.token) {
      localStorage.setItem('rodo_token', restaurant.token)
      sessionStorage.setItem('rodo_token', restaurant.token)
    }

    if (restaurant.code) {
      localStorage.setItem('rodo_restaurant_code', restaurant.code)
      sessionStorage.setItem('rodo_restaurant_code', restaurant.code)
    }

    const payload = {
      id: restaurant.id,
      name: restaurant.name,
      code: restaurant.code,
      token: restaurant.token || null,
    }

    localStorage.setItem('rodo_restaurant', JSON.stringify(payload))
    sessionStorage.setItem('rodo_registration_result', JSON.stringify(payload))

    await router.push('/registro/exitoso')

  } catch (err) {
    console.error('Error al registrar restaurante:', err)

    if (err.response?.status === 422) {
      const errors = err.response.data?.errors || {}
      const msg = Object.values(errors).flat().join(' ') || 'Ya existe un restaurante registrado con este nombre.'
      error.value = msg

      if (msg.toLowerCase().includes('ya existe')) {
        isDuplicateError.value = true
      }

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

async function loginRestaurant() {
  loginError.value = ''

  const identifier = loginIdentifier.value.trim()

  if (!identifier) {
    loginError.value = 'Ingresa el nombre o tu código de 3 dígitos.'
    return
  }

  loginLoading.value = true

  try {
    await initializeCsrf()

    const response = await api.post('/restaurant/login', {
      identifier,
    })

    const restaurant = response.data.data

    if (restaurant.token) {
      localStorage.setItem('rodo_token', restaurant.token)
      sessionStorage.setItem('rodo_token', restaurant.token)
    }

    if (restaurant.code) {
      localStorage.setItem('rodo_restaurant_code', restaurant.code)
      sessionStorage.setItem('rodo_restaurant_code', restaurant.code)
    }

    const payload = {
      id: restaurant.id,
      name: restaurant.name,
      code: restaurant.code,
      token: restaurant.token || null,
    }

    localStorage.setItem('rodo_restaurant', JSON.stringify(payload))
    sessionStorage.setItem('rodo_registration_result', JSON.stringify(payload))

    await router.push('/pedidos/nuevo')

  } catch (err) {
    console.error('Error al iniciar sesión:', err)

    if (err.response?.status === 404) {
      loginError.value = 'No se encontró un restaurante con ese nombre o código.'
    } else {
      loginError.value = err.response?.data?.message || 'Error al iniciar sesión. Inténtalo nuevamente.'
    }

  } finally {
    loginLoading.value = false
  }
}

function switchToLoginWithName() {
  loginIdentifier.value = restaurantName.value.trim()
  activeTab.value = 'login'
  error.value = ''
  isDuplicateError.value = false
}
</script>

<template>
  <main class="register-page">
    <div class="register-container">

      <header class="brand-header">
        <div class="brand-logo">R</div>
        <h1>RODO</h1>
        <p class="brand-subtitle">Moto Mandados · Portal de Restaurantes</p>
      </header>

      <section class="register-card">

        <!-- Selector de pestañas -->
        <div class="auth-tabs">
          <button
            type="button"
            :class="['tab-btn', { active: activeTab === 'register' }]"
            @click="activeTab = 'register'; error = ''; loginError = ''"
          >
            Registrar restaurante
          </button>
          <button
            type="button"
            :class="['tab-btn', { active: activeTab === 'login' }]"
            @click="activeTab = 'login'; error = ''; loginError = ''"
          >
            Ya tengo cuenta
          </button>
        </div>

        <!-- FORMULARIO 1: REGISTRO -->
        <div v-if="activeTab === 'register'">
          <div class="card-heading">
            <h2>Nuevo registro</h2>
            <p>
              Registra tu establecimiento para obtener tu código y comenzar a solicitar servicios de entrega.
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
                Este nombre aparecerá en tus pedidos y tickets digitales.
              </small>
            </div>

            <div
              v-if="error"
              class="error-message"
              role="alert"
            >
              <p>{{ error }}</p>
              <button
                v-if="isDuplicateError"
                type="button"
                class="btn-switch-login"
                @click="switchToLoginWithName"
              >
                ¿Es tu restaurante? Ingresar aquí →
              </button>
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
        </div>

        <!-- FORMULARIO 2: LOGIN / INGRESO -->
        <div v-else>
          <div class="card-heading">
            <h2>Ingresar a tu restaurante</h2>
            <p>
              Ingresa con tu código único de 3 dígitos (ej. 492) o el nombre de tu restaurante registrado.
            </p>
          </div>

          <form @submit.prevent="loginRestaurant">
            <div class="form-group">
              <label for="loginIdentifier">
                Código de 3 dígitos o Nombre
              </label>

              <input
                id="loginIdentifier"
                v-model="loginIdentifier"
                type="text"
                placeholder="Ej. 492 o Tacos El Buen Sabor"
                minlength="2"
                maxlength="150"
                :disabled="loginLoading"
                required
              />

              <small>
                Puedes usar el código de 3 dígitos que te asignó el sistema.
              </small>
            </div>

            <div
              v-if="loginError"
              class="error-message"
              role="alert"
            >
              {{ loginError }}
            </div>

            <button
              type="submit"
              class="submit-button"
              :disabled="loginLoading || !loginIdentifier.trim()"
            >
              <span v-if="loginLoading">
                Iniciando sesión...
              </span>
              <span v-else>
                Ingresar al sistema
              </span>
            </button>
          </form>
        </div>

      </section>

      <footer class="register-footer">
        <p>
          © {{ new Date().getFullYear() }} RODO Moto Mandados
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
  margin-bottom: 24px;
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
  box-shadow: 0 4px 14px rgba(215, 25, 32, 0.3);
}

.brand-header h1 {
  margin: 0;
  color: #d71920;
  font-size: 34px;
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
  padding: 30px;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.07);
}

.auth-tabs {
  display: flex;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 24px;
  gap: 4px;
}

.tab-btn {
  flex: 1;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: #64748b;
  font-weight: 600;
  font-size: 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: #fff;
  color: #d71920;
  font-weight: 700;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.card-heading {
  margin-bottom: 24px;
}

.card-heading h2 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #1e293b;
  font-weight: 700;
}

.card-heading p {
  margin: 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.5;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.form-group input {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  font-size: 15px;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #d71920;
  box-shadow: 0 0 0 3px rgba(215, 25, 32, 0.12);
}

.form-group input:disabled {
  background: #f8fafc;
}

.form-group small {
  color: #888;
  font-size: 12px;
  line-height: 1.4;
}

.error-message {
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #9f1239;
  font-size: 13px;
  line-height: 1.5;
}

.error-message p {
  margin: 0 0 8px;
}

.btn-switch-login {
  background: #d71920;
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: inline-block;
}

.btn-switch-login:hover {
  background: #b9151b;
}

.submit-button {
  width: 100%;
  margin-top: 24px;
  padding: 14px 16px;
  border: none;
  border-radius: 9px;
  background: linear-gradient(135deg, #d71920, #b9151b);
  color: white;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s;
  box-shadow: 0 4px 12px rgba(215, 25, 32, 0.25);
}

.submit-button:hover:not(:disabled) {
  opacity: 0.95;
}

.submit-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.register-footer {
  margin-top: 24px;
  text-align: center;
}

.register-footer p {
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 480px) {
  .register-card {
    padding: 22px 18px;
  }

  .brand-header h1 {
    font-size: 28px;
  }
}
</style>
