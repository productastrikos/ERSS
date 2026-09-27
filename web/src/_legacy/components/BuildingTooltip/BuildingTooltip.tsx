import type { TooltipInfo } from '../../types';
import './BuildingTooltip.scss';

interface BuildingTooltipProps {
  info: TooltipInfo | null;
}

export default function BuildingTooltip({ info }: BuildingTooltipProps) {
  if (!info || !info.object) return null;

  const { x, y, object } = info;
  const name = object.properties?.name || object.properties?.building || 'Building';
  const height = object.properties?.height
    ? `${object.properties.height} m`
    : object.properties?.levels
    ? `${Number(object.properties.levels) * 3} m (est.)`
    : 'Unknown height';
  const type = object.properties?.building || 'Structure';

  return (
    <div
      className="building-tooltip"
      style={{ left: x + 12, top: y - 10 }}
    >
      <div className="building-tooltip__header">{name}</div>
      <div className="building-tooltip__row">
        <span className="building-tooltip__label">Height</span>
        <span className="building-tooltip__value">{height}</span>
      </div>
      <div className="building-tooltip__row">
        <span className="building-tooltip__label">Type</span>
        <span className="building-tooltip__value">{type}</span>
      </div>
    </div>
  );
}
