const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { findUserByUsername, findUserById } = require("./db");
const { makeWireKey } = require("./wire");

const COOKIE_NAME = "donate_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 días

function getSecretString() {
  return (
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    "dev-only-change-me-session-secret-32chars"
  );
}

/** JWT HS256 mínimo (sin jose/cookie v2 rotos en Vercel) */
function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function signJwt(payload) {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const data = `${header}.${body}`;
  const sig = crypto
    .createHmac("sha256", getSecretString())
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = crypto
    .createHmac("sha256", getSecretString())
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(
      body.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const payload = JSON.parse(json);
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header)
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    });
  return out;
}

function serializeCookie(name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
  if (opts.path) str += `; Path=${opts.path}`;
  if (opts.httpOnly) str += "; HttpOnly";
  if (opts.secure) str += "; Secure";
  if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
  return str;
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(String(plain), String(hash));
}

async function createSessionToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const wk = makeWireKey(); // clave AES por sesión (ofuscación de requests)
  return {
    token: signJwt({
      sub: String(user.id),
      username: user.username,
      role: user.role,
      wk,
      iat: now,
      exp: now + MAX_AGE_SEC,
    }),
    wireKey: wk,
  };
}

async function verifySessionToken(token) {
  return verifyJwt(token);
}

function getTokenFromRequest(req) {
  const header = req.headers?.cookie || req.headers?.Cookie || "";
  const cookies = parseCookies(header);
  return cookies[COOKIE_NAME] || null;
}

function sessionCookie(token, { clear = false } = {}) {
  const secure =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (clear) {
    return serializeCookie(COOKIE_NAME, "", {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
    });
  }
  return serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

async function login(username, password) {
  const user = await findUserByUsername(username);
  if (!user || !user.active) {
    return { ok: false, error: "Usuario o contraseña incorrectos." };
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return { ok: false, error: "Usuario o contraseña incorrectos." };
  }
  const { token, wireKey } = await createSessionToken(user);
  return {
    ok: true,
    token,
    wireKey,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  };
}

async function getSessionUser(req) {
  const token = getTokenFromRequest(req);
  const payload = await verifySessionToken(token);
  if (!payload?.sub) return null;
  const user = await findUserById(Number(payload.sub));
  if (!user || !user.active) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    wireKey: payload.wk || null,
  };
}

/** Usuario + wireKey del JWT (para descifrar body ofuscado) */
async function getSessionContext(req) {
  return getSessionUser(req);
}

async function requireUser(req, res) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "No autenticado. Iniciá sesión." });
      return null;
    }
    return user;
  } catch (err) {
    console.error("[requireUser]", err);
    res.status(500).json({ error: err.message || "Error de sesión" });
    return null;
  }
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Se requiere rol administrador." });
    return null;
  }
  return user;
}

module.exports = {
  COOKIE_NAME,
  login,
  getSessionUser,
  getSessionContext,
  requireUser,
  requireAdmin,
  sessionCookie,
  createSessionToken,
  verifySessionToken,
  getTokenFromRequest,
};
