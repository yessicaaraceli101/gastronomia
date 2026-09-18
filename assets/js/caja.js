(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  const rates = { "Gs": 7300, "US$": 1, "R$": 5.4 };
  const symbols = { "Gs": "Gs. ", "US$": "USD ", "R$": "BRL " };

  // Últimos totales calculados, para poder armar el PDF sin repetir consultas.
  let ultimosDatos = null;
  let ultimaFechaDia = null;

  /* ============================================================
     MODAL DE CONFIRMACIÓN (Abrir/Cerrar caja)
     ------------------------------------------------------------
     Reemplaza al confirm() nativo del navegador por un modal propio
     con el estilo de la app. Devuelve una Promise<boolean> — true si
     el usuario tocó "Aceptar", false si tocó "Cancelar" o cerró el
     modal (clic afuera).
     ============================================================ */
  function confirmarModal(titulo, texto) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirm-caja-overlay');
      if (!overlay) {
        // Respaldo por si el HTML todavía no tiene este modal agregado:
        // usamos el confirm() nativo en vez de bloquear la acción sin
        // ninguna manera de confirmar.
        console.error('❌ No se encontró #confirm-caja-overlay en esta página.');
        resolve(window.confirm(texto));
        return;
      }

      const tituloEl = document.getElementById('confirm-caja-titulo');
      const textoEl = document.getElementById('confirm-caja-texto');
      const btnCancelar = document.getElementById('confirm-caja-cancelar');
      const btnAceptar = document.getElementById('confirm-caja-aceptar');

      if (tituloEl) tituloEl.textContent = titulo;
      if (textoEl) textoEl.textContent = texto;
      overlay.classList.add('open');

      function limpiar() {
        overlay.classList.remove('open');
        btnCancelar.removeEventListener('click', onCancelar);
        btnAceptar.removeEventListener('click', onAceptar);
        overlay.removeEventListener('click', onOverlayClick);
      }
      function onCancelar() { limpiar(); resolve(false); }
      function onAceptar() { limpiar(); resolve(true); }
      function onOverlayClick(e) { if (e.target === overlay) { limpiar(); resolve(false); } }

      btnCancelar.addEventListener('click', onCancelar);
      btnAceptar.addEventListener('click', onAceptar);
      overlay.addEventListener('click', onOverlayClick);
    });
  }

  /* ============================================================
     ZONA HORARIA — Paraguay (America/Asuncion)
     ============================================================ */
  const TIMEZONE = "America/Asuncion";

  function offsetMinutosZona(timeZone, fecha) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const partes = dtf.formatToParts(fecha).reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const hora24 = partes.hour === "24" ? "00" : partes.hour;
    const comoUTC = Date.UTC(
      Number(partes.year), Number(partes.month) - 1, Number(partes.day),
      Number(hora24), Number(partes.minute), Number(partes.second)
    );
    return (comoUTC - fecha.getTime()) / 60000;
  }

  function inicioMesParaguay(referencia = new Date()) {
    const offsetMin = offsetMinutosZona(TIMEZONE, referencia);
    const local = new Date(referencia.getTime() + offsetMin * 60000);
    const y = local.getUTCFullYear(), m = local.getUTCMonth();
    const inicioMesComoUTC = Date.UTC(y, m, 1, 0, 0, 0) - offsetMin * 60000;
    return new Date(inicioMesComoUTC);
  }

  // Devuelve el rango [inicio, fin) en UTC que corresponde a un día
  // calendario completo en Paraguay, para una fecha "YYYY-MM-DD" dada
  // (el valor que entrega un <input type="date">).
  function rangoDiaParaguay(fechaStr) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const referencia = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const offsetMin = offsetMinutosZona(TIMEZONE, referencia);
    const inicio = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60000);
    const fin = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offsetMin * 60000);
    return { inicio, fin };
  }

  function hoyComoInputDate() {
    const referencia = new Date();
    const offsetMin = offsetMinutosZona(TIMEZONE, referencia);
    const local = new Date(referencia.getTime() + offsetMin * 60000);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, '0');
    const d = String(local.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatearFechaHoraParaguay(fecha) {
    if (!fecha) return "—";
    return fecha.toLocaleString("es-PY", {
      timeZone: TIMEZONE,
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  /* ============================================================
     FUNCIONES DE FIRESTORE
     ------------------------------------------------------------
     Se lee de "facturas" (lo que sí existe y se llena de verdad),
     no de una colección "movimientos" inexistente. Cada factura no
     anulada cuenta como un ingreso, agrupado por método de pago:
     "Efectivo" -> efectivo; cualquier otro medio -> transferencia
     (la UI de Caja solo distingue esas dos categorías).
     Egresos quedan en 0: todavía no hay pantalla de gastos/compras.
     ============================================================ */
  function mapearFormaPago(metodoPago) {
    return metodoPago === 'Efectivo' ? 'efectivo' : 'transferencia';
  }

  async function getFacturasDesde(fechaISO) {
    try {
      const snapshot = await db.collection('facturas')
        .where('empresaId', '==', empresaId)
        .where('created_at', '>=', fechaISO)
        .get();

      const movs = [];
      snapshot.forEach(doc => {
        const f = doc.data();
        if (f.estado === 'Anulada') return;
        movs.push({
          fecha: new Date(f.created_at),
          monto: typeof f.total === 'number' ? f.total : 0,
          forma_pago: mapearFormaPago(f.metodoPago)
        });
      });
      return movs;
    } catch (e) {
      console.error("Error cargando facturas para caja:", e);
      return [];
    }
  }

  async function getCajaActiva(tipo) {
    try {
      const snapshot = await db.collection('cajas')
        .where('empresaId', '==', empresaId)
        .where('tipo', '==', tipo)
        .where('estado', '==', 'abierta')
        .limit(1)
        .get();

      if (!snapshot.empty) {
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      }
      return null;
    } catch (e) {
      console.error(`Error buscando caja activa (${tipo}):`, e);
      return null;
    }
  }

  async function abrirCaja(tipo) {
    const ok = await confirmarModal('Abrir caja', `¿Estás seguro de abrir la caja de ${tipo}?`);
    if (!ok) return;
    try {
      await db.collection('cajas').add({
        empresaId: empresaId,
        tipo: tipo,
        estado: 'abierta',
        fecha_apertura: new Date(),
        monto_apertura: 0,
        usuario: sesionActual?.nombre || ''
      });
      renderTodo();
    } catch (e) {
      alert("Error al abrir la caja");
    }
  }

  async function cerrarCaja(id) {
    const ok = await confirmarModal('Cerrar caja', '¿Estás seguro de cerrar esta caja? Esta acción finalizará la sesión actual.');
    if (!ok) return;
    try {
      await db.collection('cajas').doc(id).update({
        estado: 'cerrada',
        fecha_cierre: new Date()
      });
      renderTodo();
    } catch (e) {
      alert("Error al cerrar la caja");
    }
  }

  /* ============================================================
     RENDERIZADO
     ============================================================ */
  function renderHeader() {
    if (!sesionActual) return;
    const fechaEl = document.getElementById("topbar-date");
    if (fechaEl) fechaEl.textContent = `${sesionActual.sucursalNombre} · ${formatearFechaHoraParaguay(new Date())}`;
  }

  function formatearPrecio(valor) {
    return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
  }

  function fechaSeleccionada() {
    const input = document.getElementById('fecha-efectivo') || document.getElementById('fecha-transferencia');
    return (input && input.value) || hoyComoInputDate();
  }

  async function calcularTotales() {
    const fechaDiaStr = fechaSeleccionada();
    const { inicio: inicioDia, fin: finDia } = rangoDiaParaguay(fechaDiaStr);
    const inicioMes = inicioMesParaguay();

    // Traemos desde el más antiguo entre "inicio del mes" y "el día elegido"
    // (por si se elige una fecha de un mes anterior), en un solo viaje a Firestore.
    const desde = inicioDia < inicioMes ? inicioDia : inicioMes;
    const movimientos = await getFacturasDesde(desde.toISOString());

    let efectivoDiaIng = 0, transDiaIng = 0;
    let efectivoMesIng = 0, transMesIng = 0;
    const efectivoDiaEgr = 0, transDiaEgr = 0, efectivoMesEgr = 0, transMesEgr = 0; // sin egresos todavía

    movimientos.forEach(m => {
      const enElDia = m.fecha >= inicioDia && m.fecha < finDia;
      const enElMes = m.fecha >= inicioMes;

      if (m.forma_pago === 'efectivo') {
        if (enElDia) efectivoDiaIng += m.monto;
        if (enElMes) efectivoMesIng += m.monto;
      } else {
        if (enElDia) transDiaIng += m.monto;
        if (enElMes) transMesIng += m.monto;
      }
    });

    return {
      fechaDiaStr,
      dia: {
        efectivo: { ing: efectivoDiaIng, egr: efectivoDiaEgr },
        transferencia: { ing: transDiaIng, egr: transDiaEgr }
      },
      mes: {
        efectivo: { ing: efectivoMesIng, egr: efectivoMesEgr },
        transferencia: { ing: transMesIng, egr: transMesEgr }
      }
    };
  }

  function pintarTotales(datos) {
    const setTxt = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = formatearPrecio(valor); };

    setTxt('dia-efectivo-ing', datos.dia.efectivo.ing);
    setTxt('dia-efectivo-eg', datos.dia.efectivo.egr);
    setTxt('dia-efectivo-saldo', datos.dia.efectivo.ing - datos.dia.efectivo.egr);
    setTxt('dia-transferencia-ing', datos.dia.transferencia.ing);
    setTxt('dia-transferencia-eg', datos.dia.transferencia.egr);
    setTxt('dia-transferencia-saldo', datos.dia.transferencia.ing - datos.dia.transferencia.egr);

    const totalSobranteDia =
      (datos.dia.efectivo.ing - datos.dia.efectivo.egr) +
      (datos.dia.transferencia.ing - datos.dia.transferencia.egr);
    setTxt('dia-total-sobrante', totalSobranteDia);

    setTxt('mes-efectivo-ing', datos.mes.efectivo.ing);
    setTxt('mes-efectivo-eg', datos.mes.efectivo.egr);
    setTxt('mes-efectivo-saldo', datos.mes.efectivo.ing - datos.mes.efectivo.egr);
    setTxt('mes-transferencia-ing', datos.mes.transferencia.ing);
    setTxt('mes-transferencia-eg', datos.mes.transferencia.egr);
    setTxt('mes-transferencia-saldo', datos.mes.transferencia.ing - datos.mes.transferencia.egr);

    const totalSobranteMes =
      (datos.mes.efectivo.ing - datos.mes.efectivo.egr) +
      (datos.mes.transferencia.ing - datos.mes.transferencia.egr);
    setTxt('mes-total-sobrante', totalSobranteMes);
  }

  function pintarEstadoCaja(tipo, cajaActiva) {
    const sufijo = tipo; // 'efectivo' | 'transferencia'
    const estadoEl = document.getElementById(`estado-${sufijo}`);
    const btnAbrir = document.getElementById(`btn-abrir-${sufijo}`);
    const btnCerrar = document.getElementById(`btn-cerrar-${sufijo}`);

    if (cajaActiva) {
      estadoEl.textContent = 'Caja ABIERTA';
      estadoEl.className = 'caja-status-text abierta';
      btnAbrir.disabled = true;
      btnCerrar.disabled = false;
      btnCerrar.onclick = () => cerrarCaja(cajaActiva.id);
      btnAbrir.onclick = null;
    } else {
      estadoEl.textContent = 'Caja CERRADA';
      estadoEl.className = 'caja-status-text cerrada';
      btnAbrir.disabled = false;
      btnCerrar.disabled = true;
      btnAbrir.onclick = () => abrirCaja(tipo);
      btnCerrar.onclick = null;
    }
  }

  async function renderTabla() {
    const datos = await calcularTotales();
    ultimosDatos = datos;
    ultimaFechaDia = datos.fechaDiaStr;
    pintarTotales(datos);

    const cajaEfectivo = await getCajaActiva('efectivo');
    const cajaTransferencia = await getCajaActiva('transferencia');
    pintarEstadoCaja('efectivo', cajaEfectivo);
    pintarEstadoCaja('transferencia', cajaTransferencia);
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    renderHeader();
    await renderTabla();
  }

  /* ============================================================
     FECHA (los dos selectores de fecha quedan sincronizados y
     recalculan "Recaudado del día" para la fecha elegida)
     ============================================================ */
  function initFechaFields() {
    const hoy = hoyComoInputDate();
    const fEf = document.getElementById('fecha-efectivo');
    const fTr = document.getElementById('fecha-transferencia');
    if (fEf) fEf.value = hoy;
    if (fTr) fTr.value = hoy;

    async function onCambioFecha(valor) {
      if (fEf) fEf.value = valor;
      if (fTr) fTr.value = valor;
      const datos = await calcularTotales();
      ultimosDatos = datos;
      ultimaFechaDia = datos.fechaDiaStr;
      pintarTotales(datos);
    }

    if (fEf) fEf.addEventListener('change', () => onCambioFecha(fEf.value));
    if (fTr) fTr.addEventListener('change', () => onCambioFecha(fTr.value));
  }

  /* ============================================================
     PDF DEL INFORME DE CAJA
     ============================================================ */
  function generarInformePDF() {
    if (!window.jspdf) {
      alert('No se pudo cargar el generador de PDF. Revisá tu conexión a internet.');
      return;
    }
    if (!ultimosDatos) {
      alert('Todavía se están cargando los datos de caja. Probá de nuevo en un segundo.');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;
    let y = 20;

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('Informe de Caja', marginX, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`${sesionActual.empresaNombre} · ${sesionActual.sucursalNombre}`, marginX, y);
    y += 5;
    doc.text(`Generado: ${formatearFechaHoraParaguay(new Date())}`, marginX, y);
    y += 5;
    doc.text(`Día del informe: ${ultimaFechaDia}`, marginX, y);
    y += 10;

    doc.setDrawColor(200, 200, 200);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 10;

    function seccion(titulo, datosSeccion) {
      doc.setFontSize(13);
      doc.setFont(undefined, 'bold');
      doc.text(titulo, marginX, y);
      y += 8;

      doc.setFontSize(10);
      const filas = [
        ['', 'Efectivo', 'Transferencia'],
        ['Ingreso', formatearPrecio(datosSeccion.efectivo.ing), formatearPrecio(datosSeccion.transferencia.ing)],
        ['Egreso', formatearPrecio(datosSeccion.efectivo.egr), formatearPrecio(datosSeccion.transferencia.egr)],
        ['Saldo', formatearPrecio(datosSeccion.efectivo.ing - datosSeccion.efectivo.egr), formatearPrecio(datosSeccion.transferencia.ing - datosSeccion.transferencia.egr)]
      ];
      const colX = [marginX, marginX + 45, marginX + 95];
      filas.forEach((fila, i) => {
        doc.setFont(undefined, i === 0 ? 'bold' : 'normal');
        fila.forEach((celda, j) => doc.text(celda, colX[j], y));
        y += 6;
      });

      const totalSobrante =
        (datosSeccion.efectivo.ing - datosSeccion.efectivo.egr) +
        (datosSeccion.transferencia.ing - datosSeccion.transferencia.egr);
      y += 2;
      doc.setFont(undefined, 'bold');
      doc.text(`Total sobrante: ${formatearPrecio(totalSobrante)}`, marginX, y);
      y += 12;
    }

    seccion(`Recaudado del día (${ultimaFechaDia})`, ultimosDatos.dia);
    seccion('Recaudado del mes', ultimosDatos.mes);

    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Documento generado por Gastro. Los egresos reflejan solo los movimientos registrados en el sistema.', marginX, doc.internal.pageSize.getHeight() - 10);

    const nombreArchivo = `Informe-Caja-${ultimaFechaDia}.pdf`;
    doc.save(nombreArchivo);
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  function initDescargarPDF() {
    const btn = document.getElementById('btn-descargar-pdf');
    if (btn) btn.addEventListener('click', generarInformePDF);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initFechaFields();
    initDescargarPDF();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    renderTodo();

    if (!window.__gastroCajaInterval) {
      window.__gastroCajaInterval = setInterval(renderTodo, 30000);
    }
  });

})();