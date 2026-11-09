import api from './api'

/**
 * Configuración centralizada y desacoplada para mapas, geocodificación y rutas.
 * Permite cambiar el proveedor (ej. instancia propia de Photon/Pelias o servidor de tiles propio)
 * mediante variables de entorno sin reescribir los componentes.
 */
export const MAP_CONFIG = {
  // Coordenadas iniciales configurables (por defecto San Miguel de Allende, Gto.)
  defaultCenter: {
    lat: Number(import.meta.env.VITE_MAP_DEFAULT_LAT) || 20.9144,
    lng: Number(import.meta.env.VITE_MAP_DEFAULT_LNG) || -100.7452,
  },
  defaultZoom: Number(import.meta.env.VITE_MAP_DEFAULT_ZOOM) || 14,
  tileUrl:
    import.meta.env.VITE_MAP_TILE_URL ||
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  geocodingProvider: import.meta.env.VITE_GEOCODING_PROVIDER || 'photon',
  photonBaseUrl:
    import.meta.env.VITE_PHOTON_API_URL || 'https://photon.komoot.io/api/',
  reversePhotonUrl:
    import.meta.env.VITE_PHOTON_REVERSE_URL || 'https://photon.komoot.io/reverse',
}

// Control de tasa simple en cliente para evitar ráfagas excesivas
let lastRequestTimestamp = 0
const MIN_INTERVAL_MS = 220

/**
 * Formatea un feature GeoJSON de Photon (OpenStreetMap) en un objeto uniforme.
 */
function formatPhotonFeature(feature) {
  if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
    return null
  }

  const [lng, lat] = feature.geometry.coordinates
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  const props = feature.properties || {}
  const name = props.name || ''
  const street = props.street || ''
  const houseNumber = props.housenumber || ''
  const district = props.district || props.suburb || props.locality || ''
  const city = props.city || props.town || props.county || 'San Miguel de Allende'
  const state = props.state || 'Guanajuato'
  const postcode = props.postcode || ''

  const streetPart = street
    ? `${street}${houseNumber ? ' #' + houseNumber : ''}`
    : name

  const primaryLabel = streetPart || district || city
  const secondaryParts = [
    streetPart && name && name !== streetPart ? name : null,
    district && district !== primaryLabel ? district : null,
    city,
    state,
  ].filter(Boolean)

  const displayName = [primaryLabel, ...secondaryParts].filter(Boolean).join(', ')

  return {
    id: `${props.osm_id || ''}_${lat.toFixed(5)}_${lng.toFixed(5)}`,
    title: primaryLabel,
    subtitle: secondaryParts.join(', '),
    displayName,
    street: streetPart || name || '',
    neighborhood: district || '',
    city,
    state,
    postcode,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  }
}

/**
 * Busca sugerencias de direcciones con autocompletado usando Photon (compatible con OpenStreetMap
 * y permitido expresamente para autocompletado, a diferencia de Nominatim público).
 *
 * @param {string} query Texto de búsqueda
 * @param {object} options { biasCoords?: {lat: number, lng: number}, limit?: number, signal?: AbortSignal }
 * @returns {Promise<Array>}
 */
export async function searchAddressSuggestions(query, options = {}) {
  const cleanQuery = String(query || '').trim()
  if (cleanQuery.length < 3) {
    return []
  }

  const now = Date.now()
  const elapsed = now - lastRequestTimestamp
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed))
  }
  lastRequestTimestamp = Date.now()

  const bias = options.biasCoords || MAP_CONFIG.defaultCenter
  const limit = options.limit || 6

  const params = new URLSearchParams({
    q: cleanQuery.includes('San Miguel') || cleanQuery.includes('Guanajuato')
      ? cleanQuery
      : `${cleanQuery}, San Miguel de Allende`,
    limit: String(limit),
  })

  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    params.set('lat', String(bias.lat))
    params.set('lon', String(bias.lng))
  }

  const url = `${MAP_CONFIG.photonBaseUrl}?${params.toString()}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'es,en;q=0.8',
    },
    signal: options.signal,
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Demasiadas búsquedas seguidas. Espera un momento e intenta de nuevo.')
    }
    throw new Error('No se pudieron obtener sugerencias de dirección en este momento.')
  }

  const data = await response.json()
  const features = Array.isArray(data?.features) ? data.features : []

  const seen = new Set()
  const results = []

  for (const feature of features) {
    const formatted = formatPhotonFeature(feature)
    if (!formatted) continue
    if (seen.has(formatted.displayName)) continue
    seen.add(formatted.displayName)
    results.push(formatted)
  }

  return results
}

/**
 * Obtiene la dirección aproximada a partir de coordenadas {lat, lng} cuando se mueve un marcador en el mapa.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {AbortSignal} [signal]
 */
export async function reverseGeocodeCoordinates(lat, lng, signal) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
    })

    const response = await fetch(`${MAP_CONFIG.reversePhotonUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'es,en;q=0.8',
      },
      signal,
    })

    if (!response.ok) return null
    const data = await response.json()
    const first = data?.features?.[0]
    return first ? formatPhotonFeature(first) : null
  } catch {
    return null
  }
}

/**
 * Solicita al backend Laravel (POST /api/v1/routes/calculate) el cálculo de la ruta por carretera
 * mediante OpenRouteService.
 *
 * @param {{lat: number, lng: number}} origin
 * @param {{lat: number, lng: number}} destination
 */
export async function calculateRouteFromBackend(origin, destination) {
  const response = await api.post('/routes/calculate', {
    origin: {
      lat: Number(origin.lat),
      lng: Number(origin.lng),
    },
    destination: {
      lat: Number(destination.lat),
      lng: Number(destination.lng),
    },
  })

  return response.data
}

