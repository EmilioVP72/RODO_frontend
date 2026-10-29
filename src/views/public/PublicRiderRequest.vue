<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../../services/api'

const route = useRoute()
const token = computed(() => route.params.token)

const loading = ref(true)
const error = ref('')
const errorCode = ref(null)
const riderRequest = ref(null)
const copySuccess = ref(false)

async function fetchRiderRequest() {
  if (!token.value) {
    error.value = 'Enlace de solicitud inválido.'
    errorCode.value = 400
    loading.value = false
    return
  }

  loading.value = true
  error.value = ''
  errorCode.value = null

  try {
    const response = await api.get(`/rider-requests/${token.value}`)
    riderRequest.value = response.data.data
  } catch (err) {
    errorCode.value = err.response?.status || 500
    if (err.response?.status === 404) {
      error.value = 'Solicitud no encontrada. El enlace puede ser inválido o haber expirado.'
    } else if (err.response?.status === 429) {
      error.value = 'Demasiadas solicitudes. Espera un momento antes de volver a consultar.'
    } else if (!err.response) {
      error.value = 'No se pudo conectar con el servidor. Revisa tu conexión a internet.'
    } else {
      error.value = 'Ocurrió un error al consultar la solicitud de repartidores.'
    }
  } finally {
    loading.value = false
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'No especificada'
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return dateStr
  }
}

async function copyLink() {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2500)
  } catch {
    const input = document.createElement('input')
    input.value = url
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2500)
  }
}

const statusDisplay = computed(() => {
  const s = riderRequest.value?.status || 'pending'
  switch (s) {
    case 'pending':
      return { label: 'PENDIENTE DE ASIGNACIÓN', class: 'status-pending', icon: '⏳' }
    case 'assigned':
      return { label: 'REPARTIDORES ASIGNADOS', class: 'status-assigned', icon: '🛵' }
    case 'completed':
      return { label: 'SOLICITUD COMPLETADA', class: 'status-completed', icon: '✓' }
    case 'cancelled':
      return { label: 'CANCELADA', class: 'status-cancelled', icon: '✕' }
    default:
      return { label: s.toUpperCase(), class: 'status-pending', icon: 'ℹ' }
  }
})

onMounted(() => {
  fetchRiderRequest()
})
</script>

<template>
  <main class="rider-req-page">
    <div class="rider-req-container">

      <!-- Estado: Cargando -->
      <div v-if="loading" class="state-card">
        <div class="loading-spinner" />
        <h2>Consultando solicitud de repartidores...</h2>
        <p>Verificando disponibilidad en el sistema central de RODO.</p>
      </div>

      <!-- Estado: Error -->
      <div v-else-if="error" class="state-card error-card">
        <div class="error-icon">✕</div>
        <h2>No pudimos cargar la solicitud</h2>
        <p>{{ error }}</p>
        <button class="btn-refresh" @click="fetchRiderRequest">
          Reintentar consulta
        </button>
      </div>

      <!-- Estado: Solicitud Encontrada -->
      <article v-else-if="riderRequest" class="req-sheet">

        <!-- Encabezado Institucional -->
        <header class="req-header">
          <div class="header-brand">
            <div class="brand-badge">RODO</div>
            <div class="brand-titles">
              <h1>RODO MOTO MANDADOS</h1>
              <p>SOLICITUD DE REPARTIDORES AL LÍDER</p>
            </div>
          </div>

          <!-- Status badge -->
          <div class="status-pill" :class="statusDisplay.class">
            <span class="status-icon">{{ statusDisplay.icon }}</span>
            <span class="status-text">{{ statusDisplay.label }}</span>
          </div>

          <!-- Folio y fecha -->
          <div class="folio-row">
            <span class="folio-label">FOLIO DE SOLICITUD</span>
            <strong class="folio-code">{{ riderRequest.folio }}</strong>
            <span class="folio-date">{{ formatDate(riderRequest.created_at) }}</span>
          </div>
        </header>

        <div class="req-divider" />

        <!-- Contador gigante de repartidores -->
        <section class="riders-highlight-card">
          <div class="riders-highlight-inner">
            <div class="lightning-tag">⚡ SOLICITUD RÁPIDA</div>
            <div class="riders-count-number">{{ riderRequest.riders_count }}</div>
            <div class="riders-count-title">
              {{ riderRequest.riders_count === 1 ? 'REPARTIDOR REQUERIDO' : 'REPARTIDORES REQUERIDOS' }}
            </div>
            <div class="riders-motos-row">
              <span v-for="i in riderRequest.riders_count" :key="i" class="moto-emoji">🛵</span>
            </div>
          </div>
        </section>

        <!-- Información del Local Solicitante -->
        <section class="info-section">
          <h2 class="section-title">LOCAL SOLICITANTE</h2>
          <div class="restaurant-card">
            <div class="restaurant-icon">🏬</div>
            <div class="restaurant-meta">
              <strong class="restaurant-name">{{ riderRequest.restaurant?.name || 'Local autorizdo' }}</strong>
              <span class="restaurant-code-badge">Código de sucursal: #{{ riderRequest.restaurant?.code }}</span>
            </div>
          </div>
        </section>

        <!-- Nota / Mensaje especial -->
        <section class="info-section">
          <h2 class="section-title">INSTRUCCIONES / NOTA DEL LOCAL</h2>
          <div class="note-box">
            <p v-if="riderRequest.note" class="note-content">
              “{{ riderRequest.note }}”
            </p>
            <p v-else class="note-empty">
              Sin nota adicional registrada. Los pedidos se encuentran listos para recolección en mostrador.
            </p>
          </div>
        </section>

        <!-- Acciones del Líder de Repartidores -->
        <footer class="req-actions">
          <button
            class="action-btn btn-copy"
            type="button"
            @click="copyLink"
          >
            <span>🔗</span>
            <span>{{ copySuccess ? '¡Enlace copiado!' : 'Copiar enlace de solicitud' }}</span>
          </button>

          <button
            class="action-btn btn-refresh-status"
            type="button"
            @click="fetchRiderRequest"
          >
            <span>🔄</span>
            <span>Actualizar estado</span>
          </button>
        </footer>

        <div class="req-footer-notice">
          <p>© {{ new Date().getFullYear() }} RODO Moto Mandados · Coordinación en tiempo real para repartidores</p>
        </div>

      </article>

    </div>
  </main>
