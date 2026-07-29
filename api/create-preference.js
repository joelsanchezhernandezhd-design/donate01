const { MercadoPagoConfig, Preference } = require("mercadopago");

function getBaseUrl() {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, "");
  }
  // Vercel da esta URL sola (sin tarjeta)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }
  return "http://localhost:3000";
}

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
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const CURRENCY = process.env.MP_CURRENCY || "MXN";
    const BASE_URL = getBaseUrl();
    const isPublicHttps =
      /^https:\/\//i.test(BASE_URL) &&
      !/localhost|127\.0\.0\.1/i.test(BASE_URL);

    if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
      res.status(500).json({
        error: "Falta MP_ACCESS_TOKEN en las variables de entorno de Vercel.",
      });
      return;
    }

    const amount = Number(req.body?.amount);
    const donorName = String(req.body?.name || "")
      .trim()
      .slice(0, 80);
    const message = String(req.body?.message || "")
      .trim()
      .slice(0, 200);

    if (!Number.isFinite(amount) || amount < 1) {
      res.status(400).json({ error: "Ingresá un monto válido (mínimo 1)." });
      return;
    }

    if (amount > 1_000_000) {
      res.status(400).json({ error: "Monto demasiado alto para esta prueba." });
      return;
    }

    const titleParts = ["Donación a la tienda"];
    if (donorName) titleParts.push(`— ${donorName}`);
    if (message) titleParts.push(`(${message})`);

    const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
    const preference = new Preference(client);

    const body = {
      items: [
        {
          id: "donation",
          title: titleParts.join(" ").slice(0, 250),
          description: "Aporte voluntario / donación",
          quantity: 1,
          currency_id: CURRENCY,
          unit_price: Math.round(amount * 100) / 100,
        },
      ],
      statement_descriptor: "DONACION TIENDA",
      external_reference: `donation-${Date.now()}`,
      metadata: {
        type: "donation",
        donor_name: donorName || null,
        message: message || null,
      },
    };

    if (isPublicHttps) {
      body.back_urls = {
        success: `${BASE_URL}/success.html`,
        failure: `${BASE_URL}/failure.html`,
        pending: `${BASE_URL}/pending.html`,
      };
      body.auto_return = "approved";
    }

    const result = await preference.create({ body });

    res.status(200).json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (err) {
    console.error("Error creando preferencia:", err);
    const detail =
      err?.message ||
      err?.cause?.[0]?.description ||
      "No se pudo crear la preferencia de pago.";
    res.status(500).json({ error: detail });
  }
};
