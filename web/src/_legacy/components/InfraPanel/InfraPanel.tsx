import { useEffect, useRef } from 'react';
import type { SelectedInfra } from '../../types';
import './InfraPanel.scss';

interface InfraPanelProps {
  infra: SelectedInfra | null;
  onClose: () => void;
}

// ── Category metadata ──────────────────────────────────────────────────────
interface InfraMeta {
  label:       string;
  icon:        string;
  color:       string;
  status:      string;
  statusColor: string;
  description: string;
  category:    string;
}

const META: Record<string, InfraMeta> = {
  traffic_signals: {
    label: 'Traffic Signal',      icon: '🚦', color: '#C62828',
    status: 'Active',             statusColor: '#2E7D32',
    description: 'Automated traffic control signal managing vehicle and pedestrian flow.',
    category: 'Traffic Management',
  },
  bus_stop: {
    label: 'Bus Stop',            icon: '🚌', color: '#1565C0',
    status: 'In Service',         statusColor: '#2E7D32',
    description: 'Designated public transport boarding and alighting point.',
    category: 'Public Transport',
  },
  crossing: {
    label: 'Pedestrian Crossing', icon: '🚶', color: '#00796B',
    status: 'Active',             statusColor: '#2E7D32',
    description: 'Designated safe crossing point for pedestrians.',
    category: 'Pedestrian Safety',
  },
  speed_camera: {
    label: 'Speed Camera',        icon: '📷', color: '#212121',
    status: 'Monitoring',         statusColor: '#E65100',
    description: 'Automated speed enforcement and traffic monitoring device.',
    category: 'Traffic Enforcement',
  },
  cctv: {
    label: 'CCTV Camera',         icon: '📹', color: '#455A64',
    status: 'Monitoring',         statusColor: '#E65100',
    description: 'Closed-circuit surveillance camera for public area security.',
    category: 'Security & Surveillance',
  },
  street_lamp: {
    label: 'Street Lamp',         icon: '💡', color: '#F9A825',
    status: 'Operational',        statusColor: '#2E7D32',
    description: 'Public street lighting fixture providing nighttime illumination.',
    category: 'Public Lighting',
  },
  roundabout: {
    label: 'Roundabout',          icon: '🔄', color: '#2E7D32',
    status: 'Active',             statusColor: '#2E7D32',
    description: 'Circular road junction controlling traffic flow without signals.',
    category: 'Road Infrastructure',
  },
  mast: {
    label: 'Communications Mast', icon: '📡', color: '#546E7A',
    status: 'Operational',        statusColor: '#2E7D32',
    description: 'Telecommunications or broadcasting antenna structure.',
    category: 'Communications',
  },
  flagpole: {
    label: 'Flagpole',            icon: '🚩', color: '#E65100',
    status: 'Standing',           statusColor: '#2E7D32',
    description: 'Vertical pole structure for displaying flags or banners.',
    category: 'Civic Structure',
  },
  tower: {
    label: 'Tower',               icon: '🗼', color: '#5D4037',
    status: 'Standing',           statusColor: '#2E7D32',
    description: 'Structural tower for observation, water storage, or utility purposes.',
    category: 'Utility Structure',
  },
  water_tap: {
    label: 'Water Tap',           icon: '💧', color: '#0097A7',
    status: 'Available',          statusColor: '#2E7D32',
    description: 'Public access point for potable or utility water.',
    category: 'Water Infrastructure',
  },
  fire_hydrant: {
    label: 'Fire Hydrant',        icon: '🚒', color: '#B71C1C',
    status: 'Standby',            statusColor: '#C62828',
    description: 'Emergency water supply outlet for fire-fighting operations.',
    category: 'Fire Safety',
  },
  power_substation: {
    label: 'Power Substation',    icon: '⚡', color: '#F57F17',
    status: 'Operational',        statusColor: '#2E7D32',
    description: 'Electrical substation transforming and distributing power across the grid.',
    category: 'Power Infrastructure',
  },
  ev_charging: {
    label: 'EV Charging Station', icon: '🔌', color: '#1565C0',
    status: 'Available',          statusColor: '#2E7D32',
    description: 'Electric vehicle charging point with Type 2 connector.',
    category: 'Electric Mobility',
  },
  recycling: {
    label: 'Recycling Point',     icon: '♻️', color: '#2E7D32',
    status: 'In Use',             statusColor: '#2E7D32',
    description: 'Container collection point for recyclable materials including glass and paper.',
    category: 'Waste Management',
  },
  waste_basket: {
    label: 'Waste Basket',        icon: '🗑️', color: '#546E7A',
    status: 'In Service',         statusColor: '#2E7D32',
    description: 'Public waste collection bin for street-level refuse disposal.',
    category: 'Waste Management',
  },
  drinking_water: {
    label: 'Drinking Water',      icon: '🚰', color: '#0277BD',
    status: 'Available',          statusColor: '#2E7D32',
    description: 'Public potable water fountain or standpipe.',
    category: 'Water Infrastructure',
  },
  toilets: {
    label: 'Public Toilets',      icon: '🚻', color: '#3949AB',
    status: 'Open',               statusColor: '#2E7D32',
    description: 'Publicly accessible restroom facility.',
    category: 'Public Amenity',
  },
  wastewater_plant: {
    label: 'Wastewater Plant',    icon: '🏭', color: '#004D40',
    status: 'Operating',          statusColor: '#2E7D32',
    description: 'Facility treating and processing wastewater before discharge or reuse.',
    category: 'Utilities',
  },
  pumping_station: {
    label: 'Pumping Station',     icon: '💦', color: '#01579B',
    status: 'Operating',          statusColor: '#2E7D32',
    description: 'Water or sewage pumping infrastructure maintaining flow through the network.',
    category: 'Utilities',
  },
};

