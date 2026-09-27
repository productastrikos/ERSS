import { useState, useCallback, useRef } from 'react';
// DANGLING: DSOMap was decomposed into web/src/shared/map in Phase 4 and the original
// archived to _archive/dso-map (see its MIGRATION.md). This file is REPLACE in
// docs/14-MIGRATION-MAP.md — not compiled, not mounted — and is kept for reference only.
import DSOMap from './components/DSOMap/DSOMap';
import type { AccidentTask, WaterTask, WasteTask } from './data/responders';
import BuildingPanel from './components/BuildingPanel/BuildingPanel';
import InfraPanel from './components/InfraPanel/InfraPanel';
import IncidentSimulator from './components/IncidentSimulator/IncidentSimulator';
import TopBar from './components/TopBar/TopBar';
import Sidebar from './components/Sidebar/Sidebar';
import TrafficSignalManager from './components/TrafficSignalManager/TrafficSignalManager';
import TrafficCommandPanel from './components/TrafficCommandPanel/TrafficCommandPanel';
import BuildingDigitalTwin from './components/BuildingDigitalTwin/BuildingDigitalTwin';
import EnvironmentAnalyticsPanel from './components/EnvironmentAnalyticsPanel/EnvironmentAnalyticsPanel';
import BMSPanel from './components/BMSPanel/BMSPanel';
import BMSBuildingPopup from './components/BMSBuildingPopup/BMSBuildingPopup';
import WaterPipelinePanel from './components/WaterPipelinePanel/WaterPipelinePanel';
import SmartWastePanel from './components/SmartWastePanel/SmartWastePanel';
import { useLayerVisibility } from './hooks/useLayerVisibility';
import { INCIDENTS } from './data/incidents';
import type { SelectedBuilding, SelectedInfra, ActiveIncidentState, TrafficState, TrafficView, TrafficIncident, BMSSubView, BMSLayerMode, WaterView, WasteView } from './types';
import type { BMSBuilding } from './data/bmsBuildings';
import './App.scss';

// ── Overpass API: fetch extra OSM tags for a building ──────────────────────
// Session-level cache: avoids re-fetching the same building repeatedly
const _overpassCache  = new Map<number, Record<string, string> | null>();
// In-flight deduplication: if two clicks hit the same osm_id concurrently,
// the second waits for the first promise instead of firing a new request
const _overpassFlight = new Map<number, Promise<Record<string, string> | null>>();

async function fetchOverpassTags(osmId: number): Promise<Record<string, string> | null> {
  // Return cached result immediately (including cached `null` for 404/error)
  if (_overpassCache.has(osmId)) return _overpassCache.get(osmId)!;

  // Reuse an in-flight request for the same ID
  if (_overpassFlight.has(osmId)) return _overpassFlight.get(osmId)!;

  const type  = osmId < 0 ? 'relation' : 'way';
  const absId = Math.abs(osmId);
  const query = `[out:json][timeout:6];${type}(${absId});out tags;`;

  const promise = (async (): Promise<Record<string, string> | null> => {
    try {
      const res = await fetch(
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(7_000) },
      );
      // 429 = rate limited, 5xx = server error — degrade gracefully, DO NOT retry
      if (!res.ok) return null;
      const data    = await res.json();
      const element = data.elements?.[0];
      const tags    = element?.tags ?? null;
      _overpassCache.set(osmId, tags);
      return tags;
    } catch {
      // Network error / timeout — cache null so we don't retry immediately
      _overpassCache.set(osmId, null);
      return null;
    } finally {
      _overpassFlight.delete(osmId);
    }
  })();

  _overpassFlight.set(osmId, promise);
  return promise;
}

