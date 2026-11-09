<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'
import { appBranding, applyBrandingState, fetchAppBranding } from '../../services/branding'

const router = useRouter()

// Formulario de login / ingreso exclusivo para cuentas autorizadas
const loginIdentifier = ref('')
const loginLoading = ref(false)
const loginError = ref('')

onMounted(() => {
  fetchAppBranding()
})

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

    // Verificar si es acceso de Administrador (000)
    if (identifier === '000' || response.data.is_admin || restaurant?.code === '000') {
      const adminToken = restaurant?.token || '000'
      localStorage.setItem('rodo_admin_token', adminToken)
      sessionStorage.setItem('rodo_admin_token', adminToken)
      await router.push('/admin')
      return
    }

    if (restaurant.token) {
      localStorage.setItem('rodo_token', restaurant.token)
      sessionStorage.setItem('rodo_token', restaurant.token)
    }

    if (restaurant.code) {
      localStorage.setItem('rodo_restaurant_code', restaurant.code)
      sessionStorage.setItem('rodo_restaurant_code', restaurant.code)
    }

    if (restaurant.branding) {
      applyBrandingState(restaurant.branding)
    }

    const payload = {
      id: restaurant.id,
      name: restaurant.name,
      code: restaurant.code,
      photo_url: restaurant.photo_url || null,
      location_url: restaurant.location_url || null,
      description: restaurant.description || null,
      fixed_delivery_fee: restaurant.fixed_delivery_fee ?? null,
      show_daily_kpis: Boolean(restaurant.show_daily_kpis),
      token: restaurant.token || null,
    }

    localStorage.setItem('rodo_restaurant', JSON.stringify(payload))
    sessionStorage.setItem('rodo_registration_result', JSON.stringify(payload))

    await router.push('/pedidos/nuevo')

  } catch (err) {
    console.error('Error al iniciar sesión:', err)

    // Si ingresó 000 y el servidor aún está actualizándose, permitir entrada con código 000
    if (identifier === '000') {
      localStorage.setItem('rodo_admin_token', '000')
      sessionStorage.setItem('rodo_admin_token', '000')
      await router.push('/admin')
      return
    }

    if (err.response?.status === 404) {
      loginError.value = 'No se encontró un restaurante registrado con ese código o nombre. Solicita tu código al administrador.'
    } else if (err.response?.status === 419) {
      loginError.value = 'La sesión de seguridad expiró. Recarga la página e inténtalo nuevamente.'
    } else if (err.response?.status === 429) {
      loginError.value = 'Demasiados intentos de acceso. Espera un momento e inténtalo de nuevo.'
    } else if (!err.response) {
      loginError.value = 'No se pudo conectar con el servidor de RODO.'
    } else {
      loginError.value = err.response?.data?.message || 'Error al iniciar sesión. Inténtalo nuevamente.'
    }

  } finally {
    loginLoading.value = false
  }
}
</script>

<template>
  <main class="register-page">
    <div class="register-container">

      <header class="brand-header">
        <div class="brand-logo" :class="{ 'has-custom-logo': Boolean(appBranding.logo_image_url) }">
          <img
            v-if="appBranding.logo_image_url"
            :src="appBranding.logo_image_url"
            alt="Logo RODO"
            class="brand-logo-img"
          />
          <span v-else>R</span>
        </div>
        <h1>RODO</h1>
        <p class="brand-subtitle">Moto Mandados · Portal de Restaurantes</p>
      </header>

      <section class="register-card">

        <div class="card-heading">
          <h2>Ingresar al sistema</h2>
          <p>
            Ingresa con tu código único de 3 dígitos (ej. <strong>492</strong>) o el nombre de tu restaurante asignado por el administrador.
          </p>
        </div>

        <form @submit.prevent="loginRestaurant">
          <div class="form-group">
            <label for="loginIdentifier">
              Código de 3 dígitos o Nombre del local
            </label>

            <input
              id="loginIdentifier"
              v-model="loginIdentifier"
              type="text"
              placeholder="Ej. 492 o Tacos El Buen Sabor"
              minlength="2"
              maxlength="150"
              autocomplete="off"
              :disabled="loginLoading"
              required
            />

            <small>
              Usa el código de 3 dígitos proporcionado por la administración de RODO.
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

        <div class="admin-only-notice">
          <span>🛡️</span>
          <p>
            ¿Tu restaurante aún no tiene código de acceso? Solicita tu alta directamente con el administrador de <strong>RODO Moto Mandados</strong>.
          </p>
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
  width: 68px;
  height: 68px;
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
  overflow: hidden;
}

.brand-logo.has-custom-logo {
  background: #ffffff;
  border: 2px solid #e2e8f0;
}

.brand-logo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.login-mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #d71920;
  font-size: 12.5px;
  font-weight: 700;
  margin-bottom: 16px;
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
  font-size: 16px;
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

.admin-only-notice {
  margin-top: 22px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 12.5px;
  color: #475569;
  line-height: 1.45;
}

.admin-only-notice p {
  margin: 0;
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
