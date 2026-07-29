/**
 * Ofuscación de requests: AES-256-GCM en el navegador.
 * Clave de sesión (k) viene de login /auth/me → sessionStorage.
 * En Network se ve { v:1, d:"...." } en lugar del JSON de pago.
 *
 * Nota: no es seguridad militar (el JS del cliente se puede inspeccionar).
 * Sirve para que no se lea el body en claro de un vistazo.
 */
(function (global) {
  const KEY_STORAGE = "donate_wk_v1";

  function setWireKey(k) {
    if (k) sessionStorage.setItem(KEY_STORAGE, k);
  }

  function getWireKey() {
    return sessionStorage.getItem(KEY_STORAGE) || "";
  }

  function clearWireKey() {
    sessionStorage.removeItem(KEY_STORAGE);
  }

  function b64urlToBuf(str) {
    const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bufToB64url(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  async function importKey(wireKeyB64url) {
    const raw = b64urlToBuf(wireKeyB64url);
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  async function pack(obj) {
    const wk = getWireKey();
    if (!wk || !global.crypto?.subtle) {
      return obj; // fallback plano
    }
    const key = await importKey(wk);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const enc = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      plain
    );
    // WebCrypto pone el tag al final del ciphertext (últimos 16 bytes)
    const encBytes = new Uint8Array(enc);
    const ct = encBytes.subarray(0, encBytes.length - 16);
    const tag = encBytes.subarray(encBytes.length - 16);
    const out = new Uint8Array(12 + 16 + ct.length);
    out.set(iv, 0);
    out.set(tag, 12);
    out.set(ct, 28);
    return { v: 1, d: bufToB64url(out) };
  }

  async function unpack(body) {
    if (!body || body.v !== 1 || typeof body.d !== "string") return body;
    const wk = getWireKey();
    if (!wk || !global.crypto?.subtle) return body;
    const key = await importKey(wk);
    const buf = b64urlToBuf(body.d);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    // reconstruir formato WebCrypto: ct || tag
    const combined = new Uint8Array(ct.length + 16);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      combined
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /** POST ofuscado a ruta opaca */
  async function postSealed(url, data) {
    const body = await pack(data);
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    let parsed = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = { _parse_error: true, rawText };
    }
    // Si la respuesta viene sellada, descifrar
    if (parsed && parsed.v === 1 && parsed.d) {
      try {
        parsed = await unpack(parsed);
      } catch (e) {
        parsed = {
          error: "No se pudo descifrar respuesta",
          rawText,
          _unpack_error: String(e.message || e),
        };
      }
    }
    return { res, rawText, data: parsed };
  }

  global.DonateWire = {
    setWireKey,
    getWireKey,
    clearWireKey,
    pack,
    unpack,
    postSealed,
  };
})(typeof window !== "undefined" ? window : globalThis);
