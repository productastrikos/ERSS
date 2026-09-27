/**
 * MapCanvas — mounts MapLibre, owns the instance, and renders a MapView's registry.
 *
 * Everything imperative about the map lives here or in the two renderers it drives
 * (StyleReconciler for MapLibre-native layers, DeckOverlay for deck.gl). Layer modules
 * never see the map; pages never see a layer id they did not declare.
 *
 *   <MapCanvas view={opsMap} onSelect={…}>
 *     <LayerControl view={opsMap} />
 *     <Legend view={opsMap} />
 *   </MapCanvas>
 */

import {
  useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore,
  type ReactNode, type Ref,
} from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { MapPinOff } from 'lucide-react';

import { useTheme, type Theme } from '../../lib/stores/theme';
import { config } from '../../lib/config';
import { t } from '../../lib/i18n';
import { EmptyState } from '../ui';
import { DeckOverlay } from './DeckOverlay';
import { StyleReconciler } from './styleReconciler';
import {
  isLayerActive, ownerOf, select, setFollow, setLayerData, setLayerStatus, useMapView,
  type LayerContext, type MapSelection, type MapView,
} from './layerRegistry';
import { css } from './tokens';
import { DUBAI_CAMERA, type MapCamera } from './camera';
import { MapPopup } from './MapPopup';
import { CHASE_PITCH, CHASE_ZOOM, FollowCamera } from './followCamera';
import './map.scss';

export interface MapCanvasHandle {
  map(): MapLibreMap | null;
  view: MapView;
}

interface MapCanvasProps {
  view: MapView;
  camera?: MapCamera;
  onSelect?: (selection: MapSelection | null) => void;
  /**
   * What the pointer is over, with the screen point to hang a tooltip on. A hover layer
   * is the default expectation of any chart you can point at, and on a map it is the only
   * way to read a cell without committing to a click that changes the screen.
   */
  onHover?: (hover: { selection: MapSelection; point: { x: number; y: number } } | null) => void;
  /** Right-click — "create incident here" on the Operations map (docs/06 §2.2). */
  onContextMenu?: (lngLat: [number, number]) => void;
  /** Map chrome: layer control, legend, toolbars. Positioned by their own classes. */
  children?: ReactNode;
  className?: string;
  /**
   * Off where a click opens something bigger than a popup — the dashboard's detail panel.
   * The selection (and its highlight) still happens; only the bubble is not drawn.
   */
  popups?: boolean;
  ref?: Ref<MapCanvasHandle>;
}

const styleFor = (theme: Theme) => (theme === 'light' ? config.map.styleLight : config.map.styleDark);

