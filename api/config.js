module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const publicKey = (process.env.MP_PUBLIC_KEY || "").trim();
  const isTestKey = /^TEST-/i.test(publicKey);

  res.status(200).json({
    publicKey,
    currency: process.env.MP_CURRENCY || "MXN",
    locale: process.env.MP_LOCALE || "es-MX",
    // true solo si usás claves TEST- (sandbox)
    isSandbox: isTestKey,
  });
};
