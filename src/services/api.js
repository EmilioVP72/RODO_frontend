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

export async function initializeCsrf() {
  const backendBase = import.meta.env.VITE_API_URL
    ? new URL(import.meta.env.VITE_API_URL).origin
    : 'http://localhost:8000'

  await axios.get(`${backendBase}/sanctum/csrf-cookie`, {
    withCredentials: true,
  })
}

export default api