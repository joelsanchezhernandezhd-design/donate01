const { MercadoPagoConfig, Payment } = require("mercadopago");
const crypto = require("crypto");
const { requireUser } = require("../lib/auth");
const { initDb, insertDonation } = require("../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
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

  let user = null;
  let amount = null;
  let donorName = "";
  let message = "";
  let externalRef = null;
  let paymentBody = null;

  try {
    await initDb();
    user = await requireUser(req, res);
    if (!user) return;

    const ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || "").trim();
    console.log("[process-payment] start", {
      user: user.username,
      hasToken: Boolean(ACCESS_TOKEN),
      selectedPaymentMethod: req.body?.selectedPaymentMethod,
    });

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
      res.status(400).json({
        error: "Datos de pago incompletos.",
        receivedKeys: paymentBody ? Object.keys(paymentBody) : null,
      });
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

    // Campos que a veces rompen el create si vienen null raros del Brick
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
        app_user: user.username,
        app_user_id: user.id,
      },
    };

    // Solo incluir opcionales si existen
    if (paymentBody.payment_method_option_id) {
      body.payment_method_option_id = paymentBody.payment_method_option_id;
    }
    if (paymentBody.processing_mode) {
      body.processing_mode = paymentBody.processing_mode;
    }

    console.log("[process-payment] MP create body (sanitized)", {
      transaction_amount: body.transaction_amount,
      payment_method_id: body.payment_method_id,
      installments: body.installments,
      issuer_id: body.issuer_id,
      hasToken: Boolean(body.token),
      tokenLen: body.token ? String(body.token).length : 0,
      payerEmail: body.payer?.email,
      external_reference: body.external_reference,
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
        payer_email:
          result.payer?.email || paymentBody.payer?.email || null,
        donor_name: donorName || null,
        message: message || null,
        external_reference: externalRef,
        user_id: user.id,
        username: user.username,
        raw_json: JSON.stringify({
          id: result.id,
          status: result.status,
          status_detail: result.status_detail,
          payment_method_id: result.payment_method_id,
          transaction_amount: result.transaction_amount,
          installments: result.installments,
          date_created: result.date_created,
        }),
      });
    } catch (dbErr) {
      console.error("[process-payment] DB save failed", dbErr);
    }

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
      name: err?.name,
    });
    const mpCause = err?.cause;
    let detail = err?.message || "No se pudo procesar el pago.";
    let statusDetail = null;
    if (Array.isArray(mpCause) && mpCause[0]) {
      detail =
        mpCause[0].description ||
        mpCause[0].message ||
        mpCause[0].code ||
        detail;
      statusDetail = mpCause[0].code || null;
    } else if (mpCause?.message) {
      detail = mpCause.message;
    }

    // Mensajes claros de errores típicos de Mercado Pago (vienen de su API, no de lógica nuestra)
    const code = Number(statusDetail || err?.status);
    if (
      code === 7 ||
      /Unauthorized use of live credentials/i.test(String(detail))
    ) {
      detail =
        "Mercado Pago rechazó las credenciales de producción (código 7: Unauthorized use of live credentials). " +
        "Causas comunes: 1) Public Key y Access Token de apps distintas, 2) una clave TEST- y otra APP_USR-, " +
        "3) la aplicación en el panel aún no tiene cobros productivos habilitados, 4) token revocado. " +
        "Solución: panel MP → tu app → Credenciales → Producción → copiá de nuevo ambas claves de la MISMA app y actualizá Vercel + Redeploy.";
    }

    if (user && amount != null) {
      try {
        await insertDonation({
          payment_id: null,
          status: "error",
          status_detail: String(detail).slice(0, 250),
          amount,
          currency: process.env.MP_CURRENCY || "MXN",
          payment_method_id: paymentBody?.payment_method_id || null,
          payer_email: paymentBody?.payer?.email || null,
          donor_name: donorName || null,
          message: message || null,
          external_reference: externalRef,
          user_id: user.id,
          username: user.username,
          raw_json: JSON.stringify({
            error: detail,
            cause: mpCause || null,
            message: err?.message || null,
          }),
        });
      } catch (dbErr) {
        console.error("[process-payment] save error donation failed", dbErr);
      }
    }

    res.status(err?.status && err.status >= 400 ? err.status : 500).json({
      error: detail,
      status_detail: statusDetail,
      status: err?.status || null,
      cause: mpCause || null,
      message: err?.message || null,
    });
  }
};
