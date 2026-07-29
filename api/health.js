/**
 * Diagnóstico rápido sin secretos: /api/health
 * Deploy de prueba: sin auth.
 */
module.exports = async function handler(req, res) {
  const report = {
    ok: true,
    mode: "test-open",
    vercel: Boolean(process.env.VERCEL),
    has: {
      DATABASE_URL: Boolean(
        process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL
      ),
      DATABASE_AUTH_TOKEN: Boolean(
        process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
      ),
      MP_ACCESS_TOKEN: Boolean(process.env.MP_ACCESS_TOKEN),
      MP_PUBLIC_KEY: Boolean(process.env.MP_PUBLIC_KEY),
    },
    db: null,
    error: null,
  };

  try {
    const { initDb } = require("../lib/db");
    await initDb();
    report.db = { connected: true };
  } catch (err) {
    report.ok = false;
    report.error = err?.message || String(err);
  }

  res.status(report.ok ? 200 : 500).json(report);
};
