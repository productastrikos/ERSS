/**
 * The legend — GENERATED from the descriptors of the layers currently on screen.
 *
 * Swatches reference tokens and render `var(--token)`, so the legend and the map can
 * never disagree about what a colour means. A layer that is switched on but has nothing
 * to draw contributes nothing: a key for an empty layer is noise.
 *
 * Every row is also a SELECTOR: click one and every other layer disappears, leaving only
 * that row's category (a descriptor's `filterFor`) — or, for a layer with no sub-categories,
 * just that one layer. This is the answer to a map with incidents, units, routes, zones,
 * stations and hospitals all drawn at once: pick the one thing you're looking for.
 */

import { useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, MousePointerClick, X } from 'lucide-react';
import { t } from '../../lib/i18n';
import { isEmpty, isLayerActive, setIsolate, useMapView, type LegendSwatch, type MapView } from './layerRegistry';

export function Legend({ view, defaultOpen = true }: { view: MapView; defaultOpen?: boolean }) {
  const state = useMapView(view);
  const [open, setOpen] = useState(defaultOpen);

  // Topmost layer first, matching what the eye meets on the map. A layer hidden by
  // someone ELSE'S isolate still lists here — its rows stay clickable, so switching what
  // is isolated never requires clearing the old selection first.
  const shown = [...view.layers].reverse().flatMap((layer) => {
    const isolatedOut = state.isolate && state.isolate.layerId !== layer.id;
    if (!layer.legend || (!state.visible[layer.id] && !isolatedOut)) return [];
    const data = state.data[layer.id];
    if (data === undefined || isEmpty(data)) return [];
    const entries = typeof layer.legend === 'function' ? layer.legend(data) : layer.legend;
    return entries.length ? [{ layer, entries }] : [];
  });
  if (!shown.length && !state.isolate) return null;

  return (
    <div className="map-panel map-legend" role="group" aria-label={t('map.legend')}>
      <button type="button" className="map-legend__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{t('map.legend')}</span>
        {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
      </button>

      {open && (
        <>
          {state.isolate ? (
            <div className="map-legend__isolate">
              <MousePointerClick aria-hidden />
              <span>{t('map.legend.showing', { label: state.isolate.label })}</span>
              <button type="button" onClick={() => setIsolate(view, null)} aria-label={t('map.legend.showAll')}>
                <X aria-hidden />
              </button>
            </div>
          ) : (
            <div className="map-legend__hint">{t('map.legend.pickHint')}</div>
          )}

          {shown.map(({ layer, entries }) => {
            const dimmed = !isLayerActive(state, layer.id);
            return (
              <div className={`map-legend__layer ${dimmed ? 'is-dimmed' : ''}`} key={layer.id}>
                <div className="map-legend__title">{t(layer.label)}</div>
                {entries.map((entry) => {
                  const key = entry.key ?? entry.label;
                  const active = state.isolate?.layerId === layer.id && state.isolate.key === key;
                  const label = entry.raw ? entry.label : t(entry.label);
                  return (
                    <button
                      type="button"
                      key={key}
                      className="map-legend__item"
                      aria-pressed={active}
                      onClick={() => setIsolate(view, active ? null : { layerId: layer.id, key, label })}
                    >
                      <Swatch swatch={entry.swatch} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export function Swatch({ swatch }: { swatch: LegendSwatch }) {
  if (swatch.kind === 'ramp') {
    const stops = swatch.tokens.map((tk) => `var(${tk})`).join(', ');
    return <span className="map-swatch map-swatch--ramp" style={{ background: `linear-gradient(90deg, ${stops})` }} aria-hidden />;
  }
  const style = { '--swatch': `var(${swatch.token})`, background: 'var(--swatch)' } as CSSProperties;
  return <span className={`map-swatch map-swatch--${swatch.kind}`} style={style} aria-hidden />;
}
