import { useEffect, useRef } from 'react';
import type { SelectedBuilding } from '../../types';
import './BuildingPanel.scss';

interface BuildingPanelProps {
  building:           SelectedBuilding | null;
  onClose:            () => void;
  onOpenDigitalTwin?: () => void;
}

// ── Building-type metadata ─────────────────────────────────────────────────────
type BuildingMeta = { label: string; badge: string; color: string; icon: string };

const TYPE_META: Record<string, BuildingMeta> = {
  apartments:         { label: 'Apartment Block',   badge: 'Residential',  color: '#1976D2', icon: '🏢' },
  residential:        { label: 'Residential',        badge: 'Residential',  color: '#1976D2', icon: '🏘' },
  house:              { label: 'House',              badge: 'Residential',  color: '#1976D2', icon: '🏠' },
  villa:              { label: 'Villa',              badge: 'Villa',        color: '#2E7D32', icon: '🏡' },
  detached:           { label: 'Detached House',     badge: 'Residential',  color: '#2E7D32', icon: '🏡' },
  semidetached_house: { label: 'Semi-detached',      badge: 'Residential',  color: '#2E7D32', icon: '🏠' },
  terrace:            { label: 'Terrace',            badge: 'Residential',  color: '#1976D2', icon: '🏘' },
  commercial:         { label: 'Commercial',         badge: 'Commercial',   color: '#E65100', icon: '🏪' },
  retail:             { label: 'Retail',             badge: 'Retail',       color: '#BF360C', icon: '🛍️' },
  office:             { label: 'Office Building',    badge: 'Commercial',   color: '#E65100', icon: '🏢' },
  hotel:              { label: 'Hotel',              badge: 'Hospitality',  color: '#6A1B9A', icon: '🏨' },
  industrial:         { label: 'Industrial',         badge: 'Industrial',   color: '#546E7A', icon: '🏭' },
  warehouse:          { label: 'Warehouse',          badge: 'Industrial',   color: '#546E7A', icon: '📦' },
  garage:             { label: 'Parking / Garage',   badge: 'Parking',      color: '#78909C', icon: '🅿️' },
  school:             { label: 'School',             badge: 'Education',    color: '#00838F', icon: '🏫' },
  university:         { label: 'University',         badge: 'Education',    color: '#00838F', icon: '🎓' },
  hospital:           { label: 'Hospital',           badge: 'Healthcare',   color: '#C62828', icon: '🏥' },
  mosque:             { label: 'Mosque',             badge: 'Religious',    color: '#2E7D32', icon: '🕌' },
  church:             { label: 'Church',             badge: 'Religious',    color: '#2E7D32', icon: '⛪' },
  public:             { label: 'Public Building',    badge: 'Public',       color: '#4527A0', icon: '🏛️' },
  civic:              { label: 'Civic Building',     badge: 'Public',       color: '#4527A0', icon: '🏛️' },
  government:         { label: 'Government',         badge: 'Government',   color: '#263238', icon: '🏛️' },
  sports_hall:        { label: 'Sports Hall',        badge: 'Sports',       color: '#558B2F', icon: '🏋️' },
  mall:               { label: 'Shopping Mall',      badge: 'Retail',       color: '#BF360C', icon: '🏬' },
  yes:                { label: 'Building',           badge: 'Building',     color: '#455A64', icon: '🏗️' },
};

const FALLBACK_META: BuildingMeta = { label: 'Building', badge: 'Building', color: '#455A64', icon: '🏗️' };

