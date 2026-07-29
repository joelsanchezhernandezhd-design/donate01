/**
 * Recibe logs del frontend y los imprime en el runtime de Vercel.
 * POST /api/log  { time, level, msg, data, sessionId }
 */
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

  const body = req.body || {};
  const line = {
    src: "client",
    sessionId: body.sessionId,
    time: body.time,
    level: body.level || "info",
    msg: body.msg,
    data: body.data,
  };

  // Visible en Vercel → Deployments → Functions → Logs
  if (line.level === "error") {
    console.error("[client-log]", JSON.stringify(line));
  } else if (line.level === "warn") {
    console.warn("[client-log]", JSON.stringify(line));
  } else {
    console.log("[client-log]", JSON.stringify(line));
  }

  res.status(204).end();
};
