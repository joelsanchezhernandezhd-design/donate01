const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");

let client = null;
let initPromise = null;

function getDatabaseUrl() {
  const url = (
    process.env.DATABASE_URL ||
    process.env.TURSO_DATABASE_URL ||
    "file:./data/donations.db"
  ).trim();
  return url;
}

function getAuthToken() {
  const t =
    process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || "";
  return t.trim() || undefined;
}

function ensureLocalDataDir(url) {
  if (!url.startsWith("file:")) return;
  const filePath = url.replace(/^file:/, "");
  const dir = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getClient() {
  if (client) return client;
  const url = getDatabaseUrl();
  ensureLocalDataDir(url);
  const authToken = getAuthToken();

  // En Vercel no sirve file: — hay que usar Turso (libsql://...)
  if (
    process.env.VERCEL &&
    (url.startsWith("file:") || !url || url.includes("donations.db"))
  ) {
    if (!url.startsWith("libsql://") && !url.startsWith("https://")) {
      throw new Error(
        "En Vercel necesitás DATABASE_URL de Turso (libsql://...). file: no funciona en serverless."
      );
    }
  }

  const opts = { url };
  if (authToken) opts.authToken = authToken;
  client = createClient(opts);
  return client;
}

async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = getClient();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS donations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT,
        status TEXT,
        status_detail TEXT,
        amount REAL,
        currency TEXT DEFAULT 'MXN',
        payment_method_id TEXT,
        payer_email TEXT,
        donor_name TEXT,
        message TEXT,
        external_reference TEXT,
        user_id INTEGER,
        username TEXT,
        raw_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_donations_created ON donations(created_at DESC)`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_donations_payment ON donations(payment_id)`
    );

    const adminUser = (process.env.ADMIN_USERNAME || "mxnfln")
      .trim()
      .toLowerCase();
    const adminPass =
      process.env.ADMIN_PASSWORD || "CambiaEstoYa-2026!";

    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [adminUser],
    });

    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(adminPass, 10);
      await db.execute({
        sql: `INSERT INTO users (username, password_hash, role, active)
              VALUES (?, ?, 'admin', 1)`,
        args: [adminUser, hash],
      });
      console.log(`[db] Admin creado: ${adminUser}`);
    } else if (
      process.env.ADMIN_PASSWORD_RESET === "1" &&
      process.env.ADMIN_PASSWORD
    ) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await db.execute({
        sql: "UPDATE users SET password_hash = ?, role = 'admin', active = 1 WHERE username = ?",
        args: [hash, adminUser],
      });
      console.log(`[db] Admin password reseteada: ${adminUser}`);
    }

    return db;
  })().catch((err) => {
    initPromise = null;
    console.error("[db] init failed", err);
    throw err;
  });
  return initPromise;
}

async function findUserByUsername(username) {
  const db = await initDb();
  const res = await db.execute({
    sql: "SELECT * FROM users WHERE username = ? LIMIT 1",
    args: [String(username).trim().toLowerCase()],
  });
  return res.rows[0] || null;
}

async function findUserById(id) {
  const db = await initDb();
  const res = await db.execute({
    sql: "SELECT id, username, role, active, created_at FROM users WHERE id = ? LIMIT 1",
    args: [id],
  });
  return res.rows[0] || null;
}

async function insertDonation(row) {
  const db = await initDb();
  return db.execute({
    sql: `INSERT INTO donations (
      payment_id, status, status_detail, amount, currency,
      payment_method_id, payer_email, donor_name, message,
      external_reference, user_id, username, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.payment_id || null,
      row.status || null,
      row.status_detail || null,
      row.amount != null ? Number(row.amount) : null,
      row.currency || "MXN",
      row.payment_method_id || null,
      row.payer_email || null,
      row.donor_name || null,
      row.message || null,
      row.external_reference || null,
      row.user_id || null,
      row.username || null,
      row.raw_json || null,
    ],
  });
}

async function listDonations({ limit = 100, offset = 0 } = {}) {
  const db = await initDb();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const res = await db.execute({
    sql: `SELECT * FROM donations ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
    args: [lim, off],
  });
  const countRes = await db.execute("SELECT COUNT(*) AS c FROM donations");
  const sumRes = await db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM donations WHERE status = 'approved'`
  );
  return {
    items: res.rows,
    totalCount: Number(countRes.rows[0]?.c || 0),
    approvedSum: Number(sumRes.rows[0]?.total || 0),
  };
}

module.exports = {
  getClient,
  initDb,
  findUserByUsername,
  findUserById,
  insertDonation,
  listDonations,
};