</template>

<style scoped>
.rider-req-page {
  min-height: 100vh;
  padding: 32px 18px 60px;
  background: linear-gradient(180deg, #f1f3f5 0%, #e9ecef 100%);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #1e293b;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.rider-req-container {
  width: 100%;
  max-width: 600px;
}

/* Tarjetas de estado */
.state-card {
  background: #ffffff;
  padding: 44px 28px;
  border-radius: 18px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
  text-align: center;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #f1f3f5;
  border-top-color: #d71920;
  border-radius: 50%;
  margin: 0 auto 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-card {
  border-top: 4px solid #ef4444;
}

.error-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #fee2e2;
  color: #dc2626;
  font-size: 26px;
  font-weight: 800;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
}

.btn-refresh {
  margin-top: 20px;
  background: #0f172a;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 12px 24px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}

/* Hoja de Solicitud */
.req-sheet {
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
  border: 1px solid #e2e8f0;
  overflow: hidden;
}

.req-header {
  padding: 30px 28px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.brand-badge {
  background: #d71920;
  color: #ffffff;
  font-weight: 900;
  font-size: 18px;
  padding: 6px 14px;
  border-radius: 10px;
  letter-spacing: -0.5px;
}

.brand-titles h1 {
  font-size: 18px;
  font-weight: 900;
  margin: 0;
  color: #0f172a;
  letter-spacing: 0.5px;
}

.brand-titles p {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  margin: 2px 0 0;
  letter-spacing: 0.5px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 30px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
  margin-bottom: 18px;
}

.status-pending {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}

.status-assigned {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}

.status-completed {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.status-cancelled {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.folio-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.folio-label {
  font-size: 11px;
  font-weight: 800;
  color: #94a3b8;
  letter-spacing: 1px;
}

.folio-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 22px;
  color: #0f172a;
  font-weight: 900;
  letter-spacing: 1px;
}

.folio-date {
  font-size: 12px;
  color: #64748b;
}

.req-divider {
  height: 1px;
  background: radial-gradient(circle, #cbd5e1 0%, rgba(203, 213, 225, 0) 100%);
  margin: 0 20px;
}

/* Card gigante de repartidores */
.riders-highlight-card {
  padding: 24px 28px;
}

.riders-highlight-inner {
  background: linear-gradient(135deg, #fff5f5 0%, #fee2e2 100%);
  border: 2px solid #fca5a5;
  border-radius: 16px;
  padding: 24px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(215, 25, 32, 0.08);
}

.lightning-tag {
  display: inline-block;
  background: #d71920;
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 20px;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.riders-count-number {
  font-size: 64px;
  font-weight: 900;
  color: #b91c1c;
  line-height: 1;
  margin-bottom: 6px;
  letter-spacing: -2px;
}

.riders-count-title {
  font-size: 15px;
  font-weight: 800;
  color: #7f1d1d;
  letter-spacing: 1px;
}

.riders-motos-row {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 8px;
  font-size: 24px;
}

/* Secciones de Información */
.info-section {
  padding: 0 28px 20px;
}

.section-title {
  font-size: 11px;
  font-weight: 800;
  color: #94a3b8;
  letter-spacing: 1px;
  margin: 0 0 10px;
}

.restaurant-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  padding: 16px;
  border-radius: 12px;
}

.restaurant-icon {
  font-size: 28px;
}

.restaurant-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.restaurant-name {
  font-size: 17px;
  font-weight: 800;
  color: #0f172a;
}

.restaurant-code-badge {
  font-size: 13px;
  font-weight: 700;
  color: #d71920;
}

.note-box {
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  padding: 16px;
  border-radius: 12px;
}

.note-content {
  font-size: 15px;
  font-style: italic;
  font-weight: 600;
  color: #334155;
  margin: 0;
  line-height: 1.5;
}

.note-empty {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}

/* Acciones */
.req-actions {
  padding: 10px 28px 24px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action-btn {
  padding: 14px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  transition: all 0.15s ease;
}

.btn-copy {
  background: #0f172a;
  color: #ffffff;
}

.btn-copy:hover {
  background: #1e293b;
}

.btn-refresh-status {
  background: #ffffff;
  color: #0f172a;
  border: 1.5px solid #cbd5e1;
}

.btn-refresh-status:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.req-footer-notice {
  text-align: center;
  padding: 14px 20px 20px;
  border-top: 1px solid #f1f5f9;
  font-size: 11px;
  color: #94a3b8;
}

.req-footer-notice p {
  margin: 0;
}

@media (max-width: 540px) {
  .req-actions {
    grid-template-columns: 1fr;
  }
  .req-header {
    padding: 24px 18px 16px;
  }
  .info-section {
    padding: 0 18px 16px;
  }
}
</style>
