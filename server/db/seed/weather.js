/**
 * Weather and the event calendar — the two covariates that move demand most.
 *
 * Heat is a genuine driver in Dubai: heat-related illness rises sharply above 40 °C and
 * spikes near 50 °C. MOHRE legally bans open-air work between 12:30 and 15:00 from
 * 15 June to 15 September, which produces a visible, defensible signature in the data —
 * workplace-injury calls collapse in that window and rebound immediately after.
 *
 * The series also contains the April 2024 extreme rainfall event: the UAE received
 * roughly a year's rain in 24 hours (~142 mm in Dubai), Sheikh Zayed Road was lined with
 * abandoned vehicles, and 20+ people died across the UAE and Oman. Scenario SC-08 runs
 * against it.
 */

import { transaction } from '../../lib/db.js';
import { createRng } from './rng.js';
import { COMMUNITIES } from '../../data/reference/communities.js';

const HOUR_MS = 3600_000;

export async function seedWeatherAndEvents({ rngSeed, months, log }) {
  const rng = createRng(`${rngSeed}:weather`);

  const end = new Date();
  end.setUTCMinutes(0, 0, 0);
  const start = new Date(end.getTime() - months * 30.44 * 24 * HOUR_MS);

  const hours = await seedWeather(rng, start, end);
  const events = await seedEvents(rng, start, end);

  log(`  weather       ${hours.toLocaleString()} hourly records`);
  log(`  events        ${events} entries`);
  return { hours, events };
}

// ── Weather ──────────────────────────────────────────────────────────────────

/** Dubai climate normals: mean daily max / min by month (°C). */
const MONTH_MAX = [24, 26, 29, 33, 38, 40, 41, 42, 39, 35, 30, 26];
const MONTH_MIN = [14, 15, 18, 21, 25, 28, 30, 30, 27, 23, 19, 16];
const MONTH_HUMIDITY = [65, 63, 58, 52, 48, 52, 55, 58, 60, 60, 62, 65];

