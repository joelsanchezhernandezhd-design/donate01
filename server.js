require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { MercadoPagoConfig, Preference } = require("mercadopago");

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_PUBLIC_KEY;
const CURRENCY = process.env.MP_CURRENCY || "ARS";
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);

// Con credenciales de producción, MP exige URL pública HTTPS para auto_return.
// localhost / http no sirven: "auto_return invalid. back_url.success must be defined"
const isPublicHttps =
  /^https:\/\//i.test(BASE_URL) && !/localhost|127\.0\.0\.1/i.test(BASE_URL);

if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
  console.warn(
    "\n⚠️  Falta MP_ACCESS_TOKEN en .env — copiá .env.example a .env y pegá tus claves.\n"
  );
}

const client = new MercadoPagoConfig({
  accessToken: ACCESS_TOKEN || "MISSING",
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Expone solo la public key al frontend (seguro para pruebas)
app.get("/api/config", (_req, res) => {
  res.json({
    publicKey: PUBLIC_KEY || "",
    currency: CURRENCY,
  });
});

// Crea una preferencia de pago (Checkout Pro) con el monto elegido
app.post("/api/create-preference", async (req, res) => {
  try {
    if (!ACCESS_TOKEN || ACCESS_TOKEN.includes("xxxxxxxx")) {
      return res.status(500).json({
        error:
          "Configurá MP_ACCESS_TOKEN en el archivo .env antes de crear donaciones.",
      });
    }

    const amount = Number(req.body?.amount);
    const donorName = String(req.body?.name || "").trim().slice(0, 80);
    const message = String(req.body?.message || "").trim().slice(0, 200);

    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({
        error: "Ingresá un monto válido (mínimo 1).",
      });
    }

    // Tope alto solo para evitar errores tontos en prueba
    if (amount > 1_000_000) {
      return res.status(400).json({
        error: "Monto demasiado alto para esta prueba.",
      });
    }

    const titleParts = ["Donación a la tienda"];
    if (donorName) titleParts.push(`— ${donorName}`);
    if (message) titleParts.push(`(${message})`);

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
      // statement_descriptor aparece en el resumen de tarjeta (max ~22 chars)
      statement_descriptor: "DONACION TIENDA",
      external_reference: `donation-${Date.now()}`,
      metadata: {
        type: "donation",
        donor_name: donorName || null,
        message: message || null,
      },
    };

    // Solo con HTTPS público (ej. https://espartaco18.org). Sin esto, MP rechaza auto_return.
    if (isPublicHttps) {
      body.back_urls = {
        success: `${BASE_URL}/success.html`,
        failure: `${BASE_URL}/failure.html`,
        pending: `${BASE_URL}/pending.html`,
      };
      body.auto_return = "approved";
    }

    const result = await preference.create({ body });

    res.json({
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
});

// 0.0.0.0 = necesario en hosting (Render, Railway, etc.)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n💚 Página de donaciones lista`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   BASE_URL: ${BASE_URL}`);
  console.log(
    `   Retorno MP: ${
      isPublicHttps
        ? "HTTPS OK (auto_return activo)"
        : "sin auto_return (usá https://tu-dominio en BASE_URL)"
    }`
  );
  console.log(`   Moneda: ${CURRENCY}`);
  console.log(
    `   Token: ${
      ACCESS_TOKEN && !ACCESS_TOKEN.includes("xxxxxxxx")
        ? "OK"
        : "NO CONFIGURADO"
    }\n`
  );
});
