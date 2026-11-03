<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'

const router = useRouter()

// Navegación principal del Dashboard
const activeSection = ref('resumen') // 'resumen' | 'restaurantes'
const summaryTab = ref('charts') // 'charts' | 'orders'

// Paginación para adaptar al monitor sin scrollbars
const ordersPage = ref(1)
const ORDERS_PER_PAGE = 7

const restaurantsPage = ref(1)
const RESTAURANTS_PER_PAGE = 6

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
    ordersPage.value = 1
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

function switchToSection(section, subTab = null) {
  activeSection.value = section
  if (subTab) {
    summaryTab.value = subTab
  }
}

// Paginación de pedidos recientes en monitor
const totalOrdersPages = computed(() => {
  const total = summaryData.recent_orders?.length || 0
  return Math.max(1, Math.ceil(total / ORDERS_PER_PAGE))
})

const paginatedRecentOrders = computed(() => {
  const list = summaryData.recent_orders || []
  const start = (ordersPage.value - 1) * ORDERS_PER_PAGE
  return list.slice(start, start + ORDERS_PER_PAGE)
})

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
    restaurantsPage.value = 1
  } catch (err) {
    console.error('Error al cargar restaurantes:', err)
    showToast('Error al obtener la lista de restaurantes.', 'error')
  } finally {
    restaurantsLoading.value = false
  }
}

const totalRestaurantsPages = computed(() => {
  const total = restaurants.value?.length || 0
  return Math.max(1, Math.ceil(total / RESTAURANTS_PER_PAGE))
})

const paginatedRestaurants = computed(() => {
  const list = restaurants.value || []
  const start = (restaurantsPage.value - 1) * RESTAURANTS_PER_PAGE
  return list.slice(start, start + RESTAURANTS_PER_PAGE)
})

