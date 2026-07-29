/**
 * Endpoint opaco de pago: POST /api/p
 * Body esperado: { v: 1, d: "<payload cifrado AES-GCM>" }
 * El payload descifrado tiene la misma forma que process-payment.
 */
module.exports = require("./process-payment");
