import { useState, useMemo } from 'react';
import type { EnvironmentLayerVisibility } from '../../types';
import { environmentSensors } from '../../data/environmentSensors';
import './EnvironmentAnalyticsPanel.scss';

interface EnvironmentAnalyticsPanelProps {
  envLayers: EnvironmentLayerVisibility;
  onClose: () => void;
}

type Tab = 'heatmap' | 'sensors' | 'wind' | 'sources';

const TAB_META: Record<Tab, { icon: string; label: string; color: string }> = {
  heatmap: { icon: '🗺️', label: 'AQI Heatmap',        color: '#FF6B35' },
  sensors: { icon: '📡', label: 'Sensor Network',      color: '#00E5FF' },
  wind:    { icon: '💨', label: 'Wind Patterns',       color: '#4FC3F7' },
  sources: { icon: '🏭', label: 'Pollution Sources',   color: '#FF9800' },
};

// Generate 24-hour historical trend data from current sensor readings
function generateHourlyTrend(baseValue: number, variance: number, hours = 24) {
  return Array.from({ length: hours }, (_, i) => {
    const hour = (new Date().getHours() - (hours - 1 - i) + 24) % 24;
    // Morning peak (7-9am) and evening peak (5-7pm)
    const peakFactor = (hour >= 7 && hour <= 9) ? 1.3
      : (hour >= 17 && hour <= 19) ? 1.25
      : (hour >= 0 && hour <= 5) ? 0.65
      : 1.0;
    const noise = (Math.random() - 0.5) * variance;
    return {
      hour: `${String(hour).padStart(2, '0')}:00`,
      value: Math.max(0, Math.round(baseValue * peakFactor + noise)),
    };
  });
}

function getAqiColor(aqi: number): string {
  if (aqi <= 50)  return '#00E400';
  if (aqi <= 100) return '#FFFF00';
  if (aqi <= 150) return '#FF7E00';
  if (aqi <= 200) return '#FF0000';
  if (aqi <= 300) return '#8F3F97';
  return '#7E0023';
}

