import express from "express";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;
const configuredSessionTtl = Number(process.env.ADMIN_SESSION_TTL_MS);
const ADMIN_SESSION_TTL_MS =
  Number.isFinite(configuredSessionTtl) && configuredSessionTtl > 0
    ? configuredSessionTtl
    : 8 * 60 * 60 * 1000;

const RES_LIST = [
  { id: "adler", name: "Адлерский РЭС", color: "#1e40af" },
  { id: "dagomys", name: "Дагомысский РЭС", color: "#0ea5e9" },
  { id: "krasnopolyansky", name: "Краснополянский РЭС", color: "#8b5cf6" },
  { id: "lazarevsky", name: "Лазаревский РЭС", color: "#06b6d4" },
  { id: "sochi", name: "Сочинский РЭС", color: "#3b82f6" },
  { id: "tuapse", name: "Туапсинский РЭС", color: "#6366f1" },
  { id: "hostinsky", name: "Хостинский РЭС", color: "#2563eb" },
  { id: "ps", name: "ПС РЭС", color: "#7c3aed", isPsRes: true },
];

const RES_BY_ID = new Map(RES_LIST.map((res) => [res.id, res]));
const adminSessions = new Map();

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (Neon connection string)");
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

pool.on("error", (e) => console.error("PG pool error:", e));

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

function requireAdmin(req, res, next) {
  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token && isValidAdminSession(token)) {
    return next();
  }

  const pass = req.header("X-Admin-Password") || "";
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("base64url");
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return token;
}

function isValidAdminSession(token) {
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || !Number.isSafeInteger(number)) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function normalizeResItem(item, index) {
  if (!item || typeof item !== "object") {
    throw new Error(`data[${index}] must be an object`);
  }

  const config = RES_BY_ID.get(String(item.id || ""));
  if (!config) {
    throw new Error(`data[${index}].id is unknown`);
  }

  const total = toNonNegativeInteger(item.total ?? 0, `data[${index}].total`);
  const survey = toNonNegativeInteger(item.survey ?? 0, `data[${index}].survey`);
  const totalSpo = toNonNegativeInteger(item.totalSpo ?? 0, `data[${index}].totalSpo`);
  const surveySpo = toNonNegativeInteger(item.surveySpo ?? 0, `data[${index}].surveySpo`);

  if (survey > total) {
    throw new Error(`data[${index}].survey cannot be greater than total`);
  }
  if (surveySpo > totalSpo) {
    throw new Error(`data[${index}].surveySpo cannot be greater than totalSpo`);
  }
  if (totalSpo > total) {
    throw new Error(`data[${index}].totalSpo cannot be greater than total`);
  }

  const percent = total > 0 ? survey / total : 0;
  const percentSpo = totalSpo > 0 ? surveySpo / totalSpo : 0;

  return {
    id: config.id,
    name: config.name,
    total,
    survey,
    notInSurvey: total - survey,
    spoNotInSurvey: totalSpo - surveySpo,
    percent,
    totalSpo,
    surveySpo,
    percentSpo,
    percentDisplay: (percent * 100).toFixed(2),
    percentSpoDisplay: (percentSpo * 100).toFixed(2),
    isPsRes: Boolean(config.isPsRes),
  };
}

function normalizeWeek(week, index = 0) {
  if (!week || typeof week !== "object") {
    throw new Error(`week[${index}] must be an object`);
  }
  if (!isIsoDate(week.date)) {
    throw new Error(`week[${index}].date must be YYYY-MM-DD`);
  }
  if (!Array.isArray(week.data)) {
    throw new Error(`week[${index}].data must be an array`);
  }

  const seenIds = new Set();
  const data = week.data.map((item, itemIndex) => {
    const normalized = normalizeResItem(item, itemIndex);
    if (seenIds.has(normalized.id)) {
      throw new Error(`week[${index}].data contains duplicate id ${normalized.id}`);
    }
    seenIds.add(normalized.id);
    return normalized;
  });

  const timestamp = Number(week.timestamp);
  return {
    date: week.date,
    timestamp:
      Number.isFinite(timestamp) && timestamp > 0 && Number.isSafeInteger(timestamp)
        ? timestamp
        : new Date(`${week.date}T00:00:00.000Z`).getTime(),
    data,
  };
}

