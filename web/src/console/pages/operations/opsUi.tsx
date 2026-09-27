/**
 * Small components the Operations panels share. Their data helpers are in opsModel.ts.
 */

import type { Agency, AgencyCode, Priority } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { AgencyGlyph, Chip } from '../../../shared/ui';
import { PRIORITY_TONE } from './opsModel';

export function PriorityChip({ priority }: { priority: Priority }) {
  return <Chip tone={PRIORITY_TONE[priority]} title={t(`priority.${priority}`)}>{priority}</Chip>;
}

export function AgencyMark({ code, agencies, size }: { code: AgencyCode; agencies: Map<AgencyCode, Agency>; size?: number }) {
  const a = agencies.get(code);
  return <AgencyGlyph glyph={a?.glyph} slot={a?.series_slot} name={a?.short_name ?? t(`agency.${code}`)} size={size} />;
}
