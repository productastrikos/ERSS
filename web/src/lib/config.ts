/**
 * Runtime configuration, read from VITE_* variables and nowhere else.
 *
 * No hard-coded fallback host (docs/14 §2.2): a missing value is reported as missing,
 * not papered over with a URL that happens to work on one machine.
 */

const env = import.meta.env;

export const config = {
  map: {
    /** Basemap style per theme. The light style falls back to the dark one, so a
     *  deployment that only sets VITE_MAP_STYLE still gets a map. */
    styleDark: env.VITE_MAP_STYLE || null,
    styleLight: env.VITE_MAP_STYLE_LIGHT || env.VITE_MAP_STYLE || null,
    /** The "Streets" basemap — a full-colour street map, the same in both themes. The
     *  option is not offered when this is unset. */
    styleStreets: env.VITE_MAP_STYLE_STREETS || null,
    /** The "Satellite" basemap: an XYZ raster imagery template ({z}/{x}/{y}), drawn under
     *  the theme style's own labels and 3D buildings. Not offered when unset. */
    satelliteTiles: env.VITE_MAP_SATELLITE_TILES || null,
    satelliteAttribution: env.VITE_MAP_SATELLITE_ATTRIBUTION || '',
  },
  /** OSRM routing. Public demo server by default, self-hostable (docs/00 O-6). */
  osrmUrl: env.VITE_OSRM_URL || null,
  /** The backend's socket origin. Empty means this page's origin — the dev proxy and the
   *  production nginx block both serve /socket.io beside the app. */
  socketUrl: env.VITE_SOCKET_URL || null,
} as const;
