<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_CONFIG } from '../../services/geocoding'

const props = defineProps({
  origin: {
    type: Object, // { lat: number, lng: number, label?: string } | null
    default: null,
  },
  destination: {
    type: Object, // { lat: number, lng: number, label?: string } | null
    default: null,
  },
  routeGeometry: {
    type: Object, // GeoJSON LineString: { type: 'LineString', coordinates: [[lng, lat], ...] } | null
    default: null,
  },
  initialCenter: {
    type: Object,
    default: () => ({ ...MAP_CONFIG.defaultCenter }),
  },
  initialZoom: {
    type: Number,
    default: MAP_CONFIG.defaultZoom,
  },
  lockOrigin: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'update:origin',
  'update:destination',
  'origin-changed',
  'destination-changed',
  'clear-points',
])

const mapContainer = ref(null)
const activeSelectMode = ref('destination') // 'origin' | 'destination'

let mapInstance = null
let originMarker = null
let destinationMarker = null
let routePolyline = null
let resizeObserver = null

const effectiveSelectMode = computed(() => {
  if (props.lockOrigin) return 'destination'
  if (!props.origin) return 'origin'
  return activeSelectMode.value
})

function createPinIcon(letter, bgColor, borderColor, pulseColor) {
  return L.divIcon({
    className: 'rodo-custom-map-pin',
    html: `
      <div class="pin-wrapper" style="--pin-bg:${bgColor};--pin-border:${borderColor};--pin-pulse:${pulseColor}">
        <div class="pin-head">
          <span class="pin-letter">${letter}</span>
        </div>
        <div class="pin-tip"></div>
      </div>
    `,
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    popupAnchor: [0, -40],
  })
}

const originIcon = createPinIcon('A', '#d71920', '#991b1b', 'rgba(215, 25, 32, 0.25)')
const destinationIcon = createPinIcon('B', '#0f172a', '#1e293b', 'rgba(15, 23, 42, 0.22)')

function isValidCoord(point) {
  return (
    point &&
    typeof point === 'object' &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng))
  )
}

function initMap() {
  if (!mapContainer.value || mapInstance) return

  const centerLat = isValidCoord(props.origin)
    ? Number(props.origin.lat)
    : Number(props.initialCenter?.lat || MAP_CONFIG.defaultCenter.lat)
  const centerLng = isValidCoord(props.origin)
    ? Number(props.origin.lng)
    : Number(props.initialCenter?.lng || MAP_CONFIG.defaultCenter.lng)

  mapInstance = L.map(mapContainer.value, {
    center: [centerLat, centerLng],
    zoom: props.initialZoom || MAP_CONFIG.defaultZoom,
    zoomControl: true,
    attributionControl: true,
  })

  L.tileLayer(MAP_CONFIG.tileUrl, {
    attribution: MAP_CONFIG.tileAttribution,
    maxZoom: 19,
  }).addTo(mapInstance)

  mapInstance.on('click', handleMapClick)

  syncMarkersAndRoute(true)

  if (typeof ResizeObserver !== 'undefined' && mapContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      if (mapInstance) {
        mapInstance.invalidateSize()
      }
    })
    resizeObserver.observe(mapContainer.value)
  }
}

function handleMapClick(event) {
  if (!event?.latlng) return
  const lat = Number(event.latlng.lat.toFixed(6))
  const lng = Number(event.latlng.lng.toFixed(6))

  if (effectiveSelectMode.value === 'origin' && !props.lockOrigin) {
    const newOrigin = { lat, lng }
    emit('update:origin', newOrigin)
    emit('origin-changed', newOrigin)
    activeSelectMode.value = 'destination'
  } else {
    const newDestination = { lat, lng }
    emit('update:destination', newDestination)
    emit('destination-changed', newDestination)
  }
}

