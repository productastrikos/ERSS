import type { LayerVisibility } from '../../types';
import './MapControls.scss';

// ── Map style definitions ───────────────────────────────────────────────────
const MAP_STYLES = [
  {
    url:   'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    label: 'Dark',
    icon:  '🌙',
    key:   'dark-matter',
  }
];

interface MapControlsProps {
  visibility:      LayerVisibility;
  onToggle:        (layer: keyof LayerVisibility) => void;
  mapStyleUrl:     string;
  onStyleChange:   (url: string) => void;
}

const LAYER_LABELS: Record<keyof LayerVisibility, { label: string; icon: string }> = {
  boundary:       { label: 'DSO Boundary',    icon: '⬡' },
  buildings:      { label: '3D Buildings',    icon: '🏢' },
  roads:          { label: 'Roads',           icon: '🛣️' },
  parks:          { label: 'Parks & Green',   icon: '🌳' },
  water:          { label: 'Water Bodies',    icon: '💧' },
  railways:       { label: 'Railways',        icon: '🚇' },
  pois:           { label: 'POIs & Assets',   icon: '📍' },
  infrastructure: { label: 'Infrastructure',  icon: '🚦' },
  environment:    { label: 'Environment AQI', icon: '🌡️' },
};

export default function MapControls({ visibility, onToggle, mapStyleUrl, onStyleChange }: MapControlsProps) {
  return (
    <div className="map-controls">
      {/* ── Map Style Switcher ───────────────────────────────────── */}
      <div className="map-controls__title">Map Style</div>
      <div className="map-controls__style-switcher">
        {MAP_STYLES.map((style) => (
          <button
            key={style.key}
            className={`map-controls__style-btn ${
              mapStyleUrl === style.url ? 'map-controls__style-btn--active' : ''
            }`}
            onClick={() => onStyleChange(style.url)}
            title={`Switch to ${style.label} map`}
          >
            <span className="map-controls__style-btn-icon">{style.icon}</span>
            <span className="map-controls__style-btn-label">{style.label}</span>
          </button>
        ))}
      </div>
      <div className="map-controls__title">Layer Toggles</div>
      {(Object.keys(LAYER_LABELS) as (keyof LayerVisibility)[]).map((key) => (
        <button
          key={key}
          className={`map-controls__toggle ${visibility[key] ? 'map-controls__toggle--active' : ''}`}
          onClick={() => onToggle(key)}
          title={visibility[key] ? `Hide ${LAYER_LABELS[key].label}` : `Show ${LAYER_LABELS[key].label}`}
        >
          <span className="map-controls__toggle-icon">{LAYER_LABELS[key].icon}</span>
          <span className="map-controls__toggle-label">{LAYER_LABELS[key].label}</span>
          <span className="map-controls__toggle-badge">
            {visibility[key] ? 'ON' : 'OFF'}
          </span>
        </button>
      ))}
      <div className="map-controls__legend">
        <div className="map-controls__legend-title">Legend</div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--boundary" />
          <span>DSO Zone Boundary</span>
        </div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--building" />
          <span>Buildings (3D)</span>
        </div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--road" />
          <span>Roads</span>
        </div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--park" />
          <span>Parks</span>
        </div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--water" />
          <span>Water</span>
        </div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--landmark" />
          <span>POIs / Assets</span>
        </div>
        <div className="map-controls__legend-item">
          <span className="map-controls__legend-swatch map-controls__legend-swatch--infrastructure" />
          <span>Infrastructure</span>
        </div>
      </div>
    </div>
  );
}
