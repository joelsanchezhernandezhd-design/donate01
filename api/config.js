module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    publicKey: process.env.MP_PUBLIC_KEY || "",
    currency: process.env.MP_CURRENCY || "MXN",
  });
};
