/**
 * Reconciles MapLibre-native descriptors into the live style.
 *
 * Descriptors return plain specifications; this is the only code that calls addSource,
 * addLayer, setData and setPaintProperty. It diffs what it last applied, so a theme
 * change repaints existing layers in place rather than tearing them down, and a data
 * change calls setData rather than re-adding the source.
 *
 * MapLibre-native layers are kept beneath deck.gl's interleaved layers: geometry that
 * needs symbol collision or fill-extrusion lives here, points and surfaces live in deck.
 */

import type {
  GeoJSONSource, LayerSpecification, Map as MapLibreMap, SourceSpecification,
} from 'maplibre-gl';
import {
  dataForLayer, isLayerActive, type LayerContext, type LayerDescriptor, type MapView, type PickHit,
} from './layerRegistry';

type Applied = { paint: string; layout: string; filter: string; zoom: string };

const json = (v: unknown) => JSON.stringify(v ?? null);

export class StyleReconciler {
  /** descriptor id → the data references its sources were last built from */
  private inputs = new Map<string, unknown[]>();
  /** descriptor id → layer ids currently in the style */
  private layers = new Map<string, string[]>();
  private applied = new Map<string, Applied>();

  /** The style was replaced (theme switch): everything we added is gone. */
  reset(): void {
    this.inputs.clear();
    this.layers.clear();
    this.applied.clear();
  }

  reconcile(map: MapLibreMap, view: MapView, ctx: LayerContext): void {
    const state = view.store.get();

    for (const d of view.layers) {
      if (!d.maplibre) continue;
      const data = dataForLayer(state, d);
      const on = isLayerActive(state, d.id) && data !== undefined;

      if (!on) {
        for (const id of this.layers.get(d.id) ?? []) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }
        continue;
      }

      this.syncSources(map, d, data, state.data, ctx);
      this.syncLayers(map, view, d, ctx);
    }
  }

  /** Per-frame paint for animated descriptors. Not recorded, so reconcile never fights it. */
  animate(map: MapLibreMap, view: MapView, ctx: LayerContext): void {
    const state = view.store.get();
    for (const d of view.layers) {
      if (!d.maplibre?.animate || !isLayerActive(state, d.id) || dataForLayer(state, d) === undefined) continue;
      for (const { layer, property, value } of d.maplibre.animate(ctx)) {
        if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
      }
    }
  }

  /** The topmost interactive MapLibre feature under a point. */
  pick(map: MapLibreMap, view: MapView, point: [number, number], lngLat: [number, number]): PickHit | null {
    const state = view.store.get();
    const ids = view.layers
      .filter((d) => d.maplibre?.interactive && isLayerActive(state, d.id) && dataForLayer(state, d) !== undefined)
      .flatMap((d) => d.maplibre!.interactive!)
      .filter((id) => map.getLayer(id));
    if (!ids.length) return null;

    // A few pixels of slop: a 3px road should not demand a pixel-perfect click.
    const [x, y] = point;
    const [feature] = map.queryRenderedFeatures([[x - 4, y - 4], [x + 4, y + 4]], { layers: ids });
    return feature ? { source: 'maplibre', layerId: feature.layer.id, feature, lngLat } : null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * @param effective  this descriptor's own data, already narrowed by any isolate filter
   * @param rawData    every layer's UNFILTERED data, for `dependsOn` — a dependency reads
   *                   the layer it depends on as that layer normally is, isolate or not
   */
  private syncSources(map: MapLibreMap, d: LayerDescriptor, effective: unknown, rawData: Record<string, unknown>, ctx: LayerContext): void {
    const inputs = [effective, ...(d.dependsOn ?? []).map((id) => rawData[id])];
    const prev = this.inputs.get(d.id);
    if (prev && prev.length === inputs.length && prev.every((x, i) => x === inputs[i])) return;

    const specs: Record<string, SourceSpecification> = d.maplibre!.sources(effective, ctx);
    for (const [id, spec] of Object.entries(specs)) {
      const existing = map.getSource(id);
      if (!existing) {
        map.addSource(id, spec);
      } else if (spec.type === 'geojson') {
        (existing as GeoJSONSource).setData(spec.data as Parameters<GeoJSONSource['setData']>[0]);
      }
    }
    this.inputs.set(d.id, inputs);
  }

  private syncLayers(map: MapLibreMap, view: MapView, d: LayerDescriptor, ctx: LayerContext): void {
    const specs = d.maplibre!.layers(ctx);
    const wanted = new Set(specs.map((s) => s.id));

    // Layers a descriptor no longer emits (a mode switch, say) leave the style.
    for (const id of this.layers.get(d.id) ?? []) {
      if (!wanted.has(id) && map.getLayer(id)) {
        map.removeLayer(id);
        this.applied.delete(id);
      }
    }

    for (const spec of specs) {
      const layout = { ...('layout' in spec ? spec.layout : {}), visibility: 'visible' };
      const next: Applied = {
        paint: json('paint' in spec ? spec.paint : null),
        layout: json(layout),
        filter: json('filter' in spec ? spec.filter : null),
        zoom: json([spec.minzoom, spec.maxzoom]),
      };

      if (!map.getLayer(spec.id)) {
        map.addLayer({ ...spec, layout } as LayerSpecification, this.beforeId(map, view, d));
        this.applied.set(spec.id, next);
        continue;
      }

      const prev = this.applied.get(spec.id);
      if (prev?.paint !== next.paint && 'paint' in spec && spec.paint) {
        for (const [k, v] of Object.entries(spec.paint)) map.setPaintProperty(spec.id, k, v);
      }
      if (prev?.layout !== next.layout) {
        for (const [k, v] of Object.entries(layout)) map.setLayoutProperty(spec.id, k, v);
      }
      if (prev?.filter !== next.filter && 'filter' in spec) {
        map.setFilter(spec.id, spec.filter ?? null);
      }
      if (prev?.zoom !== next.zoom) {
        map.setLayerZoomRange(spec.id, spec.minzoom ?? 0, spec.maxzoom ?? 24);
      }
      this.applied.set(spec.id, next);
    }

    this.layers.set(d.id, specs.map((s) => s.id));
  }

  /** Insert beneath the next descriptor up the order, else beneath deck's layers. */
  private beforeId(map: MapLibreMap, view: MapView, d: LayerDescriptor): string | undefined {
    for (const above of view.layers) {
      if (above.order <= d.order || above.id === d.id) continue;
      const id = (this.layers.get(above.id) ?? []).find((x) => map.getLayer(x));
      if (id) return id;
    }
    // deck.gl's interleaved layers are custom layers, absent from the serialised style.
    return map.getLayersOrder().find((id) => map.getLayer(id)?.type === 'custom');
  }
}
