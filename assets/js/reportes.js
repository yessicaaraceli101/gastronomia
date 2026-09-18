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

  // Estado del panel de gráfico: colapsado por defecto, período "Diario"
  // por defecto la primera vez que se abre.
  let graficoAbierto = false;
  let periodoGraficoActual = 'dia';
  let chartInstance = null;

  // rates y symbols para formateo de moneda
  const rates = { "US$": 1, "Gs": 7300, "R$": 5.4 };
  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

  // Colores del gráfico (misma paleta que reportes.css): azul para
  // ingresos, naranja para gastos, gris para texto/grillas.
  const COLOR_AZUL = '#2563eb';
  const COLOR_NARANJA = '#f59e0b';
  const COLOR_GRIS = '#6b7280';
  const COLOR_GRIS_CLARO = '#e5e7eb';

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

  // Convierte un valor guardado en Gs a la moneda actualmente seleccionada
  // (sin símbolo, para usar en el eje/los datos del gráfico).
  function convertirAMonedaActual(valorGs) {
    if (moneda === "Gs") return Math.round(valorGs);
    if (moneda === "US$") return +(valorGs / rates["Gs"]).toFixed(2);
    if (moneda === "R$") return +((valorGs / rates["Gs"]) * rates["R$"]).toFixed(2);
    return valorGs;
  }

  function capitalizar(texto) {
    if (!texto) return texto;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  // Lunes de la semana que contiene "fecha", a las 00:00.
  function inicioSemana(fecha) {
    const d = new Date(fecha);
    const dia = (d.getDay() + 6) % 7; // 0 = lunes ... 6 = domingo
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dia);
    return d;
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

  /* ============================================================
     GRÁFICO DE BARRAS (Chart.js)
     ------------------------------------------------------------
     Agrupa facturas (ingresos, solo las Pagadas) y gastos en
     "cubos" (buckets) según el período elegido: día, semana, fin
     de semana, mes o año. Usa siempre los datos completos ya
     cargados (facturas/gastos), no el filtro de fecha de la tabla
     — el gráfico son ventanas fijas hacia atrás (últimos 7 días,
     últimas 8 semanas, etc.), pensadas para ver tendencia.
     ============================================================ */
  function construirBuckets(periodo) {
    const hoy = new Date();
    let buckets = [];
    let claveDeFecha; // (Date) => string, debe coincidir con bucket.key
    let soloFinDeSemana = false;

    if (periodo === 'dia') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(hoy);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label = capitalizar(d.toLocaleDateString('es-PY', { weekday: 'short' })) + ' ' + String(d.getDate()).padStart(2, '0');
        buckets.push({ key, label });
      }
      claveDeFecha = (d) => d.toISOString().slice(0, 10);

    } else if (periodo === 'semana' || periodo === 'finde') {
      for (let i = 7; i >= 0; i--) {
        const lunes = inicioSemana(hoy);
        lunes.setDate(lunes.getDate() - i * 7);
        const key = lunes.toISOString().slice(0, 10);
        const label = 'Sem ' + String(lunes.getDate()).padStart(2, '0') + '/' + String(lunes.getMonth() + 1).padStart(2, '0');
        buckets.push({ key, label });
      }
      claveDeFecha = (d) => inicioSemana(d).toISOString().slice(0, 10);
      soloFinDeSemana = periodo === 'finde';

    } else if (periodo === 'mes') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        let label = capitalizar(d.toLocaleDateString('es-PY', { month: 'short' })).replace('.', '');
        if (d.getFullYear() !== hoy.getFullYear()) label += ` '${String(d.getFullYear()).slice(2)}`;
        buckets.push({ key, label });
      }
      claveDeFecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    } else { // 'anio'
      for (let i = 4; i >= 0; i--) {
        const year = hoy.getFullYear() - i;
        buckets.push({ key: String(year), label: String(year) });
      }
      claveDeFecha = (d) => String(d.getFullYear());
    }

    return { buckets, claveDeFecha, soloFinDeSemana };
  }

  function construirSerie(periodo) {
    const { buckets, claveDeFecha, soloFinDeSemana } = construirBuckets(periodo);

    const ingresosPorClave = {};
    const gastosPorClave = {};
    buckets.forEach(b => { ingresosPorClave[b.key] = 0; gastosPorClave[b.key] = 0; });

    facturas.forEach(f => {
      if (f.estado !== 'Pagada' && f.estado !== 'Pagado') return;
      if (!f.created_at) return;
      const d = new Date(f.created_at);
      if (isNaN(d.getTime())) return;
      if (soloFinDeSemana && d.getDay() !== 0 && d.getDay() !== 6) return;
      const key = claveDeFecha(d);
      if (key in ingresosPorClave) ingresosPorClave[key] += f.total || 0;
    });

    gastos.forEach(g => {
      const fechaTexto = g.fecha || g.created_at;
      if (!fechaTexto) return;
      const d = new Date(fechaTexto);
      if (isNaN(d.getTime())) return;
      if (soloFinDeSemana && d.getDay() !== 0 && d.getDay() !== 6) return;
      const key = claveDeFecha(d);
      if (key in gastosPorClave) gastosPorClave[key] += g.monto || 0;
    });

    return {
      labels: buckets.map(b => b.label),
      ingresos: buckets.map(b => convertirAMonedaActual(ingresosPorClave[b.key])),
      gastos: buckets.map(b => convertirAMonedaActual(gastosPorClave[b.key]))
    };
  }

  // Formatea un valor que YA está expresado en la moneda actualmente
  // seleccionada (a diferencia de formatearPrecio(), que asume que recibe
  // un valor en Gs y lo convierte). Se usa para los datos del gráfico,
  // que construirSerie() ya devuelve convertidos — formatearPrecio()
  // los volvería a convertir por error si se reutilizara acá.
  function formatearValorGrafico(valor) {
    const simbolo = symbols[moneda] || '';
    if (moneda === 'Gs') {
      return `${simbolo}${Math.round(valor).toLocaleString('es-PY')}`;
    }
    return `${simbolo}${Number(valor).toFixed(2)}`;
  }

  function mostrarErrorGrafico(mensaje) {
    const wrapper = document.querySelector('.chart-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#dc2626;font-size:13.5px;text-align:center;padding:0 20px;">${mensaje}</div>`;
  }

  function renderGrafico(periodo) {
    const canvas = document.getElementById('grafico-canvas');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      // Antes esto solo quedaba en la consola y la pantalla se veía en
      // blanco sin ninguna pista de qué había pasado. Ahora se avisa
      // directo donde debería estar el gráfico.
      mostrarErrorGrafico(
        'No se pudo cargar la librería del gráfico (Chart.js). Revisá tu conexión a internet, ' +
        'o si algún bloqueador de contenido está frenando cdnjs.cloudflare.com, y volvé a intentar.'
      );
      console.error('Chart.js no está cargado; revisá la conexión a internet o el <script> del CDN en reportes.html.');
      return;
    }

    const { labels, ingresos, gastosSerie } = (function () {
      const s = construirSerie(periodo);
      return { labels: s.labels, ingresos: s.ingresos, gastosSerie: s.gastos };
    })();

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ingresos',
            data: ingresos,
            backgroundColor: COLOR_AZUL,
            borderRadius: 4,
            maxBarThickness: 30
          },
          {
            label: 'Gastos',
            data: gastosSerie,
            backgroundColor: COLOR_NARANJA,
            borderRadius: 4,
            maxBarThickness: 30
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false }, // ya tenemos nuestra propia leyenda en el HTML
          tooltip: {
            backgroundColor: '#1f2937',
            padding: 10,
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatearValorGrafico(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: COLOR_GRIS, font: { family: 'Inter', size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: COLOR_GRIS_CLARO },
            ticks: {
              color: COLOR_GRIS,
              font: { family: 'Inter', size: 11 },
              callback: (v) => formatearValorGrafico(v)
            }
          }
        }
      }
    });

    // Defensivo: si por algún motivo el contenedor todavía no tenía su
    // tamaño final calculado en el momento de crear el gráfico (por
    // ejemplo, justo al desplegar el panel), forzamos un resize en el
    // siguiente frame para que las barras no queden con alto 0.
    requestAnimationFrame(() => {
      if (chartInstance) chartInstance.resize();
    });
  }

  function actualizarTextoBotonGrafico() {
    const label = document.getElementById('toggle-grafico-label');
    if (label) label.textContent = graficoAbierto ? 'Ocultar gráfico' : 'Ver gráfico';
  }

  function initGrafico() {
    const toggleBtn = document.getElementById('toggle-grafico-btn');
    const body = document.getElementById('grafico-body');
    if (!toggleBtn || !body) return;

    toggleBtn.addEventListener('click', function () {
      graficoAbierto = !graficoAbierto;
      body.classList.toggle('open', graficoAbierto);
      actualizarTextoBotonGrafico();
      if (graficoAbierto) renderGrafico(periodoGraficoActual);
    });

    document.querySelectorAll('.grafico-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.grafico-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        periodoGraficoActual = this.getAttribute('data-periodo');
        if (graficoAbierto) renderGrafico(periodoGraficoActual);
      });
    });

    actualizarTextoBotonGrafico();
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
    if (graficoAbierto) renderGrafico(periodoGraficoActual);
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
        if (graficoAbierto) renderGrafico(periodoGraficoActual);
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
    initGrafico();
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