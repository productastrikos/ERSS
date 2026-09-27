/**
 * Makani entrances — a small amber chevron pointing at the door, with the 10-digit code
 * in mono beneath it (docs/05 §7.5).
 *
 * Fed rather than self-loading: the useful set is "the entrances of THIS building",
 * which the page knows from the selected incident or a Makani lookup. A tower with
 * eleven entrances gets eleven chevrons, and entrance 4 of 11 is the whole point.
 */

import { IconLayer } from '@deck.gl/layers';
import type { MakaniPoint } from '../../../lib/types';
import { makani as formatMakani } from '../../../lib/format';
import { defineLayer } from '../layerRegistry';
import { chevronIcon } from '../icons/shapes';
import { rgba } from '../tokens';
import { label } from './kit';
import { MakaniPopup } from '../popups/ReferencePopups';

const position = (m: MakaniPoint): [number, number] => [m.lng, m.lat];

export const makaniLayer = defineLayer<MakaniPoint[]>({
  id: 'makani',
  group: 'reference',
  label: 'map.layer.makani',
  order: 60,
  defaultVisible: true,
  source: { kind: 'feed' },
  simulated: true,
  legend: [{ label: 'map.legend.makaniEntrance', swatch: { kind: 'chevron', token: '--app-accent' } }],

  deck: (data, ctx) => {
    const selected = ctx.selection?.kind === 'makani' ? ctx.selection.id : null;
    return [
      new IconLayer<MakaniPoint>({
        id: 'makani:chevrons',
        data,
        pickable: true,
        sizeUnits: 'pixels',
        getPosition: position,
        getIcon: () => chevronIcon(),
        getSize: (m) => (m.makani === selected ? 22 : 16),
        getColor: rgba('--app-accent'),
        updateTriggers: { getColor: [ctx.theme], getSize: [selected] },
      }),
      label({
        id: 'makani',
        data,
        ctx,
        position,
        text: (m) => m.formatted || formatMakani(m.makani),
        offset: [0, 12],
        size: 10,
        mono: true,
        // A tower's entrances sit tens of metres apart; below z17 their codes collide.
        visible: ctx.zoom >= 17,
      }),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const m = hit.object as MakaniPoint;
    return { layerId: 'makani', kind: 'makani', id: m.makani, lngLat: position(m), data: m };
  },
  popup: MakaniPopup,
});
