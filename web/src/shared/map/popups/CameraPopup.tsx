/**
 * What an operator sees when they click a camera on the map.
 *
 * A camera popup answers three questions and nothing else: what am I looking at, is it
 * running analytics that could raise an incident by itself, and — if it is mid-detection
 * — what did it raise. The feed plays inline, because an operator who has to click twice
 * to see the picture will use the radio instead.
 */

import { t } from '../../../lib/i18n';
import { CctvFeed, Chip, SimulatedChip } from '../../ui';
import { PopupBody } from '../MapPopup';
import type { PopupProps } from '../layerRegistry';
import { useDetections, openDetection } from '../../../lib/stores/live';
import type { Camera } from '../../../lib/types';

export function CameraPopup({ selection }: PopupProps) {
  const { camera: c, detecting } = selection.data as { camera: Camera; detecting: boolean };
  const live = useDetections().items.find((d) => d.cameras.some((cam) => cam.id === c.id) && !!d.stage);

  const place = c.floor != null
    ? `${t('map.camera.floor')} ${c.floor}${c.roomId ? ` · ${c.roomId}` : ''}`
    : c.signalId ?? '—';

  return (
    <PopupBody
      eyebrow={`${t('map.layer.cameras')} · ${c.id}`}
      title={c.name}
      chips={<>
        {detecting
          ? <Chip tone="danger">{t('map.camera.detecting')}</Chip>
          : <Chip tone="neutral">{t('map.camera.watching')}</Chip>}
        {c.analytics.includes('person_down') && <Chip tone="accent">{t('map.camera.personDown')}</Chip>}
        {c.analytics.includes('incident_detection') && <Chip tone="accent">{t('map.camera.incidentAi')}</Chip>}
        <SimulatedChip />
      </>}
      rows={[
        [t('map.camera.location'), place],
        [t('map.camera.operator'), c.agencyCode],
        [t('map.camera.analytics'), c.analytics.join(', ')],
      ]}
    >
      <CctvFeed className="map-popup__media" src={detecting ? c.clipUrl : c.idleClipUrl} label={c.id} />
      {live && (
        <button type="button" className="map-popup__action" onClick={() => openDetection(live.id)}>
          {t('detection.open')} — {live.verdict?.label ?? live.id}
        </button>
      )}
    </PopupBody>
  );
}
