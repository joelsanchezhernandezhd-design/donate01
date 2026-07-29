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
  const amountButtons = document.querySelectorAll(".amount-btn");

  let currency = "MXN";
  let publicKey = "";
  let locale = "es-MX";
  let isSandbox = false;
  let bricksBuilder = null;
  let paymentBrickController = null;
  let currentAmount = 0;

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
  }

  function showStep(step) {
    stepAmount.hidden = step !== "amount";
    stepPayment.hidden = step !== "payment";
    stepResult.hidden = step !== "result";
  }

  amountButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      amountInput.value = btn.dataset.amount;
      setActiveButton(btn.dataset.amount);
      updateSummary();
      showError(amountError, "");
    });
  });

  amountInput.addEventListener("input", () => {
    setActiveButton(amountInput.value);
    updateSummary();
    showError(amountError, "");
  });

  async function loadConfig() {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("No se pudo cargar la configuración.");
    const cfg = await res.json();
    publicKey = cfg.publicKey || "";
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

    updateSummary();
  }

  async function unmountBrick() {
    if (paymentBrickController) {
      try {
        paymentBrickController.unmount();
      } catch (_) {
        /* ignore */
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

    // Sin "sandbox": con Public Key APP_USR- opera en producción
    const mp = new MercadoPago(publicKey, { locale });

    bricksBuilder = mp.bricks();

    paymentBrickController = await bricksBuilder.create(
      "payment",
      "paymentBrick_container",
      {
        initialization: {
          amount: Number(amount),
        },
        customization: {
          visual: {
            style: {
              theme: "dark",
            },
            texts: {
              formSubmit: "Donar ahora",
            },
          },
          paymentMethods: {
            maxInstallments: 1,
            creditCard: "all",
            debitCard: "all",
            // ticket / atm en MX; wallet puede redirigir a MP
            ticket: "all",
            atm: "all",
            // sin mercadoPago wallet para evitar redirección a cuenta MP
          },
        },
        callbacks: {
          onReady: () => {
            /* brick listo */
          },
          onError: (error) => {
            console.error("Payment Brick error:", error);
            if (error?.type === "critical") {
              showError(
                paymentError,
                error.message || "Error al cargar el formulario de pago."
              );
            }
          },
          onSubmit: ({ selectedPaymentMethod, formData }) => {
            return new Promise((resolve, reject) => {
              // El Brick a veces envía formData ya listo para /v1/payments
              const payload = {
                formData:
                  formData != null
                    ? formData
                    : { selectedPaymentMethod, formData },
                selectedPaymentMethod,
                donorName: nameInput.value.trim(),
                message: messageInput.value.trim(),
              };

              fetch("/api/process-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              })
                .then(async (response) => {
                  const data = await response.json().catch(() => ({}));
                  if (!response.ok) {
                    throw new Error(
                      data.error || "No se pudo procesar el pago."
                    );
                  }
                  return data;
                })
                .then((data) => {
                  resolve();
                  showPaymentResult(data);
                })
                .catch((err) => {
                  showError(
                    paymentError,
                    err.message || "Error al procesar el pago."
                  );
                  reject();
                });
            });
          },
        },
      }
    );
  }

  function showPaymentResult(data) {
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
    if (!Number.isFinite(amount) || amount < 1) {
      showError(amountError, "Elegí o escribí un monto válido.");
      amountInput.focus();
      return;
    }

    currentAmount = amount;
    payAmountLabel.textContent = `$${formatMoney(amount)} ${currency}`;
    continueBtn.disabled = true;
    continueBtn.textContent = "Cargando checkout…";

    try {
      if (!publicKey) await loadConfig();
      showStep("payment");
      await mountPaymentBrick(amount);
    } catch (err) {
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

  // default demo
  amountInput.value = "100";
  setActiveButton(100);
  updateSummary();

  loadConfig().catch((err) => {
    showError(amountError, err.message || "Error de configuración.");
  });
})();
