<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api, { initializeCsrf } from '../../services/api'

const router = useRouter()

// Estado del restaurante y la sesión
const restaurant = ref(null)
const loading = ref(false)
const error = ref('')
const result = ref(null)
const copySuccess = ref(false)

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

// Estado del cálculo automático de distancia desde la ubicación del local
const autoDistanceLoading = ref(false)
const autoDistanceStatus = ref('')
const autoDistanceSuccess = ref(false)
let autoDistanceTimer = null

async function autoCalculateRouteDistance(manualTrigger = false) {
  if (!restaurant.value) return

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

// Módulo de OCR / Escaneo de ticket
const ticketFileInput = ref(null)
const imagePreview = ref('')
const ocrStatus = ref('La lectura automática procesa el ticket en tu navegador para agilizar la captura.')
const ocrLoading = ref(false)

// Función inteligente para descomponer y repartir los datos del ticket en cada campo del formulario
function parseTicketText(rawText, currentRestaurantName = '') {
  const parsed = {
    customer_name: '',
    customer_phone: '',
    street: '',
    neighborhood: '',
    address_reference: '',
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

  const rawLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const consumedIndices = new Set()

  // 1. Teléfono del cliente (10 dígitos)
  const phoneRegexLabeled = /(?:tel(?:[eé]fono)?|cel(?:ular)?|whatsapp|wa|m[oó]vil|contacto)[\s:#.-]*(\+?52[\s-]?)?(\(?\d{2,3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/i
  const phoneRegexGeneric = /(?:\+?52[\s-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const match = line.match(phoneRegexLabeled)
    if (match) {
      const digits = match[0].replace(/\D/g, '').slice(-10)
      if (digits.length === 10) {
        parsed.customer_phone = digits
        if (line.replace(phoneRegexLabeled, '').trim().length < 4) {
          consumedIndices.add(i)
        }
        break
      }
    }
  }

  if (!parsed.customer_phone) {
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      if (/\b(?:202\d|19\d\d)\b/.test(line) && line.includes('/')) continue
      const match = line.match(phoneRegexGeneric)
      if (match) {
        const digits = match[0].replace(/\D/g, '').slice(-10)
        if (digits.length === 10 && !digits.startsWith('00') && !digits.startsWith('202')) {
          parsed.customer_phone = digits
          if (line.replace(phoneRegexGeneric, '').trim().length < 4) {
            consumedIndices.add(i)
          }
          break
        }
      }
    }
  }

  // 2. Nombre del cliente (con etiqueta explícita)
  const nameRegex = /(?:cliente|nombre(?: del cliente)?|para|destinatario|at(?:['’]n|enci[oó]n)|entregar a|orden a nombre de)[\s:#.-]+(.+)/i
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const match = line.match(nameRegex)
    if (match) {
      let nameVal = match[1].trim()
      nameVal = nameVal.replace(phoneRegexGeneric, '').replace(/tel.*$/i, '').trim()
      nameVal = nameVal.replace(/^[-:#.\s]+|[-:#.\s]+$/g, '')
      if (nameVal.length >= 2) {
        parsed.customer_name = nameVal
        consumedIndices.add(i)
        break
      }
    }
  }

  // 3. Dirección: Calle y número, Colonia, Referencias
  const addressRegex = /(?:direcci[oó]n|domicilio|dir|entrega(?: en)?|enviar a|calle y n[uú]mero)[\s:#.-]+(.+)/i
  const colOnlyRegex = /^(?:colonia|col\.?|fracc(?:ionamiento)?|barrio|frac\.?)[\s:#.-]+(.+)$/i
  const refRegex = /^(?:ref(?:erencias?)?|cruzamientos?|entre calles?|entre|cruce|fachada|port[oó]n|color)[\s:#.-]*(.+)$/i

  for (let i = 0; i < rawLines.length; i++) {
    if (consumedIndices.has(i)) continue
    const line = rawLines[i]

    // Si tiene etiqueta explícita de dirección: "Dirección: Calle 65..."
    const addrMatch = line.match(addressRegex)
    if (addrMatch && !parsed.street) {
      parsed.street = addrMatch[1].trim().replace(/^[-:#.\s]+|[-:#.\s]+$/g, '')
      consumedIndices.add(i)
      continue
    }

    // Si la línea contiene calle Y colonia juntos: "Calle 45 #200 x 28 y 30 Col. Industrial"
    const streetAndColMatch = line.match(/^(.*?)(?:,\s*|\s+)(?:colonia|col\.?|fracc(?:ionamiento)?|frac\.?)\s*[:.-]?\s*(.*)$/i)
    if (streetAndColMatch && /\b(calle|c\.|av\.?|avenida|blvd\.?|#)\b/i.test(streetAndColMatch[1])) {
      if (!parsed.street) parsed.street = streetAndColMatch[1].trim()
      if (!parsed.neighborhood && streetAndColMatch[2]) parsed.neighborhood = streetAndColMatch[2].trim()
      consumedIndices.add(i)
      continue
    }

    // Si es sólo colonia
    const colMatch = line.match(colOnlyRegex)
    if (colMatch && !parsed.neighborhood) {
      parsed.neighborhood = colMatch[1].trim().replace(/^[-:#.\s]+|[-:#.\s]+$/g, '')
      consumedIndices.add(i)
      continue
    }

    // Si es referencia
    const refMatch = line.match(refRegex)
    if (refMatch && !parsed.address_reference) {
      parsed.address_reference = line.trim().replace(/^[-:#.\s]+|[-:#.\s]+$/g, '')
      consumedIndices.add(i)
      continue
    }
  }

  // Patrones naturales de calle si no se detectó por etiqueta
  if (!parsed.street) {
    for (let i = 0; i < rawLines.length; i++) {
      if (consumedIndices.has(i)) continue
      const line = rawLines[i]
      const isStreetPattern =
        /\b(calle|callej[oó]n|av\.?|avenida|blvd\.?|boulevard|circuito|andador|retorno|diag\.?|diagonal|ampliaci[oó]n|privada|cerrada|c\.)\s+[0-9a-záéíóúñ#.-]+/i.test(line) ||
        (/#\s*\d+/i.test(line) && !/ticket|folio|orden\s*#|pedido\s*#|mesa/i.test(line))

      if (isStreetPattern) {
        parsed.street = line
        consumedIndices.add(i)
        break
      }
    }
  }

  // Separar colonia y referencias si quedaron embebidas en street
  if (parsed.street) {
    const splitColMatch = parsed.street.match(/^(.*?)(?:,\s*|\s+)(?:colonia|col\.?|fracc(?:ionamiento)?|frac\.?)\s*[:.-]?\s*(.*)$/i)
    if (splitColMatch) {
      parsed.street = splitColMatch[1].trim()
      if (!parsed.neighborhood && splitColMatch[2]) {
        parsed.neighborhood = splitColMatch[2].trim()
      }
    }

    if (parsed.neighborhood && !parsed.address_reference) {
      const refInCol = parsed.neighborhood.match(/^(.*?)(?:,\s*|\s+)(?:ref(?:erencias?)?|cruzamientos?|entre calles?|entre|frente a|fachada)[:\s.-]+(.*)$/i)
      if (refInCol) {
        parsed.neighborhood = refInCol[1].trim()
        parsed.address_reference = refInCol[2].trim()
      }
    }

    if (!parsed.address_reference) {
      const crossMatch = parsed.street.match(/^(.*?)\s+(?:entre\s+(\d+\s+y\s+\d+|[^\n,]+)|x\s+(\d+\s+y\s+\d+))(.*)$/i)
      if (crossMatch) {
        parsed.address_reference = (crossMatch[2] ? `Entre ${crossMatch[2]}` : `Entre ${crossMatch[3]}`) + (crossMatch[4] || '')
        parsed.address_reference = parsed.address_reference.trim()
      }
    }
  }

  // 2B. Fallback para nombre del cliente si no tuvo etiqueta explícita
  if (!parsed.customer_name) {
    for (let i = 0; i < Math.min(rawLines.length, 5); i++) {
      if (consumedIndices.has(i)) continue
      const line = rawLines[i].trim()
      const words = line.split(/\s+/)
      const isNameLike =
        words.length >= 2 &&
        words.length <= 4 &&
        !/\d/.test(line) &&
        !/\b(?:ticket|folio|orden|pedido|fecha|hora|calle|av|col|total|pago|sucursal|tacos?|pizza|burger|refresco)\b/i.test(line) &&
        (!currentRestaurantName || !line.toLowerCase().includes(currentRestaurantName.toLowerCase()))

      if (isNameLike) {
        parsed.customer_name = line
        consumedIndices.add(i)
        break
      }
    }
  }

  // 4. Importe a cobrar (Total del ticket)
  const totalRegex = /(?:total a pagar|total|gran total|importe total|importe|a pagar|monto a cobrar|cobrar|saldo)[\s:#$]*(\d{1,5}(?:[.,]\d{1,2})?)/i
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (/subtotal/i.test(line) && !/total a pagar|gran total/i.test(line)) continue
    const match = line.match(totalRegex)
    if (match) {
      const num = parseFloat(match[1].replace(',', '.'))
      if (!isNaN(num) && num > 0) {
        parsed.amount_to_collect = num
        consumedIndices.add(i)
        break
      }
    }
  }

  // 5. Forma de pago
  const fullText = rawText.toLowerCase()
  if (/\b(transferencia|spei|transfer|dep[oó]sito)\b/i.test(fullText)) {
    parsed.payment_method = 'Transferencia'
  } else if (/\b(tarjeta|terminal|d[eé]bito|cr[eé]dito|visa|mastercard|amex|terminal bancaria)\b/i.test(fullText)) {
    parsed.payment_method = 'Tarjeta / pedido pagado'
  } else if (/\b(contra\s*entrega|contraentrega|cobro al entregar)\b/i.test(fullText)) {
    parsed.payment_method = 'Pago contra entrega'
  } else if (/\b(efectivo|cash|paga con|su pago|billete|cambio|recibido)\b/i.test(fullText)) {
    parsed.payment_method = 'Efectivo'
  }

  // 6. Cambio y Paga con
  const payWithRegex = /(?:paga con(?: billete de)?|su pago|efectivo recibido|recibido|paga)[\s:#$]*(\d{2,5})/i
  const changeRegex = /(?:cambio|su cambio)[\s:#$]*(\d{1,5}(?:[.,]\d{1,2})?)/i

  let matchedBill = null
  let matchedChange = null

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const payMatch = line.match(payWithRegex)
    if (payMatch) {
      matchedBill = parseInt(payMatch[1], 10)
      consumedIndices.add(i)
    }
    const chMatch = line.match(changeRegex)
    if (chMatch) {
      matchedChange = parseFloat(chMatch[1].replace(',', '.'))
      consumedIndices.add(i)
    }
  }

  if (matchedBill || matchedChange) {
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

  // 7. Comentarios o notas para el repartidor
  const commentRegex = /(?:notas?|comentarios?|observaci[oó]n(?:es)?|obs\.?|instrucciones?|indicaciones?)[\s:#.-]+(.+)/i
  for (let i = 0; i < rawLines.length; i++) {
    if (consumedIndices.has(i)) continue
    const line = rawLines[i]
    const match = line.match(commentRegex)
    if (match) {
      parsed.comments = match[1].trim()
      consumedIndices.add(i)
      break
    }
  }

  // 8. Filtro para descartar encabezados, subtotales o líneas de sistema en la descripción
  const isIgnoredLine = (line) => {
    const l = line.toLowerCase()
    if (/\b(?:ticket\s*#?|folio\s*#?|orden\s*#|pedido\s*#|nro\.\s*orden|sucursal|rfc|cajero|mesa\s*#?|terminal\s*#?|turno|hora|fecha|pos)\b/i.test(l)) return true
    if (currentRestaurantName && l.includes(currentRestaurantName.toLowerCase())) return true
    if (/\b(?:subtotal|iva|tax|propina|descuento|total a pagar|total)\b/i.test(l)) return true
    if (/\b(?:efectivo|cambio|tarjeta|transferencia|paga con|su pago|recibido|visa|mastercard|contra\s*entrega|cobro)\b/i.test(l)) return true
    if (/\b(?:gracias por su|vuelva pronto|facturaci[oó]n|factura|software|sistema|atendido por|tel[eé]fono|tel\.|cel\.|cliente|domicilio|direcci[oó]n)\b/i.test(l)) return true
    if (/^[-=*_.~#\s]+$/.test(line)) return true
    if (/^\$?\s*\d+(?:[.,]\d{1,2})?\s*$/.test(line)) return true
    return false
  }

  // 9. Extraer productos / platillos (Descripción del pedido)
  const productLines = []
  for (let i = 0; i < rawLines.length; i++) {
    if (consumedIndices.has(i)) continue
    const line = rawLines[i]
    if (isIgnoredLine(line)) continue

    let cleanedProduct = line
      .replace(/[\s.$]+(?:\d{1,4}(?:[.,]\d{2})?)\s*$/, '')
      .replace(/[.]+$/, '')
      .trim()

    if (cleanedProduct.length >= 3) {
      productLines.push(cleanedProduct)
    }
  }

  parsed.description = productLines.join('\n')

  // 10. Nivel de cuidado del pedido automático según platillos detectados
  const combinedDesc = (parsed.description + ' ' + (parsed.comments || '')).toLowerCase()
  if (/\bpizza\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Mantener horizontal')
  }
  if (/\b(?:sopa|caldo|bebida|refresco|coca|pepsi|soda|jugo|caf[eé]|agua|malteada|frapp[eé]|vaso|cerveza)\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Puede derramarse')
  }
  if (/\b(?:caliente|pozole|birria|hamburguesa|burger|tacos?|comida|pizza|alitas|boneless|pollo)\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Mantener caliente')
  }
  if (/\b(?:fr[aá]gil|delicado|pastel|pay|postre|flan|brownie|huevo)\b/i.test(combinedDesc)) {
    parsed.care_instructions.push('Frágil o delicado')
  }

  return parsed
}

async function handleTicketUpload(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return

  imagePreview.value = URL.createObjectURL(file)
  ocrLoading.value = true
  ocrStatus.value = 'Foto cargada. Preparando motor de reconocimiento OCR…'

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

    ocrStatus.value = 'Leyendo ticket. Analizando texto…'
    const resultOcr = await window.Tesseract.recognize(file, 'spa+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          ocrStatus.value = `Reconociendo texto: ${Math.round((m.progress || 0) * 100)}%`
        }
      },
    })

    const text = resultOcr?.data?.text || ''
    const parsed = parseTicketText(text, restaurant.value?.name || '')

    // Repartir ordenadamente cada dato en su campo correspondiente del formulario
    if (parsed.customer_name) {
      form.customer_name = parsed.customer_name
    }
    if (parsed.customer_phone) {
      form.customer_phone = parsed.customer_phone
    }
    if (parsed.street) {
      form.street = parsed.street
    }
    if (parsed.neighborhood) {
      form.neighborhood = parsed.neighborhood
    }
    if (parsed.address_reference) {
      form.address_reference = parsed.address_reference
    }
    if (parsed.amount_to_collect !== null) {
      form.amount_to_collect = parsed.amount_to_collect
    }
    if (parsed.payment_method) {
      form.payment_method = parsed.payment_method
    }
    if (parsed.needs_change) {
      form.needs_change = true
      form.change_option = parsed.change_option
      form.change_other = parsed.change_other
    }
    if (parsed.description) {
      form.description = parsed.description
    }
    if (parsed.comments) {
      form.comments = parsed.comments
    }
    if (parsed.care_instructions.length) {
      parsed.care_instructions.forEach((item) => {
        if (!form.care_instructions.includes(item)) {
          form.care_instructions.push(item)
        }
      })
    }

    ocrStatus.value = '✓ Ticket leído con éxito. Cada dato fue colocado en su campo respectivo del formulario.'
    showToast('¡Ticket procesado! Datos distribuidos en el formulario.', 'success')

    // Si el restaurante tiene ubicación registrada, calcular distancia automáticamente con los datos del ticket
    if (hasRegisteredLocation.value && (form.street || form.neighborhood)) {
      await autoCalculateRouteDistance(false)
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
  imagePreview.value = ''
  ocrStatus.value = 'La lectura automática procesa el ticket en tu navegador para agilizar la captura.'
}

// Solicitud rápida de repartidores
const selectedRiders = ref(1)
const quickNote = ref('')
const quickLoading = ref(false)
const quickResult = ref(null)
const quickCopySuccess = ref(false)

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
  const note = quickResult.value.note ? `\n📝 *Nota:* ${quickResult.value.note}` : ''
  const codeBadge = code ? ` (#${code})` : ''

  const message = [
    `🛵 *RODO MOTO MANDADOS*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *Solicitud Urgente de Repartidores*`,
    ``,
    `🏪 *Local:* ${restaurantName}${codeBadge}`,
    `📋 *Folio:* ${folio}`,
    `🏍️ *Repartidores requeridos:* ${count}${note}`,
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
  quickCopySuccess.value = false
  showToast('Puedes realizar una nueva solicitud de repartidores.', 'info')
}

async function submitQuickRequest() {
  if (!restaurant.value) {
    showToast('No hay una sesión activa de restaurante.', 'error')
    return
  }

  quickLoading.value = true
  try {
    await initializeCsrf()
    const payload = {
      riders_count: selectedRiders.value,
      note: quickNote.value.trim() ? quickNote.value.trim() : null,
    }
    const response = await api.post('/rider-requests', payload)
    quickResult.value = response.data.data
    showToast(`¡Solicitud enviada para ${selectedRiders.value} repartidor(es)!`, 'success')
  } catch (err) {
    const msg = err.response?.data?.message || 'No se pudo enviar la solicitud de repartidores.'
    showToast(msg, 'error')
  } finally {
    quickLoading.value = false
  }
}

// Carga inicial de datos de sesión
onMounted(async () => {
  try {
    const response = await api.get('/restaurant/me')
    restaurant.value = response.data.data
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
        return
      } catch (recoveryErr) {
        console.warn('Auto-recuperación de sesión fallida:', recoveryErr)
      }
    }

    error.value = 'No hay una sesión válida. Inicia sesión o registra tu restaurante.'
  }
})

// Envío del pedido a Laravel
async function submitOrder() {
  error.value = ''
  result.value = null

  if (!restaurant.value) {
    error.value = 'Debes iniciar sesión como restaurante.'
    return
  }

  // Si aún no hay distancia pero sí tiene ubicación en BD (con o sin tarifa fija), intentar calcularla antes de registrar el pedido
  if (
    hasRegisteredLocation.value &&
    (form.distance_km === '' || form.distance_km === null || Number(form.distance_km) === 0)
  ) {
    await autoCalculateRouteDistance(false)
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
    }

    const response = await api.post('/orders', payload)
    result.value = response.data.data
    showToast('¡Pedido registrado correctamente!', 'success')
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

    <!-- Encabezado con identidad RODO -->
    <header class="portal-header">
      <div class="header-inner">
        <div class="brand-group">
          <div class="logo-box">RODO</div>
          <div class="brand-text">
            <h1>RODO Moto Mandados</h1>
            <p>Portal privado para locales · Solicitud de repartidores</p>
          </div>
        </div>

        <div v-if="restaurant" class="header-restaurant-pill">
          <span class="online-indicator" />
          <span class="restaurant-name">{{ restaurant.name }}</span>
          <span class="restaurant-code">#{{ restaurant.code }}</span>
        </div>
      </div>
    </header>

    <main class="portal-main">

      <!-- Título de sección -->
      <div class="intro-section">
        <h2>Solicitar una entrega</h2>
        <p>Registra los datos del pedido en pocos pasos o toma una foto del ticket para intentar llenar los campos automáticamente.</p>
      </div>

      <!-- Pantalla de confirmación y Ticket Digital (Fase 3.4) -->
      <section v-if="result" class="card result-card">
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
            🔑 Iniciar sesión / Registrar
          </router-link>
        </div>
      </div>

      <!-- Tarjeta cuando no hay sesión activa identificada -->
      <div v-if="!restaurant && !result" class="card" style="text-align: center; padding: 48px 24px; margin-top: 16px;">
        <div style="font-size: 48px; margin-bottom: 12px;">🏪</div>
        <h3 style="font-size: 1.35rem; margin-bottom: 8px; color: #1e293b; font-weight: 800;">Identificación requerida</h3>
        <p style="color: #64748b; max-width: 480px; margin: 0 auto 24px; font-size: 0.95rem; line-height: 1.5;">
          Para poder registrar pedidos y solicitar repartidores, ingresa con el nombre o código de tu establecimiento.
        </p>
        <router-link
          to="/registro"
          style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #d71920, #b9151b); color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 700; box-shadow: 0 4px 12px rgba(215, 25, 32, 0.3);"
        >
          Iniciar sesión o Registrarse →
        </router-link>
      </div>

      <!-- Formulario principal de pedido -->
      <form v-if="restaurant && !result" class="card form-card" @submit.prevent="submitOrder">

        <!-- Sucursal activa identificada -->
        <div class="selected-local-banner">
          <div class="local-banner-row">
            <div>
              <div class="local-banner-content">
                <span class="banner-badge">LOCAL AUTORIZADO</span>
                <strong>{{ restaurant.name }}</strong>
                <span class="badge-code">Código #{{ restaurant.code }}</span>
              </div>
              <p class="help-micro">Tu sucursal está autenticada mediante tu sesión activa en RODO.</p>
            </div>

            <a
              :href="assistanceWhatsappUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="btn-assistance-top"
              title="Contactar a Asistencia RODO por WhatsApp (415 101 9920)"
            >
              <span>🎧</span>
              <span>Asistencia</span>
            </a>
          </div>
        </div>

        <!-- Encabezado de sección de entrega -->
        <div class="section-heading">
          <h3>Datos de la entrega</h3>
          <p class="sub">Registra los datos del pedido o toma una foto del ticket para intentar llenar los campos automáticamente.</p>
        </div>

        <!-- Módulo de Escaneo / Foto del Ticket -->
        <div class="scan-box">
          <div class="scan-header">
            <div class="scan-icon-badge">📷</div>
            <div class="scan-text">
              <h4>Tomar foto o subir el ticket del local</h4>
              <p>Usa la cámara del celular o elige una foto del ticket. El sistema intentará reconocer el texto y completar los campos. Revisa y corrige los datos antes de enviar.</p>
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
              📸 {{ ocrLoading ? 'Procesando imagen...' : 'Tomar foto / elegir imagen' }}
            </label>

            <button
              v-if="imagePreview"
              type="button"
              class="btn-scan btn-scan-clear"
              @click="clearTicketPhoto"
            >
              Quitar foto
            </button>
          </div>

          <!-- Vista previa de foto -->
          <div v-if="imagePreview" class="preview-container">
            <img :src="imagePreview" alt="Vista previa del ticket" class="ticket-preview-img">
          </div>

          <!-- Estado del OCR -->
          <div class="ocr-status-box" :class="{ 'ocr-busy': ocrLoading }">
            <span v-if="ocrLoading" class="mini-spinner" />
            <span>{{ ocrStatus }}</span>
          </div>
        </div>

        <!-- Grid de campos de entrega -->
        <div class="fields-grid">

          <!-- Nombre del cliente (opcional) -->
          <div class="field-group">
            <label for="customer_name">Nombre del cliente (opcional)</label>
            <input
              id="customer_name"
              v-model="form.customer_name"
              type="text"
              maxlength="150"
              placeholder="Nombre del cliente"
            >
          </div>

          <!-- Teléfono del cliente (obligatorio) -->
          <div class="field-group">
            <label for="customer_phone">Teléfono del cliente *</label>
            <input
              id="customer_phone"
              v-model="form.customer_phone"
              type="tel"
              maxlength="25"
              required
              placeholder="Número de contacto (10 dígitos)"
            >
          </div>

          <!-- Calle y número (full width) -->
          <div class="field-group full-width">
            <label for="street">Calle y número *</label>
            <input
              id="street"
              v-model="form.street"
              type="text"
              maxlength="255"
              required
              placeholder="Ej. Av. Juárez #123 entre 50 y 52"
            >
          </div>

          <!-- Colonia -->
          <div class="field-group">
            <label for="neighborhood">Colonia *</label>
            <input
              id="neighborhood"
              v-model="form.neighborhood"
              type="text"
              maxlength="150"
              required
              placeholder="Nombre de la colonia"
            >
          </div>

          <!-- Referencias del domicilio -->
          <div class="field-group">
            <label for="address_reference">Referencias del domicilio</label>
            <input
              id="address_reference"
              v-model="form.address_reference"
              type="text"
              placeholder="Entre calles, color de fachada o negocio cercano"
            >
          </div>

          <!-- Ubicación exacta (Google Maps) -->
          <div class="field-group full-width">
            <label for="map_url">Ubicación exacta (opcional)</label>
            <input
              id="map_url"
              v-model="form.map_url"
              type="text"
              placeholder="Pega enlace de Google Maps del cliente si lo tienes"
            >
          </div>

          <!-- Distancia y cálculo de tarifa (full width) -->
          <div class="field-group full-width distance-calc-card">
            <div class="distance-card-header">
              <span class="distance-icon">{{ hasFixedFee ? '📌' : hasRegisteredLocation ? '🛰️' : '🛵' }}</span>
              <div>
                <label for="distance_km" class="distance-title">
                  <template v-if="hasFixedFee">
                    Tarifa Fija Establecida para {{ restaurant.name }}
                  </template>
                  <template v-else-if="hasRegisteredLocation">
                    Distancia y Tarifa Automática (Ubicación de Sucursal Activa)
                  </template>
                  <template v-else>
                    Distancia por calles desde la sucursal al cliente (km) *
                  </template>
                </label>
                <p class="distance-sub">
                  <template v-if="hasFixedFee">
                    Tu local tiene asignada una tarifa fija de entrega en el sistema. La distancia en kilómetros se calcula para colocarla en el ticket.
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

            <!-- Estado del cálculo automático cuando el restaurante tiene ubicación en BD (con o sin tarifa fija) -->
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
                  'Al ingresar la calle y colonia (o enlace de mapa) del cliente, calcularemos los kilómetros automáticamente.'
                }}
              </span>
            </div>

            <!-- Input de distancia (bloqueado automáticamente tras calcularse con la ubicación del local) -->
            <div class="distance-input-row">
              <div class="input-with-km">
                <input
                  id="distance_km"
                  v-model.number="form.distance_km"
                  type="number"
                  min="0"
                  :max="hasFixedFee ? 50 : 5"
                  step="0.1"
                  :required="!hasFixedFee"
                  :disabled="autoDistanceSuccess || autoDistanceLoading"
                  :readonly="autoDistanceSuccess || autoDistanceLoading"
                  :class="{ 'input-locked': autoDistanceSuccess }"
                  :title="autoDistanceSuccess ? 'Distancia calculada automáticamente. No se puede modificar.' : ''"
                  :placeholder="hasRegisteredLocation ? 'Se calcula automáticamente (Ej. 2.5)' : 'Ej. 2.5'"
                >
                <span class="km-unit-badge" :class="{ 'is-locked': autoDistanceSuccess }">
                  {{ autoDistanceSuccess ? '🔒 km' : 'km' }}
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
                        ? hasFixedFee
                          ? '🔒 Km calculados'
                          : '🔒 Tarifa bloqueada'
                        : hasRegisteredLocation
                          ? '🛰️ Calcular con ubicación'
                          : hasFixedFee
                            ? 'Actualizar km'
                            : 'Calcular tarifa'
                  }}
                </span>
              </button>
            </div>

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

              <!-- Caso 3: Esperando distancia -->
              <div v-else class="price-waiting-content">
                <span class="waiting-icon">💡</span>
                <div>
                  <strong>Introduce la distancia en kilómetros</strong>
                  <p>La tarifa se calculará automáticamente en tiempo real (mínimo $40, hasta 5 km de radio).</p>
                </div>
              </div>
            </div>

          </div>

          <!-- Forma de pago -->
          <div class="field-group">
            <label for="payment_method">Forma de pago</label>
            <select id="payment_method" v-model="form.payment_method">
              <option value="">Seleccionar...</option>
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Tarjeta / pedido pagado">Tarjeta / pedido pagado</option>
              <option value="Pago contra entrega">Pago contra entrega</option>
            </select>
          </div>

          <!-- Importe a cobrar -->
          <div class="field-group">
            <label for="amount_to_collect">Importe a cobrar (si aplica)</label>
            <input
              id="amount_to_collect"
              v-model="form.amount_to_collect"
              type="number"
              min="0"
              step="0.01"
              placeholder="Ej. 350.00"
            >
          </div>

          <!-- ¿El cliente necesita cambio? -->
          <div class="field-group full-width change-section">
            <label class="checkbox-container">
              <input v-model="form.needs_change" type="checkbox">
              <span class="checkbox-label">Sí, el cliente pagará con un billete y necesita cambio.</span>
            </label>

            <div v-if="form.needs_change" class="change-detail-box">
              <label for="change_option">¿Paga con cuánto? *</label>
              <select id="change_option" v-model="form.change_option" required>
                <option value="">Seleccionar billete...</option>
                <option value="100">$100</option>
                <option value="200">$200</option>
                <option value="500">$500</option>
                <option value="1000">$1,000</option>
                <option value="Otro">Otro importe (especificar)</option>
              </select>

              <input
                v-if="form.change_option === 'Otro'"
                v-model="form.change_other"
                type="text"
                class="other-change-input"
                placeholder="Especifica el monto o billete (Ej. 300)"
                required
              >
            </div>
          </div>

          <!-- Descripción del pedido -->
          <div class="field-group full-width">
            <label for="description">Descripción del pedido</label>
            <textarea
              id="description"
              v-model="form.description"
              rows="3"
              placeholder="Ej. 2 pizzas grandes; refresco de 2L"
            />
          </div>

          <!-- Comentarios para el repartidor -->
          <div class="field-group full-width">
            <label for="comments">Comentarios para el repartidor</label>
            <textarea
              id="comments"
              v-model="form.comments"
              rows="3"
              placeholder="Instrucciones específicas de recolección o entrega"
            />
          </div>

        </div>

        <!-- Sección 2: Nivel de cuidado del pedido -->
        <div class="care-section">
          <div class="section-heading">
            <h3>2. Nivel de cuidado del pedido</h3>
            <p class="sub">Marca todas las indicaciones que correspondan.</p>
          </div>

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

          <!-- Otra indicación de cuidado -->
          <div class="field-group" style="margin-top: 14px;">
            <label for="care_other">Otra indicación de cuidado</label>
            <input
              id="care_other"
              v-model="form.care_other"
              type="text"
              placeholder="Ej. No inclinar la bolsa, llevar térmico"
            >
          </div>

          <!-- Checkbox Pedido Listo -->
          <label class="checkbox-container ready-checkbox-box">
            <input v-model="form.is_ready" type="checkbox">
            <span class="checkbox-label font-bold">El pedido ya está listo; necesito que RODO envíe al repartidor.</span>
          </label>
        </div>

        <!-- Botón de envío -->
        <button
          type="submit"
          class="btn-submit-order"
          :disabled="loading || calculatedFee.status === 'out_of_coverage' || calculatedFee.status === 'invalid'"
        >
          <span v-if="loading" class="mini-spinner mr-2" />
          {{ loading ? 'Solicitando entrega...' : 'Solicitar entrega' }}
        </button>

        <!-- Botón de Asistencia directa por WhatsApp (415 101 9920) -->
        <div class="assistance-box">
          <div class="assistance-info">
            <strong>¿Algún inconveniente con el envío o con el repartidor?</strong>
            <span>Comunícate de inmediato con soporte para resolver cualquier detalle.</span>
          </div>
          <a
            :href="assistanceWhatsappUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-assistance-form"
          >
            <span>🎧</span>
            <span>Asistencia</span>
          </a>
        </div>

        <p class="footer-help">
          Los datos se registran directamente en el sistema central de RODO Moto Mandados para su coordinación inmediata.
        </p>

      </form>

      <!-- Card 2: Solicitar repartidores rápidamente -->
      <section v-if="restaurant && !result" class="card quick-riders-card">

        <!-- Estado: Confirmación de Solicitud de Repartidores Enviada -->
        <div v-if="quickResult" class="quick-result-view">
          <div class="quick-result-header">
            <div class="quick-check-badge">⚡</div>
            <div>
              <h3>¡Solicitud de repartidores enviada al líder!</h3>
              <p class="sub">Se generó la URL en tiempo real para coordinar el envío de tus repartidores.</p>
            </div>
          </div>

          <div class="quick-summary-grid">
            <div class="summary-box">
              <span class="box-label">FOLIO DE SOLICITUD</span>
              <strong class="box-value folio-mono">{{ quickResult.folio }}</strong>
            </div>
            <div class="summary-box">
              <span class="box-label">REPARTIDORES PEDIDOS</span>
              <strong class="box-value riders-highlight">
                {{ quickResult.riders_count }} {{ quickResult.riders_count === 1 ? 'Repartidor' : 'Repartidores' }} 🛵
              </strong>
            </div>
            <div class="summary-box">
              <span class="box-label">ESTADO ACTUAL</span>
              <span class="badge-status status-pending">Pendiente de asignación</span>
            </div>
          </div>

          <div v-if="quickResult.note" class="quick-note-preview">
            <strong>Nota enviada:</strong> “{{ quickResult.note }}”
          </div>

          <!-- Botones de Acción para la Solicitud -->
          <div class="result-action-buttons">
            <router-link
              :to="'/solicitud/' + quickResult.public_token"
              target="_blank"
              class="action-btn btn-view-ticket"
            >
              <span>👁️</span>
              <span>Ver página de solicitud</span>
            </router-link>

            <button
              type="button"
              class="action-btn btn-copy"
              @click="copyQuickRiderLink"
            >
              <span>🔗</span>
              <span>{{ quickCopySuccess ? '¡Enlace copiado!' : 'Copiar enlace de solicitud' }}</span>
            </button>

            <a
              :href="quickWhatsappUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="action-btn btn-whatsapp"
            >
              <span>📲</span>
              <span>Enviar por WhatsApp al líder</span>
            </a>

            <button
              type="button"
              class="action-btn btn-reset"
              @click="resetQuickRequest"
            >
              <span>➕</span>
              <span>Hacer otra solicitud</span>
            </button>
          </div>
        </div>

        <!-- Estado: Formulario para solicitar repartidores -->
        <div v-else>
          <div class="quick-header">
            <div class="lightning-icon">⚡</div>
            <div>
              <h3>Solicitar repartidores rápidamente</h3>
              <p class="sub">Para cuando tienes múltiples pedidos listos o mucha demanda en el mostrador del local.</p>
            </div>
          </div>

          <div class="rider-options-grid">
            <button
              v-for="count in [1, 2, 3, 4]"
              :key="count"
              type="button"
              class="rider-btn"
              :class="{ 'active': selectedRiders === count }"
              @click="selectedRiders = count"
            >
              <strong>{{ count }}</strong>
              <span>{{ count === 1 ? 'Repartidor' : 'Repartidores' }}</span>
            </button>
          </div>

          <div class="field-group" style="margin-top: 18px;">
            <label for="quick_note">Nota o mensaje (opcional)</label>
            <input
              id="quick_note"
              v-model="quickNote"
              type="text"
              placeholder="Ej. Hay cuatro pedidos listos en mostrador, llevar mochilas térmicas"
            >
          </div>

          <button
            type="button"
            class="btn-quick-request"
            :disabled="quickLoading"
            @click="submitQuickRequest"
          >
            <span v-if="quickLoading" class="mini-spinner mr-2" />
            {{ quickLoading ? 'Enviando solicitud...' : `Solicitar ${selectedRiders} repartidor${selectedRiders > 1 ? 'es' : ''} ahora` }}
          </button>

          <p class="help-micro" style="margin-top: 10px;">
            Al presionar este botón se generará una URL oficial y podrás enviar el enlace por WhatsApp directamente al líder.
          </p>
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

.intro-section {
  margin-bottom: 22px;
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

/* Caja de escaneo OCR */
.scan-box {
  border: 1.5px dashed #e4a1a5;
  background: #fff9f9;
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 22px;
  transition: border-color 0.2s ease;
}

.scan-box:hover {
  border-color: #d71920;
}

.scan-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 14px;
}

.scan-icon-badge {
  font-size: 28px;
  background: #fee2e2;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.scan-text h4 {
  margin: 0 0 5px;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.scan-text p {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.45;
}

.scan-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
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

.btn-scan-upload input[type="file"] {
  display: none;
}

.btn-scan-clear {
  background: #ffffff;
  color: #d71920;
  border: 1px solid #efb5b8;
}

.btn-scan-clear:hover {
  background: #fff0f0;
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
  gap: 18px 22px;
  margin-bottom: 24px;
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
  font-size: 13px;
  font-weight: 700;
  color: #202124;
}

input,
select,
textarea {
  width: 100%;
  border: 1.5px solid #d5d7dc;
  border-radius: 10px;
  padding: 12px 14px;
  font: inherit;
  font-size: 14px;
  background: #ffffff;
  color: #202124;
  box-sizing: border-box;
  transition: all 0.15s ease;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #d71920;
  box-shadow: 0 0 0 3px rgba(215, 25, 32, 0.12);
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

.quick-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.lightning-icon {
  font-size: 26px;
  background: #f1f5f9;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
}

.rider-options-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 12px;
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
  .brand-text p {
    font-size: 11px;
  }
  .header-restaurant-pill {
    width: 100%;
    justify-content: space-between;
    box-sizing: border-box;
  }
  .portal-main {
    padding: 0 12px 40px;
    margin: 14px auto;
  }
  .intro-section h2 {
    font-size: 21px;
  }
  .card {
    padding: 16px 14px;
    border-radius: 14px;
  }
  input,
  select,
  textarea {
    font-size: 16px;
    padding: 12px;
  }
  .scan-box {
    padding: 14px;
  }
  .scan-actions {
    flex-direction: column;
    align-items: stretch;
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
  .result-summary-grid,
  .quick-summary-grid {
    grid-template-columns: 1fr;
  }
  .result-action-buttons {
    grid-template-columns: 1fr;
  }
  .btn-assistance-top,
  .btn-assistance-form {
    width: 100%;
    justify-content: center;
    box-sizing: border-box;
  }
  .assistance-box {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>