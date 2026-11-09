<script setup>
import { onUnmounted, ref, watch } from 'vue'
import { searchAddressSuggestions } from '../../services/geocoding'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  pointType: {
    type: String, // 'origin' | 'destination'
    default: 'destination',
  },
  role: {
    type: String, // alias for pointType ('origin' | 'destination')
    default: '',
  },
  label: {
    type: String,
    default: 'Buscar dirección o lugar en el mapa',
  },
  placeholder: {
    type: String,
    default: 'Escribe calle, número, colonia o establecimiento...',
  },
  biasCoords: {
    type: Object, // { lat: number, lng: number } | null
    default: null,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  selectedCoords: {
    type: Object, // { lat: number, lng: number } | null
    default: null,
  },
  selectedLocation: {
    type: Object, // alias for selectedCoords
    default: null,
  },
})

const emit = defineEmits([
  'update:modelValue',
  'select-location',
  'select',
  'clear-location',
  'clear',
])

const searchQuery = ref(props.modelValue || '')
const suggestions = ref([])
const loading = ref(false)
const errorMsg = ref('')
const isOpen = ref(false)

let debounceTimer = null
let activeAbortController = null

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal !== undefined && newVal !== searchQuery.value) {
      searchQuery.value = newVal
    }
  }
)

function cancelPendingRequest() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
}

function handleInput(event) {
  const val = event.target.value
  searchQuery.value = val
  emit('update:modelValue', val)
  errorMsg.value = ''

  cancelPendingRequest()

  const trimmed = val.trim()
  if (trimmed.length < 3) {
    suggestions.value = []
    loading.value = false
    isOpen.value = false
    return
  }

  loading.value = true
  debounceTimer = setTimeout(async () => {
    activeAbortController = new AbortController()
    try {
      const results = await searchAddressSuggestions(trimmed, {
        biasCoords: props.biasCoords,
        limit: 6,
        signal: activeAbortController.signal,
      })
      suggestions.value = results
      isOpen.value = true
    } catch (err) {
      if (err?.name === 'AbortError') return
      errorMsg.value = err?.message || 'No se pudieron cargar las sugerencias.'
      suggestions.value = []
    } finally {
      loading.value = false
    }
  }, 350)
}

function selectSuggestion(item) {
  cancelPendingRequest()
  searchQuery.value = item.displayName
  emit('update:modelValue', item.displayName)
  suggestions.value = []
  isOpen.value = false
  errorMsg.value = ''

  const resolvedPointType = props.pointType || props.role || 'destination'
  const payload = {
    pointType: resolvedPointType,
    lat: item.lat,
    lng: item.lng,
    displayName: item.displayName,
    title: item.title,
    street: item.street,
    neighborhood: item.neighborhood,
    city: item.city,
  }

  emit('select-location', payload)
  emit('select', payload)
}

function clearSearch() {
  cancelPendingRequest()
  searchQuery.value = ''
  suggestions.value = []
  isOpen.value = false
  errorMsg.value = ''
  const resolvedPointType = props.pointType || props.role || 'destination'
  emit('update:modelValue', '')
  emit('clear-location', { pointType: resolvedPointType })
  emit('clear', { pointType: resolvedPointType })
}

onUnmounted(() => {
  cancelPendingRequest()
})
</script>

