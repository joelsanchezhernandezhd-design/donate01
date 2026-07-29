(function () {
  const adminUser = document.getElementById("admin-user");
  const statCount = document.getElementById("stat-count");
  const statSum = document.getElementById("stat-sum");
  const table = document.getElementById("donations-table");
  const tbody = document.getElementById("donations-body");
  const loading = document.getElementById("admin-loading");
  const errorEl = document.getElementById("admin-error");
  const refreshBtn = document.getElementById("refresh-btn");
  const logoutBtn = document.getElementById("logout-btn");

  if (adminUser) adminUser.textContent = "público (sin login)";
  if (logoutBtn) logoutBtn.hidden = true;

  function showError(msg) {
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function formatMoney(n) {
    try {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
      }).format(Number(n) || 0);
    } catch {
      return "$" + n;
    }
  }

  function statusBadge(status) {
    const s = (status || "—").toLowerCase();
    let cls = "other";
    if (s === "approved") cls = "approved";
    else if (s === "pending" || s === "in_process") cls = "pending";
    else if (s === "rejected" || s === "error") cls = "rejected";
    return `<span class="badge-status ${cls}">${status || "—"}</span>`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadDonations() {
    showError("");
    loading.hidden = false;
    loading.textContent = "Cargando donaciones…";
    try {
      const res = await fetch("/api/admin/donations?limit=200");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Error al cargar");

      statCount.textContent = String(data.totalCount ?? 0);
      statSum.textContent = formatMoney(data.approvedSum ?? 0);

      const items = data.items || [];
      tbody.innerHTML = items
        .map((d) => {
          return `<tr>
            <td>${escapeHtml(d.id)}</td>
            <td title="${escapeHtml(d.created_at)}">${escapeHtml(d.created_at)}</td>
            <td>${escapeHtml(formatMoney(d.amount))} ${escapeHtml(d.currency || "")}</td>
            <td>${statusBadge(d.status)}</td>
            <td title="${escapeHtml(d.status_detail)}">${escapeHtml(d.status_detail || "—")}</td>
            <td>${escapeHtml(d.payment_method_id || "—")}</td>
            <td title="${escapeHtml(d.payer_email)}">${escapeHtml(d.payer_email || "—")}</td>
            <td>${escapeHtml(d.donor_name || "—")}</td>
            <td title="${escapeHtml(d.message)}">${escapeHtml(d.message || "—")}</td>
            <td>${escapeHtml(d.username || "—")}</td>
            <td title="${escapeHtml(d.payment_id)}">${escapeHtml(d.payment_id || "—")}</td>
          </tr>`;
        })
        .join("");

      table.hidden = false;
      loading.hidden = items.length > 0;
      if (items.length === 0) {
        loading.hidden = false;
        loading.textContent = "Aún no hay donaciones registradas.";
      }
    } catch (e) {
      showError(e.message || "Error");
      loading.hidden = true;
    }
  }

  if (refreshBtn) refreshBtn.addEventListener("click", loadDonations);
  loadDonations();
})();
