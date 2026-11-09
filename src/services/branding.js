import { reactive } from 'vue'
import api from './api'

const STORAGE_KEY = 'rodo_app_branding'

function getInitialBranding() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        logo_image_url: parsed?.logo_image_url || null,
        banner_image_url: parsed?.banner_image_url || null,
      }
    }
  } catch {
    // ignore storage errors
  }
  return {
    logo_image_url: null,
    banner_image_url: null,
  }
}

export const appBranding = reactive(getInitialBranding())

export function applyBrandingState(data) {
  if (!data || typeof data !== 'object') return
  appBranding.logo_image_url = data.logo_image_url || null
  appBranding.banner_image_url = data.banner_image_url || null
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        logo_image_url: appBranding.logo_image_url,
        banner_image_url: appBranding.banner_image_url,
      })
    )
  } catch {
    // ignore storage quota errors
  }
}

export async function fetchAppBranding() {
  try {
    const response = await api.get('/settings/branding', {
      params: { _t: Date.now() },
    })
    if (response.data?.data) {
      applyBrandingState(response.data.data)
    }
  } catch {
    // fallback silencioso a caché local o valores por defecto
  }
  return appBranding
}
