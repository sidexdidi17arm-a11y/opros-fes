// Создаёт snapshot таблицы `weeks` в файл backups/YYYY-MM-DD.json.
// Формат совместим с восстановлением через админку (POST /api/data/restore).
// Запуск: npm run backup

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

const TARGET = process.env.DATABASE_URL;
if (!TARGET) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const BACKUP_DIR = path.resolve(process.cwd(), "backups");
const KEEP_LAST = Number(process.env.BACKUP_KEEP_LAST || 30);

function todayStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}${mi}`;
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  console.log("Подключаюсь к Neon…");
  const client = new Client({
    connectionString: TARGET,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
  await client.connect();

  const { rows } = await client.query(
    "SELECT date, timestamp, data FROM weeks ORDER BY timestamp ASC"
  );
  await client.end();

  const stamp = todayStamp();
  const file = path.join(BACKUP_DIR, `${stamp}.json`);

  const payload = {
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    exportedBy: "backup-script",
    count: rows.length,
    data: rows,
  };

  const json = JSON.stringify(payload, null, 2);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, file);

  const sizeKb = (Buffer.byteLength(json, "utf8") / 1024).toFixed(1);
  console.log(`✅ Сохранено: ${file} (${rows.length} записей, ${sizeKb} KB)`);

  const all = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const toDelete = all.slice(0, Math.max(0, all.length - KEEP_LAST));
  for (const f of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`🗑  Удалён старый бэкап: ${f}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Ошибка бэкапа:", e);
    process.exit(1);
  });
