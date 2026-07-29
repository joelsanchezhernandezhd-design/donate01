const bcrypt = require("bcryptjs");
const { SignJWT, jwtVerify } = require("jose");
const { parse: parseCookie, serialize: serializeCookie } = require("cookie");
const { findUserByUsername, findUserById } = require("./db");

const COOKIE_NAME = "donate_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 días

function getSecret() {
  const s =
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    "dev-only-change-me-session-secret-32chars";
  return new TextEncoder().encode(s);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(String(plain), String(hash));
}

async function createSessionToken(user) {
  return new SignJWT({
    sub: String(user.id),
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(getSecret());
}

async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

function getTokenFromRequest(req) {
  const header = req.headers?.cookie || req.headers?.Cookie || "";
  const cookies = parseCookie(header || "");
  return cookies[COOKIE_NAME] || null;
}

function sessionCookie(token, { clear = false } = {}) {
  if (clear) {
    return serializeCookie(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

function setCookieHeader(res, cookieStr) {
  // Express
  if (res && typeof res.setHeader === "function" && res.cookie === undefined) {
    const prev = res.getHeader?.("Set-Cookie");
    if (!prev) res.setHeader("Set-Cookie", cookieStr);
    else if (Array.isArray(prev)) res.setHeader("Set-Cookie", [...prev, cookieStr]);
    else res.setHeader("Set-Cookie", [prev, cookieStr]);
  }
  // Vercel / Node style already setHeader
  if (res && typeof res.setHeader === "function") {
    try {
      res.setHeader("Set-Cookie", cookieStr);
    } catch {
      /* ignore */
    }
  }
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
  const token = await createSessionToken(user);
  return {
    ok: true,
    token,
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
  };
}

async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado. Iniciá sesión." });
    return null;
  }
  return user;
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
  requireUser,
  requireAdmin,
  sessionCookie,
  setCookieHeader,
  createSessionToken,
  verifySessionToken,
};