function syncMarkersAndRoute(shouldFitBounds = false) {
  if (!mapInstance) return

  // 1. Marcador de Origen (Punto A)
  if (isValidCoord(props.origin)) {
    const latLng = [Number(props.origin.lat), Number(props.origin.lng)]
    if (!originMarker) {
      originMarker = L.marker(latLng, {
        icon: originIcon,
        draggable: !props.lockOrigin,
        title: 'Punto A: Origen (Establecimiento)',
      }).addTo(mapInstance)

      originMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng()
        const updated = {
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6)),
        }
        emit('update:origin', updated)
        emit('origin-changed', updated)
      })
    } else {
      originMarker.setLatLng(latLng)
      if (originMarker.dragging) {
        if (props.lockOrigin) {
          originMarker.dragging.disable()
        } else {
          originMarker.dragging.enable()
        }
      }
    }

    const originLabel = props.origin.label || 'Punto A · Origen (Local)'
    originMarker.bindPopup(`<strong>🏪 ${originLabel}</strong>`)
  } else if (originMarker) {
    mapInstance.removeLayer(originMarker)
    originMarker = null
  }

  // 2. Marcador de Destino (Punto B)
  if (isValidCoord(props.destination)) {
    const latLng = [Number(props.destination.lat), Number(props.destination.lng)]
    if (!destinationMarker) {
      destinationMarker = L.marker(latLng, {
        icon: destinationIcon,
        draggable: true,
        title: 'Punto B: Destino de entrega (Arrastra para ajustar)',
      }).addTo(mapInstance)

      destinationMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng()
        const updated = {
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6)),
        }
        emit('update:destination', updated)
        emit('destination-changed', updated)
      })
    } else {
      destinationMarker.setLatLng(latLng)
    }

    const destLabel = props.destination.label || 'Punto B · Destino de entrega'
    destinationMarker.bindPopup(`<strong>📍 ${destLabel}</strong>`)
  } else if (destinationMarker) {
    mapInstance.removeLayer(destinationMarker)
    destinationMarker = null
  }

  // 3. Línea de Ruta por Calles (GeoJSON LineString)
  if (routePolyline) {
    mapInstance.removeLayer(routePolyline)
    routePolyline = null
  }

  const coords = props.routeGeometry?.coordinates
  if (Array.isArray(coords) && coords.length >= 2) {
    const latLngs = coords
      .filter((pair) => Array.isArray(pair) && pair.length >= 2)
      .map(([lng, lat]) => [Number(lat), Number(lng)])

    if (latLngs.length >= 2) {
      routePolyline = L.polyline(latLngs, {
        color: '#d71920',
        weight: 5,
        opacity: 0.88,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(mapInstance)
    }
  }

  // 4. Ajuste automático de cámara (fitBounds)
  if (shouldFitBounds) {
    fitMapToActiveElements()
  }
}

function fitMapToActiveElements() {
  if (!mapInstance) return

  if (routePolyline) {
    const bounds = routePolyline.getBounds()
    if (bounds.isValid()) {
      mapInstance.fitBounds(bounds, { padding: [44, 44], maxZoom: 17 })
      return
    }
  }

  if (isValidCoord(props.origin) && isValidCoord(props.destination)) {
    const bounds = L.latLngBounds([
      [Number(props.origin.lat), Number(props.origin.lng)],
      [Number(props.destination.lat), Number(props.destination.lng)],
    ])
    if (bounds.isValid()) {
      mapInstance.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 })
      return
    }
  }

  if (isValidCoord(props.destination)) {
    mapInstance.setView([Number(props.destination.lat), Number(props.destination.lng)], 16)
  } else if (isValidCoord(props.origin)) {
    mapInstance.setView([Number(props.origin.lat), Number(props.origin.lng)], 15)
  }
}

function handleClearPoints() {
  if (!props.lockOrigin) {
    emit('update:origin', null)
  }
  emit('update:destination', null)
  emit('clear-points')
  activeSelectMode.value = props.lockOrigin ? 'destination' : 'origin'
}

watch(
  () => [
    props.origin?.lat,
    props.origin?.lng,
    props.destination?.lat,
    props.destination?.lng,
    props.routeGeometry,
    props.lockOrigin,
  ],
  () => {
    syncMarkersAndRoute(true)
  },
  { deep: true }
)

onMounted(async () => {
  await nextTick()
  initMap()
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (mapInstance) {
    mapInstance.off('click', handleMapClick)
    mapInstance.remove()
    mapInstance = null
  }
  originMarker = null
  destinationMarker = null
  routePolyline = null
})

defineExpose({
  fitMapToActiveElements,
})
</script>