watch(
  () => restaurants.value.length,
  () => {
    if (restaurantsPage.value > totalRestaurantsPages.value) {
      restaurantsPage.value = totalRestaurantsPages.value
    }
  }
)

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
  } catch {
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
  } catch {
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
    <!-- ===================================================== -->
    <!-- BARRA LATERAL DESKTOP (Fija en monitor sin scroll)    -->
    <!-- ===================================================== -->
    <aside class="admin-sidebar">
      <div class="sidebar-top">
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
            :class="['nav-item', { active: activeSection === 'resumen' && summaryTab === 'charts' }]"
            @click="switchToSection('resumen', 'charts')"
          >
            <span class="nav-icon">📊</span>
            <div class="nav-text">
              <strong>Resumen Gráfico</strong>
              <small>KPIs y analítica</small>
            </div>
          </button>

          <button
            type="button"
            :class="['nav-item', { active: activeSection === 'resumen' && summaryTab === 'orders' }]"
            @click="switchToSection('resumen', 'orders')"
          >
            <span class="nav-icon">🧾</span>
            <div class="nav-text">
              <strong>Últimos Pedidos</strong>
              <small>Historial y tickets</small>
            </div>
            <span class="nav-counter">{{ summaryData.recent_orders.length }}</span>
          </button>

          <button
            type="button"
            :class="['nav-item', { active: activeSection === 'restaurantes' }]"
            @click="switchToSection('restaurantes')"
          >
            <span class="nav-icon">🏪</span>
            <div class="nav-text">
              <strong>Restaurantes</strong>
              <small>CRUD, foto y mapa</small>
            </div>
            <span class="nav-counter">{{ summaryData.kpis.total_restaurants }}</span>
          </button>
        </nav>
      </div>

      <div class="sidebar-footer">
        <button type="button" class="btn-sidebar-new" @click="openCreateModal">
          ➕ Nuevo Restaurante
        </button>
        <button type="button" class="btn-logout" @click="logoutAdmin">
          <span>🚪</span> Cerrar sesión
        </button>
      </div>
    </aside>

    <!-- ===================================================== -->
    <!-- HEADER MÓVIL COMPACTO (Visible solo en celular/tablet)-->
    <!-- ===================================================== -->
    <header class="mobile-admin-header">
      <div class="mobile-brand-left">
        <div class="brand-logo-sm">R</div>
        <div>
          <strong>RODO Admin</strong>
          <span class="mobile-code-pill">#000</span>
        </div>
      </div>
      <div class="mobile-header-actions">
        <button
          v-if="activeSection === 'resumen'"
          type="button"
          class="btn-mobile-icon"
          :disabled="summaryLoading"
          title="Actualizar"
          @click="fetchSummary"
        >
          🔄
        </button>
        <button
          type="button"
          class="btn-mobile-icon"
          title="Nuevo Restaurante"
          @click="openCreateModal"
        >
          ➕
        </button>
        <button
          type="button"
          class="btn-mobile-icon btn-mobile-exit"
          title="Cerrar sesión"
          @click="logoutAdmin"
        >
          🚪
        </button>
      </div>
    </header>

    <!-- ===================================================== -->
    <!-- ÁREA PRINCIPAL ADAPTADA 100% AL MONITOR               -->
    <!-- ===================================================== -->
    <main class="admin-main">
      <!-- Topbar compacta -->
      <header class="admin-topbar">
        <div class="topbar-title-group">
          <h2 v-if="activeSection === 'resumen'">
            {{ summaryTab === 'charts' ? 'Resumen General de la Plataforma' : 'Últimos Pedidos Registrados' }}
          </h2>
          <h2 v-else>Directorio y CRUD de Restaurantes</h2>
          <span class="topbar-subtitle-inline">
            <template v-if="activeSection === 'resumen'">
              Monitoreo en tiempo real de entregas, tarifas y zonas
            </template>
            <template v-else>
              Gestiona fotos, enlaces de Google Maps y descripciones de cada local
            </template>
          </span>
        </div>

        <div class="topbar-actions">
          <!-- Selector rápido de vista en Resumen -->
          <div v-if="activeSection === 'resumen'" class="view-mode-pills">
            <button
              type="button"
              :class="['mode-pill', { active: summaryTab === 'charts' }]"
              @click="summaryTab = 'charts'"
            >
              📊 Gráficas
            </button>
            <button
              type="button"
              :class="['mode-pill', { active: summaryTab === 'orders' }]"
              @click="summaryTab = 'orders'"
            >
              🧾 Pedidos ({{ summaryData.recent_orders.length }})
            </button>
          </div>

          <button
            v-if="activeSection === 'resumen'"
            type="button"
            class="btn-secondary btn-compact"
            @click="exportRecentOrdersCsv"
          >
            📥 CSV
          </button>
          <button
            v-if="activeSection === 'resumen'"
            type="button"
            class="btn-primary btn-compact"
            :disabled="summaryLoading"
            @click="fetchSummary"
          >
            {{ summaryLoading ? 'Cargando...' : '🔄 Actualizar' }}
          </button>
          <button
            v-if="activeSection === 'restaurantes'"
            type="button"
            class="btn-primary btn-compact"
            @click="openCreateModal"
          >
            ➕ Nuevo Restaurante
          </button>
        </div>
      </header>

      <!-- ===================================================== -->
      <!-- SECCIÓN 1: RESUMEN (100% MONITOR SIN SCROLL)          -->
      <!-- ===================================================== -->
      <section v-if="activeSection === 'resumen'" class="monitor-section">
        <!-- Barra horizontal compacta de filtros -->
        <div class="filters-strip">
          <div class="pills-scroll-row">
            <span class="filter-tag">Periodo:</span>
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
              Mes
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
              📅 Rango
            </button>
          </div>

          <div v-if="filters.period === 'custom'" class="custom-dates-inline">
            <input v-model="filters.date_from" type="date" aria-label="Desde" @change="fetchSummary" />
            <span>a</span>
            <input v-model="filters.date_to" type="date" aria-label="Hasta" @change="fetchSummary" />
          </div>

          <div class="filters-selects-inline">
            <select v-model="filters.restaurant_id" aria-label="Filtrar por restaurante" @change="fetchSummary">
              <option value="all">🏪 Todos los locales ({{ summaryData.restaurants_list.length }})</option>
              <option v-for="r in summaryData.restaurants_list" :key="r.id" :value="r.id">
                {{ r.name }} (#{{ r.code }})
              </option>
            </select>

            <select v-model="filters.payment_method" aria-label="Filtrar por método de pago" @change="fetchSummary">
              <option value="all">💳 Todos los pagos</option>
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Pagado">Ya pagado / Tarjeta</option>
            </select>
          </div>
        </div>

        <!-- 6 KPIS EN UNA SOLA FILA EN MONITOR (2 COLUMNAS EN MÓVIL) -->
        <div class="kpis-row">
          <div class="kpi-card kpi-red">
            <div class="kpi-top">
              <span class="kpi-icon">📦</span>
              <span :class="['kpi-trend', summaryData.kpis.orders_growth_pct >= 0 ? 'trend-up' : 'trend-down']">
                {{ summaryData.kpis.orders_growth_pct >= 0 ? '▲' : '▼' }}{{ Math.abs(summaryData.kpis.orders_growth_pct) }}%
              </span>
            </div>
            <div class="kpi-value">{{ summaryData.kpis.total_orders }}</div>
            <div class="kpi-title">Pedidos Registrados</div>
            <div class="kpi-sub">
              ✓ {{ summaryData.kpis.orders_ready_count }} listos · {{ summaryData.kpis.orders_needing_change }} con cambio
            </div>
          </div>

          <div class="kpi-card kpi-emerald">
            <div class="kpi-top">
              <span class="kpi-icon">🛵</span>
              <span :class="['kpi-trend', summaryData.kpis.fees_growth_pct >= 0 ? 'trend-up' : 'trend-down']">
                {{ summaryData.kpis.fees_growth_pct >= 0 ? '▲' : '▼' }}{{ Math.abs(summaryData.kpis.fees_growth_pct) }}%
              </span>
            </div>
            <div class="kpi-value">{{ formatCurrency(summaryData.kpis.total_delivery_fees) }}</div>
            <div class="kpi-title">Ingresos en Tarifas</div>
            <div class="kpi-sub">
              Prom: <strong>{{ formatCurrency(summaryData.kpis.avg_delivery_fee) }}</strong> / envío
            </div>
          </div>

          <div class="kpi-card kpi-blue">
            <div class="kpi-top">
              <span class="kpi-icon">💵</span>
              <span class="kpi-badge-neutral">Flujo calle</span>
            </div>
            <div class="kpi-value">{{ formatCurrency(summaryData.kpis.total_collected) }}</div>
            <div class="kpi-title">Monto en Cobros</div>
            <div class="kpi-sub">
              Ticket prom: <strong>{{ formatCurrency(summaryData.kpis.avg_ticket_collect) }}</strong>
            </div>
          </div>

          <div class="kpi-card kpi-purple" style="cursor: pointer;" @click="switchToSection('restaurantes')">
            <div class="kpi-top">
              <span class="kpi-icon">🏪</span>
              <span class="kpi-badge-neutral">{{ summaryData.kpis.restaurants_with_orders }} activos</span>
            </div>
            <div class="kpi-value">
              {{ summaryData.kpis.active_restaurants }}
              <small class="kpi-fraction">/ {{ summaryData.kpis.total_restaurants }}</small>
            </div>
            <div class="kpi-title">Locales Registrados</div>
            <div class="kpi-sub">
              ✨ {{ summaryData.kpis.restaurants_with_complete_profile }} con perfil completo
            </div>
          </div>

          <div class="kpi-card kpi-amber">
            <div class="kpi-top">
              <span class="kpi-icon">📍</span>
              <span class="kpi-badge-neutral">Radio ≤ 5km</span>
            </div>
            <div class="kpi-value">
              {{ summaryData.kpis.total_distance_km }} <small class="kpi-fraction">km</small>
            </div>
            <div class="kpi-title">Kilómetros de Ruta</div>
            <div class="kpi-sub">
              Prom: <strong>{{ summaryData.kpis.avg_distance_km }} km</strong> / entrega
            </div>
          </div>

          <div class="kpi-card kpi-slate">
            <div class="kpi-top">
              <span class="kpi-icon">⚡</span>
              <span class="kpi-badge-neutral">Apoyo líder</span>
            </div>
            <div class="kpi-value">{{ summaryData.kpis.total_riders_requested }}</div>
            <div class="kpi-title">Motos Solicitadas</div>
            <div class="kpi-sub">
              En <strong>{{ summaryData.kpis.total_rider_requests }}</strong> alertas rápidas
            </div>
          </div>
        </div>

        <!-- SUB-VISTA A: BENTO GRID DE GRÁFICAS (CABE 100% EN EL MONITOR) -->
        <div v-if="summaryTab === 'charts'" class="bento-charts-workspace">
          <!-- FILA SUPERIOR DE GRÁFICAS -->
          <div class="bento-row-top">
            <!-- Gráfica 1: Tendencia Diaria -->
            <div class="chart-card">
              <div class="chart-header">
                <div>
                  <h3>📈 Evolución de Actividad Diaria</h3>
                  <p>Órdenes y tarifas generadas por día</p>
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
                    💵 Tarifas
                  </button>
                </div>
              </div>

              <div v-if="summaryData.charts.daily_trend.length" class="bar-chart-wrapper">
                <div class="bar-chart-columns">
                  <div
                    v-for="day in summaryData.charts.daily_trend"
                    :key="day.date"
                    class="bar-col-item"
                    :title="`${day.date}: ${day.orders_count} pedidos | ${formatCurrency(day.delivery_fees)}`"
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

            <!-- Gráfica 2: Dona de Métodos de Pago (Horizontal para encajar en monitor) -->
            <div class="chart-card">
              <div class="chart-header">
                <div>
                  <h3>💳 Métodos de Pago</h3>
                  <p>Distribución de cobros en entregas</p>
                </div>
              </div>

              <div v-if="paymentDonutSegments.length" class="donut-horizontal-layout">
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
                  <div v-for="seg in paymentDonutSegments" :key="seg.method" class="legend-row">
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

          <!-- FILA INFERIOR DE GRÁFICAS (3 COLUMNAS EN MONITOR) -->
          <div class="bento-row-bottom">
            <!-- Gráfica 3: Top Restaurantes -->
            <div class="chart-card">
              <div class="chart-header">
                <div>
                  <h3>🏆 Top Restaurantes Activos</h3>
                  <p>Mayor volumen de envíos y tarifas</p>
                </div>
              </div>

              <div v-if="summaryData.charts.top_restaurants.length" class="ranking-list">
                <div
                  v-for="(rest, idx) in summaryData.charts.top_restaurants.slice(0, 4)"
                  :key="rest.id"
                  class="ranking-item"
                >
                  <div class="ranking-top">
                    <div class="ranking-identity">
                      <span class="rank-num">#{{ idx + 1 }}</span>
                      <img v-if="rest.photo_url" :src="rest.photo_url" alt="Logo" class="rank-avatar" />
                      <div v-else class="rank-avatar-placeholder">
                        {{ rest.name.charAt(0).toUpperCase() }}
                      </div>
                      <div class="rank-text-box">
                        <strong class="rank-name">{{ rest.name }}</strong>
                        <small class="rank-code">#{{ rest.code }} · {{ rest.avg_distance }} km prom.</small>
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
              <div v-else class="empty-chart">Sin pedidos por restaurante en este filtro.</div>
            </div>

            <!-- Gráfica 4: Horas Pico + Rangos de Distancia -->
            <div class="chart-card">
              <div class="chart-header">
                <div>
                  <h3>⏰ Demanda por Hora y Distancia</h3>
                  <p>
                    Flujo horario
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

              <div class="distance-pills-strip">
                <div
                  v-for="dr in summaryData.charts.distance_ranges"
                  :key="dr.range"
                  class="dist-mini-pill"
                >
                  <span class="dist-range-lbl">{{ dr.range }}</span>
                  <strong>{{ dr.count }} ({{ dr.percentage }}%)</strong>
                </div>
              </div>
            </div>

            <!-- Gráfica 5: Top Colonias -->
            <div class="chart-card">
              <div class="chart-header">
                <div>
                  <h3>🗺️ Top Colonias de Entrega</h3>
                  <p>Zonas con mayor concentración de envíos</p>
                </div>
              </div>

              <div v-if="summaryData.charts.top_neighborhoods.length" class="zones-list">
                <div
                  v-for="(zone, idx) in summaryData.charts.top_neighborhoods.slice(0, 4)"
                  :key="zone.neighborhood"
                  class="zone-item"
                >
                  <div class="zone-header">
                    <div class="zone-title-wrap">
                      <span class="zone-badge">{{ idx + 1 }}</span>
                      <strong>{{ zone.neighborhood }}</strong>
                    </div>
                    <span class="zone-stats">{{ zone.orders_count }} ({{ zone.percentage }}%)</span>
                  </div>
                  <div class="zone-sub">
                    <span>Prom: {{ zone.avg_distance }} km</span>
                    <span>{{ formatCurrency(zone.total_fees) }}</span>
                  </div>
                  <div class="zone-bar-bg">
                    <div class="zone-bar-fill" :style="{ width: Math.max(zone.percentage, 5) + '%' }" />
                  </div>
                </div>
              </div>
              <div v-else class="empty-chart">Sin registros de colonias en este periodo.</div>
            </div>
          </div>
        </div>

        <!-- SUB-VISTA B: TABLA PAGINADA DE ÚLTIMOS PEDIDOS (SIN SCROLL EN MONITOR) -->
        <div v-else class="orders-workspace-card">
          <div class="table-header-row">
            <div>
              <h3>🧾 Historial Reciente de Entregas</h3>
              <p>Consulta rápida de folios, tarifas y enlace directo al ticket digital</p>
            </div>
            <div v-if="totalOrdersPages > 1" class="pagination-controls">
              <button
                type="button"
                class="page-btn"
                :disabled="ordersPage <= 1"
                @click="ordersPage--"
              >
                ◀ Anterior
              </button>
              <span class="page-indicator">Página {{ ordersPage }} de {{ totalOrdersPages }}</span>
              <button
                type="button"
                class="page-btn"
                :disabled="ordersPage >= totalOrdersPages"
                @click="ordersPage++"
              >
                Siguiente ▶
              </button>
            </div>
          </div>

          <!-- Vista Tabla para Monitor/Tablet -->
          <div v-if="paginatedRecentOrders.length" class="table-desktop-wrap">
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
                <tr v-for="order in paginatedRecentOrders" :key="order.id">
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
                      👁️ Ticket
                    </router-link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Tarjetas de Pedidos para Móvil (100% Responsivas sin tabla ancha) -->
          <div v-if="summaryData.recent_orders.length" class="mobile-orders-list">
            <div v-for="order in summaryData.recent_orders" :key="'mob-' + order.id" class="mobile-order-card">
              <div class="mob-order-top">
                <span class="folio-pill">{{ order.folio }}</span>
                <span class="mob-order-date">{{ formatDateShort(order.created_at) }}</span>
              </div>
              <div class="mob-order-rest">
                🏪 <strong>{{ order.restaurant?.name }}</strong>
                <small>(#{{ order.restaurant?.code }})</small>
              </div>
              <div class="mob-order-dest">
                📍 {{ order.customer_name }} · {{ order.neighborhood }} ({{ order.distance_km }} km)
              </div>
              <div class="mob-order-bottom">
                <div>
                  <strong class="mob-fee">{{ formatCurrency(order.delivery_fee) }}</strong>
                  <small class="mob-pay">
                    · {{ order.payment_method }}
                    <template v-if="order.amount_to_collect">
                      (Cobrar {{ formatCurrency(order.amount_to_collect) }})
                    </template>
                  </small>
                </div>
                <router-link :to="`/ticket/${order.public_token}`" target="_blank" class="btn-table-link">
                  👁️ Ver Ticket
                </router-link>
              </div>
            </div>
          </div>

          <div v-if="!summaryData.recent_orders.length" class="empty-chart">
            No hay pedidos registrados para los filtros seleccionados.
          </div>
        </div>
      </section>

      <!-- ===================================================== -->
      <!-- SECCIÓN 2: CRUD DE RESTAURANTES (ADAPTADO AL MONITOR) -->
      <!-- ===================================================== -->
      <section v-else class="monitor-section">
        <!-- Barra unificada de estadísticas y búsqueda del CRUD -->
        <div class="crud-header-bar">
          <div class="crud-stats-pills">
            <div class="crud-stat-pill">
              <span>Total:</span>
              <strong>{{ filteredRestaurantsStats.total }}</strong>
            </div>
            <div class="crud-stat-pill stat-green">
              <span>Activos:</span>
              <strong>{{ filteredRestaurantsStats.active }}</strong>
            </div>
            <div class="crud-stat-pill stat-blue">
              <span>Perfil completo:</span>
              <strong>{{ filteredRestaurantsStats.complete }}</strong>
            </div>
            <div class="crud-stat-pill stat-amber">
              <span>Por completar:</span>
              <strong>{{ filteredRestaurantsStats.incomplete }}</strong>
            </div>
          </div>

          <div class="crud-search-controls">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input
                v-model="restaurantFilters.search"
                type="text"
                placeholder="Buscar local o código (ej. 609)..."
                @input="fetchRestaurants"
              />
            </div>

            <select v-model="restaurantFilters.status" aria-label="Filtrar por estado" @change="fetchRestaurants">
              <option value="all">Estado: Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>

            <select v-model="restaurantFilters.profile" aria-label="Filtrar por perfil" @change="fetchRestaurants">
              <option value="all">Perfil: Todos</option>
              <option value="complete">✓ Completo</option>
              <option value="incomplete">⚠️ Incompleto</option>
            </select>
          </div>
        </div>

        <div v-if="restaurantsLoading" class="empty-chart">Cargando directorio de restaurantes...</div>

        <!-- Grid Paginado 3x2 en Monitor (y Lista fluida en Móvil) -->
        <div v-else-if="restaurants.length" class="crud-monitor-body">
          <div class="restaurants-grid">
            <article
              v-for="rest in paginatedRestaurants"
              :key="rest.id"
              :class="['rest-card', { 'rest-inactive': !rest.is_active }]"
            >
              <div class="rest-card-top">
                <!-- Miniatura / Foto -->
                <div class="rest-avatar-box" @click="openEditModal(rest)">
                  <img
                    v-if="rest.photo_url"
                    :src="rest.photo_url"
                    :alt="rest.name"
                    class="rest-thumb-img"
                  />
                  <div v-else class="rest-thumb-placeholder">
                    <span>{{ rest.name.charAt(0).toUpperCase() }}</span>
                    <small>📷 Foto</small>
                  </div>
                </div>

                <!-- Datos principales -->
                <div class="rest-head-info">
                  <div class="rest-badges-line">
                    <span class="rest-code-badge">#{{ rest.code }}</span>
                    <button
                      type="button"
                      :class="['status-pill-toggle', rest.is_active ? 'active' : 'inactive']"
                      @click="toggleRestaurantStatus(rest)"
                    >
                      {{ rest.is_active ? '● Activo' : '○ Inactivo' }}
                    </button>
                  </div>
                  <h3 class="rest-title" :title="rest.name">{{ rest.name }}</h3>
                  <p v-if="rest.description" class="rest-desc">{{ rest.description }}</p>
                  <p v-else class="rest-desc-empty">
                    Sin descripción. Clic en editar para agregar giro, horario o referencias.
                  </p>
                </div>
              </div>

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
                  📍 Mapa URL ↗
                </a>
                <span v-else class="field-chip chip-missing">
                  ○ Sin mapa URL
                </span>
                <span :class="['field-chip', rest.description ? 'chip-ok' : 'chip-missing']">
                  {{ rest.description ? '✓ Descripción' : '○ Sin desc.' }}
                </span>
              </div>

              <!-- Footer de tarjeta con métricas y acciones -->
              <div class="rest-card-footer">
                <div class="rest-mini-metrics">
                  <span>📦 <strong>{{ rest.orders_count }}</strong> ped.</span>
                  <span>🛵 <strong>{{ formatCurrency(rest.total_delivery_fees) }}</strong></span>
                </div>
                <div class="rest-card-actions">
                  <button type="button" class="btn-edit-rest" @click="openEditModal(rest)">
                    ✏️ Editar
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

          <!-- Barra de paginación inferior para no usar scrollbar en monitor -->
          <div v-if="totalRestaurantsPages > 1" class="crud-pagination-bar">
            <button
              type="button"
              class="page-btn"
              :disabled="restaurantsPage <= 1"
              @click="restaurantsPage--"
            >
              ◀ Anterior
            </button>
            <span class="page-indicator">
              Mostrando página {{ restaurantsPage }} de {{ totalRestaurantsPages }} ({{ restaurants.length }} restaurantes)
            </span>
            <button
              type="button"
              class="page-btn"
              :disabled="restaurantsPage >= totalRestaurantsPages"
              @click="restaurantsPage++"
            >
              Siguiente ▶
            </button>
          </div>
        </div>

        <div v-else class="empty-chart">
          No se encontraron restaurantes con esos criterios.
        </div>
      </section>
    </main>

    <!-- ===================================================== -->
    <!-- BARRA DE NAVEGACIÓN INFERIOR FIJA EN DISPOSITIVOS MÓVILES -->
    <!-- ===================================================== -->
    <nav class="mobile-bottom-nav">
      <button
        type="button"
        :class="['mob-nav-btn', { active: activeSection === 'resumen' && summaryTab === 'charts' }]"
        @click="switchToSection('resumen', 'charts')"
      >
        <span class="mob-nav-icon">📊</span>
        <span>Resumen</span>
      </button>
      <button
        type="button"
        :class="['mob-nav-btn', { active: activeSection === 'resumen' && summaryTab === 'orders' }]"
        @click="switchToSection('resumen', 'orders')"
      >
        <span class="mob-nav-icon">🧾</span>
        <span>Pedidos</span>
      </button>
      <button
        type="button"
        :class="['mob-nav-btn', { active: activeSection === 'restaurantes' }]"
        @click="switchToSection('restaurantes')"
      >
        <span class="mob-nav-icon">🏪</span>
        <span>Locales ({{ summaryData.kpis.total_restaurants }})</span>
      </button>
      <button type="button" class="mob-nav-btn" @click="openCreateModal">
        <span class="mob-nav-icon">➕</span>
        <span>Nuevo</span>
      </button>
    </nav>

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

          <div class="form-field">
            <div class="field-label-row">
              <label>📷 Fotografía / Logo (Opcional)</label>
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

            <div v-if="restaurantForm.photo_url" class="photo-preview-box">
              <img :src="restaurantForm.photo_url" alt="Vista previa" />
              <button type="button" class="btn-remove-photo" @click="clearPhoto">
                ✕ Quitar foto
              </button>
            </div>
          </div>

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

          <div class="form-field">
            <label>📝 Descripción del restaurante</label>
            <textarea
              v-model="restaurantForm.description"
              rows="2"
              placeholder="Ej. Pizzería artesanal en Col. San Antonio. Horario de 1:00 PM a 10:30 PM..."
              maxlength="2000"
            />
          </div>

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
          <p style="margin: 0 0 10px; color: #334155; line-height: 1.5;">
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
            {{ deletingRestaurant ? 'Eliminando...' : 'Sí, eliminar' }}
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
/* =========================================================
   LAYOUT BASE PARA MONITOR DE ESCRITORIO (CERO SCROLLBARS)
   ========================================================= */
.admin-layout {
  height: 100vh;
  max-height: 100vh;
  width: 100%;
  max-width: 100vw;
  overflow: hidden;
  display: grid;
  grid-template-columns: 215px minmax(0, 1fr);
  background: #f1f5f9;
  color: #0f172a;
  box-sizing: border-box;
}

.mobile-admin-header,
.mobile-bottom-nav,
.mobile-orders-list {
  display: none;
}

/* SIDEBAR COMPACTO */
.admin-sidebar {
  background: #0f172a;
  color: #f8fafc;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.brand-logo {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(135deg, #d71920, #991b1b);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 900;
  color: #fff;
  flex-shrink: 0;
}

.sidebar-brand h1 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.admin-badge {
  display: inline-block;
  margin-top: 2px;
  font-size: 0.68rem;
  background: rgba(215, 25, 32, 0.25);
  color: #fca5a5;
  padding: 2px 7px;
  border-radius: 99px;
  font-weight: 700;
}

.sidebar-nav {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #cbd5e1;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.nav-item.active {
  background: linear-gradient(135deg, #d71920, #b9151b);
  color: #fff;
  box-shadow: 0 4px 12px rgba(215, 25, 32, 0.3);
}

.nav-icon {
  font-size: 1.15rem;
}

.nav-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.nav-text strong {
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-text small {
  font-size: 0.68rem;
  opacity: 0.8;
}

.nav-counter {
  background: rgba(0, 0, 0, 0.28);
  padding: 2px 7px;
  border-radius: 99px;
  font-size: 0.7rem;
  font-weight: 700;
}

.sidebar-footer {
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-sidebar-new {
  width: 100%;
  padding: 9px 10px;
  border-radius: 9px;
  border: 1px dashed rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  font-weight: 700;
  font-size: 0.8rem;
  cursor: pointer;
}

.btn-sidebar-new:hover {
  background: rgba(255, 255, 255, 0.12);
}

.btn-logout {
  width: 100%;
  padding: 9px 10px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(239, 68, 68, 0.1);
  color: #fda4af;
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-logout:hover {
  background: rgba(239, 68, 68, 0.22);
}

/* =========================================================
   CONTENEDOR PRINCIPAL DEL MONITOR
   ========================================================= */
.admin-main {
  height: 100vh;
  max-height: 100vh;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px 16px;
  gap: 8px;
  box-sizing: border-box;
}

.admin-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.topbar-title-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.admin-topbar h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  color: #0f172a;
}

.topbar-subtitle-inline {
  color: #64748b;
  font-size: 0.78rem;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.view-mode-pills {
  display: flex;
  background: #e2e8f0;
  padding: 3px;
  border-radius: 9px;
  gap: 3px;
}

.mode-pill {
  border: none;
  background: transparent;
  padding: 5px 11px;
  border-radius: 7px;
  font-size: 0.76rem;
  font-weight: 700;
  color: #475569;
  cursor: pointer;
}

.mode-pill.active {
  background: #fff;
  color: #d71920;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.btn-compact {
  padding: 6px 12px !important;
  font-size: 0.78rem !important;
  border-radius: 8px !important;
}

.btn-primary {
  background: linear-gradient(135deg, #d71920, #b9151b);
  color: #fff;
  border: none;
  padding: 9px 14px;
  border-radius: 9px;
  font-weight: 700;
  font-size: 0.84rem;
  cursor: pointer;
}

.btn-secondary {
  background: #fff;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 9px 14px;
  border-radius: 9px;
  font-weight: 600;
  font-size: 0.84rem;
  cursor: pointer;
}

.btn-danger {
  background: #dc2626;
  color: #fff;
  border: none;
  padding: 9px 14px;
  border-radius: 9px;
  font-weight: 700;
  cursor: pointer;
}

/* =========================================================
   SECCIÓN DEL MONITOR (FLEXIBLE Y SIN DESBORDAMIENTO)
   ========================================================= */
.monitor-section {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

/* BARRA DE FILTROS EN UNA SOLA LÍNEA */
.filters-strip {
  background: #fff;
  border-radius: 11px;
  padding: 7px 12px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.pills-scroll-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.filter-tag {
  font-weight: 700;
  font-size: 0.76rem;
  color: #475569;
  margin-right: 2px;
}

.pill-btn {
  padding: 4px 10px;
  border-radius: 99px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
}

.pill-btn.active {
  background: #d71920;
  color: #fff;
  border-color: #d71920;
}

.custom-dates-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
}

.custom-dates-inline input {
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.75rem;
}

.filters-selects-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filters-selects-inline select {
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font-size: 0.76rem;
  font-weight: 600;
  color: #1e293b;
  max-width: 220px;
}

/* =========================================================
   FILA DE 6 KPIS COMPACTOS
   ========================================================= */
.kpis-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  flex-shrink: 0;
}

.kpi-card {
  background: #fff;
  border-radius: 11px;
  padding: 9px 11px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  border-top: 3px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
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
  gap: 4px;
}

.kpi-icon {
  font-size: 1.05rem;
}

.kpi-trend {
  font-size: 0.66rem;
  font-weight: 800;
  padding: 1px 6px;
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
  font-size: 0.64rem;
  font-weight: 700;
  background: #f1f5f9;
  color: #475569;
  padding: 1px 6px;
  border-radius: 99px;
  white-space: nowrap;
}

.kpi-value {
  font-size: clamp(1rem, 1.25vw, 1.35rem);
  font-weight: 900;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-fraction {
  font-size: 0.75rem;
  color: #64748b;
  font-weight: 600;
}

.kpi-title {
  font-size: 0.74rem;
  font-weight: 700;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-sub {
  font-size: 0.66rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* =========================================================
   BENTO WORKSPACE DE GRÁFICAS (100% ALTURA DEL MONITOR)
   ========================================================= */
.bento-charts-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.bento-row-top {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 8px;
  min-height: 0;
}

.bento-row-bottom {
  display: grid;
  grid-template-columns: 1fr 1.15fr 1fr;
  gap: 8px;
  min-height: 0;
}

.chart-card {
  background: #fff;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.chart-header h3 {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 800;
  color: #0f172a;
}

.chart-header p {
  margin: 1px 0 0;
  font-size: 0.68rem;
  color: #64748b;
}

.chart-toggle {
  display: flex;
  background: #f1f5f9;
  padding: 2px;
  border-radius: 6px;
  gap: 2px;
}

.toggle-btn {
  border: none;
  background: transparent;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
}

.toggle-btn.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* GRÁFICA DE BARRAS DIARIAS ADAPTABLE */
.bar-chart-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: flex-end;
  padding-top: 4px;
  padding-bottom: 10px;
}

.bar-chart-columns {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.bar-col-item {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.bar-top-val {
  font-size: 0.58rem;
  font-weight: 700;
  color: #475569;
  min-height: 12px;
  white-space: nowrap;
  overflow: hidden;
}

.bar-track {
  flex: 1;
  width: 100%;
  max-width: 22px;
  background: #f1f5f9;
  border-radius: 4px 4px 0 0;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.bar-fill {
  width: 100%;
  border-radius: 4px 4px 0 0;
  transition: height 0.3s ease;
}

.fill-red {
  background: linear-gradient(180deg, #ef4444, #d71920);
}

.fill-emerald {
  background: linear-gradient(180deg, #34d399, #059669);
}

.bar-label {
  font-size: 0.56rem;
  color: #64748b;
  margin-top: 4px;
  transform: rotate(-25deg);
  white-space: nowrap;
}

/* DONA HORIZONTAL COMPACTA */
.donut-horizontal-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}

.donut-svg-box {
  position: relative;
  width: 115px;
  height: 115px;
  flex-shrink: 0;
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
  font-size: 1.15rem;
  font-weight: 900;
}

.donut-center span {
  font-size: 0.65rem;
  color: #64748b;
}

.donut-legend {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 0.72rem;
}

.legend-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.68rem;
}

.legend-right small {
  color: #64748b;
  font-size: 0.62rem;
}

/* RANKING TOP RESTAURANTES */
.ranking-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 4px;
}

.ranking-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ranking-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.ranking-identity {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.rank-num {
  font-weight: 800;
  font-size: 0.72rem;
  color: #d71920;
  width: 18px;
}

.rank-avatar,
.rank-avatar-placeholder {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.rank-avatar-placeholder {
  background: #fee2e2;
  color: #d71920;
  font-weight: 800;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rank-text-box {
  min-width: 0;
}

.rank-name {
  display: block;
  font-size: 0.76rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank-code {
  display: block;
  font-size: 0.64rem;
  color: #64748b;
}

.ranking-metrics {
  text-align: right;
  flex-shrink: 0;
}

.rank-orders {
  display: block;
  font-size: 0.66rem;
  color: #475569;
}

.rank-fees {
  font-size: 0.74rem;
  color: #059669;
}

.ranking-bar-bg {
  height: 4px;
  background: #f1f5f9;
  border-radius: 99px;
  overflow: hidden;
}

.ranking-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #d71920, #f97316);
}

/* HORAS PICO + PILLS DE DISTANCIA */
.hourly-chart {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding-top: 4px;
  margin-bottom: 6px;
}

.hour-col {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.hour-val {
  font-size: 0.56rem;
  font-weight: 700;
  color: #475569;
  min-height: 10px;
}

.hour-track {
  flex: 1;
  width: 100%;
  background: #f1f5f9;
  border-radius: 3px 3px 0 0;
  display: flex;
  align-items: flex-end;
}

.hour-fill {
  width: 100%;
  background: #3b82f6;
  border-radius: 3px 3px 0 0;
}

.hour-fill.hour-peak {
  background: #d71920;
}

.hour-label {
  font-size: 0.54rem;
  color: #64748b;
  margin-top: 2px;
}

.distance-pills-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  padding-top: 6px;
  border-top: 1px solid #f1f5f9;
  flex-shrink: 0;
}

.dist-mini-pill {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 3px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.64rem;
}

.dist-range-lbl {
  color: #64748b;
}

/* TOP COLONIAS */
.zones-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 4px;
}

.zone-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.zone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
}

.zone-title-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.zone-title-wrap strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.zone-badge {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #f1f5f9;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
}

.zone-stats {
  font-weight: 700;
  color: #2563eb;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.zone-sub {
  display: flex;
  justify-content: space-between;
  font-size: 0.64rem;
  color: #64748b;
}

.zone-bar-bg {
  height: 4px;
  background: #f1f5f9;
  border-radius: 99px;
  overflow: hidden;
}

.zone-bar-fill {
  height: 100%;
  background: #2563eb;
}

/* =========================================================
   VISTA TABLA DE PEDIDOS PAGINADA (SIN SCROLL EN MONITOR)
   ========================================================= */
.orders-workspace-card {
  flex: 1;
  min-height: 0;
  background: #fff;
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.table-header-row h3 {
  margin: 0;
  font-size: 0.95rem;
}

.table-header-row p {
  margin: 2px 0 0;
  font-size: 0.74rem;
  color: #64748b;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-btn {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font-size: 0.75rem;
  font-weight: 700;
  color: #334155;
  cursor: pointer;
}

.page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.page-indicator {
  font-size: 0.76rem;
  font-weight: 700;
  color: #475569;
}

.table-desktop-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.admin-table th {
  text-align: left;
  padding: 8px 10px;
  background: #f8fafc;
  color: #475569;
  font-weight: 700;
  border-bottom: 1px solid #e2e8f0;
}

.admin-table td {
  padding: 7px 10px;
  border-bottom: 1px solid #f1f5f9;
}

.folio-pill {
  font-family: monospace;
  font-weight: 700;
  font-size: 0.74rem;
  background: #f1f5f9;
  padding: 3px 7px;
  border-radius: 6px;
}

.table-rest-cell {
  display: flex;
  flex-direction: column;
}

.table-rest-cell small {
  color: #64748b;
  font-size: 0.68rem;
}

.btn-table-link {
  display: inline-block;
  padding: 4px 9px;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.72rem;
  white-space: nowrap;
}

/* =========================================================
   CRUD DE RESTAURANTES (GRID 3x2 EN MONITOR SIN SCROLL)
   ========================================================= */
.crud-header-bar {
  background: #fff;
  border-radius: 11px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.crud-stats-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.crud-stat-pill {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 4px 10px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
}

.crud-search-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: flex-end;
  min-width: 260px;
}

.search-box {
  flex: 1;
  max-width: 300px;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  font-size: 0.8rem;
}

.search-box input {
  width: 100%;
  padding: 6px 10px 6px 30px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  font-size: 0.78rem;
}

.crud-search-controls select {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font-size: 0.76rem;
  font-weight: 600;
}

.crud-monitor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.restaurants-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.rest-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.rest-inactive {
  opacity: 0.72;
}

.rest-card-top {
  display: flex;
  gap: 10px;
  min-width: 0;
}

.rest-avatar-box {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(135deg, #1e293b, #334155);
  flex-shrink: 0;
  cursor: pointer;
}

.rest-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rest-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.rest-thumb-placeholder span {
  font-size: 1.15rem;
  font-weight: 800;
}

.rest-thumb-placeholder small {
  font-size: 0.58rem;
  opacity: 0.85;
}

.rest-head-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rest-badges-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.rest-code-badge {
  background: #0f172a;
  color: #fff;
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 800;
  font-size: 0.7rem;
}

.status-pill-toggle {
  border: none;
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 0.68rem;
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

.rest-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rest-desc,
.rest-desc-empty {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rest-desc {
  color: #475569;
}

.rest-desc-empty {
  color: #94a3b8;
  font-style: italic;
}

.profile-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.field-chip {
  font-size: 0.66rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 99px;
  text-decoration: none;
}

.chip-ok {
  background: #ecfdf5;
  color: #047857;
}

.chip-missing {
  background: #f1f5f9;
  color: #64748b;
}

.rest-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid #f1f5f9;
}

.rest-mini-metrics {
  display: flex;
  gap: 8px;
  font-size: 0.72rem;
  color: #475569;
}

.rest-card-actions {
  display: flex;
  gap: 5px;
}

.btn-edit-rest {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  font-weight: 700;
  font-size: 0.74rem;
  cursor: pointer;
}

.btn-edit-rest:hover {
  background: #0f172a;
  color: #fff;
}

.btn-delete-rest {
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid #fecdd3;
  background: #fff1f2;
  cursor: pointer;
  font-size: 0.74rem;
}

.crud-pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #fff;
  padding: 6px 12px;
  border-radius: 10px;
  flex-shrink: 0;
}

/* =========================================================
   MODALES Y TOAST
   ========================================================= */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  z-index: 1000;
}

.modal-card {
  background: #fff;
  border-radius: 16px;
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}

.modal-small {
  max-width: 400px;
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-header h3 {
  margin: 0 0 3px;
  font-size: 1.05rem;
}

.modal-header p {
  margin: 0;
  font-size: 0.78rem;
  color: #64748b;
}

.modal-close {
  border: none;
  background: #f1f5f9;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
}

.modal-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-field label {
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
}

.form-field input,
.form-field textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  font-size: 16px;
  box-sizing: border-box;
}

.form-field small {
  font-size: 0.72rem;
  color: #64748b;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
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
  font-size: 0.72rem;
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
  padding: 10px;
  border-radius: 9px;
  background: #f8fafc;
}

.photo-preview-box {
  margin-top: 6px;
  position: relative;
  height: 130px;
  border-radius: 10px;
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
  background: rgba(15, 23, 42, 0.85);
  color: #fff;
  border: none;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 0.72rem;
  cursor: pointer;
}

.input-with-action {
  display: flex;
  gap: 8px;
}

.btn-test-map {
  background: #eff6ff;
  color: #1d4ed8;
  padding: 9px 12px;
  border-radius: 9px;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.78rem;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.84rem;
  cursor: pointer;
}

.modal-error {
  background: #fff1f2;
  color: #be123c;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.empty-chart {
  padding: 24px 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 0.84rem;
  margin: auto;
}

.admin-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 18px;
  border-radius: 10px;
  background: #0f172a;
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  z-index: 2000;
}

.admin-toast.error {
  background: #dc2626;
}

/* =========================================================
   ADAPTACIÓN 100% RESPONSIVA PARA MÓVILES Y TABLETS
   ========================================================= */
@media (max-width: 1024px) {
  .admin-layout {
    display: flex;
    flex-direction: column;
    height: auto;
    max-height: none;
    min-height: 100vh;
    overflow: visible;
    padding-bottom: 72px;
  }

  .admin-sidebar {
    display: none;
  }

  .mobile-admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #0f172a;
    color: #fff;
    padding: 12px 16px;
    position: sticky;
    top: 0;
    z-index: 900;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  }

  .mobile-brand-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand-logo-sm {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: #d71920;
    color: #fff;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .mobile-code-pill {
    margin-left: 6px;
    font-size: 0.7rem;
    background: rgba(215, 25, 32, 0.3);
    color: #fca5a5;
    padding: 2px 7px;
    border-radius: 99px;
    font-weight: 700;
  }

  .mobile-header-actions {
    display: flex;
    gap: 8px;
  }

  .btn-mobile-icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .btn-mobile-exit {
    background: rgba(239, 68, 68, 0.2);
  }

  .admin-main {
    height: auto;
    max-height: none;
    overflow: visible;
    padding: 14px 12px 24px;
    gap: 12px;
  }

  .monitor-section {
    overflow: visible;
    gap: 12px;
  }

  .topbar-subtitle-inline {
    display: none;
  }

  .filters-strip {
    flex-direction: column;
    align-items: stretch;
    padding: 12px;
  }

  .pills-scroll-row {
    overflow-x: auto;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
  }

  .filters-selects-inline {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .filters-selects-inline select {
    max-width: none;
    width: 100%;
    padding: 9px 10px;
    font-size: 0.84rem;
  }

  .kpis-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .kpi-card {
    padding: 12px;
  }

  .kpi-value {
    font-size: clamp(1.15rem, 4.5vw, 1.4rem);
  }

  .bento-charts-workspace {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .bento-row-top,
  .bento-row-bottom {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .bar-chart-wrapper {
    min-height: 180px;
  }

  .bar-chart-columns {
    height: 165px;
  }

  .hourly-chart {
    min-height: 130px;
    height: 130px;
  }

  .crud-header-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .crud-search-controls {
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
  }

  .search-box {
    max-width: none;
  }

  .restaurants-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    grid-template-rows: none;
    gap: 12px;
  }

  .mobile-bottom-nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.08);
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
    z-index: 950;
  }

  .mob-nav-btn {
    border: none;
    background: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 4px;
    font-size: 0.7rem;
    font-weight: 700;
    color: #64748b;
    border-radius: 8px;
    cursor: pointer;
  }

  .mob-nav-btn.active {
    color: #d71920;
    background: #fff1f2;
  }

  .mob-nav-icon {
    font-size: 1.15rem;
  }
}

@media (max-width: 640px) {
  .filters-selects-inline {
    grid-template-columns: 1fr;
  }

  .donut-horizontal-layout {
    flex-direction: column;
  }

  .table-desktop-wrap,
  .pagination-controls {
    display: none;
  }

  .mobile-orders-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mobile-order-card {
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mob-order-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .mob-order-date {
    font-size: 0.72rem;
    color: #64748b;
  }

  .mob-order-rest {
    font-size: 0.85rem;
  }

  .mob-order-dest {
    font-size: 0.78rem;
    color: #475569;
  }

  .mob-order-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 6px;
    border-top: 1px dashed #cbd5e1;
  }

  .mob-fee {
    color: #059669;
    font-size: 0.9rem;
  }

  .mob-pay {
    color: #64748b;
    font-size: 0.74rem;
  }

  .modal-backdrop {
    align-items: flex-end;
    padding: 0;
  }

  .modal-card {
    max-width: 100%;
    border-radius: 18px 18px 0 0;
    max-height: 90dvh;
  }
}
</style>
