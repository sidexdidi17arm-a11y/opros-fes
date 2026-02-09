'use strict';

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

// Render Postgres обычно требует SSL. Мы включаем ssl автоматически, если указан DATABASE_URL.
// Если у вас локально без SSL — просто не задавайте PGSSLMODE=require и будет работать.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  // Простая схема: одна строка = одна неделя, поле data хранит массив по ФЭС.
  const sql = `
    CREATE TABLE IF NOT EXISTS fes_weeks (
      date TEXT PRIMARY KEY,
      timestamp BIGINT NOT NULL,
      data JSONB NOT NULL
    );
  `;
  await pool.query(sql);
}

function normalizeWeek(week) {
  // Минимальная валидация, без "умной" логики — чтобы не ломать шаблон.
  const date = String(week.date || '').slice(0, 10);
  const timestamp = Number.isFinite(week.timestamp) ? week.timestamp : new Date(date).getTime();
  const data = Array.isArray(week.data) ? week.data : [];
  return { date, timestamp, data };
}

async function getWeeks() {
  const { rows } = await pool.query(
    'SELECT date, timestamp, data FROM fes_weeks ORDER BY timestamp DESC'
  );
  return rows.map(r => ({ date: r.date, timestamp: Number(r.timestamp), data: r.data }));
}

async function upsertWeek(week) {
  const w = normalizeWeek(week);
  if (!w.date) throw new Error('Week.date is required');
  await pool.query(
    `
      INSERT INTO fes_weeks(date, timestamp, data)
      VALUES ($1, $2, $3)
      ON CONFLICT (date)
      DO UPDATE SET timestamp = EXCLUDED.timestamp, data = EXCLUDED.data
    `,
    [w.date, w.timestamp, w.data]
  );
}

async function putWeeks(weeks) {
  // Синхронизация "как в localStorage": заменяем всё набором, который прислал клиент.
  // Это проще, надёжнее и соответствует логике шаблона.
  const clientWeeks = weeks.map(normalizeWeek).filter(w => w.date);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM fes_weeks');
    for (const w of clientWeeks) {
      await client.query(
        `INSERT INTO fes_weeks(date, timestamp, data) VALUES ($1, $2, $3)`,
        [w.date, w.timestamp, w.data]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function clearWeeks() {
  await pool.query('DELETE FROM fes_weeks');
}

module.exports = {
  initDb,
  getWeeks,
  upsertWeek,
  putWeeks,
  clearWeeks,
};