<template>
  <div class="route-map-wrapper">
    <!-- Barra de herramientas superior del mapa -->
    <div class="route-map-toolbar">
      <div class="mode-selector-group">
        <button
          v-if="!lockOrigin"
          type="button"
          class="map-mode-btn"
          :class="{ active: effectiveSelectMode === 'origin' }"
          @click="activeSelectMode = 'origin'"
        >
          <span class="pin-badge pin-a">A</span>
          <span>Marcar Origen</span>
        </button>
        <span v-else class="origin-locked-pill" title="La ubicación del establecimiento está fijada por el Administrador">
          <span class="pin-badge pin-a">A</span>
          <span>Local Fijo</span>
        </span>

        <button
          type="button"
          class="map-mode-btn"
          :class="{ active: effectiveSelectMode === 'destination' }"
          @click="activeSelectMode = 'destination'"
        >
          <span class="pin-badge pin-b">B</span>
          <span>Tocar mapa para marcar Destino</span>
        </button>
      </div>

      <div class="map-actions-group">
        <button
          v-if="origin || destination"
          type="button"
          class="btn-map-fit"
          title="Centrar ruta completa en el mapa"
          @click="fitMapToActiveElements"
        >
          🎯 Centrar ruta
        </button>

        <button
          v-if="destination || (!lockOrigin && origin)"
          type="button"
          class="btn-map-clear"
          title="Limpiar punto de destino seleccionado"
          @click="handleClearPoints"
        >
          🗑️ Limpiar destino
        </button>
      </div>
    </div>

    <!-- Lienzo interactivo de Leaflet -->
    <div class="route-map-canvas-wrap">
      <div ref="mapContainer" class="route-map-canvas" />

      <!-- Indicador flotante cuando se está calculando la ruta -->
      <div v-if="loading" class="map-loading-overlay">
        <span class="map-spinner" />
        <span>Trazando ruta por calles...</span>
      </div>
    </div>

    <!-- Leyenda y nota de uso táctil / arrastre -->
    <div class="route-map-footer">
      <div class="map-legend">
        <span class="legend-item">
          <span class="pin-badge pin-a">A</span> Establecimiento
        </span>
        <span class="legend-item">
          <span class="pin-badge pin-b">B</span> Cliente (puedes arrastrar el pin)
        </span>
      </div>
      <span class="osm-notice">Datos viales © OpenStreetMap contributors</span>
    </div>
  </div>
</template>

<style scoped>
.route-map-wrapper {
  display: flex;
  flex-direction: column;
  border: 1.5px solid #cbd5e1;
  border-radius: 14px;
  overflow: hidden;
  background: #ffffff;
  margin-top: 12px;
}

.route-map-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.mode-selector-group,
.map-actions-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.map-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-radius: 9px;
  border: 1.5px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.map-mode-btn.active {
  border-color: #d71920;
  background: #fff1f2;
  color: #be123c;
}

.origin-locked-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: 9px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
  font-size: 12.5px;
  font-weight: 700;
}

.pin-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 900;
  color: #ffffff;
  flex-shrink: 0;
}

.pin-a {
  background: #d71920;
}

.pin-b {
  background: #0f172a;
}

.btn-map-fit,
.btn-map-clear {
  padding: 7px 12px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-map-fit {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #1e293b;
}

.btn-map-fit:hover {
  background: #f1f5f9;
}

.btn-map-clear {
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #be123c;
}

.btn-map-clear:hover {
  background: #ffe4e6;
}

.route-map-canvas-wrap {
  position: relative;
  width: 100%;
  height: 320px;
  background: #e2e8f0;
}

.route-map-canvas {
  width: 100%;
  height: 100%;
  z-index: 1;
}

.map-loading-overlay {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 500;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(15, 23, 42, 0.88);
  color: #ffffff;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

.map-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: mapSpin 0.75s linear infinite;
}

@keyframes mapSpin {
  to {
    transform: rotate(360deg);
  }
}

.route-map-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 12px;
  color: #475569;
}

.map-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-weight: 700;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.osm-notice {
  font-size: 11px;
  color: #64748b;
}

:deep(.rodo-custom-map-pin) {
  background: transparent;
  border: none;
}

:deep(.pin-wrapper) {
  position: relative;
  width: 36px;
  height: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));
}

:deep(.pin-head) {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--pin-bg, #d71920);
  border: 3px solid #ffffff;
  display: grid;
  place-items: center;
  color: #ffffff;
  font-weight: 900;
  font-size: 14px;
  box-shadow: 0 0 0 2px var(--pin-border, #991b1b);
}

:deep(.pin-tip) {
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 11px solid var(--pin-bg, #d71920);
  margin-top: -2px;
}

@media (max-width: 640px) {
  .route-map-canvas-wrap {
    height: 260px;
  }

  .route-map-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .mode-selector-group,
  .map-actions-group {
    width: 100%;
    justify-content: space-between;
  }

  .map-mode-btn,
  .btn-map-fit,
  .btn-map-clear {
    flex: 1;
    justify-content: center;
  }
}
</style>

