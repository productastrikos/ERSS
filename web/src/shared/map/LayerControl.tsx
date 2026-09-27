/**
 * The layer control — GENERATED from the registry, never hand-written.
 *
 * Groups, labels, order, the simulated-source marker and live load status all come
 * from the view's descriptors, so adding a layer module adds its row here for free.
 */

import { useState } from 'react';
import { AlertTriangle, Check, Layers, Loader2, RotateCcw, X } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Button } from '../ui';
import {
  LAYER_GROUPS, setIsolate, setLayerStatus, setVisible, useMapView,
  type LayerDescriptor, type LayerStatus, type MapView,
} from './layerRegistry';

export function LayerControl({ view, defaultOpen = false }: { view: MapView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const state = useMapView(view);

  return (
    <div className="layer-control">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Layers aria-hidden />
        {t('map.layers')}
        {state.isolate && <span className="map-layers__badge" aria-hidden />}
      </Button>

      {open && (
        <div className="map-panel map-layers" role="group" aria-label={t('map.layers')}>
          {state.isolate && (
            <div className="map-layers__isolate">
              <span>{t('map.legend.showing', { label: state.isolate.label })}</span>
              <button type="button" onClick={() => setIsolate(view, null)} aria-label={t('map.legend.showAll')}>
                <X aria-hidden /> {t('map.legend.showAll')}
              </button>
            </div>
          )}
          {LAYER_GROUPS.map((group) => {
            const rows = view.layers.filter((l) => l.group === group.key);
            if (!rows.length) return null;
            return (
              <div className="map-layers__group" key={group.key} role="group" aria-label={t(group.label)}>
                <div className="map-layers__eyebrow" aria-hidden>{t(group.label)}</div>
                {rows.map((layer) => (
                  <LayerRow key={layer.id} view={view} layer={layer}
                            on={!!state.visible[layer.id]}
                            dimmed={!!state.isolate && state.isolate.layerId !== layer.id}
                            status={state.status[layer.id] ?? 'idle'}
                            error={state.errors[layer.id]} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LayerRow({ view, layer, on, dimmed, status, error }: {
  view: MapView;
  layer: LayerDescriptor;
  on: boolean;
  dimmed: boolean;
  status: LayerStatus;
  error?: string;
}) {
  return (
    <div className="map-layers__row" data-on={on} data-dimmed={dimmed}
         title={dimmed ? t('map.legend.hiddenByIsolate') : undefined}>
      <button type="button" role="checkbox" aria-checked={on} className="map-layers__toggle"
              onClick={() => setVisible(view, layer.id, !on)}>
        <span className="map-layers__check" aria-hidden>{on && <Check />}</span>
        <span className="map-layers__label">{t(layer.label)}</span>
      </button>
      <Status view={view} layer={layer} status={status} on={on} error={error} />
    </div>
  );
}

function Status({ view, layer, status, on, error }: {
  view: MapView;
  layer: LayerDescriptor;
  status: LayerStatus;
  on: boolean;
  error?: string;
}) {
  if (status === 'loading') {
    return <span className="map-layers__status"><Loader2 className="u-spin" aria-hidden />{t('common.loading')}</span>;
  }
  if (status === 'error') {
    return (
      <button type="button" className="map-layers__status map-layers__status--error"
              title={error} aria-label={`${t('common.retry')} — ${error ?? t('common.error')}`}
              onClick={() => setLayerStatus(view, layer.id, 'idle')}>
        <AlertTriangle aria-hidden />
        <RotateCcw aria-hidden />
      </button>
    );
  }
  // Only worth saying when the operator has asked to see the layer.
  if (on && status === 'awaiting-feed') return <span className="map-layers__status">{t('map.status.awaitingFeed')}</span>;
  if (on && status === 'empty') return <span className="map-layers__status">{t('map.status.empty')}</span>;
  if (layer.simulated) return <span className="map-layers__status">{t('map.status.simulated')}</span>;
  return null;
}
