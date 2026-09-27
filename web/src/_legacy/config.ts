// ── Network ───────────────────────────────────────────────────────────────────
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'https://socket-dso.astrikos.xyz:8443';

// ── Routing ───────────────────────────────────────────────────────────────────
// OSRM is the road-routing engine — it computes turn-by-turn paths on the same
// OpenStreetMap road network that our /roads API serves as raw GeoJSON geometry.
// The two are complementary: /roads = display geometry, OSRM = route planning.
export const OSRM_URL = import.meta.env.VITE_OSRM_URL ?? 'https://router.project-osrm.org';
