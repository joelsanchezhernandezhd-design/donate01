const { initDb, listDonations } = require("../../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  try {
    await initDb();
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const limit = url.searchParams.get("limit") || 100;
    const offset = url.searchParams.get("offset") || 0;
    const data = await listDonations({ limit, offset });
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error("[admin/donations]", err);
    res.status(500).json({ error: err.message });
  }
};
