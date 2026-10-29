<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../../services/api'

const route = useRoute()
const token = computed(() => route.params.token)

const loading = ref(true)
const error = ref('')
const errorCode = ref(null)
const ticket = ref(null)
const copySuccess = ref(false)

async function fetchTicket() {
  if (!token.value) {
    error.value = 'Enlace de ticket inválido.'
    errorCode.value = 400
    loading.value = false
    return
  }

  loading.value = true
  error.value = ''
  errorCode.value = null

  try {
    const response = await api.get(`/tickets/${token.value}`)
    ticket.value = response.data.data
  } catch (err) {
    errorCode.value = err.response?.status || 500
    if (err.response?.status === 404) {
      error.value = 'Ticket no encontrado. Verifica el enlace o consulta con el restaurante.'
    } else if (err.response?.status === 429) {
      error.value = 'Demasiadas solicitudes. Espera un momento antes de volver a consultar.'
    } else if (!err.response) {
      error.value = 'No se pudo conectar con el servidor. Revisa tu conexión a internet.'
    } else {
      error.value = 'Ocurrió un error al obtener la información del ticket.'
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

function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return null
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(Number(amount))
}

function formatStatus(status) {
  const map = {
    pending: 'Pendiente de repartidor',
    assigned: 'Repartidor asignado',
    picked_up: 'En camino / Recogido',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
  }
  return map[status] || status || 'Registrado'
}

async function copyTicketLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2500)
  } catch {
    const input = document.createElement('input')
    input.value = window.location.href
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

function printTicket() {
  window.print()
}

onMounted(() => {
  fetchTicket()
})
</script>

<template>
  <main class="ticket-page">
    <div class="ticket-container">

      <!-- Estado: Cargando -->
      <section v-if="loading" class="ticket-state-card" aria-live="polite">
        <div class="loading-spinner" />
        <h2>Consultando ticket digital...</h2>
        <p>Cargando información de entrega de RODO Moto Mandados</p>
      </section>

      <!-- Estado: Error -->
      <section v-else-if="error" class="ticket-state-card error-state">
        <div class="state-icon error-icon">✕</div>
        <h2>No pudimos cargar el ticket</h2>
        <p class="error-text">{{ error }}</p>
        <button class="btn btn-outline" @click="fetchTicket">
          Reintentar consulta
        </button>
      </section>

      <!-- Estado: Ticket cargado -->
      <article v-else-if="ticket" class="ticket-receipt">

        <!-- Cabecera del ticket -->
        <header class="receipt-header">
          <div class="brand-badge">
            <span class="brand-logo-small">R</span>
            <div>
              <h1 class="brand-title">RODO</h1>
              <span class="brand-sub">Moto Mandados</span>
            </div>
          </div>

          <div class="ticket-status-pill" :class="'status-' + ticket.status">
            {{ formatStatus(ticket.status) }}
          </div>

          <div class="folio-box">
            <span class="label-tiny">FOLIO DE PEDIDO</span>
            <strong class="folio-text">{{ ticket.folio }}</strong>
            <span class="date-text">{{ formatDate(ticket.created_at) }}</span>
          </div>
        </header>

        <!-- Restaurante emisor -->
        <section class="receipt-section restaurant-info">
          <h2 class="section-title">Local emisor</h2>
          <div class="restaurant-card">
            <div class="restaurant-name">{{ ticket.restaurant?.name || 'Restaurante' }}</div>
            <div class="restaurant-code">Código autorizado: <strong>#{{ ticket.restaurant?.code }}</strong></div>
          </div>
        </section>

        <!-- Datos del cliente y entrega -->
        <section class="receipt-section">
          <h2 class="section-title">Entrega y cliente</h2>

          <div class="info-grid">
            <div class="info-item">
              <span class="label">Cliente</span>
              <strong class="val">{{ ticket.customer?.name || 'No especificado' }}</strong>
            </div>

            <div class="info-item">
              <span class="label">Teléfono de contacto</span>
              <a
                v-if="ticket.customer?.phone"
                :href="'tel:' + ticket.customer?.phone"
                class="phone-link"
              >
                📞 {{ ticket.customer?.phone }}
              </a>
              <span v-else class="val text-muted">No especificado</span>
            </div>
          </div>

          <div class="address-box">
            <span class="label">Dirección de entrega</span>
            <p class="address-main">
              {{ ticket.customer?.street }}
            </p>
            <p class="address-colonia">
              Colonia {{ ticket.customer?.neighborhood }}
            </p>

            <div v-if="ticket.customer?.address_reference" class="reference-box">
              <span class="label-tiny">REFERENCIAS:</span>
              <p>{{ ticket.customer?.address_reference }}</p>
            </div>

            <a
              v-if="ticket.customer?.map_url"
              :href="ticket.customer?.map_url"
              target="_blank"
              rel="noopener noreferrer"
              class="maps-button"
            >
              📍 Abrir en Google Maps
            </a>
          </div>
        </section>

        <!-- Información económica -->
        <section class="receipt-section">
          <h2 class="section-title">Información económica</h2>

          <div class="pricing-card">
            <div class="pricing-row">
              <span>Distancia estimada</span>
              <strong>{{ Number(ticket.pricing?.distance_km).toFixed(1) }} km</strong>
            </div>

            <div class="pricing-row highlight-fee">
              <span>Tarifa de entrega (RODO)</span>
              <strong class="fee-amount">{{ formatCurrency(ticket.pricing?.delivery_fee) }}</strong>
            </div>

            <div class="divider" />

            <div class="pricing-row">
              <span>Método de pago</span>
              <strong>{{ ticket.pricing?.payment_method || 'No especificado' }}</strong>
            </div>

            <div v-if="ticket.pricing?.amount_to_collect !== null" class="pricing-row collect-row">
              <span>Cobrar al cliente</span>
              <strong class="collect-amount">{{ formatCurrency(ticket.pricing?.amount_to_collect) }}</strong>
            </div>

            <div v-if="ticket.pricing?.needs_change" class="change-notice">
              ⚠️ <strong>Requiere cambio:</strong> Llevar cambio de ${{ ticket.pricing?.change_from }}
            </div>
          </div>
        </section>

        <!-- Detalles del pedido -->
        <section class="receipt-section">
          <h2 class="section-title">Detalles del pedido</h2>

          <div class="ready-badge" :class="ticket.details?.is_ready ? 'ready' : 'preparing'">
            <span v-if="ticket.details?.is_ready">✓ Pedido listo para recoger en sucursal</span>
            <span v-else>⏳ Pedido en preparación</span>
          </div>

          <div v-if="ticket.details?.description" class="detail-block">
            <span class="label">Descripción de productos</span>
            <p>{{ ticket.details?.description }}</p>
          </div>

          <div v-if="ticket.details?.comments" class="detail-block">
            <span class="label">Comentarios o notas</span>
            <p>{{ ticket.details?.comments }}</p>
          </div>

          <div v-if="ticket.details?.care_instructions?.length" class="care-instructions-box">
            <span class="label">Indicaciones de cuidado:</span>
            <ul class="care-list">
              <li
                v-for="(instruction, idx) in ticket.details?.care_instructions"
                :key="idx"
                class="care-chip"
              >
                ⚠️ {{ instruction }}
              </li>
            </ul>
          </div>
        </section>

        <!-- Barra de acciones -->
        <footer class="receipt-actions">
          <button class="btn btn-primary" @click="copyTicketLink">
            <span v-if="copySuccess">✓ ¡Enlace copiado!</span>
            <span v-else>🔗 Copiar enlace</span>
          </button>

          <button class="btn btn-secondary" @click="printTicket">
            🖨️ Imprimir ticket
          </button>
        </footer>

        <div class="disclaimer">
          <small>
            Ticket digital oficial de <strong>RODO Moto Mandados</strong>.
            Cualquier modificación o duda sobre este pedido debe coordinarse directamente con el restaurante emisor.
          </small>
        </div>

      </article>

    </div>
  </main>
</template>

<style scoped>
.ticket-page {
  min-height: 100vh;
  padding: 24px 16px 64px;
  background: #f3f4f6;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
  display: flex;
  justify-content: center;
}

.ticket-container {
  width: 100%;
  max-width: 580px;
}

/* Estado de carga y error */
.ticket-state-card {
  background: #ffffff;
  padding: 48px 24px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  text-align: center;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #f3f4f6;
  border-top-color: #d71920;
  border-radius: 50%;
  margin: 0 auto 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.state-icon {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  font-size: 24px;
  font-weight: bold;
}

.error-icon {
  background: #fee2e2;
  color: #dc2626;
}

.error-text {
  color: #991b1b;
  margin: 12px 0 24px;
  font-size: 15px;
}

/* Recibo / Ticket principal */
.ticket-receipt {
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

/* Header */
.receipt-header {
  background: #ffffff;
  padding: 24px;
  border-bottom: 2px dashed #e5e7eb;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.brand-badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo-small {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #d71920;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 22px;
}

.brand-title {
  margin: 0;
  color: #d71920;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 1px;
  line-height: 1;
}

.brand-sub {
  font-size: 11px;
  text-transform: uppercase;
  color: #6b7280;
  font-weight: 600;
  letter-spacing: 1.5px;
}

.ticket-status-pill {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-pending {
  background: #fef3c7;
  color: #92400e;
}

.status-assigned {
  background: #dbeafe;
  color: #1e40af;
}

.status-picked_up {
  background: #e0e7ff;
  color: #3730a3;
}

.status-delivered {
  background: #dcfce7;
  color: #166534;
}

.status-cancelled {
  background: #fee2e2;
  color: #991b1b;
}

.folio-box {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.label-tiny {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #6b7280;
  font-weight: 700;
}

.folio-text {
  font-size: 20px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #111827;
  letter-spacing: 1px;
}

.date-text {
  font-size: 13px;
  color: #6b7280;
}

/* Secciones */
.receipt-section {
  padding: 20px 24px;
  border-bottom: 1px solid #f3f4f6;
}

.section-title {
  margin: 0 0 14px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #9ca3af;
  font-weight: 700;
}

/* Restaurante */
.restaurant-card {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-left: 4px solid #d71920;
  padding: 12px 16px;
  border-radius: 8px;
}

.restaurant-name {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}

.restaurant-code {
  font-size: 13px;
  color: #4b5563;
  margin-top: 2px;
}

/* Info cliente */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 14px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 600;
}

.val {
  font-size: 15px;
  color: #111827;
}

.text-muted {
  color: #9ca3af;
  font-style: italic;
}

.phone-link {
  color: #d71920;
  font-weight: 700;
  text-decoration: none;
  font-size: 16px;
}

.phone-link:hover {
  text-decoration: underline;
}

.address-box {
  background: #fdf2f2;
  border: 1px solid #fcdada;
  padding: 14px 16px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.address-main {
  margin: 2px 0 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.address-colonia {
  margin: 0;
  font-size: 14px;
  color: #4b5563;
}

.reference-box {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #f5c2c4;
}

.reference-box p {
  margin: 2px 0 0;
  font-size: 13px;
  color: #4b5563;
  line-height: 1.4;
}

.maps-button {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  padding: 9px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.15s ease;
}

.maps-button:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

/* Precios */
.pricing-card {
  background: #fafafa;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pricing-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.highlight-fee {
  font-size: 15px;
}

.fee-amount {
  font-size: 18px;
  color: #d71920;
}

.divider {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 0;
}

.collect-row {
  font-size: 16px;
}

.collect-amount {
  font-size: 20px;
  color: #111827;
}

.change-notice {
  background: #fffbeb;
  border: 1px solid #fef3c7;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #92400e;
}

/* Estado del pedido */
.ready-badge {
  padding: 10px 14px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
}

.ready-badge.ready {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.ready-badge.preparing {
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fde68a;
}

.detail-block {
  margin-bottom: 12px;
}

.detail-block p {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: #374151;
  white-space: pre-line;
}

.care-instructions-box {
  margin-top: 12px;
}

.care-list {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.care-chip {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

/* Botones de acción */
.receipt-actions {
  padding: 20px 24px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background: #fafafa;
}

.btn {
  padding: 12px 16px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn:hover {
  opacity: 0.9;
}

.btn-primary {
  background: #d71920;
  color: #ffffff;
}

.btn-secondary {
  background: #ffffff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-outline {
  background: transparent;
  color: #d71920;
  border: 1px solid #d71920;
  margin: 0 auto;
}

.disclaimer {
  padding: 16px 24px 24px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  line-height: 1.4;
  background: #fafafa;
}

@media print {
  body {
    background: #ffffff;
  }
  .ticket-page {
    padding: 0;
    background: #ffffff;
  }
  .receipt-actions, .disclaimer, .maps-button {
    display: none !important;
  }
  .ticket-receipt {
    box-shadow: none;
    border: 1px solid #ccc;
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .info-grid {
    grid-template-columns: 1fr;
  }
  .receipt-actions {
    grid-template-columns: 1fr;
  }
}
</style>