function App() {
  const { visibility, toggle, envLayers, toggleEnvLayer } = useLayerVisibility();
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [selectedInfra, setSelectedInfra]       = useState<SelectedInfra | null>(null);
  const [mapStyle, _setMapStyle] = useState('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json');
  const [activeIncident, setActiveIncident] = useState<ActiveIncidentState | null>(null);
  const [activeModule, setActiveModule]     = useState<string>('');
  const [trafficState, setTrafficState]     = useState<TrafficState | null>(null);
  const [pendingTrafficView, setPendingTrafficView] = useState<TrafficView | null>(null);
  const [commandPanelCollapsed, setCommandPanelCollapsed] = useState(false);
  const [showBuildingTwin, setShowBuildingTwin] = useState(false);
  const [accidentTasks, setAccidentTasks]        = useState<AccidentTask[]>([]);
  const [waterTasks,    setWaterTasks]            = useState<WaterTask[]>([]);
  const [wasteTasks,    setWasteTasks]            = useState<WasteTask[]>([]);
  const [overflowBinId, setOverflowBinId]        = useState<string | null>(null);
  const mapRef = useRef<any>(null);

  // ── BMS state ────────────────────────────────────────────────────────────
  const [activeBMSView,      setActiveBMSView]      = useState<BMSSubView>('overview');
  const [bmsLayerMode,       setBmsLayerMode]        = useState<BMSLayerMode>('status');
  const [selectedBMSBuilding, setSelectedBMSBuilding] = useState<BMSBuilding | null>(null);

  // ── Water Pipeline state ─────────────────────────────────────────────────
  const [activeWaterView, setActiveWaterView] = useState<WaterView>('network');
  const [waterNodes, setWaterNodes]           = useState<any[]>([]);
  const [waterPipelines, setWaterPipelines]   = useState<any[]>([]);
  const [waterIncident, setWaterIncident]     = useState<any>(null);

  // ── Smart Waste state ────────────────────────────────────────────────────
  const [activeWasteView, setActiveWasteView] = useState<WasteView>('bins');

  /** Launch an incident from the Sidebar */
  const handleSelectIncident = useCallback((incidentId: string) => {
    const incident = INCIDENTS.find((i) => i.id === incidentId);
    if (!incident) return;
    setActiveIncident({
      incident,
      status:          'alert',
      workflowStage:   'detected',
      timeline:        [],
      fieldStatusStep: 0,
      startedAt:       Date.now(),
    });
  }, []);

  const handleInfraSelect = useCallback((infra: SelectedInfra | null) => {
    setSelectedInfra(infra);
    if (infra) setSelectedBuilding(null); // close building panel when infra opens
  }, []);

  /** Traffic Command Panel: focus map on incident location */
  const handleFocusIncident = useCallback((coords: [number, number]) => {
    if (mapRef.current?.flyTo) {
      mapRef.current.flyTo({
        center: coords,
        zoom: 16,
        duration: 1500,
        essential: true,
      });
    }
  }, []);

  /** Traffic Command Panel: approve AI plan */
  const handleApproveAIPlan = useCallback((incident: TrafficIncident) => {
    console.log('AI Plan approved for incident:', incident.id);
    // In real implementation: execute signal adjustments, dispatch units, etc.
  }, []);

  /** Traffic Command Panel: modify plan */
  const handleModifyPlan = useCallback((incident: TrafficIncident) => {
    console.log('Modify plan for incident:', incident.id);
    // In real implementation: open modification interface
  }, []);

  /** Traffic Command Panel: manual override */
  const handleManualOverride = useCallback((incident: TrafficIncident) => {
    console.log('Manual override activated for incident:', incident.id);
    // In real implementation: take manual control of signals
  }, []);

  /** Traffic Command Panel: resolve incident */
  const handleResolveIncident = useCallback((incident: TrafficIncident) => {
    console.log('Incident resolved:', incident.id);
    setTrafficState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        incidents: prev.incidents.map((inc) =>
          inc.id === incident.id ? { ...inc, resolved: true } : inc
        ),
      };
    });
  }, []);

  /** Open the Schneider Electric Building Digital Twin overlay */
  const handleSchneiderBuildingClick = useCallback(() => {
    setShowBuildingTwin(true);
    setSelectedBMSBuilding(null);
    if (mapRef.current?.flyTo) {
      mapRef.current.flyTo({ center: [55.3790, 25.1205], zoom: 17, duration: 1500, pitch: 45, essential: true });
    }
  }, []);

  /** Called when user clicks "Begin Response" in the map popup → start manual workflow */
  const handleAlertAcknowledged = useCallback(() => {
    setActiveIncident((prev) => {
      if (!prev) return null;
      const now = new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: false });
      return {
        ...prev,
        status:           'running',
        workflowStage:    'validated' as const,
        fieldStatusStep:  0,
        startedAt:        Date.now(),
        timeline: [
          ...(prev.timeline ?? []),
          { time: now, label: 'Alert acknowledged — sensor data loaded for validation', icon: '🔬' },
        ],
      };
    });
  }, []);

  // Called by DSOMap on click — immediately shows panel with API data,
  // then async-enriches it with Overpass extra tags
  const handleBuildingSelect = useCallback(async (b: SelectedBuilding | null) => {
    if (!b) { setSelectedBuilding(null); return; }

    // Show panel immediately with what we have
    setSelectedBuilding(b);

    // Enrich asynchronously if we have an osm_id
    if (b.osm_id != null) {
      const extra = await fetchOverpassTags(b.osm_id);
      // Apply extra tags (merge with any existing API fields that may already be set)
      setSelectedBuilding((prev) => {
        if (!prev || prev.osm_id !== b.osm_id) return prev; // stale click — ignore
        return {
          ...prev,
          extra:        extra,
          extraLoading: false,
          // If API had null housenumber but Overpass found addr:housenumber, adopt it
          housenumber:  prev.housenumber ?? (extra?.['addr:housenumber'] ?? null),
          street:       prev.street      ?? (extra?.['addr:street']      ?? null),
          operator:     prev.operator    ?? (extra?.['operator']         ?? null),
          website:      prev.website     ?? (extra?.['website']          ?? null),
        };
      });
    } else {
      setSelectedBuilding((prev) => prev ? { ...prev, extraLoading: false } : prev);
    }
  }, []);

  return (
    <div className="app">
      {/* Top bar: logos + alerts + clock */}
      <TopBar
        alertCount={activeIncident && activeIncident.status !== 'resolved' ? 1 : 0}
        activeModule={activeModule ? MODULE_LABELS[activeModule] : undefined}
      />

      {/* Body: sidebar + map */}
      <div className="app-body">
        <Sidebar
          activeModule={activeModule}
          onSelectModule={(id) => {
            const wasEnv = activeModule === 'environment';
            const isEnv  = id === 'environment';
            setActiveModule(id);
            // Sync visibility.environment with whether env module is active
            if (isEnv && !wasEnv && !visibility.environment) toggle('environment');
            if (!isEnv && wasEnv && visibility.environment) toggle('environment');
            // Clear traffic state when switching away from traffic module
            if (id !== 'traffic') setTrafficState(null);
            // Clear BMS building popup when switching module
            if (id !== 'bms') setSelectedBMSBuilding(null);
          }}
          onSelectIncident={handleSelectIncident}
          onSelectTrafficView={(view) => {
            setActiveModule('traffic');
            setPendingTrafficView(view);
            // Reset after one render cycle so it can be re-triggered
            setTimeout(() => setPendingTrafficView(null), 50);
          }}
          onToggleEnvLayer={toggleEnvLayer}
          activeIncidentId={activeIncident?.incident.id}
          envLayers={envLayers}
          onSelectBMSView={setActiveBMSView}
          activeBMSView={activeBMSView}
          onSelectWaterView={(v) => {
            setActiveModule('water');
            setActiveWaterView(v);
          }}
          activeWaterView={activeWaterView}
          onSelectWasteView={(v) => {
            setActiveModule('waste');
            setActiveWasteView(v);
          }}
          activeWasteView={activeWasteView}
        />

        <main className="app-map">
          <DSOMap
            key={mapStyle}
            mapStyleUrl={mapStyle}
            visibility={visibility}
            onBuildingSelect={handleBuildingSelect}
            onInfraSelect={handleInfraSelect}
            activeIncident={activeIncident}
            onAlertAcknowledged={handleAlertAcknowledged}
            trafficState={trafficState}
            mapRef={mapRef}
            onSchneiderBuildingClick={handleSchneiderBuildingClick}
            envLayers={envLayers}
            bmsActive={activeModule === 'bms'}
            bmsLayerMode={bmsLayerMode}
            accidentTasks={accidentTasks}
            waterTasks={waterTasks}
            wasteTasks={wasteTasks}
            wasteActive={activeModule === 'waste'}
            overflowBinId={overflowBinId}
            onBMSBuildingClick={(b) => {
              setSelectedBMSBuilding(b);
              setSelectedBuilding(null);
            }}
            waterActive={activeModule === 'water'}
            waterNodes={waterNodes}
            waterPipelines={waterPipelines}
            waterIncident={waterIncident}
          />
          {/* <MapControls
            visibility={visibility}
            onToggle={toggle}
            mapStyleUrl={mapStyle}
            onStyleChange={handleStyleChange}
          /> */}

          {/* Environment Analytics Panel — shown when environment module is active */}
          {activeModule === 'environment' && (
            <EnvironmentAnalyticsPanel
              envLayers={envLayers}
              onClose={() => {
                setActiveModule('');
                if (visibility.environment) toggle('environment');
              }}
            />
          )}

          {/* BMS City Digital Twin Panel — shown when bms module is active */}
          {activeModule === 'bms' && (
            <BMSPanel
              activeView={activeBMSView}
              onViewChange={setActiveBMSView}
              layerMode={bmsLayerMode}
              onLayerModeChange={setBmsLayerMode}
              onBuildingSelect={(b) => {
                setSelectedBMSBuilding(b);
                if (b && mapRef.current?.flyTo) {
                  mapRef.current.flyTo({ center: b.location, zoom: 17, duration: 1000, essential: true });
                }
              }}
              selectedBuildingId={selectedBMSBuilding?.id ?? null}
              onClose={() => {
                setActiveModule('');
                setSelectedBMSBuilding(null);
              }}
              onSimulate={(type) => {
                console.log('[BMS] Simulate:', type);
              }}
            />
          )}

          {/* Smart Waste Panel — shown when waste module is active */}
          {activeModule === 'waste' && (
            <SmartWastePanel
              activeView={activeWasteView}
              onViewChange={setActiveWasteView}
              onClose={() => setActiveModule('')}
              onWasteTasksChange={setWasteTasks}
              onOverflowBinChange={setOverflowBinId}
              onBinFocus={(coords) => {
                if (mapRef.current?.flyTo) {
                  mapRef.current.flyTo({ center: coords, zoom: 17, duration: 1000, essential: true });
                }
              }}
            />
          )}

          {/* Water Pipeline Panel — shown when water module is active */}
          {activeModule === 'water' && (
            <WaterPipelinePanel
              activeView={activeWaterView}
              onViewChange={setActiveWaterView}
              onClose={() => setActiveModule('')}
              onNetworkReady={(nodes, pipelines) => {
                setWaterNodes(nodes);
                setWaterPipelines(pipelines);
              }}
              onIncidentChange={setWaterIncident}
              onWaterTasksChange={setWaterTasks}
              onNodeFocus={(coords) => {
                if (mapRef.current?.flyTo) {
                  mapRef.current.flyTo({ center: coords, zoom: 17, duration: 1200, essential: true });
                }
              }}
            />
          )}

          {/* Traffic Signal Management panel — shown when traffic module is active */}
          {activeModule === 'traffic' && (
            <TrafficSignalManager
              onClose={() => setActiveModule('')}
              onStateChange={setTrafficState}
              pendingView={pendingTrafficView}
              onAccidentTasksChange={setAccidentTasks}
            />
          )}

          {/* Traffic Command & Control Panel — shown when traffic module is active */}
          {activeModule === 'traffic' && trafficState && (
            <TrafficCommandPanel
              trafficState={trafficState}
              onFocusIncident={handleFocusIncident}
              onApproveAIPlan={handleApproveAIPlan}
              onModifyPlan={handleModifyPlan}
              onManualOverride={handleManualOverride}
              onResolveIncident={handleResolveIncident}
              isCollapsed={commandPanelCollapsed}
              onToggleCollapse={() => setCommandPanelCollapsed(!commandPanelCollapsed)}
              onSignalControl={(signalId, newState) =>
                setTrafficState((prev) =>
                  prev
                    ? { ...prev, signals: prev.signals.map((s) => s.signal_id === signalId ? { ...s, state: newState } : s) }
                    : prev
                )
              }
            />
          )}

          {/* Building Digital Twin overlay — Schneider Electric Office */}
          {showBuildingTwin && (
            <BuildingDigitalTwin onClose={() => setShowBuildingTwin(false)} />
          )}

          {/* BMS Building popup — quick info for any clicked BMS building */}
          {selectedBMSBuilding && activeModule === 'bms' && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1200 }}>
              <BMSBuildingPopup
                building={selectedBMSBuilding}
                onClose={() => setSelectedBMSBuilding(null)}
                onOpenNest={selectedBMSBuilding.id === 'BLD_001' ? handleSchneiderBuildingClick : undefined}
              />
            </div>
          )}

          <BuildingPanel
            building={selectedBuilding}
            onClose={() => setSelectedBuilding(null)}
            onOpenDigitalTwin={
              selectedBuilding?.name === 'The NEST' ||
              selectedBuilding?.operator?.toLowerCase().includes('schneider')
                ? handleSchneiderBuildingClick
                : undefined
            }
          />

          <InfraPanel
            infra={selectedInfra}
            onClose={() => setSelectedInfra(null)}
          />

          <IncidentSimulator
            activeIncident={activeIncident}
            onIncidentChange={setActiveIncident}
          />
        </main>
      </div>

      {/* Footer */}
      <footer className="app-footer">
        <div className="app-footer__left">
          <span className="app-footer__dot" />
          <span className="app-footer__status">SYSTEM ONLINE</span>
          <span className="app-footer__sep">|</span>
          <span className="app-footer__loc">Dubai Silicon Oasis · UAE</span>
        </div>
        {/* <div className="app-footer__center">
          Powered by&nbsp;<img src="./Astrikos Logo Transparent perfect 1.png" alt="" width={"80px"} height={"50px"}/>
           <strong>Astrikos</strong>
        </div>
        <div className="app-footer__right">
          <span className="app-footer__tag">MapLibre GL</span>
          <span className="app-footer__tag">Intel Platform</span>
          <span className="app-footer__tag">DSO Digital Twin</span>
        </div> */}
      </footer>
    </div>
  );
}

const MODULE_LABELS: Record<string, string> = {
  traffic:     'Traffic Signal Management',
  bms:         'Building Management System',
  water:       'Water Pipeline Management',
  environment: 'Environmental Monitoring',
  utilities:   'Utilities',
  waste:       'Smart Waste Management',
  streets:     'Street Infrastructure',
  security:    'Security Monitoring',
  mobility:    'Mobility & EV',
};

export default App;
