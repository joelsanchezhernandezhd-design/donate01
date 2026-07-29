require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_PUBLIC_KEY;
const CURRENCY = process.env.MP_CURRENCY || "MXN";
const LOCALE = process.env.MP_LOCALE || "es-MX";

if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
  console.warn(
    "\n⚠️  Falta MP_ACCESS_TOKEN en .env — usá claves de PRODUCCIÓN (APP_USR-...).\n"
  );
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  const isSandbox = /^TEST-/i.test(PUBLIC_KEY || "");
  res.json({
    publicKey: (PUBLIC_KEY || "").trim(),
    currency: CURRENCY,
    locale: LOCALE,
    isSandbox,
  });
});

// Diagnóstico de claves (abrir en el navegador: /api/diagnose)
app.get("/api/diagnose", async (_req, res) => {
  try {
    const accessToken = (ACCESS_TOKEN || "").trim();
    const publicKey = (PUBLIC_KEY || "").trim();
    const report = {
      ok: true,
      currency: CURRENCY,
      publicKey: {
        present: Boolean(publicKey),
        prefix: publicKey.slice(0, 8) || null,
        isProduction: /^APP_USR-/i.test(publicKey),
        isTest: /^TEST-/i.test(publicKey),
      },
      accessToken: {
        present: Boolean(accessToken),
        prefix: accessToken.slice(0, 8) || null,
        isProduction: /^APP_USR-/i.test(accessToken),
        isTest: /^TEST-/i.test(accessToken),
      },
      tips: [],
    };

    if (!accessToken || !publicKey) {
      report.ok = false;
      report.tips.push("Faltan claves en .env / Vercel.");
      return res.json(report);
    }

    const userRes = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json().catch(() => ({}));
    report.user = userRes.ok
      ? { id: userData.id, site_id: userData.site_id, nickname: userData.nickname }
      : { error: userData.message || userRes.status };

    const pkRes = await fetch(
      `https://api.mercadopago.com/v1/payment_methods?public_key=${encodeURIComponent(publicKey)}`
    );
    report.publicKeyPaymentMethods = { http: pkRes.status, ok: pkRes.ok };
    if (!pkRes.ok) {
      report.ok = false;
      report.tips.push(
        "Public Key no lista medios de pago → el Brick no reconoce tarjetas."
      );
    }

    const pmRes = await fetch(
      "https://api.mercadopago.com/v1/payment_methods",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const pmData = await pmRes.json().catch(() => []);
    if (pmRes.ok && Array.isArray(pmData)) {
      report.cardMethods = pmData.filter((m) =>
        String(m.payment_type_id || "").includes("card")
      ).length;
    } else {
      report.ok = false;
      report.tips.push("Access Token no lista medios de pago.");
    }

    if (report.ok) {
      report.tips.push(
        "Credenciales OK. Probá con tarjeta real o tarjetas de prueba oficiales (no números inventados)."
      );
    }
    res.json(report);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Checkout Bricks → Payments API (producción con APP_USR-)
app.post("/api/process-payment", async (req, res) => {
  try {
    if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
      return res.status(500).json({
        error: "Configurá MP_ACCESS_TOKEN de producción en .env",
      });
    }

    const formData = req.body?.formData ?? req.body;
    if (!formData || typeof formData !== "object") {
      return res.status(400).json({ error: "Faltan datos del pago." });
    }

    const paymentBody =
      formData.formData && formData.selectedPaymentMethod
        ? formData.formData
        : formData;

    if (!paymentBody || paymentBody === null || !paymentBody.transaction_amount) {
      return res.status(400).json({
        error: "Datos de pago incompletos (elegí tarjeta u otro medio en el formulario).",
      });
    }

    const amount = Number(paymentBody.transaction_amount);
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ error: "Monto inválido." });
    }

    const donorName = String(req.body?.donorName || "").trim().slice(0, 80);
    const message = String(req.body?.message || "").trim().slice(0, 200);

    const body = {
      ...paymentBody,
      transaction_amount: Math.round(amount * 100) / 100,
      description: message
        ? `Donación${donorName ? ` — ${donorName}` : ""}: ${message}`.slice(0, 250)
        : `Donación a la tienda${donorName ? ` — ${donorName}` : ""}`.slice(0, 250),
      external_reference: `donation-${Date.now()}`,
      metadata: {
        type: "donation",
        donor_name: donorName || null,
        message: message || null,
      },
    };

    const client = new MercadoPagoConfig({
      accessToken: ACCESS_TOKEN,
      options: { timeout: 10000 },
    });
    const payment = new Payment(client);
    const idempotencyKey =
      req.headers["x-idempotency-key"] ||
      crypto.randomUUID?.() ||
      crypto.randomBytes(16).toString("hex");

    const result = await payment.create({
      body,
      requestOptions: { idempotencyKey },
    });

    res.json({
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      payment_method_id: result.payment_method_id,
      transaction_amount: result.transaction_amount,
    });
  } catch (err) {
    console.error("Error procesando pago:", err);
    const mpCause = err?.cause;
    let detail = err?.message || "No se pudo procesar el pago.";
    if (Array.isArray(mpCause) && mpCause[0]) {
      detail = mpCause[0].description || mpCause[0].message || detail;
    }
    res.status(err?.status || 500).json({ error: detail });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  const isSandbox = /^TEST-/i.test(PUBLIC_KEY || "");
  console.log(`\n💚 Donaciones — Checkout Bricks (integrado)`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   Moneda: ${CURRENCY}`);
  console.log(`   Modo: ${isSandbox ? "SANDBOX (TEST-)" : "PRODUCCIÓN (APP_USR-)"}`);
  console.log(
    `   Token: ${
      ACCESS_TOKEN && !ACCESS_TOKEN.includes("xxxxxxxx") ? "OK" : "NO CONFIGURADO"
    }\n`
  );
});
