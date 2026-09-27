import { useState } from 'react';
import type { TrafficView, EnvironmentLayerVisibility, BMSSubView, WaterView, WasteView } from '../../types';
import './Sidebar.scss';

// ── Module / sub-item definitions ─────────────────────────────────────────────

type SubItemKind = 'incident' | 'traffic-view' | 'env-layer' | 'bms-view' | 'water-view' | 'waste-view';

interface SubItem {
  kind:  SubItemKind;
  id:    string;       // incident id OR TrafficView id OR env layer key
  icon:  string;
  label: string;
}

interface Module {
  id:       string;
  icon:     string;
  label:    string;
  subItems: SubItem[];
}

const MODULES: Module[] = [
  // ── MOBILITY SYSTEM ────────────────────────────────────────────────────
  {
    id:    'traffic',
    icon:  '🚦',
    label: 'Traffic Signal Mgmt',
    subItems: [
      { kind: 'traffic-view', id: 'live',         icon: '🟢', label: 'Live Traffic View' },
      // { kind: 'traffic-view', id: 'prediction',   icon: '🔮', label: 'Congestion Prediction' },
      { kind: 'traffic-view', id: 'accident',     icon: '🚧', label: 'Accident Simulation' },
      // { kind: 'traffic-view', id: 'optimization', icon: '⚙',  label: 'Signal Optimization' },
    ],
  },
  // {
  //   id:    'mobility',
  //   icon:  '🔋',
  //   label: 'Mobility & EV',
  //   subItems: [
  //     { kind: 'incident', id: 'ev_charging_fault', icon: '⚡', label: 'EV Charging Fault' },
  //     { kind: 'incident', id: 'drone_incident',    icon: '🚁', label: 'Drone Incident' },
  //   ],
  // },
  // ── CITY OPERATIONS ─────────────────────────────────────────────────────
  {
    id:    'bms',
    icon:  '🏢',
    label: 'Building Mgmt',
    subItems: [
      { kind: 'bms-view', id: 'overview',   icon: '🌆', label: 'City Overview' },
      { kind: 'bms-view', id: 'energy',     icon: '⚡', label: 'Energy Monitoring' },
      { kind: 'bms-view', id: 'hvac',       icon: '🌡️', label: 'HVAC Monitoring' },
      { kind: 'bms-view', id: 'fire',       icon: '🔥', label: 'Fire & Safety' },
      { kind: 'bms-view', id: 'occupancy',  icon: '👥', label: 'Occupancy' },
      { kind: 'bms-view', id: 'water',      icon: '🚰', label: 'Water Systems' },
      { kind: 'bms-view', id: 'alerts',     icon: '🚨', label: 'Alerts & Incidents' },
    ],
  },
  {
    id:    'environment',
    icon:  '🌿',
    label: 'Environment',
    subItems: [
      // Visualization layers (toggleable)
      { kind: 'env-layer', id: 'heatmap', icon: '🗺️', label: 'AQI Heatmap' },
      { kind: 'env-layer', id: 'sensors', icon: '📡', label: 'Sensor Network' },
      { kind: 'env-layer', id: 'wind',    icon: '💨', label: 'Wind Patterns' },
      { kind: 'env-layer', id: 'sources', icon: '🏭', label: 'Pollution Sources' },
      // // Incident simulations
      // { kind: 'incident', id: 'aqi_monitoring',       icon: '🌡️', label: 'Air Quality Monitoring' },
      // { kind: 'incident', id: 'weather_monitoring',   icon: '⛅', label: 'Weather Monitoring' },
      // { kind: 'incident', id: 'pollution_sources',    icon: '🏭', label: 'Pollution Sources' },
      // { kind: 'incident', id: 'ai_prediction',        icon: '🔮', label: 'AI Prediction' },
      // { kind: 'incident', id: 'environmental_alerts', icon: '🚨', label: 'Environmental Alerts' },
    ],
  },
  {
    id:    'water',
    icon:  '💧',
    label: 'Water Pipeline Mgmt',
    subItems: [
      { kind: 'water-view', id: 'network',    icon: '🗺️', label: 'Network Overview' },
      { kind: 'water-view', id: 'monitoring', icon: '📊', label: 'Flow Monitoring' },
      { kind: 'water-view', id: 'incident',   icon: '🚨', label: 'Incident Simulation' },
    ],
  },
  // {
  //   id:    'utilities',
  //   icon:  '⚡',
  //   label: 'Utilities',
  //   subItems: [
  //     { kind: 'incident', id: 'power_grid_failure', icon: '⚡', label: 'Power Grid Failure' },
  //     { kind: 'incident', id: 'water_pipe_leak',    icon: '💧', label: 'Water Pipe Leak' },
  //   ],
  // },
  {
    id:    'waste',
    icon:  '🗑️',
    label: 'Smart Waste',
    subItems: [
      { kind: 'waste-view', id: 'bins',       icon: '🗑️', label: 'Bins Overview'        },
      { kind: 'waste-view', id: 'monitoring', icon: '📊', label: 'Fill Monitoring'       },
      { kind: 'waste-view', id: 'incident',   icon: '🚨', label: 'Incident Simulation'   },
    ],
  },
  // {
  //   id:    'streets',
  //   icon:  '🛣',
  //   label: 'Street Infra',
  //   subItems: [
  //     { kind: 'incident', id: 'streetlight_failure', icon: '💡', label: 'Streetlight Failure' },
  //   ],
  // },
  // {
  //   id:    'security',
  //   icon:  '🔒',
  //   label: 'Security',
  //   subItems: [
  //     { kind: 'incident', id: 'cyber_attack', icon: '🛡', label: 'Cyber Attack' },
  //   ],
  // },
];

