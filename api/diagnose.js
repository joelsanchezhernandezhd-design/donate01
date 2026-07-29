/**
 * Diagnóstico de credenciales Mercado Pago (sin exponer secretos).
 * GET /api/diagnose
 */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const accessToken = (process.env.MP_ACCESS_TOKEN || "").trim();
  const publicKey = (process.env.MP_PUBLIC_KEY || "").trim();
  const currency = process.env.MP_CURRENCY || "MXN";

  const report = {
    ok: true,
    currency,
    publicKey: {
      present: Boolean(publicKey),
      prefix: publicKey.slice(0, 8) || null,
      length: publicKey.length,
      isProduction: /^APP_USR-/i.test(publicKey),
      isTest: /^TEST-/i.test(publicKey),
      hasSpaces: /\s/.test(publicKey),
      hasQuotes: /^["']|["']$/.test(publicKey),
    },
    accessToken: {
      present: Boolean(accessToken),
      prefix: accessToken.slice(0, 8) || null,
      length: accessToken.length,
      isProduction: /^APP_USR-/i.test(accessToken),
      isTest: /^TEST-/i.test(accessToken),
      hasSpaces: /\s/.test(accessToken),
      hasQuotes: /^["']|["']$/.test(accessToken),
    },
    pairMatch: null,
    paymentMethods: null,
    user: null,
    tips: [],
  };

  if (!publicKey || !accessToken) {
    report.ok = false;
    report.tips.push("Faltan MP_PUBLIC_KEY o MP_ACCESS_TOKEN en Vercel.");
    res.status(200).json(report);
    return;
  }

  if (report.publicKey.hasSpaces || report.accessToken.hasSpaces) {
    report.ok = false;
    report.tips.push("Hay espacios en las claves. Borrá y volvé a pegar sin espacios.");
  }
  if (report.publicKey.hasQuotes || report.accessToken.hasQuotes) {
    report.ok = false;
    report.tips.push('Sacá comillas " de las variables en Vercel.');
  }
  if (report.publicKey.isTest || report.accessToken.isTest) {
    report.tips.push(
      "Estás en SANDBOX (TEST-). Para cobros reales usá ambas claves APP_USR- de Producción."
    );
  }
  if (report.publicKey.isProduction !== report.accessToken.isProduction) {
    report.ok = false;
    report.tips.push(
      "Public Key y Access Token no son del mismo ambiente (una TEST y otra APP_USR)."
    );
  }

  try {
    const userRes = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json().catch(() => ({}));
    if (!userRes.ok) {
      report.ok = false;
      report.user = {
        error: userData.message || userData.error || `HTTP ${userRes.status}`,
      };
      report.tips.push(
        "Access Token inválido o revocado. Regeneralo en el panel → Credenciales → Producción."
      );
    } else {
      report.user = {
        id: userData.id,
        nickname: userData.nickname,
        site_id: userData.site_id,
        country_id: userData.country_id,
        email: userData.email
          ? userData.email.replace(/(.{2}).+(@.+)/, "$1***$2")
          : null,
      };
      if (userData.site_id && userData.site_id !== "MLM") {
        report.tips.push(
          `Tu cuenta es site_id=${userData.site_id}. Para México debería ser MLM. Revisá que la cuenta sea de México.`
        );
      }
    }
  } catch (e) {
    report.ok = false;
    report.user = { error: e.message };
  }

  try {
    const pmRes = await fetch(
      "https://api.mercadopago.com/v1/payment_methods",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const pmData = await pmRes.json().catch(() => []);
    if (!pmRes.ok) {
      report.ok = false;
      report.paymentMethods = {
        error: pmData.message || pmData.error || `HTTP ${pmRes.status}`,
      };
      report.tips.push(
        "No se pudieron listar medios de pago. La cuenta puede no tener pagos online activos o el token no sirve."
      );
    } else {
      const list = Array.isArray(pmData) ? pmData : [];
      const cards = list.filter((m) =>
        ["credit_card", "debit_card", "prepaid_card"].includes(m.payment_type_id)
      );
      report.paymentMethods = {
        total: list.length,
        cards: cards.length,
        samples: cards.slice(0, 8).map((m) => m.id),
      };
      if (cards.length === 0) {
        report.ok = false;
        report.tips.push(
          "La cuenta no devuelve tarjetas. Completá verificación de identidad / activación de cobros en Mercado Pago."
        );
      }
    }
  } catch (e) {
    report.ok = false;
    report.paymentMethods = { error: e.message };
  }

  // Public key check: payment_methods with public_key query (used by Brick)
  try {
    const pkRes = await fetch(
      `https://api.mercadopago.com/v1/payment_methods?public_key=${encodeURIComponent(publicKey)}`
    );
    const pkData = await pkRes.json().catch(() => null);
    report.pairMatch = {
      publicKeyPaymentMethodsHttp: pkRes.status,
      ok: pkRes.ok,
    };
    if (!pkRes.ok) {
      report.ok = false;
      report.tips.push(
        "La Public Key no puede consultar medios de pago (Brick falla al escribir la tarjeta). Revisá que sea la Public Key de Producción de la MISMA aplicación que el Access Token."
      );
      if (pkData && (pkData.message || pkData.error)) {
        report.pairMatch.error = pkData.message || pkData.error;
      }
    }
  } catch (e) {
    report.pairMatch = { error: e.message };
    report.ok = false;
  }

  const nick = report.user?.nickname || "";
  const email = report.user?.email || "";
  if (
    /TESTUSER/i.test(nick) ||
    /testuser/i.test(String(email)) ||
    /testuser\.com/i.test(String(email))
  ) {
    report.ok = false;
    report.isTestUserAccount = true;
    report.tips.unshift(
      "CRÍTICO: estas claves son de un USUARIO DE PRUEBA (TESTUSER… / @testuser.com), NO de tu cuenta vendedora real. El Brick en 'producción' de un test user NO procesa tarjetas reales bien → empty_installments y error de BIN. Solución: en el panel de MP entrá con TU cuenta real → Tus integraciones → tu app → Credenciales → Producción → copiá Public Key y Access Token de ESA cuenta (no de cuentas de prueba)."
    );
  }

  if (report.ok && report.tips.length === 0) {
    report.tips.push(
      "Credenciales OK (cuenta real). Si el Brick sigue fallando: tarjeta real válida, monto ≥ $20 MXN."
    );
  }

  res.status(200).json(report);
};
