/**
 * GST day and hour grids, filled in JavaScript rather than in SQL.
 *
 * Every forecast in the product needs a series with NO HOLES: a day with no call must
 * arrive as a zero, because a forecaster fed a series with gaps in it reads the gaps as a
 * trend. The obvious way to get that is a generated calendar LEFT JOINed on
 * `(reported_at AT TIME ZONE 'Asia/Dubai')::date`, and it is 20× slower than grouping —
 * measured on 409k incidents: 1820ms against 85ms, because the expression is not
 * indexable and the join re-derives it per candidate row. So the aggregates GROUP BY the
 * bucket and the gaps are filled here.
 *
 * Asia/Dubai is UTC+04:00 all year with no daylight saving, so a GST calendar day is
 * exactly a UTC day shifted four hours — which is what makes this arithmetic safe to do
 * with plain UTC dates instead of a timezone library.
 */

export const GST_OFFSET_MS = 4 * 3_600_000;

/** The GST calendar day ('YYYY-MM-DD') containing an instant. */
export const gstDayOf = (ms) => new Date(ms + GST_OFFSET_MS).toISOString().slice(0, 10);

/** The GST hour (0–23) of an instant. */
export const gstHourOf = (ms) => new Date(ms + GST_OFFSET_MS).getUTCHours();

/** Shift a 'YYYY-MM-DD' label by whole days. */
export function shiftDayLabel(label, delta) {
  const d = new Date(`${label}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of day labels from `fromLabel` to `toLabel`, capped for safety. */
export function dayLabelsBetween(fromLabel, toLabel, max = 1100) {
  const out = [];
  let cur = fromLabel;
  while (cur <= toLabel && out.length < max) {
    out.push(cur);
    cur = shiftDayLabel(cur, 1);
  }
  return out;
}

/**
 * The day labels an aggregate should return, whether the window came from an explicit
 * from/to or from "N days back".
 *
 * @param today the DB's own GST today ('YYYY-MM-DD'), so the series never drifts from the
 *              window the SQL actually applied
 */
export function windowDayLabels(filters, days, today) {
  if (filters?.from || filters?.to) {
    const fromMs = filters.from ? Date.parse(filters.from) : Date.parse(`${shiftDayLabel(today, -days)}T00:00:00Z`) - GST_OFFSET_MS;
    const toMs = filters.to ? Date.parse(filters.to) : Date.parse(`${today}T23:59:59Z`) - GST_OFFSET_MS;
    return dayLabelsBetween(gstDayOf(fromMs), gstDayOf(toMs));
  }
  return dayLabelsBetween(shiftDayLabel(today, -days), today);
}

/**
 * Left-join a grouped result onto a complete label list.
 *
 * @param rows  grouped rows, each carrying the bucket label under `key`
 * @param labels the complete, ordered label list
 * @param shape (row|null, label) => outputRow
 */
export function fillDays(rows, labels, key, shape) {
  const byLabel = new Map(rows.map((r) => [r[key], r]));
  return labels.map((label) => shape(byLabel.get(label) ?? null, label));
}

/**
 * The same, for a day × hour grid: 24 buckets per day, in order, no holes.
 *
 * @param rows  grouped rows carrying `day` and `hour`
 * @param shape (row|null, day, hour) => outputRow
 */
export function fillDayHours(rows, labels, shape) {
  const byKey = new Map(rows.map((r) => [`${r.day}:${Number(r.hour)}`, r]));
  const out = [];
  for (const day of labels) {
    for (let hour = 0; hour < 24; hour++) out.push(shape(byKey.get(`${day}:${hour}`) ?? null, day, hour));
  }
  return out;
}

/** The DB's own GST today — one cheap round trip, so JS and SQL agree on "now". */
export async function gstToday(db) {
  const { rows } = await db.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Dubai')::date, 'YYYY-MM-DD') AS today`);
  return rows[0].today;
}