// ── Overpass interesting tags to display ───────────────────────────────────────
const OVERPASS_DISPLAY: Array<{ key: string; label: string; icon: string }> = [
  { key: 'addr:housenumber', label: 'Unit / House No.',  icon: '🏷️' },
  { key: 'addr:street',      label: 'Street',            icon: '📍' },
  { key: 'addr:city',        label: 'City',              icon: '🏙️' },
  { key: 'addr:postcode',    label: 'Post Code',         icon: '📮' },
  { key: 'phone',            label: 'Phone',             icon: '📞' },
  { key: 'contact:phone',    label: 'Phone',             icon: '📞' },
  { key: 'email',            label: 'Email',             icon: '📧' },
  { key: 'contact:email',    label: 'Email',             icon: '📧' },
  { key: 'opening_hours',    label: 'Opening Hours',     icon: '🕐' },
  { key: 'description',      label: 'Description',       icon: '📝' },
  { key: 'brand',            label: 'Brand',             icon: '🏳️' },
  { key: 'architect',        label: 'Architect',         icon: '✏️' },
  { key: 'start_date',       label: 'Built Year',        icon: '📅' },
  { key: 'building:material',label: 'Wall Material',     icon: '🧱' },
  { key: 'building:colour',  label: 'Colour',            icon: '🎨' },
  { key: 'roof:shape',       label: 'Roof Shape',        icon: '🏚️' },
  { key: 'ref',              label: 'Reference No.',     icon: '🔢' },
  { key: 'wikipedia',        label: 'Wikipedia',         icon: '📖' },
  { key: 'wikidata',         label: 'Wikidata',          icon: '🔗' },
];

// Safe string
const str = (v: string | null | undefined) =>
  v != null && v !== 'null' && v !== 'undefined' && v.trim() !== '' ? v.trim() : '';

// Parse numeric from strings like "139.4 m" or "10"
const parseNum = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

