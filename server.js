'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const { initDb, getWeeks, putWeeks, upsertWeek, clearWeeks } = require('./server/db');

const PORT = process.env.PORT || 3000;

async function main() {
  await initDb();

  const app = express();

  // Security headers (works with static site too)
  app.use(helmet({
    // Chart.js / Google Fonts / FontAwesome are loaded from CDN in the template.
    // We keep CSP disabled to avoid breaking those CDNs.
    contentSecurityPolicy: false,
  }));

  app.use(morgan('tiny'));
  app.use(express.json({ limit: '2mb' }));

  // API
  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Get all weeks
  app.get('/api/weeks', async (_req, res) => {
    try {
      const weeks = await getWeeks();
      res.json({ weeks });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'db_error', message: 'Не удалось прочитать данные' });
    }
  });

  // Replace all weeks (bulk sync from UI)
  app.put('/api/weeks', async (req, res) => {
    try {
      const weeks = Array.isArray(req.body?.weeks) ? req.body.weeks : null;
      if (!weeks) {
        return res.status(400).json({ error: 'bad_request', message: 'Ожидается JSON { weeks: [...] }' });
      }
      await putWeeks(weeks);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'db_error', message: 'Не удалось сохранить данные' });
    }
  });

  // Upsert one week (optional endpoint if you want it later)
  app.post('/api/weeks', async (req, res) => {
    try {
      const week = req.body?.week;
      if (!week || typeof week !== 'object') {
        return res.status(400).json({ error: 'bad_request', message: 'Ожидается JSON { week: {...} }' });
      }
      await upsertWeek(week);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'db_error', message: 'Не удалось сохранить неделю' });
    }
  });

  // Clear all weeks
  app.delete('/api/weeks', async (_req, res) => {
    try {
      await clearWeeks();
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'db_error', message: 'Не удалось очистить данные' });
    }
  });

  // Static site
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
  }));

  // SPA-ish fallback to index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`✅ Server started on port ${PORT}`);
  });
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
