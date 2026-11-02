/**
 * Which citizen SOS each ambulance is answering.
 *
 * A caller watching their own SOS sits in room `sos:<ref>` (realtime/index.js), and the
 * ambulance coming to them is just another unit in the position stream. This is the one
 * lookup that joins the two, so services/positions.js can push the crew's position to the
 * caller at the same rate it reaches the consoles — the citizen's map moves with the room's.
 *
 * In memory and self-healing: services/sos.js links on every offer and on every status
 * read, so a server restart costs a caller at most one REST poll. No imports, on purpose —
 * both the position path and the SOS service read it, and neither may pull in the other.
 */

/** unitRef → incidentRef */
const byUnit = new Map();

export function linkSos(unitRef, incidentRef) {
  if (unitRef && incidentRef) byUnit.set(unitRef, incidentRef);
}

export function unlinkSosUnit(unitRef, incidentRef = null) {
  if (!unitRef) return;
  if (incidentRef == null || byUnit.get(unitRef) === incidentRef) byUnit.delete(unitRef);
}

export function unlinkSosIncident(incidentRef) {
  for (const [unitRef, ref] of byUnit) if (ref === incidentRef) byUnit.delete(unitRef);
}

export const sosForUnit = (unitRef) => byUnit.get(unitRef) ?? null;

/** The ambulance answering an SOS, if one is linked. */
export function unitForSos(incidentRef) {
  for (const [unitRef, ref] of byUnit) if (ref === incidentRef) return unitRef;
  return null;
}

export function clearSosLinks() {
  byUnit.clear();
}
