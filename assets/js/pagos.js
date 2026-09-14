(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  // Mismas tasas/símbolos que usa facturacion.js — la moneda base es Gs.
  const rates = { "US$": 1, "Gs": 7300, "R$": 5.4 };
  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

  let moneda = "Gs";
  let facturas = [];

  /* ============================================================
     FIREBASE
     ============================================================ */
  // ⚠️ Antes esto traía TODAS las facturas de TODAS las empresas
  // (sin .where). Se agrega el filtro por empresaId, igual que en
  // el resto de las páginas de Finanzas.
  async function cargarFacturas() {
    try {
      const snapshot = await db.collection("facturas")
        .where("empresaId", "==", empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => todos.push({ id: doc.id, ...doc.data() }));
      return todos;
    } catch (error) {
      console.error("❌ Error al cargar facturas:", error);
      return [];
    }
  }

  /* ============================================================
     UTILIDADES
     ============================================================ */
  function formatearPrecio(valorGs) {
    const v = Number(valorGs) || 0;
    const simbolo = symbols[moneda];
    if (moneda === "Gs") {
      return `${simbolo}${Math.round(v).toLocaleString("es-PY", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })}`;
    } else if (moneda === "US$") {
      return `${simbolo}${(v / rates["Gs"]).toFixed(2)}`;
    } else if (moneda === "R$") {
      return `${simbolo}${((v / rates["Gs"]) * rates["R$"]).toFixed(2)}`;
    }
    return `${simbolo}${v}`;
  }

  // Total de una factura, siempre normalizado a Gs.
  // Prioriza f.total (ya guardado en Gs por facturacion.js). Si no está,
  // recalcula a partir de los ítems (precioGs > precio/price como fallback).
  function totalFacturaGs(f) {
    if (typeof f.total === "number" && !isNaN(f.total)) return f.total;
    if (!f.items || !f.items.length) return 0;
    return f.items.reduce((sum, item) => {
      const precio = item.precioGs ?? item.precio ?? item.price ?? 0;
      const cantidad = item.cantidad ?? item.qty ?? 0;
      return sum + (Number(precio) || 0) * (Number(cantidad) || 0);
    }, 0);
  }

  function esHoy(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    const hoy = new Date();
    return (
      d.getFullYear() === hoy.getFullYear() &&
      d.getMonth() === hoy.getMonth() &&
      d.getDate() === hoy.getDate()
    );
  }

  function esEsteMes(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    const hoy = new Date();
    return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
  }

  function formatearFecha(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // Etiqueta para agrupar: si es Transferencia y tiene banco cargado, usa el
  // nombre del banco; si no, usa el método de pago tal cual.
  function etiquetaFormaBanco(f) {
    const metodo = f.metodoPago || f.metodo || "Sin especificar";
    if (metodo === "Transferencia" && f.banco && f.banco.trim()) {
      return f.banco.trim();
    }
    return metodo;
  }

  /* ============================================================
     CÁLCULOS
     ============================================================ */
  function calcularKPIs(facturasPagadas) {
    let efectivoHoy = 0, efectivoMes = 0;
    let transferenciaHoy = 0, transferenciaMes = 0;
    let totalHoy = 0, totalMes = 0;

    facturasPagadas.forEach(f => {
      const totalGs = totalFacturaGs(f);
      const metodo = f.metodoPago || f.metodo || "";
      const hoy = esHoy(f.created_at);
      const mes = esEsteMes(f.created_at);

      if (hoy) totalHoy += totalGs;
      if (mes) totalMes += totalGs;

      if (metodo === "Efectivo") {
        if (hoy) efectivoHoy += totalGs;
        if (mes) efectivoMes += totalGs;
      } else if (metodo === "Transferencia") {
        if (hoy) transferenciaHoy += totalGs;
        if (mes) transferenciaMes += totalGs;
      }
    });

    return { efectivoHoy, efectivoMes, transferenciaHoy, transferenciaMes, totalHoy, totalMes };
  }

  function agruparPorFormaBanco(facturasPagadas) {
    const grupos = {};
    facturasPagadas.forEach(f => {
      const label = etiquetaFormaBanco(f);
      if (!grupos[label]) grupos[label] = { hoy: 0, mes: 0 };
      const totalGs = totalFacturaGs(f);
      if (esHoy(f.created_at)) grupos[label].hoy += totalGs;
      if (esEsteMes(f.created_at)) grupos[label].mes += totalGs;
    });
    return grupos;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderKPIs(facturasPagadas) {
    const k = calcularKPIs(facturasPagadas);
    document.getElementById("kpi-efectivo-hoy").textContent = formatearPrecio(k.efectivoHoy);
    document.getElementById("kpi-efectivo-mes").textContent = `Mes: ${formatearPrecio(k.efectivoMes)}`;
    document.getElementById("kpi-transferencia-hoy").textContent = formatearPrecio(k.transferenciaHoy);
    document.getElementById("kpi-transferencia-mes").textContent = `Mes: ${formatearPrecio(k.transferenciaMes)}`;
    document.getElementById("kpi-total-hoy").textContent = formatearPrecio(k.totalHoy);
    document.getElementById("kpi-total-mes").textContent = `Mes: ${formatearPrecio(k.totalMes)}`;
  }

  function renderDetalle(facturasPagadas) {
    const tbody = document.getElementById("detalle-body");
    if (!tbody) return;
    const grupos = agruparPorFormaBanco(facturasPagadas);
    const labels = Object.keys(grupos).sort((a, b) => grupos[b].mes - grupos[a].mes);

    tbody.innerHTML = "";
    if (labels.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Sin movimientos registrados.</td></tr>`;
      return;
    }
    labels.forEach(label => {
      const g = grupos[label];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${label}</td>
        <td class="num">${formatearPrecio(g.hoy)}</td>
        <td class="num">${formatearPrecio(g.mes)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderMovimientos() {
    const tbody = document.getElementById("movimientos-body");
    if (!tbody) return;

    // "Con comprobante" = facturas de la empresa activa (ya vienen filtradas
    // desde Firestore) que tienen número de documento cargado (típico de
    // transferencias/tarjeta con comprobante).
    const conComprobante = facturas
      .filter(f => f.numeroDoc && String(f.numeroDoc).trim() !== "")
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    tbody.innerHTML = "";
    if (conComprobante.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Sin movimientos con comprobante.</td></tr>`;
      return;
    }

    conComprobante.forEach(f => {
      const shortId = (f.id || "").slice(0, 6).toUpperCase();
      const totalGs = totalFacturaGs(f);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="link">${shortId}</td>
        <td>${formatearFecha(f.created_at)}</td>
        <td>${f.cliente?.name || "Consumidor Final"}</td>
        <td>${etiquetaFormaBanco(f)}</td>
        <td>${f.numeroDoc || "—"}</td>
        <td class="num">${formatearPrecio(totalGs)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderTodo() {
    // Las facturas ya vienen filtradas por empresa desde Firestore; acá
    // solo nos quedamos con las efectivamente cobradas.
    const facturasPagadas = facturas.filter(f => f.estado === "Pagada");
    renderKPIs(facturasPagadas);
    renderDetalle(facturasPagadas);
    renderMovimientos();
  }

  /* ============================================================
     TOPBAR
     ============================================================ */
  function initTopbarDate() {
    const el = document.getElementById("topbar-date");
    if (!el || !sesionActual) return;
    const hoy = new Date().toLocaleDateString("es-PY");
    el.textContent = `${sesionActual.sucursalNombre} · ${hoy}`;
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) y el chip de usuario ahora los maneja auth-check.js
  // igual que en el resto de las páginas — ya no hace falta duplicar esa
  // lógica acá.

  /* ============================================================
     SIDEBAR: grupos colapsables (flechita ▾)
     ============================================================ */
  function initCollapsibleGroups() {
    document.querySelectorAll(".nav-group.collapsible .nav-label").forEach(label => {
      label.addEventListener("click", () => {
        label.closest(".nav-group").classList.toggle("collapsed");
      });
    });
  }

  /* ============================================================
     MONEDA
     ============================================================ */
  function initCurrencyToggle() {
    const container = document.getElementById("currency-toggle");
    if (!container) return;
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", function () {
        container.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        moneda = this.getAttribute("data-currency");
        renderTodo();
      });
    });
  }

  /* ============================================================
     INICIALIZACIÓN
     ============================================================ */
  async function actualizar() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    facturas = await cargarFacturas();
    renderTodo();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initCollapsibleGroups();
    initCurrencyToggle();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    initTopbarDate();
    actualizar();

    if (!window.__gastroPagosInterval) {
      window.__gastroPagosInterval = setInterval(actualizar, 30000);
    }
  });
})();