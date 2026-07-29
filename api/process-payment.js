const { MercadoPagoConfig, Payment } = require("mercadopago");
const crypto = require("crypto");
const { initDb, insertDonation } = require("../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  let amount = null;
  let donorName = "";
  let message = "";
  let externalRef = null;
  let paymentBody = null;

  try {
    try {
      await initDb();
    } catch (dbInitErr) {
      console.warn("[process-payment] DB init skip:", dbInitErr.message);
    }

    const ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || "").trim();
    if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
      res.status(500).json({
        error: "Falta MP_ACCESS_TOKEN de producción en Vercel.",
      });
      return;
    }

    const formData = req.body?.formData ?? req.body;
    if (!formData || typeof formData !== "object") {
      res.status(400).json({ error: "Faltan datos del pago." });
      return;
    }

    if (
      formData === null ||
      formData.selectedPaymentMethod === "wallet_purchase"
    ) {
      res.status(400).json({
        error:
          "Para pagar con cuenta Mercado Pago usá tarjeta u otro medio en el formulario.",
      });
      return;
    }

    paymentBody =
      formData.formData && formData.selectedPaymentMethod
        ? formData.formData
        : formData;

    if (!paymentBody || !paymentBody.transaction_amount) {
      res.status(400).json({ error: "Datos de pago incompletos." });
      return;
    }

    amount = Number(paymentBody.transaction_amount);
    if (!Number.isFinite(amount) || amount < 1) {
      res.status(400).json({ error: "Monto inválido." });
      return;
    }

    donorName = String(req.body?.donorName || "").trim().slice(0, 80);
    message = String(req.body?.message || "").trim().slice(0, 200);
    externalRef = `donation-${Date.now()}`;

    const body = {
      token: paymentBody.token,
      issuer_id: paymentBody.issuer_id,
      payment_method_id: paymentBody.payment_method_id,
      transaction_amount: Math.round(amount * 100) / 100,
      installments: Number(paymentBody.installments) || 1,
      payer: paymentBody.payer,
      description: message
        ? `Donación${donorName ? ` — ${donorName}` : ""}: ${message}`.slice(
            0,
            250
          )
        : `Donación a la tienda${donorName ? ` — ${donorName}` : ""}`.slice(
            0,
            250
          ),
      external_reference: externalRef,
      metadata: {
        type: "donation",
        donor_name: donorName || null,
        message: message || null,
      },
    };

    if (paymentBody.payment_method_option_id) {
      body.payment_method_option_id = paymentBody.payment_method_option_id;
    }
    if (paymentBody.processing_mode) {
      body.processing_mode = paymentBody.processing_mode;
    }

    console.log("[process-payment] MP create", {
      transaction_amount: body.transaction_amount,
      payment_method_id: body.payment_method_id,
      installments: body.installments,
      hasToken: Boolean(body.token),
    });

    const client = new MercadoPagoConfig({
      accessToken: ACCESS_TOKEN,
      options: { timeout: 15000 },
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

    try {
      await insertDonation({
        payment_id: result.id != null ? String(result.id) : null,
        status: result.status || null,
        status_detail: result.status_detail || null,
        amount: result.transaction_amount ?? amount,
        currency: process.env.MP_CURRENCY || "MXN",
        payment_method_id:
          result.payment_method_id || paymentBody.payment_method_id || null,
        payer_email: result.payer?.email || paymentBody.payer?.email || null,
        donor_name: donorName || null,
        message: message || null,
        external_reference: externalRef,
        user_id: null,
        username: null,
        raw_json: JSON.stringify({
          id: result.id,
          status: result.status,
          status_detail: result.status_detail,
          payment_method_id: result.payment_method_id,
          transaction_amount: result.transaction_amount,
        }),
      });
    } catch (dbErr) {
      console.error("[process-payment] DB save failed", dbErr.message);
    }

    res.status(200).json({
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      payment_method_id: result.payment_method_id,
      transaction_amount: result.transaction_amount,
    });
  } catch (err) {
    const raw = {
      message: err?.message ?? null,
      error: err?.error ?? null,
      status: err?.status ?? null,
      cause: err?.cause ?? null,
    };
    console.error("[process-payment] error", raw);

    if (amount != null) {
      try {
        await insertDonation({
          payment_id: null,
          status: "error",
          status_detail: String(raw.message || "error").slice(0, 250),
          amount,
          currency: process.env.MP_CURRENCY || "MXN",
          payment_method_id: paymentBody?.payment_method_id || null,
          payer_email: paymentBody?.payer?.email || null,
          donor_name: donorName || null,
          message: message || null,
          external_reference: externalRef,
          user_id: null,
          username: null,
          raw_json: JSON.stringify(raw),
        });
      } catch (_) {
        /* ignore */
      }
    }

    const httpStatus =
      err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(httpStatus).json({
      _raw: true,
      message: raw.message,
      error: raw.error || raw.message,
      status: raw.status,
      cause: raw.cause,
    });
  }
};
