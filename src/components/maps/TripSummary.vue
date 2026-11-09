<script setup>
defineProps({
  originAddress: {
    type: String,
    default: '',
  },
  destinationAddress: {
    type: String,
    default: '',
  },
  distanceKm: {
    type: [Number, String],
    default: null,
  },
  durationMinutes: {
    type: [Number, String],
    default: null,
  },
  estimatedFee: {
    type: [Number, String],
    default: null,
  },
  isFixedFee: {
    type: Boolean,
    default: false,
  },
  outOfCoverage: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  showFee: {
    type: Boolean,
    default: true,
  },
  errorMessage: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <div class="trip-summary-card">
    <div class="trip-summary-header">
      <span class="trip-summary-badge">🗺️ RESUMEN DE RUTA POR CARRETERA</span>
      <span v-if="loading" class="trip-status-pill is-loading">Calculando ruta...</span>
      <span v-else-if="errorMessage" class="trip-status-pill is-error">Ruta pendiente</span>
      <span v-else-if="distanceKm !== null && distanceKm !== ''" class="trip-status-pill is-ready">
        ✓ Ruta verificada
      </span>
    </div>

    <!-- Puntos A y B -->
    <div class="trip-points-grid">
      <div class="trip-point-row">
        <span class="point-marker marker-a">A</span>
        <div class="point-details">
          <span class="point-role">ORIGEN (ESTABLECIMIENTO)</span>
          <strong class="point-address">{{ originAddress || 'Ubicación del restaurante' }}</strong>
        </div>
      </div>

      <div class="trip-point-row">
        <span class="point-marker marker-b">B</span>
        <div class="point-details">
          <span class="point-role">DESTINO (ENTREGA AL CLIENTE)</span>
          <strong class="point-address">
            {{ destinationAddress || 'Selecciona o busca el destino en el mapa' }}
          </strong>
        </div>
      </div>
    </div>

    <!-- Estado de Carga -->
    <div v-if="loading" class="trip-state-box state-loading">
      <span class="trip-spinner" />
      <span>Trazando ruta real por calles y calculando distancia...</span>
    </div>

    <!-- Estado de Error -->
    <div v-else-if="errorMessage" class="trip-state-box state-error">
      <span>⚠️</span>
      <span>{{ errorMessage }}</span>
    </div>

    <!-- Métricas de la Ruta (Distancia, Duración y Tarifa) -->
    <div
      v-else-if="distanceKm !== null && distanceKm !== '' && Number(distanceKm) > 0"
      class="trip-metrics-grid"
    >
      <div class="trip-metric-box">
        <span class="metric-label">DISTANCIA VIAL</span>
        <strong class="metric-value">{{ Number(distanceKm).toFixed(1) }} km</strong>
        <span class="metric-sub">Por carretera / calles</span>
      </div>

      <div class="trip-metric-box">
        <span class="metric-label">TIEMPO ESTIMADO</span>
        <strong class="metric-value">
          {{
            durationMinutes !== null && durationMinutes !== '' && Number(durationMinutes) > 0
              ? `${Math.max(1, Math.round(Number(durationMinutes)))} min`
              : `${Math.max(3, Math.round((Number(distanceKm) / 25) * 60))} min`
          }}
        </strong>
        <span class="metric-sub">En motocicleta</span>
      </div>

      <div v-if="showFee" class="trip-metric-box metric-fee-highlight">
        <span class="metric-label">
          {{ isFixedFee ? 'TARIFA FIJA CONVENIO' : 'TARIFA ESTIMADA' }}
        </span>
        <strong v-if="outOfCoverage && !isFixedFee" class="metric-value text-amber">
          Fuera de rango (>5 km)
        </strong>
        <strong v-else-if="estimatedFee !== null && estimatedFee !== ''" class="metric-value text-red">
          ${{ Number(estimatedFee).toFixed(2) }} MXN
        </strong>
        <strong v-else class="metric-value">--</strong>
        <span class="metric-sub">
          {{ isFixedFee ? 'Tarifa autorizada del local' : 'Fórmula oficial RODO' }}
        </span>
      </div>
    </div>

    <!-- Estado inicial sin ruta -->
    <div v-else class="trip-state-box state-empty">
      <span>🛵</span>
      <span>
        Ingresa la dirección del cliente o selecciona el <strong>Punto B</strong> en el mapa para ver la ruta, los kilómetros y el tiempo estimado.
      </span>
    </div>
  </div>
</template>

<style scoped>
.trip-summary-card {
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 14px 16px;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trip-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.trip-summary-badge {
  font-size: 11.5px;
  font-weight: 800;
  color: #334155;
  letter-spacing: 0.4px;
}

.trip-status-pill {
  font-size: 11.5px;
  font-weight: 800;
  padding: 3px 9px;
  border-radius: 999px;
}

.trip-status-pill.is-loading {
  background: #fef3c7;
  color: #b45309;
}

.trip-status-pill.is-error {
  background: #fee2e2;
  color: #b91c1c;
}

.trip-status-pill.is-ready {
  background: #dcfce7;
  color: #15803d;
}

.trip-points-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.trip-point-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
}

.point-marker {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #ffffff;
  font-size: 12px;
  font-weight: 900;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.marker-a {
  background: #d71920;
}

.marker-b {
  background: #0f172a;
}

.point-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.point-role {
  font-size: 10.5px;
  font-weight: 800;
  color: #64748b;
  letter-spacing: 0.3px;
}

.point-address {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.35;
  word-break: break-word;
}

.trip-metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.trip-metric-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 11px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-fee-highlight {
  border-color: #fecaca;
  background: #fff5f5;
}

.metric-label {
  font-size: 10.5px;
  font-weight: 800;
  color: #64748b;
  letter-spacing: 0.4px;
}

.metric-value {
  font-size: 19px;
  font-weight: 900;
  color: #0f172a;
}

.metric-value.text-red {
  color: #d71920;
}

.metric-value.text-amber {
  font-size: 14px;
  color: #b45309;
}

.metric-sub {
  font-size: 11px;
  color: #64748b;
}

.trip-state-box {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
}

.state-loading {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #b45309;
}

.state-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.state-empty {
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  color: #475569;
}

.trip-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid #fcd34d;
  border-top-color: #b45309;
  border-radius: 50%;
  animation: tripSpin 0.75s linear infinite;
  flex-shrink: 0;
}

@keyframes tripSpin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .trip-points-grid,
  .trip-metrics-grid {
    grid-template-columns: 1fr;
  }
}
</style>

