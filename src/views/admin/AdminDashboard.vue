<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'

const router = useRouter()

// Navegación principal del Dashboard
const activeSection = ref('resumen') // 'resumen' | 'restaurantes'

// Notificaciones Toast
const toast = reactive({
  show: false,
  message: '',
  type: 'success',
})

function showToast(message, type = 'success') {
  toast.message = message
  toast.type = type
  toast.show = true
  setTimeout(() => {
    toast.show = false
  }, 4000)
}

// ==========================================
// SECCIÓN 1: RESUMEN, FILTROS, KPIS Y GRÁFICAS
// ==========================================
const summaryLoading = ref(false)
const chartMetric = ref('orders') // 'orders' | 'fees'

const filters = reactive({
  period: '30d', // 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'
  date_from: '',
  date_to: '',
  restaurant_id: 'all',
  payment_method: 'all',
})

const summaryData = reactive({
  kpis: {
    total_orders: 0,
    orders_growth_pct: 0,
    total_delivery_fees: 0,
    fees_growth_pct: 0,
    avg_delivery_fee: 0,
    total_collected: 0,
    avg_ticket_collect: 0,
    total_distance_km: 0,
    avg_distance_km: 0,
    orders_ready_count: 0,
    orders_needing_change: 0,
    total_restaurants: 0,
    active_restaurants: 0,
    restaurants_with_orders: 0,
    restaurants_with_complete_profile: 0,
    total_rider_requests: 0,
    total_riders_requested: 0,
  },
  charts: {
    daily_trend: [],
    hourly_distribution: [],
    top_restaurants: [],
    payment_methods: [],
    top_neighborhoods: [],
    distance_ranges: [],
  },
  recent_orders: [],
  restaurants_list: [],
})

async function fetchSummary() {
  summaryLoading.value = true
  try {
    const params = {
      period: filters.period,
      restaurant_id: filters.restaurant_id,
      payment_method: filters.payment_method,
    }
    if (filters.period === 'custom') {
      if (filters.date_from) params.date_from = filters.date_from
      if (filters.date_to) params.date_to = filters.date_to
    }

    const response = await api.get('/admin/summary', { params })
    const data = response.data.data

    Object.assign(summaryData.kpis, data.kpis || {})
    Object.assign(summaryData.charts, data.charts || {})
    summaryData.recent_orders = data.recent_orders || []
    summaryData.restaurants_list = data.restaurants_list || []
  } catch (err) {
    console.error('Error al cargar el resumen de admin:', err)
    if (err.response?.status === 401) {
      showToast('Sesión de administrador expirada. Ingresa con el código 000.', 'error')
      router.push('/registro')
    } else {
      showToast('No se pudieron cargar las métricas del dashboard.', 'error')
    }
  } finally {
    summaryLoading.value = false
  }
}

function selectPeriod(periodKey) {
  filters.period = periodKey
  if (periodKey !== 'custom') {
    fetchSummary()
  }
}

// Cálculos para las gráficas interactivas
const maxDailyValue = computed(() => {
  const list = summaryData.charts.daily_trend || []
  if (!list.length) return 1
  const values = list.map((d) =>
    chartMetric.value === 'orders' ? Number(d.orders_count) : Number(d.delivery_fees)
  )
  return Math.max(...values, 1)
})

const maxHourlyCount = computed(() => {
  const list = summaryData.charts.hourly_distribution || []
  if (!list.length) return 1
  return Math.max(...list.map((h) => Number(h.orders_count)), 1)
})

const peakHourObj = computed(() => {
  const list = summaryData.charts.hourly_distribution || []
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => b.orders_count - a.orders_count)
  return sorted[0]?.orders_count > 0 ? sorted[0] : null
})

const maxTopRestaurantOrders = computed(() => {
  const list = summaryData.charts.top_restaurants || []
  if (!list.length) return 1
  return Math.max(...list.map((r) => Number(r.orders_count)), 1)
})

// Colores para la gráfica de dona de métodos de pago
const donutColors = ['#d71920', '#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#64748b']

const paymentDonutSegments = computed(() => {
  const methods = summaryData.charts.payment_methods || []
  const total = methods.reduce((acc, item) => acc + Number(item.count), 0)
  if (!total) return []

  let cumulativePercent = 0
  return methods.map((item, index) => {
    const pct = (Number(item.count) / total) * 100
    const startOffset = 25 - cumulativePercent
    cumulativePercent += pct
    return {
      ...item,
      color: donutColors[index % donutColors.length],
      strokeDasharray: `${pct} ${100 - pct}`,
      strokeDashoffset: startOffset,
    }
  })
})