export default function BuildingPanel({ building, onClose, onOpenDigitalTwin }: BuildingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!building) return null;

  const b = building;

  // ── Resolve metadata ──────────────────────────────────────────────────────
  const buildingTag = str(b.building);
  let meta = { ...(TYPE_META[buildingTag] ?? FALLBACK_META) };

  // Override with tourism/amenity/shop
  const tourismVal  = str(b.tourism);
  const amenityVal  = str(b.amenity).replace(/_/g, ' ');
  const shopVal     = str(b.shop).replace(/_/g, ' ');

  if (tourismVal === 'hotel') { meta = { ...TYPE_META['hotel'] }; }
  else if (tourismVal)        { meta.badge = tourismVal.replace(/_/g, ' '); meta.color = '#6A1B9A'; }
  if (buildingTag === 'mall' || shopVal === 'mall') { meta = { ...TYPE_META['mall'] }; }

  // ── Fields ────────────────────────────────────────────────────────────────
  const nameStr         = str(b.name);
  const levels          = parseNum(b.levels);
  const heightRaw       = parseNum(b.height);
  const heightM         = heightRaw ?? (levels ? Math.round(levels * 3 * 10) / 10 : null);
  const heightEst       = !heightRaw && !!levels;
  const streetVal       = str(b.street);
  const housenumVal     = str(b.housenumber);
  const operatorVal     = str(b.operator);
  const websiteRaw      = str(b.website);
  const website         = websiteRaw
    ? (websiteRaw.startsWith('http') ? websiteRaw : 'https://' + websiteRaw)
    : '';
  const isResidential   = ['apartments', 'residential', 'house', 'villa', 'detached',
                            'semidetached_house', 'terrace'].includes(buildingTag);

  // ── Block / unit code ─────────────────────────────────────────────────────
  // Priority: overpass addr:housenumber → API housenumber → extract from name
  const overpassHousenum = str(b.extra?.['addr:housenumber']);
  const overpassStreet   = str(b.extra?.['addr:street']);

  let unitId = overpassHousenum || housenumVal;
  let unitLabel = 'Unit / House No.';
  if (!unitId && nameStr) {
    if (/^[A-Z]{1,2}[-\/]?\d+[A-Z]?$/.test(nameStr)) {
      unitId = nameStr;
      unitLabel = 'Unit ID';
    } else {
      const m = nameStr.match(/\s([A-Z]{1,2}-?\d+[A-Z]?|\d+[A-Z]?)\s*$/);
      if (m) { unitId = m[1]; unitLabel = 'Block No.'; }
    }
  }

  const addressLine = [unitId || housenumVal, overpassStreet || streetVal]
    .filter(Boolean).join(', ');

  // ── Title: for pure-code buildings show code prominently ─────────────────
  const title = nameStr && !/^[A-Z]{1,2}[-\/]?\d+[A-Z]?$/.test(nameStr)
    ? nameStr
    : unitId || meta.label;

  // ── Estimated units ────────────────────────────────────────────────────────
  const estUnits = isResidential && levels ? levels * 4 : null;

  // ── Filter Overpass tags for display (skip ones already shown or redundant) ─
  const shownKeys = new Set([
    'addr:housenumber', 'addr:street',
    'name', 'building', 'amenity', 'shop', 'tourism',
    'height', 'building:levels', 'website',
  ]);
  const extraRows = OVERPASS_DISPLAY.filter(({ key }) => {
    if (shownKeys.has(key)) return false;
    const val = str(b.extra?.[key]);
    return !!val;
  });

  // ── Info row helper ────────────────────────────────────────────────────────
  const InfoRow = ({ icon, label, value, href }: { icon: string; label: string; value: string; href?: string }) => (
    <div className="bp-row">
      <span className="bp-row__icon">{icon}</span>
      <div className="bp-row__content">
        <span className="bp-row__label">{label}</span>
        {href
          ? <a className="bp-row__value bp-row__value--link" href={href} target="_blank" rel="noopener">{value}</a>
          : <span className="bp-row__value">{value}</span>}
      </div>
    </div>
  );

  const Divider = () => <div className="bp-divider" />;

  return (
    <div className="building-panel" ref={panelRef}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="bp-header" style={{ borderTopColor: meta.color }}>
        <div className="bp-header__top">
          <span className="bp-header__icon">{meta.icon}</span>
          <button className="bp-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <h2 className="bp-header__title">{title}</h2>
        {nameStr && unitId && nameStr !== unitId && (
          <p className="bp-header__subtitle">{nameStr}</p>
        )}
        <div className="bp-badge" style={{ background: meta.color + '18', color: meta.color, borderColor: meta.color + '40' }}>
          {meta.badge}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="bp-body">

        {/* Unit / Address section */}
        {(unitId || addressLine || overpassHousenum) && (
          <section className="bp-section">
            <h3 className="bp-section__title">📍 Location</h3>
            {unitId     && <InfoRow icon="🏷️" label={unitLabel} value={unitId} />}
            {addressLine && addressLine !== unitId && <InfoRow icon="📍" label="Address"  value={addressLine} />}
            {str(b.extra?.['addr:city'])     && <InfoRow icon="🏙️" label="City"     value={str(b.extra?.['addr:city'])} />}
            {str(b.extra?.['addr:postcode']) && <InfoRow icon="📮" label="Post Code" value={str(b.extra?.['addr:postcode'])} />}
          </section>
        )}

        {/* Structure section */}
        {(levels || heightM || buildingTag || operatorVal) && (
          <>
            <Divider />
            <section className="bp-section">
              <h3 className="bp-section__title">🏗️ Structure</h3>
              {meta.label && <InfoRow icon={meta.icon} label="Type"    value={meta.label} />}
              {levels     && <InfoRow icon="🏢" label="Floors"  value={`${levels} floors`} />}
              {heightM    && (
                <InfoRow icon="📐" label="Height" value={`${heightM} m${heightEst ? ' (est.)' : ''}`} />
              )}
              {isResidential && estUnits && (
                <InfoRow icon="🏠" label="Est. Units" value={`~${estUnits} units`} />
              )}
              {str(b.extra?.['building:material']) && (
                <InfoRow icon="🧱" label="Wall Material" value={str(b.extra?.['building:material'])} />
              )}
              {str(b.extra?.['roof:shape']) && (
                <InfoRow icon="🏚️" label="Roof Shape" value={str(b.extra?.['roof:shape'])} />
              )}
              {str(b.extra?.['start_date']) && (
                <InfoRow icon="📅" label="Built Year" value={str(b.extra?.['start_date'])} />
              )}
              {str(b.extra?.['architect']) && (
                <InfoRow icon="✏️" label="Architect" value={str(b.extra?.['architect'])} />
              )}
            </section>
          </>
        )}

        {/* Use / Operator section */}
        {(operatorVal || amenityVal || shopVal || tourismVal || str(b.extra?.['brand']) || str(b.extra?.['opening_hours'])) && (
          <>
            <Divider />
            <section className="bp-section">
              <h3 className="bp-section__title">ℹ️ Details</h3>
              {operatorVal && <InfoRow icon="🏳️" label="Operator"      value={operatorVal} />}
              {str(b.extra?.['brand']) && <InfoRow icon="🏷️" label="Brand" value={str(b.extra?.['brand'])} />}
              {amenityVal  && <InfoRow icon="📌" label="Amenity"       value={amenityVal} />}
              {shopVal     && <InfoRow icon="🛍️" label="Shop Type"     value={shopVal} />}
              {tourismVal  && !['hotel'].includes(tourismVal) && <InfoRow icon="🗺️" label="Tourism" value={tourismVal.replace(/_/g, ' ')} />}
              {str(b.extra?.['opening_hours']) && (
                <InfoRow icon="🕐" label="Opening Hours" value={str(b.extra?.['opening_hours'])} />
              )}
              {str(b.extra?.['description']) && (
                <InfoRow icon="📝" label="Description" value={str(b.extra?.['description'])} />
              )}
              {str(b.extra?.['ref']) && <InfoRow icon="🔢" label="Reference No." value={str(b.extra?.['ref'])} />}
            </section>
          </>
        )}

        {/* Contact section */}
        {(website || str(b.extra?.['phone']) || str(b.extra?.['contact:phone']) ||
          str(b.extra?.['email']) || str(b.extra?.['contact:email'])) && (
          <>
            <Divider />
            <section className="bp-section">
              <h3 className="bp-section__title">📞 Contact</h3>
              {(str(b.extra?.['phone']) || str(b.extra?.['contact:phone'])) && (
                <InfoRow icon="📞" label="Phone"
                  value={str(b.extra?.['phone']) || str(b.extra?.['contact:phone'])}
                  href={'tel:' + (str(b.extra?.['phone']) || str(b.extra?.['contact:phone']))} />
              )}
              {(str(b.extra?.['email']) || str(b.extra?.['contact:email'])) && (
                <InfoRow icon="📧" label="Email"
                  value={str(b.extra?.['email']) || str(b.extra?.['contact:email'])}
                  href={'mailto:' + (str(b.extra?.['email']) || str(b.extra?.['contact:email']))} />
              )}
              {website && (
                <InfoRow icon="🌐" label="Website"
                  value={(() => { try { return new URL(website).hostname; } catch { return website; } })()}
                  href={website} />
              )}
            </section>
          </>
        )}

        {/* Any remaining extra tags not covered above */}
        {extraRows.length > 0 && (() => {
          const shown = new Set(['addr:housenumber','addr:street','addr:city','addr:postcode',
            'phone','contact:phone','email','contact:email','opening_hours','description',
            'brand','architect','start_date','building:material','building:colour','roof:shape','ref',
            'wikipedia','wikidata']);
          const remaining = extraRows.filter(r => !shown.has(r.key) && str(b.extra?.[r.key]));
          if (!remaining.length) return null;
          return (
            <>
              <Divider />
              <section className="bp-section">
                <h3 className="bp-section__title">🔎 More Info</h3>
                {remaining.map(({ key, label, icon }) => (
                  <InfoRow key={key} icon={icon} label={label} value={str(b.extra?.[key])} />
                ))}
              </section>
            </>
          );
        })()}

        {/* Digital Twin CTA — shown only for The NEST / Schneider Electric */}
        {(nameStr === 'The NEST' || str(b.operator)?.toLowerCase().includes('schneider')) &&
          onOpenDigitalTwin && (
          <>
            <Divider />
            <div className="bp-dt-cta">
              <div className="bp-dt-cta__badge">🧊 Smart Building · EcoStruxure™</div>
              <button className="bp-dt-cta__btn" onClick={() => { onClose(); onOpenDigitalTwin(); }}>
                Open Digital Twin
              </button>
              <p className="bp-dt-cta__note">3D model · Live BMS · Incident simulation</p>
            </div>
          </>
        )}

        {/* Overpass loading indicator */}
        {b.extraLoading && (
          <>
            <Divider />
            <div className="bp-loading">
              <span className="bp-loading__dot" />
              <span className="bp-loading__dot" />
              <span className="bp-loading__dot" />
              <span className="bp-loading__text">Loading more details…</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