async function seedWeather(rng, start, end) {
  const rows = [];
  // A slow-moving anomaly so consecutive days correlate — real weather is not i.i.d.
  let anomaly = 0;

  for (let t = start.getTime(); t <= end.getTime(); t += HOUR_MS) {
    const d = new Date(t);
    const m = d.getUTCMonth();
    const hour = d.getUTCHours() + 4;          // GST
    const h = ((hour % 24) + 24) % 24;

    anomaly = anomaly * 0.985 + rng.normal(0, 0.5);

    // Diurnal: coolest ~06:00, hottest ~15:00.
    const phase = Math.cos(((h - 15) / 24) * 2 * Math.PI);
    const mid = (MONTH_MAX[m] + MONTH_MIN[m]) / 2;
    const amp = (MONTH_MAX[m] - MONTH_MIN[m]) / 2;
    const temp = mid + amp * phase + anomaly + rng.normal(0, 0.6);

    const humidity = Math.max(12, Math.min(96,
      MONTH_HUMIDITY[m] + (h < 8 || h > 20 ? 12 : -8) + rng.normal(0, 6)));

    let rain = 0;
    let condition = 'clear';
    let visibility = 10_000;

    // Winter rain, rare and brief.
    if ([11, 0, 1, 2].includes(m) && rng.bool(0.010)) {
      rain = rng.float(0.4, 8);
      condition = 'rain';
      visibility = rng.int(2500, 7000);
    }

    // Fog: a real Dubai pattern, winter mornings, and a collision driver.
    if ([10, 11, 0, 1, 2].includes(m) && h >= 4 && h <= 9 && rng.bool(0.055)) {
      condition = 'fog';
      visibility = rng.int(120, 900);
    }

    // Sandstorm.
    if ([2, 3, 4, 5].includes(m) && rng.bool(0.008)) {
      condition = 'sandstorm';
      visibility = rng.int(400, 2200);
    }

    // The April 2024 event — a year's rain in 24 hours.
    if (d.getUTCFullYear() === 2024 && m === 3 && d.getUTCDate() === 16 && h >= 9) {
      rain = rng.float(4, 22); condition = 'extreme_rain'; visibility = rng.int(300, 1500);
    }
    if (d.getUTCFullYear() === 2024 && m === 3 && d.getUTCDate() === 17) {
      rain = h <= 18 ? rng.float(2, 14) : rng.float(0, 3);
      condition = h <= 18 ? 'extreme_rain' : 'rain';
      visibility = rng.int(500, 3000);
    }

    rows.push({
      ts: new Date(t).toISOString(),
      temp: +temp.toFixed(1),
      humidity: Math.round(humidity),
      windKph: +Math.max(0, rng.normal(condition === 'sandstorm' ? 38 : 14, 7)).toFixed(1),
      windDir: rng.int(0, 359),
      visibility,
      rain: +rain.toFixed(2),
      condition,
    });
  }

  await transaction(async (c) => {
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const o = j * 8;
        values.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`);
        params.push(r.ts, r.temp, r.humidity, r.windKph, r.windDir, r.visibility, r.rain, r.condition);
      });
      await c.query(
        `INSERT INTO weather_hourly (ts, temp_c, humidity, wind_kph, wind_dir, visibility_m, rain_mm, condition)
         VALUES ${values.join(',')}
         ON CONFLICT (ts) DO UPDATE SET temp_c = EXCLUDED.temp_c, condition = EXCLUDED.condition`,
        params,
      );
    }
  });

  return rows.length;
}

// ── Events ───────────────────────────────────────────────────────────────────

/**
 * DCAS covered 42 major events in 2023, clocking 5,000 hours of event standby — first
 * aid at those events contributes heavily to total patient contacts without generating
 * a 998 dispatch. The calendar drives both the demand multiplier and the mega-event
 * scenario.
 */
const RECURRING = [
  { name: 'New Year\'s Eve — Downtown',  kind: 'national',   zone: 'Z-C0501', month: 11, day: 31, hours: 8,  footfall: 500_000, mult: 3.4 },
  { name: 'Dubai Shopping Festival',     kind: 'retail',     zone: 'Z-C0501', month: 0,  day: 5,  hours: 720, footfall: 120_000, mult: 1.3 },
  { name: 'Dubai Marathon',              kind: 'sport',      zone: 'Z-C0305', month: 1,  day: 12, hours: 7,  footfall: 30_000,  mult: 2.1 },
  { name: 'GITEX Global',                kind: 'exhibition', zone: 'Z-C0504', month: 9,  day: 14, hours: 50, footfall: 180_000, mult: 1.6 },
  { name: 'Dubai World Cup',             kind: 'sport',      zone: 'Z-C0901', month: 2,  day: 29, hours: 10, footfall: 60_000,  mult: 2.4 },
  { name: 'Ramadan',                     kind: 'religious',  zone: null,      month: 2,  day: 1,  hours: 720, footfall: 0,       mult: 1.15 },
  { name: 'Eid Al Fitr',                 kind: 'religious',  zone: null,      month: 3,  day: 1,  hours: 72, footfall: 0,       mult: 1.35 },
  { name: 'UAE National Day',            kind: 'national',   zone: 'Z-C0501', month: 11, day: 2,  hours: 30, footfall: 200_000, mult: 2.2 },
  { name: 'Dubai Airshow',               kind: 'exhibition', zone: 'Z-C0803', month: 10, day: 13, hours: 60, footfall: 90_000,  mult: 1.5 },
  { name: 'Formula 1 viewing — Marina',  kind: 'sport',      zone: 'Z-C0401', month: 10, day: 24, hours: 8,  footfall: 25_000,  mult: 1.7 },
];

async function seedEvents(rng, start, end) {
  const rows = [];
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  for (let year = startYear; year <= endYear; year++) {
    for (const e of RECURRING) {
      const from = new Date(Date.UTC(year, e.month, e.day, 16, 0, 0));
      if (from < start || from > end) continue;
      const to = new Date(from.getTime() + e.hours * HOUR_MS);
      rows.push({
        ref: `EVT-${year}-${e.name.replace(/[^A-Za-z]/g, '').slice(0, 10).toUpperCase()}`,
        name: `${e.name} ${year}`, kind: e.kind, zone: e.zone,
        from: from.toISOString(), to: to.toISOString(),
        footfall: e.footfall, mult: e.mult,
      });
    }

    // Concerts and smaller gatherings, ~30 a year, to reach the ~42 events figure.
    for (let i = 0; i < 30; i++) {
      const cm = rng.weighted(COMMUNITIES.filter((c) => c.dayMult > 1.3), (c) => c.pop);
      const from = new Date(Date.UTC(year, rng.int(0, 11), rng.int(1, 28), rng.int(16, 21), 0, 0));
      if (from < start || from > end) continue;
      const hours = rng.int(3, 8);
      rows.push({
        ref: `EVT-${year}-M${String(i).padStart(2, '0')}`,
        name: `${rng.pick(['Concert', 'Festival', 'Exhibition', 'Sports fixture', 'Community event'])} — ${cm.name}`,
        kind: rng.pick(['concert', 'sport', 'exhibition']), zone: cm.ref,
        from: from.toISOString(), to: new Date(from.getTime() + hours * HOUR_MS).toISOString(),
        footfall: rng.int(3_000, 45_000), mult: +rng.float(1.2, 2.0).toFixed(2),
      });
    }
  }

  await transaction(async (c) => {
    for (const e of rows) {
      await c.query(
        `INSERT INTO events_calendar (ref, name, kind, starts_at, ends_at, zone_id,
                                      expected_footfall, demand_multiplier, geom)
         VALUES ($1,$2,$3,$4,$5,
                 (SELECT id FROM zones WHERE ref=$6),
                 $7,$8,
                 (SELECT centroid FROM zones WHERE ref=$6))
         ON CONFLICT (ref) DO UPDATE SET
           starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
           expected_footfall = EXCLUDED.expected_footfall,
           demand_multiplier = EXCLUDED.demand_multiplier`,
        [e.ref, e.name, e.kind, e.from, e.to, e.zone, e.footfall, e.mult],
      );
    }
  });

  return rows.length;
}
