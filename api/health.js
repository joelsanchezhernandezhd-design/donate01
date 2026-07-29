/**
 * Diagnóstico rápido sin secretos: /api/health
 */
module.exports = async function handler(req, res) {
  const report = {
    ok: true,
    vercel: Boolean(process.env.VERCEL),
    has: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL),
      DATABASE_AUTH_TOKEN: Boolean(
        process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
      ),
      SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
      ADMIN_USERNAME: Boolean(process.env.ADMIN_USERNAME),
      ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD),
      MP_ACCESS_TOKEN: Boolean(process.env.MP_ACCESS_TOKEN),
      MP_PUBLIC_KEY: Boolean(process.env.MP_PUBLIC_KEY),
    },
    databaseUrlPrefix: (
      process.env.DATABASE_URL ||
      process.env.TURSO_DATABASE_URL ||
      ""
    ).slice(0, 20),
    db: null,
    error: null,
  };

  try {
    const { initDb, findUserByUsername } = require("../lib/db");
    await initDb();
    const adminName = (process.env.ADMIN_USERNAME || "mxnfln").toLowerCase();
    const u = await findUserByUsername(adminName);
    report.db = {
      connected: true,
      adminExists: Boolean(u),
      adminRole: u?.role || null,
    };
  } catch (err) {
    report.ok = false;
    report.error = err?.message || String(err);
  }

  res.status(report.ok ? 200 : 500).json(report);
};
