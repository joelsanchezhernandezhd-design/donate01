require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDb, listDonations } = require("./lib/db");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_KEY = (process.env.MP_PUBLIC_KEY || "").trim();
const CURRENCY = process.env.MP_CURRENCY || "MXN";
const LOCALE = process.env.MP_LOCALE || "es-MX";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const processPaymentHandler = require("./api/process-payment");
app.post("/api/process-payment", (req, res) => processPaymentHandler(req, res));

app.get("/api/admin/donations", async (req, res) => {
  try {
    await initDb();
    const data = await listDonations({
      limit: req.query.limit || 100,
      offset: req.query.offset || 0,
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    publicKey: PUBLIC_KEY,
    currency: CURRENCY,
    locale: LOCALE,
    isSandbox: /^TEST-/i.test(PUBLIC_KEY),
  });
});

app.post("/api/log", (req, res) => {
  console.log("[client-log]", JSON.stringify(req.body || {}));
  res.status(204).end();
});

app.get("/api/health", async (_req, res) => {
  const report = {
    ok: true,
    has: {
      MP_ACCESS_TOKEN: Boolean(process.env.MP_ACCESS_TOKEN),
      MP_PUBLIC_KEY: Boolean(process.env.MP_PUBLIC_KEY),
      DATABASE_URL: Boolean(
        process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL
      ),
    },
  };
  try {
    await initDb();
    report.db = true;
  } catch (e) {
    report.db = false;
    report.dbError = e.message;
  }
  res.json(report);
});

// init DB opcional (para listar donaciones)
initDb().catch((e) => console.warn("DB init:", e.message));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n💚 Donaciones (sin login)`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin.html\n`);
});
