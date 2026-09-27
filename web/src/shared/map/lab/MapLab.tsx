/**
 * Map lab — DEVELOPMENT ONLY (`/?maplab` under `vite dev`; never in a production build).
 *
 * Every registry layer on one canvas, fed from fixtures, driven by the URL so a headless
 * browser can screenshot an exact state:
 *
 *   ?maplab&layers=incidents,units&camera=dso&theme=light&select=units:U-AMB-014&panel=1
 *
 * This is how the map is checked domain by domain while the pages and feeds that will
 * drive it are still to be built.
 */

import { useEffect, useMemo } from 'react';
import { setTheme } from '../../../lib/stores/theme';
import { MapCanvas } from '../MapCanvas';
import { LayerControl } from '../LayerControl';
import { Legend } from '../Legend';
import { DSO_CAMERA, DUBAI_CAMERA, type MapCamera } from '../camera';
import { ALL_LAYERS } from '../layers';
import {
  createMapView, select, setLayerData, useMapView, type MapView, type PickHit,
} from '../layerRegistry';
import * as fx from './fixtures';

const FIXTURES: Record<string, unknown> = {
  incidents: fx.LAB_INCIDENTS,
  units: fx.LAB_UNITS,
  routes: fx.LAB_ROUTES,
  makani: fx.LAB_MAKANI,
  risk: fx.LAB_RISK,
  demand: fx.LAB_DEMAND,
  crowd: fx.LAB_CROWD,
  hotspot: fx.LAB_HOTSPOT,
  coverage: fx.LAB_COVERAGE,
  traffic: fx.LAB_TRAFFIC,
  bms: fx.LAB_BMS,
  water: fx.LAB_WATER,
  waste: fx.LAB_WASTE,
  'air-quality': fx.LAB_AIR,
  pollution: fx.LAB_POLLUTION,
  wind: fx.LAB_WIND,
  // Detail self-loads over REST; the fixture stands in when ?fixtures=detail is set.
};

function parseCamera(params: URLSearchParams): MapCamera {
  const named = params.get('camera');
  if (named === 'dso') return DSO_CAMERA;
  const at = params.get('at')?.split(',').map(Number);
  if (at && at.length >= 3 && at.every(Number.isFinite)) {
    return { center: [at[0], at[1]], zoom: at[2], pitch: at[3] ?? 0, bearing: at[4] ?? 0 };
  }
  return DUBAI_CAMERA;
}

export default function MapLab() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);

  const view = useMemo<MapView>(() => {
    const only = params.get('layers')?.split(',').filter(Boolean);
    const visible = Object.fromEntries(ALL_LAYERS.map((l) => [l.id, only ? only.includes(l.id) : true]));
    return createMapView('lab', ALL_LAYERS, { visible, persist: false });
  }, [params]);

  const state = useMapView(view);

  useEffect(() => {
    const theme = params.get('theme');
    if (theme === 'light' || theme === 'dark') setTheme(theme);
    for (const [id, data] of Object.entries(FIXTURES)) setLayerData(view, id, data);
    const bmsMode = params.get('bms');
    if (bmsMode) setLayerData(view, 'bms', { ...fx.LAB_BMS, mode: bmsMode });
    if (params.get('fixtures')?.split(',').includes('detail')) setLayerData(view, 'detail', fx.LAB_DETAIL);
  }, [params, view]);

  // ?select=layer[:deck-sublayer]:objectId opens that object's popup once its data is
  // present — e.g. select=units:U-AMB-014, select=traffic:signals-disc:DSO-SIG-101.
  const target = params.get('select');
  useEffect(() => {
    if (!target || state.selection) return;
    const parts = target.split(':');
    const [layerId, id] = [parts[0], parts[parts.length - 1]];
    const deckLayerId = parts.length > 2 ? parts.slice(0, -1).join(':') : `${layerId}:lab`;
    const layer = view.layers.find((l) => l.id === layerId);
    const data = state.data[layerId];
    if (!layer?.pick || data === undefined) return;

    // The object may sit in the data itself or in any collection inside it.
    type Item = { ref?: string; id?: string; makani?: string; zoneRef?: string; lng: number; lat: number };
    const collections = (Array.isArray(data)
      ? [data]
      : Object.values(data as object).filter(Array.isArray)) as Item[][];
    for (const list of collections) {
      const index = list.findIndex((d) => [d.ref, d.id, d.makani, d.zoneRef].includes(id));
      if (index < 0) continue;
      const object = list[index];
      const hit: PickHit = { source: 'deck', layerId: deckLayerId, object, index, lngLat: [object.lng, object.lat] };
      select(view, layer.pick(hit, data));
      return;
    }
  }, [target, view, state.data, state.selection]);

  const camera = useMemo(() => parseCamera(params), [params]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <MapCanvas view={view} camera={camera}>
        <div className="map-control map-control--top-right">
          <LayerControl view={view} defaultOpen={params.get('panel') === '1'} />
        </div>
        <div className="map-control map-control--bottom-left">
          <Legend view={view} />
          <div className="map-panel" data-testid="lab-status"
               style={{ padding: 'var(--sp-6) var(--sp-10)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            {view.layers.filter((l) => state.visible[l.id]).map((l) => `${l.id}:${state.status[l.id]}`).join('  ')}
          </div>
        </div>
      </MapCanvas>
    </div>
  );
}
