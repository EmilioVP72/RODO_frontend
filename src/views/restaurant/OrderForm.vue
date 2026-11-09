<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'
import { appBranding, applyBrandingState, fetchAppBranding } from '../../services/branding'
import { SAN_MIGUEL_ZONES } from '../../constants/sanMiguelZones'
import RouteMap from '../../components/maps/RouteMap.vue'
import TripSummary from '../../components/maps/TripSummary.vue'
import {
  MAP_CONFIG,
  calculateRouteFromBackend,
  reverseGeocodeCoordinates,
} from '../../services/geocoding'

const router = useRouter()

// Pestaña activa del portal del restaurante: 'form' | 'history'
const activePortalTab = ref('form')

// Estado del restaurante y la sesión
const restaurant = ref(null)
const loading = ref(false)
const error = ref('')
const result = ref(null)
const copySuccess = ref(false)

// Historial individual de pedidos del día del restaurante autenticado
const dailyOrders = ref([])
const dailyLoading = ref(false)
const dailyDate = ref('')
const historySearch = ref('')
const historyStatusFilter = ref('all') // 'all' | 'pending' | 'completed'
let dailyPollTimer = null

const dailySummary = reactive({
  total_orders: 0,
  completed_orders: 0,
  pending_orders: 0,
  total_delivery_fees: 0,
  total_amount_to_collect: 0,
})

// Toast de notificación
const toastMessage = ref('')
const toastType = ref('info')
let toastTimer = null

function showToast(msg, type = 'info') {
  toastMessage.value = msg
  toastType.value = type
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 4000)
}

// URLs y compartir ticket (Fase 3.4)
const ticketUrl = computed(() => {
  if (!result.value) return ''
  const token = result.value.public_token
  if (token) {
    const origin = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost'))
      ? window.location.origin
      : 'https://rodo-frontend-phi.vercel.app'
    return `${origin}/ticket/${token}`
  }
  if (result.value.ticket_url && !result.value.ticket_url.includes('localhost')) {
    return result.value.ticket_url
  }
  return ''
})

const whatsappUrl = computed(() => {
  if (!result.value || !ticketUrl.value) return ''
  const restaurantName = restaurant.value?.name || result.value.restaurant?.name || 'Restaurante'
  const code = restaurant.value?.code || result.value.restaurant?.code || ''
  const folio = result.value.folio || ''
  const fee = result.value.delivery_fee ? `$${Number(result.value.delivery_fee).toFixed(2)} MXN` : null
  const neighborhood = result.value.neighborhood ? result.value.neighborhood : null
  const paymentMethod = result.value.payment_method || null
  const toCollect = result.value.amount_to_collect ? `$${Number(result.value.amount_to_collect).toFixed(2)}` : null

  let paymentLine = ''
  if (paymentMethod) {
    paymentLine = `\n💳 *Pago:* ${paymentMethod}`
    if (toCollect && (paymentMethod === 'Efectivo' || paymentMethod === 'Contraentrega')) {
      paymentLine += ` (Cobrar ${toCollect})`
    }
  }

  const codeBadge = code ? ` (#${code})` : ''
  const feeLine = fee ? `\n💵 *Tarifa de envío:* ${fee}` : ''
  const zoneLine = neighborhood ? `\n📍 *Zona de entrega:* ${neighborhood}` : ''

  const message = [
    `🛵 *RODO MOTO MANDADOS*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `✨ *Nuevo Pedido Registrado*`,
    ``,
    `🏪 *Local:* ${restaurantName}${codeBadge}`,
    `📋 *Folio:* ${folio}${feeLine}${paymentLine}${zoneLine}`,
    ``,
    `🎟️ *Ver Ticket Digital y Mapa:*`,
    `👉 ${ticketUrl.value}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Favor de asignar repartidor a la brevedad._`,
  ].join('\n')

  return `https://api.whatsapp.com/send?phone=524151805038&text=${encodeURIComponent(message)}`
})

const assistanceWhatsappUrl = computed(() => {
  const restaurantName = restaurant.value?.name || 'Local'
  const code = restaurant.value?.code ? ` (#${restaurant.value.code})` : ''
  const folioInfo = result.value?.folio ? ` con el pedido *${result.value.folio}*` : ''
  const message = `Hola soporte RODO, solicito asistencia desde *${restaurantName}*${code}${folioInfo} por un detalle con el envío o repartidor.`
  return `https://api.whatsapp.com/send?phone=524151019920&text=${encodeURIComponent(message)}`
})

async function copyTicketLink() {
  if (!ticketUrl.value) return
  try {
    await navigator.clipboard.writeText(ticketUrl.value)
    copySuccess.value = true
    showToast('¡Enlace del ticket copiado al portapapeles!', 'success')
    setTimeout(() => {
      copySuccess.value = false
    }, 2500)
  } catch {
    const input = document.createElement('input')
    input.value = ticketUrl.value
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    copySuccess.value = true
    showToast('¡Enlace copiado!', 'success')
    setTimeout(() => {
      copySuccess.value = false
    }, 2500)
  }
}

// Datos del formulario
const form = reactive({
  customer_name: '',
  customer_phone: '',
  street: '',
  neighborhood: '',
  address_reference: '',
  map_url: '',
  distance_km: '',
  payment_method: '',
  amount_to_collect: null,
  needs_change: false,
  change_option: '',
  change_other: '',
  description: '',
  comments: '',
  is_ready: false,
  care_instructions: [],
  care_other: '',
})

// Normalización de texto para búsqueda de zonas y colonias
function normalizeZoneSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const normalizedSanMiguelZones = SAN_MIGUEL_ZONES.map((label) => ({
  label,
  normalized: normalizeZoneSearchText(label),
}))

// Autocompletado en tiempo real de colonias para el formulario de pedidos (Paso 1)
const showNeighborhoodSuggestions = ref(false)
const activeNeighborhoodIndex = ref(-1)

function parseZoneLabel(rawLabel) {
  const withoutNum = String(rawLabel || '').replace(/^\d+\.\s*/, '').trim()
  const parts = withoutNum.split(' - ')
  return {
    fullName: withoutNum,
    name: parts[0] ? parts[0].trim() : withoutNum,
    type: parts[1] ? parts[1].trim() : '',
  }
}

const neighborhoodSuggestions = computed(() => {
  const query = normalizeZoneSearchText(form.neighborhood)
  if (!query || query.length < 1) return []
  const tokens = query.split(/\s+/).filter(Boolean)
  return normalizedSanMiguelZones
    .filter((entry) => tokens.every((tok) => entry.normalized.includes(tok)))
    .slice(0, 10)
    .map((entry) => parseZoneLabel(entry.label))
})

function selectNeighborhoodSuggestion(item) {
  form.neighborhood = item.name
  showNeighborhoodSuggestions.value = false
  activeNeighborhoodIndex.value = -1

  if (hasRegisteredLocation.value) {
    if (autoDistanceTimer) clearTimeout(autoDistanceTimer)
    autoDistanceTimer = setTimeout(() => {
      autoCalculateRouteDistance(false)
    }, 250)
  }
}

function handleNeighborhoodBlur() {
  setTimeout(() => {
    showNeighborhoodSuggestions.value = false
  }, 220)
}

function handleNeighborhoodKeydown(e) {
  if (!showNeighborhoodSuggestions.value || !neighborhoodSuggestions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeNeighborhoodIndex.value = (activeNeighborhoodIndex.value + 1) % neighborhoodSuggestions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeNeighborhoodIndex.value =
      activeNeighborhoodIndex.value <= 0
        ? neighborhoodSuggestions.value.length - 1
        : activeNeighborhoodIndex.value - 1
  } else if (e.key === 'Enter') {
    if (activeNeighborhoodIndex.value >= 0 && activeNeighborhoodIndex.value < neighborhoodSuggestions.value.length) {
      e.preventDefault()
      selectNeighborhoodSuggestion(neighborhoodSuggestions.value[activeNeighborhoodIndex.value])
    }
  } else if (e.key === 'Escape') {
    showNeighborhoodSuggestions.value = false
  }
}

// Opciones de cuidado con íconos
const careList = [
  { value: 'Mantener horizontal', label: '🍕 Mantener horizontal (pizza)' },
  { value: 'Puede derramarse', label: '🥣 Puede derramarse (sopa/bebida)' },
  { value: 'Mantener caliente', label: '♨️ Mantener caliente' },
  { value: 'Frágil o delicado', label: '📦 Frágil o delicado' },
  { value: 'No voltear', label: '⬆️ No voltear' },
  { value: 'Manejar con cuidado', label: '🤲 Manejar con cuidado' },
]

// Detectar si el restaurante tiene Tarifa Fija o Ubicación registrada en BD por el Admin
const hasFixedFee = computed(() => {
  const val = restaurant.value?.fixed_delivery_fee
  return val !== null && val !== undefined && val !== '' && Number(val) > 0
})

const fixedFeeAmount = computed(() => {
  return hasFixedFee.value ? Number(restaurant.value.fixed_delivery_fee) : null
})

const hasRegisteredLocation = computed(() => {
  return Boolean(restaurant.value?.location_url && String(restaurant.value.location_url).trim())
})

// Estado del cálculo automático de distancia desde la ubicación del local y Mapa Interactivo Open Source
const autoDistanceLoading = ref(false)
const autoDistanceStatus = ref('')
const autoDistanceSuccess = ref(false)
let autoDistanceTimer = null

const mapOrigin = ref({
  lat: MAP_CONFIG.defaultCenter.lat,
  lng: MAP_CONFIG.defaultCenter.lng,
  label: 'Establecimiento (Punto A)',
})
const mapDestination = ref(null)
const routeGeometry = ref(null)
const routeDurationMinutes = ref(null)
const routeError = ref('')
const originSearchQuery = ref('')
const destinationSearchQuery = ref('')

const effectiveOriginAddressLabel = computed(() => {
  if (originSearchQuery.value && originSearchQuery.value.trim()) {
    return originSearchQuery.value.trim()
  }
  return restaurant.value?.name
    ? `${restaurant.value.name} (#${restaurant.value.code})`
    : 'Ubicación del establecimiento'
})

const effectiveDestinationAddressLabel = computed(() => {
  const manualParts = [form.street, form.neighborhood].map((s) => String(s || '').trim()).filter(Boolean)
  if (manualParts.length > 0) {
    return manualParts.join(', ')
  }
  if (destinationSearchQuery.value && destinationSearchQuery.value.trim()) {
    return destinationSearchQuery.value.trim()
  }
  if (mapDestination.value && Number.isFinite(mapDestination.value.lat)) {
    return `Coordenadas: ${Number(mapDestination.value.lat).toFixed(5)}, ${Number(mapDestination.value.lng).toFixed(5)}`
  }
  return ''
})

function syncRestaurantOriginToMap() {
  if (!restaurant.value) return
  const coords = restaurant.value.origin_coords
  if (coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))) {
    mapOrigin.value = {
      lat: Number(coords.lat),
      lng: Number(coords.lng),
      label: restaurant.value.name || 'Establecimiento (Punto A)',
    }
    originSearchQuery.value = restaurant.value.name || ''
  } else if (
    restaurant.value.latitude !== null &&
    restaurant.value.latitude !== undefined &&
    restaurant.value.longitude !== null &&
    restaurant.value.longitude !== undefined
  ) {
    mapOrigin.value = {
      lat: Number(restaurant.value.latitude),
      lng: Number(restaurant.value.longitude),
      label: restaurant.value.name || 'Establecimiento (Punto A)',
    }
    originSearchQuery.value = restaurant.value.name || ''
  }
}

async function calculateRouteBetweenMapPoints(originPt, destPt, showFeedbackToast = false) {
  if (
    !originPt ||
    !destPt ||
    !Number.isFinite(Number(originPt.lat)) ||
    !Number.isFinite(Number(originPt.lng)) ||
    !Number.isFinite(Number(destPt.lat)) ||
    !Number.isFinite(Number(destPt.lng))
  ) {
    return
  }

  autoDistanceLoading.value = true
  routeError.value = ''
  autoDistanceStatus.value = '🛰️ Trazando ruta por carretera y calculando kilómetros...'

  try {
    const response = await calculateRouteFromBackend(originPt, destPt)
    if (response?.success && response?.data) {
      const rData = response.data
      form.distance_km = Number(rData.distance_km)
      routeDurationMinutes.value = rData.duration_minutes ?? null
      routeGeometry.value = rData.geometry ?? null
      autoDistanceSuccess.value = true
      const minsText = rData.duration_minutes ? ` · ~${Math.max(1, Math.round(Number(rData.duration_minutes)))} min` : ''
      autoDistanceStatus.value = `✓ Ruta calculada por carretera: ${Number(rData.distance_km).toFixed(1)} km${minsText}. (Kilómetros bloqueados).`
      if (showFeedbackToast) {
        showToast(`Ruta calculada: ${Number(rData.distance_km).toFixed(1)} km`, 'success')
      }
    }
  } catch (err) {
    autoDistanceSuccess.value = false
    routeGeometry.value = null
    routeDurationMinutes.value = null
    const backendMsg =
      err?.response?.data?.message ||
      'No se encontró una ruta por carretera entre los puntos seleccionados.'
    routeError.value = backendMsg
    autoDistanceStatus.value = backendMsg
    if (showFeedbackToast) {
      showToast(backendMsg, 'error')
    }
  } finally {
    autoDistanceLoading.value = false
  }
}

