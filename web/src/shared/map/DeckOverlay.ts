/**
 * The single deck.gl overlay.
 *
 * One `MapboxOverlay` per map, interleaved into the MapLibre style so deck layers share
 * the depth buffer with 3D buildings. Layers are composed from the registry on every
 * render; deck diffs them by id, so re-composing is cheap and nothing is added or
 * removed imperatively.
 */

import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { dataForLayer, isLayerActive, type LayerContext, type MapView, type PickHit } from './layerRegistry';

export class DeckOverlay {
  private readonly overlay: MapboxOverlay;
  private attached = false;

  constructor() {
    this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
  }

  attach(map: MapLibreMap): void {
    if (this.attached) return;
    map.addControl(this.overlay);
    this.attached = true;
  }

  detach(map: MapLibreMap): void {
    if (!this.attached) return;
    map.removeControl(this.overlay);
    this.attached = false;
  }

  /** Compose every active descriptor's deck layers, in registry order. An isolate
   *  selection (layerRegistry.setIsolate) hides every layer but the chosen one. */
  render(view: MapView, ctx: LayerContext): void {
    const state = view.store.get();
    const layers: Layer[] = [];

    for (const d of view.layers) {
      if (!d.deck || !isLayerActive(state, d.id)) continue;
      const data = dataForLayer(state, d);
      if (data === undefined) continue;
      for (const layer of d.deck(data, ctx)) {
        if (import.meta.env.DEV && !layer.id.startsWith(`${d.id}:`)) {
          console.warn(`[map] deck layer "${layer.id}" breaks the naming contract — expected "${d.id}:…"`);
        }
        layers.push(layer);
      }
    }

    this.overlay.setProps({ layers });
  }

  /** The topmost deck object under a screen point, as a registry hit. */
  pick(x: number, y: number, lngLat: [number, number]): PickHit | null {
    if (!this.attached) return null;
    const info = this.overlay.pickObject({ x, y, radius: 4 });
    if (!info?.layer || info.object === undefined || info.object === null) return null;
    return { source: 'deck', layerId: info.layer.id, object: info.object, index: info.index, lngLat };
  }

  finalize(): void {
    this.overlay.finalize();
  }
}
