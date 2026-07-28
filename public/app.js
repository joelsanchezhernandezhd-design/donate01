(function () {
  const form = document.getElementById("donation-form");
  const amountInput = document.getElementById("amount");
  const nameInput = document.getElementById("name");
  const messageInput = document.getElementById("message");
  const summaryAmount = document.getElementById("summary-amount");
  const summaryCurrency = document.getElementById("summary-currency");
  const currencyPrefix = document.getElementById("currency-prefix");
  const submitBtn = document.getElementById("submit-btn");
  const errorEl = document.getElementById("error");
  const amountButtons = document.querySelectorAll(".amount-btn");

  let currency = "ARS";

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat("es-AR", {
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

  function showError(msg) {
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  amountButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      amountInput.value = btn.dataset.amount;
      setActiveButton(btn.dataset.amount);
      updateSummary();
      showError("");
    });
  });

  amountInput.addEventListener("input", () => {
    setActiveButton(amountInput.value);
    updateSummary();
    showError("");
  });

  // Config desde el servidor (public key + moneda)
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.currency) {
        currency = cfg.currency;
        currencyPrefix.textContent =
          currency === "USD" || currency === "MXN" || currency === "ARS"
            ? "$"
            : currency + " ";
      }
      updateSummary();
    })
    .catch(() => {
      /* offline / sin server: se usa default */
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");

    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount < 1) {
      showError("Elegí o escribí un monto válido.");
      amountInput.focus();
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Redirigiendo a Mercado Pago…";

    try {
      const res = await fetch("/api/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          name: nameInput.value.trim(),
          message: messageInput.value.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "No se pudo iniciar el pago.");
      }

      // Preferencias TEST usan sandbox_init_point; producción usa init_point
      const url = data.sandbox_init_point || data.init_point;
      if (!url) {
        throw new Error("Mercado Pago no devolvió una URL de pago.");
      }

      window.location.href = url;
    } catch (err) {
      showError(err.message || "Error al conectar con el servidor.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  // Monto por defecto para la demo
  amountInput.value = "1000";
  setActiveButton(1000);
  updateSummary();
})();
