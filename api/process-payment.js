const { MercadoPagoConfig, Payment } = require("mercadopago");
const crypto = require("crypto");
const { requireUser } = require("../lib/auth");
const { initDb, insertDonation } = require("../lib/db");
const { readRequestBody, sealedResponse } = require("../lib/wire");

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
  let sealed = false; // cliente mandó body ofuscado → responder ofuscado

  function sendJson(status, obj) {
    if (sealed && user?.wireKey) {
      res.status(status).json(sealedResponse(obj, user.wireKey));
    } else {
      res.status(status).json(obj);
    }
  }

  try {
    await initDb();
    user = await requireUser(req, res);
    if (!user) return;

    sealed = Boolean(req.body && req.body.v === 1 && req.body.d);
    let payload;
    try {
      payload = readRequestBody(req.body, user.wireKey);
    } catch (e) {
      console.error("[process-payment] unpack failed", e.message);
      sendJson(400, { error: "Payload inválido", code: "BAD_WIRE" });
      return;
    }

    const ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || "").trim();
    console.log("[process-payment] start", {
      user: user.username,
      hasToken: Boolean(ACCESS_TOKEN),
      sealed,
      selectedPaymentMethod: payload?.selectedPaymentMethod,
    });

    if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
      sendJson(500, {
        error: "Falta MP_ACCESS_TOKEN de producción en Vercel.",
      });
      return;
    }

    const formData = payload?.formData ?? payload;
    if (!formData || typeof formData !== "object") {
      sendJson(400, { error: "Faltan datos del pago." });
      return;
    }

    if (
      formData === null ||
      formData.selectedPaymentMethod === "wallet_purchase"
    ) {
      sendJson(400, {
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
      sendJson(400, {
        error: "Datos de pago incompletos.",
        receivedKeys: paymentBody ? Object.keys(paymentBody) : null,
      });
      return;
    }

    amount = Number(paymentBody.transaction_amount);
    if (!Number.isFinite(amount) || amount < 1) {
      sendJson(400, { error: "Monto inválido." });
      return;
    }

    donorName = String(payload?.donorName || "").trim().slice(0, 80);
    message = String(payload?.message || "").trim().slice(0, 200);
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

    sendJson(200, {
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      payment_method_id: result.payment_method_id,
      transaction_amount: result.transaction_amount,
    });
  } catch (err) {
    // Respuesta RAW de Mercado Pago / SDK (sin reescribir el mensaje)
    const raw = {
      message: err?.message ?? null,
      error: err?.error ?? null,
      status: err?.status ?? null,
      cause: err?.cause ?? null,
      // campos extra que a veces trae el SDK
      id: err?.id ?? null,
      name: err?.name ?? null,
      api_response: err?.apiResponse ?? err?.api_response ?? null,
      // por si el SDK anida el body original
      response: err?.response ?? null,
      // todo lo enumerable del error (para no perder nada)
      full: (() => {
        try {
          return JSON.parse(
            JSON.stringify(err, Object.getOwnPropertyNames(err))
          );
        } catch {
          return {
            message: String(err?.message || err),
            status: err?.status,
            cause: err?.cause,
          };
        }
      })(),
    };

    console.error(
      "[process-payment] RAW MP ERROR\n" + JSON.stringify(raw, null, 2)
    );

    if (user && amount != null) {
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
          user_id: user.id,
          username: user.username,
          raw_json: JSON.stringify(raw),
        });
      } catch (dbErr) {
        console.error("[process-payment] save error donation failed", dbErr);
      }
    }

    const httpStatus =
      err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;

    // RAW de MP; si el cliente usa wire, va cifrado en {v,d}
    sendJson(httpStatus, {
      _raw: true,
      message: raw.message,
      error: raw.error || raw.message,
      status: raw.status,
      cause: raw.cause,
      api_response: raw.api_response,
      response: raw.response,
      full: raw.full,
    });
  }
};