const MOBILITY_IDS = ['traffic', 'mobility'];

// ── Props ─────────────────────────────────────────────────────────────────────
interface SidebarProps {
  activeModule:          string;
  onSelectModule:        (id: string) => void;
  onSelectIncident:      (id: string) => void;
  onSelectTrafficView?:  (view: TrafficView) => void;
  onToggleEnvLayer?:     (layer: keyof EnvironmentLayerVisibility) => void;
  onSelectBMSView?:      (view: BMSSubView) => void;
  onSelectWaterView?:    (view: WaterView) => void;
  onSelectWasteView?:    (view: WasteView) => void;
  activeIncidentId?:     string;
  activeBMSView?:        BMSSubView;
  activeWaterView?:      WaterView;
  activeWasteView?:      WasteView;
  envLayers?:            EnvironmentLayerVisibility;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Sidebar({
  activeModule,
  onSelectModule,
  onSelectIncident,
  onSelectTrafficView,
  onToggleEnvLayer,
  onSelectBMSView,
  onSelectWaterView,
  onSelectWasteView,
  activeIncidentId,
  activeBMSView,
  activeWaterView,
  activeWasteView,
  envLayers,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleModuleClick = (mod: Module) => {
    onSelectModule(mod.id);
    setExpanded(expanded === mod.id ? null : mod.id);
  };

  const handleSubItem = (mod: Module, item: SubItem) => {
    onSelectModule(mod.id);
    if (item.kind === 'traffic-view') {
      onSelectTrafficView?.(item.id as TrafficView);
    } else if (item.kind === 'env-layer') {
      onToggleEnvLayer?.(item.id as keyof EnvironmentLayerVisibility);
    } else if (item.kind === 'bms-view') {
      onSelectBMSView?.(item.id as BMSSubView);
    } else if (item.kind === 'water-view') {
      onSelectWaterView?.(item.id as WaterView);
    } else if (item.kind === 'waste-view') {
      onSelectWasteView?.(item.id as WasteView);
    } else {
      onSelectIncident(item.id);
    }
  };

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar__header">
        <span className="sidebar__header-icon">⬡</span>
        <span className="sidebar__header-label">Modules</span>
      </div>

      <nav className="sidebar__modules">
        {/* ── Mobility system ─────────────────────────────────────────── */}
        <div className="sidebar__section-label">MOBILITY SYSTEM</div>
        {MODULES.filter((m) => MOBILITY_IDS.includes(m.id)).map((mod) =>
          renderModule(mod, activeModule, expanded, handleModuleClick, handleSubItem, activeIncidentId, envLayers, activeBMSView, activeWaterView, activeWasteView)
        )}

        {/* ── City operations ──────────────────────────────────────────  */}
        <div className="sidebar__section-label">CITY OPERATIONS</div>
        {MODULES.filter((m) => !MOBILITY_IDS.includes(m.id)).map((mod) =>
          renderModule(mod, activeModule, expanded, handleModuleClick, handleSubItem, activeIncidentId, envLayers, activeBMSView, activeWaterView, activeWasteView)
        )}
      </nav>

      {/* Footer hint */}
      <div className="sidebar__footer">
         <div className="app-footer__center">
          Powered by&nbsp;<img src="./Astrikos Logo Transparent perfect 1.png" alt="" width={"100px"} height={"40px"}/>
          {/* <strong>Astrikos</strong> */}
        </div>
        {/* <span className="sidebar__footer-icon">💡</span>
        <span>Select a module to begin</span> */}
      </div>
    </aside>
  );
}

// ── Module render helper ──────────────────────────────────────────────────────
function renderModule(
  mod: Module,
  activeModule: string,
  expanded: string | null,
  onModuleClick: (m: Module) => void,
  onSubItem: (m: Module, i: SubItem) => void,
  activeIncidentId?: string,
  envLayers?: EnvironmentLayerVisibility,
  activeBMSView?: BMSSubView,
  activeWaterView?: WaterView,
  activeWasteView?: WasteView,
) {
  return (
    <div key={mod.id} className={`sidebar__module ${activeModule === mod.id ? 'sidebar__module--active' : ''}`}>
      <button className="sidebar__module-btn" onClick={() => onModuleClick(mod)}>
        <span className="sidebar__module-icon">{mod.icon}</span>
        <span className="sidebar__module-label">{mod.label}</span>
        {mod.subItems.length > 0 && (
          <span className="sidebar__module-badge">{mod.subItems.length}</span>
        )}
        <span className={`sidebar__module-arrow ${expanded === mod.id ? 'sidebar__module-arrow--open' : ''}`}>›</span>
      </button>

      {expanded === mod.id && (
        <ul className="sidebar__incidents">
          {mod.subItems.map((item) => {
            const isEnvLayer   = item.kind === 'env-layer';
            const isBMSView    = item.kind === 'bms-view';
            const isWaterView  = item.kind === 'water-view';
            const isWasteView  = item.kind === 'waste-view';
            const isLayerActive  = isEnvLayer  && envLayers?.[item.id as keyof EnvironmentLayerVisibility];
            const isBMSActive    = isBMSView   && activeBMSView   === item.id;
            const isWaterActive  = isWaterView  && activeWaterView === item.id;
            const isWasteActive  = isWasteView  && activeWasteView === item.id;
            
            return (
              <li
                key={item.id}
                className={[
                  'sidebar__incident',
                  item.kind === 'traffic-view'  ? 'sidebar__incident--view'   : '',
                  isEnvLayer                     ? 'sidebar__incident--layer'  : '',
                  isBMSView                      ? 'sidebar__incident--view'   : '',
                  isWaterView                    ? 'sidebar__incident--view'   : '',
                  isWasteView                    ? 'sidebar__incident--view'   : '',
                  isLayerActive || isBMSActive || isWaterActive || isWasteActive ? 'sidebar__incident--active' : '',
                  item.kind === 'incident' && activeIncidentId === item.id
                                                ? 'sidebar__incident--active' : '',
                ].join(' ')}
                onClick={() => onSubItem(mod, item)}
              >
                <span className="sidebar__incident-icon">{item.icon}</span>
                <span className="sidebar__incident-label">{item.label}</span>
                {isEnvLayer && (
                  <span className="sidebar__incident-toggle">
                    {isLayerActive ? '✓' : '○'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