export function MapCanvas({ view, camera = DUBAI_CAMERA, onSelect, onHover, onContextMenu, children, className = '', popups = true, ref }: MapCanvasProps) {
  const theme = useTheme();
  const state = useMapView(view);
  const reducedMotion = useReducedMotion();
  const styleUrl = styleFor(theme);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const deckRef = useRef<DeckOverlay | null>(null);
  const reconcilerRef = useRef(new StyleReconciler());
  const appliedStyleRef = useRef<string | null>(null);
  /** True from 'style.load' until the next setStyle. NOT map.isStyleLoaded(), which stays
   *  false while basemap tiles stream in and would silently skip a reconcile. */
  const styleReadyRef = useRef(false);
  const loadsRef = useRef(new Map<string, AbortController>());

  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const [zoom, setZoom] = useState(camera.zoom);

  // Latest callbacks and render inputs, readable from long-lived map listeners.
  const live = useRef({ onSelect, onHover, onContextMenu, theme, zoom, reducedMotion });
  useEffect(() => { live.current = { onSelect, onHover, onContextMenu, theme, zoom, reducedMotion }; });

  useImperativeHandle(ref, () => ({ map: () => mapRef.current, view }), [view]);

  // ── Mount ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const initialStyle = styleFor(live.current.theme);
    if (!container || !initialStyle) return;

    const instance = new maplibregl.Map({
      container,
      style: initialStyle,
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch ?? 0,
      bearing: camera.bearing ?? 0,
      maxPitch: 70,
      attributionControl: { compact: true },
    });
    appliedStyleRef.current = initialStyle;
    mapRef.current = instance;

    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    const deck = new DeckOverlay();
    deckRef.current = deck;
    const reconciler = reconcilerRef.current;

    instance.on('style.load', () => {
      // A new style (first load, or a theme switch) arrives empty of our layers.
      reconciler.reset();
      styleReadyRef.current = true;
      instance.setLight({ anchor: 'viewport', color: css('--map-light'), intensity: 0.35, position: [1.5, 210, 40] });
      setStyleVersion((v) => v + 1);
    });

    instance.on('load', () => {
      deck.attach(instance);
      setMap(instance);
    });

    instance.on('zoomend', () => setZoom(Math.round(instance.getZoom() * 4) / 4));

    const hitAt = (point: { x: number; y: number }, lngLat: [number, number]) =>
      deck.pick(point.x, point.y, lngLat)
      ?? reconciler.pick(instance, view, [point.x, point.y], lngLat);

    instance.on('click', (e) => {
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const hit = hitAt(e.point, lngLat);
      const owner = hit ? ownerOf(view, hit.layerId) : undefined;
      const selection = hit && owner?.pick ? owner.pick(hit, view.store.get().data[owner.id]) : null;
      select(view, selection);
      live.current.onSelect?.(selection);
    });

    instance.on('contextmenu', (e) => live.current.onContextMenu?.([e.lngLat.lng, e.lngLat.lat]));

    // Pointer cursor — and the hover report — over anything that answers a click.
    // Throttled to a frame, and skipped mid-drag, because a pick reads back from the GPU.
    let hoverFrame = 0;
    let hovering = false;
    instance.on('mousemove', (e) => {
      if (hoverFrame || instance.isMoving()) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const hit = hitAt(e.point, [e.lngLat.lng, e.lngLat.lat]);
        const owner = hit ? ownerOf(view, hit.layerId) : undefined;
        instance.getCanvas().style.cursor = owner?.pick ? 'pointer' : '';
        const report = live.current.onHover;
        if (!report) return;
        const selection = hit && owner?.pick ? owner.pick(hit, view.store.get().data[owner.id]) : null;
        if (selection) {
          hovering = true;
          report({ selection, point: { x: e.point.x, y: e.point.y } });
        } else if (hovering) {
          hovering = false;
          report(null);
        }
      });
    });

    instance.on('mouseout', () => {
      if (!hovering) return;
      hovering = false;
      live.current.onHover?.(null);
    });

    // A failed tile is logged, not thrown: the operating picture must survive a flaky basemap.
    instance.on('error', (e) => console.warn('[map]', e.error?.message ?? e));

    const loads = loadsRef.current;
    return () => {
      cancelAnimationFrame(hoverFrame);
      for (const [layerId, controller] of loads) {
        controller.abort();
        setLayerStatus(view, layerId, 'idle');   // a remount must be able to load again
      }
      loads.clear();
      // Before the instance goes: a reconcile queued by a store update landing in the same
      // commit would otherwise run against a removed map and throw inside MapLibre
      // (`style` is gone by then). Every render path checks this flag first.
      styleReadyRef.current = false;
      deck.finalize();
      instance.remove();
      mapRef.current = null;
      deckRef.current = null;
      setMap(null);
    };
    // The map is created once per view; camera and callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── Theme → basemap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !styleUrl || appliedStyleRef.current === styleUrl) return;
    appliedStyleRef.current = styleUrl;
    styleReadyRef.current = false;
    map.setStyle(styleUrl, { diff: false });
  }, [map, styleUrl]);

  // ── Reconcile ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const deck = deckRef.current;
    if (!map || !deck || !styleReadyRef.current) return;
    const ctx = contextFor(view, { theme, zoom, reducedMotion, time: 0, now: performance.now() });
    reconcilerRef.current.reconcile(map, view, ctx);
    deck.render(view, ctx);
  }, [map, view, state, theme, zoom, reducedMotion, styleVersion]);

  // ── Follow — the camera tracks a moving object until the operator drags ────
  //
  // Two ways, depending on what the layer can say. A layer that can place its object at
  // any instant (`locateNow`) gets a FollowCamera driven from the animation frame, so the
  // camera moves at the object's own speed. Anything else is eased to each new fix.
  const follow = state.follow;
  const followOwner = follow ? view.layers.find((d) => d.id === follow.layerId) : undefined;
  const perFrame = !!followOwner?.locateNow;
  const followerRef = useRef<FollowCamera | null>(null);
  // Keyed on the target, not on the follow object: a new follower per data tick would
  // restart the entry glide every time a position arrived.
  const followKey = follow && perFrame ? `${follow.layerId}|${follow.id}` : null;
  const followChase = !!follow?.chase;
  useEffect(() => {
    if (!map || !followKey) return;
    const camera = new FollowCamera(map, { chase: followChase, reducedMotion });
    followerRef.current = camera;
    return () => {
      camera.dispose();
      if (followerRef.current === camera) followerRef.current = null;
    };
  }, [map, followKey, followChase, reducedMotion]);

  useEffect(() => {
    if (!map || !follow || perFrame) return;
    const owner = view.layers.find((d) => d.id === follow.layerId);
    const data = state.data[follow.layerId];
    const at = owner?.locate && data !== undefined ? owner.locate(data, follow.id) : null;
    if (!at) return;
    if (!follow.chase) {
      map.easeTo({ center: at, duration: reducedMotion ? 0 : 600 });
      return;
    }
    // A chase drops in behind the object and turns with it. The bearing is eased rather
    // than set, so a vehicle rounding a corner sweeps the view instead of snapping it —
    // and a null bearing (stationary, or a layer that does not report one) leaves the
    // compass alone rather than spinning it to north.
    const heading = owner?.bearingOf && data !== undefined ? owner.bearingOf(data, follow.id) : null;
    map.easeTo({
      center: at,
      pitch: CHASE_PITCH,
      zoom: Math.max(map.getZoom(), CHASE_ZOOM),
      ...(heading != null ? { bearing: heading } : {}),
      duration: reducedMotion ? 0 : 900,
      essential: true,
    });
  }, [map, view, follow, perFrame, state.data, reducedMotion]);

  useEffect(() => {
    if (!map || !follow) return;
    const release = () => setFollow(view, null);
    // A drag, or a rotate/tilt the operator started (the camera's own jumps carry no
    // originalEvent), is the operator taking the camera back.
    const releaseIfUser = (e: { originalEvent?: unknown }) => { if (e.originalEvent) release(); };
    map.on('dragstart', release);
    map.on('rotatestart', releaseIfUser);
    map.on('pitchstart', releaseIfUser);
    return () => {
      map.off('dragstart', release);
      map.off('rotatestart', releaseIfUser);
      map.off('pitchstart', releaseIfUser);
    };
  }, [map, view, follow]);

  // ── Animation clock — runs only while an animated layer needs it ───────────
  // A per-frame follow needs the clock even under reduced motion: the camera still has to
  // stay on the vehicle, it just does not glide into place.
  const animating = (!!follow && perFrame) || (!reducedMotion && view.layers.some((d) => {
    const data = state.data[d.id];
    if (!d.animated || !isLayerActive(state, d.id) || data === undefined) return false;
    return typeof d.animated === 'function' ? d.animated(data) : true;
  }));
  useEffect(() => {
    const deck = deckRef.current;
    if (!map || !deck || !animating) return;
    const start = performance.now();
    let last = 0;
    let lost = 0;
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      if (!styleReadyRef.current) return;
      // ~30 fps is plenty for a pulse; a camera riding with a vehicle runs every frame,
      // because a camera stepping at 30 fps over a moving city is visibly stroboscopic.
      const follower = followerRef.current;
      if (!follower && now - last < 33) return;
      last = now;
      const { theme: th, zoom: z, reducedMotion: still } = live.current;
      if (follower) {
        const s = view.store.get();
        const f = s.follow;
        const owner = f ? view.layers.find((d) => d.id === f.layerId) : undefined;
        const data = f ? s.data[f.layerId] : undefined;
        const fix = f && owner?.locateNow && data !== undefined ? owner.locateNow(data, f.id, now) : null;
        if (fix) {
          lost = 0;
          follower.frame(fix, now);
        } else if (!lost) {
          lost = now;
        } else if (now - lost > 2500) {
          // The object has gone — the job ended, or the replay was unloaded. Hand back.
          setFollow(view, null);
        }
      }
      const ctx = contextFor(view, { theme: th, zoom: z, reducedMotion: still, time: now - start, now });
      reconcilerRef.current.animate(map, view, ctx);
      deck.render(view, ctx);
    });
    return () => cancelAnimationFrame(frame);
  }, [map, view, animating, styleVersion]);

  // ── REST-backed layers load the first time they are shown ──────────────────
  useEffect(() => {
    for (const d of view.layers) {
      if (d.source.kind !== 'rest' || !state.visible[d.id] || state.status[d.id] !== 'idle') continue;
      const controller = new AbortController();
      loadsRef.current.set(d.id, controller);
      setLayerStatus(view, d.id, 'loading');
      // A result lands only if nothing else fed the layer while the request was in flight.
      const stillLoading = () => !controller.signal.aborted && view.store.get().status[d.id] === 'loading';
      d.source.load(controller.signal)
        .then((data) => {
          if (stillLoading()) setLayerData(view, d.id, data);
        })
        .catch((err: unknown) => {
          if (stillLoading()) setLayerStatus(view, d.id, 'error', err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (loadsRef.current.get(d.id) === controller) loadsRef.current.delete(d.id);
        });
    }
  }, [view, state.visible, state.status]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!styleUrl) {
    return (
      <div className={`map-canvas map-canvas--empty ${className}`}>
        <EmptyState icon={<MapPinOff aria-hidden />} title={t('map.error.noStyle')} body={t('map.error.noStyleBody')} />
      </div>
    );
  }

  const selection = state.selection;
  const owner = selection ? view.layers.find((d) => d.id === selection.layerId) : undefined;
  const Popup = owner?.popup;
  const closePopup = () => {
    select(view, null);
    live.current.onSelect?.(null);
  };

  return (
    <div className={`map-canvas ${className}`}>
      <div ref={containerRef} className="map-canvas__gl" />
      {map && selection && Popup && popups && (
        <MapPopup map={map} lngLat={selection.lngLat} onClose={closePopup}>
          <Popup selection={selection} view={view} onClose={closePopup} />
        </MapPopup>
      )}
      {children}
    </div>
  );
}

function contextFor(
  view: MapView,
  frame: Pick<LayerContext, 'theme' | 'zoom' | 'reducedMotion' | 'time' | 'now'>,
): LayerContext {
  const s = view.store.get();
  return {
    ...frame,
    selection: s.selection,
    follow: s.follow,
    dataOf: <T,>(layerId: string) => s.data[layerId] as T | undefined,
  };
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(MOTION_QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}
