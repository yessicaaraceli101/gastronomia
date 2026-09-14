(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  let moneda = "Gs";
  let facturas = [];
  let gastos = [];
  let itemsFiltrados = [];
  let pagina = 1;
  const PAGE_SIZE = 10;

  // rates y symbols para formateo de moneda
  const rates = { "US$": 1, "Gs": 7300, "R$": 5.4 };
  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

  // ---------- Formateadores ----------
  function formatearPrecio(valor) {
    const simbolo = symbols[moneda];
    let montoFinal;
    if (moneda === "Gs") {
      montoFinal = Math.round(valor);
      return `${simbolo}${montoFinal.toLocaleString("es-PY", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })}`;
    } else if (moneda === "US$") {
      montoFinal = valor / rates["Gs"];
      return `${simbolo}${montoFinal.toFixed(2)}`;
    } else if (moneda === "R$") {
      montoFinal = (valor / rates["Gs"]) * rates["R$"];
      return `${simbolo}${montoFinal.toFixed(2)}`;
    }
  }

  function formatearFecha(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // ---------- Carga de datos desde Firebase ----------
  // Ya filtraba por empresaId — solo faltaba que empresaId fuera el real
  // de la sesión en vez del primero de una lista hardcodeada.
  async function cargarFacturas() {
    try {
      const snapshot = await db.collection('facturas')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar facturas:", error);
      return [];
    }
  }

  async function cargarGastos() {
    try {
      const snapshot = await db.collection('gastos')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar gastos:", error);
      return [];
    }
  }

  // ---------- Renderización ----------
  function renderHeader() {
    if (!sesionActual) return;
    const branchDate = document.getElementById("branch-date");
    if (branchDate) branchDate.textContent = `${sesionActual.sucursalNombre} · Resumen financiero · ${new Date().toLocaleDateString('es-PY')}`;
  }

  // Nombre del mes actual, capitalizado, para el label de la tarjeta
  // ("Ingresos de Septiembre 2026").
  function nombreMesActual() {
    const texto = new Date().toLocaleDateString('es-PY', { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function renderStats() {
    // Calcular totales a partir de datos reales de Firestore (facturas y
    // gastos de la empresa activa) — nada de valores de ejemplo.
    let totalIngresosMes = 0;
    let totalGastos = 0;
    let ventasHoy = 0;
    const hoy = new Date().toISOString().slice(0, 10);
    const mesActual = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    facturas.forEach(f => {
      if (f.estado === 'Pagada' || f.estado === 'Pagado') {
        // "Ingresos totales" ahora es del mes en curso, no histórico.
        if (f.created_at && f.created_at.startsWith(mesActual)) {
          totalIngresosMes += f.total || 0;
        }
        if (f.created_at && f.created_at.startsWith(hoy)) {
          ventasHoy += f.total || 0;
        }
      }
    });

    gastos.forEach(g => {
      totalGastos += g.monto || 0;
    });

    const balance = totalIngresosMes - totalGastos;

    document.getElementById("total-ingresos").textContent = formatearPrecio(totalIngresosMes);
    const labelIngresos = document.getElementById("label-ingresos");
    if (labelIngresos) labelIngresos.textContent = `Ingresos de ${nombreMesActual()}`;
    document.getElementById("total-gastos").textContent = formatearPrecio(totalGastos);
    document.getElementById("balance").textContent = formatearPrecio(balance);
    document.getElementById("ventas-hoy").textContent = formatearPrecio(ventasHoy);

    // Cambiar color del balance según signo
    const balanceEl = document.getElementById("balance");
    if (balanceEl) {
      balanceEl.style.color = balance >= 0 ? '#16a34a' : '#dc2626';
    }
  }

  function renderTabla() {
    const tbody = document.getElementById("reportes-body");
    if (!tbody) return;

    // Combinar facturas y gastos en un solo array
    let items = [];

    facturas.forEach(f => {
      items.push({
        fecha: f.created_at || f.fecha,
        concepto: f.cliente?.name || 'Cliente',
        tipo: 'Ingreso',
        monto: f.total || 0,
        detalle: `Factura ${f.codigo || f.id?.slice(0, 8) || ''}`,
        raw: f
      });
    });

    gastos.forEach(g => {
      items.push({
        fecha: g.fecha || g.created_at,
        concepto: g.categoria || 'Gasto',
        tipo: 'Gasto',
        monto: g.monto || 0,
        detalle: g.descripcion || '',
        raw: g
      });
    });

    // Aplicar filtros de fecha si existen
    const desde = document.getElementById('fecha-desde')?.value;
    const hasta = document.getElementById('fecha-hasta')?.value;

    if (desde) {
      items = items.filter(i => i.fecha && i.fecha >= desde);
    }
    if (hasta) {
      items = items.filter(i => i.fecha && i.fecha <= hasta);
    }

    // Ordenar por fecha descendente
    items.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

    itemsFiltrados = items;

    // Paginación
    const totalPages = Math.max(1, Math.ceil(itemsFiltrados.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = itemsFiltrados.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No hay registros para mostrar.</td></tr>`;
    } else {
      pageItems.forEach(item => {
        const tr = document.createElement("tr");
        const tipoClass = item.tipo === 'Ingreso' ? 'ingreso' : 'gasto';
        tr.innerHTML = `
          <td>${formatearFecha(item.fecha)}</td>
          <td>${item.concepto}</td>
          <td><span class="badge ${tipoClass}">${item.tipo}</span></td>
          <td>${formatearPrecio(item.monto)}</td>
          <td>${item.detalle}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    document.getElementById("page-label").textContent = `Página ${pagina} de ${totalPages}`;
    document.getElementById("prev-page").disabled = pagina <= 1;
    document.getElementById("next-page").disabled = pagina >= totalPages;
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    const [facturasData, gastosData] = await Promise.all([
      cargarFacturas(),
      cargarGastos()
    ]);
    facturas = facturasData;
    gastos = gastosData;
    renderHeader();
    renderStats();
    renderTabla();
  }

  // ---------- Eventos ----------
  function initFilters() {
    document.getElementById("aplicar-filtro").addEventListener("click", () => {
      pagina = 1;
      renderTabla();
    });
    document.getElementById("limpiar-filtro").addEventListener("click", () => {
      document.getElementById("fecha-desde").value = '';
      document.getElementById("fecha-hasta").value = '';
      pagina = 1;
      renderTabla();
    });
  }

  function initPagination() {
    document.getElementById("prev-page").addEventListener("click", () => {
      if (pagina > 1) { pagina--; renderTabla(); }
    });
    document.getElementById("next-page").addEventListener("click", () => {
      pagina++; renderTabla();
    });
  }

  function initCurrencyToggle() {
    const container = document.getElementById("currency-toggle");
    if (!container) return;
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", function () {
        container.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        moneda = this.getAttribute("data-currency");
        renderStats();
        renderTabla();
      });
    });
  }

  function initRefresh() {
    const btn = document.getElementById("refresh-btn");
    if (btn) {
      btn.addEventListener("click", renderTodo);
    }
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  // ---------- Inicialización ----------
  document.addEventListener("DOMContentLoaded", function () {
    initFilters();
    initPagination();
    initCurrencyToggle();
    initRefresh();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales. Recién ahí
  // sabemos el empresaId real y podemos traer facturas/gastos.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    pagina = 1;
    renderTodo();

    if (!window.__gastroReportesInterval) {
      window.__gastroReportesInterval = setInterval(renderTodo, 60000); // cada 1 minuto
    }
  });

})();