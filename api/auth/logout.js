const { sessionCookie } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  res.setHeader("Set-Cookie", sessionCookie("", { clear: true }));
  res.status(200).json({ ok: true });
};