<template>
  <div class="location-search-container">
    <div v-if="label" class="location-search-header">
      <label class="location-search-label">
        <span class="point-pill" :class="pointType === 'origin' ? 'pill-a' : 'pill-b'">
          {{ pointType === 'origin' ? 'A' : 'B' }}
        </span>
        <span>{{ label }}</span>
      </label>

      <span v-if="selectedCoords && Number.isFinite(selectedCoords.lat)" class="coords-ready-tag">
        ✓ {{ Number(selectedCoords.lat).toFixed(4) }}, {{ Number(selectedCoords.lng).toFixed(4) }}
      </span>
    </div>

    <div class="location-input-wrapper" :class="{ 'is-disabled': disabled }">
      <span class="search-icon">🔍</span>
      <input
        type="text"
        :value="searchQuery"
        :placeholder="placeholder"
        :disabled="disabled"
        class="location-search-input"
        autocomplete="off"
        @input="handleInput"
        @focus="suggestions.length > 0 && (isOpen = true)"
      >
      <span v-if="loading" class="search-spinner" />
      <button
        v-else-if="searchQuery && !disabled"
        type="button"
        class="btn-clear-search"
        title="Limpiar búsqueda"
        @click="clearSearch"
      >
        ✕
      </button>
    </div>

    <p v-if="errorMsg" class="search-error-msg">{{ errorMsg }}</p>

    <!-- Lista desplegable de sugerencias de autocompletado -->
    <ul v-if="isOpen && suggestions.length > 0" class="suggestions-dropdown">
      <li
        v-for="item in suggestions"
        :key="item.id"
        class="suggestion-item"
      >
        <button
          type="button"
          class="suggestion-btn"
          @click="selectSuggestion(item)"
        >
          <span class="sug-pin-icon">📍</span>
          <div class="sug-texts">
            <strong class="sug-title">{{ item.title }}</strong>
            <span v-if="item.subtitle" class="sug-sub">{{ item.subtitle }}</span>
          </div>
          <span class="sug-select-pill">Elegir</span>
        </button>
      </li>
    </ul>

    <div
      v-else-if="isOpen && !loading && searchQuery.trim().length >= 3 && !errorMsg"
      class="no-suggestions-box"
    >
      No se encontraron coincidencias exactas. Puedes tocar directamente el punto en el mapa de abajo.
    </div>
  </div>
</template>

<style scoped>
.location-search-container {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.location-search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.location-search-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
  font-weight: 800;
  color: #0f172a;
}

.point-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 900;
  color: #ffffff;
}

.pill-a {
  background: #d71920;
}

.pill-b {
  background: #0f172a;
}

.coords-ready-tag {
  font-size: 11.5px;
  font-weight: 700;
  color: #15803d;
  background: #dcfce7;
  border: 1px solid #86efac;
  padding: 2px 8px;
  border-radius: 999px;
}

.location-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 11px;
  padding: 0 12px;
  min-height: 46px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.location-input-wrapper:focus-within {
  border-color: #d71920;
  box-shadow: 0 0 0 3px rgba(215, 25, 32, 0.12);
}

.location-input-wrapper.is-disabled {
  background: #f1f5f9;
  opacity: 0.75;
}

.search-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.location-search-input {
  width: 100%;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding: 10px 4px !important;
  min-height: auto !important;
  font-size: 14.5px !important;
  color: #0f172a;
}

.location-search-input:focus {
  outline: none;
}

.search-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #cbd5e1;
  border-top-color: #d71920;
  border-radius: 50%;
  animation: locSpin 0.75s linear infinite;
  flex-shrink: 0;
}

@keyframes locSpin {
  to {
    transform: rotate(360deg);
  }
}

.btn-clear-search {
  border: none;
  background: #f1f5f9;
  color: #475569;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.btn-clear-search:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.search-error-msg {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #b91c1c;
}

.suggestions-dropdown {
  list-style: none;
  margin: 4px 0 0;
  padding: 6px;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.12);
  max-height: 240px;
  overflow-y: auto;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.suggestion-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.suggestion-btn:hover {
  background: #fff1f2;
  border-color: #fda4af;
}

.sug-pin-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.sug-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.sug-title {
  font-size: 13.5px;
  font-weight: 800;
  color: #0f172a;
}

.sug-sub {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sug-select-pill {
  font-size: 11px;
  font-weight: 800;
  color: #d71920;
  background: #ffffff;
  border: 1px solid #fecdd3;
  padding: 3px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.no-suggestions-box {
  font-size: 12px;
  color: #64748b;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 9px;
  padding: 8px 12px;
}
</style>

