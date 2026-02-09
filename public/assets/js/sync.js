// Postgres sync layer for the original (working) template.
// IMPORTANT: We DO NOT change the template logic. We only:
// 1) Load data from /api/weeks into app.weeklyData when possible
// 2) Save app.weeklyData to /api/weeks whenever the app saves to localStorage
// 3) Clear DB when the app clears all data
//
// If API is unavailable, the app continues to work via localStorage.

(function () {
  'use strict';

  const API_BASE = ''; // same origin

  async function apiGetWeeks() {
    const res = await fetch(`${API_BASE}/api/weeks`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`GET /api/weeks failed: ${res.status}`);
    return await res.json();
  }

  async function apiPutWeeks(weeks) {
    const res = await fetch(`${API_BASE}/api/weeks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ weeks })
    });
    if (!res.ok) throw new Error(`PUT /api/weeks failed: ${res.status}`);
    return await res.json();
  }

  async function apiClearWeeks() {
    const res = await fetch(`${API_BASE}/api/weeks`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error(`DELETE /api/weeks failed: ${res.status}`);
    return await res.json();
  }

  function waitForApp(timeoutMs = 8000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function tick() {
        if (window.app && typeof window.app === 'object') return resolve(window.app);
        if (Date.now() - start > timeoutMs) return reject(new Error('app not ready'));
        setTimeout(tick, 50);
      })();
    });
  }

  function patchApp(app) {
    // Save: keep original behavior, then sync to DB (best-effort).
    if (typeof app.saveToLocalStorage === 'function' && !app.__pgSavePatched) {
      const origSave = app.saveToLocalStorage.bind(app);
      app.saveToLocalStorage = function () {
        origSave();
        // Best-effort sync; do not block UI.
        apiPutWeeks(this.weeklyData)
          .catch((e) => console.warn('[pg-sync] save failed, keeping localStorage only:', e));
      };
      app.__pgSavePatched = true;
    }

    // Clear all data: if template has clearAllData method, also clear DB.
    if (typeof app.clearAllData === 'function' && !app.__pgClearPatched) {
      const origClear = app.clearAllData.bind(app);
      app.clearAllData = function () {
        const r = origClear();
        apiClearWeeks()
          .catch((e) => console.warn('[pg-sync] clear failed:', e));
        return r;
      };
      app.__pgClearPatched = true;
    }
  }

  async function initialLoad(app) {
    // Try DB first. If DB empty or fails, template localStorage load stays as-is.
    try {
      const data = await apiGetWeeks();
      if (data && Array.isArray(data.weeks)) {
        app.weeklyData = data.weeks;
        if (Array.isArray(app.weeklyData)) {
          // keep template sorting (latest first)
          app.weeklyData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
        // Refresh UI (template methods)
        if (typeof app.updateStats === 'function') app.updateStats();
        if (typeof app.updateDetailedTable === 'function') app.updateDetailedTable();
        if (typeof app.updateHistoryTable === 'function') app.updateHistoryTable();
        if (typeof app.updateReportDates === 'function') app.updateReportDates();
      }
    } catch (e) {
      console.warn('[pg-sync] initial load failed, using localStorage:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const app = await waitForApp();
      patchApp(app);
      await initialLoad(app);
    } catch (e) {
      console.warn('[pg-sync] could not initialize:', e);
    }
  });
})();
