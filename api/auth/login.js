const { login, sessionCookie } = require("../../lib/auth");
const { initDb } = require("../../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
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

  try {
    await initDb();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      res.status(400).json({ error: "Usuario y contraseña requeridos." });
      return;
    }

    const result = await login(username, password);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }

    res.setHeader("Set-Cookie", sessionCookie(result.token));
    res.status(200).json({
      ok: true,
      user: result.user,
    });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({
      error:
        err.message ||
        "Error de login. ¿Configuraste DATABASE_URL (Turso) en Vercel?",
    });
  }
};