function exportRecentOrdersCsv() {
  const rows = summaryData.recent_orders || []
  if (!rows.length) {
    showToast('No hay pedidos en este filtro para exportar.', 'error')
    return
  }

  const headers = ['Folio', 'Restaurante', 'Codigo', 'Cliente', 'Telefono', 'Colonia', 'Distancia_km', 'Tarifa_MXN', 'Metodo_Pago', 'Cobrar_MXN', 'Fecha']
  const csvLines = [
    headers.join(','),
    ...rows.map((o) =>
      [
        o.folio,
        `"${(o.restaurant?.name || '').replace(/"/g, '""')}"`,
        o.restaurant?.code || '',
        `"${(o.customer_name || '').replace(/"/g, '""')}"`,
        o.customer_phone || '',
        `"${(o.neighborhood || '').replace(/"/g, '""')}"`,
        o.distance_km,
        o.delivery_fee,
        `"${o.payment_method || ''}"`,
        o.amount_to_collect ?? 0,
        o.created_at || '',
      ].join(',')
    ),
  ]

  const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `reporte-rodo-${filters.period}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  showToast('Reporte CSV descargado correctamente.')
}

// ==========================================
// SECCIÓN 2: CRUD DE RESTAURANTES
// ==========================================
const restaurants = ref([])
const restaurantsLoading = ref(false)
const restaurantFilters = reactive({
  search: '',
  status: 'all', // 'all' | 'active' | 'inactive'
  profile: 'all', // 'all' | 'complete' | 'incomplete'
})

// Modal de Crear / Editar Restaurante
const showModal = ref(false)
const isEditing = ref(false)
const savingRestaurant = ref(false)
const modalError = ref('')
const photoInputMode = ref('upload') // 'upload' | 'url'
const fileInputRef = ref(null)

const restaurantForm = reactive({
  id: null,
  name: '',
  code: '',
  photo_url: '',
  location_url: '',
  description: '',
  is_active: true,
})

// Confirmación de eliminación
const deleteTarget = ref(null)
const deletingRestaurant = ref(false)

async function fetchRestaurants() {
  restaurantsLoading.value = true
  try {
    const response = await api.get('/admin/restaurants', {
      params: {
        search: restaurantFilters.search,
        status: restaurantFilters.status,
        profile: restaurantFilters.profile,
      },
    })
    restaurants.value = response.data.data || []
  } catch (err) {
    console.error('Error al cargar restaurantes:', err)
    showToast('Error al obtener la lista de restaurantes.', 'error')
  } finally {
    restaurantsLoading.value = false
  }
}

const filteredRestaurantsStats = computed(() => {
  const list = restaurants.value || []
  return {
    total: list.length,
    active: list.filter((r) => r.is_active).length,
    complete: list.filter((r) => r.has_complete_profile).length,
    incomplete: list.filter((r) => !r.has_complete_profile).length,
  }
})

function openCreateModal() {
  isEditing.value = false
  modalError.value = ''
  restaurantForm.id = null
  restaurantForm.name = ''
  restaurantForm.code = ''
  restaurantForm.photo_url = ''
  restaurantForm.location_url = ''
  restaurantForm.description = ''
  restaurantForm.is_active = true
  photoInputMode.value = 'upload'
  showModal.value = true
}

function openEditModal(rest) {
  isEditing.value = true
  modalError.value = ''
  restaurantForm.id = rest.id
  restaurantForm.name = rest.name || ''
  restaurantForm.code = rest.code || ''
  restaurantForm.photo_url = rest.photo_url || ''
  restaurantForm.location_url = rest.location_url || ''
  restaurantForm.description = rest.description || ''
  restaurantForm.is_active = Boolean(rest.is_active)
  photoInputMode.value = rest.photo_url && rest.photo_url.startsWith('http') ? 'url' : 'upload'
  showModal.value = true
}

function jumpToEditRestaurant(restId) {
  activeSection.value = 'restaurantes'
  const found = restaurants.value.find((r) => r.id === restId)
  if (found) {
    openEditModal(found)
  } else {
    fetchRestaurants().then(() => {
      const target = restaurants.value.find((r) => r.id === restId)
      if (target) openEditModal(target)
    })
  }
}

// Compresión automática de foto en Canvas para almacenar limpio en BD
function handlePhotoUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    modalError.value = 'Por favor selecciona un archivo de imagen válido (JPG, PNG, WEBP).'
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const MAX_WIDTH = 640
      const MAX_HEIGHT = 480
      let width = img.width
      let height = img.height

      if (width > height) {
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width)
          width = MAX_WIDTH
        }
      } else if (height > MAX_HEIGHT) {
        width = Math.round((width * MAX_HEIGHT) / height)
        height = MAX_HEIGHT
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      restaurantForm.photo_url = canvas.toDataURL('image/jpeg', 0.82)
      modalError.value = ''
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

function clearPhoto() {
  restaurantForm.photo_url = ''
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

async function saveRestaurant() {
  modalError.value = ''
  const cleanName = restaurantForm.name.trim()
  if (cleanName.length < 2) {
    modalError.value = 'El nombre del restaurante debe tener al menos 2 caracteres.'
    return
  }

  savingRestaurant.value = true
  try {
    await initializeCsrf()

    const payload = {
      name: cleanName,
      photo_url: restaurantForm.photo_url ? restaurantForm.photo_url.trim() : null,
      location_url: restaurantForm.location_url ? restaurantForm.location_url.trim() : null,
      description: restaurantForm.description ? restaurantForm.description.trim() : null,
      is_active: restaurantForm.is_active,
    }

    if (isEditing.value && restaurantForm.id) {
      await api.put(`/admin/restaurants/${restaurantForm.id}`, payload)
      showToast('Restaurante actualizado correctamente.')
    } else {
      await api.post('/admin/restaurants', payload)
      showToast('Restaurante creado correctamente.')
    }

    showModal.value = false
    await Promise.all([fetchRestaurants(), fetchSummary()])
  } catch (err) {
    console.error('Error al guardar restaurante:', err)
    const errors = err.response?.data?.errors
    if (errors) {
      modalError.value = Object.values(errors).flat().join(' ')
    } else {
      modalError.value = err.response?.data?.message || 'No se pudo guardar el restaurante.'
    }
  } finally {
    savingRestaurant.value = false
  }
}

async function toggleRestaurantStatus(rest) {
  try {
    const newStatus = !rest.is_active
    await api.patch(`/admin/restaurants/${rest.id}`, {
      is_active: newStatus,
    })
    rest.is_active = newStatus
    showToast(`Restaurante "${rest.name}" ${newStatus ? 'activado' : 'desactivado'}.`)
    fetchSummary()
  } catch (err) {
    showToast('No se pudo cambiar el estado del restaurante.', 'error')
  }
}

function confirmDeleteRestaurant(rest) {
  deleteTarget.value = rest
}

async function executeDeleteRestaurant() {
  if (!deleteTarget.value) return
  deletingRestaurant.value = true
  try {
    await api.delete(`/admin/restaurants/${deleteTarget.value.id}`)
    showToast(`Restaurante "${deleteTarget.value.name}" eliminado.`)
    deleteTarget.value = null
    await Promise.all([fetchRestaurants(), fetchSummary()])
  } catch (err) {
    showToast('No se pudo eliminar el restaurante.', 'error')
  } finally {
    deletingRestaurant.value = false
  }
}

function logoutAdmin() {
  localStorage.removeItem('rodo_admin_token')
  sessionStorage.removeItem('rodo_admin_token')
  router.push('/registro')
}

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(async () => {
  const adminToken = localStorage.getItem('rodo_admin_token') || sessionStorage.getItem('rodo_admin_token')
  if (!adminToken) {
    localStorage.setItem('rodo_admin_token', '000')
  }
  await Promise.all([fetchSummary(), fetchRestaurants()])
})
</script>

<template>
  <div class="admin-layout">
    <!-- BARRA LATERAL / HEADER DE NAVEGACIÓN -->
    <aside class="admin-sidebar">
      <div class="sidebar-brand">
        <div class="brand-logo">R</div>
        <div>
          <h1>RODO Admin</h1>
          <span class="admin-badge">Código #000</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <button
          type="button"
          :class="['nav-item', { active: activeSection === 'resumen' }]"
          @click="activeSection = 'resumen'"
        >
          <span class="nav-icon">📊</span>
          <div class="nav-text">
            <strong>Resumen</strong>
            <small>KPIs, filtros y gráficas</small>
          </div>
        </button>

        <button
          type="button"
          :class="['nav-item', { active: activeSection === 'restaurantes' }]"
          @click="activeSection = 'restaurantes'"
        >
          <span class="nav-icon">🏪</span>
          <div class="nav-text">
            <strong>Restaurantes</strong>
            <small>CRUD, fotos y ubicación</small>
          </div>
          <span class="nav-counter">{{ summaryData.kpis.total_restaurants }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button type="button" class="btn-logout" @click="logoutAdmin">
          <span>🚪</span> Cerrar sesión Admin
        </button>
      </div>
    </aside>

    <!-- CONTENIDO PRINCIPAL -->
    <main class="admin-main">
      <!-- Topbar superior -->
      <header class="admin-topbar">
        <div>
          <h2 v-if="activeSection === 'resumen'">Resumen General de la Plataforma</h2>
          <h2 v-else>Directorio y CRUD de Restaurantes</h2>
          <p class="topbar-sub">
            <span v-if="activeSection === 'resumen'">
              Monitoreo en tiempo real de pedidos, tarifas de envío, zonas de entrega y rendimiento de locales.
            </span>
            <span v-else>
              Enriquece el perfil de cada restaurante registrado añadiendo su foto, ubicación con URL de Google Maps y descripción.
            </span>
          </p>
        </div>

        <div class="topbar-actions">
          <button
            v-if="activeSection === 'resumen'"
            type="button"
            class="btn-secondary"
            @click="exportRecentOrdersCsv"
          >
            📥 Exportar CSV
          </button>
          <button
            v-if="activeSection === 'resumen'"
            type="button"
            class="btn-primary"
            :disabled="summaryLoading"
            @click="fetchSummary"
          >
            {{ summaryLoading ? 'Actualizando...' : '🔄 Actualizar datos' }}
          </button>
          <button
            v-if="activeSection === 'restaurantes'"
            type="button"
            class="btn-primary"
            @click="openCreateModal"
          >
            ➕ Nuevo Restaurante
          </button>
        </div>
      </header>

      <!-- ===================================================== -->
      <!-- VISTA 1: RESUMEN (FILTROS, KPIS Y GRÁFICAS DINÁMICAS) -->
      <!-- ===================================================== -->
      <section v-if="activeSection === 'resumen'" class="section-container">
        <!-- Barra de Filtros Dinámicos -->
        <div class="filters-card">
          <div class="filter-group period-pills">
            <span class="filter-label">Periodo:</span>
            <div class="pills-row">
              <button
                type="button"
                :class="['pill-btn', { active: filters.period === 'today' }]"
                @click="selectPeriod('today')"
              >
                Hoy
              </button>
              <button
                type="button"
                :class="['pill-btn', { active: filters.period === '7d' }]"
                @click="selectPeriod('7d')"
              >
                7 días
              </button>
              <button
                type="button"
                :class="['pill-btn', { active: filters.period === '30d' }]"
                @click="selectPeriod('30d')"
              >
                30 días
              </button>
              <button
                type="button"
                :class="['pill-btn', { active: filters.period === 'month' }]"
                @click="selectPeriod('month')"
              >
                Este mes
              </button>
              <button
                type="button"
                :class="['pill-btn', { active: filters.period === 'all' }]"
                @click="selectPeriod('all')"
              >
                Todo
              </button>
              <button
                type="button"
                :class="['pill-btn', { active: filters.period === 'custom' }]"
                @click="selectPeriod('custom')"
              >
                📅 Personalizado
              </button>
            </div>
          </div>

          <!-- Fechas personalizadas -->
          <div v-if="filters.period === 'custom'" class="custom-dates-row">
            <div class="filter-input-box">
              <label>Desde:</label>
              <input v-model="filters.date_from" type="date" @change="fetchSummary" />
            </div>
            <div class="filter-input-box">
              <label>Hasta:</label>
              <input v-model="filters.date_to" type="date" @change="fetchSummary" />
            </div>
          </div>

          <div class="filters-selects-row">
            <div class="filter-select-item">
              <label>🏪 Filtrar por Restaurante:</label>
              <select v-model="filters.restaurant_id" @change="fetchSummary">
                <option value="all">Todos los restaurantes ({{ summaryData.restaurants_list.length }})</option>
                <option
                  v-for="r in summaryData.restaurants_list"
                  :key="r.id"
                  :value="r.id"
                >
                  {{ r.name }} (#{{ r.code }})
                </option>
              </select>
            </div>

            <div class="filter-select-item">
              <label>💳 Método de Pago:</label>
              <select v-model="filters.payment_method" @change="fetchSummary">
                <option value="all">Todos los métodos</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia">Transferencia</option>
                <option value="Pagado">Ya pagado / Tarjeta</option>
              </select>
            </div>
          </div>
        </div>

        <!-- TARJETAS DE KPIS DINÁMICOS -->
        <div class="kpis-grid">
          <!-- KPI 1: Total Pedidos -->
          <div class="kpi-card kpi-red">
            <div class="kpi-top">
              <span class="kpi-icon">📦</span>
              <span
                :class="['kpi-trend', summaryData.kpis.orders_growth_pct >= 0 ? 'trend-up' : 'trend-down']"
              >
                {{ summaryData.kpis.orders_growth_pct >= 0 ? '▲' : '▼' }}
                {{ Math.abs(summaryData.kpis.orders_growth_pct) }}%
              </span>
            </div>
            <div class="kpi-value">{{ summaryData.kpis.total_orders }}</div>
            <div class="kpi-title">Pedidos Registrados</div>
            <div class="kpi-sub">
              ✓ {{ summaryData.kpis.orders_ready_count }} listos · {{ summaryData.kpis.orders_needing_change }} requirieron cambio
            </div>
          </div>

          <!-- KPI 2: Tarifas de Envío Generadas -->
          <div class="kpi-card kpi-emerald">
            <div class="kpi-top">
              <span class="kpi-icon">🛵</span>
              <span
                :class="['kpi-trend', summaryData.kpis.fees_growth_pct >= 0 ? 'trend-up' : 'trend-down']"
              >
                {{ summaryData.kpis.fees_growth_pct >= 0 ? '▲' : '▼' }}
                {{ Math.abs(summaryData.kpis.fees_growth_pct) }}%
              </span>
            </div>
            <div class="kpi-value">{{ formatCurrency(summaryData.kpis.total_delivery_fees) }}</div>
            <div class="kpi-title">Ingresos en Tarifas de Envío</div>
            <div class="kpi-sub">
              Tarifa promedio: <strong>{{ formatCurrency(summaryData.kpis.avg_delivery_fee) }}</strong> / entrega
            </div>
          </div>

          <!-- KPI 3: Volumen a Cobrar -->
          <div class="kpi-card kpi-blue">
            <div class="kpi-top">
              <span class="kpi-icon">💵</span>
              <span class="kpi-badge-neutral">Flujo en calle</span>
            </div>
            <div class="kpi-value">{{ formatCurrency(summaryData.kpis.total_collected) }}</div>
            <div class="kpi-title">Monto Movilizado en Cobros</div>
            <div class="kpi-sub">
              Ticket promedio a cobrar: <strong>{{ formatCurrency(summaryData.kpis.avg_ticket_collect) }}</strong>
            </div>
          </div>

          <!-- KPI 4: Restaurantes Activos y Perfiles -->
          <div class="kpi-card kpi-purple" style="cursor: pointer;" @click="activeSection = 'restaurantes'">
            <div class="kpi-top">
              <span class="kpi-icon">🏪</span>
              <span class="kpi-badge-neutral">{{ summaryData.kpis.restaurants_with_orders }} con pedidos</span>
            </div>
            <div class="kpi-value">
              {{ summaryData.kpis.active_restaurants }}
              <small style="font-size: 1rem; color: #64748b; font-weight: 600;">/ {{ summaryData.kpis.total_restaurants }}</small>
            </div>
            <div class="kpi-title">Restaurantes Activos</div>
            <div class="kpi-sub">
              ✨ {{ summaryData.kpis.restaurants_with_complete_profile }} con foto, mapa y descripción
            </div>
          </div>

          <!-- KPI 5: Distancia Recorrida -->
          <div class="kpi-card kpi-amber">
            <div class="kpi-top">
              <span class="kpi-icon">📍</span>
              <span class="kpi-badge-neutral">Cobertura hasta 5 km</span>
            </div>
            <div class="kpi-value">{{ summaryData.kpis.total_distance_km }} <small style="font-size: 1rem;">km</small></div>
            <div class="kpi-title">Kilómetros Totales de Ruta</div>
            <div class="kpi-sub">
              Distancia promedio: <strong>{{ summaryData.kpis.avg_distance_km }} km</strong> por pedido
            </div>
          </div>

          <!-- KPI 6: Solicitudes Masivas de Repartidores -->
          <div class="kpi-card kpi-slate">
            <div class="kpi-top">
              <span class="kpi-icon">⚡</span>
              <span class="kpi-badge-neutral">Apoyo en flotilla</span>
            </div>
            <div class="kpi-value">{{ summaryData.kpis.total_riders_requested }}</div>
            <div class="kpi-title">Repartidores Solicitados</div>
            <div class="kpi-sub">
              En <strong>{{ summaryData.kpis.total_rider_requests }}</strong> solicitudes rápidas al líder
            </div>
          </div>
        </div>

        <!-- GRÁFICAS PRINCIPALES (FILA 1) -->
        <div class="charts-grid-two">
          <!-- Gráfica 1: Tendencia Diaria de Pedidos y Tarifas -->
          <div class="chart-card chart-wide">
            <div class="chart-header">
              <div>
                <h3>📈 Evolución de Actividad Diaria</h3>
                <p>Comportamiento diario de órdenes y tarifas generadas en el periodo</p>
              </div>
              <div class="chart-toggle">
                <button
                  type="button"
                  :class="['toggle-btn', { active: chartMetric === 'orders' }]"
                  @click="chartMetric = 'orders'"
                >
                  📦 Pedidos
                </button>
                <button
                  type="button"
                  :class="['toggle-btn', { active: chartMetric === 'fees' }]"
                  @click="chartMetric = 'fees'"
                >
                  💵 Tarifas ($)
                </button>
              </div>
            </div>

            <div v-if="summaryData.charts.daily_trend.length" class="bar-chart-wrapper">
              <div class="bar-chart-columns">
                <div
                  v-for="day in summaryData.charts.daily_trend"
                  :key="day.date"
                  class="bar-col-item"
                  :title="`${day.date}: ${day.orders_count} pedidos | ${formatCurrency(day.delivery_fees)} en tarifas`"
                >
                  <span class="bar-top-val">
                    {{
                      chartMetric === 'orders'
                        ? day.orders_count || ''
                        : day.delivery_fees > 0
                          ? '$' + Math.round(day.delivery_fees)
                          : ''
                    }}
                  </span>
                  <div class="bar-track">
                    <div
                      class="bar-fill"
                      :class="chartMetric === 'fees' ? 'fill-emerald' : 'fill-red'"
                      :style="{
                        height:
                          Math.max(
                            ((chartMetric === 'orders' ? day.orders_count : day.delivery_fees) /
                              maxDailyValue) *
                              100,
                            (chartMetric === 'orders' ? day.orders_count : day.delivery_fees) > 0 ? 8 : 2
                          ) + '%',
                      }"
                    />
                  </div>
                  <span class="bar-label">{{ day.label }}</span>
                </div>
              </div>
            </div>
            <div v-else class="empty-chart">Sin registros en este rango de fechas.</div>
          </div>

          <!-- Gráfica 2: Dona de Métodos de Pago -->
          <div class="chart-card">
            <div class="chart-header">
              <div>
                <h3>💳 Métodos de Pago</h3>
                <p>Proporción de cobros y liquidez en entregas</p>
              </div>
            </div>

            <div v-if="paymentDonutSegments.length" class="donut-layout">
              <div class="donut-svg-box">
                <svg viewBox="0 0 42 42" class="donut-svg">
                  <circle
                    cx="21"
                    cy="21"
                    r="15.91549430918954"
                    fill="transparent"
                    stroke="#f1f5f9"
                    stroke-width="5.5"
                  />
                  <circle
                    v-for="seg in paymentDonutSegments"
                    :key="seg.method"
                    cx="21"
                    cy="21"
                    r="15.91549430918954"
                    fill="transparent"
                    :stroke="seg.color"
                    stroke-width="5.5"
                    :stroke-dasharray="seg.strokeDasharray"
                    :stroke-dashoffset="seg.strokeDashoffset"
                    stroke-linecap="butt"
                  />
                </svg>
                <div class="donut-center">
                  <strong>{{ summaryData.kpis.total_orders }}</strong>
                  <span>Pedidos</span>
                </div>
              </div>

              <div class="donut-legend">
                <div
                  v-for="seg in paymentDonutSegments"
                  :key="seg.method"
                  class="legend-row"
                >
                  <div class="legend-left">
                    <span class="legend-dot" :style="{ background: seg.color }" />
                    <strong>{{ seg.method }}</strong>
                  </div>
                  <div class="legend-right">
                    <span class="legend-count">{{ seg.count }} ({{ seg.percentage }}%)</span>
                    <small>{{ formatCurrency(seg.total_collected) }}</small>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-chart">Sin datos de métodos de pago.</div>
          </div>
        </div>

        <!-- GRÁFICAS SECUNDARIAS (FILA 2) -->
        <div class="charts-grid-three">
          <!-- Gráfica 3: Top Restaurantes -->
          <div class="chart-card">
            <div class="chart-header">
              <div>
                <h3>🏆 Top Restaurantes Activos</h3>
                <p>Locales con mayor volumen de envíos y tarifas</p>
              </div>
            </div>

            <div v-if="summaryData.charts.top_restaurants.length" class="ranking-list">
              <div
                v-for="(rest, idx) in summaryData.charts.top_restaurants"
                :key="rest.id"
                class="ranking-item"
              >
                <div class="ranking-top">
                  <div class="ranking-identity">
                    <span class="rank-num">#{{ idx + 1 }}</span>
                    <img
                      v-if="rest.photo_url"
                      :src="rest.photo_url"
                      alt="Logo"
                      class="rank-avatar"
                    />
                    <div v-else class="rank-avatar-placeholder">
                      {{ rest.name.charAt(0).toUpperCase() }}
                    </div>
                    <div>
                      <strong class="rank-name">{{ rest.name }}</strong>
                      <small class="rank-code">Código #{{ rest.code }} · Prom. {{ rest.avg_distance }} km</small>
                    </div>
                  </div>
                  <div class="ranking-metrics">
                    <span class="rank-orders">{{ rest.orders_count }} ped.</span>
                    <strong class="rank-fees">{{ formatCurrency(rest.delivery_fees) }}</strong>
                  </div>
                </div>
                <div class="ranking-bar-bg">
                  <div
                    class="ranking-bar-fill"
                    :style="{ width: Math.max((rest.orders_count / maxTopRestaurantOrders) * 100, 6) + '%' }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="empty-chart">Aún no hay pedidos por restaurante en este filtro.</div>
          </div>

          <!-- Gráfica 4: Horas Pico de Demanda -->
          <div class="chart-card">
            <div class="chart-header">
              <div>
                <h3>⏰ Demanda por Hora (Horas Pico)</h3>
                <p>
                  Distribución horaria para coordinar repartidores
                  <strong v-if="peakHourObj" style="color: #d71920;">
                    · Pico: {{ peakHourObj.label }} ({{ peakHourObj.orders_count }} ped.)
                  </strong>
                </p>
              </div>
            </div>

            <div class="hourly-chart">
              <div
                v-for="h in summaryData.charts.hourly_distribution"
                :key="h.hour"
                class="hour-col"
                :title="`${h.label} hrs: ${h.orders_count} pedidos`"
              >
                <span class="hour-val">{{ h.orders_count > 0 ? h.orders_count : '' }}</span>
                <div class="hour-track">
                  <div
                    :class="[
                      'hour-fill',
                      peakHourObj && peakHourObj.hour === h.hour && h.orders_count > 0 ? 'hour-peak' : '',
                    ]"
                    :style="{
                      height:
                        Math.max((h.orders_count / maxHourlyCount) * 100, h.orders_count > 0 ? 10 : 3) + '%',
                    }"
                  />
                </div>
                <span class="hour-label">{{ h.hour }}h</span>
              </div>
            </div>

            <!-- Distribución por rangos de distancia -->
            <div class="distance-ranges-box">
              <h4>📏 Distribución por Distancia de Entrega</h4>
              <div class="distance-bars">
                <div
                  v-for="dr in summaryData.charts.distance_ranges"
                  :key="dr.range"
                  class="dist-row"
                >
                  <div class="dist-info">
                    <span>{{ dr.range }}</span>
                    <strong>{{ dr.count }} ped. ({{ dr.percentage }}%) · {{ formatCurrency(dr.total_fees) }}</strong>
                  </div>
                  <div class="dist-progress-bg">
                    <div class="dist-progress-fill" :style="{ width: Math.max(dr.percentage, 3) + '%' }" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Gráfica 5: Zonas / Colonias con Mayor Demanda -->
          <div class="chart-card">
            <div class="chart-header">
              <div>
                <h3>🗺️ Top Colonias de Entrega</h3>
                <p>Zonas con mayor concentración de envíos</p>
              </div>
            </div>

            <div v-if="summaryData.charts.top_neighborhoods.length" class="zones-list">
              <div
                v-for="(zone, idx) in summaryData.charts.top_neighborhoods"
                :key="zone.neighborhood"
                class="zone-item"
              >
                <div class="zone-header">
                  <div>
                    <span class="zone-badge">{{ idx + 1 }}</span>
                    <strong>{{ zone.neighborhood }}</strong>
                  </div>
                  <span class="zone-stats">
                    {{ zone.orders_count }} envíos ({{ zone.percentage }}%)
                  </span>
                </div>
                <div class="zone-sub">
                  <span>Distancia prom: {{ zone.avg_distance }} km</span>
                  <span>Tarifas: {{ formatCurrency(zone.total_fees) }}</span>
                </div>
                <div class="zone-bar-bg">
                  <div class="zone-bar-fill" :style="{ width: Math.max(zone.percentage, 5) + '%' }" />
                </div>
              </div>
            </div>
            <div v-else class="empty-chart">Sin registros de colonias en este periodo.</div>
          </div>
        </div>

        <!-- TABLA DE PEDIDOS RECIENTES -->
        <div class="table-card">
          <div class="table-header">
            <div>
              <h3>🧾 Últimos Pedidos Registrados</h3>
              <p>Vista rápida de las entregas más recientes con acceso a su ticket digital</p>
            </div>
          </div>

          <div v-if="summaryData.recent_orders.length" class="table-responsive">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Restaurante</th>
                  <th>Cliente / Destino</th>
                  <th>Distancia</th>
                  <th>Tarifa</th>
                  <th>Pago / Cobro</th>
                  <th>Fecha</th>
                  <th>Ticket</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="order in summaryData.recent_orders" :key="order.id">
                  <td>
                    <span class="folio-pill">{{ order.folio }}</span>
                  </td>
                  <td>
                    <div class="table-rest-cell">
                      <strong>{{ order.restaurant?.name }}</strong>
                      <small>#{{ order.restaurant?.code }}</small>
                    </div>
                  </td>
                  <td>
                    <div class="table-rest-cell">
                      <strong>{{ order.customer_name }}</strong>
                      <small>{{ order.neighborhood }} · {{ order.street }}</small>
                    </div>
                  </td>
                  <td>{{ order.distance_km }} km</td>
                  <td>
                    <strong style="color: #059669;">{{ formatCurrency(order.delivery_fee) }}</strong>
                  </td>
                  <td>
                    <div class="table-rest-cell">
                      <span>{{ order.payment_method }}</span>
                      <small v-if="order.amount_to_collect">
                        Cobrar: {{ formatCurrency(order.amount_to_collect) }}
                      </small>
                    </div>
                  </td>
                  <td>{{ formatDateShort(order.created_at) }}</td>
                  <td>
                    <router-link
                      :to="`/ticket/${order.public_token}`"
                      target="_blank"
                      class="btn-table-link"
                    >
                      👁️ Ver ticket
                    </router-link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-chart">No hay pedidos registrados para los filtros seleccionados.</div>
        </div>
      </section>

      <!-- ===================================================== -->
      <!-- VISTA 2: CRUD DE RESTAURANTES (FOTO, UBICACIÓN, DESC) -->
      <!-- ===================================================== -->
      <section v-else class="section-container">
        <!-- Mini resumen del directorio -->
        <div class="crud-stats-bar">
          <div class="crud-stat-pill">
            <span>Total registrados:</span>
            <strong>{{ filteredRestaurantsStats.total }}</strong>
          </div>
          <div class="crud-stat-pill stat-green">
            <span>Activos:</span>
            <strong>{{ filteredRestaurantsStats.active }}</strong>
          </div>
          <div class="crud-stat-pill stat-blue">
            <span>Perfil completo (Foto + Mapa + Desc):</span>
            <strong>{{ filteredRestaurantsStats.complete }}</strong>
          </div>
          <div class="crud-stat-pill stat-amber">
            <span>Por completar:</span>
            <strong>{{ filteredRestaurantsStats.incomplete }}</strong>
          </div>
        </div>

        <!-- Barra de búsqueda y filtros del CRUD -->
        <div class="filters-card crud-toolbar">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input
              v-model="restaurantFilters.search"
              type="text"
              placeholder="Buscar por nombre del restaurante o código de 3 dígitos (ej. 609)..."
              @input="fetchRestaurants"
            />
          </div>

          <div class="crud-filters-right">
            <select v-model="restaurantFilters.status" @change="fetchRestaurants">
              <option value="all">Estado: Todos</option>
              <option value="active">Solo Activos</option>
              <option value="inactive">Solo Inactivos</option>
            </select>

            <select v-model="restaurantFilters.profile" @change="fetchRestaurants">
              <option value="all">Perfil: Todos</option>
              <option value="complete">✓ Perfil Completo</option>
              <option value="incomplete">⚠️ Falta Foto / Ubicación / Desc</option>
            </select>
          </div>
        </div>

        <!-- Grid de Tarjetas de Restaurantes -->
        <div v-if="restaurantsLoading" class="empty-chart">Cargando directorio de restaurantes...</div>

        <div v-else-if="restaurants.length" class="restaurants-grid">
          <article
            v-for="rest in restaurants"
            :key="rest.id"
            :class="['rest-card', { 'rest-inactive': !rest.is_active }]"
          >
            <!-- Portada / Foto del Restaurante -->
            <div class="rest-card-media">
              <img
                v-if="rest.photo_url"
                :src="rest.photo_url"
                :alt="rest.name"
                class="rest-cover-img"
              />
              <div v-else class="rest-cover-placeholder" @click="openEditModal(rest)">
                <div class="placeholder-circle">{{ rest.name.charAt(0).toUpperCase() }}</div>
                <span class="add-photo-hint">📷 Clic para añadir foto</span>
              </div>

              <span class="rest-code-badge">#{{ rest.code }}</span>

              <button
                type="button"
                :class="['status-pill-toggle', rest.is_active ? 'active' : 'inactive']"
                :title="rest.is_active ? 'Clic para desactivar' : 'Clic para activar'"
                @click="toggleRestaurantStatus(rest)"
              >
                {{ rest.is_active ? '● Activo' : '○ Inactivo' }}
              </button>
            </div>

            <!-- Cuerpo de la tarjeta -->
            <div class="rest-card-body">
              <h3 class="rest-title">{{ rest.name }}</h3>

              <p v-if="rest.description" class="rest-desc">
                {{ rest.description }}
              </p>
              <p v-else class="rest-desc-empty">
                Sin descripción asignada. Edita este restaurante para añadir horarios, giro o notas.
              </p>

              <!-- Checklist de campos del Admin -->
              <div class="profile-badges-row">
                <span :class="['field-chip', rest.photo_url ? 'chip-ok' : 'chip-missing']">
                  {{ rest.photo_url ? '✓ Foto' : '○ Sin foto' }}
                </span>
                <a
                  v-if="rest.location_url"
                  :href="rest.location_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="field-chip chip-ok chip-link"
                >
                  📍 Ver ubicación en Mapa ↗
                </a>
                <span v-else class="field-chip chip-missing">
                  ○ Sin ubicación URL
                </span>
                <span :class="['field-chip', rest.description ? 'chip-ok' : 'chip-missing']">
                  {{ rest.description ? '✓ Descripción' : '○ Sin descripción' }}
                </span>
              </div>

              <!-- Métricas del restaurante -->
              <div class="rest-metrics-strip">
                <div>
                  <small>Pedidos</small>
                  <strong>{{ rest.orders_count }}</strong>
                </div>
                <div>
                  <small>Tarifas generadas</small>
                  <strong>{{ formatCurrency(rest.total_delivery_fees) }}</strong>
                </div>
                <div>
                  <small>Solicitudes</small>
                  <strong>{{ rest.rider_requests_count }}</strong>
                </div>
              </div>

              <!-- Botones del CRUD -->
              <div class="rest-card-actions">
                <button
                  type="button"
                  class="btn-edit-rest"
                  @click="openEditModal(rest)"
                >
                  ✏️ Editar Foto, Ubicación y Datos
                </button>
                <button
                  type="button"
                  class="btn-delete-rest"
                  title="Eliminar restaurante"
                  @click="confirmDeleteRestaurant(rest)"
                >
                  🗑️
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="empty-chart">
          No se encontraron restaurantes con esos criterios.
        </div>
      </section>
    </main>

    <!-- ===================================================== -->
    <!-- MODAL PARA CREAR / EDITAR RESTAURANTE (ADMIN CRUD)    -->
    <!-- ===================================================== -->
    <div v-if="showModal" class="modal-backdrop" @click.self="showModal = false">
      <div class="modal-card">
        <header class="modal-header">
          <div>
            <h3>
              {{ isEditing ? `Editar Restaurante (#${restaurantForm.code})` : 'Registrar Nuevo Restaurante' }}
            </h3>
            <p>
              Completa o actualiza la foto, enlace de ubicación en Google Maps y descripción del establecimiento.
            </p>
          </div>
          <button type="button" class="modal-close" @click="showModal = false">✕</button>
        </header>

        <form class="modal-body" @submit.prevent="saveRestaurant">
          <!-- Nombre -->
          <div class="form-field">
            <label>🏪 Nombre del restaurante *</label>
            <input
              v-model="restaurantForm.name"
              type="text"
              placeholder="Ej. Pronto Pizza San Antonio"
              required
              minlength="2"
              maxlength="150"
            />
          </div>

          <!-- Foto del Restaurante (Subir archivo o URL) -->
          <div class="form-field">
            <div class="field-label-row">
              <label>📷 Fotografía / Logo del Restaurante (Opcional)</label>
              <div class="mini-tabs">
                <button
                  type="button"
                  :class="['mini-tab', { active: photoInputMode === 'upload' }]"
                  @click="photoInputMode = 'upload'"
                >
                  Subir archivo
                </button>
                <button
                  type="button"
                  :class="['mini-tab', { active: photoInputMode === 'url' }]"
                  @click="photoInputMode = 'url'"
                >
                  Pegar URL
                </button>
              </div>
            </div>

            <div v-if="photoInputMode === 'upload'" class="upload-zone">
              <input
                ref="fileInputRef"
                type="file"
                accept="image/*"
                @change="handlePhotoUpload"
              />
              <small>Selecciona una foto desde tu computadora o celular (se optimiza automáticamente).</small>
            </div>

            <div v-else>
              <input
                v-model="restaurantForm.photo_url"
                type="url"
                placeholder="https://ejemplo.com/foto-restaurante.jpg"
              />
            </div>

            <!-- Vista previa de la foto -->
            <div v-if="restaurantForm.photo_url" class="photo-preview-box">
              <img :src="restaurantForm.photo_url" alt="Vista previa" />
              <button type="button" class="btn-remove-photo" @click="clearPhoto">
                ✕ Quitar foto
              </button>
            </div>
          </div>

          <!-- Ubicación con URL -->
          <div class="form-field">
            <label>📍 Ubicación con URL (Google Maps / Waze)</label>
            <div class="input-with-action">
              <input
                v-model="restaurantForm.location_url"
                type="url"
                placeholder="https://maps.app.goo.gl/... o https://www.google.com/maps/..."
              />
              <a
                v-if="restaurantForm.location_url"
                :href="restaurantForm.location_url"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-test-map"
              >
                Probar ↗
              </a>
            </div>
            <small>Pega el enlace de Google Maps para ubicar rápidamente el restaurante.</small>
          </div>

          <!-- Descripción -->
          <div class="form-field">
            <label>📝 Descripción del restaurante</label>
            <textarea
              v-model="restaurantForm.description"
              rows="3"
              placeholder="Ej. Pizzería artesanal en Col. San Antonio. Horario de 1:00 PM a 10:30 PM. Entrada por el portón negro..."
              maxlength="2000"
            />
          </div>

          <!-- Switch Estado Activo -->
          <label class="checkbox-row">
            <input v-model="restaurantForm.is_active" type="checkbox" />
            <span>El restaurante está <strong>Activo</strong> y autorizado para generar pedidos</span>
          </label>

          <div v-if="modalError" class="modal-error">
            {{ modalError }}
          </div>

          <footer class="modal-footer">
            <button type="button" class="btn-secondary" @click="showModal = false">
              Cancelar
            </button>
            <button type="submit" class="btn-primary" :disabled="savingRestaurant">
              {{ savingRestaurant ? 'Guardando...' : '💾 Guardar Cambios' }}
            </button>
          </footer>
        </form>
      </div>
    </div>

    <!-- MODAL DE CONFIRMACIÓN DE ELIMINACIÓN -->
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <div class="modal-card modal-small">
        <header class="modal-header">
          <h3>🗑️ Eliminar Restaurante</h3>
          <button type="button" class="modal-close" @click="deleteTarget = null">✕</button>
        </header>
        <div class="modal-body">
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.5;">
            ¿Estás seguro de que deseas eliminar a
            <strong>{{ deleteTarget.name }} (#{{ deleteTarget.code }})</strong>?
          </p>
          <p style="margin: 0; font-size: 0.85rem; color: #dc2626;">
            Esta acción eliminará el restaurante y sus pedidos asociados de forma permanente.
          </p>
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn-secondary" @click="deleteTarget = null">
            Cancelar
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="deletingRestaurant"
            @click="executeDeleteRestaurant"
          >
            {{ deletingRestaurant ? 'Eliminando...' : 'Sí, eliminar restaurante' }}
          </button>
        </footer>
      </div>
    </div>

    <!-- TOAST FLOTANTE -->
    <div v-if="toast.show" :class="['admin-toast', toast.type]">
      {{ toast.message }}
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 270px 1fr;
  background: #f1f5f9;
  color: #0f172a;
}

/* SIDEBAR */
.admin-sidebar {
  background: #0f172a;
  color: #f8fafc;
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: sticky;
  top: 0;
  height: 100vh;
  box-sizing: border-box;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.brand-logo {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: linear-gradient(135deg, #d71920, #991b1b);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 900;
  color: #fff;
  box-shadow: 0 4px 12px rgba(215, 25, 32, 0.4);
}

.sidebar-brand h1 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.admin-badge {
  display: inline-block;
  margin-top: 3px;
  font-size: 0.72rem;
  background: rgba(215, 25, 32, 0.25);
  color: #fca5a5;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 700;
}

.sidebar-nav {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: transparent;
  color: #cbd5e1;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.nav-item.active {
  background: linear-gradient(135deg, #d71920, #b9151b);
  color: #fff;
  box-shadow: 0 6px 16px rgba(215, 25, 32, 0.32);
}

.nav-icon {
  font-size: 1.35rem;
}

.nav-text {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.nav-text strong {
  font-size: 0.95rem;
}

.nav-text small {
  font-size: 0.75rem;
  opacity: 0.8;
}

.nav-counter {
  background: rgba(0, 0, 0, 0.25);
  padding: 3px 8px;
  border-radius: 99px;
  font-size: 0.75rem;
  font-weight: 700;
}

.sidebar-footer {
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-logout {
  width: 100%;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #fda4af;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 0.2s;
}

.btn-logout:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* MAIN AREA */
.admin-main {
  padding: 28px 32px 48px;
  max-width: 1600px;
  width: 100%;
  box-sizing: border-box;
}

.admin-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.admin-topbar h2 {
  margin: 0 0 6px;
  font-size: 1.65rem;
  font-weight: 800;
  color: #0f172a;
}

.topbar-sub {
  margin: 0;
  color: #64748b;
  font-size: 0.92rem;
}

.topbar-actions {
  display: flex;
  gap: 10px;
}

.btn-primary {
  background: linear-gradient(135deg, #d71920, #b9151b);
  color: #fff;
  border: none;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(215, 25, 32, 0.25);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: #fff;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
}

.btn-danger {
  background: #dc2626;
  color: #fff;
  border: none;
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
}

/* FILTERS CARD */
.filters-card {
  background: #fff;
  border-radius: 16px;
  padding: 18px 22px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
  margin-bottom: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.period-pills {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-label {
  font-weight: 700;
  font-size: 0.88rem;
  color: #475569;
}

.pills-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pill-btn {
  padding: 7px 14px;
  border-radius: 99px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  font-size: 0.84rem;
  cursor: pointer;
  transition: all 0.15s;
}

.pill-btn.active {
  background: #d71920;
  color: #fff;
  border-color: #d71920;
}

.custom-dates-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
}

.filter-input-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-input-box input {
  padding: 7px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}

.filters-selects-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}

.filter-select-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.filter-select-item label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #475569;
}

.filter-select-item select {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font-size: 0.9rem;
  font-weight: 600;
  color: #1e293b;
}

/* KPIS GRID */
.kpis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.kpi-card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
  border-top: 4px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kpi-red { border-top-color: #d71920; }
.kpi-emerald { border-top-color: #10b981; }
.kpi-blue { border-top-color: #2563eb; }
.kpi-purple { border-top-color: #8b5cf6; }
.kpi-amber { border-top-color: #f59e0b; }
.kpi-slate { border-top-color: #0f172a; }

.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kpi-icon {
  font-size: 1.5rem;
}

.kpi-trend {
  font-size: 0.78rem;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 99px;
}

.trend-up {
  background: #dcfce7;
  color: #15803d;
}

.trend-down {
  background: #fee2e2;
  color: #b91c1c;
}

.kpi-badge-neutral {
  font-size: 0.75rem;
  font-weight: 700;
  background: #f1f5f9;
  color: #475569;
  padding: 3px 8px;
  border-radius: 99px;
}

.kpi-value {
  font-size: 1.85rem;
  font-weight: 900;
  color: #0f172a;
  margin-top: 4px;
}

.kpi-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: #334155;
}

.kpi-sub {
  font-size: 0.78rem;
  color: #64748b;
}

/* CHARTS */
.charts-grid-two {
  display: grid;
  grid-template-columns: 1.65fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.charts-grid-three {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.chart-card {
  background: #fff;
  border-radius: 16px;
  padding: 22px;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
  display: flex;
  flex-direction: column;
}

.chart-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.chart-header h3 {
  margin: 0 0 4px;
  font-size: 1.05rem;
  font-weight: 800;
}

.chart-header p {
  margin: 0;
  font-size: 0.8rem;
  color: #64748b;
}

.chart-toggle {
  display: flex;
  background: #f1f5f9;
  padding: 3px;
  border-radius: 8px;
  gap: 4px;
}

.toggle-btn {
  border: none;
  background: transparent;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
}

.toggle-btn.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* BAR CHART */
.bar-chart-wrapper {
  flex: 1;
  display: flex;
  align-items: flex-end;
  min-height: 220px;
  padding-top: 12px;
}

.bar-chart-columns {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  width: 100%;
  height: 200px;
}

.bar-col-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  min-width: 18px;
}

.bar-top-val {
  font-size: 0.68rem;
  font-weight: 700;
  color: #475569;
  min-height: 16px;
}

.bar-track {
  flex: 1;
  width: 100%;
  max-width: 28px;
  background: #f1f5f9;
  border-radius: 6px 6px 0 0;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.bar-fill {
  width: 100%;
  border-radius: 6px 6px 0 0;
  transition: height 0.35s ease;
}

.fill-red {
  background: linear-gradient(180deg, #ef4444, #d71920);
}

.fill-emerald {
  background: linear-gradient(180deg, #34d399, #059669);
}

.bar-label {
  font-size: 0.68rem;
  color: #64748b;
  margin-top: 6px;
  transform: rotate(-25deg);
  white-space: nowrap;
}

/* DONUT */
.donut-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.donut-svg-box {
  position: relative;
  width: 165px;
  height: 165px;
}

.donut-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.donut-center strong {
  font-size: 1.5rem;
  font-weight: 900;
}

.donut-center span {
  font-size: 0.75rem;
  color: #64748b;
}

.donut-legend {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 0.84rem;
}

.legend-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.legend-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.legend-right small {
  color: #64748b;
  font-size: 0.74rem;
}

/* RANKING TOP RESTAURANTS */
.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ranking-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ranking-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ranking-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rank-num {
  font-weight: 800;
  font-size: 0.8rem;
  color: #d71920;
  width: 22px;
}

.rank-avatar {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
}

.rank-avatar-placeholder {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: #fee2e2;
  color: #d71920;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rank-name {
  display: block;
  font-size: 0.88rem;
}

.rank-code {
  font-size: 0.74rem;
  color: #64748b;
}

.ranking-metrics {
  text-align: right;
}

.rank-orders {
  display: block;
  font-size: 0.78rem;
  color: #475569;
}

.rank-fees {
  font-size: 0.86rem;
  color: #059669;
}

.ranking-bar-bg {
  height: 6px;
  background: #f1f5f9;
  border-radius: 99px;
  overflow: hidden;
}

.ranking-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #d71920, #f97316);
  border-radius: 99px;
}

/* HOURLY CHART */
.hourly-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 140px;
  padding-top: 10px;
  margin-bottom: 18px;
}

.hour-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.hour-val {
  font-size: 0.65rem;
  font-weight: 700;
  color: #475569;
  min-height: 14px;
}

.hour-track {
  flex: 1;
  width: 100%;
  background: #f1f5f9;
  border-radius: 4px 4px 0 0;
  display: flex;
  align-items: flex-end;
}

.hour-fill {
  width: 100%;
  background: #3b82f6;
  border-radius: 4px 4px 0 0;
}

.hour-fill.hour-peak {
  background: #d71920;
}

.hour-label {
  font-size: 0.65rem;
  color: #64748b;
  margin-top: 4px;
}

.distance-ranges-box {
  border-top: 1px solid #f1f5f9;
  padding-top: 14px;
}

.distance-ranges-box h4 {
  margin: 0 0 10px;
  font-size: 0.85rem;
  color: #334155;
}

.distance-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dist-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  margin-bottom: 3px;
}

.dist-progress-bg {
  height: 6px;
  background: #f1f5f9;
  border-radius: 99px;
  overflow: hidden;
}

.dist-progress-fill {
  height: 100%;
  background: #f59e0b;
}

/* ZONES */
.zones-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.zone-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zone-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
}

.zone-badge {
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f1f5f9;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  margin-right: 6px;
}

.zone-stats {
  font-weight: 700;
  color: #2563eb;
  font-size: 0.8rem;
}

.zone-sub {
  display: flex;
  justify-content: space-between;
  font-size: 0.74rem;
  color: #64748b;
}

.zone-bar-bg {
  height: 5px;
  background: #f1f5f9;
  border-radius: 99px;
  overflow: hidden;
}

.zone-bar-fill {
  height: 100%;
  background: #2563eb;
}

/* TABLE */
.table-card {
  background: #fff;
  border-radius: 16px;
  padding: 22px;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
}

.table-header h3 {
  margin: 0 0 4px;
  font-size: 1.05rem;
}

.table-header p {
  margin: 0 0 16px;
  font-size: 0.8rem;
  color: #64748b;
}

.table-responsive {
  overflow-x: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}

.admin-table th {
  text-align: left;
  padding: 12px;
  background: #f8fafc;
  color: #475569;
  font-weight: 700;
  border-bottom: 1px solid #e2e8f0;
}

.admin-table td {
  padding: 12px;
  border-bottom: 1px solid #f1f5f9;
}

.folio-pill {
  font-family: monospace;
  font-weight: 700;
  background: #f1f5f9;
  padding: 4px 8px;
  border-radius: 6px;
}

.table-rest-cell {
  display: flex;
  flex-direction: column;
}

.table-rest-cell small {
  color: #64748b;
  font-size: 0.75rem;
}

.btn-table-link {
  display: inline-block;
  padding: 6px 10px;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.78rem;
}

/* CRUD RESTAURANTES */
.crud-stats-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.crud-stat-pill {
  background: #fff;
  padding: 10px 16px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.crud-toolbar {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.search-box {
  flex: 1;
  min-width: 260px;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
}

.search-box input {
  width: 100%;
  padding: 10px 14px 10px 36px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  font-size: 0.92rem;
}

.crud-filters-right {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.crud-filters-right select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font-weight: 600;
}

.restaurants-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 20px;
}

.rest-card {
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s;
}

.rest-card:hover {
  transform: translateY(-2px);
}

.rest-inactive {
  opacity: 0.72;
}

.rest-card-media {
  position: relative;
  height: 165px;
  background: linear-gradient(135deg, #1e293b, #334155);
}

.rest-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rest-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  color: #cbd5e1;
}

.placeholder-circle {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 1.5rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-photo-hint {
  font-size: 0.78rem;
  background: rgba(0, 0, 0, 0.35);
  padding: 4px 10px;
  border-radius: 99px;
}

.rest-code-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(15, 23, 42, 0.85);
  color: #fff;
  padding: 4px 10px;
  border-radius: 8px;
  font-weight: 800;
  font-size: 0.82rem;
}

.status-pill-toggle {
  position: absolute;
  top: 12px;
  right: 12px;
  border: none;
  padding: 5px 11px;
  border-radius: 99px;
  font-size: 0.76rem;
  font-weight: 800;
  cursor: pointer;
}

.status-pill-toggle.active {
  background: #dcfce7;
  color: #15803d;
}

.status-pill-toggle.inactive {
  background: #fee2e2;
  color: #b91c1c;
}

.rest-card-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.rest-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
}

.rest-desc {
  margin: 0;
  font-size: 0.85rem;
  color: #475569;
  line-height: 1.45;
}

.rest-desc-empty {
  margin: 0;
  font-size: 0.82rem;
  color: #94a3b8;
  font-style: italic;
}

.profile-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.field-chip {
  font-size: 0.74rem;
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 99px;
  text-decoration: none;
}

.chip-ok {
  background: #ecfdf5;
  color: #047857;
}

.chip-link:hover {
  background: #d1fae5;
}

.chip-missing {
  background: #f1f5f9;
  color: #64748b;
}

.rest-metrics-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: #f8fafc;
  padding: 10px;
  border-radius: 10px;
  text-align: center;
}

.rest-metrics-strip small {
  display: block;
  font-size: 0.7rem;
  color: #64748b;
}

.rest-metrics-strip strong {
  font-size: 0.9rem;
  color: #0f172a;
}

.rest-card-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.btn-edit-rest {
  flex: 1;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  font-weight: 700;
  font-size: 0.84rem;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-edit-rest:hover {
  background: #0f172a;
  color: #fff;
}

.btn-delete-rest {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #fecdd3;
  background: #fff1f2;
  cursor: pointer;
}

/* MODAL */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

.modal-card {
  background: #fff;
  border-radius: 18px;
  width: 100%;
  max-width: 560px;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}

.modal-small {
  max-width: 420px;
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-header h3 {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.modal-header p {
  margin: 0;
  font-size: 0.82rem;
  color: #64748b;
}

.modal-close {
  border: none;
  background: #f1f5f9;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
}

.modal-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 0.85rem;
  font-weight: 700;
  color: #334155;
}

.form-field input,
.form-field textarea {
  width: 100%;
  padding: 11px 13px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 0.92rem;
  box-sizing: border-box;
}

.form-field small {
  font-size: 0.75rem;
  color: #64748b;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mini-tabs {
  display: flex;
  background: #f1f5f9;
  padding: 2px;
  border-radius: 6px;
}

.mini-tab {
  border: none;
  background: transparent;
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 5px;
  cursor: pointer;
}

.mini-tab.active {
  background: #fff;
  color: #d71920;
}

.upload-zone {
  border: 1px dashed #cbd5e1;
  padding: 12px;
  border-radius: 10px;
  background: #f8fafc;
}

.photo-preview-box {
  margin-top: 8px;
  position: relative;
  height: 150px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.photo-preview-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.btn-remove-photo {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(15, 23, 42, 0.8);
  color: #fff;
  border: none;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  cursor: pointer;
}

.input-with-action {
  display: flex;
  gap: 8px;
}

.btn-test-map {
  background: #eff6ff;
  color: #1d4ed8;
  padding: 10px 12px;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.82rem;
  white-space: nowrap;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  cursor: pointer;
}

.modal-error {
  background: #fff1f2;
  color: #be123c;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.84rem;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.empty-chart {
  padding: 36px 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 0.9rem;
}

.admin-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 14px 20px;
  border-radius: 12px;
  background: #0f172a;
  color: #fff;
  font-weight: 700;
  font-size: 0.9rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  z-index: 2000;
}

.admin-toast.error {
  background: #dc2626;
}

@media (max-width: 1024px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }

  .admin-sidebar {
    height: auto;
    position: relative;
  }

  .charts-grid-two {
    grid-template-columns: 1fr;
  }
}
</style>
