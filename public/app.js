(function () {
  const stepAmount = document.getElementById("step-amount");
  const stepPayment = document.getElementById("step-payment");
  const stepResult = document.getElementById("step-result");
  const amountInput = document.getElementById("amount");
  const nameInput = document.getElementById("name");
  const messageInput = document.getElementById("message");
  const summaryAmount = document.getElementById("summary-amount");
  const summaryCurrency = document.getElementById("summary-currency");
  const currencyPrefix = document.getElementById("currency-prefix");
  const continueBtn = document.getElementById("continue-btn");
  const backBtn = document.getElementById("back-btn");
  const againBtn = document.getElementById("again-btn");
  const amountError = document.getElementById("amount-error");
  const paymentError = document.getElementById("payment-error");
  const payAmountLabel = document.getElementById("pay-amount-label");
  const envBadge = document.getElementById("env-badge");
  const modeLabel = document.getElementById("mode-label");
  const logPanel = document.getElementById("debug-log");
  const logBody = document.getElementById("debug-log-body");
  const logCopyBtn = document.getElementById("debug-log-copy");
  const logClearBtn = document.getElementById("debug-log-clear");
  const amountButtons = document.querySelectorAll(".amount-btn");
  const userBar = document.getElementById("user-bar");
  const userNameEl = document.getElementById("user-name");
  const adminLink = document.getElementById("admin-link");
  const logoutLink = document.getElementById("logout-link");

  let currency = "MXN";
  let publicKey = "";
  let locale = "es-MX";
  let isSandbox = false;
  let paymentBrickController = null;
  let currentAmount = 0;
  let currentUser = null;
  // En MX, Visa/BBVA exige min ~$5 en 1 cuota y ~$10 en más cuotas.
  // Con $1 el API trae installments pero el Brick filtra TODO → empty_installments.
  const MIN_AMOUNT = 10;
  const LOG_KEY = "donate_debug_logs_v1";
  const ERR_KEY = "donate_last_payment_error_v1";
  const logEntries = [];
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    if (Array.isArray(saved)) {
      saved.slice(-150).forEach((e) => logEntries.push(e));
    }
  } catch (_) {
    /* ignore */
  }
  const sessionId =
    "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

  const lastPaymentError = document.getElementById("last-payment-error");
  const lastPaymentErrorBody = document.getElementById("last-payment-error-body");
  const copyLastErrorBtn = document.getElementById("copy-last-error");

  function persistLogs() {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(logEntries.slice(-150)));
    } catch (_) {
      /* quota */
    }
  }

  function setLastPaymentError(text) {
    const msg = String(text || "").trim();
    if (!msg) return;
    try {
      localStorage.setItem(ERR_KEY, msg);
    } catch (_) {
      /* ignore */
    }
    if (lastPaymentError && lastPaymentErrorBody) {
      lastPaymentError.hidden = false;
      lastPaymentErrorBody.textContent = msg;
    }
  }

  function restoreLastPaymentError() {
    try {
      const msg = localStorage.getItem(ERR_KEY);
      if (msg && lastPaymentError && lastPaymentErrorBody) {
        lastPaymentError.hidden = false;
        lastPaymentErrorBody.textContent = msg;
      }
    } catch (_) {
      /* ignore */
    }
  }

  if (copyLastErrorBtn) {
    copyLastErrorBtn.addEventListener("click", async () => {
      const t = lastPaymentErrorBody?.textContent || "";
      try {
        await navigator.clipboard.writeText(t);
        copyLastErrorBtn.textContent = "¡Copiado!";
        setTimeout(() => {
          copyLastErrorBtn.textContent = "Copiar error";
        }, 1500);
      } catch (_) {
        /* ignore */
      }
    });
  }

  /** Serializa sin reventar por ciclos / Error */
  function safeSerialize(value, depth) {
    const d = depth == null ? 0 : depth;
    if (d > 6) return "[MaxDepth]";
    if (value == null) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause != null ? safeSerialize(value.cause, d + 1) : undefined,
      };
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((v) => safeSerialize(v, d + 1));
    }
    if (typeof value === "object") {
      const out = {};
      const keys = Object.keys(value).slice(0, 40);
      for (const k of keys) {
        try {
          // no loguear PAN completo si apareciera
          if (/card_number|number|security|cvv|password|secret|token/i.test(k) && typeof value[k] === "string" && value[k].length > 8) {
            out[k] = `[redacted len=${value[k].length}]`;
          } else {
            out[k] = safeSerialize(value[k], d + 1);
          }
        } catch (e) {
          out[k] = "[Unserializable]";
        }
      }
      return out;
    }
    return String(value);
  }

  function renderLogPanel() {
    if (!logBody) return;
    logBody.textContent = logEntries
      .map((e) => {
        const data =
          e.data !== undefined
            ? "\n" + JSON.stringify(safeSerialize(e.data), null, 2)
            : "";
        return `[${e.time}] ${e.level.toUpperCase()} ${e.msg}${data}`;
      })
      .join("\n\n----------------\n\n");
    logBody.scrollTop = logBody.scrollHeight;
  }

  function log(level, msg, data) {
    const entry = {
      time: new Date().toISOString(),
      level,
      msg: String(msg),
      data: data !== undefined ? safeSerialize(data) : undefined,
      sessionId,
    };
    logEntries.push(entry);
    if (logEntries.length > 200) logEntries.shift();
    persistLogs();

    const consoleFn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    if (data !== undefined) consoleFn("[MP-DONATE]", msg, data);
    else consoleFn("[MP-DONATE]", msg);

    renderLogPanel();

    if (level === "error") {
      const blob =
        msg +
        (data !== undefined
          ? "\n" + JSON.stringify(safeSerialize(data), null, 2)
          : "");
      setLastPaymentError(blob);
    }

    // También al servidor (logs de Vercel)
    try {
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {});
    } catch (_) {
      /* ignore */
    }
  }

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat("es-MX", {
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  }

  function setActiveButton(value) {
    amountButtons.forEach((btn) => {
      const match = Number(btn.dataset.amount) === Number(value);
      btn.classList.toggle("active", match);
    });
  }

  function updateSummary() {
    const n = Number(amountInput.value);
    if (Number.isFinite(n) && n > 0) {
      summaryAmount.textContent = `$${formatMoney(n)}`;
      summaryCurrency.textContent = currency ? ` ${currency}` : "";
    } else {
      summaryAmount.textContent = "—";
      summaryCurrency.textContent = "";
    }
  }

  function showError(el, msg) {
    el.hidden = !msg;
    el.textContent = msg || "";
    if (msg) log("error", "UI error shown", { msg });
  }

  function showStep(step) {
    stepAmount.hidden = step !== "amount";
    stepPayment.hidden = step !== "payment";
    stepResult.hidden = step !== "result";
    log("info", "step → " + step);
  }

  if (logCopyBtn) {
    logCopyBtn.addEventListener("click", async () => {
      const text = logBody ? logBody.textContent : "";
      try {
        await navigator.clipboard.writeText(text);
        logCopyBtn.textContent = "¡Copiado!";
        setTimeout(() => {
          logCopyBtn.textContent = "Copiar logs";
        }, 1500);
      } catch {
        log("warn", "No se pudo copiar al portapapeles");
      }
    });
  }
  if (logClearBtn) {
    logClearBtn.addEventListener("click", () => {
      logEntries.length = 0;
      persistLogs();
      try {
        localStorage.removeItem(ERR_KEY);
      } catch (_) {
        /* ignore */
      }
      if (lastPaymentError) lastPaymentError.hidden = true;
      renderLogPanel();
    });
  }

  // Restaurar panel de logs al cargar
  renderLogPanel();
  restoreLastPaymentError();

  amountButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      amountInput.value = btn.dataset.amount;
      setActiveButton(btn.dataset.amount);
      updateSummary();
      showError(amountError, "");
      log("info", "Monto preset", { amount: btn.dataset.amount });
    });
  });

  amountInput.addEventListener("input", () => {
    setActiveButton(amountInput.value);
    updateSummary();
    showError(amountError, "");
  });

  async function loadConfig() {
    log("info", "Cargando /api/config…");
    const res = await fetch("/api/config");
    const cfg = await res.json().catch(() => ({}));
    log("info", "/api/config response", { status: res.status, cfg: { ...cfg, publicKey: cfg.publicKey ? cfg.publicKey.slice(0, 12) + "…" : null } });
    if (!res.ok) throw new Error("No se pudo cargar la configuración.");

    publicKey = (cfg.publicKey || "").trim();
    currency = cfg.currency || "MXN";
    locale = cfg.locale || "es-MX";
    isSandbox = Boolean(cfg.isSandbox);

    currencyPrefix.textContent = "$";
    modeLabel.textContent = isSandbox ? "· SANDBOX" : "· PRODUCCIÓN";

    if (isSandbox) {
      envBadge.hidden = false;
      envBadge.textContent =
        "Modo prueba (claves TEST-). Para cobros reales usá Public Key APP_USR- en Vercel.";
      envBadge.className = "env-badge warn";
    } else if (publicKey) {
      envBadge.hidden = false;
      envBadge.textContent = "Producción · checkout integrado";
      envBadge.className = "env-badge ok";
    }

    if (!publicKey) {
      throw new Error("Falta MP_PUBLIC_KEY en las variables de entorno.");
    }

    // Diagnóstico automático
    try {
      log("info", "Cargando /api/diagnose…");
      const dRes = await fetch("/api/diagnose");
      const diag = await dRes.json();
      log("info", "/api/diagnose", diag);

      const nick = diag?.user?.nickname || "";
      const email = diag?.user?.email || "";
      const isTestUser =
        /TESTUSER/i.test(nick) ||
        /testuser\.com/i.test(email) ||
        /@testuser/i.test(String(email));

      if (isTestUser) {
        envBadge.hidden = false;
        envBadge.className = "env-badge warn";
        envBadge.textContent =
          "⚠️ Las claves son de un USUARIO DE PRUEBA (TESTUSER), no de tu cuenta real. Por eso falla empty_installments y el BIN de tarjetas reales.";
        log(
          "error",
          "CUENTA TESTUSER DETECTADA — usá credenciales de producción de TU cuenta vendedora real (no de cuenta de prueba)",
          { nickname: nick, site_id: diag?.user?.site_id, userId: diag?.user?.id }
        );
      }
    } catch (e) {
      log("warn", "diagnose falló", e);
    }

    updateSummary();
  }

  async function unmountBrick() {
    if (paymentBrickController) {
      try {
        paymentBrickController.unmount();
        log("info", "Brick unmounted");
      } catch (e) {
        log("warn", "unmount error", e);
      }
      paymentBrickController = null;
    }
    const box = document.getElementById("paymentBrick_container");
    if (box) box.innerHTML = "";
  }

  async function mountPaymentBrick(amount) {
    await unmountBrick();
    showError(paymentError, "");

    if (typeof MercadoPago === "undefined") {
      throw new Error("No cargó el SDK de Mercado Pago. Recargá la página.");
    }

    const amountNum = Math.round(Number(amount) * 100) / 100;
    log("info", "Creando MercadoPago SDK + Payment Brick", {
      amount: amountNum,
      locale,
      publicKeyPrefix: publicKey.slice(0, 12),
      minAmount: MIN_AMOUNT,
      // Solo 1 pago (sin MSI / sin varias cuotas)
      installments: { min: 1, max: 1 },
    });

    const mp = new MercadoPago(publicKey, { locale });
    const bricksBuilder = mp.bricks();

    const brickSettings = {
      initialization: {
        amount: amountNum,
      },
      customization: {
        visual: {
          style: {
            theme: "default",
          },
          texts: {
            formSubmit: "Donar ahora",
          },
        },
        paymentMethods: {
          // Un solo plazo: pago de contado (donaciones)
          minInstallments: 1,
          maxInstallments: 1,
          creditCard: "all",
          debitCard: "all",
          prepaidCard: "all",
          ticket: "all",
          atm: "all",
        },
      },
      callbacks: {
        onReady: () => {
          log("info", "Brick onReady");
        },
        onBinChange: (bin) => {
          log("info", "Brick onBinChange", {
            bin: bin ? String(bin).slice(0, 8) : null,
            amount: amountNum,
          });
        },
        onError: (error) => {
          log("error", "Brick onError", safeSerialize(error));
          const cause = String(error?.cause || error?.message || "");
          let hint = "";
          if (/empty_installments/i.test(cause)) {
            hint =
              " (empty_installments: el monto es menor al mínimo de la tarjeta o la cuenta es TESTUSER. Probá $10 o más. En Network el API puede mostrar cuotas, pero con min_allowed_amount el Brick las descarta.)";
          } else if (
            /payment_method|bin|public_key|get_card|get_payment/i.test(cause)
          ) {
            hint =
              " (BIN/medios: tarjeta inválida o cuenta de prueba. No uses números inventados.)";
          }
          showError(
            paymentError,
            (error?.message || cause || "Error en el formulario de pago.") +
              hint
          );
        },
        onSubmit: ({ selectedPaymentMethod, formData }, additionalData) => {
          log("info", "Brick onSubmit", {
            selectedPaymentMethod,
            formData: safeSerialize(formData),
            additionalData: safeSerialize(additionalData),
          });

          return new Promise((resolve, reject) => {
            const payload = {
              formData:
                formData != null
                  ? formData
                  : { selectedPaymentMethod, formData },
              selectedPaymentMethod,
              donorName: nameInput.value.trim(),
              message: messageInput.value.trim(),
            };

            log("info", "POST /api/process-payment…", {
              selectedPaymentMethod,
              hasFormData: formData != null,
              amount: formData?.transaction_amount,
              payment_method_id: formData?.payment_method_id,
              installments: formData?.installments,
              hasToken: Boolean(formData?.token),
            });

            fetch("/api/process-payment", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
              .then(async (response) => {
                const rawText = await response.text();
                let data = {};
                try {
                  data = rawText ? JSON.parse(rawText) : {};
                } catch {
                  data = { raw: rawText.slice(0, 2000) };
                }
                log(
                  response.ok ? "info" : "error",
                  "process-payment response",
                  {
                    httpStatus: response.status,
                    ok: response.ok,
                    data,
                  }
                );
                if (response.status === 401) {
                  setLastPaymentError(
                    "Sesión expirada (401). Volvé a iniciar sesión."
                  );
                  // delay para que el log se guarde antes de ir al login
                  setTimeout(() => {
                    location.href = "/login.html?next=/";
                  }, 800);
                  throw new Error("Sesión expirada. Iniciá sesión de nuevo.");
                }
                if (!response.ok) {
                  const parts = [
                    data.error,
                    data.status_detail,
                    data.message,
                    data.detail,
                  ].filter(Boolean);
                  if (data.cause) {
                    parts.push(
                      "cause: " + JSON.stringify(safeSerialize(data.cause))
                    );
                  }
                  throw new Error(
                    parts.join(" | ") ||
                      `Error HTTP ${response.status} al procesar el pago`
                  );
                }
                return data;
              })
              .then((data) => {
                log("info", "Pago procesado por API", data);
                resolve();
                showPaymentResult(data);
              })
              .catch((err) => {
                log("error", "process-payment failed", {
                  message: err?.message,
                  name: err?.name,
                  stack: err?.stack,
                });
                showError(
                  paymentError,
                  err.message || "Error al procesar el pago."
                );
                // No resolve: el Brick muestra error y deja reintentar
                reject(err);
              });
          });
        },
      },
    };

    log("info", "bricks.create('payment') settings", {
      initialization: brickSettings.initialization,
      paymentMethods: brickSettings.customization.paymentMethods,
    });

    try {
      paymentBrickController = await bricksBuilder.create(
        "payment",
        "paymentBrick_container",
        brickSettings
      );
      log("info", "Brick create() resolved OK");
    } catch (e) {
      log("error", "Brick create() threw", e);
      throw e;
    }
  }

  function showPaymentResult(data) {
    log("info", "showPaymentResult", data);
    const status = (data.status || "").toLowerCase();
    const icon = document.getElementById("result-icon");
    const title = document.getElementById("result-title");
    const text = document.getElementById("result-text");
    const detail = document.getElementById("result-detail");

    if (status === "approved") {
      icon.textContent = "✅";
      title.textContent = "¡Gracias por tu donación!";
      text.textContent =
        "El pago fue aprobado. Tu apoyo ayuda a la tienda a seguir creciendo.";
    } else if (status === "pending" || status === "in_process") {
      icon.textContent = "⏳";
      title.textContent = "Pago pendiente";
      text.textContent =
        "Mercado Pago está procesando el pago. Cuando se acredite, lo verás en tu cuenta.";
    } else if (status === "rejected") {
      icon.textContent = "❌";
      title.textContent = "Pago rechazado";
      text.textContent =
        "No se pudo completar el pago. Podés intentar con otro medio.";
    } else {
      icon.textContent = "ℹ️";
      title.textContent = "Estado del pago";
      text.textContent = `Estado: ${data.status || "desconocido"}`;
    }

    const parts = [];
    if (data.id) parts.push(`ID: ${data.id}`);
    if (data.status_detail) parts.push(data.status_detail);
    if (data.transaction_amount != null) {
      parts.push(`$${formatMoney(data.transaction_amount)} ${currency}`);
    }
    detail.textContent = parts.join(" · ");

    unmountBrick();
    showStep("result");
  }

  continueBtn.addEventListener("click", async () => {
    showError(amountError, "");
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount < MIN_AMOUNT) {
      showError(
        amountError,
        `El monto mínimo es $${MIN_AMOUNT} ${currency} (Mercado Pago no ofrece cuotas por debajo de eso).`
      );
      amountInput.focus();
      return;
    }

    currentAmount = amount;
    payAmountLabel.textContent = `$${formatMoney(amount)} ${currency}`;
    continueBtn.disabled = true;
    continueBtn.textContent = "Cargando checkout…";
    log("info", "Continuar al pago", { amount, currency });

    try {
      if (!publicKey) await loadConfig();
      showStep("payment");
      await mountPaymentBrick(amount);
    } catch (err) {
      log("error", "Falló continuar al pago", err);
      showStep("amount");
      showError(amountError, err.message || "No se pudo iniciar el pago.");
    } finally {
      continueBtn.disabled = false;
      continueBtn.textContent = "Continuar al pago";
    }
  });

  backBtn.addEventListener("click", async () => {
    await unmountBrick();
    showStep("amount");
  });

  againBtn.addEventListener("click", async () => {
    await unmountBrick();
    showStep("amount");
  });

  // window errors
  window.addEventListener("error", (ev) => {
    log("error", "window.error", {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    log("error", "unhandledrejection", safeSerialize(ev.reason));
  });

  amountInput.value = "100";
  setActiveButton(100);
  updateSummary();
  if (logPanel) logPanel.hidden = false;

  log("info", "App init", { sessionId, href: location.href, ua: navigator.userAgent });

  async function requireLogin() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!data.authenticated || !data.user) {
        location.replace("/login.html?next=/");
        return false;
      }
      currentUser = data.user;
      if (userBar) userBar.hidden = false;
      if (userNameEl) userNameEl.textContent = data.user.username;
      if (adminLink && data.user.role === "admin") adminLink.hidden = false;
      log("info", "Usuario autenticado", data.user);
      return true;
    } catch (e) {
      log("error", "auth/me failed", e);
      location.replace("/login.html?next=/");
      return false;
    }
  }

  if (logoutLink) {
    logoutLink.addEventListener("click", async () => {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      location.href = "/login.html";
    });
  }

  requireLogin().then((ok) => {
    if (!ok) return;
    loadConfig().catch((err) => {
      log("error", "loadConfig failed", err);
      showError(amountError, err.message || "Error de configuración.");
    });
  });
})();

