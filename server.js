require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { initDb, insertDonation, listDonations } = require("./lib/db");
const {
  login,
  getSessionUser,
  requireUser,
  requireAdmin,
  sessionCookie,
} = require("./lib/auth");

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || "").trim();
const PUBLIC_KEY = (process.env.MP_PUBLIC_KEY || "").trim();
const CURRENCY = process.env.MP_CURRENCY || "MXN";
const LOCALE = process.env.MP_LOCALE || "es-MX";

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Auth ---
app.post("/api/auth/login", async (req, res) => {
  try {
    await initDb();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "Usuario y contraseña requeridos." });
    }
    const result = await login(username, password);
    if (!result.ok) return res.status(401).json({ error: result.error });
    res.setHeader("Set-Cookie", sessionCookie(result.token));
    res.json({ ok: true, user: result.user, k: result.wireKey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", sessionCookie("", { clear: true }));
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    await initDb();
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ authenticated: false });
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      k: user.wireKey || null,
    });
  } catch (err) {
    res.status(500).json({ authenticated: false, error: err.message });
  }
});

// Alias opaco del pago (misma lógica que process-payment)
const processPaymentHandler = require("./api/process-payment");
app.post("/api/p", (req, res) => processPaymentHandler(req, res));
app.post("/api/process-payment", (req, res) => processPaymentHandler(req, res));

app.get("/api/admin/donations", async (req, res) => {
  try {
    await initDb();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const data = await listDonations({
      limit: req.query.limit || 100,
      offset: req.query.offset || 0,
    });
    res.json({ ok: true, ...data, admin: { username: admin.username } });
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

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`\n💚 Donaciones + auth + admin`);
      console.log(`   → http://localhost:${PORT}`);
      console.log(`   Login:  http://localhost:${PORT}/login.html`);
      console.log(`   Admin:  http://localhost:${PORT}/admin.html`);
      console.log(
        `   Admin user: ${(process.env.ADMIN_USERNAME || "mxnfln").toLowerCase()}\n`
      );
    });
  })
  .catch((err) => {
    console.error("DB init failed", err);
    process.exit(1);
  });
