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
    res.json({ ok: true, user: result.user });
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
    res.json({ authenticated: true, user });
  } catch (err) {
    res.status(500).json({ authenticated: false, error: err.message });
  }
});

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

app.post("/api/process-payment", async (req, res) => {
  try {
    await initDb();
    const user = await requireUser(req, res);
    if (!user) return;

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: "Falta MP_ACCESS_TOKEN" });
    }

    const formData = req.body?.formData ?? req.body;
    const paymentBody =
      formData?.formData && formData?.selectedPaymentMethod
        ? formData.formData
        : formData;

    if (!paymentBody?.transaction_amount) {
      return res.status(400).json({ error: "Datos de pago incompletos." });
    }

    const amount = Number(paymentBody.transaction_amount);
    const donorName = String(req.body?.donorName || "").trim().slice(0, 80);
    const message = String(req.body?.message || "").trim().slice(0, 200);
    const externalRef = `donation-${Date.now()}`;

    const body = {
      ...paymentBody,
      transaction_amount: Math.round(amount * 100) / 100,
      description: message
        ? `Donación${donorName ? ` — ${donorName}` : ""}: ${message}`.slice(0, 250)
        : `Donación a la tienda${donorName ? ` — ${donorName}` : ""}`.slice(0, 250),
      external_reference: externalRef,
      metadata: {
        type: "donation",
        donor_name: donorName || null,
        message: message || null,
        app_user: user.username,
      },
    };

    const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
    const payment = new Payment(client);
    const result = await payment.create({
      body,
      requestOptions: {
        idempotencyKey:
          crypto.randomUUID?.() || crypto.randomBytes(16).toString("hex"),
      },
    });

    try {
      await insertDonation({
        payment_id: result.id != null ? String(result.id) : null,
        status: result.status,
        status_detail: result.status_detail,
        amount: result.transaction_amount ?? amount,
        currency: CURRENCY,
        payment_method_id: result.payment_method_id,
        payer_email: result.payer?.email || paymentBody.payer?.email,
        donor_name: donorName,
        message,
        external_reference: externalRef,
        user_id: user.id,
        username: user.username,
        raw_json: JSON.stringify({
          id: result.id,
          status: result.status,
          status_detail: result.status_detail,
        }),
      });
    } catch (e) {
      console.error("save donation", e);
    }

    res.json({
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      payment_method_id: result.payment_method_id,
      transaction_amount: result.transaction_amount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error de pago" });
  }
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
