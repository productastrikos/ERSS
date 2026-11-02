import pg from 'pg';
const pool = new pg.Pool({ host: process.env.DB_HOST, port: +process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
const sql = process.argv.slice(2).join(' ');
const r = await pool.query(sql);
console.table(r.rows.slice(0, 60));
await pool.end();
