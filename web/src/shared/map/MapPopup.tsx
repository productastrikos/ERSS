/**
 * A React popup anchored to a map coordinate.
 *
 * Popups are React components styled with tokens — not MapLibre `setHTML` strings with
 * inline colours, which is what the DSO map did and why it could not be rethemed.
 * The anchor follows the camera through `useSyncExternalStore` on map move events.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { X } from 'lucide-react';
import { t } from '../../lib/i18n';

interface MapPopupProps {
  map: MapLibreMap;
  lngLat: [number, number];
  onClose: () => void;
  children: ReactNode;
}

export function MapPopup({ map, lngLat, onClose, children }: MapPopupProps) {
  const [lng, lat] = lngLat;

  const key = useSyncExternalStore(
    (notify) => {
      map.on('move', notify);
      map.on('resize', notify);
      return () => {
        map.off('move', notify);
        map.off('resize', notify);
      };
    },
    () => {
      const p = map.project([lng, lat]);
      return `${Math.round(p.x)},${Math.round(p.y)}`;
    },
  );
  const [x, y] = key.split(',').map(Number);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const offscreen = x < -40 || y < -40 || x > w + 40 || y > h + 40;
  if (offscreen) return null;

  // Open below the anchor when there is no room above it, and hug whichever side edge
  // the anchor is close to rather than centring off-screen.
  const below = y < 220;
  const align = x < 170 ? 'start' : x > w - 170 ? 'end' : 'center';

  return (
    <div className={`map-popup map-popup--${align}${below ? ' map-popup--below' : ''}`}
         style={{ transform: `translate(${x}px, ${y}px)` }}>
      <div className="map-popup__card" role="dialog">
        <button type="button" className="map-popup__close" onClick={onClose} aria-label={t('common.close')}>
          <X aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}

/** The shared popup body layout, so every popup kind reads the same way. */
export function PopupBody({ eyebrow, title, chips, rows, children }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  chips?: ReactNode;
  rows?: Array<[label: string, value: ReactNode] | null | false>;
  children?: ReactNode;
}) {
  const shown = (rows ?? []).filter(Boolean) as Array<[string, ReactNode]>;
  return (
    <div className="map-popup__body">
      {eyebrow && <div className="map-popup__eyebrow">{eyebrow}</div>}
      <div className="map-popup__title">{title}</div>
      {chips && <div className="map-popup__chips">{chips}</div>}
      {shown.length > 0 && (
        <dl className="map-popup__rows">
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </div>
  );
}