function getAqiLabel(aqi: number): string {
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy (Sensitive)';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

// Simple bar chart component
function SparkBar({ data, color, unit }: { data: { hour: string; value: number }[]; color: string; unit: string }) {
  const max = Math.max(...data.map(d => d.value));
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="spark-bar">
      <div className="spark-bar__chart">
        {data.map((d, i) => (
          <div
            key={i}
            className="spark-bar__col"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className="spark-bar__bar"
              style={{ height: `${(d.value / max) * 100}%`, background: color }}
            />
            {hovered === i && (
              <div className="spark-bar__tooltip">
                <span className="spark-bar__tooltip-time">{d.hour}</span>
                <span className="spark-bar__tooltip-val">{d.value} {unit}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="spark-bar__labels">
        {[0, 6, 12, 18, 23].map(i => (
          <span key={i} className="spark-bar__label">{data[i]?.hour || ''}</span>
        ))}
      </div>
    </div>
  );
}

// Gauge ring component
function GaugeRing({ value, max, color, label, unit }: {
  value: number; max: number; color: string; label: string; unit: string;
}) {
  const pct = Math.min(value / max, 1);
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;

  return (
    <div className="gauge-ring">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
          style={{ transition: 'stroke-dasharray 0.6s ease', filter: `drop-shadow(0 0 4px ${color}88)` }}
        />
        <text x="40" y="36" textAnchor="middle" fill="white" fontSize="13" fontWeight="700">{value}</text>
        <text x="40" y="49" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="8">{unit}</text>
      </svg>
      <span className="gauge-ring__label">{label}</span>
    </div>
  );
}

export default function EnvironmentAnalyticsPanel({ envLayers, onClose }: EnvironmentAnalyticsPanelProps) {
  // Default active tab = whatever layer is ON, else 'heatmap'
  const defaultTab = (Object.keys(envLayers) as Tab[]).find(k => envLayers[k]) ?? 'heatmap';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  // Aggregate sensor stats
  const stats = useMemo(() => {
    const aqis   = environmentSensors.map(s => s.aqi);
    const pm25s  = environmentSensors.map(s => s.pm25);
    const temps  = environmentSensors.map(s => s.temperature);
    const winds  = environmentSensors.map(s => s.windSpeed);
    const critical = environmentSensors.filter(s => s.status === 'critical').length;
    const warning  = environmentSensors.filter(s => s.status === 'warning').length;
    const normal   = environmentSensors.filter(s => s.status === 'normal').length;
    const avgAqi   = Math.round(aqis.reduce((a, b) => a + b, 0) / aqis.length);
    const maxAqi   = Math.max(...aqis);
    const minAqi   = Math.min(...aqis);
    const avgPm25  = Math.round(pm25s.reduce((a, b) => a + b, 0) / pm25s.length);
    const avgTemp  = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
    const avgWind  = Math.round(winds.reduce((a, b) => a + b, 0) / winds.length);
    return { avgAqi, maxAqi, minAqi, avgPm25, avgTemp, avgWind, critical, warning, normal };
  }, []);

  const aqiTrend    = useMemo(() => generateHourlyTrend(stats.avgAqi, 25), [stats.avgAqi]);
  const pm25Trend   = useMemo(() => generateHourlyTrend(stats.avgPm25, 15), [stats.avgPm25]);
  const windTrend   = useMemo(() => generateHourlyTrend(stats.avgWind, 6), [stats.avgWind]);
  const tempTrend   = useMemo(() => generateHourlyTrend(stats.avgTemp, 3), [stats.avgTemp]);

  const topSensors = useMemo(() =>
    [...environmentSensors].sort((a, b) => b.aqi - a.aqi).slice(0, 6),
  []);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'heatmap':
        return (
          <div className="env-panel__content">
            {/* AQI Summary Gauges */}
            <div className="env-panel__section-title">AQI Overview — DSO Average</div>
            <div className="env-panel__gauges">
              <GaugeRing value={stats.avgAqi} max={300} color={getAqiColor(stats.avgAqi)} label="Avg AQI" unit="AQI" />
              <GaugeRing value={stats.avgPm25} max={150} color="#FF9800" label="PM2.5"    unit="µg/m³" />
              <GaugeRing value={stats.avgTemp} max={50}  color="#4FC3F7" label="Temp"     unit="°C" />
            </div>

            <div className="env-panel__aqi-badge" style={{ borderColor: getAqiColor(stats.avgAqi), color: getAqiColor(stats.avgAqi) }}>
              {getAqiLabel(stats.avgAqi)}
            </div>

            {/* Status breakdown */}
            <div className="env-panel__section-title">Sensor Status Breakdown</div>
            <div className="env-panel__status-bars">
              <div className="env-panel__status-row">
                <span className="env-panel__status-dot env-panel__status-dot--critical" />
                <span className="env-panel__status-name">Critical</span>
                <div className="env-panel__status-bar-wrap">
                  <div className="env-panel__status-bar" style={{ width: `${(stats.critical / environmentSensors.length) * 100}%`, background: '#FF5252' }} />
                </div>
                <span className="env-panel__status-count">{stats.critical}</span>
              </div>
              <div className="env-panel__status-row">
                <span className="env-panel__status-dot env-panel__status-dot--warning" />
                <span className="env-panel__status-name">Warning</span>
                <div className="env-panel__status-bar-wrap">
                  <div className="env-panel__status-bar" style={{ width: `${(stats.warning / environmentSensors.length) * 100}%`, background: '#FF9800' }} />
                </div>
                <span className="env-panel__status-count">{stats.warning}</span>
              </div>
              <div className="env-panel__status-row">
                <span className="env-panel__status-dot env-panel__status-dot--normal" />
                <span className="env-panel__status-name">Normal</span>
                <div className="env-panel__status-bar-wrap">
                  <div className="env-panel__status-bar" style={{ width: `${(stats.normal / environmentSensors.length) * 100}%`, background: '#00E400' }} />
                </div>
                <span className="env-panel__status-count">{stats.normal}</span>
              </div>
            </div>

            {/* 24h trend */}
            <div className="env-panel__section-title">24-Hour AQI Trend</div>
            <SparkBar data={aqiTrend} color={getAqiColor(stats.avgAqi)} unit="AQI" />

            <div className="env-panel__section-title">24-Hour PM2.5 Trend</div>
            <SparkBar data={pm25Trend} color="#FF9800" unit="µg/m³" />
          </div>
        );

      case 'sensors':
        return (
          <div className="env-panel__content">
            <div className="env-panel__section-title">Network Summary</div>
            <div className="env-panel__kpi-row">
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val">{environmentSensors.length}</span>
                <span className="env-panel__kpi-lbl">Total Sensors</span>
              </div>
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val" style={{ color: '#FF5252' }}>{stats.critical}</span>
                <span className="env-panel__kpi-lbl">Critical</span>
              </div>
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val" style={{ color: '#FF9800' }}>{stats.warning}</span>
                <span className="env-panel__kpi-lbl">Warning</span>
              </div>
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val" style={{ color: '#00E400' }}>{stats.normal}</span>
                <span className="env-panel__kpi-lbl">Normal</span>
              </div>
            </div>

            <div className="env-panel__section-title">Highest AQI Sensors</div>
            <div className="env-panel__sensor-list">
              {topSensors.map(s => (
                <div key={s.sensor_id} className={`env-panel__sensor-item env-panel__sensor-item--${s.status}`}>
                  <div className="env-panel__sensor-header">
                    <span className="env-panel__sensor-id">{s.sensor_id}</span>
                    <span className="env-panel__sensor-aqi" style={{ color: getAqiColor(s.aqi) }}>{s.aqi}</span>
                  </div>
                  <div className="env-panel__sensor-name">{s.name}</div>
                  <div className="env-panel__sensor-meta">
                    <span>PM2.5: {s.pm25} µg/m³</span>
                    <span>NO₂: {s.no2} µg/m³</span>
                    <span>Temp: {s.temperature}°C</span>
                  </div>
                  <div className="env-panel__sensor-bar-wrap">
                    <div
                      className="env-panel__sensor-bar"
                      style={{ width: `${Math.min((s.aqi / 300) * 100, 100)}%`, background: getAqiColor(s.aqi) }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="env-panel__section-title">24-Hour PM2.5 Trend</div>
            <SparkBar data={pm25Trend} color="#00E5FF" unit="µg/m³" />
          </div>
        );

      case 'wind':
        return (
          <div className="env-panel__content">
            <div className="env-panel__section-title">Wind Overview</div>
            <div className="env-panel__gauges">
              <GaugeRing value={stats.avgWind} max={60}         color="#4FC3F7" label="Avg Speed"  unit="km/h" />
              <GaugeRing value={Math.max(...environmentSensors.map(s => s.windSpeed))} max={60} color="#81D4FA" label="Max Speed" unit="km/h" />
              <GaugeRing value={stats.avgTemp}                  max={50}        color="#FF9800"  label="Temp"       unit="°C" />
            </div>

            <div className="env-panel__section-title">Wind Direction Distribution</div>
            <div className="env-panel__wind-compass">
              <div className="env-panel__compass-rose">
                {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((dir, i) => {
                  const angle = i * 45;
                  const count = environmentSensors.filter(s => {
                    const a = (s.windDirection - angle + 360) % 360;
                    return a < 22.5 || a >= 337.5;
                  }).length;
                  return (
                    <div
                      key={dir}
                      className="env-panel__compass-dir"
                      style={{ transform: `rotate(${angle}deg) translateY(-26px) rotate(-${angle}deg)` }}
                    >
                      <div
                        className="env-panel__compass-bar"
                        style={{ height: `${4 + count * 4}px`, background: count > 3 ? '#00E5FF' : 'rgba(0,229,255,0.3)' }}
                      />
                      <span className="env-panel__compass-label">{dir}</span>
                    </div>
                  );
                })}
                <div className="env-panel__compass-center">💨</div>
              </div>
            </div>

            <div className="env-panel__section-title">24-Hour Wind Speed Trend</div>
            <SparkBar data={windTrend} color="#4FC3F7" unit="km/h" />

            <div className="env-panel__section-title">24-Hour Temperature Trend</div>
            <SparkBar data={tempTrend} color="#FF9800" unit="°C" />

            <div className="env-panel__section-title">Pollution Dispersion Risk</div>
            <div className="env-panel__risk-grid">
              {environmentSensors.filter(s => s.windSpeed < 8).slice(0, 4).map(s => (
                <div key={s.sensor_id} className="env-panel__risk-item">
                  <span className="env-panel__risk-dot" style={{ background: '#FF9800' }} />
                  <span className="env-panel__risk-name">{s.name}</span>
                  <span className="env-panel__risk-val">{s.windSpeed} km/h</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'sources':
        return (
          <div className="env-panel__content">
            <div className="env-panel__section-title">Emission Source Summary</div>
            <div className="env-panel__kpi-row">
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val" style={{ color: '#FF5252' }}>
                  {environmentSensors.filter(s => s.status === 'critical').length}
                </span>
                <span className="env-panel__kpi-lbl">High Emission</span>
              </div>
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val" style={{ color: '#FF9800' }}>
                  {environmentSensors.filter(s => s.status === 'warning').length}
                </span>
                <span className="env-panel__kpi-lbl">Moderate</span>
              </div>
              <div className="env-panel__kpi">
                <span className="env-panel__kpi-val" style={{ color: '#00E400' }}>
                  {environmentSensors.filter(s => s.status === 'normal').length}
                </span>
                <span className="env-panel__kpi-lbl">Compliant</span>
              </div>
            </div>

            <div className="env-panel__section-title">Top Polluted Zones</div>
            <div className="env-panel__zone-list">
              {(['Main Road', 'Commercial', 'Industrial', 'Residential', 'Construction'] as const).map(zone => {
                const zoneSensors = environmentSensors.filter(s => s.zone === zone);
                if (!zoneSensors.length) return null;
                const avgAqi = Math.round(zoneSensors.reduce((a, s) => a + s.aqi, 0) / zoneSensors.length);
                return (
                  <div key={zone} className="env-panel__zone-item">
                    <div className="env-panel__zone-header">
                      <span className="env-panel__zone-name">{zone}</span>
                      <span className="env-panel__zone-aqi" style={{ color: getAqiColor(avgAqi) }}>{avgAqi} AQI</span>
                    </div>
                    <div className="env-panel__zone-bar-wrap">
                      <div
                        className="env-panel__zone-bar"
                        style={{ width: `${Math.min((avgAqi / 250) * 100, 100)}%`, background: getAqiColor(avgAqi) }}
                      />
                    </div>
                    <span className="env-panel__zone-sensors">{zoneSensors.length} sensors · {getAqiLabel(avgAqi)}</span>
                  </div>
                );
              })}
            </div>

            <div className="env-panel__section-title">Emission Trend (Avg AQI by Zone)</div>
            <SparkBar data={aqiTrend} color="#FF9800" unit="AQI" />
          </div>
        );
    }
  };

  return (
    <div className="env-panel">
      {/* Header */}
      <div className="env-panel__header">
        <div className="env-panel__header-left">
          <span className="env-panel__header-icon">🌿</span>
          <div>
            <div className="env-panel__header-title">Environmental Monitoring</div>
            <div className="env-panel__header-sub">Dubai Silicon Oasis · Live Data</div>
          </div>
        </div>
        <button className="env-panel__close" onClick={onClose}>✕</button>
      </div>

      {/* Live indicator */}
      <div className="env-panel__live">
        <span className="env-panel__live-dot" />
        <span>LIVE · {new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="env-panel__live-sep">|</span>
        <span>{environmentSensors.length} sensors active</span>
      </div>

      {/* Tabs */}
      <div className="env-panel__tabs">
        {(Object.entries(TAB_META) as [Tab, typeof TAB_META[Tab]][]).map(([key, meta]) => (
          <button
            key={key}
            className={`env-panel__tab ${activeTab === key ? 'env-panel__tab--active' : ''} ${envLayers[key] ? 'env-panel__tab--on' : ''}`}
            onClick={() => setActiveTab(key)}
            style={activeTab === key ? { borderBottomColor: meta.color, color: meta.color } : {}}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
            {envLayers[key] && <span className="env-panel__tab-badge" style={{ background: meta.color }}>ON</span>}
          </button>
        ))}
      </div>

      {/* Scrollable body */}
      <div className="env-panel__body">
        {renderTabContent()}
      </div>
    </div>
  );
}
