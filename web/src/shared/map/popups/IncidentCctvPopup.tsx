/**
 * The CCTV feed that raised an incident, shown right on the map while the AI is deciding
 * — not only inside DetectionPanel's side dialog. Anchored at the camera that saw it
 * (same anchoring primitive as CameraPopup), auto-shown by the director the moment a new
 * incident starts weighing candidates, and gone the moment a job is sent — the map should
 * not stay cluttered with a video feed through the rest of the response.
 */

import { useEffect, useState, type RefObject } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { Camera } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { CctvFeed, SimulatedChip } from '../../ui';
import { MapPopup, PopupBody } from '../MapPopup';
import type { MapCanvasHandle } from '../MapCanvas';
import type { Detection } from '../../../lib/types';

export function IncidentCctvPopup({ mapRef, detection, onClose }: {
  mapRef: RefObject<MapCanvasHandle | null>; detection: Detection; onClose: () => void;
}) {
  // The ref isn't guaranteed populated yet the first time this can render (a fresh
  // detection can arrive before MapCanvas has mounted); poll it from an effect rather
  // than reading `.current` during render.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      const m = mapRef.current?.map() ?? null;
      if (m) setMap(m);
      else raf = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(raf);
  }, [mapRef]);

  const cam = detection.cameras.find((c) => c.primary) ?? detection.cameras[0];
  if (!map || !cam) return null;
  return (
    <MapPopup map={map} lngLat={[cam.lng, cam.lat]} onClose={onClose}>
      <PopupBody
        eyebrow={<><Camera aria-hidden /> {t('map.layer.cameras')} · {cam.name}</>}
        title={detection.place.name}
        chips={<SimulatedChip />}
      >
        <CctvFeed className="map-popup__media" src={cam.clipUrl} label={cam.name} />
      </PopupBody>
    </MapPopup>
  );
}