const FALLBACK_META: InfraMeta = {
  label: 'Infrastructure',    icon: '⚙️', color: '#546E7A',
  status: 'Present',          statusColor: '#546E7A',
  description: 'Urban infrastructure element.',
  category: 'General',
};

// ── Helpers ────────────────────────────────────────────────────────────────
const s = (v: string | null | undefined) =>
  v && v !== 'null' && v !== 'undefined' && v.trim() ? v.trim() : null;

const fmt = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const formatCoord = (n: number) => n.toFixed(6);

// ── Info row ──────────────────────────────────────────────────────────────
const Row = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
  <div className="ip-row">
    <span className="ip-row__icon">{icon}</span>
    <div className="ip-row__body">
      <span className="ip-row__label">{label}</span>
      <span className="ip-row__value">{value}</span>
    </div>
  </div>
);

const Divider = () => <div className="ip-divider" />;

// ── Component ─────────────────────────────────────────────────────────────
export default function InfraPanel({ infra, onClose }: InfraPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!infra) return null;

  const meta = META[infra.category] ?? FALLBACK_META;

  const nameVal      = s(infra.name);
  const refVal       = s(infra.ref);
  const operatorVal  = s(infra.operator);
  const heightVal    = s(infra.height);
  const survType     = s(infra.surveillance_type);
  const crossType    = s(infra.crossing_type);
  const trafficSig   = s(infra.traffic_signals);
  const capacityVal  = s(infra.capacity);
  const recyclType   = s(infra.recycling_type);
  const socketType   = s(infra.socket_type);

  const title = nameVal ?? meta.label;

  // Selected-at timestamp
  const timeStr = new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className={`infra-panel infra-panel--open`} ref={panelRef}>

      {/* ── Top accent bar colored by category ─────────────────────── */}
      <div className="ip-accent" style={{ background: meta.color }} />

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="ip-header">
        <div className="ip-header__left">
          <div className="ip-header__icon-wrap" style={{ background: meta.color + '18', borderColor: meta.color + '40' }}>
            <span className="ip-header__icon">{meta.icon}</span>
          </div>
          <div>
            <h2 className="ip-header__title">{title}</h2>
            <div className="ip-header__category">{meta.category}</div>
          </div>
        </div>
        <button className="ip-close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>

      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div className="ip-status-bar">
        <div className="ip-status">
          <span className="ip-status__dot ip-status__dot--pulse" style={{ background: meta.statusColor }} />
          <span className="ip-status__text" style={{ color: meta.statusColor }}>{meta.status}</span>
        </div>
        <div className="ip-timestamp">
          <span className="ip-timestamp__icon">🕐</span>
          <span>{timeStr}</span>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="ip-body">

        {/* Location — compact coordinates */}
        <section className="ip-section">
          <h3 className="ip-section__title"><span>📍</span> Location</h3>
          <Row icon="🌐" label="Longitude" value={formatCoord(infra.lngLat[0])} />
          <Row icon="🌐" label="Latitude"  value={formatCoord(infra.lngLat[1])} />
        </section>

        {/* Key properties — only if data exists */}
        {(refVal || operatorVal || heightVal || capacityVal || socketType || recyclType) && (
          <>
            <Divider />
            <section className="ip-section">
              <h3 className="ip-section__title"><span>🔧</span> Details</h3>
              {refVal       && <Row icon="🔢" label="Reference"    value={refVal} />}
              {operatorVal  && <Row icon="🏢" label="Operator"     value={operatorVal} />}
              {heightVal    && <Row icon="📏" label="Height"       value={heightVal + ' m'} />}
              {capacityVal  && <Row icon="🔢" label="Capacity"     value={capacityVal} />}
              {socketType   && <Row icon="🔌" label="Socket"       value={fmt(socketType)} />}
              {recyclType   && <Row icon="♻️" label="Recycling"    value={fmt(recyclType)} />}
            </section>
          </>
        )}

        {/* Technical — only surveillance / crossing / signal */}
        {(survType || crossType || trafficSig) && (
          <>
            <Divider />
            <section className="ip-section">
              <h3 className="ip-section__title"><span>📊</span> Technical</h3>
              {survType   && <Row icon="📷" label="Surveillance" value={fmt(survType)} />}
              {crossType  && <Row icon="🚶" label="Crossing"     value={fmt(crossType)} />}
              {trafficSig && <Row icon="🚦" label="Signal"       value={fmt(trafficSig)} />}
            </section>
          </>
        )}

      </div>
    </div>
  );
}
