const { getSessionUser } = require("../../lib/auth");
const { initDb } = require("../../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    await initDb();
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.status(200).json({ authenticated: true, user });
  } catch (err) {
    console.error("[auth/me]", err);
    res.status(500).json({ authenticated: false, error: err.message });
  }
};
