(function () {
  'use strict';

  // Marcador de versión: si al recargar la página NO ves este mensaje en
  // la consola del navegador, el archivo que se está sirviendo todavía
  // es una versión anterior de facturacion.js.
  console.log("%c[facturacion.js] versión con sucursal + pago mixto + titular + apertura directa + pantalla compacta sin datos fiscales + buscador de productos + sin cargo + pedido de cada venta (v13)", "color:#2563eb;font-weight:bold;");

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sucursalId = null;
  let sesionActual = null;

  const ICON_VER = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const ICON_EDITAR = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const ICON_DELETE = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

  const PAGE_SIZE = 8;

  // "Cliente" virtual que se antepone siempre a la lista de clientes reales
  // en el combobox, para que Consumidor Final aparezca como una opción más
  // dentro del mismo buscador (no como un botón aparte). Su id fijo permite
  // detectarlo si hiciera falta en otro lado del código. Sin CI/RUC: un
  // Consumidor Final, por definición, no tiene documento cargado.
  const CONSUMIDOR_FINAL_CLIENTE = {
    id: '__consumidor_final__',
    name: 'Consumidor Final',
    phone: '',
    email: '',
    ci: ''
  };

  function conConsumidorFinal(listaClientes) {
    return [CONSUMIDOR_FINAL_CLIENTE, ...(listaClientes || [])];
  }

  let pagina = 1;
  let moneda = "Gs";
  let facturas = [];
  let facturasFiltradas = [];
  let clientes = [];
  let productos = [];

  let opItems = [];
  let clienteSeleccionado = null;
  let rowSeq = 0;
  let deleteTargetId = null;
  // Cuando no es null, el modal "Nueva Operación" está en modo edición
  // y guardarOperacion() actualiza esta factura en vez de crear una nueva.
  let facturaEditandoId = null;

  // Estado del modal SIMPLE de edición (solo Cliente/Productos/Método/Estado
  // + N.º de comprobante).
  let facturaEditandoSimpleId = null;
  let facturaEditandoSimpleMoneda = 'Gs';
  let clienteSeleccionadoEditar = null;
  let clienteComboboxEditar = null;
  let rowSeqEditar = 0;
  // Mesa de la operación en curso (llega desde el menú vía OperacionFactura.open)
  let operacionMesaActual = null;

  const rates = { "US$": 1, "Gs": 7300, "R$": 5.4 };
  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

  /* ============================================================
     FUNCIONES DE FIREBASE
     ============================================================ */

  // Nombres de campo posibles donde puede venir el CI/RUC en el
  // documento de Firestore. Se compara sin importar mayúsculas o
  // minúsculas, así cubrimos variantes como "RUC", "Ruc", "N° CI", etc.
  const CI_FIELD_CANDIDATES = [
    'ci', 'ruc', 'cedula', 'cédula', 'documento', 'nrodocumento',
    'numerodocumento', 'numero_documento', 'nro_documento',
    'identificacion', 'identificación', 'dni', 'nrodoc', 'doc',
    'rucci', 'ruc_ci', 'ruccliente', 'cicliente', 'nrocedula',
    'numerocedula', 'cliente_ci', 'cliente_ruc'
  ];

  function extraerCI(data) {
    if (!data || typeof data !== 'object') return '';

    // 1) Búsqueda exacta por lista de candidatos (case-insensitive)
    const keys = Object.keys(data);
    for (const candidate of CI_FIELD_CANDIDATES) {
      const foundKey = keys.find(k => k.toLowerCase() === candidate);
      if (foundKey && data[foundKey]) return String(data[foundKey]).trim();
    }

    // 2) Búsqueda "suave": cualquier campo cuyo nombre contenga ci, ruc,
    //    cedula/cédula o documento (por si el campo real es distinto,
    //    ej: "numeroCI", "docIdentidad", "RUC_Cliente", etc.)
    const softMatch = keys.find(k => {
      const low = k.toLowerCase();
      return (
        low.includes('ruc') ||
        low.includes('cedula') ||
        low.includes('cédula') ||
        low.includes(' ci') ||
        low === 'ci' ||
        low.includes('_ci') ||
        low.includes('documento')
      );
    });
    if (softMatch && data[softMatch]) return String(data[softMatch]).trim();

    return '';
  }

  // ⚠️ Antes esto traía TODAS las facturas de TODAS las empresas de
  // Firestore (sin ningún .where). Se agrega el filtro por empresaId,
  // igual que en el resto de las páginas, para que cada negocio vea
  // únicamente sus propias facturas.
  async function cargarFacturas() {
    try {
      const snapshot = await db.collection('facturas')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        // Mismo criterio que en el resto del sistema: factura de otra
        // sucursal (con sucursalId cargado y distinto) queda afuera;
        // factura ambigua (sin sucursalId, de antes de este cambio) se
        // deja pasar en todas hasta que se edite o se reclame con el
        // botón de arriba.
        if (data.sucursalId && data.sucursalId !== sucursalId) return;
        todos.push({ id: doc.id, ...data });
      });
      return todos;
    } catch (error) {
      console.error("❌ Error al cargar facturas:", error);
      return [];
    }
  }

  // Mismo filtro por empresaId aplicado acá: los clientes del combobox
  // deben ser los de la empresa activa, no los de todas.
  async function cargarClientes() {
    try {
      const snapshot = await db.collection('clientes')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const ci = extraerCI(data);
        if (!ci) {
          console.warn('⚠️ No se encontró CI/RUC para cliente', doc.id, '— campos disponibles:', Object.keys(data));
        }
        todos.push({
          id: doc.id,
          ...data,
          ci
        });
      });
      console.log('✅ Clientes cargados:', todos);
      return todos;
    } catch (error) {
      console.error("❌ Error al cargar clientes:", error);
      return [];
    }
  }

  // Idem: productos filtrados por la empresa activa.
  async function cargarProductos() {
    try {
      const snapshot = await db.collection('productos')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      console.log('✅ Productos cargados:', todos);
      return todos;
    } catch (error) {
      console.error("❌ Error al cargar productos:", error);
      return [];
    }
  }

  async function crearFactura(datos) {
    try {
      datos.empresaId = empresaId;
      datos.created_at = new Date().toISOString();
      const docRef = await db.collection('facturas').add(datos);
      console.log("✅ Factura creada con ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("❌ Error al crear factura:", error);
      throw error;
    }
  }

  async function actualizarFactura(id, datos) {
    try {
      await db.collection('facturas').doc(id).update(datos);
      console.log(`✅ Factura ${id} actualizada`);
    } catch (error) {
      console.error("❌ Error al actualizar factura:", error);
      throw error;
    }
  }

  async function actualizarEstadoFactura(id, nuevoEstado) {
    try {
      await db.collection('facturas').doc(id).update({ estado: nuevoEstado });
      console.log(`✅ Factura ${id} actualizada a ${nuevoEstado}`);
    } catch (error) {
      console.error("❌ Error al actualizar estado:", error);
      throw error;
    }
  }

  async function eliminarFactura(id) {
    try {
      await db.collection('facturas').doc(id).delete();
      console.log(`✅ Factura ${id} eliminada`);
    } catch (error) {
      console.error("❌ Error al eliminar factura:", error);
      throw error;
    }
  }

  async function obtenerSiguienteCorrelativo() {
    const ref = db.collection('contadores').doc('facturacion');
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const actual = doc.exists ? (doc.data().ultimoCorrelativo || 0) : 0;
      const siguiente = actual + 1;
      tx.set(ref, { ultimoCorrelativo: siguiente }, { merge: true });
      return siguiente;
    });
  }

  /* ============================================================
     CONTROL DE CAJA ABIERTA/CERRADA
     ------------------------------------------------------------
     No debe poder registrarse ninguna venta nueva si la caja
     correspondiente no está abierta. Usa la misma colección y el
     mismo criterio que caja.js: 'cajas' con {empresaId, tipo,
     estado:'abierta'}, y el mismo mapeo de método de pago → tipo de
     caja (Efectivo → 'efectivo'; cualquier otro medio → 'transferencia').
     ============================================================ */
  function mapearFormaPagoCaja(metodoPago) {
    return metodoPago === 'Efectivo' ? 'efectivo' : 'transferencia';
  }

  async function getCajaActiva(tipo) {
    try {
      const snapshot = await db.collection('cajas')
        .where('empresaId', '==', empresaId)
        .where('tipo', '==', tipo)
        .where('estado', '==', 'abierta')
        .limit(1)
        .get();
      return !snapshot.empty;
    } catch (error) {
      console.error(`❌ Error consultando caja activa (${tipo}):`, error);
      // Ante un error de lectura, bloqueamos por seguridad en vez de
      // dejar pasar la venta: es más seguro frenar una venta de más que
      // dejar pasar una sin control de caja detrás por un problema de
      // red o de permisos.
      return false;
    }
  }

  async function obtenerEstadoCajas() {
    const [efectivo, transferencia] = await Promise.all([
      getCajaActiva('efectivo'),
      getCajaActiva('transferencia')
    ]);
    return { efectivo, transferencia };
  }

  function mostrarModalCajaCerrada(mensaje) {
    const textoEl = document.getElementById('caja-cerrada-texto');
    const overlay = document.getElementById('caja-cerrada-overlay');

    if (!overlay) {
      // Si esto pasa, el HTML de esta página todavía no tiene el modal
      // "Caja cerrada" agregado (#caja-cerrada-overlay no existe) — antes
      // esta función no hacía nada en ese caso y la venta se bloqueaba
      // en silencio, sin avisar nada. Ahora, como respaldo, mostramos un
      // alert() común para que el bloqueo SIGA funcionando aunque falte
      // el modal, y dejamos un log bien explícito para poder detectarlo.
      console.error('❌ No se encontró #caja-cerrada-overlay en esta página. Revisá que el HTML tenga el modal de "Caja cerrada" agregado (buscá "caja-cerrada-overlay" en el archivo).');
      alert(mensaje);
      return;
    }

    if (textoEl) textoEl.textContent = mensaje;
    overlay.classList.add('open');
  }

  function initModalCajaCerrada() {
    const overlay = document.getElementById('caja-cerrada-overlay');
    if (!overlay) return;
    const cancelarBtn = document.getElementById('caja-cerrada-cancelar');
    if (cancelarBtn) cancelarBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  }

  /* ============================================================
     FUNCIONES DE UTILIDAD Y FORMATEO
     ============================================================ */
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

  // Igual que formatearPrecio(), pero recibe la moneda como parámetro en
  // vez de usar la moneda global de la página. Se usa para los PDF, que
  // deben respetar la moneda EN LA QUE SE EMITIÓ esa factura puntual
  // (factura.moneda), no la moneda que el usuario tenga seleccionada
  // en el toggle de la tabla en este momento.
  function formatearPrecioEnMoneda(valorGs, monedaDestino) {
    const simbolo = symbols[monedaDestino] || '';
    const valor = Number(valorGs) || 0;

    if (monedaDestino === 'US$') {
      return `${simbolo}${(valor / rates['Gs']).toFixed(2)}`;
    }
    if (monedaDestino === 'R$') {
      return `${simbolo}${((valor / rates['Gs']) * rates['R$']).toFixed(2)}`;
    }
    // Gs (o cualquier valor no reconocido cae acá)
    return `${simbolo}${Math.round(valor).toLocaleString('es-PY')}`;
  }

  function formatearNumero(valor) {
    if (isNaN(valor) || valor === 0) return '';
    return Math.round(valor).toLocaleString('es-PY');
  }

  function parseNumero(texto) {
    if (!texto) return 0;
    const limpio = texto.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(limpio);
    return isNaN(num) ? 0 : num;
  }

  function convertirAGs(valor, monedaOrigen) {
    const n = Number(valor) || 0;
    if (monedaOrigen === 'Gs') return n;
    if (monedaOrigen === 'US$') return n * rates['Gs'];
    if (monedaOrigen === 'R$') return (n / rates['R$']) * rates['Gs'];
    return n;
  }

  // Inverso de convertirAGs(): un valor guardado en Gs, mostrado en la
  // moneda que corresponda. Se usa al abrir el modal de edición, donde
  // los importes guardados (siempre en Gs) hay que re-mostrarlos en la
  // moneda original de esa factura.
  function convertirDeGs(valorGs, monedaDestino) {
    const n = Number(valorGs) || 0;
    if (monedaDestino === 'US$') return n / rates['Gs'];
    if (monedaDestino === 'R$') return (n / rates['Gs']) * rates['R$'];
    return n; // Gs
  }

  function formatearFecha(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  }

  function getEstadoLabel(estado) {
    const map = {
      "Pagada": "Pagada",
      "Pendiente": "Pendiente",
      "Anulada": "Anulada"
    };
    return map[estado] || estado || "Pendiente";
  }

  function getItemsSummary(items) {
    if (!items || items.length === 0) return "—";
    const names = items.map(i => i.producto || i.name || "Producto");
    const totalCount = items.reduce((s, i) => s + (i.cantidad || i.qty || 1), 0);

    if (items.length === 1) {
      const qty = items[0].qty || 1;
      return `${names[0]} ${qty > 1 ? `× ${qty}` : ''}`;
    }

    let summary = names.slice(0, 2).join(", ");
    if (names.length > 2) {
      summary += ` +${names.length - 2} más`;
    }
    summary += ` (${totalCount} ítems)`;
    return summary;
  }

  /* ============================================================
     GENERACIÓN DE PDF (ticket 80mm y factura A4)
     Usa jsPDF + jsPDF-AutoTable, cargados vía CDN en el HTML.
     window.jspdf.jsPDF es el constructor que expone la librería UMD.
     ============================================================ */

  function totalGsDeFactura(factura) {
    if (typeof factura.total === 'number') return factura.total;
    return (factura.items || []).reduce((sum, item) => {
      const precio = item.precioGs ?? item.precio ?? item.price ?? 0;
      const cant = item.cantidad ?? item.qty ?? 0;
      return sum + precio * cant;
    }, 0);
  }

  // Ticket angosto (pensado para impresoras térmicas de 80mm)
  function generarDocTicket(factura) {
    if (!window.jspdf) {
      alert('No se pudo cargar el generador de PDF. Revisá tu conexión a internet.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    const monedaFactura = factura.moneda || 'Gs';
    const items = factura.items || [];

    const anchoMM = 80;
    const altoMM = 95 + items.length * 6 + (factura.metodoPago === METODO_MIXTO ? 8 : 0) + (factura.titularTransferencia ? 4 : 0);
    const doc = new jsPDF({ unit: 'mm', format: [anchoMM, altoMM] });

    let y = 8;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    doc.text(sesionActual.empresaNombre, anchoMM / 2, y, { align: 'center' });
    y += 5;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    doc.text(sesionActual.sucursalNombre, anchoMM / 2, y, { align: 'center' });
    y += 6;

    doc.setLineDashPattern([1, 1], 0);
    doc.line(4, y, anchoMM - 4, y);
    doc.setLineDashPattern([], 0);
    y += 5;

    doc.setFontSize(8);
    doc.text(`Fecha: ${formatearFecha(factura.created_at)}`, 4, y); y += 4;
    doc.text(`Cliente: ${factura.cliente?.name || '—'}`, 4, y); y += 4;
    if (factura.mesa) { doc.text(`Mesa: ${factura.mesa}`, 4, y); y += 4; }
    doc.text(`Método: ${factura.metodoPago || factura.metodo || '—'}`, 4, y); y += 4;
    if (factura.metodoPago === METODO_MIXTO) {
      doc.text(`  Efectivo: ${formatearPrecioEnMoneda(factura.montoEfectivo || 0, monedaFactura)}`, 4, y); y += 4;
      doc.text(`  Transferencia: ${formatearPrecioEnMoneda(factura.montoTransferencia || 0, monedaFactura)}`, 4, y); y += 4;
    }
    if (factura.titularTransferencia) {
      doc.text(`Transfirió: ${String(factura.titularTransferencia).slice(0, 34)}`, 4, y); y += 4;
    }
    doc.text(`Cajero: ${factura.cajero || '—'}`, 4, y); y += 4;

    doc.line(4, y, anchoMM - 4, y); y += 5;

    doc.setFont(undefined, 'bold');
    doc.text('Producto', 4, y);
    doc.text('Cant.', 50, y);
    doc.text('Total', anchoMM - 4, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    y += 4;

    items.forEach(item => {
      const precioBase = item.precioGs ?? item.precio ?? item.price ?? 0;
      const cantidad = item.cantidad ?? item.qty ?? 1;
      const totalItem = precioBase * cantidad;
      const nombre = (item.producto || item.name || 'Producto').slice(0, 22);
      doc.text(nombre, 4, y);
      doc.text(String(cantidad), 50, y);
      doc.text(formatearPrecioEnMoneda(totalItem, monedaFactura), anchoMM - 4, y, { align: 'right' });
      y += 4;
    });

    y += 2;
    doc.line(4, y, anchoMM - 4, y); y += 6;

    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('TOTAL', 4, y);
    doc.text(formatearPrecioEnMoneda(totalGsDeFactura(factura), monedaFactura), anchoMM - 4, y, { align: 'right' });
    y += 8;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
    if (factura.metodoPago === METODO_SIN_CARGO) {
      doc.text(`SIN CARGO - ${factura.motivoSinCargo || ''}`, anchoMM / 2, y, { align: 'center' });
      y += 4;
    }
    doc.text('¡Gracias por su compra!', anchoMM / 2, y, { align: 'center' });

    return doc;
  }

  // Factura formal A4: barra superior de color, bloques de datos del
  // comprobante y del receptor armados con autoTable (así los anchos de
  // columna se calculan solos y el texto nunca se superpone, sin importar
  // cuán largo sea un rótulo), tabla de ítems y caja de totales. Sin
  // código QR.
  const FACTURA_COLOR_BARRA = [26, 58, 92];   // azul oscuro de la barra superior
  const FACTURA_COLOR_ACENTO = [26, 58, 92];  // mismo azul para textos destacados
  const FACTURA_COLOR_GRIS = [110, 118, 130]; // gris para rótulos secundarios
  const FACTURA_COLOR_BORDE = [222, 226, 233]; // gris claro para bordes de tablas

  // Fila de datos "rótulo — valor — rótulo — valor" para los bloques de
  // metadata (comprobante / receptor). Usar autoTable para esto evita a
  // propósito el bug de antes (texto de valor pisando al rótulo cuando el
  // rótulo era más largo de lo previsto).
  function filaMeta(label1, valor1, label2, valor2) {
    return [label1 || '', valor1 || '—', label2 || '', valor2 || ''];
  }

  function tablaMeta(doc, filas, startY, margenIzq, margenDer) {
    doc.autoTable({
      startY,
      body: filas,
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
        lineColor: FACTURA_COLOR_BORDE,
        lineWidth: 0.15,
        textColor: [30, 35, 45]
      },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: FACTURA_COLOR_GRIS, cellWidth: 34, fillColor: [246, 247, 250] },
        1: { cellWidth: 58 },
        2: { fontStyle: 'bold', textColor: FACTURA_COLOR_GRIS, cellWidth: 34, fillColor: [246, 247, 250] },
        3: { cellWidth: 'auto' }
      },
      margin: { left: margenIzq, right: pageWidthGlobal - margenDer }
    });
    return doc.lastAutoTable.finalY;
  }

  let pageWidthGlobal = 0; // se fija al entrar a generarDocFactura(); lo usa tablaMeta() para el margen derecho de autoTable

  function generarDocFactura(factura) {
    if (!window.jspdf) {
      alert('No se pudo cargar el generador de PDF. Revisá tu conexión a internet.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    const monedaFactura = factura.moneda || 'Gs';
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    pageWidthGlobal = pageWidth;
    const margenIzq = 14;
    const margenDer = pageWidth - 14;

    // ---------- Barra superior ----------
    const altoHeader = 27;
    doc.setFillColor(...FACTURA_COLOR_BARRA);
    doc.rect(0, 0, pageWidth, altoHeader, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(16);
    doc.text(sesionActual.empresaNombre, margenIzq, 13);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(205, 214, 232);
    doc.text(sesionActual.sucursalNombre, margenIzq, 19.5);

    const tituloBarra = factura.tipoDoc === 'TICKET' ? 'COMPROBANTE DE VENTA' : 'FACTURA';
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.text(tituloBarra, margenDer, 10, { align: 'right' });
    doc.setFontSize(15);
    doc.text(factura.numeroDoc || factura.codigo || '—', margenDer, 18, { align: 'right' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(205, 214, 232);
    doc.text(formatearFecha(factura.created_at), margenDer, 23.5, { align: 'right' });

    doc.setTextColor(0, 0, 0);

    // ---------- Bloque "Datos del comprobante" ----------
    let y = altoHeader + 9;

    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...FACTURA_COLOR_ACENTO);
    doc.text('DATOS DEL COMPROBANTE', margenIzq, y);
    doc.setTextColor(0, 0, 0);
    y += 4;

    const condicionVentaTexto = factura.condicionVenta === 'CREDITO' ? 'Crédito' : 'Contado';
    const filasComprobante = [
      filaMeta('Timbrado', factura.timbrado || '—', 'Condición de venta', condicionVentaTexto),
      filaMeta('Fecha emisión', factura.fecEmision || (factura.created_at || '').slice(0, 10) || '—', 'Moneda', monedaFactura),
      filaMeta('Cajero', factura.cajero || '—', '', '')
    ];
    y = tablaMeta(doc, filasComprobante, y, margenIzq, margenDer) + 8;

    // ---------- Bloque "Datos del receptor" ----------
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...FACTURA_COLOR_ACENTO);
    doc.text('DATOS DEL RECEPTOR', margenIzq, y);
    doc.setTextColor(0, 0, 0);
    y += 4;

    // Tipo de contribuyente solo tiene sentido si el receptor tiene CI/RUC
    // cargado — Consumidor Final no lo tiene, así que ahí no corresponde
    // mostrar ese dato (se deja esa celda vacía en su lugar).
    const tipoContribuyenteTexto = factura.tipoContribuyente === 'JURIDICA' ? 'Jurídica' : 'Física';
    let extraLabel = '';
    let extraValor = '';
    if (factura.mesa) {
      extraLabel = 'Mesa';
      extraValor = String(factura.mesa);
    } else if (factura.cliente?.ci) {
      extraLabel = 'Tipo contribuyente';
      extraValor = tipoContribuyenteTexto;
    }
    const filasReceptor = [
      filaMeta('Receptor', factura.cliente?.name || '—', 'RUC / CI', factura.cliente?.ci || '—'),
      ['Método de pago', textoMetodoPago(factura), extraLabel, extraValor]
    ];
    if ((factura.metodoPago === 'Transferencia' || factura.metodoPago === METODO_MIXTO) && (factura.banco || factura.titularTransferencia)) {
      filasReceptor.push(filaMeta('Banco', factura.banco || '—', factura.titularTransferencia ? 'Transfirió' : '', factura.titularTransferencia || ''));
    }
    y = tablaMeta(doc, filasReceptor, y, margenIzq, margenDer) + 9;

    // ---------- Tabla de ítems ----------
    const items = factura.items || [];
    const rows = items.map(item => {
      const precioBase = item.precioGs ?? item.precio ?? item.price ?? 0;
      const cantidad = item.cantidad ?? item.qty ?? 1;
      return [
        String(cantidad),
        'Unid.',
        item.producto || item.name || 'Producto',
        formatearPrecioEnMoneda(precioBase, monedaFactura),
        formatearPrecioEnMoneda(precioBase * cantidad, monedaFactura)
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['Cant.', 'Unidad', 'Descripción', 'P. Unitario', 'Importe']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: FACTURA_COLOR_BARRA, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: { top: 2.4, bottom: 2.4, left: 3, right: 3 }, lineColor: FACTURA_COLOR_BORDE, lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      columnStyles: {
        0: { cellWidth: 16, halign: 'center' },
        1: { cellWidth: 22 },
        3: { halign: 'right' },
        4: { halign: 'right' }
      },
      margin: { left: margenIzq, right: pageWidth - margenDer }
    });

    const finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 8;

    // ---------- Caja de totales (derecha) ----------
    const totalGs = totalGsDeFactura(factura);
    const subtotalTexto = formatearPrecioEnMoneda(totalGs, monedaFactura);
    const totalTexto = formatearPrecioEnMoneda(totalGs, monedaFactura);
    const cajaAncho = 68;
    const cajaX = margenDer - cajaAncho;
    let cajaY = finalY;

    doc.setDrawColor(...FACTURA_COLOR_BORDE);
    doc.setLineWidth(0.2);

    const filaAltura = 7.5;
    const filas = [
      ['Subtotal', subtotalTexto, false],
      ['Descuento', formatearPrecioEnMoneda(0, monedaFactura), false],
      ['Total', totalTexto, true]
    ];

    filas.forEach(([label, valor, destacado]) => {
      if (destacado) {
        // Fila "Total": gris claro con texto oscuro y un borde superior más
        // grueso en el color de acento — resalta sin recurrir a un bloque
        // de color sólido oscuro, que se ve más "aviso" que factura.
        doc.setFillColor(232, 235, 240);
        doc.rect(cajaX, cajaY, cajaAncho, filaAltura, 'F');
        doc.setTextColor(20, 26, 38);
        doc.setDrawColor(...FACTURA_COLOR_ACENTO);
        doc.setLineWidth(0.5);
        doc.line(cajaX, cajaY, cajaX + cajaAncho, cajaY);
        doc.setDrawColor(...FACTURA_COLOR_BORDE);
        doc.setLineWidth(0.2);
      } else {
        doc.setFillColor(250, 250, 251);
        doc.rect(cajaX, cajaY, cajaAncho, filaAltura, 'F');
        doc.setTextColor(30, 35, 45);
      }
      doc.rect(cajaX, cajaY, cajaAncho, filaAltura);
      doc.setFontSize(destacado ? 11.5 : 9.5);
      doc.setFont(undefined, destacado ? 'bold' : 'normal');
      doc.text(label, cajaX + 4, cajaY + filaAltura / 2 + 1.5);
      doc.text(valor, cajaX + cajaAncho - 4, cajaY + filaAltura / 2 + 1.5, { align: 'right' });
      cajaY += filaAltura;
    });
    doc.setTextColor(0, 0, 0);

    // Nota de moneda/IVA, alineada bajo la caja de totales — un detalle
    // estándar en facturas reales.
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(140, 145, 155);
    doc.text(`Montos expresados en ${monedaFactura}. IVA incluido según corresponda.`, cajaX + cajaAncho, cajaY + 4, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    // ---------- Glosa (si hay) ----------
    // (Sin código QR, según lo pedido — el documento cierra directo con la
    // glosa, el método de pago ya mostrado arriba, y el pie de página.)
    let yFinal = cajaY + 12;
    if (factura.glosa) {
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...FACTURA_COLOR_GRIS);
      doc.text('Glosa', margenIzq, yFinal);
      yFinal += 4.5;
      doc.setFont(undefined, 'normal');
      doc.setTextColor(30, 35, 45);
      const glosaLineas = doc.splitTextToSize(factura.glosa, margenDer - margenIzq);
      doc.text(glosaLineas, margenIzq, yFinal);
      yFinal += glosaLineas.length * 4.5 + 4;
    }

    // ---------- Pie ----------
    doc.setDrawColor(...FACTURA_COLOR_BORDE);
    doc.setLineWidth(0.2);
    const pieY = doc.internal.pageSize.getHeight() - 16;
    doc.line(margenIzq, pieY, margenDer, pieY);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(140, 145, 155);
    doc.text('Esta es una representación del comprobante de venta generado por Gastro.', margenIzq, pieY + 5);
    doc.setTextColor(0, 0, 0);

    return doc;
  }

  function generarDocPorFormato(factura, formato) {
    return formato === 'factura' ? generarDocFactura(factura) : generarDocTicket(factura);
  }

  function nombreArchivoPDF(factura, formato) {
    const base = factura.codigo || (factura.id || 'documento').slice(0, 10);
    const limpio = String(base).replace(/[^\w-]/g, '');
    return `${formato === 'factura' ? 'Factura' : 'Ticket'}-${limpio}.pdf`;
  }

  /* ============================================================
     COMBOBOX PERSONALIZADO (para clientes)
     ============================================================ */
  function initCombobox(comboboxId, inputId, optionsId, onSelect) {
    const combobox = document.getElementById(comboboxId);
    const input = document.getElementById(inputId);
    const optionsContainer = document.getElementById(optionsId);

    if (!combobox || !input || !optionsContainer) return null;

    let currentOptions = [];

    function filterOptions(query) {
      const q = query.toLowerCase().trim();
      const filtered = currentOptions.filter(p => {
        const searchable = (p.name || '').toLowerCase() + ' ' + (p.phone || '').toLowerCase();
        return searchable.includes(q);
      });
      renderOptions(filtered);
    }

    function renderOptions(list) {
      if (list.length === 0) {
        optionsContainer.innerHTML = `<div class="no-results">No se encontraron resultados</div>`;
      } else {
        let html = '';
        list.forEach(p => {
          const label = p.name + (p.phone ? ` (${p.phone})` : '');
          const esVirtual = p.id === '__consumidor_final__';
          const claseExtra = esVirtual ? ' option-item-destacado' : '';
          html += `<div class="option-item${claseExtra}" data-id="${p.id}" data-name="${p.name}" data-phone="${p.phone || ''}" data-email="${p.email || ''}" data-ci="${p.ci || ''}">${label}</div>`;
        });
        optionsContainer.innerHTML = html;
        optionsContainer.querySelectorAll('.option-item').forEach(el => {
          el.addEventListener('click', function() {
            const name = this.dataset.name;
            input.value = name;
            optionsContainer.classList.remove('show');
            if (onSelect) {
              onSelect({
                id: this.dataset.id,
                name: name,
                phone: this.dataset.phone,
                email: this.dataset.email,
                ci: this.dataset.ci
              });
            }
          });
        });
      }
    }

    input.addEventListener('input', function() {
      const query = this.value;
      filterOptions(query);
      if (query.length > 0) {
        optionsContainer.classList.add('show');
      } else {
        optionsContainer.classList.remove('show');
      }
    });

    input.addEventListener('focus', function() {
      if (this.value.length > 0) {
        filterOptions(this.value);
        optionsContainer.classList.add('show');
      } else {
        if (currentOptions.length > 0) {
          renderOptions(currentOptions);
          optionsContainer.classList.add('show');
        }
      }
    });

    input.addEventListener('blur', function() {
      setTimeout(() => {
        optionsContainer.classList.remove('show');
      }, 200);
    });

    document.addEventListener('click', function(e) {
      if (!combobox.contains(e.target)) {
        optionsContainer.classList.remove('show');
      }
    });

    function setOptions(list) {
      currentOptions = list;
    }

    function clear() {
      input.value = '';
      optionsContainer.classList.remove('show');
    }

    return { setOptions, clear, input };
  }

  let clienteCombobox = null;

  /* ============================================================
     RENDER (header, tabla)
     ============================================================ */
  function renderHeader() {
    if (!sesionActual) return;
    const branchDate = document.getElementById("branch-date");
    if (branchDate) branchDate.textContent = `${sesionActual.sucursalNombre} · Facturas y cobros del día`;
  }

  function renderTabla() {
    const tbody = document.getElementById("facturas-body");
    if (!tbody) return;

    facturasFiltradas = [...facturas];
    facturasFiltradas.sort((a, b) => {
      const da = new Date(a.created_at);
      const db2 = new Date(b.created_at);
      return db2 - da;
    });

    const totalPages = Math.max(1, Math.ceil(facturasFiltradas.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = facturasFiltradas.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No hay facturas registradas.</td></tr>`;
    } else {
      pageItems.forEach(f => {
        const tr = document.createElement("tr");
        const estadoLabel = getEstadoLabel(f.estado);
        const total = totalGsDeFactura(f);
        const itemsSummary = getItemsSummary(f.items);
        const fullItemList = f.items?.map(i => `${i.producto || i.name || ''} x${i.cantidad || i.qty || 1}`).join(', ') || '';
        const shortId = (f.id || "").slice(0, 12).toUpperCase();

        tr.innerHTML = `
          <td class="id" style="font-size: 11px;">${shortId}</td>
          <td>${formatearFecha(f.created_at)}</td>
          <td>${f.cliente?.name || "—"}</td>
          <td title="${fullItemList}">${itemsSummary}</td>
          <td title="${textoMetodoPago(f)}">${f.metodoPago || f.metodo || "—"}</td>
          <td>${formatearPrecio(total)}</td>
          <td><span class="estado ${f.estado || 'Pendiente'}">${estadoLabel}</span></td>
          <td style="display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: nowrap;">
            <button class="btn-accion ver" data-id="${f.id}" title="Ver detalle">${ICON_VER}</button>
            <button class="btn-accion editar" data-id="${f.id}" title="Cambiar estado">${ICON_EDITAR}</button>
            <button class="btn-accion eliminar" data-id="${f.id}" title="Eliminar">${ICON_DELETE}</button>
          </td>
        </tr>`;

        tr.querySelector(".ver").addEventListener("click", () => abrirDetalle(f.id));
        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditarSimple(f.id));
        tr.querySelector(".eliminar").addEventListener("click", () => abrirConfirmacion(f.id));
        tbody.appendChild(tr);
      });
    }

    const pageLabel = document.getElementById("page-label");
    if (pageLabel) pageLabel.textContent = `Página ${pagina} de ${totalPages}`;
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.disabled = pagina <= 1;
    if (nextBtn) nextBtn.disabled = pagina >= totalPages;
  }

  /* ============================================================
     FACTURAS "AMBIGUAS" (sin sucursalId, de antes de este cambio)
     ------------------------------------------------------------
     Se ven en todas las sucursales hasta que se les asigna una. En
     vez de obligar a editarlas una por una, este botón las asigna
     TODAS de una sola vez a la sucursal activa.
     ============================================================ */
  function contarFacturasAmbiguas() {
    return facturas.filter(f => !f.sucursalId).length;
  }

  function renderAmbiguoBanner() {
    const banner = document.getElementById("ambiguo-banner");
    const text = document.getElementById("ambiguo-text");
    if (!banner || !text) return;
    const cantidad = contarFacturasAmbiguas();
    if (cantidad > 0) {
      text.textContent = `${cantidad} factura(s) todavía no tienen sucursal asignada y por eso se ven en todas.`;
      banner.style.display = "flex";
    } else {
      banner.style.display = "none";
    }
  }

  async function asignarFacturasAmbiguasAEstaSucursal() {
    const btn = document.getElementById("ambiguo-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Asignando...";
    try {
      const ambiguas = facturas.filter(f => !f.sucursalId);
      if (!ambiguas.length) return;

      const batch = db.batch();
      ambiguas.forEach(f => {
        batch.update(db.collection('facturas').doc(f.id), { sucursalId: sucursalId });
      });
      await batch.commit();
      console.log(`✅ Se asignaron ${ambiguas.length} factura(s) a la sucursal "${sucursalId}".`);
      await renderTodo();
    } catch (error) {
      console.error("Error al asignar facturas ambiguas:", error);
      alert("No se pudieron asignar las facturas. Revisá la consola.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Asignar a esta sucursal";
    }
  }

  function initAmbiguo() {
    const btn = document.getElementById("ambiguo-btn");
    if (btn) btn.addEventListener("click", asignarFacturasAmbiguasAEstaSucursal);
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    const [facturasData, clientesData, productosData] = await Promise.all([
      cargarFacturas(),
      cargarClientes(),
      cargarProductos()
    ]);
    facturas = facturasData;
    clientes = clientesData;
    productos = productosData;
    renderHeader();
    renderTabla();
    renderAmbiguoBanner();
    if (clienteCombobox) clienteCombobox.setOptions(conConsumidorFinal(clientesData));
  }

  /* ============================================================
     MODAL NUEVA OPERACIÓN
     ============================================================ */
  function showMsg(text, type) {
    const el = document.getElementById('op-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'op-msg show ' + type;
  }

  function clearMsg() {
    const el = document.getElementById('op-msg');
    if (el) el.className = 'op-msg';
  }

  function fmtMoneda(valor, moneda) {
    const n = Number(valor) || 0;
    if (moneda === 'Gs') {
      return Math.round(n).toLocaleString('es-PY');
    }
    return n.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function hoy() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- Validación de N.º de comprobante repetido ----------
  // Se compara contra la lista de facturas ya cargadas de la empresa
  // activa (variable `facturas`, filtrada por empresaId al cargar).
  // `excluirId` es la propia factura cuando se está editando, para que
  // no se marque como "repetida" contra sí misma.
  function comprobanteRepetido(numero, excluirId) {
    const num = (numero || '').trim();
    if (!num) return false;
    return facturas.some(f => f.id !== excluirId && (f.numeroDoc || '').trim() === num);
  }

  function mostrarModalComprobanteDuplicado(numero) {
    const textoEl = document.getElementById('comprobante-duplicado-texto');
    if (textoEl) {
      textoEl.textContent = `El número de comprobante "${numero}" ya fue cargado en otra factura. Ingresá uno distinto.`;
    }
    const overlay = document.getElementById('comprobante-duplicado-overlay');
    if (overlay) overlay.classList.add('open');
  }

  function initModalComprobanteDuplicado() {
    const overlay = document.getElementById('comprobante-duplicado-overlay');
    if (!overlay) return;
    const okBtn = document.getElementById('comprobante-duplicado-ok');
    if (okBtn) okBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  }

  function initNuevaOperacion() {
    const btn = document.getElementById('nueva-operacion-btn');
    if (!btn) return;
    btn.addEventListener('click', () => abrirModalNuevaOperacion());
  }

  async function abrirModalNuevaOperacion(itemsPrecargados, opciones) {
    const overlay = document.getElementById('op-overlay');
    if (!overlay) {
      console.error('❌ No se encontró el modal de Nueva Operación (#op-overlay) en esta página.');
      return;
    }

    // Antes de dejar arrancar una venta nueva, exigimos que al menos una
    // caja (Efectivo o Transferencia) esté abierta. Si ninguna lo está,
    // ni siquiera se abre el modal de la operación.
    const estadoCajas = await obtenerEstadoCajas();
    if (!estadoCajas.efectivo && !estadoCajas.transferencia) {
      mostrarModalCajaCerrada('Ninguna caja está abierta. Abrí la Caja de Efectivo o la de Transferencia antes de registrar una venta.');
      return;
    }

    // Siempre que se abre para crear una operación nueva (no para editar),
    // nos aseguramos de salir del modo edición por si quedó activo de una
    // apertura anterior.
    facturaEditandoId = null;
    const tituloElNueva = document.getElementById('op-modal-title');
    if (tituloElNueva) tituloElNueva.textContent = 'Facturación · Ventas';
    const eyebrowElNueva = document.getElementById('op-modal-eyebrow');
    if (eyebrowElNueva) eyebrowElNueva.textContent = 'Operaciones';

    // La empresa de la operación es siempre la de la sesión activa — ya
    // no existe una lista de empresas entre las que "sincronizar" por
    // nombre (eso era necesario con la lista EMPRESAS hardcodeada).
    operacionMesaActual = opciones?.mesa || null;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('op-periodo', new Date().toISOString().slice(0, 7));
    const tipoOper = document.getElementById('op-tipo-oper');
    if (tipoOper) tipoOper.selectedIndex = 0;
    setVal('op-cliente', '');
    setVal('op-cliente-ci', '');
    const tipoDoc = document.getElementById('op-tipo-doc');
    if (tipoDoc) tipoDoc.selectedIndex = 0;
    setVal('op-timbrado', '');
    setVal('op-numero-doc', '');
    setVal('op-moneda', opciones?.moneda || 'Gs');
    setVal('op-fec-emision', hoy());
    setVal('op-fec-vcto', hoy());
    setVal('op-metodo-pago', 'Efectivo');
    setVal('op-banco', '');
    setVal('op-estado', 'Pagada');
    // NUEVO: valores por defecto de los campos de preparación fiscal
    const condVentaEl = document.getElementById('op-condicion-venta');
    if (condVentaEl) condVentaEl.selectedIndex = 0;
    const tipoContribEl = document.getElementById('op-tipo-contribuyente');
    if (tipoContribEl) tipoContribEl.selectedIndex = 0;
    setVal('op-gravado-5', '0');
    setVal('op-exento', '0');
    setVal('op-cdc', '');
    const estadoSifenEl = document.getElementById('op-estado-sifen');
    if (estadoSifenEl) estadoSifenEl.value = 'no_enviada';
    const bancoWrap = document.getElementById('op-banco-wrap');
    if (bancoWrap) bancoWrap.classList.remove('visible');
    setVal('op-monto-recibido', '');
    setVal('op-mixto-efectivo', '');
    setVal('op-mixto-transferencia', '');
    setVal('op-titular-transf', '');
    setVal('op-buscar-prod', '');
    setVal('op-sincargo-detalle', '');
    const motivoScEl = document.getElementById('op-sincargo-motivo');
    if (motivoScEl) motivoScEl.selectedIndex = 0;
    mixtoUltimoEditado = 'efectivo';
    actualizarVisibilidadCobroRapido();
    setVal('op-subtotal', '0');
    setVal('op-no-gravada', '0');
    setVal('op-glosa', operacionMesaActual ? `Mesa ${operacionMesaActual}` : '');
    const cuentasBody = document.getElementById('op-cuentas-body');
    if (cuentasBody) cuentasBody.innerHTML = '<tr class="op-empty-rows"><td colspan="5">Agregá al menos un producto</td></tr>';
    const codigoEl = document.getElementById('op-codigo');
    if (codigoEl) codigoEl.textContent = 'FAC-????';
    clearMsg();

    const guardarBtnInit = document.getElementById('op-guardar');
    if (guardarBtnInit) {
      guardarBtnInit.disabled = false;
      guardarBtnInit.textContent = 'Guardar';
    }

    cargarClientes().then(clientesData => {
      clientes = clientesData;
      if (clienteCombobox) {
        clienteCombobox.setOptions(conConsumidorFinal(clientesData));
        clienteCombobox.clear();
      }
    });

    opItems = [];
    clienteSeleccionado = null;
    rowSeq = 0;

    overlay.classList.add('open');
    // Cursor listo en Cliente (se despliega la lista para elegir rápido)
    setTimeout(() => {
      const clienteFoco = document.getElementById('op-cliente');
      if (clienteFoco) clienteFoco.focus();
    }, 80);

    const metodoEl = document.getElementById('op-metodo-pago');
    if (metodoEl && metodoEl.value === 'Transferencia' && bancoWrap) {
      bancoWrap.classList.add('visible');
    }

    cargarProductos().then(productosData => {
      productos = productosData;

      if (itemsPrecargados && itemsPrecargados.length > 0) {
        itemsPrecargados.forEach(item => {
          agregarFilaProducto({
            productoId: item.productoId,
            producto: item.producto,
            cantidad: item.cantidad,
            precio: item.precio
          });
        });
      } else {
        recalcularTotalesProductos();
      }
    });
  }

  /**
   * Abre el mismo modal de "Nueva Operación", pero precargado con los
   * datos de una factura ya existente y en modo edición: al guardar,
   * guardarOperacion() actualiza esa factura en Firestore en vez de
   * crear una nueva. Esto es lo que dispara el ícono de lápiz (editar)
   * en la tabla de facturas.
   */
  function abrirModalEditarOperacion(id) {
    const factura = facturas.find(f => f.id === id);
    if (!factura) { alert('No se encontró la factura.'); return; }

    const overlay = document.getElementById('op-overlay');
    if (!overlay) {
      console.error('❌ No se encontró el modal de edición (#op-overlay) en esta página.');
      return;
    }

    facturaEditandoId = id;
    operacionMesaActual = factura.mesa || null;
    const monedaFactura = factura.moneda || 'Gs';

    const tituloEl = document.getElementById('op-modal-title');
    if (tituloEl) tituloEl.textContent = `Editar factura ${factura.codigo || ''}`.trim();
    const eyebrowEl = document.getElementById('op-modal-eyebrow');
    if (eyebrowEl) eyebrowEl.textContent = 'Edición';

    const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };

    setVal('op-periodo', factura.periodo || (factura.fecEmision || hoy()).slice(0, 7));
    const tipoOperEl = document.getElementById('op-tipo-oper');
    if (tipoOperEl) tipoOperEl.value = factura.tipoOper || 'VENTA_MERCADERIAS';
    setVal('op-cliente', factura.cliente?.name || '');
    setVal('op-cliente-ci', factura.cliente?.ci || '');
    const tipoDocEl = document.getElementById('op-tipo-doc');
    if (tipoDocEl) tipoDocEl.value = factura.tipoDoc || 'FACTURA';
    setVal('op-timbrado', factura.timbrado || '');
    setVal('op-numero-doc', factura.numeroDoc || '');
    setVal('op-moneda', monedaFactura);
    setVal('op-fec-emision', factura.fecEmision || hoy());
    setVal('op-fec-vcto', factura.fecVcto || hoy());
    setVal('op-metodo-pago', factura.metodoPago || 'Efectivo');
    setVal('op-banco', factura.banco || '');
    setVal('op-titular-transf', factura.titularTransferencia || '');
    setVal('op-estado', factura.estado || 'Pagada');

    // NUEVO: precargar campos de preparación fiscal si la factura ya los tiene
    const condVentaEl = document.getElementById('op-condicion-venta');
    if (condVentaEl) condVentaEl.value = factura.condicionVenta || 'CONTADO';
    const tipoContribEl = document.getElementById('op-tipo-contribuyente');
    if (tipoContribEl) tipoContribEl.value = factura.tipoContribuyente || 'FISICA';
    setVal('op-gravado-5', convertirDeGs(factura.ivaGravado5 || 0, monedaFactura).toFixed(2));
    setVal('op-exento', convertirDeGs(factura.ivaExento || 0, monedaFactura).toFixed(2));
    setVal('op-cdc', factura.cdc || '');
    const estadoSifenEl = document.getElementById('op-estado-sifen');
    if (estadoSifenEl) estadoSifenEl.value = factura.estadoSifen || 'no_enviada';

    const bancoWrap = document.getElementById('op-banco-wrap');
    if (bancoWrap) {
      if (factura.metodoPago === 'Transferencia' || factura.metodoPago === METODO_MIXTO) bancoWrap.classList.add('visible');
      else bancoWrap.classList.remove('visible');
    }

    setVal('op-monto-recibido', '');
    if (factura.metodoPago === METODO_MIXTO) {
      setVal('op-mixto-efectivo', fmtMoneda(convertirDeGs(factura.montoEfectivo || 0, monedaFactura), monedaFactura));
      setVal('op-mixto-transferencia', fmtMoneda(convertirDeGs(factura.montoTransferencia || 0, monedaFactura), monedaFactura));
    } else {
      setVal('op-mixto-efectivo', '');
      setVal('op-mixto-transferencia', '');
    }
    mixtoUltimoEditado = 'efectivo';
    actualizarVisibilidadCobroRapido();

    // noGravada se guarda siempre en Gs; hay que re-mostrarlo en la moneda
    // original de la factura, igual que como se habría tipeado.
    setVal('op-no-gravada', convertirDeGs(factura.noGravada || 0, monedaFactura).toFixed(2));
    setVal('op-glosa', factura.glosa || '');

    const cuentasBody = document.getElementById('op-cuentas-body');
    if (cuentasBody) cuentasBody.innerHTML = '<tr class="op-empty-rows"><td colspan="5">Agregá al menos un producto</td></tr>';

    const codigoEl = document.getElementById('op-codigo');
    if (codigoEl) codigoEl.textContent = factura.codigo || 'FAC-????';

    clearMsg();

    const guardarBtnInit = document.getElementById('op-guardar');
    if (guardarBtnInit) {
      guardarBtnInit.disabled = false;
      guardarBtnInit.textContent = 'Guardar cambios';
    }

    opItems = [];
    rowSeq = 0;
    clienteSeleccionado = factura.cliente ? {
      id: factura.cliente.id || '',
      name: factura.cliente.name || '',
      phone: factura.cliente.phone || '',
      email: factura.cliente.email || '',
      ci: factura.cliente.ci || ''
    } : null;

    overlay.classList.add('open');

    cargarClientes().then(clientesData => {
      clientes = clientesData;
      if (clienteCombobox) {
        clienteCombobox.setOptions(conConsumidorFinal(clientesData));
      }
    });

    // Traemos los productos vigentes (para el selector de cada fila) y
    // recreamos una fila por cada ítem que ya tenía la factura, con su
    // cantidad y precio originales.
    cargarProductos().then(productosData => {
      productos = productosData;
      (factura.items || []).forEach(item => {
        agregarFilaProducto({
          productoId: item.productoId,
          producto: item.producto,
          cantidad: item.cantidad,
          precio: item.precio
        });
      });
      recalcularTotalesProductos();
    });
  }

  function cerrarModalNuevaOperacion() {
    const overlay = document.getElementById('op-overlay');
    if (overlay) overlay.classList.remove('open');
    facturaEditandoId = null;
  }

  // ---------- Filas de productos ----------
  function agregarFilaProducto(data) {
    const tbody = document.getElementById('op-cuentas-body');
    if (!tbody) return;
    const emptyRow = tbody.querySelector('.op-empty-rows');
    if (emptyRow) emptyRow.remove();

    rowSeq += 1;
    const rid = 'row-' + rowSeq;

    const tr = document.createElement('tr');
    tr.id = rid;
    tr.innerHTML = `
      <td class="op-producto-col">
        <select class="producto-select"><option value="">Seleccioná…</option></select>
      </td>
      <td>
        <input type="number" class="cantidad" min="1" step="1" value="${data?.cantidad || 1}">
      </td>
      <td>
        <input type="number" class="precio" min="0" step="0.01" value="${data?.precio ?? ''}">
      </td>
      <td>
        <input type="text" class="subtotal-linea" value="0" readonly>
      </td>
      <td>
        <button type="button" class="op-row-remove" title="Quitar producto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    const select = tr.querySelector('.producto-select');
    select.innerHTML = '<option value="">Seleccioná…</option>' +
      productos.map(p => `<option value="${p.id}">${p.name || p.nombre || 'Producto sin nombre'}</option>`).join('');

    if (data?.productoId) {
      const yaExiste = select.querySelector(`option[value="${CSS.escape(data.productoId)}"]`);
      if (!yaExiste && data.producto) {
        const opt = document.createElement('option');
        opt.value = data.productoId;
        opt.textContent = data.producto + ' (no está en el catálogo)';
        opt.dataset.externo = '1';
        select.appendChild(opt);
      }
      select.value = data.productoId;
    }

    tr.querySelector('.producto-select').addEventListener('change', (e) => {
      autocompletarPrecio(tr, e.target.value);
    });
    tr.querySelector('.cantidad').addEventListener('input', () => recalcularLinea(tr));
    tr.querySelector('.precio').addEventListener('input', () => recalcularLinea(tr));
    tr.querySelector('.op-row-remove').addEventListener('click', () => {
      tr.remove();
      if (!tbody.querySelector('tr')) {
        tbody.innerHTML = '<tr class="op-empty-rows"><td colspan="5">Agregá al menos un producto</td></tr>';
      }
      recalcularTotalesProductos();
    });

    recalcularLinea(tr);
  }

  function autocompletarPrecio(tr, productoId) {
    const match = productos.find((p) => p.id === productoId);
    const monedaEl = document.getElementById('op-moneda');
    if (match && monedaEl) {
      const precioUSD = Number(match.price ?? match.precio ?? 0);
      const monedaActual = monedaEl.value;
      const precioConvertido = precioUSD * (rates[monedaActual] || 1);
      tr.querySelector('.precio').value = precioConvertido
        ? Number(precioConvertido.toFixed(2))
        : '';
    }
    recalcularLinea(tr);
  }

  function recalcularLinea(tr) {
    const cantidad = Number(tr.querySelector('.cantidad').value) || 0;
    const precio = Number(tr.querySelector('.precio').value) || 0;
    const monedaEl = document.getElementById('op-moneda');
    const monedaActual = monedaEl ? monedaEl.value : 'Gs';
    tr.querySelector('.subtotal-linea').value = fmtMoneda(cantidad * precio, monedaActual);
    recalcularTotalesProductos();
  }

  function recalcularTotalesProductos() {
    let items = 0;
    let total = 0;
    document.querySelectorAll('#op-cuentas-body tr:not(.op-empty-rows)').forEach((tr) => {
      const cantidad = Number(tr.querySelector('.cantidad')?.value) || 0;
      const precio = Number(tr.querySelector('.precio')?.value) || 0;
      if (cantidad > 0 && precio > 0) {
        items += 1;
        total += cantidad * precio;
      }
    });

    const monedaEl = document.getElementById('op-moneda');
    const monedaActual = monedaEl ? monedaEl.value : 'Gs';
    const totItemsEl = document.getElementById('op-tot-items');
    if (totItemsEl) totItemsEl.textContent = String(items);
    const totProductosEl = document.getElementById('op-tot-productos');
    if (totProductosEl) totProductosEl.textContent = fmtMoneda(total, monedaActual);

    const subtotalEl = document.getElementById('op-subtotal');
    if (subtotalEl) subtotalEl.value = total.toFixed(2);

    // NUEVO: gravado 10% autocalculado — asume que el precio cargado ya
    // incluye IVA 10%, salvo la parte que se haya marcado manualmente
    // como "Gravado 5%" o "Exento". Es un criterio simple pensado como
    // punto de partida; ajustalo si tu negocio maneja tasas mixtas por
    // producto en vez de por factura completa.
    const gravado5El = document.getElementById('op-gravado-5');
    const exentoEl = document.getElementById('op-exento');
    const gravado10El = document.getElementById('op-gravado-10');
    if (gravado10El) {
      const gravado5 = gravado5El ? Number(gravado5El.value) || 0 : 0;
      const exento = exentoEl ? Number(exentoEl.value) || 0 : 0;
      const baseGravable10 = Math.max(0, total - gravado5 - exento);
      gravado10El.value = baseGravable10.toFixed(2);
    }

    recalcularTotalCabecera();
  }

  function recalcularTotalCabecera() {
    const subtotalEl = document.getElementById('op-subtotal');
    const noGravadaEl = document.getElementById('op-no-gravada');
    const monedaEl = document.getElementById('op-moneda');
    const totalEl = document.getElementById('op-total');
    if (!subtotalEl || !noGravadaEl || !monedaEl || !totalEl) return;
    const sub = Number(subtotalEl.value) || 0;
    const noGrav = Number(noGravadaEl.value) || 0;
    const monedaActual = monedaEl.value;
    totalEl.value = fmtMoneda(sub + noGrav, monedaActual);
    completarMixto();
    recalcularVuelto();
  }

  // Separador de miles en vivo para "Monto recibido" (mismo criterio que
  // en Menú: mientras se tipea, ya se ve agrupado — "50.000" en vez de
  // "50000"). Solo dígitos; no hace falta cargar decimales para efectivo.
  function attachLiveThousandsFormat(input) {
    if (!input || input.dataset.liveThousandsAttached) return;
    input.dataset.liveThousandsAttached = "1";
    input.addEventListener('input', function () {
      const cursorAtEnd = this.selectionStart === this.value.length;
      const digits = this.value.replace(/[^\d]/g, '');
      this.value = digits ? Number(digits).toLocaleString('es-PY') : '';
      if (cursorAtEnd) this.selectionStart = this.selectionEnd = this.value.length;
      recalcularVuelto();
    });
  }

  // "COBRO RÁPIDO": recalcula el vuelto (monto recibido - total) cada vez
  // que cambia el total o lo que se tipeó en "Monto recibido". Solo tiene
  // sentido con pago en Efectivo — con otros métodos el bloque se oculta.
  function recalcularVuelto() {
    const totalEl = document.getElementById('op-total');
    const recibidoEl = document.getElementById('op-monto-recibido');
    const vueltoEl = document.getElementById('op-vuelto-display');
    const monedaEl = document.getElementById('op-moneda');
    if (!totalEl || !recibidoEl || !vueltoEl || !monedaEl) return;

    const monedaActual = monedaEl.value;
    const metodoVueltoEl = document.getElementById('op-metodo-pago');
    const totalNumerico = (metodoVueltoEl && metodoVueltoEl.value === METODO_MIXTO)
      ? leerMontoMixto('efectivo')
      : (Number(String(totalEl.value || '0').replace(/\./g, '').replace(',', '.')) || 0);
    const recibidoDigitos = recibidoEl.value.replace(/[^\d]/g, '');
    const recibido = recibidoDigitos ? Number(recibidoDigitos) : 0;
    const vuelto = recibido - totalNumerico;

    vueltoEl.textContent = fmtMoneda(Math.abs(vuelto), monedaActual);
    vueltoEl.classList.toggle('negativo', vuelto < 0);
    if (vuelto < 0) vueltoEl.textContent = '- ' + vueltoEl.textContent;
  }

  function actualizarVisibilidadCobroRapido() {
    const metodoEl = document.getElementById('op-metodo-pago');
    const cobroRapido = document.getElementById('op-cobro-rapido');
    if (!metodoEl || !cobroRapido) return;
    const esMixto = metodoEl.value === METODO_MIXTO;
    const esSinCargo = metodoEl.value === METODO_SIN_CARGO;
    const sinCargoWrap = document.getElementById('op-sincargo-wrap');
    if (sinCargoWrap) sinCargoWrap.classList.toggle('visible', esSinCargo);
    const estadoOp = document.getElementById('op-estado');
    if (estadoOp) estadoOp.disabled = esSinCargo;
    // Con pago mixto también hay efectivo, así que el "cobro rápido"
    // sigue visible (el vuelto se calcula solo sobre la parte en efectivo).
    cobroRapido.classList.toggle('visible', metodoEl.value === 'Efectivo' || esMixto);
    const labelRecibido = document.querySelector('label[for="op-monto-recibido"]');
    if (labelRecibido) labelRecibido.textContent = esMixto ? 'Efectivo recibido' : 'Monto recibido';

    const mixtoWrap = document.getElementById('op-mixto-wrap');
    if (mixtoWrap) mixtoWrap.classList.toggle('visible', esMixto);
    const bancoWrap = document.getElementById('op-banco-wrap');
    if (bancoWrap) bancoWrap.classList.toggle('visible', metodoEl.value === 'Transferencia' || esMixto);
    if (esMixto) completarMixto();
    // El vuelto se recalcula al cambiar de método (con Mixto, sobre la parte en efectivo)
    recalcularVuelto();
  }

  /* ============================================================
     PAGO MIXTO (Efectivo + Transferencia en la misma venta)
     ------------------------------------------------------------
     La opción "Mixto" y sus campos se agregan desde acá (no hace
     falta tocar el HTML), así funciona igual en facturacion.html y
     en menu.html ("Registrar compra"). Se carga cuánto va en
     efectivo y el resto se completa solo como transferencia (o al
     revés). Se guarda en la factura:
       metodoPago: "Mixto", montoEfectivo, montoTransferencia (en Gs)
       pagos: [{ metodo:"Efectivo", monto }, { metodo:"Transferencia", monto, banco }]
     Además, TODAS las facturas nuevas guardan montoEfectivo y
     montoTransferencia, así Caja puede sumar cada parte en su caja.
     ============================================================ */
  const METODO_MIXTO = 'Mixto';
  // "Sin cargo": consumo de empleados, cortesías o desperdicio. Se
  // registra qué salió (con sus precios, como referencia), pero la factura
  // queda con total 0 y estado "Sin cargo": no suma en la caja, ni en
  // "Ingresos de hoy", ni en ningún reporte que sume totales.
  const METODO_SIN_CARGO = 'Sin cargo';
  let mixtoUltimoEditado = 'efectivo';

  function prepararPagoMixto() {
    if (!document.getElementById('op-mixto-style')) {
      const style = document.createElement('style');
      style.id = 'op-mixto-style';
      style.textContent = `
        .op-mixto-wrap{display:none;border:2px dashed #93c5fd;background:#f8fbff;
          border-radius:10px;padding:12px 14px;margin:0 0 14px;}
        .op-mixto-wrap.visible{display:block;}
        .op-mixto-titulo{font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:10px;}
        .op-mixto-estado{font-size:13px;font-weight:600;min-height:18px;}
        .op-mixto-estado.ok{color:#15803d;}
        .op-mixto-estado.error{color:#b3261e;}
        .op-sincargo-wrap{display:none;border:2px dashed #fdba74;background:#fff7ed;
          border-radius:10px;padding:10px 12px;margin:0 0 10px;}
        .op-sincargo-wrap.visible{display:block;}
        .op-sincargo-titulo{font-size:13px;font-weight:700;color:#9a3412;margin-bottom:8px;}
        #op-banco-wrap:not(.visible), #edit-banco-wrap:not(.visible){display:none !important;}
        #op-banco-wrap.visible, #edit-banco-wrap.visible{display:block !important;}
      `;
      document.head.appendChild(style);
    }

    ['op-metodo-pago', 'edit-metodo-pago'].forEach(id => {
      const select = document.getElementById(id);
      if (select && !select.querySelector('option[value="' + METODO_MIXTO + '"]')) {
        select.insertAdjacentHTML('beforeend', '<option value="' + METODO_MIXTO + '">Mixto (Efectivo + Transferencia)</option>');
      }
      if (select && !select.querySelector('option[value="' + METODO_SIN_CARGO + '"]')) {
        select.insertAdjacentHTML('beforeend', '<option value="' + METODO_SIN_CARGO + '">Sin cargo (no se cobra)</option>');
      }
    });
    // El estado "Sin cargo" tiene que existir en la edición rápida para poder mostrarlo
    const editEstado = document.getElementById('edit-estado');
    if (editEstado && !editEstado.querySelector('option[value="Sin cargo"]')) {
      editEstado.insertAdjacentHTML('beforeend', '<option value="Sin cargo">Sin cargo</option>');
    }

    const bancoWrapSc = document.getElementById('op-banco-wrap');
    if (bancoWrapSc && !document.getElementById('op-sincargo-wrap')) {
      bancoWrapSc.insertAdjacentHTML('beforebegin', `
        <div class="op-sincargo-wrap" id="op-sincargo-wrap">
          <div class="op-sincargo-titulo">Se registra lo que salió, pero no se cobra ni entra en la caja.</div>
          <div class="op-grid cols-2" style="margin-bottom:0;">
            <div class="op-field">
              <label for="op-sincargo-motivo">Motivo</label>
              <select id="op-sincargo-motivo">
                <option value="Consumo de empleados">Consumo de empleados</option>
                <option value="Cortesía a cliente">Cortesía a cliente</option>
                <option value="Desperdicio / error">Desperdicio / error</option>
              </select>
            </div>
            <div class="op-field">
              <label for="op-sincargo-detalle">Detalle (opcional)</label>
              <input type="text" id="op-sincargo-detalle" placeholder="Ej.: almuerzo de Juan" autocomplete="off">
            </div>
          </div>
        </div>`);
    }

    // Nombre de la persona que hizo la transferencia (debajo de Banco / N.º de comprobante)
    [['op-banco-wrap', 'op-titular-transf'], ['edit-banco-wrap', 'edit-titular-transf']].forEach(([wrapId, inputId]) => {
      const wrap = document.getElementById(wrapId);
      if (wrap && !document.getElementById(inputId)) {
        wrap.insertAdjacentHTML('beforeend', `
          <div class="op-field" style="margin:14px 0;">
            <label for="${inputId}">Nombre de quien transfirió</label>
            <input type="text" id="${inputId}" placeholder="Ej.: Juan Pérez" autocomplete="off">
          </div>`);
      }
    });

    const bancoWrap = document.getElementById('op-banco-wrap');
    if (bancoWrap && !document.getElementById('op-mixto-wrap')) {
      bancoWrap.insertAdjacentHTML('beforebegin', `
        <div class="op-mixto-wrap" id="op-mixto-wrap">
          <div class="op-mixto-titulo">¿Cuánto paga con cada medio?</div>
          <div class="op-grid cols-2" style="margin-bottom:6px;">
            <div class="op-field">
              <label for="op-mixto-efectivo">En efectivo</label>
              <input type="text" id="op-mixto-efectivo" inputmode="decimal" placeholder="0">
            </div>
            <div class="op-field">
              <label for="op-mixto-transferencia">Por transferencia</label>
              <input type="text" id="op-mixto-transferencia" inputmode="decimal" placeholder="0">
            </div>
          </div>
          <div class="op-mixto-estado" id="op-mixto-estado"></div>
        </div>`);

      ['efectivo', 'transferencia'].forEach(parte => {
        const input = document.getElementById('op-mixto-' + parte);
        input.addEventListener('input', function () {
          // En guaraníes se muestra con separador de miles mientras se escribe
          if (monedaOperacionActual() === 'Gs') {
            const digitos = this.value.replace(/[^\d]/g, '');
            this.value = digitos ? Number(digitos).toLocaleString('es-PY') : '';
          }
          mixtoUltimoEditado = parte;
          completarMixto();
          recalcularVuelto();
        });
      });
    }
  }

  /* ============================================================
     PANTALLA DE COBRO COMPACTA (sin scroll en computadora)
     ------------------------------------------------------------
     No se saca ningún campo: solo se reacomodan.
       • Cliente y CI/RUC en la misma fila.
       • "Monto recibido / Vuelto" pasa a la columna derecha, debajo
         del total (antes ocupaba todo el ancho con números enormes).
       • Menos espacios, encabezado y pie más bajos.
     En pantallas chicas (celular) queda en una sola columna, como antes.
     ============================================================ */
  function compactarModalOperacion() {
    const overlay = document.getElementById('op-overlay');
    if (!overlay || overlay.dataset.compacto) return;
    overlay.dataset.compacto = '1';

    if (!document.getElementById('op-compacto-style')) {
      const style = document.createElement('style');
      style.id = 'op-compacto-style';
      style.textContent = `
        #op-overlay .op-head h3, #op-modal-title { color: #fff !important; }
        /* Barra superior en el mismo celeste del menú lateral */
        #op-overlay .op-head { background: #0369a1 !important; }
        #op-overlay .op-head .eyebrow { color: rgba(255,255,255,.8) !important; }
        #op-overlay .op-close { background: rgba(255,255,255,.15) !important; color: #fff !important; border-color: transparent !important; }
        /* "Datos fiscales (opcional)" no se usa: se oculta. Sus campos
           siguen existiendo con sus valores por defecto, así las ventas
           se guardan igual que siempre. */
        #op-overlay .op-avanzado { display: none !important; }

        /* Buscador rápido de productos */
        .op-buscador { position: relative; margin: 0 0 10px; }
        .op-buscador input {
          width: 100%; box-sizing: border-box; padding: 9px 12px 9px 36px;
          border: 2px solid #c7d2fe; border-radius: 8px; font-size: 14px; background: #fff;
        }
        .op-buscador input:focus { outline: none; border-color: #3557ff; box-shadow: 0 0 0 3px rgba(53,87,255,.15); }
        .op-buscador svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
          width: 17px; height: 17px; color: #6b7280; pointer-events: none; }
        .op-buscador-lista { display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 30;
          background: #fff; border: 1px solid #dde1e8; border-radius: 8px; max-height: 260px; overflow-y: auto;
          box-shadow: 0 12px 24px -12px rgba(0,0,0,.25); }
        .op-buscador-lista.show { display: block; }
        .op-buscador-item { display: flex; justify-content: space-between; gap: 12px; padding: 9px 12px;
          cursor: pointer; font-size: 14px; border-bottom: 1px solid #f2f3f6; }
        .op-buscador-item:last-child { border-bottom: none; }
        .op-buscador-item.activo, .op-buscador-item:hover { background: #eef2ff; }
        .op-buscador-item small { color: #3557ff; font-weight: 700; white-space: nowrap; }
        .op-buscador-vacio { padding: 9px 12px; color: #9aa2b1; font-size: 13px; }
        @media (min-width: 901px) {
          #op-overlay .op-head { padding-top: 10px !important; padding-bottom: 10px !important; }
          #op-overlay .op-head h3 { font-size: 18px !important; margin: 2px 0 0 !important; }
          #op-overlay .op-body { max-width: 1280px !important; padding-top: 14px !important; padding-bottom: 12px !important; }
          #op-overlay .op-columns { grid-template-columns: minmax(380px, 440px) 1fr !important; gap: 24px !important; }
          #op-overlay .op-grid { gap: 10px !important; margin-bottom: 10px !important; }
          #op-overlay .op-grid-cliente { grid-template-columns: 1.5fr 1fr !important; }
          #op-overlay .op-field { gap: 4px !important; }
          #op-overlay .op-field input, #op-overlay .op-field select, #op-overlay .op-combobox input {
            padding-top: 7px !important; padding-bottom: 7px !important;
          }
          #op-overlay .op-section-label { margin: 0 0 8px !important; }
          #op-overlay .op-cuentas-wrap { margin-bottom: 10px !important; max-height: 240px; overflow-y: auto; }
          #op-overlay table.op-cuentas tbody td { padding: 5px 8px !important; }
          #op-overlay .op-mixto-wrap { padding: 10px 12px; margin-bottom: 10px; }
          #op-overlay .op-avanzado { margin: 10px 0 0 !important; }
          #op-overlay .op-foot { padding-top: 10px !important; padding-bottom: 10px !important; }

          /* Monto recibido / Vuelto, dentro de la columna derecha */
          #op-overlay .op-col-right .op-cobro-rapido {
            margin: 14px 0 0 !important; padding: 14px 18px !important;
            gap: 18px !important; border-radius: 12px !important;
          }
          #op-overlay .op-col-right .op-cobro-campo { gap: 6px !important; }
          #op-overlay .op-col-right .op-cobro-campo label { font-size: 13px !important; }
          #op-overlay .op-col-right .op-cobro-input {
            padding: 10px 14px !important; font-size: 30px !important; border-width: 2px !important;
          }
          #op-overlay .op-col-right .op-cobro-vuelto { font-size: 34px !important; padding: 6px 0 !important; }
        }
      `;
      document.head.appendChild(style);
    }

    // Cliente y CI/RUC en la misma fila
    const clienteInput = document.getElementById('op-cliente');
    const ciInput = document.getElementById('op-cliente-ci');
    if (clienteInput && ciInput) {
      const campoCliente = clienteInput.closest('.op-field');
      const campoCi = ciInput.closest('.op-field');
      const filaCliente = campoCliente && campoCliente.parentElement;
      const filaCi = campoCi && campoCi.parentElement;
      if (filaCliente && filaCi && filaCliente !== filaCi) {
        filaCliente.appendChild(campoCi);
        campoCliente.classList.remove('span-2');
        campoCi.classList.remove('span-2');
        filaCliente.classList.add('op-grid-cliente');
        if (!filaCi.children.length) filaCi.remove();
      }
    }

    prepararBuscadorProductos(overlay);

    // "Monto recibido / Vuelto" a la columna derecha
    const cobro = document.getElementById('op-cobro-rapido');
    const columnaDerecha = overlay.querySelector('.op-col-right');
    if (cobro && columnaDerecha) columnaDerecha.appendChild(cobro);
  }

  /* ============================================================
     BUSCADOR RÁPIDO DE PRODUCTOS
     ------------------------------------------------------------
     Se escribe parte del nombre, se elige con las flechas ↑ ↓ y se
     agrega con Enter (o tocándolo). Si el producto ya está en la
     tabla, suma 1 a la cantidad en vez de repetir la fila. El
     selector de cada fila sigue funcionando igual que antes.
     ============================================================ */
  let buscadorResultados = [];
  let buscadorActivo = 0;

  function normalizarTexto(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function precioProductoEnMoneda(p) {
    const precioUSD = Number(p.price ?? p.precio ?? 0);
    const precio = precioUSD * (rates[monedaOperacionActual()] || 1);
    return precio ? Number(precio.toFixed(2)) : 0;
  }

  function prepararBuscadorProductos(overlay) {
    if (document.getElementById('op-buscar-prod')) return;
    const encabezado = overlay.querySelector('.op-col-right .op-section-label');
    if (!encabezado) return;
    encabezado.insertAdjacentHTML('afterend', `
      <div class="op-buscador">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input type="text" id="op-buscar-prod" placeholder="Buscar producto… (Enter para agregar)" autocomplete="off">
        <div class="op-buscador-lista" id="op-buscar-lista"></div>
      </div>`);

    const input = document.getElementById('op-buscar-prod');
    const lista = document.getElementById('op-buscar-lista');

    function pintarLista() {
      const q = normalizarTexto(input.value.trim());
      if (!q) { lista.classList.remove('show'); buscadorResultados = []; return; }
      buscadorResultados = productos
        .filter(p => normalizarTexto(p.name || p.nombre).includes(q))
        .sort((a, b) => {
          // Primero los que empiezan con lo escrito
          const ea = normalizarTexto(a.name || a.nombre).startsWith(q) ? 0 : 1;
          const eb = normalizarTexto(b.name || b.nombre).startsWith(q) ? 0 : 1;
          return ea - eb || String(a.name || a.nombre).localeCompare(String(b.name || b.nombre), 'es');
        })
        .slice(0, 8);
      if (buscadorActivo >= buscadorResultados.length) buscadorActivo = 0;
      const m = monedaOperacionActual();
      const sim = symbols[m] || '';
      lista.innerHTML = buscadorResultados.length
        ? buscadorResultados.map((p, i) => `
            <div class="op-buscador-item${i === buscadorActivo ? ' activo' : ''}" data-i="${i}">
              <span>${p.name || p.nombre || 'Producto'}</span>
              <small>${sim}${fmtMoneda(precioProductoEnMoneda(p), m)}</small>
            </div>`).join('')
        : `<div class="op-buscador-vacio">No hay productos con "${input.value.trim()}"</div>`;
      lista.classList.add('show');
    }

    function elegir(i) {
      const p = buscadorResultados[i];
      if (!p) return;
      agregarProductoRapido(p);
      input.value = '';
      buscadorActivo = 0;
      lista.classList.remove('show');
      input.focus();
    }

    input.addEventListener('input', () => { buscadorActivo = 0; pintarLista(); });
    input.addEventListener('focus', pintarLista);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && buscadorResultados.length) {
        e.preventDefault(); buscadorActivo = (buscadorActivo + 1) % buscadorResultados.length; pintarLista();
      } else if (e.key === 'ArrowUp' && buscadorResultados.length) {
        e.preventDefault(); buscadorActivo = (buscadorActivo - 1 + buscadorResultados.length) % buscadorResultados.length; pintarLista();
      } else if (e.key === 'Enter') {
        e.preventDefault(); elegir(buscadorActivo);
      } else if (e.key === 'Escape') {
        e.stopPropagation(); lista.classList.remove('show');
      }
    });
    lista.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.op-buscador-item');
      if (item) { e.preventDefault(); elegir(Number(item.dataset.i)); }
    });
    input.addEventListener('blur', () => setTimeout(() => lista.classList.remove('show'), 150));
  }

  function agregarProductoRapido(p) {
    // Si ya está en la tabla, sumamos 1 a la cantidad
    const filas = document.querySelectorAll('#op-cuentas-body tr:not(.op-empty-rows)');
    for (const tr of filas) {
      const select = tr.querySelector('.producto-select');
      if (select && select.value === p.id) {
        const cant = tr.querySelector('.cantidad');
        cant.value = (Number(cant.value) || 0) + 1;
        recalcularLinea(tr);
        return;
      }
    }
    agregarFilaProducto({
      productoId: p.id,
      producto: p.name || p.nombre || 'Producto',
      cantidad: 1,
      precio: precioProductoEnMoneda(p)
    });
  }

  function monedaOperacionActual() {
    const monedaEl = document.getElementById('op-moneda');
    return monedaEl ? monedaEl.value : 'Gs';
  }

  function totalOperacionActual() {
    const totalEl = document.getElementById('op-total');
    if (!totalEl) return 0;
    return Number(String(totalEl.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
  }

  function leerMontoMixto(parte) {
    const el = document.getElementById('op-mixto-' + parte);
    return el ? parseNumero(el.value) : 0;
  }

  function escribirMontoMixto(parte, valor) {
    const el = document.getElementById('op-mixto-' + parte);
    if (el) el.value = valor > 0 ? fmtMoneda(valor, monedaOperacionActual()) : '';
  }

  // Completa la otra parte con lo que falta para llegar al total
  function completarMixto() {
    const metodoEl = document.getElementById('op-metodo-pago');
    if (!metodoEl || metodoEl.value !== METODO_MIXTO) return;
    const total = totalOperacionActual();
    const otra = mixtoUltimoEditado === 'efectivo' ? 'transferencia' : 'efectivo';
    const editado = Math.min(leerMontoMixto(mixtoUltimoEditado), total);
    escribirMontoMixto(otra, Math.max(0, total - editado));
    actualizarEstadoMixto();
  }

  function toleranciaMoneda(m) {
    return m === 'Gs' ? 1 : 0.01;
  }

  function actualizarEstadoMixto() {
    const estadoEl = document.getElementById('op-mixto-estado');
    if (!estadoEl) return;
    const m = monedaOperacionActual();
    const total = totalOperacionActual();
    const suma = leerMontoMixto('efectivo') + leerMontoMixto('transferencia');
    const diferencia = total - suma;
    const simbolo = symbols[m] || '';
    if (Math.abs(diferencia) <= toleranciaMoneda(m)) {
      estadoEl.textContent = `✔ Suma ${simbolo}${fmtMoneda(suma, m)}, igual al total.`;
      estadoEl.className = 'op-mixto-estado ok';
    } else if (diferencia > 0) {
      estadoEl.textContent = `Faltan ${simbolo}${fmtMoneda(diferencia, m)} para llegar al total.`;
      estadoEl.className = 'op-mixto-estado error';
    } else {
      estadoEl.textContent = `Se pasa por ${simbolo}${fmtMoneda(-diferencia, m)} del total.`;
      estadoEl.className = 'op-mixto-estado error';
    }
  }

  // Texto del método de pago para el detalle, el ticket y la factura
  function textoMetodoPago(factura) {
    const metodo = factura.metodoPago || factura.metodo || '—';
    if (metodo === METODO_SIN_CARGO) {
      const valor = factura.valorReferencia ? ` · valor ${formatearPrecioEnMoneda(factura.valorReferencia, factura.moneda || 'Gs')}` : '';
      return `Sin cargo (${factura.motivoSinCargo || 'sin motivo'}${factura.detalleSinCargo ? ': ' + factura.detalleSinCargo : ''})${valor}`;
    }
    if (metodo !== METODO_MIXTO) return metodo;
    const m = factura.moneda || 'Gs';
    return `Mixto (Efectivo ${formatearPrecioEnMoneda(factura.montoEfectivo || 0, m)} + ` +
      `Transferencia ${formatearPrecioEnMoneda(factura.montoTransferencia || 0, m)})`;
  }

  // Cuánto de cada factura corresponde a cada caja (todo en Gs)
  function montosPorCaja(metodoPago, totalGs, efectivoMixtoGs) {
    if (metodoPago === METODO_SIN_CARGO) return { montoEfectivo: 0, montoTransferencia: 0 };
    if (metodoPago === METODO_MIXTO) {
      const ef = Math.min(Math.max(0, efectivoMixtoGs || 0), totalGs);
      return { montoEfectivo: ef, montoTransferencia: totalGs - ef };
    }
    if (metodoPago === 'Efectivo') return { montoEfectivo: totalGs, montoTransferencia: 0 };
    return { montoEfectivo: 0, montoTransferencia: totalGs };
  }

  /* ============================================================
     PEDIDO A PARTIR DE UNA VENTA DEL MENÚ
     ------------------------------------------------------------
     "Registrar compra" en el Menú (incluido "Cargar pedido" desde
     Mesas) crea la factura y, además, su pedido en la colección
     "pedidos" con el mismo formato que usa Pedidos (customer, items,
     deliveryType, status...). Queda como Pendiente para cocina; se
     marca Entregado con el ✓ en Pedidos.
     ============================================================ */
  async function crearPedidoDesdeVenta(factura, facturaId) {
    try {
      const numeroFactura = String(factura.codigo || '').replace(/^FAC-/, '');
      const mesa = String(factura.mesa || '').trim();
      const numeroMesa = mesa.replace(/^mesa\s*/i, '').trim();
      const desdeFacturacion = !!document.getElementById('facturas-body');
      const idPedido = mesa
        ? `MESA-${(numeroMesa || mesa).replace(/[^\w-]/g, '')}-${numeroFactura}`
        : `${desdeFacturacion ? 'VENTA' : 'MENU'}-${numeroFactura}`;
      const pedido = {
        customer: {
          name: factura.cliente?.name || 'Consumidor Final',
          phone: factura.cliente?.phone || '',
          address: mesa ? (/^mesa/i.test(mesa) ? mesa.replace(/^mesa/i, 'Mesa') : `Mesa ${mesa}`) : ''
        },
        deliveryType: mesa ? 'mesa' : 'pickup',
        mesa: mesa,
        status: 'Pending',
        items: (factura.items || []).map(i => ({
          name: String(i.producto || 'Producto').replace(/ \(no está en el catálogo\)$/, ''),
          qty: i.cantidad || 1,
          price: Math.round(i.precioGs ?? i.precio ?? 0)
        })),
        charges: { delivery: 0, tax: 0 },
        paymentMethod: factura.metodoPago || '',
        facturaId: facturaId || '',
        facturaCodigo: factura.codigo || '',
        origen: mesa ? 'mesa' : (desdeFacturacion ? 'facturacion' : 'menu'),
        empresaId: empresaId,
        sucursalId: factura.sucursalId || sucursalId,
        created_at: factura.created_at || new Date().toISOString()
      };
      await db.collection('pedidos').doc(idPedido).set(pedido);
      console.log('✅ Pedido creado desde la venta:', idPedido);
      return idPedido;
    } catch (error) {
      console.warn('⚠️ La venta se guardó, pero no se pudo crear su pedido en Pedidos:', error);
      // Se avisa en pantalla (antes quedaba escondido en la consola)
      const sinPermiso = String(error?.code || error?.message || '').toLowerCase().includes('permission');
      alert(
        'La venta se guardó bien, pero NO se pudo crear su pedido en Pedidos.\n\n' +
        (sinPermiso
          ? 'Motivo: las reglas de Firebase no permiten crear este pedido.'
          : 'Motivo: ' + (error?.message || error)) +
        '\n\nMandale una captura de este mensaje a quien te ayuda con el sistema.'
      );
      return null;
    }
  }

  // ---------- Guardar ----------
  async function guardarOperacion() {
    clearMsg();

    // Solo aplica a operaciones NUEVAS (no al editar una factura ya
    // existente): la caja correspondiente al método de pago elegido tiene
    // que estar abierta, si no, no se puede guardar la venta.
    if (!facturaEditandoId) {
      const metodoActual = document.getElementById('op-metodo-pago').value;
      if (metodoActual === METODO_SIN_CARGO) {
        // No entra plata: no hace falta ninguna caja abierta
      } else if (metodoActual === METODO_MIXTO) {
        // Un pago mixto entra en las dos cajas: tienen que estar abiertas ambas
        const estadoCajasMixto = await obtenerEstadoCajas();
        if (!estadoCajasMixto.efectivo || !estadoCajasMixto.transferencia) {
          mostrarModalCajaCerrada('Para un pago mixto tienen que estar abiertas las dos cajas: la de Efectivo y la de Transferencia.');
          return;
        }
      } else {
        const tipoCajaNecesaria = mapearFormaPagoCaja(metodoActual);
        const cajaOk = await getCajaActiva(tipoCajaNecesaria);
        if (!cajaOk) {
          const nombreCaja = tipoCajaNecesaria === 'efectivo' ? 'Efectivo' : 'Transferencia';
          mostrarModalCajaCerrada(`La caja de ${nombreCaja} debe estar abierta para registrar esta venta (método de pago: ${metodoActual}).`);
          return;
        }
      }
    }

    const clienteEl = document.getElementById('op-cliente');
    const cliente = clienteEl ? clienteEl.value.trim() : '';
    if (!cliente) { showMsg('Seleccioná un cliente.', 'error'); return; }

    const items = [];
    let totalProductos = 0;
    const monedaOperacion = document.getElementById('op-moneda').value;
    document.querySelectorAll('#op-cuentas-body tr:not(.op-empty-rows)').forEach((tr) => {
      const productoSelect = tr.querySelector('.producto-select');
      const productoId = productoSelect.value;
      const producto = productoSelect.options[productoSelect.selectedIndex]?.textContent || '';
      const cantidad = Number(tr.querySelector('.cantidad').value) || 0;
      const precio = Number(tr.querySelector('.precio').value) || 0;
      if (!productoId || cantidad <= 0 || precio <= 0) return;
      const precioGs = convertirAGs(precio, monedaOperacion);
      const subtotalLinea = cantidad * precioGs;
      items.push({ productoId, producto, cantidad, precio, precioGs, moneda: monedaOperacion, subtotal: subtotalLinea });
      totalProductos += subtotalLinea;
    });

    if (items.length < 1) { showMsg('Agregá al menos un producto.', 'error'); return; }

    // Pago mixto: las dos partes tienen que sumar el total
    let mixtoEfectivoGs = 0;
    if (document.getElementById('op-metodo-pago').value === METODO_MIXTO) {
      const efMixto = leerMontoMixto('efectivo');
      const trMixto = leerMontoMixto('transferencia');
      const totalMixto = totalOperacionActual();
      if (efMixto <= 0 || trMixto <= 0) {
        showMsg('En un pago mixto cargá cuánto va en efectivo y cuánto por transferencia.', 'error');
        return;
      }
      if (Math.abs(efMixto + trMixto - totalMixto) > toleranciaMoneda(monedaOperacion)) {
        const sim = symbols[monedaOperacion] || '';
        showMsg(`Efectivo + Transferencia tiene que sumar el total (${sim}${fmtMoneda(totalMixto, monedaOperacion)}).`, 'error');
        return;
      }
      mixtoEfectivoGs = convertirAGs(efMixto, monedaOperacion);
    }

    const numeroDocValorNueva = document.getElementById('op-numero-doc')
      ? document.getElementById('op-numero-doc').value.trim() : '';
    if (numeroDocValorNueva && comprobanteRepetido(numeroDocValorNueva, facturaEditandoId)) {
      mostrarModalComprobanteDuplicado(numeroDocValorNueva);
      return;
    }

    const guardarBtn = document.getElementById('op-guardar');
    if (guardarBtn) {
      guardarBtn.disabled = true;
      guardarBtn.textContent = 'Guardando…';
    }

    try {
      const editando = !!facturaEditandoId;
      const facturaOriginal = editando ? facturas.find(f => f.id === facturaEditandoId) : null;

      // Al editar, mantenemos el mismo código de factura (no se pide un
      // correlativo nuevo). Al crear, sí generamos uno.
      let codigo;
      if (editando) {
        codigo = facturaOriginal?.codigo || 'FAC-????';
      } else {
        const correlativo = await obtenerSiguienteCorrelativo();
        codigo = `FAC-${String(correlativo).padStart(4, '0')}`;
      }

      const metodoPago = document.getElementById('op-metodo-pago').value;
      const banco = (metodoPago === 'Transferencia' || metodoPago === METODO_MIXTO) ? document.getElementById('op-banco').value.trim() : '';
      const titularInput = document.getElementById('op-titular-transf');
      const titularTransferencia = (metodoPago === 'Transferencia' || metodoPago === METODO_MIXTO) && titularInput ? titularInput.value.trim() : '';
      const estadoEl = document.getElementById('op-estado');
      const estado = estadoEl ? estadoEl.value : 'Pagada';
      const noGravadaGs = convertirAGs(Number(document.getElementById('op-no-gravada').value) || 0, monedaOperacion);

      // NUEVO: lectura de los campos de preparación para factura electrónica
      const condicionVenta = document.getElementById('op-condicion-venta')?.value || 'CONTADO';
      const tipoContribuyente = document.getElementById('op-tipo-contribuyente')?.value || 'FISICA';
      const ivaGravado10Gs = convertirAGs(Number(document.getElementById('op-gravado-10')?.value) || 0, monedaOperacion);
      const ivaGravado5Gs = convertirAGs(Number(document.getElementById('op-gravado-5')?.value) || 0, monedaOperacion);
      const ivaExentoGs = convertirAGs(Number(document.getElementById('op-exento')?.value) || 0, monedaOperacion);
      // El CDC y el estado SIFEN los asigna el proveedor de facturación
      // electrónica al enviar la factura — acá solo se preservan si ya
      // existían (caso edición); en una factura nueva quedan vacíos hasta
      // que se conecte esa integración.
      const cdcExistente = editando ? (facturaOriginal?.cdc || null) : null;
      const estadoSifenExistente = editando ? (facturaOriginal?.estadoSifen || 'no_enviada') : 'no_enviada';

      // Cajero: quién hizo la venta. Se fija al CREAR la factura y no se
      // pisa al editarla (igual criterio que created_at) — así el PDF
      // siempre muestra quién atendió esa venta puntual, no quien la esté
      // reimprimiendo o corrigiendo después.
      const cajero = editando ? (facturaOriginal?.cajero || sesionActual?.nombre || '') : (sesionActual?.nombre || '');

      // Sucursal: se fija al CREAR y no se pisa al editar (igual criterio
      // que created_at y cajero) — así una factura conserva la sucursal
      // donde se hizo la venta original, aunque se edite desde otra.
      const sucursalFactura = editando ? (facturaOriginal?.sucursalId || sucursalId) : sucursalId;

      const payload = {
        codigo,
        empresaId: empresaId,
        sucursalId: sucursalFactura,
        cajero,
        periodo: document.getElementById('op-periodo').value,
        tipoOper: document.getElementById('op-tipo-oper').value,
        cliente: clienteSeleccionado ? {
          id: clienteSeleccionado.id,
          name: clienteSeleccionado.name,
          phone: clienteSeleccionado.phone || '',
          email: clienteSeleccionado.email || '',
          ci: document.getElementById('op-cliente-ci').value.trim() || clienteSeleccionado.ci || ''
        } : { name: cliente, ci: document.getElementById('op-cliente-ci').value.trim() || '' },
        tipoDoc: document.getElementById('op-tipo-doc').value,
        timbrado: document.getElementById('op-timbrado').value.trim(),
        numeroDoc: document.getElementById('op-numero-doc').value.trim(),
        mesa: operacionMesaActual || '',
        moneda: monedaOperacion,
        fecEmision: document.getElementById('op-fec-emision').value,
        fecVcto: document.getElementById('op-fec-vcto').value,
        metodoPago: metodoPago,
        banco: banco,
        titularTransferencia: titularTransferencia,
        subtotal: totalProductos,
        noGravada: noGravadaGs,
        total: totalProductos + noGravadaGs,
        glosa: document.getElementById('op-glosa').value.trim(),
        // NUEVO: campos de preparación para factura electrónica (SIFEN)
        condicionVenta: condicionVenta,
        tipoContribuyente: tipoContribuyente,
        ivaGravado10: ivaGravado10Gs,
        ivaGravado5: ivaGravado5Gs,
        ivaExento: ivaExentoGs,
        cdc: cdcExistente,
        estadoSifen: estadoSifenExistente,
        items,
        estado: estado
      };

      if (metodoPago === METODO_SIN_CARGO) {
        payload.valorReferencia = payload.total; // lo que valía a precio de venta
        payload.subtotal = 0;
        payload.noGravada = 0;
        payload.total = 0;
        payload.ivaGravado10 = 0;
        payload.ivaGravado5 = 0;
        payload.ivaExento = 0;
        payload.estado = 'Sin cargo';
        payload.motivoSinCargo = document.getElementById('op-sincargo-motivo')?.value || '';
        payload.detalleSinCargo = (document.getElementById('op-sincargo-detalle')?.value || '').trim();
      }

      // Cuánto entra en cada caja (para Caja y reportes)
      const montosCaja = montosPorCaja(metodoPago, payload.total, mixtoEfectivoGs);
      payload.montoEfectivo = montosCaja.montoEfectivo;
      payload.montoTransferencia = montosCaja.montoTransferencia;
      payload.pagos = metodoPago === METODO_SIN_CARGO ? [] : metodoPago === METODO_MIXTO ? [
        { metodo: 'Efectivo', monto: montosCaja.montoEfectivo },
        { metodo: 'Transferencia', monto: montosCaja.montoTransferencia, banco: banco, titular: titularTransferencia }
      ] : [
        { metodo: metodoPago, monto: payload.total, banco: banco, titular: titularTransferencia }
      ];

      if (editando) {
        payload.created_at = facturaOriginal?.created_at || new Date().toISOString();
        payload.updated_at = new Date().toISOString();
        await actualizarFactura(facturaEditandoId, payload);
        showMsg(`Factura ${codigo} actualizada correctamente.`, 'success');
      } else {
        payload.created_at = new Date().toISOString();
        const facturaIdNueva = await crearFactura(payload);
        // Toda venta nueva (desde el Menú, una mesa o Facturación) crea
        // también su pedido en "Pedidos", para que cocina lo vea. Si eso
        // falla, la venta igual queda guardada.
        const pedidoCreado = await crearPedidoDesdeVenta(payload, facturaIdNueva);
        showMsg(`Operación ${codigo} guardada correctamente.` +
          (pedidoCreado ? ` Pedido ${pedidoCreado} enviado a Pedidos.` : ''), 'success');
        document.dispatchEvent(new CustomEvent('operacion-factura-guardada', { detail: payload }));
      }

      setTimeout(() => {
        cerrarModalNuevaOperacion();
        facturaEditandoId = null;
        if (document.getElementById('facturas-body')) renderTodo();
      }, 900);
    } catch (err) {
      console.error('Error guardando operación:', err);
      showMsg('Ocurrió un error al guardar. Intentá nuevamente.', 'error');
    } finally {
      if (guardarBtn) {
        guardarBtn.disabled = false;
        guardarBtn.textContent = facturaEditandoId ? 'Guardar cambios' : 'Guardar';
      }
      recalcularTotalesProductos();
    }
  }

  // ---------- Eventos del modal ----------
  function wireModalEvents() {
    const overlay = document.getElementById('op-overlay');
    if (!overlay) return;

    const on = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };

    on('op-close', 'click', cerrarModalNuevaOperacion);
    on('op-cancelar', 'click', cerrarModalNuevaOperacion);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cerrarModalNuevaOperacion();
    });

    on('op-moneda', 'change', recalcularTotalCabecera);
    on('op-subtotal', 'input', recalcularTotalCabecera);
    on('op-no-gravada', 'input', recalcularTotalCabecera);
    // NUEVO: recalcular gravado 10% si se tocan Gravado 5% o Exento a mano
    on('op-gravado-5', 'input', recalcularTotalesProductos);
    on('op-exento', 'input', recalcularTotalesProductos);
    on('op-add-row', 'click', () => agregarFilaProducto());
    on('op-guardar', 'click', guardarOperacion);

    on('op-metodo-pago', 'change', function() {
      const bancoWrap = document.getElementById('op-banco-wrap');
      if (bancoWrap) {
        if (this.value === 'Transferencia' || this.value === METODO_MIXTO) {
          bancoWrap.classList.add('visible');
        } else {
          bancoWrap.classList.remove('visible');
        }
      }
      actualizarVisibilidadCobroRapido();
    });

    attachLiveThousandsFormat(document.getElementById('op-monto-recibido'));

    // "Consumidor Final" ya no es un botón aparte: es la primera opción
    // dentro del mismo combobox de Cliente (ver conConsumidorFinal()), así
    // que se selecciona igual que cualquier cliente — tocándola en la lista
    // o escribiendo "Consumidor" para filtrarla. Como no tiene id real (no
    // está en la lista `clientes`), la búsqueda de CI de abajo no encuentra
    // nada y el campo CI/RUC queda vacío, que es lo correcto: Consumidor
    // Final no tiene CI/RUC propio.
    clienteCombobox = initCombobox('cliente-combobox', 'op-cliente', 'cliente-options-list', function(data) {
      clienteSeleccionado = data;
      console.log('✅ Cliente seleccionado (data):', data);

      let ruc = data.ci || '';
      if (!ruc) {
        const clienteOriginal = clientes.find(c => c.id === data.id);
        if (clienteOriginal) ruc = extraerCI(clienteOriginal);
      }

      console.log('✅ RUC/CI asignado:', ruc || '(vacío — revisar nombre del campo en Firestore, o es Consumidor Final)');
      // El CI/RUC del cliente sí se precarga (es un dato del cliente elegido).
      // El N.º de comprobante NO se autocompleta nunca: es un dato manual,
      // propio de cada operación, que no tiene por qué coincidir con el
      // CI/RUC del cliente.
      const clienteCiEl = document.getElementById('op-cliente-ci');
      if (clienteCiEl) clienteCiEl.value = ruc;

      clienteSeleccionado.ci = ruc;

      // Siguiente paso: buscar productos
      setTimeout(() => {
        const buscador = document.getElementById('op-buscar-prod');
        if (buscador) buscador.focus();
      }, 60);
    });
  }

  /* ============================================================
     DETALLE DE FACTURA
     ============================================================ */
  function abrirDetalle(id) {
    const factura = facturas.find(f => f.id === id);
    if (!factura) return;

    const titleEl = document.getElementById("factura-modal-title");
    titleEl.textContent = `Factura #${(id || "").slice(0, 12).toUpperCase()}`;
    // Guardamos el ID acá para que los botones de Imprimir/Descargar
    // sepan sobre qué factura operar sin tener que buscarla de nuevo.
    titleEl.dataset.facturaId = id;

    document.getElementById("modal-fecha").textContent = formatearFecha(factura.created_at);
    document.getElementById("modal-cliente").textContent = factura.cliente?.name || "—";
    document.getElementById("modal-mesa").textContent = factura.mesa || "—";
    document.getElementById("modal-cajero").textContent = factura.cajero || sesionActual?.nombre || "—";
    document.getElementById("modal-metodo").textContent = textoMetodoPago(factura);
    // Banco y quién transfirió (solo con Transferencia o Mixto)
    const bancoWrapDetalle = document.getElementById("modal-banco-wrap");
    const bancoDetalle = document.getElementById("modal-banco");
    const conTransferencia = factura.metodoPago === 'Transferencia' || factura.metodoPago === METODO_MIXTO;
    const datosTransf = [factura.banco, factura.titularTransferencia ? `Transfirió: ${factura.titularTransferencia}` : '']
      .filter(Boolean).join(' · ');
    if (bancoWrapDetalle && bancoDetalle) {
      bancoDetalle.textContent = datosTransf || '—';
      bancoWrapDetalle.style.display = conTransferencia && datosTransf ? '' : 'none';
    }
    document.getElementById("modal-estado").textContent = getEstadoLabel(factura.estado);

    const tbody = document.getElementById("modal-items-body");
    tbody.innerHTML = "";
    let subtotal = 0;
    if (factura.items && factura.items.length > 0) {
      factura.items.forEach(item => {
        const precioBase = item.precioGs ?? item.precio ?? item.price ?? 0;
        const cantidadItem = item.cantidad ?? item.qty ?? 1;
        const totalItem = precioBase * cantidadItem;
        subtotal += totalItem;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${item.producto || item.name || 'Producto'}</td><td>${cantidadItem}</td><td>${formatearPrecio(precioBase)}</td><td>${formatearPrecio(totalItem)}</td>`;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="4">Sin productos</td></tr>`;
    }

    document.getElementById("modal-subtotal").textContent = formatearPrecio(subtotal);
    document.getElementById("modal-total").textContent = factura.metodoPago === METODO_SIN_CARGO
      ? `${formatearPrecio(0)} (sin cargo)`
      : formatearPrecio(subtotal);

    document.getElementById("factura-modal-overlay").classList.add("open");
  }

  function cerrarDetalle() {
    const overlay = document.getElementById("factura-modal-overlay");
    if (overlay) overlay.classList.remove("open");
  }

  function facturaDelModalActual() {
    const titleEl = document.getElementById("factura-modal-title");
    const id = titleEl ? titleEl.dataset.facturaId : null;
    if (!id) return null;
    return facturas.find(f => f.id === id) || null;
  }

  /* ============================================================
     MODAL SIMPLE DE EDICIÓN
     Edita lo que se ve en la tabla — Cliente, Productos, Método y
     Estado — más el N.º de comprobante (igual que en el modal grande
     de "Nueva Operación"). El Total sale solo, sumando los productos.
     No toca otros campos legales (timbrado, tipo de operación,
     periodo, etc.) — para eso está el modal grande.
     ============================================================ */

  function showEditMsg(text, type) {
    const el = document.getElementById('edit-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'op-msg show ' + type;
  }

  function clearEditMsg() {
    const el = document.getElementById('edit-msg');
    if (el) el.className = 'op-msg';
  }

  function recalcularTotalEditar() {
    let total = 0;
    document.querySelectorAll('#edit-cuentas-body tr:not(.op-empty-rows)').forEach((tr) => {
      const cantidad = Number(tr.querySelector('.cantidad')?.value) || 0;
      const precio = Number(tr.querySelector('.precio')?.value) || 0;
      if (cantidad > 0 && precio > 0) total += cantidad * precio;
    });
    const totalEl = document.getElementById('edit-total-display');
    if (totalEl) {
      const simbolo = symbols[facturaEditandoSimpleMoneda] || '';
      totalEl.textContent = `${simbolo}${fmtMoneda(total, facturaEditandoSimpleMoneda)}`;
    }
  }

  function recalcularLineaEditar(tr) {
    const cantidad = Number(tr.querySelector('.cantidad').value) || 0;
    const precio = Number(tr.querySelector('.precio').value) || 0;
    tr.querySelector('.subtotal-linea').value = fmtMoneda(cantidad * precio, facturaEditandoSimpleMoneda);
    recalcularTotalEditar();
  }

  function autocompletarPrecioEditar(tr, productoId) {
    const match = productos.find((p) => p.id === productoId);
    if (match) {
      const precioUSD = Number(match.price ?? match.precio ?? 0);
      const precioConvertido = precioUSD * (rates[facturaEditandoSimpleMoneda] || 1);
      tr.querySelector('.precio').value = precioConvertido ? Number(precioConvertido.toFixed(2)) : '';
    }
    recalcularLineaEditar(tr);
  }

  function agregarFilaProductoEditar(data) {
    const tbody = document.getElementById('edit-cuentas-body');
    if (!tbody) return;
    const emptyRow = tbody.querySelector('.op-empty-rows');
    if (emptyRow) emptyRow.remove();

    rowSeqEditar += 1;
    const tr = document.createElement('tr');
    tr.id = 'edit-row-' + rowSeqEditar;
    tr.innerHTML = `
      <td class="op-producto-col">
        <select class="producto-select"><option value="">Seleccioná…</option></select>
      </td>
      <td><input type="number" class="cantidad" min="1" step="1" value="${data?.cantidad || 1}"></td>
      <td><input type="number" class="precio" min="0" step="0.01" value="${data?.precio ?? ''}"></td>
      <td><input type="text" class="subtotal-linea" value="0" readonly></td>
      <td>
        <button type="button" class="op-row-remove" title="Quitar producto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    const select = tr.querySelector('.producto-select');
    select.innerHTML = '<option value="">Seleccioná…</option>' +
      productos.map(p => `<option value="${p.id}">${p.name || p.nombre || 'Producto sin nombre'}</option>`).join('');

    if (data?.productoId) {
      const yaExiste = select.querySelector(`option[value="${CSS.escape(data.productoId)}"]`);
      if (!yaExiste && data.producto) {
        const opt = document.createElement('option');
        opt.value = data.productoId;
        opt.textContent = data.producto + ' (no está en el catálogo)';
        select.appendChild(opt);
      }
      select.value = data.productoId;
    }

    select.addEventListener('change', (e) => autocompletarPrecioEditar(tr, e.target.value));
    tr.querySelector('.cantidad').addEventListener('input', () => recalcularLineaEditar(tr));
    tr.querySelector('.precio').addEventListener('input', () => recalcularLineaEditar(tr));
    tr.querySelector('.op-row-remove').addEventListener('click', () => {
      tr.remove();
      if (!tbody.querySelector('tr')) {
        tbody.innerHTML = '<tr class="op-empty-rows"><td colspan="5">Agregá al menos un producto</td></tr>';
      }
      recalcularTotalEditar();
    });

    recalcularLineaEditar(tr);
  }

  function abrirModalEditarSimple(id) {
    const factura = facturas.find(f => f.id === id);
    if (!factura) { alert('No se encontró la factura.'); return; }

    const overlay = document.getElementById('editar-factura-overlay');
    if (!overlay) { console.error('❌ No se encontró #editar-factura-overlay.'); return; }

    facturaEditandoSimpleId = id;
    facturaEditandoSimpleMoneda = factura.moneda || 'Gs';
    clienteSeleccionadoEditar = factura.cliente ? {
      id: factura.cliente.id || '',
      name: factura.cliente.name || '',
      phone: factura.cliente.phone || '',
      email: factura.cliente.email || '',
      ci: factura.cliente.ci || ''
    } : null;

    const tituloEl = document.getElementById('editar-factura-titulo');
    if (tituloEl) tituloEl.textContent = `Editar factura ${factura.codigo || (id || '').slice(0, 12).toUpperCase()}`;

    const clienteInput = document.getElementById('edit-op-cliente');
    if (clienteInput) clienteInput.value = factura.cliente?.name || '';

    const metodoSelect = document.getElementById('edit-metodo-pago');
    if (metodoSelect) metodoSelect.value = factura.metodoPago || 'Efectivo';

    const estadoSelect = document.getElementById('edit-estado');
    if (estadoSelect) estadoSelect.value = factura.estado || 'Pagada';

    // NUEVO: precargar Banco y N.º de comprobante (mismos campos
    // factura.banco / factura.numeroDoc que usa el modal grande de
    // "Nueva Operación"), y mostrar ese bloque solo si el método de
    // pago es Transferencia — igual criterio que en Nueva Operación.
    const bancoInputEditar = document.getElementById('edit-banco');
    if (bancoInputEditar) bancoInputEditar.value = factura.banco || '';
    const numeroDocInput = document.getElementById('edit-numero-doc');
    if (numeroDocInput) numeroDocInput.value = factura.numeroDoc || '';
    const titularInputEditar = document.getElementById('edit-titular-transf');
    if (titularInputEditar) titularInputEditar.value = factura.titularTransferencia || '';
    const bancoWrapEditar = document.getElementById('edit-banco-wrap');
    if (bancoWrapEditar) {
      const metodoActualEditar = factura.metodoPago || 'Efectivo';
      bancoWrapEditar.classList.toggle('visible', metodoActualEditar === 'Transferencia' || metodoActualEditar === METODO_MIXTO);
    }

    const tbody = document.getElementById('edit-cuentas-body');
    if (tbody) tbody.innerHTML = '<tr class="op-empty-rows"><td colspan="5">Agregá al menos un producto</td></tr>';
    rowSeqEditar = 0;

    clearEditMsg();
    const guardarBtn = document.getElementById('edit-guardar');
    if (guardarBtn) { guardarBtn.disabled = false; guardarBtn.textContent = 'Guardar cambios'; }

    overlay.classList.add('open');

    cargarClientes().then(clientesData => {
      clientes = clientesData;
      if (clienteComboboxEditar) clienteComboboxEditar.setOptions(conConsumidorFinal(clientesData));
    });

    cargarProductos().then(productosData => {
      productos = productosData;
      (factura.items || []).forEach(item => {
        agregarFilaProductoEditar({
          productoId: item.productoId,
          producto: item.producto,
          cantidad: item.cantidad,
          precio: item.precio
        });
      });
      recalcularTotalEditar();
    });
  }

  function cerrarModalEditarSimple() {
    const overlay = document.getElementById('editar-factura-overlay');
    if (overlay) overlay.classList.remove('open');
    facturaEditandoSimpleId = null;
  }

  async function guardarEdicionSimple() {
    clearEditMsg();

    const clienteInput = document.getElementById('edit-op-cliente');
    const clienteTexto = clienteInput ? clienteInput.value.trim() : '';
    if (!clienteTexto) { showEditMsg('Seleccioná un cliente.', 'error'); return; }

    const items = [];
    let totalEnMoneda = 0;
    document.querySelectorAll('#edit-cuentas-body tr:not(.op-empty-rows)').forEach((tr) => {
      const productoSelect = tr.querySelector('.producto-select');
      const productoId = productoSelect.value;
      const producto = productoSelect.options[productoSelect.selectedIndex]?.textContent || '';
      const cantidad = Number(tr.querySelector('.cantidad').value) || 0;
      const precio = Number(tr.querySelector('.precio').value) || 0;
      if (!productoId || cantidad <= 0 || precio <= 0) return;
      const precioGs = convertirAGs(precio, facturaEditandoSimpleMoneda);
      items.push({ productoId, producto, cantidad, precio, precioGs, moneda: facturaEditandoSimpleMoneda, subtotal: cantidad * precioGs });
      totalEnMoneda += cantidad * precio;
    });

    if (items.length < 1) { showEditMsg('Agregá al menos un producto.', 'error'); return; }

    const totalGs = convertirAGs(totalEnMoneda, facturaEditandoSimpleMoneda);
    const metodoPago = document.getElementById('edit-metodo-pago').value;
    const estado = document.getElementById('edit-estado').value;

    // NUEVO: leer Banco y N.º de comprobante tipeados, para guardarlos
    // junto con el resto de los cambios.
    const bancoInputEditar = document.getElementById('edit-banco');
    const banco = (metodoPago === 'Transferencia' || metodoPago === METODO_MIXTO) && bancoInputEditar ? bancoInputEditar.value.trim() : '';
    const titularInputEditarG = document.getElementById('edit-titular-transf');
    const titularTransferencia = (metodoPago === 'Transferencia' || metodoPago === METODO_MIXTO) && titularInputEditarG ? titularInputEditarG.value.trim() : '';

    // Pago mixto en la edición rápida: se conserva lo que ya estaba en
    // efectivo y el resto queda como transferencia. Para dividir una venta
    // que antes no era mixta, hay que cargarla con "Nueva Operación".
    const facturaAntesDeEditar = facturas.find(f => f.id === facturaEditandoSimpleId);
    let efectivoMixtoEditarGs = 0;
    if (metodoPago === METODO_MIXTO) {
      if (!facturaAntesDeEditar || facturaAntesDeEditar.metodoPago !== METODO_MIXTO) {
        showEditMsg('Para dividir el pago entre efectivo y transferencia, cargá la venta con "Nueva Operación".', 'error');
        return;
      }
      efectivoMixtoEditarGs = facturaAntesDeEditar.montoEfectivo || 0;
    }
    const numeroDocInput = document.getElementById('edit-numero-doc');
    const numeroDoc = numeroDocInput ? numeroDocInput.value.trim() : '';

    if (numeroDoc && comprobanteRepetido(numeroDoc, facturaEditandoSimpleId)) {
      mostrarModalComprobanteDuplicado(numeroDoc);
      return;
    }

    const guardarBtn = document.getElementById('edit-guardar');
    if (guardarBtn) { guardarBtn.disabled = true; guardarBtn.textContent = 'Guardando…'; }

    try {
      const facturaOriginalEditSimple = facturas.find(f => f.id === facturaEditandoSimpleId);
      const patch = {
        cliente: clienteSeleccionadoEditar ? {
          id: clienteSeleccionadoEditar.id,
          name: clienteSeleccionadoEditar.name,
          phone: clienteSeleccionadoEditar.phone || '',
          email: clienteSeleccionadoEditar.email || '',
          ci: clienteSeleccionadoEditar.ci || ''
        } : { name: clienteTexto },
        items,
        metodoPago,
        banco,
        titularTransferencia,
        estado,
        numeroDoc,
        subtotal: totalGs,
        total: totalGs,
        // Reclama la factura para la sucursal activa si todavía era
        // ambigua (sin sucursalId, de antes de este cambio) — mismo
        // patrón que en el resto del sistema. Si ya tenía sucursalId,
        // se preserva tal cual.
        sucursalId: facturaOriginalEditSimple?.sucursalId || sucursalId,
        updated_at: new Date().toISOString()
      };
      if (metodoPago === METODO_SIN_CARGO) {
        patch.valorReferencia = totalGs;
        patch.subtotal = 0;
        patch.total = 0;
        patch.estado = 'Sin cargo';
        if (!facturaAntesDeEditar?.motivoSinCargo) patch.motivoSinCargo = 'Consumo de empleados';
      } else if (facturaAntesDeEditar?.metodoPago === METODO_SIN_CARGO && estado === 'Sin cargo') {
        patch.estado = 'Pagada'; // dejó de ser sin cargo
      }
      const montosCajaEditar = montosPorCaja(metodoPago, patch.total, efectivoMixtoEditarGs);
      patch.montoEfectivo = montosCajaEditar.montoEfectivo;
      patch.montoTransferencia = montosCajaEditar.montoTransferencia;
      patch.pagos = metodoPago === METODO_SIN_CARGO ? [] : metodoPago === METODO_MIXTO ? [
        { metodo: 'Efectivo', monto: montosCajaEditar.montoEfectivo },
        { metodo: 'Transferencia', monto: montosCajaEditar.montoTransferencia, banco: banco, titular: titularTransferencia }
      ] : [
        { metodo: metodoPago, monto: totalGs, banco: banco, titular: titularTransferencia }
      ];
      await actualizarFactura(facturaEditandoSimpleId, patch);
      showEditMsg('Factura actualizada correctamente.', 'success');
      setTimeout(() => {
        cerrarModalEditarSimple();
        renderTodo();
      }, 700);
    } catch (err) {
      console.error('Error actualizando factura:', err);
      showEditMsg('Ocurrió un error al guardar. Intentá nuevamente.', 'error');
    } finally {
      if (guardarBtn) { guardarBtn.disabled = false; guardarBtn.textContent = 'Guardar cambios'; }
    }
  }

  function initEditarFacturaModal() {
    const overlay = document.getElementById('editar-factura-overlay');
    if (!overlay) return;

    const on = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };

    on('editar-factura-close', 'click', cerrarModalEditarSimple);
    on('edit-cancelar', 'click', cerrarModalEditarSimple);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModalEditarSimple(); });
    on('edit-add-row', 'click', () => agregarFilaProductoEditar());
    on('edit-guardar', 'click', guardarEdicionSimple);
    on('edit-metodo-pago', 'change', function () {
      const bancoWrapEditar = document.getElementById('edit-banco-wrap');
      if (bancoWrapEditar) bancoWrapEditar.classList.toggle('visible', this.value === 'Transferencia' || this.value === METODO_MIXTO);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) cerrarModalEditarSimple();
    });

    clienteComboboxEditar = initCombobox('edit-cliente-combobox', 'edit-op-cliente', 'edit-cliente-options-list', function (data) {
      clienteSeleccionadoEditar = data;
    });
  }

  function initDetalle() {
    const closeBtn = document.getElementById("factura-modal-close");
    const cerrarBtn = document.getElementById("modal-cerrar-factura");
    const overlay = document.getElementById("factura-modal-overlay");
    const printBtn = document.getElementById("modal-print-factura");
    const downloadBtn = document.getElementById("modal-download-factura");
    const formatoSelect = document.getElementById("modal-formato-doc");

    if (closeBtn) closeBtn.addEventListener("click", cerrarDetalle);
    if (cerrarBtn) cerrarBtn.addEventListener("click", cerrarDetalle);
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === this) cerrarDetalle(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarDetalle();
      }
    });

    // Botón "Imprimir": genera el PDF (ticket o factura, según el
    // selector) y lo abre en una pestaña nueva con el diálogo de
    // impresión del navegador ya disparado. Desde ahí el usuario elige
    // en qué impresora imprimir (es el propio selector del navegador/SO).
    if (printBtn) {
      printBtn.addEventListener("click", function () {
        const factura = facturaDelModalActual();
        if (!factura) { alert('No se encontró la factura.'); return; }
        const formato = formatoSelect ? formatoSelect.value : 'ticket';
        const doc = generarDocPorFormato(factura, formato);
        if (!doc) return;
        doc.autoPrint();
        window.open(doc.output('bloburl'), '_blank');
      });
    }

    // Botón "Descargar PDF": genera el mismo documento y lo baja como
    // archivo .pdf directamente al dispositivo.
    if (downloadBtn) {
      downloadBtn.addEventListener("click", function () {
        const factura = facturaDelModalActual();
        if (!factura) { alert('No se encontró la factura.'); return; }
        const formato = formatoSelect ? formatoSelect.value : 'ticket';
        const doc = generarDocPorFormato(factura, formato);
        if (!doc) return;
        doc.save(nombreArchivoPDF(factura, formato));
      });
    }
  }

  /* ============================================================
     CAMBIAR ESTADO
     ============================================================ */
  let estadoModalTargetId = null;
  let estadoModalSelected = null;

  function abrirModalEstado(id) {
    const factura = facturas.find(f => f.id === id);
    if (!factura) return;
    estadoModalTargetId = id;
    estadoModalSelected = factura.estado || "Pendiente";

    const idLabel = document.getElementById("estado-modal-id");
    if (idLabel) idLabel.textContent = (id || "").slice(0, 12).toUpperCase();

    document.querySelectorAll("#estado-options .estado-option").forEach(btn => {
      btn.classList.toggle("selected", btn.getAttribute("data-estado") === estadoModalSelected);
    });

    const overlay = document.getElementById("estado-modal-overlay");
    if (overlay) overlay.classList.add("open");
  }

  function cerrarModalEstado() {
    const overlay = document.getElementById("estado-modal-overlay");
    if (overlay) overlay.classList.remove("open");
    estadoModalTargetId = null;
  }

  async function guardarEstadoModal() {
    if (!estadoModalTargetId || !estadoModalSelected) return;
    const guardarBtn = document.getElementById("estado-modal-guardar");
    try {
      if (guardarBtn) guardarBtn.disabled = true;
      await actualizarEstadoFactura(estadoModalTargetId, estadoModalSelected);
      cerrarModalEstado();
      await renderTodo();
    } catch (e) {
      alert("Error al cambiar estado.");
    } finally {
      if (guardarBtn) guardarBtn.disabled = false;
    }
  }

  function initModalEstado() {
    const overlay = document.getElementById("estado-modal-overlay");
    const closeBtn = document.getElementById("estado-modal-close");
    const cancelBtn = document.getElementById("estado-modal-cancelar");
    const guardarBtn = document.getElementById("estado-modal-guardar");

    if (closeBtn) closeBtn.addEventListener("click", cerrarModalEstado);
    if (cancelBtn) cancelBtn.addEventListener("click", cerrarModalEstado);
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === this) cerrarModalEstado(); });
    document.querySelectorAll("#estado-options .estado-option").forEach(btn => {
      btn.addEventListener("click", () => {
        estadoModalSelected = btn.getAttribute("data-estado");
        document.querySelectorAll("#estado-options .estado-option").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });
    if (guardarBtn) guardarBtn.addEventListener("click", guardarEstadoModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarModalEstado();
      }
    });
  }

  /* ============================================================
     CONFIRMACIÓN ELIMINAR
     ============================================================ */
  function abrirConfirmacion(id) {
    deleteTargetId = id;
    const overlay = document.getElementById("confirm-overlay");
    if (overlay) overlay.classList.add("open");
  }

  function cerrarConfirmacion() {
    const overlay = document.getElementById("confirm-overlay");
    if (overlay) overlay.classList.remove("open");
    deleteTargetId = null;
  }

  async function aceptarEliminar() {
    if (!deleteTargetId) return;
    const btn = document.getElementById("confirm-accept");
    if (btn) btn.disabled = true;
    try {
      await eliminarFactura(deleteTargetId);
      cerrarConfirmacion();
      await renderTodo();
    } catch (e) {
      alert("Error al eliminar la factura.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function initConfirmacion() {
    const cancelBtn = document.getElementById("confirm-cancel");
    const acceptBtn = document.getElementById("confirm-accept");
    const overlay = document.getElementById("confirm-overlay");
    if (cancelBtn) cancelBtn.addEventListener("click", cerrarConfirmacion);
    if (acceptBtn) acceptBtn.addEventListener("click", aceptarEliminar);
    if (overlay) overlay.addEventListener("click", function (e) {
      if (e.target === this) cerrarConfirmacion();
    });
  }

  /* ============================================================
     PAGINACIÓN Y MONEDA
     ============================================================ */
  function initPagination() {
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.addEventListener("click", () => { if (pagina > 1) { pagina--; renderTabla(); } });
    if (nextBtn) nextBtn.addEventListener("click", () => { pagina++; renderTabla(); });
  }

  function initCurrencyToggle() {
    const container = document.getElementById("currency-toggle");
    if (!container) return;
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", function () {
        container.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        moneda = this.getAttribute("data-currency");
        renderTabla();
      });
    });
  }

  function initRefresh() {
    const btn = document.getElementById("refresh-btn");
    if (btn) {
      btn.addEventListener("click", function() {
        renderTodo();
      });
    }
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  /* ============================================================
     API PÚBLICA (usada por menu.js al tocar "Registrar compra")
     ============================================================ */
  window.OperacionFactura = {
    open: function (items, opciones) {
      abrirModalNuevaOperacion(items, opciones);
    }
  };

  /* ============================================================
     INICIALIZACIÓN
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    const esPaginaFacturacionCompleta = !!document.getElementById("facturas-body");

    if (esPaginaFacturacionCompleta) {
      initPagination();
      initCurrencyToggle();
      initDetalle();
      initEditarFacturaModal();
      initModalEstado();
      initConfirmacion();
      initAmbiguo();
    }

    initNuevaOperacion();
    prepararPagoMixto();
    compactarModalOperacion();
    wireModalEvents();
    // El modal de "N.º de comprobante repetido" se usa desde el modal de
    // Nueva Operación, que también vive en menu.html (no solo acá) — se
    // inicializa siempre; internamente no hace nada si la página no tiene
    // el overlay correspondiente.
    initModalComprobanteDuplicado();
    // Mismo criterio para el modal de "Caja cerrada".
    initModalCajaCerrada();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales. Recién ahí
  // sabemos el empresaId real y podemos cargar facturas/clientes/productos.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    sucursalId = sesionActual.sucursalId;

    const esPaginaFacturacionCompleta = !!document.getElementById("facturas-body");
    if (esPaginaFacturacionCompleta) {
      pagina = 1;
      renderTodo();
      // Desde el acceso rápido del Panel principal se entra con
      // facturacion.html?nueva=1: se abre directo "Nueva Operación".
      // Se saca el parámetro de la dirección para que, al recargar o al
      // cerrar el modal, quede la lista de facturas normal.
      const params = new URLSearchParams(window.location.search);
      if (params.get('nueva') === '1') {
        window.history.replaceState(null, '', window.location.pathname);
        abrirModalNuevaOperacion();
      }
      if (!window.__gastroFacturacionInterval) {
        window.__gastroFacturacionInterval = setInterval(renderTodo, 30000);
      }
    } else {
      // Esta página no es la de Facturación completa (por ejemplo, se
      // cargó este script en menu.html solo para usar el modal de
      // "Registrar compra" vía window.OperacionFactura.open). Igual
      // cargamos las facturas (sin paginación/tabla) para que la
      // validación de N.º de comprobante repetido tenga contra qué
      // comparar.
      cargarFacturas().then(f => { facturas = f; });
      cargarClientes().then(c => {
        clientes = c;
        if (clienteCombobox) clienteCombobox.setOptions(conConsumidorFinal(c));
      });
      cargarProductos().then(p => { productos = p; });
    }
  });

})();

/* ==============================================================
   ETIQUETAS DE ESTADO CON COLOR LLENO (agregado)
   --------------------------------------------------------------
   Las etiquetas de estado de la lista (Pendiente, Confirmada,
   Entregado, Pagada, Crítico, Activo...) pasan de fondo clarito a
   color lleno con letra blanca:
     verde = OK / confirmado / entregado / pagado / activo
     amarillo = pendiente / bajo
     rojo = cancelado / anulado / crítico / inactivo
     azul = preparando · violeta = en camino · gris = sin cargo
   ============================================================== */
(function () {
  "use strict";
  if (document.getElementById("estados-solidos-style")) return;
  const style = document.createElement("style");
  style.id = "estados-solidos-style";
  style.textContent = `
    span.estado, span.status {
      color: #fff !important; border: 0 !important; font-weight: 700 !important;
      padding: 4px 11px !important; border-radius: 999px !important; display: inline-flex !important;
      align-items: center; gap: 6px; white-space: nowrap; box-shadow: none !important;
    }
    span.estado::before, span.status::before { background: #fff !important; color: #fff !important; border-color: #fff !important; }
    span.estado.ok, span.estado.estado-ok, span.estado.Delivered, span.estado.Pagada,
    span.status.ok { background: #16a34a !important; }
    span.estado.pending, span.estado.Pending, span.estado.Pendiente,
    span.status.pending { background: #d97706 !important; }
    span.estado.cancel, span.estado.estado-cancel, span.estado.Canceled, span.estado.Anulada,
    span.status.cancel { background: #dc2626 !important; }
    span.estado.Preparing { background: #2563eb !important; }
    span.estado.Out { background: #7c3aed !important; }
    span.estado.Sin { background: #6b7280 !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
})();