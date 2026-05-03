// Одноразовый скрипт переноса таблицы `weeks` из старой Render БД в Neon.
// Запуск:
//   1) убедись, что в .env заполнены SOURCE_DATABASE_URL и DATABASE_URL
//   2) npm run migrate

import pg from "pg";
import fs from "fs";
import path from "path";

const { Client } = pg;

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.DATABASE_URL;

if (!SOURCE) { console.error("SOURCE_DATABASE_URL is required"); process.exit(1); }
if (!TARGET) { console.error("DATABASE_URL is required");        process.exit(1); }

async function main() {
  // ШАГ 1. Читаем данные из источника и закрываем соединение.
  console.log("Подключаюсь к источнику…");
  const src = new Client({
    connectionString: SOURCE,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
  await src.connect();
  const { rows } = await src.query(
    "SELECT date, timestamp, data FROM weeks ORDER BY timestamp ASC"
  );
  await src.end();
  console.log(`Найдено записей: ${rows.length}`);

  // ШАГ 2. Пишем в Neon.
  console.log("Подключаюсь к Neon…");
  const dst = new Client({
    connectionString: TARGET,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
  await dst.connect();

  console.log("Создаю схему…");
  await dst.query(`
    CREATE TABLE IF NOT EXISTS weeks (
      date TEXT PRIMARY KEY,
      timestamp BIGINT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await dst.query(`
    CREATE INDEX IF NOT EXISTS weeks_timestamp_desc_idx ON weeks (timestamp DESC);
  `);

  console.log("Переношу записи…");
  let inserted = 0;
  await dst.query("BEGIN");
  try {
    for (const r of rows) {
      await dst.query(
        `INSERT INTO weeks(date, timestamp, data)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (date) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           data = EXCLUDED.data,
           updated_at = now()`,
        [String(r.date), Number(r.timestamp), JSON.stringify(r.data)]
      );
      inserted += 1;
      if (inserted % 5 === 0 || inserted === rows.length) {
        console.log(`  …${inserted}/${rows.length}`);
      }
    }
    await dst.query("COMMIT");
  } catch (e) {
    await dst.query("ROLLBACK").catch(() => {});
    throw e;
  }

  const { rows: countRows } = await dst.query("SELECT count(*)::int AS n FROM weeks");
  await dst.end();
  console.log(`✅ Готово. В Neon сейчас ${countRows[0].n} записей (перенесено ${inserted}).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("❌ Ошибка миграции:", e); process.exit(1); });
