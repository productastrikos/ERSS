import pg from 'pg';
import { forecast } from './lib/forecast.js';
const pool = new pg.Pool({ host: process.env.DB_HOST, port: +process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: '-c TimeZone=Asia/Dubai' });
const days = Number(process.argv[2] ?? 30);
const { rows } = await pool.query(`
  WITH g AS (SELECT generate_series(date_trunc('hour', now()) - ($1 || ' days')::interval, date_trunc('hour', now()) - interval '1 hour', interval '1 hour') AS h)
  SELECT g.h, COUNT(i.id)::int AS calls FROM g LEFT JOIN incidents i ON i.reported_at >= g.h AND i.reported_at < g.h + interval '1 hour' AND i.is_seed
  GROUP BY g.h ORDER BY g.h`, [days]);
const y = rows.map(r => r.calls);
console.log('n', y.length, 'mean', (y.reduce((a,b)=>a+b,0)/y.length).toFixed(1), 'last 6', y.slice(-6));
for (const season of [24, 168]) {
  const f = forecast(y, { horizon: 24, season, integer: true });
  console.log(`season ${season}: mape ${f.mape} mae ${f.mae} cov80 ${f.coverage80Pct} method ${f.method} caveats ${f.caveats}`);
}
await pool.end();
