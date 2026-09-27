/**
 * Which floor of what — the building drawn as a stack, with the incident's floor lit.
 *
 * The reason this exists rather than a "Floor: 3" field: Dubai's response problem is
 * vertical, and the platform measures vertical access as its own stage precisely because
 * a number in a form does not make a crew arrive faster. A stack shows how far up the
 * patient is, which floors the crew passes through, and which room on that floor — the
 * three things somebody planning the approach actually holds in their head.
 *
 * Inline SVG, tokens only, no 3D. A pitched three.js twin is a better object to explore a
 * building with and a worse one to glance at during a live call; this is the glance.
 */

import { t } from '../../lib/i18n';

export interface FloorStackProps {
  building: NonNullable<import('../../lib/types').Detection['place']['building']>;
  /** The floor the incident is on. */
  floor: number;
}

const FLOOR_H = 26;
const GAP = 4;
const W = 168;

export function FloorStack({ building, floor }: FloorStackProps) {
  // Top floor first, so the picture is the right way up.
  const floors = Array.from({ length: building.floors }, (_, i) => building.floors - i);
  const height = building.floors * FLOOR_H + (building.floors - 1) * GAP;
  const room = building.rooms.find((r) => r.id === building.roomId) ?? null;

  return (
    <figure className="floorstack">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img"
           aria-label={t('detection.floorStackAlt', { name: building.name, floor })}>
        {floors.map((f, i) => {
          const y = i * (FLOOR_H + GAP);
          const here = f === floor;
          const rooms = building.rooms.filter((r) => r.floor === f);
          return (
            <g key={f} className={here ? 'is-here' : undefined}>
              <rect x={22} y={y} width={W - 22} height={FLOOR_H} rx={3}
                    className={here ? 'floorstack__slab floorstack__slab--here' : 'floorstack__slab'} />
              <text x={12} y={y + FLOOR_H / 2 + 3.5} className="floorstack__num" textAnchor="middle">F{f}</text>
              <text x={30} y={y + FLOOR_H / 2 + 3.5}
                    className={here ? 'floorstack__rooms floorstack__rooms--here' : 'floorstack__rooms'}>
                {here && room ? room.name : rooms.map((r) => r.name).join(' · ')}
              </text>
              {here && <circle cx={W - 12} cy={y + FLOOR_H / 2} r={4} className="floorstack__pin" />}
            </g>
          );
        })}
      </svg>
      <figcaption>
        {building.name} · {t('detection.floorOf', { floor, total: building.floors })}
      </figcaption>
    </figure>
  );
}
