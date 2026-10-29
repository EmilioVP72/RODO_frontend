import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  withXSRFToken: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 15000,
})

// Automatically attach Bearer token and Restaurant code headers to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rodo_token') || sessionStorage.getItem('rodo_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  const code = localStorage.getItem('rodo_restaurant_code') || sessionStorage.getItem('rodo_restaurant_code')
  if (code) {
    config.headers['X-Restaurant-Code'] = code
  }

  return config
})

export async function initializeCsrf() {
  const backendBase = import.meta.env.VITE_API_URL
    ? new URL(import.meta.env.VITE_API_URL).origin
    : 'http://localhost:8000'

  try {
    await axios.get(`${backendBase}/sanctum/csrf-cookie`, {
      withCredentials: true,
    })
  } catch (err) {
    // In cross-domain deployments (e.g. Vercel -> Render), third-party cookies
    // may be blocked by browser policy. Bearer token auth ensures flawless operation.
    console.warn('CSRF cookie init notice:', err?.message || err)
  }
}

export default api