const { MercadoPagoConfig, Payment } = require("mercadopago");
const crypto = require("crypto");

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

  try {
    const ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || "").trim();
    console.log("[process-payment] start", {
      hasToken: Boolean(ACCESS_TOKEN),
      tokenPrefix: ACCESS_TOKEN.slice(0, 8),
      bodyKeys: req.body ? Object.keys(req.body) : [],
      selectedPaymentMethod: req.body?.selectedPaymentMethod,
    });

    if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
      res.status(500).json({
        error: "Falta MP_ACCESS_TOKEN de producción en Vercel.",
      });
      return;
    }

    // formData viene del Payment Brick (Checkout Bricks)
    const formData = req.body?.formData ?? req.body;
    if (!formData || typeof formData !== "object") {
      console.error("[process-payment] missing formData");
      res.status(400).json({ error: "Faltan datos del pago." });
      return;
    }

    // wallet_purchase del Brick a veces manda formData null (usa preference)
    if (formData === null || formData.selectedPaymentMethod === "wallet_purchase") {
      res.status(400).json({
        error:
          "Para pagar con cuenta Mercado Pago usá tarjeta u otro medio en el formulario, o contactá soporte para Wallet.",
      });
      return;
    }

    // El Brick envuelve a veces: { selectedPaymentMethod, formData }
    const paymentBody =
      formData.formData && formData.selectedPaymentMethod
        ? formData.formData
        : formData;

    if (!paymentBody || !paymentBody.transaction_amount) {
      console.error("[process-payment] incomplete paymentBody", {
        keys: paymentBody ? Object.keys(paymentBody) : null,
      });
      res.status(400).json({ error: "Datos de pago incompletos." });
      return;
    }

    const amount = Number(paymentBody.transaction_amount);
    if (!Number.isFinite(amount) || amount < 1) {
      res.status(400).json({ error: "Monto inválido." });
      return;
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

    console.log("[process-payment] MP create body (sanitized)", {
      transaction_amount: body.transaction_amount,
      payment_method_id: body.payment_method_id,
      installments: body.installments,
      issuer_id: body.issuer_id,
      hasToken: Boolean(body.token),
      tokenLen: body.token ? String(body.token).length : 0,
      payerEmail: body.payer?.email,
      description: body.description,
      external_reference: body.external_reference,
    });

    // Producción: Access Token APP_USR-... (nunca TEST-)
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

    console.log("[process-payment] MP result", {
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      payment_method_id: result.payment_method_id,
      transaction_amount: result.transaction_amount,
    });

    res.status(200).json({
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      payment_method_id: result.payment_method_id,
      transaction_amount: result.transaction_amount,
    });
  } catch (err) {
    console.error("[process-payment] error", {
      message: err?.message,
      status: err?.status,
      cause: err?.cause,
    });
    const mpCause = err?.cause;
    let detail = err?.message || "No se pudo procesar el pago.";
    if (Array.isArray(mpCause) && mpCause[0]) {
      detail = mpCause[0].description || mpCause[0].message || detail;
    } else if (mpCause?.message) {
      detail = mpCause.message;
    }
    res.status(err?.status || 500).json({
      error: detail,
      status: err?.status || null,
      cause: mpCause || null,
    });
  }
};
