const crypto = require("crypto");

/**
 * Cifrado simétrico de payloads cliente↔servidor.
 * La clave va en el JWT de sesión (httpOnly) y se entrega al cliente
 * solo vía /api/auth/me y login (sessionStorage).
 */

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromB64url(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function makeWireKey() {
  return b64url(crypto.randomBytes(32));
}

function keyToBuf(wireKeyB64url) {
  const buf = fromB64url(wireKeyB64url);
  if (buf.length !== 32) {
    throw new Error("wire key inválida");
  }
  return buf;
}

/** Cifra un objeto → string opaco */
function pack(obj, wireKeyB64url) {
  const key = keyToBuf(wireKeyB64url);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv(12) + tag(16) + ciphertext
  return b64url(Buffer.concat([iv, tag, enc]));
}

/** Descifra string opaco → objeto */
function unpack(packed, wireKeyB64url) {
  if (!packed || typeof packed !== "string") {
    throw new Error("payload vacío");
  }
  const key = keyToBuf(wireKeyB64url);
  const buf = fromB64url(packed);
  if (buf.length < 12 + 16 + 1) {
    throw new Error("payload corrupto");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

/**
 * Lee body ofuscado { v, d } o body plano (compat).
 * d = payload cifrado; requiere wireKey del JWT.
 */
function readRequestBody(body, wireKey) {
  if (body && typeof body.d === "string" && body.v === 1) {
    if (!wireKey) throw new Error("sin clave de sesión para descifrar");
    return unpack(body.d, wireKey);
  }
  // compat: body JSON normal (local / viejo)
  return body;
}

/** Respuesta ofuscada para el cliente */
function sealedResponse(obj, wireKey) {
  if (!wireKey) return obj;
  try {
    return { v: 1, d: pack(obj, wireKey) };
  } catch {
    return obj;
  }
}

module.exports = {
  makeWireKey,
  pack,
  unpack,
  readRequestBody,
  sealedResponse,
  b64url,
  fromB64url,
};
