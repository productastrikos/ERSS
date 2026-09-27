/**
 * Reference reads the operational services need: geography, Makani, weather, sites,
 * feeds, calibration. Repositories fetch; engines compute (docs/02 §2 rule 2).
 *
 * Every function takes `db` first — the pool or a transaction client — so a service can
 * run the same read inside or outside its transaction.
 */

export const pt = (lngParam, latParam) => `ST_SetSRID(ST_MakePoint(${lngParam}, ${latParam}), 4326)`;

/** The community a point falls in; failing that, the nearest one. Zone blobs do not tile
 *  the emirate, and an incident on a road between two must still belong somewhere. */
export async function communityAt(db, lng, lat) {
  const { rows } = await db.query(
    `SELECT z.id, z.ref, z.name, z.class, z.population, z.population_daytime, z.area_km2, z.highrise_ct,
            p.ref AS sector_ref, ST_Contains(z.geom, ${pt('$1', '$2')}) AS inside
       FROM zones z LEFT JOIN zones p ON p.id = z.parent_id
      WHERE z.level = 'community'
      ORDER BY ST_Contains(z.geom, ${pt('$1', '$2')}) DESC, z.centroid <-> ${pt('$1', '$2')}
      LIMIT 1`,
    [lng, lat],
  );
  return rows[0] ?? null;
}

export async function makaniByCode(db, code) {
  const { rows } = await db.query(
    `SELECT makani, building_name, entrance_no, entrance_count, entrance_role, floors,
            ST_X(geom) AS lng, ST_Y(geom) AS lat
       FROM makani_points WHERE makani = $1`,
    [code],
  );
  return rows[0] ?? null;
}

/** The nearest entrance within `maxM`, or null. An incident is attached to an EXISTING
 *  Makani entrance — it never mints one. */
export async function nearestMakani(db, lng, lat, maxM = 150) {
  const { rows } = await db.query(
    `SELECT makani, building_name, entrance_no, entrance_count, entrance_role, floors,
            ST_X(geom) AS lng, ST_Y(geom) AS lat,
            ST_Distance(geom::geography, ${pt('$1', '$2')}::geography) AS distance_m
       FROM makani_points
      ORDER BY geom <-> ${pt('$1', '$2')}
      LIMIT 1`,
    [lng, lat],
  );
  const m = rows[0];
  return m && m.distance_m <= maxM ? m : null;
}

/** The latest weather observation at or before `iso`. */
export async function weatherAt(db, iso) {
  const { rows } = await db.query(
    `SELECT ts, temp_c, wind_dir, wind_kph, condition
       FROM weather_hourly WHERE ts <= $1 ORDER BY ts DESC LIMIT 1`,
    [iso],
  );
  const w = rows[0];
  return w ? { ts: new Date(w.ts).toISOString(), windDir: w.wind_dir, windKph: w.wind_kph, tempC: w.temp_c, condition: w.condition } : null;
}

export async function hospitalsNear(db, lng, lat, radiusM) {
  const { rows } = await db.query(
    `SELECT name, on_diversion, ST_Distance(geom::geography, ${pt('$1', '$2')}::geography) AS distance_m
       FROM hospitals
      WHERE ST_DWithin(geom::geography, ${pt('$1', '$2')}::geography, $3)
      ORDER BY distance_m`,
    [lng, lat, radiusM],
  );
  return rows.map((r) => ({ name: r.name, onDiversion: r.on_diversion, distanceM: r.distance_m }));
}

/** Sites from the public-access defibrillator register — schools, malls, metro, stadiums,
 *  mosques. The register doubles as the sensitive-site list because it is one. */
export async function sitesNear(db, lng, lat, radiusM) {
  const { rows } = await db.query(
    `SELECT site_name, site_kind, ST_Distance(geom::geography, ${pt('$1', '$2')}::geography) AS distance_m
       FROM aeds
      WHERE ST_DWithin(geom::geography, ${pt('$1', '$2')}::geography, $3)
      ORDER BY distance_m LIMIT 20`,
    [lng, lat, radiusM],
  );
  return rows.map((r) => ({ siteName: r.site_name, siteKind: r.site_kind, distanceM: r.distance_m }));
}

export async function eventsNear(db, lng, lat, radiusM, atIso) {
  const { rows } = await db.query(
    `SELECT name, kind, expected_footfall,
            ST_Distance(geom::geography, ${pt('$1', '$2')}::geography) AS distance_m
       FROM events_calendar
      WHERE geom IS NOT NULL AND starts_at <= $4 AND ends_at >= $4
        AND ST_DWithin(geom::geography, ${pt('$1', '$2')}::geography, $3)
      ORDER BY distance_m`,
    [lng, lat, radiusM, atIso],
  );
  return rows.map((r) => ({ name: r.name, kind: r.kind, footfall: r.expected_footfall, distanceM: r.distance_m }));
}

export async function feeds(db) {
  const { rows } = await db.query(
    `SELECT f.key, f.name, f.is_simulated, a.code AS agency_code
       FROM agency_feeds f JOIN agencies a ON a.id = f.agency_id ORDER BY f.key`,
  );
  return rows.map((r) => ({ key: r.key, name: r.name, agencyCode: r.agency_code, isSimulated: r.is_simulated }));
}

export async function agencyByCode(db, code) {
  const { rows } = await db.query(
    'SELECT id, code, short_name, sla_ack_sec, is_responder FROM agencies WHERE code = $1', [code],
  );
  return rows[0] ?? null;
}

/** mv_eta_calibration plus the history window it was built from. */
export async function etaCalibration(db) {
  const [cal, win] = await Promise.all([
    db.query('SELECT kind, key, n, p10, p25, p50, p75, p90 FROM mv_eta_calibration'),
    db.query('SELECT MIN(reported_at) AS from_ts, MAX(reported_at) AS to_ts FROM incidents WHERE is_seed'),
  ]);
  const w = win.rows[0];
  return {
    rows: cal.rows,
    window: {
      from: w?.from_ts ? new Date(w.from_ts).toISOString() : null,
      to: w?.to_ts ? new Date(w.to_ts).toISOString() : null,
    },
  };
}