async function handleOriginSelected(payload) {
  if (!payload) return
  const lat = Number(payload.lat)
  const lng = Number(payload.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

  mapOrigin.value = {
    lat,
    lng,
    label: payload.displayName || payload.label || 'Origen (Punto A)',
  }

  if (payload.displayName) {
    originSearchQuery.value = payload.displayName
  } else {
    try {
      const rev = await reverseGeocodeCoordinates(lat, lng)
      if (rev?.displayName) {
        originSearchQuery.value = rev.displayName
        if (mapOrigin.value) {
          mapOrigin.value.label = rev.displayName
        }
      }
    } catch (e) {
      console.warn('Reverse geocode origen falló:', e)
    }
  }

  if (mapDestination.value) {
    if (autoDistanceTimer) clearTimeout(autoDistanceTimer)
    await calculateRouteBetweenMapPoints(mapOrigin.value, mapDestination.value, false)
  }
}

async function handleDestinationSelected(payload) {
  if (!payload) return
  const lat = Number(payload.lat)
  const lng = Number(payload.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

  mapDestination.value = {
    lat,
    lng,
    label: payload.displayName || payload.label || 'Destino (Punto B)',
  }

  if (payload.displayName) {
    destinationSearchQuery.value = payload.displayName
  }
  if (payload.street) {
    form.street = payload.street
  }
  if (payload.neighborhood) {
    form.neighborhood = payload.neighborhood
  } else if (payload.title && !form.neighborhood) {
    form.neighborhood = payload.title
  }

  // Si viene de un clic directo en el mapa sin dirección escrita, hacer geocodificación inversa
  if (!payload.displayName && !payload.street) {
    try {
      const rev = await reverseGeocodeCoordinates(lat, lng)
      if (rev) {
        if (rev.displayName) {
          destinationSearchQuery.value = rev.displayName
          if (mapDestination.value) {
            mapDestination.value.label = rev.displayName
          }
        }
        if (rev.street && !form.street) {
          form.street = rev.street
        }
        if (rev.neighborhood && !form.neighborhood) {
          form.neighborhood = rev.neighborhood
        }
      }
    } catch (e) {
      console.warn('Reverse geocode destino falló:', e)
    }
  }

  if (mapOrigin.value) {
    if (autoDistanceTimer) clearTimeout(autoDistanceTimer)
    await calculateRouteBetweenMapPoints(mapOrigin.value, mapDestination.value, true)
  }
}

// Mantener compatibilidad con llamadas internas previas
const handleSelectLocationFromSearch = (payload) => {
  if (payload?.pointType === 'origin') {
    handleOriginSelected(payload)
  } else {
    handleDestinationSelected(payload)
  }
}
const handleOriginMarkerChanged = handleOriginSelected
const handleDestinationMarkerChanged = handleDestinationSelected

function handleClearMapPoints() {
  mapDestination.value = null
  routeGeometry.value = null
  routeDurationMinutes.value = null
  routeError.value = ''
  destinationSearchQuery.value = ''
  form.distance_km = ''
  autoDistanceSuccess.value = false
  autoDistanceStatus.value = ''
}

async function autoCalculateRouteDistance(manualTrigger = false) {
  if (!restaurant.value) return
  if (hasFixedFee.value) return

  if (!hasRegisteredLocation.value) {
    if (manualTrigger) {
      showToast(
        hasFixedFee.value
          ? `Distancia registrada para el ticket. Tu tarifa fija ($${fixedFeeAmount.value.toFixed(2)} MXN) se mantiene.`
          : 'Tarifa actualizada según la distancia ingresada.',
        'info'
      )
    }
    return
  }

  const hasMapUrl = Boolean(form.map_url && form.map_url.trim().length > 8)
  const hasAddress = Boolean(
    form.street &&
    form.street.trim().length >= 3 &&
    form.neighborhood &&
    form.neighborhood.trim().length >= 2
  )

  if (!hasMapUrl && !hasAddress) {
    if (manualTrigger) {
      showToast('Ingresa la calle y colonia (o el enlace de Google Maps) del cliente para calcular la distancia automáticamente.', 'info')
    }
    return
  }

  autoDistanceLoading.value = true
  autoDistanceStatus.value = '🛰️ Calculando distancia automática entre tu sucursal y el destino...'

  try {
    const response = await api.post('/orders/calculate-distance', {
      street: form.street ? form.street.trim() : null,
      neighborhood: form.neighborhood ? form.neighborhood.trim() : null,
      address_reference: form.address_reference ? form.address_reference.trim() : null,
      map_url: form.map_url ? form.map_url.trim() : null,
    })

    const data = response.data
    if (data.origin_coords && Number.isFinite(Number(data.origin_coords.lat))) {
      mapOrigin.value = {
        lat: Number(data.origin_coords.lat),
        lng: Number(data.origin_coords.lng),
        label: restaurant.value?.name || 'Establecimiento (Punto A)',
      }
    }
    if (data.destination_coords && Number.isFinite(Number(data.destination_coords.lat))) {
      mapDestination.value = {
        lat: Number(data.destination_coords.lat),
        lng: Number(data.destination_coords.lng),
        label: effectiveDestinationAddressLabel.value || 'Destino (Punto B)',
      }
    }
    if (data.geometry) {
      routeGeometry.value = data.geometry
    }
    if (data.duration_minutes !== undefined && data.duration_minutes !== null) {
      routeDurationMinutes.value = Number(data.duration_minutes)
    }
    routeError.value = ''

    if (data.has_fixed_fee && data.fixed_delivery_fee) {
      restaurant.value.fixed_delivery_fee = data.fixed_delivery_fee
      if (data.success && data.distance_km !== null && data.distance_km !== undefined) {
        form.distance_km = Number(data.distance_km)
        autoDistanceSuccess.value = true
        autoDistanceStatus.value =
          (data.message || `✓ Distancia calculada: ${Number(data.distance_km).toFixed(1)} km · Tarifa fija: $${Number(data.fixed_delivery_fee).toFixed(2)} MXN.`) +
          ' (Kilómetros bloqueados para el ticket).'
        if (manualTrigger) {
          showToast(`Distancia calculada: ${Number(data.distance_km).toFixed(1)} km`, 'success')
        }
      } else {
        autoDistanceSuccess.value = false
        autoDistanceStatus.value =
          data.message || 'No se pudo localizar la dirección exacta. Puedes pegar el enlace de Google Maps o ingresar los km para el ticket.'
        if (manualTrigger) {
          showToast(autoDistanceStatus.value, 'info')
        }
      }
      return
    }

    if (data.success && data.distance_km !== null && data.distance_km !== undefined) {
      form.distance_km = Number(data.distance_km)
      autoDistanceSuccess.value = true
      autoDistanceStatus.value =
        (data.message || `✓ Distancia calculada automáticamente: ${Number(data.distance_km).toFixed(1)} km.`) +
        ' (Kilómetros bloqueados para proteger la tarifa oficial).'
      if (manualTrigger) {
        showToast(`Distancia calculada y bloqueada: ${Number(data.distance_km).toFixed(1)} km`, 'success')
      }
    } else {
      autoDistanceSuccess.value = false
      autoDistanceStatus.value = data.message || 'No se pudo localizar la dirección exacta. Puedes pegar el enlace de Google Maps o ingresar los km.'
      if (manualTrigger) {
        showToast(autoDistanceStatus.value, 'info')
      }
    }
  } catch {
    autoDistanceSuccess.value = false
    autoDistanceStatus.value = 'Puedes ajustar los kilómetros manualmente si lo requieres.'
  } finally {
    autoDistanceLoading.value = false
  }
}

watch(
  [() => form.street, () => form.neighborhood, () => form.map_url],
  () => {
    if (hasFixedFee.value) return
    if (!hasRegisteredLocation.value) return
    const hasMapUrl = Boolean(form.map_url && form.map_url.trim().length > 8)
    const hasAddress = Boolean(
      form.street &&
      form.street.trim().length >= 3 &&
      form.neighborhood &&
      form.neighborhood.trim().length >= 2
    )
    if (!hasMapUrl && !hasAddress) {
      if (autoDistanceTimer) clearTimeout(autoDistanceTimer)
      autoDistanceSuccess.value = false
      autoDistanceStatus.value = ''
      form.distance_km = ''
      mapDestination.value = null
      routeGeometry.value = null
      routeDurationMinutes.value = null
      return
    }

    if (autoDistanceTimer) clearTimeout(autoDistanceTimer)
    autoDistanceTimer = setTimeout(() => {
      autoCalculateRouteDistance(false)
    }, 650)
  }
)

// Cálculo dinámico de tarifa (Prioriza Tarifa Fija de BD si existe, o calcula según distancia)
const calculatedFee = computed(() => {
  if (hasFixedFee.value) {
    const fee = fixedFeeAmount.value
    const kmText =
      form.distance_km !== '' && form.distance_km !== null && Number(form.distance_km) > 0
        ? ` · ${Number(form.distance_km).toFixed(1)} km`
        : ''
    return {
      status: 'ok',
      isFixed: true,
      fee,
      message: `$${fee.toFixed(2)} MXN · Tarifa fija autorizada para tu local${kmText}`,
    }
  }

  if (form.distance_km === '' || form.distance_km === null) {
    return {
      status: 'empty',
      isFixed: false,
      fee: null,
      message: hasRegisteredLocation.value
        ? 'Escribe la calle y colonia (o pega el mapa del cliente) para calcular la distancia y tarifa automáticamente.'
        : 'Introduce la distancia en kilómetros para calcular la tarifa.',
    }
  }
  const km = Number(form.distance_km)
  if (!Number.isFinite(km) || km < 0) {
    return { status: 'invalid', isFixed: false, fee: null, message: 'Introduce una distancia válida (mayor o igual a 0 km).' }
  }
  if (km > 5) {
    return {
      status: 'out_of_coverage',
      isFixed: false,
      fee: null,
      message: `Fuera de cobertura (${km.toFixed(1)} km): La ruta supera los 5 km permitidos.`,
    }
  }
  const fee = Math.min(50, 40 + 2 * km)
  return {
    status: 'ok',
    isFixed: false,
    fee,
    message: `$${fee.toFixed(2)} MXN · ${km.toFixed(1)} km desde la sucursal`,
  }
})

// Módulo de OCR / Escaneo inteligente de ticket (Preprocesamiento adaptativo + Parser multipaso)
const ticketFileInput = ref(null)
const ticketGalleryInput = ref(null)
const imagePreview = ref('')
const ocrStatus = ref('Toma una foto nítida del ticket o pega el texto del pedido para distribuir los datos automáticamente.')
const ocrLoading = ref(false)
const ocrRawText = ref('')
const showOcrTextEditor = ref(false)
const ocrDetectedFields = ref([])

// Preprocesamiento de imagen con normalización local de iluminación (elimina sombras de papel térmico)
async function preprocessImageForOcr(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      try {
        const origW = img.naturalWidth || img.width
        const origH = img.naturalHeight || img.height

        // Escalar a resolución óptima para OCR de recibos (~1600px de lado mayor)
        const targetMax = 1650
        const targetMin = 1000
        let scale = 1
        const maxSide = Math.max(origW, origH)
        if (maxSide > targetMax) {
          scale = targetMax / maxSide
        } else if (maxSide < targetMin) {
          scale = targetMin / maxSide
        }

        const w = Math.max(1, Math.round(origW * scale))
        const h = Math.max(1, Math.round(origH * scale))

        // Canvas 1: Escala de grises con estiramiento de contraste (Pass B)
        const grayCanvas = document.createElement('canvas')
        grayCanvas.width = w
        grayCanvas.height = h
        const grayCtx = grayCanvas.getContext('2d')
        grayCtx.drawImage(img, 0, 0, w, h)

        const imgData = grayCtx.getImageData(0, 0, w, h)
        const data = imgData.data
        const lum = new Uint8Array(w * h)

        let minL = 255
        let maxL = 0
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
          lum[p] = l
          if (l < minL) minL = l
          if (l > maxL) maxL = l
        }

        const range = Math.max(1, maxL - minL)
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const norm = Math.round(((lum[p] - minL) / range) * 255)
          lum[p] = norm
          const contrasted = norm < 128 ? Math.max(0, Math.round(norm * 0.85)) : Math.min(255, Math.round(norm * 1.08))
          data[i] = contrasted
          data[i + 1] = contrasted
          data[i + 2] = contrasted
        }
        grayCtx.putImageData(imgData, 0, 0)

        // Canvas 2: Umbralización adaptativa local (Integral Image) para tickets térmicos con sombra (Pass A)
        const binCanvas = document.createElement('canvas')
        binCanvas.width = w
        binCanvas.height = h
        const binCtx = binCanvas.getContext('2d')
        const binData = binCtx.createImageData(w, h)
        const bPixels = binData.data

        const integral = new Float64Array((w + 1) * (h + 1))
        const stride = w + 1
        for (let y = 1; y <= h; y++) {
          let rowSum = 0
          const srcRow = (y - 1) * w
          const dstRow = y * stride
          const prevRow = (y - 1) * stride
          for (let x = 1; x <= w; x++) {
            rowSum += lum[srcRow + x - 1]
            integral[dstRow + x] = integral[prevRow + x] + rowSum
          }
        }

        const radius = Math.max(12, Math.round(Math.min(w, h) / 28))
        for (let y = 0; y < h; y++) {
          const y1 = Math.max(0, y - radius)
          const y2 = Math.min(h - 1, y + radius)
          const hWin = y2 - y1 + 1
          for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - radius)
            const x2 = Math.min(w - 1, x + radius)
            const area = (x2 - x1 + 1) * hWin
            const sum =
              integral[(y2 + 1) * stride + (x2 + 1)] -
              integral[y1 * stride + (x2 + 1)] -
              integral[(y2 + 1) * stride + x1] +
              integral[y1 * stride + x1]

            const localMean = sum / area
            const pVal = lum[y * w + x]
            // Si el píxel es significativamente más oscuro que el fondo local del papel, es tinta
            const isInk = pVal < localMean * 0.87 && pVal < 215
            const out = isInk ? Math.max(0, Math.round((pVal / Math.max(1, localMean)) * 60)) : 255
            const idx = (y * w + x) * 4
            bPixels[idx] = out
            bPixels[idx + 1] = out
            bPixels[idx + 2] = out
            bPixels[idx + 3] = 255
          }
        }
        binCtx.putImageData(binData, 0, 0)

        URL.revokeObjectURL(objectUrl)
        resolve({ adaptiveCanvas: binCanvas, grayCanvas })
      } catch {
        URL.revokeObjectURL(objectUrl)
        resolve({ adaptiveCanvas: file, grayCanvas: file })
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({ adaptiveCanvas: file, grayCanvas: file })
    }

    img.src = objectUrl
  })
}