function normalizeWeeksForRestore(value) {
  if (!Array.isArray(value)) {
    throw new Error("restore payload must be an array");
  }

  const seenDates = new Set();
  return value.map((week, index) => {
    const normalized = normalizeWeek(week, index);
    if (seenDates.has(normalized.date)) {
      throw new Error(`duplicate week date ${normalized.date}`);
    }
    seenDates.add(normalized.date);
    return normalized;
  });
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weeks (
      date TEXT PRIMARY KEY,
      timestamp BIGINT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS weeks_timestamp_desc_idx
    ON weeks (timestamp DESC);
  `);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === "viewer" && !password) {
    return res.json({
      ok: true,
      user: {
        name: "Наблюдатель",
        role: "viewer",
        permissions: ["view", "reports", "export", "history"],
      },
    });
  }

  if (username === "admin" && password === ADMIN_PASSWORD) {
    return res.json({
      ok: true,
      token: createAdminSession(),
      expiresInMs: ADMIN_SESSION_TTL_MS,
      user: {
        name: "Администратор",
        role: "admin",
        permissions: ["view", "edit", "delete", "export", "reports", "input", "backup", "restore"],
      },
    });
  }

  res.status(401).json({ error: "Invalid username or password" });
});

app.get("/api/data", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT date, timestamp, data FROM weeks ORDER BY timestamp DESC"
    );
    res.json(rows.map((row, index) => normalizeWeek(row, index)));
  } catch (e) {
    res
      .status(500)
      .json({ error: "DB error", details: String(e?.message || e) });
  }
});

app.post("/api/data", requireAdmin, async (req, res) => {
  let week;
  try {
    week = normalizeWeek(req.body);
  } catch (e) {
    return res
      .status(400)
      .json({ error: "Invalid data", details: String(e?.message || e) });
  }

  try {
    await pool.query(
      `
      INSERT INTO weeks(date, timestamp, data)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (date) DO UPDATE SET
        timestamp = EXCLUDED.timestamp,
        data = EXCLUDED.data,
        updated_at = now()
      `,
      [week.date, week.timestamp, JSON.stringify(week.data)]
    );

    res.json({ ok: true, saved: week.date });
  } catch (e) {
    res
      .status(500)
      .json({ error: "DB error", details: String(e?.message || e) });
  }
});

app.delete("/api/data", requireAdmin, async (req, res) => {
  try {
    await pool.query("TRUNCATE TABLE weeks");
    res.json({ ok: true });
  } catch (e) {
    res
      .status(500)
      .json({ error: "DB error", details: String(e?.message || e) });
  }
});

app.post("/api/data/restore", requireAdmin, async (req, res) => {
  let weeks;
  try {
    weeks = normalizeWeeksForRestore(req.body);
  } catch (e) {
    return res
      .status(400)
      .json({ error: "Invalid restore data", details: String(e?.message || e) });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE weeks");

    let inserted = 0;
    for (const w of weeks) {
      await client.query(
        `
        INSERT INTO weeks(date, timestamp, data)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (date) DO UPDATE SET
          timestamp = EXCLUDED.timestamp,
          data = EXCLUDED.data,
          updated_at = now()
        `,
        [w.date, w.timestamp, JSON.stringify(w.data)]
      );
      inserted += 1;
    }

    await client.query("COMMIT");
    res.json({ ok: true, total: inserted });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res
      .status(500)
      .json({ error: "Restore failed", details: String(e?.message || e) });
  } finally {
    client.release();
  }
});

const server = await ensureSchema()
  .then(() =>
    app.listen(PORT, () => console.log("Server listening on", PORT))
  )
  .catch((e) => {
    console.error("Failed to init DB schema:", e);
    process.exit(1);
  });

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  try {
    if (server && server.close) {
      await new Promise((resolve) => server.close(resolve));
    }
    await pool.end();
  } catch (e) {
    console.error("Shutdown error:", e);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