// Normaliza confusiones típicas del OCR en secuencias numéricas (O->0, l/I->1, S->5)
function normalizeOcrDigits(str) {
  if (!str) return ''
  return str
    .replace(/(?<=\d)[OoQq](?=\d)/g, '0')
    .replace(/(?<=[$#\s])[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo](?=[\s.,]|$)/g, '0')
    .replace(/(?<=\d)[lI|](?=\d)/g, '1')
    .replace(/(?<=[$#\s])[lI|](?=\d)/g, '1')
    .replace(/(?<=\d)[lI|](?=[\s.,]|$)/g, '1')
    .replace(/(?<=\d)[Ss](?=\d{2})/g, '5')
}

// Convierte montos como "$1,250.50", "419.00", "$ 320,00" a número real sin truncar en la coma de miles
function parseMoneyAmount(rawStr) {
  if (!rawStr) return null
  let s = normalizeOcrDigits(String(rawStr).trim())
  s = s.replace(/[^0-9.,]/g, '')
  if (!s) return null

  // Si tiene coma y punto (ej. 1,250.50 o 1.250,50)
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
      s = s.replace(/,/g, '')
    } else {
      s = s.replace(/\./g, '').replace(',', '.')
    }
  } else if (s.includes(',')) {
    // Si termina con ,XX (2 decimales) es coma decimal; si termina con ,XXX (3 dígitos) es separador de miles
    const parts = s.split(',')
    if (parts[parts.length - 1].length === 3 && parts.length === 2 && Number(parts[0]) >= 1) {
      s = s.replace(/,/g, '')
    } else {
      s = s.replace(',', '.')
    }
  }

  const val = parseFloat(s)
  return Number.isFinite(val) && val > 0 ? val : null
}

// Limpia artefactos de bordes de ticket térmico en una línea
function cleanOcrLine(line) {
  if (!line) return ''
  return line
    .replace(/^[|¦!¡*~_—–·•\s]+|[|¦*~_—–·•\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Función inteligente multipaso para descomponer y repartir los datos del ticket en cada campo del formulario
function parseTicketText(rawText, currentRestaurantName = '') {
  const parsed = {
    customer_name: '',
    customer_phone: '',
    street: '',
    neighborhood: '',
    address_reference: '',
    map_url: '',
    amount_to_collect: null,
    payment_method: '',
    needs_change: false,
    change_option: '',
    change_other: '',
    description: '',
    comments: '',
    care_instructions: [],
  }

  if (!rawText || typeof rawText !== 'string') return parsed

  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => cleanOcrLine(l))
    .filter((l) => l.length >= 2 && !/^[-=*_.~#/:;,\s]+$/.test(l))

  if (!rawLines.length) return parsed

  const consumedIndices = new Set()
  const restNameNorm = (currentRestaurantName || '').toLowerCase().trim()

  // Identificar líneas de cabecera del restaurante (primeras líneas con RFC, Régimen, Sucursal, nombre del local, etc.)
  const headerIndices = new Set()
  for (let i = 0; i < Math.min(rawLines.length, 7); i++) {
    const l = rawLines[i].toLowerCase()
    if (
      (restNameNorm && restNameNorm.length >= 3 && l.includes(restNameNorm)) ||
      /\b(?:rfc|r\.f\.c\.|r[eé]gimen|sucursal|matriz|ticket\s*(?:de\s*venta|#)|folio|cajero|mesero|atendi[oó]|fecha|hora|turno|caja)\b/i.test(l)
    ) {
      headerIndices.add(i)
    }
  }

  // Detectar si existe un bloque explícito de "DATOS DEL CLIENTE / DOMICILIO / ENVÍO"
  let deliverySectionStart = -1
  for (let i = 0; i < rawLines.length; i++) {
    if (/\b(?:datos\s+del?\s+(?:cliente|env[ií]o|domicilio)|servicio\s+a\s+domicilio|entrega\s+a\s+domicilio|enviar\s+a|para\s+entregar)\b/i.test(rawLines[i])) {
      deliverySectionStart = i
      consumedIndices.add(i)
      break
    }
  }

  // 0. Enlace de Google Maps si viene en el texto (ej. al pegar de WhatsApp)
  for (let i = 0; i < rawLines.length; i++) {
    const urlMatch = rawLines[i].match(/(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps)[^\s]+)/i)
    if (urlMatch) {
      parsed.map_url = urlMatch[1]
      consumedIndices.add(i)
      break
    }
  }

  // 1. Teléfono del cliente (10 dígitos, corrigiendo confusiones OCR como O->0 y l->1)
  const phoneLabelRegex = /\b(?:tel(?:[eé]fono|ef)?|cel(?:ular)?|whatsapp|wa|m[oó]vil|contacto|llamar(?:\s*a)?|cliente\s*tel)\b[\s:#.-]*(.*)$/i
  const extractTenDigitPhone = (str) => {
    const normalized = normalizeOcrDigits(str)
    // Ignorar fechas tipo 04/11/2026 o horas o RFC
    const withoutDates = normalized.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    const candidates = withoutDates.match(/(?:\+?52[\s.-]*)?(?:\(?\d{2,3}\)?[\s.-]*)?\d{3,4}[\s.-]*\d{3,4}(?:[\s.-]*\d{2,4})?/g) || []
    for (const cand of candidates) {
      const digits = cand.replace(/\D/g, '')
      const ten = digits.length === 12 && digits.startsWith('52') ? digits.slice(2) : digits.length === 10 ? digits : ''
      if (ten.length === 10 && !ten.startsWith('00') && !ten.startsWith('199') && !ten.startsWith('202')) {
        return { phone: ten, rawMatch: cand }
      }
    }
    return null
  }

  // Paso 1A: Teléfono con etiqueta explícita (priorizando fuera del encabezado del restaurante)
  const labeledPhones = []
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const m = line.match(phoneLabelRegex)
    if (m) {
      const sameLinePhone = extractTenDigitPhone(m[1] || line)
      if (sameLinePhone) {
        labeledPhones.push({ index: i, nextLine: false, ...sameLinePhone, isHeader: headerIndices.has(i) && i < 3 })
      } else if (i + 1 < rawLines.length) {
        const nextLinePhone = extractTenDigitPhone(rawLines[i + 1])
        if (nextLinePhone) {
          labeledPhones.push({ index: i, nextLine: true, ...nextLinePhone, isHeader: false })
        }
      }
    }
  }

  if (labeledPhones.length > 0) {
    // Si hay más de un teléfono etiquetado, el primero en el top suele ser el del restaurante y el siguiente el del cliente
    const chosen = labeledPhones.find((p) => !p.isHeader && p.index >= (deliverySectionStart > -1 ? deliverySectionStart : 1)) || labeledPhones[labeledPhones.length - 1]
    parsed.customer_phone = chosen.phone
    if (chosen.nextLine) {
      consumedIndices.add(chosen.index)
      consumedIndices.add(chosen.index + 1)
    } else {
      const remainder = rawLines[chosen.index].replace(phoneLabelRegex, '').trim()
      if (remainder.length < 4) {
        consumedIndices.add(chosen.index)
      }
    }
  }

  // Paso 1B: Teléfono sin etiqueta si no se encontró con etiqueta
  if (!parsed.customer_phone) {
    const genericPhones = []
    for (let i = 0; i < rawLines.length; i++) {
      if (consumedIndices.has(i)) continue
      const found = extractTenDigitPhone(rawLines[i])
      if (found) {
        genericPhones.push({ index: i, ...found, isHeader: i < 2 && rawLines.length > 5 })
      }
    }
    if (genericPhones.length > 0) {
      const chosen = genericPhones.find((p) => !p.isHeader) || genericPhones[genericPhones.length - 1]
      parsed.customer_phone = chosen.phone
      const cleaned = normalizeOcrDigits(rawLines[chosen.index]).replace(chosen.rawMatch, '').replace(/[^a-záéíóúñ]/gi, '')
      if (cleaned.length < 4) {
        consumedIndices.add(chosen.index)
      }
    }
  }

  // 2. Nombre del cliente (con soporte multilínea: "CLIENTE:\nJuan Pérez")
  const nameLabelRegex = /^(?:nombre\s+del\s+cliente|cliente|nombre|para|destinatario|recibe|entregar\s+a|pedido\s+de|orden\s+a\s+nombre\s+de|a\s+nombre\s+de|at['’]?n|atenci[oó]n)\b[\s:#.-]*(.*)$/i
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const match = line.match(nameLabelRegex)
    if (match) {
      let candidate = (match[1] || '').trim()
      let usedNextLine = false

      // Si en la misma línea solo estaba la etiqueta "CLIENTE:" y el valor está en la línea siguiente
      if (candidate.length < 2 && i + 1 < rawLines.length && !consumedIndices.has(i + 1)) {
        const nextLine = rawLines[i + 1].trim()
        if (!/^(?:direcci[oó]n|domicilio|calle|colonia|tel|cel|total|subtotal|pago)/i.test(nextLine)) {
          candidate = nextLine
          usedNextLine = true
        }
      }

      // Limpiar si en la misma línea viene "Cliente: Juan Pérez Tel: 415..."
      candidate = candidate
        .replace(/\b(?:tel(?:[eé]fono)?|cel(?:ular)?|whatsapp|domicilio|direcci[oó]n|colonia)\b.*$/i, '')
        .replace(/(?:\+?52[\s.-]*)?\d{3}[\s.-]*\d{3}[\s.-]*\d{4}/g, '')
        .replace(/^[-:#.\s]+|[-:#.\s]+$/g, '')
        .trim()

      if (candidate.length >= 2 && !/^(?:general|mostrador|p[uú]blico\s+en\s+general|venta\s+mostrador|sin\s+nombre|n\/a)$/i.test(candidate)) {
        parsed.customer_name = candidate
        consumedIndices.add(i)
        if (usedNextLine) consumedIndices.add(i + 1)
        break
      }
    }
  }

  // 3. Dirección, Colonia y Referencias (con soporte multilínea y separación inteligente)
  const addrLabelRegex = /^(?:direcci[oó]n\s+de\s+entrega|direcci[oó]n|domicilio|dir\.?|entrega\s+en|enviar\s+a|calle\s+y\s+n[uú]mero|calle|ubicaci[oó]n)\b[\s:#.-]*(.*)$/i
  const colLabelRegex = /^(?:colonia|col\.?|fraccionamiento|fracc\.?|frac\.?|barrio|residencial|unidad\s+hab(?:itacional)?|infonavit|zona)\b[\s:#.-]*(.*)$/i
  const refLabelRegex = /^(?:referencias?|ref\.?|entre\s+calles?|cruzamientos?|entre|cruce|fachada|port[oó]n|color\s+de\s+casa|indicaciones\s+de\s+entrega)\b[\s:#.-]*(.*)$/i

  // Función auxiliar para separar Calle, Colonia y Referencia cuando vienen en una misma cadena
  const splitCombinedAddress = (fullAddr) => {
    let work = fullAddr.trim()
    let extStreet = ''
    let extCol = ''
    let extRef = ''

    // Extraer referencia explícita al final ("... Ref: portón negro" o "... entre X y Y")
    const refSplit = work.match(/^(.*?)(?:[,;]\s*|\s+)(?:ref(?:erencias?)?[:.\s-]+|entre\s+calles\s+|frente\s+a\s+|casa\s+color\s+|port[oó]n\s+)(.+)$/i)
    if (refSplit && refSplit[1].length >= 4) {
      work = refSplit[1].trim()
      extRef = refSplit[2].trim()
    }

    // Extraer colonia explícita ("... Col. San Antonio" / "... Fracc. La Lomita" / "... Barrio de ...")
    const colSplit = work.match(/^(.*?)(?:[,;-]\s*|\s+)\b(col(?:onia|\.)?|fracc(?:ionamiento|\.)?|frac\.?|barrio|residencial|infonavit|u\.\s*hab\.?)\s*[:.-]?\s*(.+)$/i)
    if (colSplit && colSplit[1].length >= 3) {
      extStreet = colSplit[1].trim().replace(/[,;-]+$/, '').trim()
      const colPrefix = /^(?:fracc|barrio|residencial|infonavit)/i.test(colSplit[2]) ? `${colSplit[2]} ` : ''
      extCol = (colPrefix + colSplit[3]).replace(/\s{2,}/g, ' ').trim()
    } else {
      // Si viene separado por coma: "Av. Independencia 120, Centro"
      const commaParts = work.split(',').map((p) => p.trim()).filter(Boolean)
      if (commaParts.length >= 2 && /\d/.test(commaParts[0]) && commaParts[1].length >= 3 && !/^\d+$/.test(commaParts[1])) {
        extStreet = commaParts[0]
        extCol = commaParts[1]
        if (commaParts.length >= 3 && !extRef) {
          extRef = commaParts.slice(2).join(', ')
        }
      } else {
        extStreet = work
      }
    }

    return { extStreet, extCol, extRef }
  }

  for (let i = 0; i < rawLines.length; i++) {
    if (consumedIndices.has(i)) continue
    const line = rawLines[i]

    // 3A. Etiqueta explícita de Colonia
    const colMatch = line.match(colLabelRegex)
    if (colMatch && !parsed.neighborhood) {
      let colVal = (colMatch[1] || '').trim()
      if (colVal.length < 2 && i + 1 < rawLines.length && !consumedIndices.has(i + 1)) {
        colVal = rawLines[i + 1].trim()
        consumedIndices.add(i + 1)
      }
      if (colVal.length >= 2) {
        // Si la etiqueta era Fracc. o Barrio, conservar el tipo si aporta claridad
        const labelWord = line.match(/^(fracc(?:ionamiento)?|barrio|residencial|infonavit)/i)
        parsed.neighborhood = labelWord && !colVal.toLowerCase().startsWith(labelWord[1].toLowerCase())
          ? `${labelWord[1]} ${colVal}`.trim()
          : colVal.replace(/^[-:#.,\s]+|[-:#.,\s]+$/g, '')
        consumedIndices.add(i)
        continue
      }
    }

    // 3B. Etiqueta explícita de Referencia
    const refMatch = line.match(refLabelRegex)
    if (refMatch && !parsed.address_reference) {
      let refVal = (refMatch[1] || '').trim()
      if (/^entre\b/i.test(line) && refVal) {
        refVal = `Entre ${refVal}`
      } else if (refVal.length < 2 && i + 1 < rawLines.length && !consumedIndices.has(i + 1)) {
        refVal = rawLines[i + 1].trim()
        consumedIndices.add(i + 1)
      }
      if (refVal.length >= 2) {
        parsed.address_reference = refVal.replace(/^[-:#.,\s]+|[-:#.,\s]+$/g, '')
        consumedIndices.add(i)
        continue
      }
    }

    // 3C. Etiqueta explícita de Dirección / Domicilio
    const addrMatch = line.match(addrLabelRegex)
    if (addrMatch && !parsed.street) {
      let addrVal = (addrMatch[1] || '').trim()
      consumedIndices.add(i)

      // Si "DOMICILIO:" venía solo en su línea, tomar la línea siguiente
      if (addrVal.length < 3 && i + 1 < rawLines.length && !consumedIndices.has(i + 1)) {
        addrVal = rawLines[i + 1].trim()
        consumedIndices.add(i + 1)
        i++
      }

      if (addrVal.length >= 3) {
        const { extStreet, extCol, extRef } = splitCombinedAddress(addrVal)
        parsed.street = extStreet
        if (extCol && !parsed.neighborhood) parsed.neighborhood = extCol
        if (extRef && !parsed.address_reference) parsed.address_reference = extRef

        // Revisar si la línea inmediatamente siguiente es la continuación de la colonia
        if (!parsed.neighborhood && i + 1 < rawLines.length && !consumedIndices.has(i + 1)) {
          const nextLine = rawLines[i + 1].trim()
          const nextColMatch = nextLine.match(colLabelRegex)
          if (nextColMatch && nextColMatch[1]) {
            parsed.neighborhood = nextColMatch[1].trim()
            consumedIndices.add(i + 1)
            i++
          } else if (
            nextLine.length >= 3 &&
            nextLine.length <= 40 &&
            !/\d{3,}/.test(nextLine) &&
            !/\$/.test(nextLine) &&
            !/^\d+\s+[a-z]/i.test(nextLine) &&
            !/\b(?:total|subtotal|efectivo|tarjeta|transferencia|paga|cambio|tel|cliente|nota)\b/i.test(nextLine)
          ) {
            parsed.neighborhood = nextLine.replace(/^(?:col\.?|colonia)\s*/i, '').trim()
            consumedIndices.add(i + 1)
            i++
          }
        }
      }
      continue
    }
  }

  // 3D. Si no tenía etiqueta "Dirección:", buscar líneas con patrón de calle (evitando encabezado del local)
  if (!parsed.street) {
    const startIdx = deliverySectionStart > -1 ? deliverySectionStart : (rawLines.length > 6 ? 1 : 0)
    for (let i = startIdx; i < rawLines.length; i++) {
      if (consumedIndices.has(i) || headerIndices.has(i)) continue
      const line = rawLines[i]
      if (/\$|\b(?:total|subtotal|cambio|efectivo|pizza|hamburguesa|tacos?|refresco|orden|combos?)\b/i.test(line)) continue

      const looksLikeStreet =
        /\b(?:calle|callej[oó]n|av\.?|avenida|blvd\.?|boulevard|circuito|andador|retorno|priv(?:ada|\.)?|cerrada|prol(?:ongaci[oó]n|\.)?|camino|carretera|c\.)\s+[a-záéíóúñ0-9]/i.test(line) ||
        (/\b[a-záéíóúñ]{3,}(?:\s+[a-záéíóúñ]{2,})*\s+(?:#|no\.?\s*|n[uú]m\.?\s*)\d+/i.test(line) && !/\b(?:ticket|folio|orden|pedido|mesa|cajero|sucursal)\b/i.test(line))

      if (looksLikeStreet) {
        const { extStreet, extCol, extRef } = splitCombinedAddress(line)
        parsed.street = extStreet
        if (extCol && !parsed.neighborhood) parsed.neighborhood = extCol
        if (extRef && !parsed.address_reference) parsed.address_reference = extRef
        consumedIndices.add(i)
        break
      }
    }
  }

  // 4. Importe a cobrar (Total del ticket) — Búsqueda de abajo hacia arriba para tomar el TOTAL FINAL
  const totalLabelRegex = /\b(?:total\s+a\s+pagar|gran\s+total|total\s+neto|monto\s+a\s+cobrar|importe\s+total|a\s+pagar|total\s+mxn|cobrar\s+al\s+cliente|total)\b[\s:#$.-]*([$]?\s*[0-9OolI]{1,3}(?:[.,][0-9OolI]{3})*(?:[.,][0-9OolI]{1,2})?)?/i
  const excludedTotalLineRegex = /\b(?:sub\s*-?\s*total|subtotal|total\s+de\s+art[ií]culos|total\s+art[ií]culos|total\s+productos|total\s+descuento|total\s+iva|iva|impuestos?|propina)\b/i

  for (let i = rawLines.length - 1; i >= 0; i--) {
    const line = rawLines[i]
    if (excludedTotalLineRegex.test(line) && !/\b(?:total\s+a\s+pagar|gran\s+total)\b/i.test(line)) continue

    const m = line.match(totalLabelRegex)
    if (m) {
      let amountVal = m[1] ? parseMoneyAmount(m[1]) : null
      // Si el monto estaba al final de la línea o en la línea inmediatamente siguiente
      if (!amountVal) {
        const endNumMatch = normalizeOcrDigits(line).match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*$/)
        if (endNumMatch) {
          amountVal = parseMoneyAmount(endNumMatch[1])
        } else if (i + 1 < rawLines.length) {
          const nextNumMatch = normalizeOcrDigits(rawLines[i + 1]).match(/^\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*$/)
          if (nextNumMatch) {
            amountVal = parseMoneyAmount(nextNumMatch[1])
            if (amountVal) consumedIndices.add(i + 1)
          }
        }
      }

      if (amountVal && amountVal >= 15 && amountVal <= 25000) {
        parsed.amount_to_collect = amountVal
        consumedIndices.add(i)
        break
      }
    }
  }

  // 5. Método de pago y Cambio ("Paga con", "Su pago", "Cambio")
  const fullText = rawLines.join('\n').toLowerCase()
  if (/\b(?:transferencia|spei|transfer|dep[oó]sito)\b/i.test(fullText)) {
    parsed.payment_method = 'Transferencia'
  } else if (/\b(?:pagado\s+con\s+tarjeta|tarjeta|terminal|d[eé]bito|cr[eé]dito|visa|mastercard|amex|ya\s+pagado)\b/i.test(fullText)) {
    parsed.payment_method = 'Tarjeta / pedido pagado'
  } else if (/\b(?:contra\s*entrega|contraentrega|cobro\s+al\s+entregar)\b/i.test(fullText)) {
    parsed.payment_method = 'Pago contra entrega'
  } else if (/\b(?:efectivo|cash|paga\s+con|su\s+pago|billete|cambio|recibido)\b/i.test(fullText) || parsed.amount_to_collect) {
    parsed.payment_method = 'Efectivo'
  }

  const payWithRegex = /\b(?:paga\s+con(?:\s+billete\s+de)?|su\s+pago|efectivo\s+recibido|recibido|paga\s+\$)\b[\s:#$.-]*([0-9OolI.,]+)/i
  const changeRegex = /\b(?:su\s+cambio|cambio|llevar\s+cambio(?:\s+de)?)\b[\s:#$.-]*([0-9OolI.,]+)/i

  let matchedBill = null
  let matchedChange = null

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const payMatch = line.match(payWithRegex)
    if (payMatch) {
      const val = parseMoneyAmount(payMatch[1])
      if (val && val >= 20) {
        matchedBill = Math.round(val)
        consumedIndices.add(i)
      }
    }
    const chMatch = line.match(changeRegex)
    if (chMatch) {
      const val = parseMoneyAmount(chMatch[1])
      if (val !== null && val >= 0) {
        matchedChange = val
        consumedIndices.add(i)
      }
    }
  }

  if (
    (matchedBill && (!parsed.amount_to_collect || matchedBill > parsed.amount_to_collect)) ||
    (matchedChange !== null && matchedChange > 0)
  ) {
    parsed.needs_change = true
    const bill =
      matchedBill ||
      (parsed.amount_to_collect && matchedChange ? Math.round(parsed.amount_to_collect + matchedChange) : null)
    if (bill) {
      if ([100, 200, 500, 1000].includes(bill)) {
        parsed.change_option = String(bill)
      } else {
        parsed.change_option = 'Otro'
        parsed.change_other = String(bill)
      }
    }
  }

  // 6. Comentarios o notas para el repartidor
  const commentRegex = /^(?:notas?|comentarios?|observaci[oó]n(?:es)?|obs\.?|instrucciones?|indicaciones?)\b[\s:#.-]*(.*)$/i
  for (let i = 0; i < rawLines.length; i++) {
    if (consumedIndices.has(i)) continue
    const line = rawLines[i]
    const match = line.match(commentRegex)
    if (match) {
      let noteVal = (match[1] || '').trim()
      if (noteVal.length < 2 && i + 1 < rawLines.length && !consumedIndices.has(i + 1)) {
        noteVal = rawLines[i + 1].trim()
        consumedIndices.add(i + 1)
      }
      if (noteVal.length >= 2) {
        parsed.comments = noteVal
        consumedIndices.add(i)
        break
      }
    }
  }

  // 7. Extraer productos / platillos (Descripción del pedido) y sumar respaldo si no hubo línea de TOTAL
  const isSystemOrMetaLine = (line, idx) => {
    if (headerIndices.has(idx)) return true
    const l = line.toLowerCase()
    if (/\b(?:ticket|folio|orden\s*#?|pedido\s*#?|comanda|sucursal|rfc|r[eé]gimen|cajero|mesero|mesa|terminal|turno|fecha|hora|pos|venta|cliente|domicilio|direcci[oó]n|colonia|tel[eé]fono|celular|whatsapp)\b/i.test(l)) return true
    if (/\b(?:cant(?:idad)?\s+descripci[oó]n|art[ií]culo\s+precio|concepto\s+importe|descripci[oó]n\s+total)\b/i.test(l)) return true
    if (/\b(?:subtotal|sub-total|iva|impuesto|propina|descuento|total\s+a\s+pagar|gran\s+total|total|env[ií]o|servicio\s+domicilio)\b/i.test(l)) return true
    if (/\b(?:efectivo|cambio|tarjeta|transferencia|paga\s+con|su\s+pago|recibido|visa|mastercard|contra\s*entrega|cobro)\b/i.test(l)) return true
    if (/\b(?:gracias\s+por|vuelva\s+pronto|facturaci[oó]n|factura|este\s+no\s+es\s+un\s+comprobante|propina\s+no\s+incluida)\b/i.test(l)) return true
    if (/^\$?\s*\d+(?:[.,]\d{1,2})?\s*$/.test(line)) return true
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line)) return true
    return false
  }

  const productLines = []
  let sumProductPrices = 0

  for (let i = 0; i < rawLines.length; i++) {
    if (consumedIndices.has(i)) continue
    const line = rawLines[i]
    if (isSystemOrMetaLine(line, i)) continue

    // Detectar si tiene precio al final de la línea (ej. "2 Pizza Grande $398.00")
    const priceAtEndMatch = normalizeOcrDigits(line).match(/^(.*?)\s+\$?\s*(\d{2,4}(?:[.,]\d{2}))\s*$/)
    let cleanedProduct = line
    if (priceAtEndMatch && priceAtEndMatch[1].trim().length >= 3) {
      cleanedProduct = priceAtEndMatch[1].trim()
      const itemPrice = parseMoneyAmount(priceAtEndMatch[2])
      if (itemPrice && itemPrice < 10000) {
        sumProductPrices += itemPrice
      }
    } else {
      cleanedProduct = line
        .replace(/[\s.$]+(?:\d{1,4}(?:[.,]\d{2})?)\s*$/, '')
        .replace(/[.]+$/, '')
        .trim()
    }

    // Filtrar líneas basura de OCR (menos de 3 letras reales)
    const letterCount = (cleanedProduct.match(/[a-záéíóúñ]/gi) || []).length
    if (cleanedProduct.length >= 3 && letterCount >= 3) {
      productLines.push(cleanedProduct)
    }
  }

  parsed.description = productLines.join('\n')

  if (!parsed.amount_to_collect && sumProductPrices >= 20) {
    parsed.amount_to_collect = Math.round(sumProductPrices * 100) / 100
  }

  // 8. Nivel de cuidado del pedido automático según platillos detectados
  const combinedDesc = (parsed.description + ' ' + (parsed.comments || '')).toLowerCase()
  if (/\bpizzas?\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Mantener horizontal')
  }
  if (/\b(?:sopa|caldo|consom[eé]|ramen|pozole|birria|bebida|refresco|coca|pepsi|soda|jugo|caf[eé]|agua|malteada|frapp[eé]|vaso|cerveza|licuado)\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Puede derramarse')
  }
  if (/\b(?:caliente|pozole|birria|hamburguesa|burger|tacos?|comida|pizzas?|alitas|boneless|pollo|enchiladas|chilaquiles|burritos?|quesadillas?)\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Mantener caliente')
  }
  if (/\b(?:fr[aá]gil|delicado|pastel|pay|postre|flan|brownie|huevo|crepa|waffle)\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Frágil o delicado')
  }

  return parsed
}

// Cuenta cuántos campos clave logró extraer una pasada de OCR para elegir o combinar la mejor
function scoreParsedTicket(p) {
  let score = 0
  if (p.customer_phone) score += 3
  if (p.street) score += 3
  if (p.neighborhood) score += 3
  if (p.amount_to_collect !== null) score += 3
  if (p.customer_name) score += 2
  if (p.address_reference) score += 1
  if (p.payment_method) score += 1
  if (p.description) score += 1
  return score
}

// Aplica el objeto parsed al formulario y devuelve la lista de campos rellenados
async function applyParsedTicketToForm(parsed) {
  const filled = []

  if (parsed.customer_name) {
    form.customer_name = parsed.customer_name
    filled.push('Cliente')
  }
  if (parsed.customer_phone) {
    form.customer_phone = parsed.customer_phone
    filled.push('Teléfono')
  }
  if (parsed.street) {
    form.street = parsed.street
    filled.push('Calle')
  }
  if (parsed.neighborhood) {
    form.neighborhood = parsed.neighborhood
    filled.push('Colonia')
  }
  if (parsed.address_reference) {
    form.address_reference = parsed.address_reference
    filled.push('Referencias')
  }
  if (parsed.map_url) {
    form.map_url = parsed.map_url
    filled.push('Mapa URL')
  }
  if (parsed.amount_to_collect !== null) {
    form.amount_to_collect = parsed.amount_to_collect
    filled.push(`Total ($${Number(parsed.amount_to_collect).toFixed(2)})`)
  }
  if (parsed.payment_method) {
    form.payment_method = parsed.payment_method
    filled.push('Método de pago')
  }
  if (parsed.needs_change) {
    form.needs_change = true
    form.change_option = parsed.change_option
    form.change_other = parsed.change_other
    filled.push('Cambio')
  }
  if (parsed.description) {
    form.description = parsed.description
    filled.push('Productos')
  }
  if (parsed.comments) {
    form.comments = parsed.comments
    filled.push('Comentarios')
  }
  if (parsed.care_instructions.length) {
    parsed.care_instructions.forEach((item) => {
      if (!form.care_instructions.includes(item)) {
        form.care_instructions.push(item)
      }
    })
  }

  ocrDetectedFields.value = filled

  // Si el restaurante tiene ubicación registrada, calcular distancia automáticamente con los datos del ticket
  if (hasRegisteredLocation.value && (form.street || form.neighborhood || form.map_url)) {
    await autoCalculateRouteDistance(false)
  }

  return filled
}

async function reparseManualOcrText() {
  if (!ocrRawText.value.trim()) {
    showToast('Pega o escribe primero el texto del ticket o pedido.', 'info')
    return
  }
  const parsed = parseTicketText(ocrRawText.value, restaurant.value?.name || '')
  const filled = await applyParsedTicketToForm(parsed)
  if (filled.length) {
    ocrStatus.value = `✓ Se actualizaron ${filled.length} campos desde el texto: ${filled.join(', ')}.`
    showToast(`¡${filled.length} campos distribuidos en el formulario!`, 'success')
  } else {
    showToast('No se identificaron campos etiquetados en el texto.', 'info')
  }
}

async function handleTicketUpload(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return

  imagePreview.value = URL.createObjectURL(file)
  ocrLoading.value = true
  ocrDetectedFields.value = []
  ocrStatus.value = 'Mejorando nitidez y contraste de la imagen del ticket…'

  try {
    if (!window.Tesseract) {
      ocrStatus.value = 'Cargando motor de reconocimiento óptico…'
      await new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
        s.onload = resolve
        s.onerror = () => reject(new Error('No se pudo cargar el motor OCR. Revisa tu conexión a internet.'))
        document.head.appendChild(s)
      })
    }

    const { adaptiveCanvas, grayCanvas } = await preprocessImageForOcr(file)

    ocrStatus.value = 'Analizando estructura y líneas del ticket (Paso 1)…'
    const pass1 = await window.Tesseract.recognize(adaptiveCanvas, 'spa+eng', {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          ocrStatus.value = `Leyendo ticket (alta definición): ${Math.round((m.progress || 0) * 100)}%`
        }
      },
    })

    const text1 = pass1?.data?.text || ''
    const parsed1 = parseTicketText(text1, restaurant.value?.name || '')
    let bestParsed = parsed1
    let bestText = text1

    // Si en la primera pasada faltaron datos clave (ej. teléfono, calle o monto), ejecutar segunda pasada con escala de grises suave
    if (scoreParsedTicket(parsed1) < 9) {
      ocrStatus.value = 'Refinando lectura en zonas con sombra (Paso 2)…'
      const pass2 = await window.Tesseract.recognize(grayCanvas, 'spa+eng', {
        tessedit_pageseg_mode: '4',
        preserve_interword_spaces: '1',
      })
      const text2 = pass2?.data?.text || ''
      const parsed2 = parseTicketText(text2, restaurant.value?.name || '')

      if (scoreParsedTicket(parsed2) > scoreParsedTicket(parsed1)) {
        bestParsed = {
          customer_name: parsed2.customer_name || parsed1.customer_name,
          customer_phone: parsed2.customer_phone || parsed1.customer_phone,
          street: parsed2.street || parsed1.street,
          neighborhood: parsed2.neighborhood || parsed1.neighborhood,
          address_reference: parsed2.address_reference || parsed1.address_reference,
          map_url: parsed2.map_url || parsed1.map_url,
          amount_to_collect: parsed2.amount_to_collect ?? parsed1.amount_to_collect,
          payment_method: parsed2.payment_method || parsed1.payment_method,
          needs_change: parsed2.needs_change || parsed1.needs_change,
          change_option: parsed2.change_option || parsed1.change_option,
          change_other: parsed2.change_other || parsed1.change_other,
          description: parsed2.description.length >= parsed1.description.length ? parsed2.description : parsed1.description,
          comments: parsed2.comments || parsed1.comments,
          care_instructions: Array.from(new Set([...parsed1.care_instructions, ...parsed2.care_instructions])),
        }
        bestText = text2
      } else {
        bestParsed = {
          customer_name: parsed1.customer_name || parsed2.customer_name,
          customer_phone: parsed1.customer_phone || parsed2.customer_phone,
          street: parsed1.street || parsed2.street,
          neighborhood: parsed1.neighborhood || parsed2.neighborhood,
          address_reference: parsed1.address_reference || parsed2.address_reference,
          map_url: parsed1.map_url || parsed2.map_url,
          amount_to_collect: parsed1.amount_to_collect ?? parsed2.amount_to_collect,
          payment_method: parsed1.payment_method || parsed2.payment_method,
          needs_change: parsed1.needs_change || parsed2.needs_change,
          change_option: parsed1.change_option || parsed2.change_option,
          change_other: parsed1.change_other || parsed2.change_other,
          description: parsed1.description || parsed2.description,
          comments: parsed1.comments || parsed2.comments,
          care_instructions: Array.from(new Set([...parsed1.care_instructions, ...parsed2.care_instructions])),
        }
      }
    }

    ocrRawText.value = bestText.trim()
    const filled = await applyParsedTicketToForm(bestParsed)

    if (filled.length > 0) {
      ocrStatus.value = `✓ Lectura completada (${filled.length} campos detectados: ${filled.join(', ')}). Verifica los datos antes de enviar.`
      showToast(`¡Ticket leído! Se completaron ${filled.length} campos.`, 'success')
    } else {
      ocrStatus.value = 'Se leyó la imagen pero no se identificaron etiquetas claras. Puedes revisar el texto detectado o llenar los campos.'
      showOcrTextEditor.value = true
      showToast('Revisa el texto detectado o ingresa los datos.', 'info')
    }
  } catch (err) {
    ocrStatus.value = `No se pudo completar el OCR automático: ${err.message}. Puedes ingresar los datos manualmente.`
    showToast('No se pudo leer el ticket automáticamente. Ingresa los datos manualmente.', 'error')
  } finally {
    ocrLoading.value = false
  }
}

function clearTicketPhoto() {
  if (ticketFileInput.value) ticketFileInput.value.value = ''
  if (ticketGalleryInput.value) ticketGalleryInput.value.value = ''
  imagePreview.value = ''
  ocrRawText.value = ''
  ocrDetectedFields.value = []
  showOcrTextEditor.value = false
  ocrStatus.value = 'Toma una foto nítida del ticket o pega el texto del pedido para distribuir los datos automáticamente.'
}

// Solicitud rápida de repartidores (Máximo 3 usos por día + Zonas por repartidor)
const selectedRiders = ref(1)
const selectedRiderZones = ref(['', '', '', ''])
const riderZoneSearchQueries = ref(['', '', '', ''])
const quickNote = ref('')
const quickLoading = ref(false)
const quickResult = ref(null)
const quickCopySuccess = ref(false)

function getFilteredZonesForRider(riderZeroIndex) {
  const rawQuery = riderZoneSearchQueries.value[riderZeroIndex] || ''
  const cleanQuery = normalizeZoneSearchText(rawQuery)
  if (!cleanQuery) {
    return SAN_MIGUEL_ZONES
  }
  const tokens = cleanQuery.split(/\s+/).filter(Boolean)
  const matches = normalizedSanMiguelZones
    .filter((entry) => tokens.every((tok) => entry.normalized.includes(tok)))
    .map((entry) => entry.label)

  const currentSelection = selectedRiderZones.value[riderZeroIndex]
  if (currentSelection && !matches.includes(currentSelection)) {
    return [currentSelection, ...matches]
  }
  return matches
}

function getZoneMatchCountForRider(riderZeroIndex) {
  const rawQuery = riderZoneSearchQueries.value[riderZeroIndex] || ''
  const cleanQuery = normalizeZoneSearchText(rawQuery)
  if (!cleanQuery) {
    return SAN_MIGUEL_ZONES.length
  }
  const tokens = cleanQuery.split(/\s+/).filter(Boolean)
  return normalizedSanMiguelZones.filter((entry) =>
    tokens.every((tok) => entry.normalized.includes(tok))
  ).length
}

function getQuickMatchesForRider(riderZeroIndex) {
  const rawQuery = riderZoneSearchQueries.value[riderZeroIndex] || ''
  const cleanQuery = normalizeZoneSearchText(rawQuery)
  if (!cleanQuery) return []
  const tokens = cleanQuery.split(/\s+/).filter(Boolean)
  return normalizedSanMiguelZones
    .filter((entry) => tokens.every((tok) => entry.normalized.includes(tok)))
    .slice(0, 15)
    .map((entry) => entry.label)
}

function selectZoneForRider(riderZeroIndex, zoneLabel) {
  selectedRiderZones.value[riderZeroIndex] = zoneLabel
  riderZoneSearchQueries.value[riderZeroIndex] = ''
}

function clearSelectedZoneForRider(riderZeroIndex) {
  selectedRiderZones.value[riderZeroIndex] = ''
  riderZoneSearchQueries.value[riderZeroIndex] = ''
}

function handleZoneSearchEnter(riderZeroIndex) {
  const matches = getQuickMatchesForRider(riderZeroIndex)
  if (matches.length > 0) {
    selectZoneForRider(riderZeroIndex, matches[0])
  }
}

function clearZoneSearchForRider(riderZeroIndex) {
  riderZoneSearchQueries.value[riderZeroIndex] = ''
}

const riderRequestsUsage = reactive({
  daily_limit: 3,
  used_today: 0,
  remaining_today: 3,
})

function applyRiderRequestsUsage(usage) {
  if (!usage || typeof usage !== 'object') return
  if (usage.daily_limit !== undefined) {
    riderRequestsUsage.daily_limit = Number(usage.daily_limit) || 3
  }
  if (usage.used_today !== undefined) {
    riderRequestsUsage.used_today = Number(usage.used_today) || 0
  }
  if (usage.remaining_today !== undefined) {
    riderRequestsUsage.remaining_today = Math.max(0, Number(usage.remaining_today) || 0)
  } else {
    riderRequestsUsage.remaining_today = Math.max(
      0,
      riderRequestsUsage.daily_limit - riderRequestsUsage.used_today
    )
  }
}

const quickLimitReached = computed(() => riderRequestsUsage.remaining_today <= 0)

const activeRiderZones = computed(() => {
  const count = Math.min(Math.max(Number(selectedRiders.value) || 1, 1), 4)
  return selectedRiderZones.value.slice(0, count).map((z) => String(z || '').trim())
})

const areAllRiderZonesSelected = computed(() => {
  return activeRiderZones.value.every((z) => z.length > 0)
})

const quickRiderUrl = computed(() => {
  if (!quickResult.value) return ''
  const token = quickResult.value.public_token
  if (token) {
    const origin = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost'))
      ? window.location.origin
      : 'https://rodo-frontend-phi.vercel.app'
    return `${origin}/solicitud/${token}`
  }
  if (quickResult.value.request_url && !quickResult.value.request_url.includes('localhost')) {
    return quickResult.value.request_url
  }
  return ''
})

const quickWhatsappUrl = computed(() => {
  if (!quickResult.value || !quickRiderUrl.value) return ''
  const restaurantName = restaurant.value?.name || quickResult.value.restaurant?.name || 'Local'
  const code = restaurant.value?.code || quickResult.value.restaurant?.code || ''
  const folio = quickResult.value.folio || ''
  const count = quickResult.value.riders_count || 1
  const zonesList = Array.isArray(quickResult.value.zones) ? quickResult.value.zones : []
  const zonesBlock = zonesList.length
    ? `\n📍 *Zonas de destino por repartidor:*\n` +
      zonesList.map((z, i) => `   • *Repartidor ${i + 1}:* ${z}`).join('\n')
    : ''
  const note = quickResult.value.note ? `\n📝 *Nota:* ${quickResult.value.note}` : ''
  const codeBadge = code ? ` (#${code})` : ''

  const message = [
    `🛵 *RODO MOTO MANDADOS*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *Solicitud Urgente de Repartidores*`,
    ``,
    `🏪 *Local:* ${restaurantName}${codeBadge}`,
    `📋 *Folio:* ${folio}`,
    `🏍️ *Repartidores requeridos:* ${count}${zonesBlock}${note}`,
    ``,
    `📲 *Ver solicitud en tiempo real:*`,
    `👉 ${quickRiderUrl.value}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Favor de coordinar la salida de los repartidores._`,
  ].join('\n')

  return `https://api.whatsapp.com/send?phone=524151805038&text=${encodeURIComponent(message)}`
})

async function copyQuickRiderLink() {
  if (!quickRiderUrl.value) return
  try {
    await navigator.clipboard.writeText(quickRiderUrl.value)
    quickCopySuccess.value = true
    showToast('¡Enlace de solicitud copiado!', 'success')
    setTimeout(() => {
      quickCopySuccess.value = false
    }, 2500)
  } catch {
    const input = document.createElement('input')
    input.value = quickRiderUrl.value
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    quickCopySuccess.value = true
    showToast('¡Enlace copiado!', 'success')
    setTimeout(() => {
      quickCopySuccess.value = false
    }, 2500)
  }
}

function resetQuickRequest() {
  quickResult.value = null
  quickNote.value = ''
  selectedRiders.value = 1
  selectedRiderZones.value = ['', '', '', '']
  riderZoneSearchQueries.value = ['', '', '', '']
  quickCopySuccess.value = false
  if (quickLimitReached.value) {
    showToast('Has alcanzado el límite de 3 solicitudes rápidas por hoy.', 'info')
  } else {
    showToast('Puedes realizar una nueva solicitud de repartidores.', 'info')
  }
}

async function submitQuickRequest() {
  if (!restaurant.value) {
    showToast('No hay una sesión activa de restaurante.', 'error')
    return
  }

  if (quickLimitReached.value) {
    showToast('Has alcanzado el límite máximo de 3 solicitudes de varios repartidores por hoy.', 'error')
    return
  }

  if (!areAllRiderZonesSelected.value) {
    showToast(
      `Selecciona la colonia o localidad de destino para cada uno de los ${selectedRiders.value} repartidor(es).`,
      'error'
    )
    return
  }

  quickLoading.value = true
  try {
    await initializeCsrf()
    const payload = {
      riders_count: selectedRiders.value,
      zones: activeRiderZones.value,
      note: quickNote.value.trim() ? quickNote.value.trim() : null,
    }
    const response = await api.post('/rider-requests', payload)
    const data = response.data?.data || {}
    quickResult.value = data
    if (data.usage) {
      applyRiderRequestsUsage(data.usage)
    } else {
      riderRequestsUsage.used_today += 1
      riderRequestsUsage.remaining_today = Math.max(
        0,
        riderRequestsUsage.daily_limit - riderRequestsUsage.used_today
      )
    }
    showToast(`¡Solicitud enviada para ${selectedRiders.value} repartidor(es)!`, 'success')
  } catch (err) {
    if (err.response?.data?.data?.usage) {
      applyRiderRequestsUsage(err.response.data.data.usage)
    }
    const msg = err.response?.data?.message || 'No se pudo enviar la solicitud de repartidores.'
    showToast(msg, 'error')
  } finally {
    quickLoading.value = false
  }
}

// Regla de negocio: mostrar KPIs diarios solo si el Admin lo autorizó con el checkbox
const canViewDailyKpis = computed(() => Boolean(restaurant.value?.show_daily_kpis))

const headerBannerStyle = computed(() => {
  if (!appBranding.banner_image_url) return {}
  return {
    backgroundImage: `linear-gradient(135deg, rgba(15, 23, 42, 0.62) 0%, rgba(185, 28, 28, 0.58) 100%), url("${appBranding.banner_image_url}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
})

// Carga inicial de datos de sesión y pedidos del día
async function fetchDailyOrders(silent = false) {
  if (!restaurant.value) return
  if (!silent) {
    dailyLoading.value = true
  }
  try {
    const response = await api.get('/orders', {
      params: { _t: Date.now() },
    })
    const payload = response.data?.data || {}
    const list = Array.isArray(payload.orders)
      ? payload.orders
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : []

    dailyOrders.value = list
    dailyDate.value = payload.date || new Date().toLocaleDateString('es-MX')

    if (payload.show_daily_kpis !== undefined && restaurant.value) {
      restaurant.value.show_daily_kpis = Boolean(payload.show_daily_kpis)
    } else if (payload.restaurant?.show_daily_kpis !== undefined && restaurant.value) {
      restaurant.value.show_daily_kpis = Boolean(payload.restaurant.show_daily_kpis)
    }

    if (payload.rider_requests_usage) {
      applyRiderRequestsUsage(payload.rider_requests_usage)
    }

    if (payload.summary) {
      Object.assign(dailySummary, payload.summary)
    } else {
      const completed = list.filter((o) => isOrderCompleted(o.status)).length
      dailySummary.total_orders = list.length
      dailySummary.completed_orders = completed
      dailySummary.pending_orders = Math.max(0, list.length - completed)
      dailySummary.total_delivery_fees = list.reduce((acc, o) => acc + Number(o.delivery_fee || 0), 0)
      dailySummary.total_amount_to_collect = list.reduce((acc, o) => acc + Number(o.amount_to_collect || 0), 0)
    }
  } catch (err) {
    console.warn('No se pudieron cargar los pedidos del día:', err)
  } finally {
    if (!silent) {
      dailyLoading.value = false
    }
  }
}

function isOrderCompleted(status) {
  return status === 'completed' || status === 'delivered'
}

function formatOrderTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

const todayFormattedLabel = computed(() => {
  try {
    return new Date().toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  } catch {
    return dailyDate.value || 'Hoy'
  }
})

const filteredDailyOrders = computed(() => {
  const query = historySearch.value.trim().toLowerCase()
  return dailyOrders.value.filter((order) => {
    if (historyStatusFilter.value === 'completed' && !isOrderCompleted(order.status)) {
      return false
    }
    if (historyStatusFilter.value === 'pending' && isOrderCompleted(order.status)) {
      return false
    }
    if (!query) return true
    const haystack = [
      order.folio,
      order.customer_name,
      order.customer_phone,
      order.street,
      order.neighborhood,
      order.address_reference,
      order.payment_method,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
})

function getOrderTicketUrl(order) {
  if (!order) return ''
  if (order.ticket_url && !order.ticket_url.includes('localhost')) {
    return order.ticket_url
  }
  if (order.public_token) {
    const origin =
      typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost')
        ? window.location.origin
        : 'https://rodo-frontend-phi.vercel.app'
    return `${origin}/ticket/${order.public_token}`
  }
  return ''
}

// Generar enlace de WhatsApp al Admin (415 101 9920) con todos los datos de un pedido específico
function buildOrderAssistanceUrl(order) {
  if (!order) return assistanceWhatsappUrl.value
  const restName = restaurant.value?.name || order.restaurant?.name || 'Restaurante'
  const restCode = restaurant.value?.code || order.restaurant?.code || ''
  const folio = order.folio || 'S/F'
  const timeStr = formatOrderTime(order.created_at) || 'Hoy'
  const statusStr = isOrderCompleted(order.status) ? 'Completado' : 'Pendiente / En curso'
  const customer = order.customer_name || 'Cliente sin nombre'
  const phone = order.customer_phone || 'Sin teléfono'
  const address = [order.street, order.neighborhood ? `Col. ${order.neighborhood}` : '']
    .filter(Boolean)
    .join(', ')
  const refLine = order.address_reference ? `\n*Referencia:* ${order.address_reference}` : ''
  const feeStr = `$${Number(order.delivery_fee || 0).toFixed(2)} MXN (${Number(order.distance_km || 0).toFixed(1)} km)`
  const paymentStr = order.payment_method || 'No especificado'
  const collectStr =
    order.amount_to_collect !== null && order.amount_to_collect !== undefined && Number(order.amount_to_collect) > 0
      ? ` (Cobrar $${Number(order.amount_to_collect).toFixed(2)} MXN)`
      : ''
  const tUrl = getOrderTicketUrl(order)
  const ticketLine = tUrl ? `\n*Ticket Digital:* ${tUrl}` : ''

  const lines = [
    `*ASISTENCIA RODO - REPORTE DE PEDIDO*`,
    `--------------------------------`,
    `*Local:* ${restName}${restCode ? ` (#${restCode})` : ''}`,
    `*Folio:* ${folio}`,
    `*Hora de registro:* ${timeStr}`,
    `*Estatus actual:* ${statusStr}`,
    `*Cliente:* ${customer} (Tel: ${phone})`,
    `*Destino:* ${address || 'No especificado'}${refLine}`,
    `*Tarifa de envio:* ${feeStr}`,
    `*Pago:* ${paymentStr}${collectStr}${ticketLine}`,
    `--------------------------------`,
    `Hola soporte RODO, solicito asistencia con este pedido por el siguiente inconveniente: `,
  ]

  return `https://api.whatsapp.com/send?phone=524151019920&text=${encodeURIComponent(lines.join('\n'))}`
}

function buildOrderShareWhatsappUrl(order) {
  if (!order) return ''
  const restName = restaurant.value?.name || order.restaurant?.name || 'Restaurante'
  const restCode = restaurant.value?.code || order.restaurant?.code || ''
  const folio = order.folio || ''
  const fee = order.delivery_fee ? `$${Number(order.delivery_fee).toFixed(2)} MXN` : ''
  const neighborhood = order.neighborhood || ''
  const paymentMethod = order.payment_method || ''
  const toCollect =
    order.amount_to_collect !== null && order.amount_to_collect !== undefined && Number(order.amount_to_collect) > 0
      ? `$${Number(order.amount_to_collect).toFixed(2)}`
      : null
  const tUrl = getOrderTicketUrl(order)

  let paymentLine = ''
  if (paymentMethod) {
    paymentLine = `\n*Pago:* ${paymentMethod}`
    if (toCollect) {
      paymentLine += ` (Cobrar ${toCollect})`
    }
  }

  const message = [
    `*RODO MOTO MANDADOS*`,
    `--------------------------------`,
    `*Pedido Registrado*`,
    ``,
    `*Local:* ${restName}${restCode ? ` (#${restCode})` : ''}`,
    `*Folio:* ${folio}`,
    fee ? `*Tarifa de envio:* ${fee}` : null,
    paymentLine ? paymentLine.trim() : null,
    neighborhood ? `*Zona de entrega:* ${neighborhood}` : null,
    ``,
    `*Ver Ticket Digital y Mapa:*`,
    tUrl,
  ]
    .filter((item) => item !== null)
    .join('\n')

  return `https://api.whatsapp.com/send?phone=524151805038&text=${encodeURIComponent(message)}`
}

function switchPortalTab(tab) {
  activePortalTab.value = tab
  if (tab === 'history') {
    fetchDailyOrders(false)
  }
}

function handlePortalFocus() {
  if (restaurant.value) {
    fetchDailyOrders(true)
  }
}

onMounted(async () => {
  fetchAppBranding()
  try {
    const response = await api.get('/restaurant/me')
    restaurant.value = response.data.data
    if (restaurant.value?.branding) {
      applyBrandingState(restaurant.value.branding)
    }
    if (restaurant.value?.rider_requests_usage) {
      applyRiderRequestsUsage(restaurant.value.rider_requests_usage)
    }
    if (restaurant.value?.code) {
      localStorage.setItem('rodo_restaurant_code', restaurant.value.code)
    }
  } catch {
    // Intento de auto-recuperación si existen datos de registro o código previo
    const saved = localStorage.getItem('rodo_restaurant') || sessionStorage.getItem('rodo_registration_result')
    const savedCode = localStorage.getItem('rodo_restaurant_code') || sessionStorage.getItem('rodo_restaurant_code')
    let identifier = savedCode
    if (!identifier && saved) {
      try {
        const parsed = JSON.parse(saved)
        identifier = parsed?.code || parsed?.name
      } catch {
        // ignore JSON parse error
      }
    }

    if (identifier) {
      try {
        const recoveryRes = await api.post('/restaurant/login', { identifier })
        restaurant.value = recoveryRes.data.data
        if (recoveryRes.data.data.token) {
          localStorage.setItem('rodo_token', recoveryRes.data.data.token)
          sessionStorage.setItem('rodo_token', recoveryRes.data.data.token)
        }
        if (recoveryRes.data.data.code) {
          localStorage.setItem('rodo_restaurant_code', recoveryRes.data.data.code)
        }
      } catch (recoveryErr) {
        console.warn('Auto-recuperación de sesión fallida:', recoveryErr)
      }
    }

    if (!restaurant.value) {
      error.value = 'No hay una sesión válida. Inicia sesión con el código de tu restaurante.'
    }
  }

  if (restaurant.value) {
    syncRestaurantOriginToMap()
    await fetchDailyOrders(false)
  }

  window.addEventListener('focus', handlePortalFocus)
  dailyPollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && restaurant.value) {
      fetchDailyOrders(true)
    }
  }, 20000)
})

onUnmounted(() => {
  window.removeEventListener('focus', handlePortalFocus)
  if (dailyPollTimer) {
    clearInterval(dailyPollTimer)
  }
})

// Regresar a la pantalla de login principal
function goBackToLogin() {
  router.push('/registro')
}

// Envío del pedido a Laravel
async function submitOrder() {
  error.value = ''
  result.value = null

  if (!restaurant.value) {
    error.value = 'Debes iniciar sesión como restaurante.'
    return
  }

  if (!hasFixedFee.value) {
    if (autoDistanceLoading.value) {
      error.value = 'Espera unos segundos a que termine el cálculo de la ruta en el mapa.'
      showToast(error.value, 'info')
      return
    }

    // Si hay coordenadas de origen y destino pero aún no se ha calculado la ruta, calcularla antes de enviar
    if (
      mapOrigin.value &&
      mapDestination.value &&
      (form.distance_km === '' || form.distance_km === null || Number(form.distance_km) === 0)
    ) {
      await calculateInteractiveMapRoute(true)
    }

    // Si aún no hay distancia pero sí tiene ubicación en BD
    if (
      hasRegisteredLocation.value &&
      (form.distance_km === '' || form.distance_km === null || Number(form.distance_km) === 0)
    ) {
      await autoCalculateRouteDistance(false)
    }
  }

  const km =
    form.distance_km === '' || form.distance_km === null
      ? hasFixedFee.value
        ? 0
        : NaN
      : Number(form.distance_km)

  if (!hasFixedFee.value && (!Number.isFinite(km) || km < 0 || km > 5)) {
    error.value = 'Por favor ingresa o calcula una distancia válida por calles de hasta 5 km.'
    showToast(error.value, 'error')
    return
  }

  // Resolver cambio requerido
  let resolvedChange = null
  if (form.needs_change) {
    if (form.change_option === 'Otro') {
      resolvedChange = form.change_other.trim() || 'Importe a especificar'
    } else if (form.change_option) {
      resolvedChange = form.change_option
    } else {
      error.value = 'Por favor indica con qué billete o importe pagará el cliente para su cambio.'
      showToast(error.value, 'error')
      return
    }
  }

  // Resolver indicaciones de cuidado
  const finalCare = [...form.care_instructions]
  if (form.care_other && form.care_other.trim()) {
    finalCare.push(form.care_other.trim())
  }

  loading.value = true

  try {
    await initializeCsrf()

    const payload = {
      customer_name: form.customer_name ? form.customer_name.trim() : null,
      customer_phone: form.customer_phone ? form.customer_phone.trim() : '',
      street: form.street ? form.street.trim() : '',
      neighborhood: form.neighborhood ? form.neighborhood.trim() : '',
      address_reference: form.address_reference ? form.address_reference.trim() : null,
      map_url: form.map_url ? form.map_url.trim() : null,
      distance_km: km,
      payment_method: form.payment_method || null,
      amount_to_collect:
        form.amount_to_collect === null || form.amount_to_collect === ''
          ? null
          : Number(form.amount_to_collect),
      needs_change: form.needs_change,
      change_from: resolvedChange,
      description: form.description ? form.description.trim() : null,
      comments: form.comments ? form.comments.trim() : null,
      is_ready: form.is_ready,
      care_instructions: finalCare,
      origin_address: effectiveOriginAddressLabel.value || null,
      destination_address: effectiveDestinationAddressLabel.value || null,
      origin_lat: mapOrigin.value ? Number(mapOrigin.value.lat) : null,
      origin_lng: mapOrigin.value ? Number(mapOrigin.value.lng) : null,
      destination_lat: mapDestination.value ? Number(mapDestination.value.lat) : null,
      destination_lng: mapDestination.value ? Number(mapDestination.value.lng) : null,
      duration_minutes: routeDurationMinutes.value !== null ? Number(routeDurationMinutes.value) : null,
    }

    const response = await api.post('/orders', payload)
    result.value = response.data.data
    showToast('¡Pedido registrado correctamente!', 'success')
    fetchDailyOrders(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (err) {
    if (err.response?.status === 422) {
      const errors = err.response.data?.errors || {}
      error.value = Object.values(errors).flat().join(' ') || 'Verifica los campos obligatorios del formulario.'
    } else if (err.response?.status === 401) {
      error.value = 'Tu sesión expiró. Debes volver a identificarte.'
    } else {
      error.value = err.response?.data?.message || 'No se pudo registrar el pedido en el servidor.'
    }
    showToast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

// Limpiar formulario y conservar sesión
function resetOrderForm() {
  form.customer_name = ''
  form.customer_phone = ''
  form.street = ''
  form.neighborhood = ''
  form.address_reference = ''
  form.map_url = ''
  form.distance_km = ''
  form.payment_method = ''
  form.amount_to_collect = null
  form.needs_change = false
  form.change_option = ''
  form.change_other = ''
  form.description = ''
  form.comments = ''
  form.is_ready = false
  form.care_instructions = []
  form.care_other = ''

  clearTicketPhoto()
  showNeighborhoodSuggestions.value = false
  activeNeighborhoodIndex.value = -1
  mapDestination.value = null
  routeGeometry.value = null
  routeDurationMinutes.value = null
  routeError.value = ''
  destinationSearchQuery.value = ''
  syncRestaurantOriginToMap()
  autoDistanceStatus.value = ''
  autoDistanceSuccess.value = false
  result.value = null
  error.value = ''
  copySuccess.value = false
  showToast('Formulario listo para un nuevo pedido', 'info')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <div class="portal-layout">

    <!-- Encabezado con identidad RODO (soporta Banner e Icono personalizados desde Admin) -->
    <header
      class="portal-header"
      :class="{ 'has-custom-banner': Boolean(appBranding.banner_image_url) }"
      :style="headerBannerStyle"
    >
      <div class="header-inner">
        <div class="brand-group">
          <button
            type="button"
            class="btn-header-back"
            title="Volver al inicio de sesión principal"
            @click="goBackToLogin"
          >
            ← Salir
          </button>
          <div class="logo-box" :class="{ 'has-custom-logo': Boolean(appBranding.logo_image_url) }">
            <img
              v-if="appBranding.logo_image_url"
              :src="appBranding.logo_image_url"
              alt="Logo RODO"
              class="portal-logo-img"
            />
            <span v-else>RODO</span>
          </div>
          <div class="brand-text">
            <h1>RODO Moto Mandados</h1>
            <p v-if="restaurant">{{ restaurant.name }} · #{{ restaurant.code }}</p>
            <p v-else>Portal de locales</p>
          </div>
        </div>

        <div class="header-right-actions">
          <a
            :href="assistanceWhatsappUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-assistance-header"
            title="Contactar a Asistencia RODO por WhatsApp (415 101 9920)"
          >
            <span>🎧</span>
            <span>Asistencia</span>
          </a>
        </div>
      </div>
    </header>

    <main class="portal-main">

      <!-- Barra de navegación grande y clara entre Solicitar Entrega y Mis Pedidos de Hoy -->
      <div v-if="restaurant" class="portal-tabs-bar">
        <button
          type="button"
          :class="['portal-tab-btn', { active: activePortalTab === 'form' }]"
          @click="switchPortalTab('form')"
        >
          <span>🛵</span>
          <span>Pedir Repartidor</span>
        </button>

        <button
          type="button"
          :class="['portal-tab-btn', { active: activePortalTab === 'history' }]"
          @click="switchPortalTab('history')"
        >
          <span>📋</span>
          <span>Mis Pedidos de Hoy</span>
          <span class="portal-tab-badge">{{ dailySummary.total_orders }}</span>
        </button>
      </div>

      <!-- ===================================================== -->
      <!-- PESTAÑA 2: HISTORIAL INDIVIDUAL DE PEDIDOS DEL DÍA    -->
      <!-- ===================================================== -->
      <section v-if="restaurant && activePortalTab === 'history'" class="daily-history-section">

        <!-- Encabezado compacto del día -->
        <div class="daily-notice-banner">
          <div class="daily-notice-left">
            <span class="daily-notice-icon">📅</span>
            <div>
              <strong>Pedidos de hoy ({{ todayFormattedLabel }})</strong>
              <p>Exclusivo de {{ restaurant.name }} (#{{ restaurant.code }}). Se reinicia cada día a las 00:00 hrs.</p>
            </div>
          </div>
          <button
            type="button"
            class="btn-refresh-daily"
            :disabled="dailyLoading"
            @click="fetchDailyOrders(false)"
          >
            {{ dailyLoading ? '⏳ Actualizando...' : '🔄 Actualizar' }}
          </button>
        </div>

        <!-- KPIs del día del restaurante (Solo visibles si el Admin lo autorizó con el checkbox) -->
        <div v-if="canViewDailyKpis" class="daily-kpis-grid">
          <div class="daily-kpi-card">
            <span class="daily-kpi-label">PEDIDOS DE HOY</span>
            <strong class="daily-kpi-value">{{ dailySummary.total_orders }}</strong>
            <small class="daily-kpi-sub">
              ✅ {{ dailySummary.completed_orders }} completados · ⏳ {{ dailySummary.pending_orders }} pendientes
            </small>
          </div>

          <div class="daily-kpi-card">
            <span class="daily-kpi-label">TOTAL TARIFAS DE ENVÍO HOY</span>
            <strong class="daily-kpi-value text-red">${{ Number(dailySummary.total_delivery_fees || 0).toFixed(2) }} <small>MXN</small></strong>
            <small class="daily-kpi-sub">Tarifas de reparto acumuladas hoy</small>
          </div>

          <div class="daily-kpi-card">
            <span class="daily-kpi-label">MONTO EN COBROS A CLIENTES HOY</span>
            <strong class="daily-kpi-value text-emerald">${{ Number(dailySummary.total_amount_to_collect || 0).toFixed(2) }} <small>MXN</small></strong>
            <small class="daily-kpi-sub">Efectivo / contraentrega registrado hoy</small>
          </div>
        </div>

        <!-- Controles de búsqueda y filtro de estatus -->
        <div class="daily-filters-bar">
          <div class="daily-search-wrap">
            <span>🔍</span>
            <input
              v-model="historySearch"
              type="text"
              placeholder="Buscar pedido de hoy por folio, cliente, teléfono o colonia..."
            />
          </div>

          <div class="daily-status-pills">
            <button
              type="button"
              :class="['daily-pill-btn', { active: historyStatusFilter === 'all' }]"
              @click="historyStatusFilter = 'all'"
            >
              Todos ({{ dailySummary.total_orders }})
            </button>
            <button
              type="button"
              :class="['daily-pill-btn', { active: historyStatusFilter === 'pending' }]"
              @click="historyStatusFilter = 'pending'"
            >
              ⏳ Pendientes ({{ dailySummary.pending_orders }})
            </button>
            <button
              type="button"
              :class="['daily-pill-btn', { active: historyStatusFilter === 'completed' }]"
              @click="historyStatusFilter = 'completed'"
            >
              ✅ Completados ({{ dailySummary.completed_orders }})
            </button>
          </div>
        </div>

        <!-- Estado de carga -->
        <div v-if="dailyLoading && !dailyOrders.length" class="card daily-empty-card">
          <p>⏳ Cargando tus pedidos registrados el día de hoy...</p>
        </div>

        <!-- Lista de tarjetas de pedidos del día -->
        <div v-else-if="filteredDailyOrders.length" class="daily-orders-list">
          <article
            v-for="order in filteredDailyOrders"
            :key="order.id"
            :class="['daily-order-card', { 'order-completed': isOrderCompleted(order.status) }]"
          >
            <div class="daily-order-header">
              <div class="daily-order-id-group">
                <span class="daily-folio-badge">{{ order.folio }}</span>
                <span class="daily-time-badge">🕒 {{ formatOrderTime(order.created_at) }}</span>
                <span
                  :class="[
                    'daily-status-badge',
                    isOrderCompleted(order.status) ? 'status-done' : 'status-pending',
                  ]"
                >
                  {{ isOrderCompleted(order.status) ? '✅ Completado' : '⏳ Pendiente' }}
                </span>
              </div>

              <div class="daily-order-fee-box">
                <span class="fee-lbl">Tarifa de envío:</span>
                <strong class="fee-val">${{ Number(order.delivery_fee || 0).toFixed(2) }} MXN</strong>
                <small class="fee-km">({{ Number(order.distance_km || 0).toFixed(1) }} km)</small>
              </div>
            </div>

            <div class="daily-order-body">
              <div class="daily-info-col">
                <div class="daily-info-row">
                  <span class="info-icon">👤</span>
                  <div>
                    <strong>{{ order.customer_name || 'Cliente sin nombre especificado' }}</strong>
                    <span v-if="order.customer_phone" class="info-phone">
                      · 📞 {{ order.customer_phone }}
                    </span>
                  </div>
                </div>

                <div class="daily-info-row">
                  <span class="info-icon">📍</span>
                  <div>
                    <strong>{{ order.street }}</strong>, Col. <strong>{{ order.neighborhood }}</strong>
                    <p v-if="order.address_reference" class="info-ref">
                      Ref: {{ order.address_reference }}
                    </p>
                  </div>
                </div>
              </div>

              <div class="daily-info-col">
                <div class="daily-info-row">
                  <span class="info-icon">💳</span>
                  <div>
                    <strong>{{ order.payment_method || 'Método de pago no especificado' }}</strong>
                    <span
                      v-if="order.amount_to_collect !== null && Number(order.amount_to_collect) > 0"
                      class="collect-badge"
                    >
                      Cobrar ${{ Number(order.amount_to_collect).toFixed(2) }} MXN
                    </span>
                    <p v-if="order.needs_change && order.change_from" class="info-ref">
                      💵 Requiere cambio de: <strong>{{ order.change_from }}</strong>
                    </p>
                  </div>
                </div>

                <div v-if="order.description || order.comments" class="daily-info-row">
                  <span class="info-icon">📦</span>
                  <div class="info-notes">
                    <span v-if="order.description">{{ order.description }}</span>
                    <span v-if="order.comments"> · Nota: {{ order.comments }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Botonera de acciones por pedido (Incluye Asistencia específica del pedido al 415 101 9920) -->
            <div class="daily-order-footer">
              <a
                :href="buildOrderAssistanceUrl(order)"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-order-action btn-order-assistance"
                title="Reportar inconveniente de este pedido por WhatsApp al Administrador (415 101 9920)"
              >
                <span>🎧</span>
                <span>Asistencia con este pedido</span>
              </a>

              <div class="daily-secondary-actions">
                <router-link
                  v-if="order.public_token"
                  :to="`/ticket/${order.public_token}`"
                  target="_blank"
                  class="btn-order-action btn-order-ticket"
                >
                  👁️ Ver Ticket Digital
                </router-link>

                <a
                  :href="buildOrderShareWhatsappUrl(order)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-order-action btn-order-whatsapp"
                >
                  📲 Reenviar por WhatsApp
                </a>
              </div>
            </div>
          </article>
        </div>

        <!-- Estado vacío -->
        <div v-else class="card daily-empty-card">
          <div style="font-size: 42px; margin-bottom: 10px;">🛵</div>
          <h3>Aún no tienes pedidos registrados hoy</h3>
          <p>
            Los pedidos que registres durante el día desde <strong>{{ restaurant.name }}</strong> aparecerán aquí para que puedas darles seguimiento o solicitar asistencia inmediata.
          </p>
          <button
            type="button"
            class="btn-go-create-order"
            @click="switchPortalTab('form')"
          >
            ➕ Registrar un pedido ahora
          </button>
        </div>
      </section>

      <!-- Pantalla de confirmación y Ticket Digital (Fase 3.4) -->
      <section v-if="result && activePortalTab === 'form'" class="card result-card">
        <div class="result-header">
          <div class="result-check-badge">✓</div>
          <div>
            <h3>Pedido registrado correctamente</h3>
            <p class="result-sub">Tu entrega ya está registrada y lista para ser coordinada con los repartidores.</p>
          </div>
        </div>

        <div class="result-summary-grid">
          <div class="summary-box">
            <span class="box-label">FOLIO DEL PEDIDO</span>
            <strong class="box-value folio-mono">{{ result.folio }}</strong>
          </div>
          <div class="summary-box">
            <span class="box-label">ESTADO ACTUAL</span>
            <span class="badge-status">{{ result.status || 'pending' }}</span>
          </div>
          <div class="summary-box">
            <span class="box-label">TARIFA DE ENTREGA</span>
            <strong class="box-value fee-highlight">${{ Number(result.delivery_fee).toFixed(2) }} MXN</strong>
          </div>
        </div>

        <div class="result-action-buttons">
          <router-link
            v-if="result.public_token"
            :to="'/ticket/' + result.public_token"
            target="_blank"
            class="action-btn btn-view-ticket"
          >
            👁️ Ver ticket digital
          </router-link>

          <button
            type="button"
            class="action-btn btn-copy"
            @click="copyTicketLink"
          >
            {{ copySuccess ? '✓ ¡Enlace copiado!' : '🔗 Copiar enlace' }}
          </button>

          <a
            v-if="whatsappUrl"
            :href="whatsappUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="action-btn btn-whatsapp"
          >
            📲 Compartir por WhatsApp
          </a>

          <a
            :href="assistanceWhatsappUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="action-btn btn-assistance-inline"
          >
            🎧 Asistencia
          </a>

          <button
            type="button"
            class="action-btn btn-view-ticket"
            @click="switchPortalTab('history')"
          >
            📋 Ver en Mis Pedidos de Hoy ({{ dailySummary.total_orders }})
          </button>

          <button
            type="button"
            class="action-btn btn-reset"
            @click="resetOrderForm"
          >
            ➕ Registrar otro pedido
          </button>
        </div>
      </section>

      <!-- Mensaje de error general -->
      <div v-if="error" class="alert-box alert-error" role="alert">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span>{{ error }}</span>
          <router-link
            v-if="!restaurant"
            to="/registro"
            class="action-btn"
            style="background: #d71920; color: #fff; text-decoration: none; padding: 6px 14px; border-radius: 8px; font-weight: 600; font-size: 0.85rem;"
          >
            🔑 Iniciar sesión
          </router-link>
        </div>
      </div>

      <!-- Tarjeta cuando no hay sesión activa identificada -->
      <div v-if="!restaurant && !result" class="card" style="text-align: center; padding: 48px 24px; margin-top: 16px;">
        <div style="font-size: 48px; margin-bottom: 12px;">🏪</div>
        <h3 style="font-size: 1.35rem; margin-bottom: 8px; color: #1e293b; font-weight: 800;">Identificación requerida</h3>
        <p style="color: #64748b; max-width: 480px; margin: 0 auto 24px; font-size: 0.95rem; line-height: 1.5;">
          Para poder registrar pedidos y solicitar repartidores, ingresa con el código de 3 dígitos o nombre de tu establecimiento autorizado.
        </p>
        <router-link
          to="/registro"
          style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #d71920, #b9151b); color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 700; box-shadow: 0 4px 12px rgba(215, 25, 32, 0.3);"
        >
          ← Ir al login principal
        </router-link>
      </div>

      <!-- Formulario principal de pedido (Limpio, claro y accesible) -->
      <form v-if="restaurant && !result && activePortalTab === 'form'" class="card form-card" @submit.prevent="submitOrder">

        <!-- Módulo compacto opcional de foto de ticket -->
        <div class="scan-box">
          <div class="scan-compact-bar">
            <div class="scan-title-inline">
              <span class="scan-icon-mini">📷</span>
              <div>
                <strong>Auto-llenar con foto de ticket</strong>
                <span class="scan-optional-tag">Opcional</span>
              </div>
            </div>

            <div class="scan-actions">
              <label class="btn-scan btn-scan-upload" :class="{ 'disabled': ocrLoading }">
                <input
                  ref="ticketFileInput"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  :disabled="ocrLoading"
                  @change="handleTicketUpload"
                >
                📸 {{ ocrLoading ? 'Leyendo...' : 'Tomar foto' }}
              </label>

              <label class="btn-scan btn-scan-gallery" :class="{ 'disabled': ocrLoading }">
                <input
                  ref="ticketGalleryInput"
                  type="file"
                  accept="image/*"
                  :disabled="ocrLoading"
                  @change="handleTicketUpload"
                >
                🖼️ Subir foto
              </label>

              <button
                type="button"
                class="btn-scan btn-scan-text"
                @click="showOcrTextEditor = !showOcrTextEditor"
              >
                📝 {{ showOcrTextEditor ? 'Cerrar texto' : 'Pegar texto' }}
              </button>

              <button
                v-if="imagePreview || ocrRawText"
                type="button"
                class="btn-scan btn-scan-clear"
                @click="clearTicketPhoto"
              >
                🗑️ Limpiar
              </button>
            </div>
          </div>

          <div v-if="imagePreview" class="preview-container">
            <img :src="imagePreview" alt="Vista previa del ticket" class="ticket-preview-img">
          </div>

          <div v-if="ocrDetectedFields.length" class="ocr-detected-chips">
            <span class="ocr-chips-label">Detectado:</span>
            <span
              v-for="field in ocrDetectedFields"
              :key="field"
              class="ocr-chip-badge"
            >
              ✓ {{ field }}
            </span>
          </div>

          <div v-if="showOcrTextEditor" class="ocr-text-editor">
            <textarea
              v-model="ocrRawText"
              rows="4"
              class="ocr-editor-textarea"
              placeholder="Pega aquí el mensaje de WhatsApp o texto del pedido..."
            />
            <div class="ocr-editor-actions">
              <button
                type="button"
                class="btn-scan btn-scan-apply-text"
                @click="reparseManualOcrText"
              >
                ✨ Llenar campos con este texto
              </button>
            </div>
          </div>

          <div v-if="ocrLoading || imagePreview || ocrDetectedFields.length" class="ocr-status-box" :class="{ 'ocr-busy': ocrLoading }">
            <span v-if="ocrLoading" class="mini-spinner" />
            <span>{{ ocrStatus }}</span>
          </div>
        </div>

        <!-- PASO 1: Datos del cliente y dirección -->
        <div class="step-block">
          <div class="step-header">
            <span class="step-num">1</span>
            <h3>¿A dónde llevamos el pedido?</h3>
          </div>

          <div class="fields-grid">
            <div class="field-group">
              <label for="customer_phone">📞 Teléfono del cliente <span class="req">*</span></label>
              <input
                id="customer_phone"
                v-model="form.customer_phone"
                type="tel"
                maxlength="25"
                required
                placeholder="Ej. 415 123 4567"
              >
            </div>

            <div class="field-group">
              <label for="customer_name">👤 Nombre del cliente (opcional)</label>
              <input
                id="customer_name"
                v-model="form.customer_name"
                type="text"
                maxlength="150"
                placeholder="Ej. María López"
              >
            </div>

            <div class="field-group">
              <label for="street">🏠 Calle y número <span class="req">*</span></label>
              <input
                id="street"
                v-model="form.street"
                type="text"
                maxlength="255"
                required
                placeholder="Ej. Calle Hidalgo #45"
              >
            </div>

            <div class="field-group neighborhood-search-wrapper" @focusout="handleNeighborhoodBlur">
              <label for="neighborhood">📍 Colonia o Fraccionamiento <span class="req">*</span></label>
              <div class="neighborhood-input-box">
                <input
                  id="neighborhood"
                  v-model="form.neighborhood"
                  type="text"
                  maxlength="150"
                  required
                  autocomplete="off"
                  placeholder="Ej. Centro, Aurora, Guadalupe..."
                  @focus="showNeighborhoodSuggestions = true"
                  @input="showNeighborhoodSuggestions = true"
                  @keydown="handleNeighborhoodKeydown"
                >
                <span
                  v-if="form.neighborhood"
                  class="btn-clear-neighborhood"
                  title="Limpiar colonia"
                  @mousedown.prevent="() => { form.neighborhood = ''; showNeighborhoodSuggestions = false }"
                >✕</span>
              </div>

              <!-- Lista desplegable en tiempo real de sugerencias de colonias -->
              <div
                v-if="showNeighborhoodSuggestions && neighborhoodSuggestions.length > 0"
                class="neighborhood-dropdown"
              >
                <div class="neighborhood-dropdown-header">
                  <span>📍 Colonias sugeridas de San Miguel de Allende ({{ neighborhoodSuggestions.length }})</span>
                </div>
                <ul class="neighborhood-list">
                  <li
                    v-for="(item, idx) in neighborhoodSuggestions"
                    :key="item.fullName"
                    class="neighborhood-item"
                    :class="{ 'is-active': idx === activeNeighborhoodIndex }"
                    @mousedown.prevent="selectNeighborhoodSuggestion(item)"
                  >
                    <span class="neighborhood-pin">📍</span>
                    <span class="neighborhood-name">{{ item.name }}</span>
                    <span v-if="item.type" class="neighborhood-type-badge">{{ item.type }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div class="field-group">
              <label for="address_reference">🧭 Referencias de la casa (opcional)</label>
              <input
                id="address_reference"
                v-model="form.address_reference"
                type="text"
                placeholder="Color de fachada, portón o entre qué calles"
              >
            </div>

            <div class="field-group">
              <label for="map_url">🗺️ Enlace de Google Maps (opcional)</label>
              <input
                id="map_url"
                v-model="form.map_url"
                type="text"
                placeholder="Pega el link de ubicación si el cliente lo envió"
              >
            </div>
          </div>
        </div>

        <!-- PASO 2: Distancia y Tarifa de Envío (tal cual como estaba antes y con km bloqueados) -->
        <div class="field-group full-width distance-calc-card" style="margin-bottom: 18px;">
          <div class="distance-card-header">
            <span class="distance-icon">{{ hasFixedFee ? '📌' : hasRegisteredLocation ? '🛰️' : '🛵' }}</span>
            <div>
              <label for="distance_km" class="distance-title">
                <template v-if="hasFixedFee">
                  Tarifa Fija Establecida para {{ restaurant.name }}
                </template>
                <template v-else-if="hasRegisteredLocation">
                  Distancia y Tarifa Automática 
                </template>
                <template v-else>
                  Distancia por calles desde la sucursal al cliente (km) *
                </template>
              </label>
              <p class="distance-sub">
                <template v-if="hasFixedFee">
                  Tu local cuenta con una tarifa fija preferencial de entrega establecida por el Administrador.
                </template>
                <template v-else-if="hasRegisteredLocation">
                  Se calcula automáticamente usando la ubicación de tu local en la base de datos y la dirección del pedido.
                </template>
                <template v-else>
                  Introduce los kilómetros de la ruta real para obtener la tarifa oficial al instante.
                </template>
              </p>
            </div>
          </div>

          <!-- Módulo de Mapa Interactivo, cálculo de ruta e input de km (SOLO SI NO TIENE TARIFA FIJA) -->
          <template v-if="!hasFixedFee">
            <!-- Estado del cálculo automático cuando el restaurante tiene ubicación en BD -->
            <div
              v-if="hasRegisteredLocation"
              class="auto-distance-banner"
              :class="{ 'is-loading': autoDistanceLoading, 'is-ok': autoDistanceSuccess }"
            >
              <span v-if="autoDistanceLoading" class="mini-spinner" />
              <span v-else>{{ autoDistanceSuccess ? '🔒' : '📍' }}</span>
              <span>
                {{
                  autoDistanceStatus ||
                  'Al ingresar la calle y colonia (o seleccionar el destino en el mapa interactivo), calcularemos los kilómetros automáticamente.'
                }}
              </span>
            </div>

            <!-- Módulo de Mapa Interactivo OpenStreetMap y Resumen de Ruta por Carretera -->
            <div class="open-map-routing-section">
              <!-- 1. Información de la ruta en la parte de ARRIBA del mapa -->
              <TripSummary
                :origin-address="effectiveOriginAddressLabel"
                :destination-address="effectiveDestinationAddressLabel"
                :distance-km="form.distance_km !== '' && form.distance_km !== null ? Number(form.distance_km) : null"
                :duration-minutes="routeDurationMinutes"
                :estimated-fee="calculatedFee.status === 'ok' ? calculatedFee.fee : null"
                :is-fixed-fee="hasFixedFee"
                :loading="autoDistanceLoading"
                :error="routeError"
              />

              <!-- 2. Mapa interactivo en medio -->
              <RouteMap
                :origin="mapOrigin"
                :destination="mapDestination"
                :route-geometry="routeGeometry"
                :origin-locked="hasRegisteredLocation"
                :loading="autoDistanceLoading"
                @update:origin="handleOriginSelected"
                @update:destination="handleDestinationSelected"
                @clear="handleClearMapPoints"
              />
            </div>

            <!-- Input de distancia (bloqueado automáticamente cuando el restaurante tiene ubicación registrada o distancia calculada) -->
            <div class="distance-input-row">
              <div class="input-with-km">
                <input
                  id="distance_km"
                  v-model.number="form.distance_km"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  required
                  :disabled="hasRegisteredLocation || autoDistanceSuccess || autoDistanceLoading"
                  :readonly="hasRegisteredLocation || autoDistanceSuccess || autoDistanceLoading"
                  :class="{ 'input-locked': hasRegisteredLocation || autoDistanceSuccess }"
                  :title="(hasRegisteredLocation || autoDistanceSuccess) ? 'Distancia calculada automáticamente. No se puede modificar.' : ''"
                  :placeholder="hasRegisteredLocation ? 'Se calcula automáticamente (Ej. 2.5)' : 'Ej. 2.5'"
                >
                <span class="km-unit-badge" :class="{ 'is-locked': hasRegisteredLocation || autoDistanceSuccess }">
                  {{ (hasRegisteredLocation || autoDistanceSuccess) ? '🔒 km' : 'km' }}
                </span>
              </div>
              <button
                type="button"
                class="btn-calc"
                :class="{ 'btn-calc-locked': autoDistanceSuccess }"
                :disabled="autoDistanceLoading || autoDistanceSuccess"
                @click="autoCalculateRouteDistance(true)"
              >
                <span>
                  {{
                    autoDistanceLoading
                      ? 'Calculando...'
                      : autoDistanceSuccess
                        ? '🔒 Tarifa bloqueada'
                        : hasRegisteredLocation
                          ? '🛰️ Calcular con ubicación'
                          : 'Calcular tarifa'
                  }}
                </span>
              </button>
            </div>
          </template>

          <!-- Resultado visual de la tarifa prominente -->
          <div
            class="price-result-box"
            :class="{
              'price-ok': calculatedFee.status === 'ok',
              'price-out': calculatedFee.status === 'out_of_coverage' || calculatedFee.status === 'invalid',
              'price-empty': calculatedFee.status === 'empty'
            }"
          >
            <!-- Caso 1: Tarifa Calculada OK (Fija o por Distancia) -->
            <div v-if="calculatedFee.status === 'ok'" class="price-box-content">
              <div class="price-meta">
                <div class="price-badge-header">
                  <span class="live-dot" />
                  <span>
                    {{ calculatedFee.isFixed ? 'TARIFA FIJA ESTABLECIDA EN SISTEMA' : 'TARIFA OFICIAL DE ENTREGA' }}
                  </span>
                </div>
                <div class="price-sub-meta">
                  <span v-if="calculatedFee.isFixed" class="price-distance-pill">
                    📌 Tarifa Fija Preferencial
                  </span>
                  <span
                    v-if="form.distance_km !== '' && form.distance_km !== null && Number(form.distance_km) > 0"
                    class="price-distance-pill"
                  >
                    📍 {{ Number(form.distance_km).toFixed(1) }} km de recorrido
                  </span>
                  <span class="price-local-pill">Sucursal: {{ restaurant.name }}</span>
                </div>
                <p class="price-rule-note">
                  <template v-if="calculatedFee.isFixed">
                    Configurada por el Administrador para todos los pedidos de tu establecimiento.
                  </template>
                  <template v-else>
                    Cálculo RODO: $40 base + $2 por km (máximo $50 hasta 5 km)
                  </template>
                </p>
              </div>

              <div class="price-amount-wrapper">
                <span class="price-currency-sign">$</span>
                <span class="price-number">{{ calculatedFee.fee.toFixed(2) }}</span>
                <span class="price-currency-code">MXN</span>
              </div>
            </div>

            <!-- Caso 2: Fuera de cobertura o inválido -->
            <div v-else-if="calculatedFee.status === 'out_of_coverage' || calculatedFee.status === 'invalid'" class="price-alert-content">
              <span class="alert-icon-big">⚠️</span>
              <div>
                <strong class="alert-title">Fuera de cobertura o distancia inválida</strong>
                <p class="alert-desc">{{ calculatedFee.message }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- PASO 3: Pago y Notas -->
        <div class="step-block">
          <div class="step-header">
            <span class="step-num">3</span>
            <h3>Pago y detalles del pedido</h3>
          </div>

          <div class="fields-grid">
            <div class="field-group">
              <label for="payment_method">💳 ¿Cómo paga el cliente?</label>
              <select id="payment_method" v-model="form.payment_method">
                <option value="">Seleccionar forma de pago...</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia">Transferencia</option>
                <option value="Tarjeta / pedido pagado">Ya está pagado / Tarjeta</option>
                <option value="Pago contra entrega">Pago contra entrega</option>
              </select>
            </div>

            <div class="field-group">
              <label for="amount_to_collect">💵 ¿Cuánto debe cobrar el repartidor?</label>
              <input
                id="amount_to_collect"
                v-model="form.amount_to_collect"
                type="number"
                min="0"
                step="0.01"
                placeholder="Ej. 350.00 (Dejar vacío si ya pagó)"
              >
            </div>

            <div class="field-group full-width change-section">
              <label class="checkbox-container">
                <input v-model="form.needs_change" type="checkbox">
                <span class="checkbox-label">El cliente necesita cambio de un billete</span>
              </label>

              <div v-if="form.needs_change" class="change-detail-box">
                <label for="change_option">¿Con qué billete paga? *</label>
                <select id="change_option" v-model="form.change_option" required>
                  <option value="">Seleccionar billete...</option>
                  <option value="100">$100</option>
                  <option value="200">$200</option>
                  <option value="500">$500</option>
                  <option value="1000">$1,000</option>
                  <option value="Otro">Otro monto</option>
                </select>

                <input
                  v-if="form.change_option === 'Otro'"
                  v-model="form.change_other"
                  type="text"
                  class="other-change-input"
                  placeholder="Escribe el monto (Ej. 300)"
                  required
                >
              </div>
            </div>

            <div class="field-group">
              <label for="description">🍔 ¿Qué lleva el pedido? (opcional)</label>
              <input
                id="description"
                v-model="form.description"
                type="text"
                placeholder="Ej. 2 pizzas grandes y 1 refresco"
              >
            </div>

            <div class="field-group">
              <label for="comments">📝 Nota para el repartidor (opcional)</label>
              <input
                id="comments"
                v-model="form.comments"
                type="text"
                placeholder="Ej. Tocar timbre negro, pedir código"
              >
            </div>
          </div>

          <!-- Cuidados rápidos en chips grandes -->
          <div class="care-compact-block">
            <span class="care-compact-title">⚠️ Cuidados especiales (toca los que apliquen):</span>
            <div class="care-options-grid">
              <label
                v-for="item in careList"
                :key="item.value"
                class="care-option-card"
                :class="{ 'care-selected': form.care_instructions.includes(item.value) }"
              >
                <input
                  v-model="form.care_instructions"
                  type="checkbox"
                  :value="item.value"
                >
                <span>{{ item.label }}</span>
              </label>
            </div>
          </div>

          <!-- Checkbox Pedido Listo -->
          <label class="checkbox-container ready-checkbox-box">
            <input v-model="form.is_ready" type="checkbox">
            <span class="checkbox-label font-bold">✅ El pedido ya está listo para recoger en mostrador</span>
          </label>
        </div>

        <!-- Botón grande de envío -->
        <button
          type="submit"
          class="btn-submit-order"
          :disabled="loading || autoDistanceLoading || calculatedFee.status === 'out_of_coverage' || calculatedFee.status === 'invalid'"
        >
          <span v-if="loading || autoDistanceLoading" class="mini-spinner mr-2" />
          {{
            loading
              ? 'Enviando pedido...'
              : autoDistanceLoading
                ? 'Calculando ruta en mapa...'
                : '🛵 Solicitar Repartidor Ahora'
          }}
        </button>

      </form>

      <!-- Card 2: Solicitar varios repartidores rápidamente (Sólo buscador escrito, sin menú desplegable) -->
      <section v-if="restaurant && !result && activePortalTab === 'form'" class="card quick-riders-card">

        <!-- Estado: Confirmación de Solicitud de Repartidores Enviada -->
        <div v-if="quickResult" class="quick-result-view">
          <div class="quick-result-header">
            <div class="quick-check-badge">⚡</div>
            <div>
              <h3>¡Solicitud de repartidores enviada!</h3>
              <p class="sub">Envía el ticket por WhatsApp al líder para coordinar las motos.</p>
            </div>
          </div>

          <div class="quick-summary-grid">
            <div class="summary-box">
              <span class="box-label">FOLIO</span>
              <strong class="box-value folio-mono">{{ quickResult.folio }}</strong>
            </div>
            <div class="summary-box">
              <span class="box-label">REPARTIDORES</span>
              <strong class="box-value riders-highlight">
                {{ quickResult.riders_count }} {{ quickResult.riders_count === 1 ? 'Repartidor' : 'Repartidores' }} 🛵
              </strong>
            </div>
            <div class="summary-box">
              <span class="box-label">USOS RESTANTES HOY</span>
              <span class="badge-status" :class="quickLimitReached ? 'status-limit-reached' : 'status-pending'">
                {{ riderRequestsUsage.remaining_today }} de {{ riderRequestsUsage.daily_limit }}
              </span>
            </div>
          </div>

          <div v-if="Array.isArray(quickResult.zones) && quickResult.zones.length" class="quick-zones-preview">
            <span class="quick-zones-title">📍 Colonias seleccionadas:</span>
            <ul class="quick-zones-list">
              <li v-for="(zoneName, zIdx) in quickResult.zones" :key="'res-zone-' + zIdx">
                <span class="zone-rider-tag">🛵 Repartidor {{ zIdx + 1 }}:</span>
                <strong>{{ zoneName }}</strong>
              </li>
            </ul>
          </div>

          <div v-if="quickResult.note" class="quick-note-preview">
            <strong>Nota:</strong> “{{ quickResult.note }}”
          </div>

          <div class="result-action-buttons">
            <a
              :href="quickWhatsappUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="action-btn btn-whatsapp"
            >
              <span>📲</span>
              <span>Enviar por WhatsApp al líder</span>
            </a>

            <router-link
              :to="'/solicitud/' + quickResult.public_token"
              target="_blank"
              class="action-btn btn-view-ticket"
            >
              <span>👁️</span>
              <span>Ver ticket de solicitud</span>
            </router-link>

            <button
              type="button"
              class="action-btn btn-copy"
              @click="copyQuickRiderLink"
            >
              <span>🔗</span>
              <span>{{ quickCopySuccess ? '¡Enlace copiado!' : 'Copiar enlace' }}</span>
            </button>

            <button
              type="button"
              class="action-btn btn-reset"
              @click="resetQuickRequest"
            >
              <span>➕</span>
              <span>{{ quickLimitReached ? 'Cerrar' : 'Nueva solicitud' }}</span>
            </button>
          </div>
        </div>

        <!-- Estado: Formulario limpio para pedir de 1 a 4 repartidores con buscador escrito -->
        <div v-else>
          <div class="quick-header-row">
            <div class="quick-header">
              <div class="lightning-icon">⚡</div>
              <div>
                <h3>Pedir varios repartidores a la vez</h3>
                <p class="sub">Elige cuántos repartidores necesitas y escribe la colonia de cada uno.</p>
              </div>
            </div>

            <div
              class="quick-usage-pill"
              :class="quickLimitReached ? 'usage-pill-exhausted' : 'usage-pill-ok'"
            >
              <span>⚡ Disponibles hoy:</span>
              <strong>{{ riderRequestsUsage.remaining_today }} de {{ riderRequestsUsage.daily_limit }}</strong>
            </div>
          </div>

          <div v-if="quickLimitReached" class="quick-limit-banner">
            <strong>🔒 Ya utilizaste tus {{ riderRequestsUsage.daily_limit }} solicitudes rápidas de hoy</strong>
            <p>Mañana tendrás nuevamente 3 usos disponibles. Puedes seguir pidiendo repartidores de uno por uno en el formulario de arriba.</p>
          </div>

          <!-- Botones grandes 1, 2, 3, 4 Repartidores -->
          <div class="rider-options-grid" :class="{ 'grid-disabled': quickLimitReached }">
            <button
              v-for="count in [1, 2, 3, 4]"
              :key="count"
              type="button"
              class="rider-btn"
              :class="{ 'active': selectedRiders === count }"
              :disabled="quickLimitReached"
              @click="selectedRiders = count"
            >
              <strong>{{ count }}</strong>
              <span>{{ count === 1 ? 'Repartidor' : 'Repartidores' }}</span>
            </button>
          </div>

          <!-- Buscador escrito por cada repartidor (Sin menú desplegable) -->
          <div class="rider-zones-section" :class="{ 'grid-disabled': quickLimitReached }">
            <div class="rider-zones-grid">
              <div
                v-for="idx in selectedRiders"
                :key="'rider-zone-search-' + idx"
                class="rider-zone-field"
                :class="{ 'zone-field-selected': Boolean(selectedRiderZones[idx - 1]) }"
              >
                <div class="rider-zone-item-label">
                  <span class="rider-badge-num">🛵 Repartidor {{ idx }}</span>
                  <span v-if="selectedRiderZones[idx - 1]" class="zone-selected-chip">✓ Listo</span>
                  <span v-else class="zone-pending-hint">Escribe y toca la colonia</span>
                </div>

                <!-- Si ya eligió colonia: mostrar tarjeta grande y clara con botón "Cambiar" -->
                <div v-if="selectedRiderZones[idx - 1]" class="zone-chosen-card">
                  <div class="zone-chosen-info">
                    <span class="zone-chosen-pin">📍</span>
                    <strong class="zone-chosen-name">{{ selectedRiderZones[idx - 1] }}</strong>
                  </div>
                  <button
                    type="button"
                    class="btn-change-zone"
                    :disabled="quickLimitReached || quickLoading"
                    @click="clearSelectedZoneForRider(idx - 1)"
                  >
                    Cambiar
                  </button>
                </div>

                <!-- Si aún no elige colonia: mostrar únicamente la barra de búsqueda escrita y resultados -->
                <template v-else>
                  <div class="zone-search-box">
                    <span class="zone-search-icon">🔍</span>
                    <input
                      :id="'rider_zone_search_' + idx"
                      v-model="riderZoneSearchQueries[idx - 1]"
                      type="text"
                      class="zone-search-input"
                      :disabled="quickLimitReached || quickLoading"
                      :placeholder="`Escribe la colonia del Repartidor ${idx} (ej. Centro, Aurora)...`"
                      autocomplete="off"
                      @keydown.enter.prevent="handleZoneSearchEnter(idx - 1)"
                    >
                    <button
                      v-if="riderZoneSearchQueries[idx - 1]"
                      type="button"
                      class="zone-search-clear"
                      title="Borrar texto"
                      @click="clearZoneSearchForRider(idx - 1)"
                    >
                      ✕
                    </button>
                  </div>

                  <!-- Resultados al escribir -->
                  <div
                    v-if="riderZoneSearchQueries[idx - 1] && getQuickMatchesForRider(idx - 1).length"
                    class="zone-quick-suggestions"
                  >
                    <button
                      v-for="sug in getQuickMatchesForRider(idx - 1)"
                      :key="'sug-' + idx + '-' + sug"
                      type="button"
                      class="zone-suggestion-btn"
                      @click="selectZoneForRider(idx - 1, sug)"
                    >
                      <span>📍 {{ sug }}</span>
                      <span class="sug-pick-tag">Elegir</span>
                    </button>
                  </div>
                  <div
                    v-else-if="riderZoneSearchQueries[idx - 1] && getZoneMatchCountForRider(idx - 1) === 0"
                    class="zone-no-matches"
                  >
                    No se encontró “{{ riderZoneSearchQueries[idx - 1] }}”. Intenta con otra palabra.
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div class="field-group" style="margin-top: 14px;">
            <label for="quick_note">📝 Nota adicional (opcional)</label>
            <input
              id="quick_note"
              v-model="quickNote"
              type="text"
              :disabled="quickLimitReached || quickLoading"
              placeholder="Ej. Pedidos listos en mostrador"
            >
          </div>

          <button
            type="button"
            class="btn-quick-request"
            :disabled="quickLoading || quickLimitReached || !areAllRiderZonesSelected"
            @click="submitQuickRequest"
          >
            <span v-if="quickLoading" class="mini-spinner mr-2" />
            <template v-if="quickLimitReached">
              Límite diario alcanzado (3 de 3 usados hoy)
            </template>
            <template v-else-if="quickLoading">
              Enviando solicitud...
            </template>
            <template v-else-if="!areAllRiderZonesSelected">
              Escribe y elige la colonia de {{ selectedRiders === 1 ? 'tu repartidor' : `los ${selectedRiders} repartidores` }}
            </template>
            <template v-else>
              ⚡ Solicitar {{ selectedRiders }} repartidor{{ selectedRiders > 1 ? 'es' : '' }} ahora
            </template>
          </button>
        </div>

      </section>

    </main>

    <!-- Footer -->
    <footer class="portal-footer">
      <p>© {{ new Date().getFullYear() }} RODO Moto Mandados · Portal oficial de locales</p>
    </footer>

    <!-- Toast flotante estilo RODO -->
    <div
      v-if="toastMessage"
      class="toast-notification"
      :class="'toast-' + toastType"
      role="status"
    >
      <span class="toast-icon">
        <template v-if="toastType === 'success'">✓</template>
        <template v-else-if="toastType === 'error'">✕</template>
        <template v-else>ℹ</template>
      </span>
      <span>{{ toastMessage }}</span>
    </div>

  </div>
</template>

<style scoped>
/* Contenedor general */
.portal-layout {
  min-height: 100vh;
  background: #f6f7f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #202124;
}

/* Header RODO */
.portal-header {
  background: linear-gradient(135deg, #d71920 0%, #ba1218 100%);
  color: #ffffff;
  padding: 16px 28px;
  box-shadow: 0 4px 18px rgba(215, 25, 32, 0.18);
  width: 100%;
  box-sizing: border-box;
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  width: 100%;
}

.brand-group {
  display: flex;
  align-items: center;
  gap: 14px;
}

.btn-header-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 13px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #ffffff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-header-back:hover {
  background: rgba(255, 255, 255, 0.28);
  transform: translateX(-1px);
}

.header-right-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-assistance-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  font-size: 13.5px;
  font-weight: 800;
  text-decoration: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-assistance-header:hover {
  background: #f8fafc;
  transform: translateY(-1px);
}

.logo-box {
  width: 54px;
  height: 48px;
  border: 2px solid #ffffff;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 900;
  font-size: 19px;
  letter-spacing: -0.5px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  flex-shrink: 0;
}

.logo-box.has-custom-logo {
  background: #ffffff;
  padding: 0;
}

.portal-logo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.brand-text h1 {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
  letter-spacing: 0.5px;
}

.brand-text p {
  font-size: 12px;
  margin: 3px 0 0;
  opacity: 0.92;
}

.header-restaurant-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  padding: 7px 14px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 13px;
  font-weight: 600;
}

.online-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px #4ade80;
}

.restaurant-code {
  background: #ffffff;
  color: #d71920;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 800;
}

/* Área principal */
.portal-main {
  max-width: 1200px;
  margin: 28px auto;
  padding: 0 28px 60px;
  width: 100%;
  box-sizing: border-box;
}

/* Selector de pestañas del portal del restaurante */
.portal-tabs-bar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  background: #e2e8f0;
  padding: 6px;
  border-radius: 14px;
  margin-bottom: 22px;
}

.portal-tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #475569;
  font-size: 14.5px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.18s ease;
}

.portal-tab-btn.active {
  background: #ffffff;
  color: #d71920;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
}

.portal-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: #d71920;
  color: #ffffff;
  font-size: 12px;
  font-weight: 900;
}

/* Historial Diario Individual del Restaurante */
.daily-history-section {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.daily-notice-banner {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-left: 5px solid #d71920;
  border-radius: 14px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.daily-notice-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  min-width: 240px;
}

.daily-notice-icon {
  font-size: 24px;
  line-height: 1;
}

.daily-notice-left strong {
  display: block;
  font-size: 15px;
  color: #0f172a;
  margin-bottom: 4px;
}

.daily-notice-left p {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.45;
}

.btn-refresh-daily {
  background: #0f172a;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.btn-refresh-daily:hover:not(:disabled) {
  background: #1e293b;
}

.daily-kpis-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.daily-kpi-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
}

.daily-kpi-label {
  font-size: 11px;
  font-weight: 800;
  color: #64748b;
  letter-spacing: 0.5px;
}

.daily-kpi-value {
  font-size: 26px;
  font-weight: 900;
  color: #0f172a;
}

.daily-kpi-value.text-red {
  color: #d71920;
}

.daily-kpi-value.text-emerald {
  color: #059669;
}

.daily-kpi-sub {
  font-size: 12px;
  color: #64748b;
}

.daily-filters-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 12px 16px;
}

.daily-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 240px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px 12px;
}

.daily-search-wrap input {
  border: none;
  background: transparent;
  width: 100%;
  font-size: 14px;
  color: #0f172a;
  outline: none;
}

.daily-status-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.daily-pill-btn {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #475569;
  border-radius: 999px;
  padding: 7px 13px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.daily-pill-btn.active {
  background: #d71920;
  border-color: #d71920;
  color: #ffffff;
}

.daily-orders-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.daily-order-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-left: 5px solid #f59e0b;
  border-radius: 16px;
  padding: 18px 20px;
  box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.daily-order-card.order-completed {
  border-left-color: #10b981;
}

.daily-order-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}

.daily-order-id-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.daily-folio-badge {
  background: #0f172a;
  color: #ffffff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 8px;
}

.daily-time-badge {
  font-size: 12.5px;
  font-weight: 700;
  color: #475569;
  background: #f1f5f9;
  padding: 4px 9px;
  border-radius: 8px;
}

.daily-status-badge {
  font-size: 12px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
}

.daily-status-badge.status-pending {
  background: #fef3c7;
  color: #92400e;
}

.daily-status-badge.status-done {
  background: #dcfce7;
  color: #166534;
}

.daily-order-fee-box {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.fee-lbl {
  font-size: 12px;
  color: #64748b;
}

.fee-val {
  font-size: 16px;
  font-weight: 900;
  color: #d71920;
}

.fee-km {
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
}

.daily-order-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
}

.daily-info-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.daily-info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13.5px;
  color: #1e293b;
  line-height: 1.45;
}

.info-icon {
  flex-shrink: 0;
}

.info-phone {
  color: #475569;
  font-weight: 600;
}

.info-ref {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: #64748b;
}

.collect-badge {
  display: inline-block;
  margin-left: 6px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
  font-size: 12px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 6px;
}

.info-notes {
  font-size: 12.5px;
  color: #475569;
}

.daily-order-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.daily-secondary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-order-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-order-assistance {
  background: #0f172a;
  color: #ffffff;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.15);
}

.btn-order-assistance:hover {
  background: #d71920;
  transform: translateY(-1px);
}

.btn-order-ticket {
  background: #f1f5f9;
  color: #1e293b;
  border: 1px solid #cbd5e1;
}

.btn-order-ticket:hover {
  background: #e2e8f0;
}

.btn-order-whatsapp {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.btn-order-whatsapp:hover {
  background: #bbf7d0;
}

.daily-empty-card {
  text-align: center;
  padding: 42px 24px;
}

.daily-empty-card h3 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #0f172a;
}

.daily-empty-card p {
  margin: 0 auto 20px;
  max-width: 460px;
  color: #64748b;
  font-size: 14px;
  line-height: 1.5;
}

.btn-go-create-order {
  background: #d71920;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

@media (max-width: 768px) {
  .portal-tabs-bar {
    grid-template-columns: 1fr;
  }

  .daily-kpis-grid {
    grid-template-columns: 1fr;
  }

  .daily-order-body {
    grid-template-columns: 1fr;
  }

  .daily-order-footer,
  .daily-secondary-actions {
    width: 100%;
  }

  .btn-order-assistance,
  .daily-secondary-actions .btn-order-action {
    flex: 1;
    width: 100%;
  }
}

.intro-section {
  margin-bottom: 22px;
}

.intro-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.btn-back-login {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #1e293b;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-back-login:hover {
  border-color: #d71920;
  color: #d71920;
  background: #fff5f5;
}

.intro-section h2 {
  font-size: 28px;
  font-weight: 800;
  color: #111827;
  margin: 0 0 6px;
}

.intro-section p {
  color: #64748b;
  font-size: 14.5px;
  line-height: 1.5;
  margin: 0;
}

/* Tarjetas */
.card {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: #ffffff;
  border: 1px solid #e4e5e9;
  border-radius: 18px;
  padding: 30px 36px;
  margin-bottom: 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
}

.section-heading h3 {
  font-size: 19px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 6px;
}

.sub {
  font-size: 13px;
  color: #64748b;
  line-height: 1.45;
  margin: 0 0 18px;
}

/* Banner de local activo */
.selected-local-banner {
  background: #fff5f5;
  border: 1px solid #efb5b8;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 22px;
}

.local-banner-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.local-banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-back-banner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #ffffff;
  color: #334155;
  border: 1px solid #efb5b8;
  font-size: 13px;
  font-weight: 700;
  padding: 9px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-back-banner:hover {
  background: #fff0f0;
  color: #d71920;
  border-color: #d71920;
}

.btn-assistance-top {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: #0f172a;
  color: #ffffff;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 800;
  padding: 9px 16px;
  border-radius: 10px;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.16);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-assistance-top:hover {
  background: #1e293b;
  transform: translateY(-1px);
}

.local-banner-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 14px;
  color: #202124;
}

.banner-badge {
  background: #d71920;
  color: #ffffff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 6px;
}

.badge-code {
  color: #d71920;
  font-weight: 700;
}

/* Caja de escaneo OCR compacta */
.scan-box {
  border: 1.5px dashed #e2e8f0;
  background: #f8fafc;
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 20px;
  transition: border-color 0.2s ease;
}

.scan-box:hover {
  border-color: #cbd5e1;
}

.scan-compact-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.scan-title-inline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 15px;
  color: #0f172a;
}

.scan-icon-mini {
  font-size: 20px;
  background: #fee2e2;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.scan-optional-tag {
  font-size: 11.5px;
  font-weight: 800;
  color: #64748b;
  background: #e2e8f0;
  padding: 2px 9px;
  border-radius: 999px;
}

.scan-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

/* Bloques numerados simples y legibles */
.step-block {
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px 22px;
  margin-bottom: 18px;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}

.step-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #d71920;
  color: #ffffff;
  font-size: 15px;
  font-weight: 900;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.step-header h4 {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  color: #0f172a;
}

.req {
  color: #d71920;
  font-weight: 900;
}

.care-compact-block {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
}

.care-compact-title {
  display: block;
  font-size: 14px;
  font-weight: 800;
  color: #1e293b;
  margin-bottom: 10px;
}

.btn-scan {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-scan-upload {
  background: #d71920;
  color: #ffffff;
}

.btn-scan-upload:hover:not(.disabled) {
  background: #ba1218;
}

.btn-scan-upload.disabled {
  opacity: 0.65;
  cursor: wait;
}

.btn-scan-upload input[type="file"],
.btn-scan-gallery input[type="file"] {
  display: none;
}

.btn-scan-gallery {
  background: #1e293b;
  color: #ffffff;
}

.btn-scan-gallery:hover:not(.disabled) {
  background: #0f172a;
}

.btn-scan-gallery.disabled {
  opacity: 0.65;
  cursor: wait;
}

.btn-scan-text {
  background: #ffffff;
  color: #334155;
  border: 1px solid #cbd5e1;
}

.btn-scan-text:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.btn-scan-clear {
  background: #ffffff;
  color: #d71920;
  border: 1px solid #efb5b8;
}

.btn-scan-clear:hover {
  background: #fff0f0;
}

.ocr-detected-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
}

.ocr-chips-label {
  font-size: 12px;
  font-weight: 800;
  color: #166534;
  margin-right: 4px;
}

.ocr-chip-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  background: #dcfce7;
  color: #15803d;
  font-size: 11.5px;
  font-weight: 700;
}

.ocr-text-editor {
  margin-top: 12px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ocr-editor-label {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}

.ocr-editor-textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #1e293b;
  background: #f8fafc;
  resize: vertical;
}

.ocr-editor-textarea:focus {
  outline: none;
  border-color: #d71920;
  background: #ffffff;
}

.ocr-editor-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-scan-apply-text {
  background: #16a34a;
  color: #ffffff;
  padding: 9px 14px;
  font-size: 13px;
}

.btn-scan-apply-text:hover {
  background: #15803d;
}

.preview-container {
  margin-top: 14px;
}

.ticket-preview-img {
  max-width: 100%;
  max-height: 240px;
  border-radius: 10px;
  border: 1px solid #e4e5e9;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  object-fit: contain;
  background: #ffffff;
}

.ocr-status-box {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
  margin-top: 10px;
  line-height: 1.4;
}

.ocr-busy {
  color: #d71920;
  font-weight: 600;
}

/* Grid de campos */
.fields-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 20px;
  margin-bottom: 0;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.full-width {
  grid-column: 1 / -1;
}

label {
  font-size: 14.5px;
  font-weight: 800;
  color: #0f172a;
}

input,
select,
textarea {
  width: 100%;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  padding: 13px 15px;
  min-height: 48px;
  font: inherit;
  font-size: 15.5px;
  background: #ffffff;
  color: #0f172a;
  box-sizing: border-box;
  transition: all 0.15s ease;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #d71920;
  box-shadow: 0 0 0 3px rgba(215, 25, 32, 0.14);
}

textarea {
  min-height: 75px;
  resize: vertical;
}

/* Tarjeta de cálculo de distancia */
.distance-calc-card {
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  padding: 24px;
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.02);
}

.distance-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.auto-distance-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  color: #0369a1;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
  line-height: 1.4;
}

.auto-distance-banner.is-loading {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.auto-distance-banner.is-ok {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #047857;
}

.distance-icon {
  font-size: 28px;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.distance-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}

.distance-sub {
  font-size: 13px;
  color: #64748b;
  margin: 2px 0 0;
}

.distance-input-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.input-with-km {
  position: relative;
  flex: 1;
  min-width: 0;
}

.input-with-km input {
  width: 100%;
  padding-right: 76px;
}

.input-with-km input.input-locked,
.input-with-km input:disabled {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #334155;
  font-weight: 700;
  cursor: not-allowed;
  user-select: none;
}

.km-unit-badge {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-weight: 700;
  font-size: 13px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 6px;
  pointer-events: none;
}

.km-unit-badge.is-locked {
  background: #dcfce7;
  color: #15803d;
  border: 1px solid #86efac;
}

.btn-calc {
  width: auto;
  flex-shrink: 0;
  margin: 0;
  background: #ffffff;
  border: 1.5px solid #efb5b8;
  color: #d71920;
  font-weight: 700;
  padding: 13px 22px;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  font-size: 14px;
}

.btn-calc:hover:not(:disabled) {
  background: #fff5f5;
  border-color: #d71920;
}

.btn-calc.btn-calc-locked,
.btn-calc:disabled {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #64748b;
  cursor: not-allowed;
}

/* Caja de Tarifa Prominente */
.price-result-box {
  margin-top: 16px;
  border-radius: 14px;
  transition: all 0.2s ease;
}

.price-result-box.price-ok {
  background: linear-gradient(135deg, #fff5f5 0%, #fef2f2 100%);
  border: 2px solid #ef4444;
  padding: 20px 24px;
  box-shadow: 0 6px 20px rgba(215, 25, 32, 0.08);
}

.price-box-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.price-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.price-badge-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 800;
  color: #b91c1c;
  letter-spacing: 0.5px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 8px #ef4444;
  animation: livePulse 1.5s infinite;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

.price-sub-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.price-distance-pill,
.price-local-pill {
  font-size: 12.5px;
  font-weight: 600;
  color: #334155;
  background: #ffffff;
  padding: 3px 10px;
  border-radius: 8px;
  border: 1px solid #fecaca;
}

.price-rule-note {
  font-size: 12px;
  color: #7f1d1d;
  margin: 2px 0 0;
  font-weight: 500;
}

.price-amount-wrapper {
  display: flex;
  align-items: baseline;
  gap: 4px;
  background: #ffffff;
  border: 2px solid #fca5a5;
  padding: 12px 24px;
  border-radius: 14px;
  box-shadow: 0 4px 12px rgba(215, 25, 32, 0.06);
}

.price-currency-sign {
  font-size: 24px;
  font-weight: 800;
  color: #d71920;
}

.price-number {
  font-size: 38px;
  font-weight: 900;
  color: #d71920;
  letter-spacing: -1px;
}

.price-currency-code {
  font-size: 15px;
  font-weight: 800;
  color: #991b1b;
  margin-left: 2px;
}

.price-result-box.price-empty {
  background: #f8fafc;
  border: 2px dashed #cbd5e1;
  padding: 16px 20px;
}

.price-waiting-content {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13.5px;
  color: #64748b;
}

.waiting-icon {
  font-size: 24px;
}

.price-waiting-content p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #94a3b8;
}

.price-result-box.price-out {
  background: #fef2f2;
  border: 2px solid #ef4444;
  padding: 16px 20px;
}

.price-alert-content {
  display: flex;
  align-items: center;
  gap: 14px;
}

.alert-icon-big {
  font-size: 28px;
}

.alert-title {
  color: #991b1b;
  font-size: 14px;
  display: block;
}

.alert-desc {
  color: #b91c1c;
  font-size: 13px;
  margin: 2px 0 0;
}

/* Sección de cambio */
.change-section {
  background: #fafafa;
  border: 1px solid #e5e7eb;
  padding: 14px 16px;
  border-radius: 12px;
}

.checkbox-container {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
}

.checkbox-container input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #d71920;
  cursor: pointer;
}

.checkbox-label {
  font-weight: 600;
  color: #111827;
}

.change-detail-box {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #d5d7dc;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.other-change-input {
  margin-top: 4px;
}

/* Sección de cuidados */
.care-section {
  margin-top: 10px;
  padding-top: 20px;
  border-top: 1px solid #f0f0f0;
}

.care-options-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.care-option-card {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1.5px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px 14px;
  background: #ffffff;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  color: #374151;
  transition: all 0.15s ease;
}

.care-option-card:hover {
  border-color: #d71920;
  background: #fffafa;
}

.care-option-card.care-selected {
  border-color: #d71920;
  background: #fff5f5;
  color: #d71920;
}

.care-option-card input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #d71920;
}

.ready-checkbox-box {
  margin-top: 16px;
  padding: 14px 16px;
  background: #f0fdf4;
  border: 1.5px solid #86efac;
  border-radius: 12px;
}

.ready-checkbox-box .checkbox-label {
  color: #166534;
}

/* Botón submit principal */
.btn-submit-order {
  width: 100%;
  margin-top: 18px;
  padding: 16px;
  background: linear-gradient(135deg, #d71920 0%, #b81419 100%);
  color: #ffffff;
  font-size: 16px;
  font-weight: 800;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(215, 25, 32, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.btn-submit-order:hover:not(:disabled) {
  opacity: 0.95;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(215, 25, 32, 0.35);
}

.btn-submit-order:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

/* Caja y botón de Asistencia por WhatsApp (415 101 9920) */
.assistance-box {
  margin-top: 14px;
  padding: 14px 18px;
  background: #f8fafc;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.assistance-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: #475569;
}

.assistance-info strong {
  font-size: 14px;
  color: #0f172a;
}

.btn-assistance-form {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #16a34a;
  color: #ffffff;
  text-decoration: none;
  font-size: 14px;
  font-weight: 800;
  padding: 11px 20px;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-assistance-form:hover {
  background: #15803d;
  transform: translateY(-1px);
}

.btn-assistance-inline {
  background: #0f172a;
  color: #ffffff;
  text-decoration: none;
}

.btn-assistance-inline:hover {
  background: #1e293b;
}

.footer-help {
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
  margin: 14px 0 0;
  line-height: 1.45;
}

/* Card rápida de repartidores */
.quick-riders-card {
  border-top: 3px solid #111827;
}

.quick-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.quick-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  min-width: 240px;
}

.quick-usage-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}

.usage-pill-ok {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.usage-pill-exhausted {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.usage-sub {
  font-weight: 600;
  opacity: 0.85;
}

.quick-limit-banner {
  margin-top: 14px;
  background: #fef2f2;
  border: 1.5px solid #fecaca;
  border-radius: 12px;
  padding: 14px 16px;
  color: #991b1b;
}

.quick-limit-banner strong {
  display: block;
  font-size: 14px;
  margin-bottom: 4px;
}

.quick-limit-banner p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #7f1d1d;
}

.grid-disabled {
  opacity: 0.55;
  pointer-events: none;
}

.lightning-icon {
  font-size: 26px;
  background: #f1f5f9;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.rider-options-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}

.rider-zones-section {
  margin-top: 18px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 16px;
}

.rider-zones-header {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 12px;
}

.rider-zones-label {
  font-size: 13.5px;
  font-weight: 800;
  color: #0f172a;
}

.rider-zones-hint {
  font-size: 12px;
  color: #64748b;
}

.rider-zones-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.rider-zone-field {
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 11px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.rider-zone-field.zone-field-selected {
  border-color: #86efac;
  background: #f0fdf4;
}

.rider-zone-item-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #475569;
  margin: 0;
}

.zone-selected-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}

.rider-badge-num {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fff1f2;
  color: #be123c;
  border: 1px solid #fecdd3;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}

.zone-search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: #f8fafc;
  border: 1.5px solid #cbd5e1;
  border-radius: 9px;
  padding: 0 8px 0 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.zone-search-box:focus-within {
  background: #ffffff;
  border-color: #d71920;
  box-shadow: 0 0 0 3px rgba(215, 25, 32, 0.12);
}

.zone-search-icon {
  font-size: 13px;
  margin-right: 6px;
  flex-shrink: 0;
  opacity: 0.75;
}

.zone-search-input {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding: 8px 4px !important;
  font-size: 13px !important;
  width: 100%;
  color: #0f172a;
}

.zone-search-input:focus {
  outline: none;
}

.zone-match-counter {
  font-size: 11px;
  font-weight: 800;
  color: #475569;
  background: #e2e8f0;
  border-radius: 999px;
  padding: 2px 7px;
  margin-left: 4px;
  flex-shrink: 0;
}

.zone-search-clear {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 13px;
  font-weight: 800;
  padding: 4px 6px;
  margin-left: 2px;
  cursor: pointer;
  border-radius: 6px;
  line-height: 1;
}

.zone-search-clear:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.zone-quick-suggestions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  padding: 6px;
  max-height: 185px;
  overflow-y: auto;
}

.zone-suggestion-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: #1e293b;
  cursor: pointer;
  transition: all 0.12s ease;
}

.zone-suggestion-btn:hover,
.zone-suggestion-btn.is-active {
  background: #fff1f2;
  border-color: #fda4af;
  color: #be123c;
}

.sug-pick-tag {
  font-size: 11px;
  font-weight: 800;
  color: #d71920;
  background: #ffffff;
  border: 1px solid #fecdd3;
  padding: 2px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.zone-no-matches {
  font-size: 12px;
  font-weight: 600;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 7px 10px;
}

.zone-pending-hint {
  font-size: 11.5px;
  font-weight: 700;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 999px;
}

.zone-chosen-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #ffffff;
  border: 1.5px solid #4ade80;
  border-radius: 10px;
  padding: 11px 12px;
}

.zone-chosen-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.zone-chosen-pin {
  font-size: 16px;
  flex-shrink: 0;
}

.zone-chosen-name {
  font-size: 14px;
  font-weight: 800;
  color: #14532d;
  line-height: 1.35;
  word-break: break-word;
}

.btn-change-zone {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  color: #334155;
  font-size: 12.5px;
  font-weight: 800;
  padding: 7px 12px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.btn-change-zone:hover {
  background: #fee2e2;
  border-color: #fda4af;
  color: #be123c;
}

.quick-zones-preview {
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.quick-zones-title {
  display: block;
  font-size: 12.5px;
  font-weight: 800;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 10px;
}

.quick-zones-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.quick-zones-list li {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  padding: 9px 12px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.zone-rider-tag {
  font-size: 11.5px;
  font-weight: 800;
  color: #d71920;
}

.status-limit-reached {
  background: #fee2e2;
  color: #991b1b;
}

.rider-btn {
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 6px;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}

.rider-btn strong {
  display: block;
  font-size: 22px;
  color: #1e293b;
}

.rider-btn span {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-top: 3px;
  font-weight: 600;
}

.rider-btn:hover {
  border-color: #d71920;
}

.rider-btn.active {
  border: 2px solid #d71920;
  background: #fff5f5;
}

.rider-btn.active strong,
.rider-btn.active span {
  color: #d71920;
}

.btn-quick-request {
  width: 100%;
  margin-top: 14px;
  padding: 14px;
  background: #1e293b;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-quick-request:hover:not(:disabled) {
  background: #0f172a;
}

.btn-quick-request:disabled {
  opacity: 0.6;
  cursor: wait;
}

/* Quick Result View Styles */
.quick-result-view {
  animation: fadeIn 0.3s ease;
}

.quick-result-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}

.quick-check-badge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fef3c7;
  color: #b45309;
  font-size: 24px;
  font-weight: 900;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);
}

.quick-result-header h3 {
  margin: 0;
  font-size: 20px;
  color: #0f172a;
  font-weight: 800;
}

.quick-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  background: #f8fafc;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  margin-bottom: 18px;
}

.riders-highlight {
  color: #d71920;
  font-weight: 800;
}

.quick-note-preview {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13.5px;
  color: #92400e;
  margin-bottom: 18px;
}

/* Tarjeta de resultado exitoso (Fase 3.4) */
.result-card {
  border: 1.5px solid #86efac;
  background: #ffffff;
  padding: 28px 24px;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}

.result-check-badge {
  width: 46px;
  height: 46px;
  background: #22c55e;
  color: #ffffff;
  font-size: 24px;
  font-weight: 900;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
}

.result-header h3 {
  margin: 0;
  font-size: 22px;
  color: #15803d;
  font-weight: 800;
}

.result-sub {
  margin: 3px 0 0;
  font-size: 14px;
  color: #64748b;
}

.result-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  background: #f8fafc;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  margin-bottom: 24px;
}

.summary-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.box-label {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.5px;
}

.box-value {
  font-size: 16px;
  color: #0f172a;
}

.folio-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 800;
  color: #15803d;
}

.badge-status {
  display: inline-block;
  background: #fef3c7;
  color: #92400e;
  font-weight: 700;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  width: fit-content;
}

.fee-highlight {
  color: #d71920;
  font-weight: 800;
}

.result-action-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action-btn {
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  transition: all 0.15s ease;
  box-sizing: border-box;
}

.btn-view-ticket {
  background: #0f172a;
  color: #ffffff;
}

.btn-view-ticket:hover {
  background: #1e293b;
}

.btn-copy {
  background: #ffffff;
  color: #1e293b;
  border: 1.5px solid #cbd5e1;
}

.btn-copy:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.btn-whatsapp {
  background: #25D366;
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(37, 211, 102, 0.25);
}

.btn-whatsapp:hover {
  background: #20bd5a;
}

.btn-reset {
  background: #d71920;
  color: #ffffff;
}

.btn-reset:hover {
  background: #ba1218;
}

/* Alertas */
.alert-box {
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 14px;
  margin-bottom: 16px;
  font-weight: 600;
}

.alert-error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

/* Spinner */
.mini-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.help-micro {
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
  margin: 8px 0 0;
}

/* Footer */
.portal-footer {
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
  padding: 15px;
}

/* Toast flotante */
.toast-notification {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #0f172a;
  color: #ffffff;
  padding: 12px 20px;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 1000;
  animation: toastSlideUp 0.25s ease-out;
  max-width: 90%;
}

.toast-icon {
  font-weight: 900;
  font-size: 16px;
}

.toast-success {
  background: #14532d;
  color: #ffffff;
  border: 1px solid #22c55e;
}

.toast-error {
  background: #7f1d1d;
  color: #ffffff;
  border: 1px solid #ef4444;
}

@keyframes toastSlideUp {
  from {
    opacity: 0;
    transform: translate(-50%, 15px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

/* Adaptación responsive */
@media (max-width: 960px) {
  .care-options-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .rider-zones-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .portal-header {
    padding: 12px 14px;
  }
  .header-inner {
    gap: 10px;
  }
  .logo-box {
    width: 44px;
    height: 40px;
    font-size: 16px;
  }
  .brand-text h1 {
    font-size: 18px;
  }
  .header-right-actions {
    width: 100%;
    justify-content: space-between;
  }
  .header-restaurant-pill {
    flex: 1;
    justify-content: space-between;
    box-sizing: border-box;
  }
  .portal-main {
    padding: 0 12px 40px;
    margin: 14px auto;
  }
  .card {
    padding: 16px 14px;
    border-radius: 14px;
  }
  .step-block {
    padding: 16px 14px;
    border-radius: 14px;
  }
  .step-header h4 {
    font-size: 15.5px;
  }
  input,
  select,
  textarea {
    font-size: 16px;
    padding: 12px;
  }
  .scan-box {
    padding: 12px 14px;
  }
  .scan-compact-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .scan-actions {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
  .btn-scan {
    width: 100%;
    justify-content: center;
    box-sizing: border-box;
  }
  .fields-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .full-width {
    grid-column: auto;
  }
  .distance-calc-card {
    padding: 14px;
  }
  .distance-input-row {
    flex-direction: column;
    align-items: stretch;
  }
  .btn-calc {
    width: 100%;
    text-align: center;
  }
  .price-result-box.price-ok {
    padding: 14px;
  }
  .price-box-content {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .price-amount-wrapper {
    width: 100%;
    justify-content: center;
    box-sizing: border-box;
    padding: 10px 16px;
  }
  .price-number {
    font-size: 32px;
  }
  .care-options-grid {
    grid-template-columns: 1fr;
  }
  .rider-options-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .rider-zones-grid,
  .quick-zones-list {
    grid-template-columns: 1fr;
  }
  .zone-chosen-card {
    flex-direction: column;
    align-items: stretch;
  }
  .btn-change-zone {
    width: 100%;
    text-align: center;
  }
  .result-summary-grid,
  .quick-summary-grid {
    grid-template-columns: 1fr;
  }
  .result-action-buttons {
    grid-template-columns: 1fr;
  }
  .map-search-grid {
    grid-template-columns: 1fr;
  }
}

.open-map-routing-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 14px;
  padding: 14px;
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
}

.map-search-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.map-search-grid.single-search-col {
  grid-template-columns: 1fr;
}

/* Buscador en tiempo real de Colonias en el formulario */
.neighborhood-search-wrapper {
  position: relative;
}

.neighborhood-input-box {
  position: relative;
  display: flex;
  align-items: center;
}

.neighborhood-input-box input {
  width: 100%;
  padding-right: 32px;
}

.btn-clear-neighborhood {
  position: absolute;
  right: 10px;
  cursor: pointer;
  color: #94a3b8;
  font-size: 13px;
  font-weight: 800;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f1f5f9;
  transition: all 0.15s ease;
  user-select: none;
}

.btn-clear-neighborhood:hover {
  color: #ef4444;
  background: #fee2e2;
}

.neighborhood-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  z-index: 1050;
  max-height: 250px;
  overflow-y: auto;
}

.neighborhood-dropdown-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
}

.neighborhood-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.neighborhood-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  font-size: 13.5px;
}

.neighborhood-item:hover,
.neighborhood-item.is-active {
  background: #f1f5f9;
}

.neighborhood-pin {
  font-size: 13px;
  flex-shrink: 0;
}

.neighborhood-name {
  font-weight: 700;
  color: #1e293b;
  flex: 1;
}

.neighborhood-type-badge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  background: #e2e8f0;
  color: #475569;
}
</style>