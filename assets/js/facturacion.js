(function () {
  'use strict';

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  const ICON_VER = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const ICON_EDITAR = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const ICON_DELETE = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

  const PAGE_SIZE = 8;

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
        todos.push({ id: doc.id, ...doc.data() });
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
    const altoMM = 95 + items.length * 6;
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
    doc.text('¡Gracias por su compra!', anchoMM / 2, y, { align: 'center' });

    return doc;
  }

  // Factura formal A4: barra superior de color, bloque de empresa + N° de
  // factura, datos del receptor, tabla de ítems y caja de totales a la
  // derecha. Sin código QR.
  const FACTURA_COLOR_BARRA = [26, 58, 92];   // azul oscuro de la barra superior
  const FACTURA_COLOR_ACENTO = [26, 58, 92];  // mismo azul para textos destacados

  function generarDocFactura(factura) {
    if (!window.jspdf) {
      alert('No se pudo cargar el generador de PDF. Revisá tu conexión a internet.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    const monedaFactura = factura.moneda || 'Gs';
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margenIzq = 14;
    const margenDer = pageWidth - 14;

    // ---------- Barra superior ----------
    doc.setFillColor(...FACTURA_COLOR_BARRA);
    doc.rect(0, 0, pageWidth, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    const tituloBarra = factura.tipoDoc === 'TICKET' ? 'COMPROBANTE DE VENTA' : 'FACTURA';
    doc.text(tituloBarra, pageWidth / 2, 7, { align: 'center' });
    doc.setTextColor(0, 0, 0);

    // ---------- Bloque empresa (izquierda) ----------
    let y = 20;
    doc.setFontSize(15);
    doc.setFont(undefined, 'bold');
    doc.text(sesionActual.empresaNombre, margenIzq, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(sesionActual.sucursalNombre, margenIzq, y);
    y += 8;

    // ---------- Bloque N° de factura (derecha, destacado) ----------
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...FACTURA_COLOR_ACENTO);
    doc.text('FACTURA N.º:', margenDer, 20, { align: 'right' });
    doc.setFontSize(11);
    doc.text(factura.numeroDoc || factura.codigo || '—', margenDer, 25, { align: 'right' });
    doc.setFontSize(9);
    doc.text('Timbrado:', margenDer, 31, { align: 'right' });
    doc.setFont(undefined, 'normal');
    doc.text(factura.timbrado || '—', margenDer, 35.5, { align: 'right' });
    doc.setFont(undefined, 'bold');
    doc.text('Fecha y hora de emisión:', margenDer, 41, { align: 'right' });
    doc.setFont(undefined, 'normal');
    doc.text(formatearFecha(factura.created_at), margenDer, 45.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    // ---------- Línea divisoria ----------
    y = 50;
    doc.setDrawColor(...FACTURA_COLOR_BARRA);
    doc.setLineWidth(0.4);
    doc.line(margenIzq, y, margenDer, y);
    y += 7;

    // ---------- Receptor ----------
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('RECEPTOR:', margenIzq, y);
    doc.setFont(undefined, 'normal');
    doc.text(factura.cliente?.name || '—', margenIzq + 25, y);
    y += 5.5;
    doc.setFont(undefined, 'bold');
    doc.text('RUC/CI CLIENTE:', margenIzq, y);
    doc.setFont(undefined, 'normal');
    doc.text(factura.cliente?.ci || '—', margenIzq + 25, y);
    y += 5.5;
    doc.setFont(undefined, 'bold');
    doc.text('MÉTODO DE PAGO:', margenIzq, y);
    doc.setFont(undefined, 'normal');
    doc.text(factura.metodoPago || '—', margenIzq + 25, y);
    if (factura.mesa) {
      doc.setFont(undefined, 'bold');
      doc.text('MESA:', 130, y);
      doc.setFont(undefined, 'normal');
      doc.text(String(factura.mesa), 145, y);
    }
    y += 8;

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
      theme: 'grid',
      headStyles: { fillColor: FACTURA_COLOR_BARRA, textColor: 255 },
      styles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 16, halign: 'center' },
        1: { cellWidth: 22 },
        3: { halign: 'right' },
        4: { halign: 'right' }
      }
    });

    const finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 8;

    // ---------- Caja de totales (derecha) ----------
    const totalGs = totalGsDeFactura(factura);
    const subtotalTexto = formatearPrecioEnMoneda(totalGs, monedaFactura);
    const totalTexto = formatearPrecioEnMoneda(totalGs, monedaFactura);
    const cajaAncho = 65;
    const cajaX = margenDer - cajaAncho;
    let cajaY = finalY;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);

    const filaAltura = 7;
    const filas = [
      ['Subtotal', subtotalTexto, false],
      ['Descuento', formatearPrecioEnMoneda(0, monedaFactura), false],
      ['Total', totalTexto, true]
    ];

    filas.forEach(([label, valor, destacado]) => {
      doc.rect(cajaX, cajaY, cajaAncho, filaAltura);
      doc.setFontSize(destacado ? 11 : 9);
      doc.setFont(undefined, destacado ? 'bold' : 'normal');
      doc.text(label, cajaX + 3, cajaY + filaAltura / 2 + 1.5);
      doc.text(valor, cajaX + cajaAncho - 3, cajaY + filaAltura / 2 + 1.5, { align: 'right' });
      cajaY += filaAltura;
    });

    // ---------- Glosa (si hay) ----------
    // (Sin código QR, según lo pedido — el documento cierra directo con la
    // glosa, el método de pago ya mostrado arriba, y el pie de página.)
    let yFinal = cajaY + 10;
    if (factura.glosa) {
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.text('Glosa:', margenIzq, yFinal);
      doc.setFont(undefined, 'normal');
      doc.text(factura.glosa, margenIzq + 15, yFinal, { maxWidth: pageWidth - margenIzq - 15 - 14 });
      yFinal += 8;
    }

    // ---------- Pie ----------
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('Esta es una representación del comprobante de venta generado por Gastro.', margenIzq, doc.internal.pageSize.getHeight() - 10);
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
          html += `<div class="option-item" data-id="${p.id}" data-name="${p.name}" data-phone="${p.phone || ''}" data-email="${p.email || ''}" data-ci="${p.ci || ''}">${label}</div>`;
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
          <td>${f.metodoPago || f.metodo || "—"}</td>
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
    if (clienteCombobox) clienteCombobox.setOptions(clientesData);
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

  function abrirModalNuevaOperacion(itemsPrecargados, opciones) {
    const overlay = document.getElementById('op-overlay');
    if (!overlay) {
      console.error('❌ No se encontró el modal de Nueva Operación (#op-overlay) en esta página.');
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
    const bancoWrap = document.getElementById('op-banco-wrap');
    if (bancoWrap) bancoWrap.classList.remove('visible');
    setVal('op-monto-recibido', '');
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
        clienteCombobox.setOptions(clientesData);
        clienteCombobox.clear();
      }
    });

    opItems = [];
    clienteSeleccionado = null;
    rowSeq = 0;

    overlay.classList.add('open');

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
    setVal('op-estado', factura.estado || 'Pagada');

    const bancoWrap = document.getElementById('op-banco-wrap');
    if (bancoWrap) {
      if (factura.metodoPago === 'Transferencia') bancoWrap.classList.add('visible');
      else bancoWrap.classList.remove('visible');
    }

    setVal('op-monto-recibido', '');
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
        clienteCombobox.setOptions(clientesData);
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
    const totalNumerico = Number(String(totalEl.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
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
    cobroRapido.classList.toggle('visible', metodoEl.value === 'Efectivo');
  }

  // ---------- Guardar ----------
  async function guardarOperacion() {
    clearMsg();

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
      const banco = metodoPago === 'Transferencia' ? document.getElementById('op-banco').value.trim() : '';
      const estadoEl = document.getElementById('op-estado');
      const estado = estadoEl ? estadoEl.value : 'Pagada';
      const noGravadaGs = convertirAGs(Number(document.getElementById('op-no-gravada').value) || 0, monedaOperacion);

      const payload = {
        codigo,
        empresaId: empresaId,
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
        subtotal: totalProductos,
        noGravada: noGravadaGs,
        total: totalProductos + noGravadaGs,
        glosa: document.getElementById('op-glosa').value.trim(),
        items,
        estado: estado
      };

      if (editando) {
        payload.created_at = facturaOriginal?.created_at || new Date().toISOString();
        payload.updated_at = new Date().toISOString();
        await actualizarFactura(facturaEditandoId, payload);
        showMsg(`Factura ${codigo} actualizada correctamente.`, 'success');
      } else {
        payload.created_at = new Date().toISOString();
        await crearFactura(payload);
        showMsg(`Operación ${codigo} guardada correctamente.`, 'success');
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
    on('op-add-row', 'click', () => agregarFilaProducto());
    on('op-guardar', 'click', guardarOperacion);

    on('op-metodo-pago', 'change', function() {
      const bancoWrap = document.getElementById('op-banco-wrap');
      if (bancoWrap) {
        if (this.value === 'Transferencia') {
          bancoWrap.classList.add('visible');
        } else {
          bancoWrap.classList.remove('visible');
        }
      }
      actualizarVisibilidadCobroRapido();
    });

    attachLiveThousandsFormat(document.getElementById('op-monto-recibido'));

    clienteCombobox = initCombobox('cliente-combobox', 'op-cliente', 'cliente-options-list', function(data) {
      clienteSeleccionado = data;
      console.log('✅ Cliente seleccionado (data):', data);

      let ruc = data.ci || '';
      if (!ruc) {
        const clienteOriginal = clientes.find(c => c.id === data.id);
        if (clienteOriginal) ruc = extraerCI(clienteOriginal);
      }

      console.log('✅ RUC/CI asignado:', ruc || '(vacío — revisar nombre del campo en Firestore)');
      const numeroDocEl = document.getElementById('op-numero-doc');
      if (numeroDocEl) numeroDocEl.value = ruc;
      const clienteCiEl = document.getElementById('op-cliente-ci');
      if (clienteCiEl) clienteCiEl.value = ruc;

      clienteSeleccionado.ci = ruc;
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
    document.getElementById("modal-cajero").textContent = sesionActual?.nombre || "—";
    document.getElementById("modal-metodo").textContent = factura.metodoPago || factura.metodo || "—";
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
    document.getElementById("modal-total").textContent = formatearPrecio(subtotal);

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
    const bancoWrapEditar = document.getElementById('edit-banco-wrap');
    if (bancoWrapEditar) {
      bancoWrapEditar.classList.toggle('visible', (factura.metodoPago || 'Efectivo') === 'Transferencia');
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
      if (clienteComboboxEditar) clienteComboboxEditar.setOptions(clientesData);
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
    const banco = metodoPago === 'Transferencia' && bancoInputEditar ? bancoInputEditar.value.trim() : '';
    const numeroDocInput = document.getElementById('edit-numero-doc');
    const numeroDoc = numeroDocInput ? numeroDocInput.value.trim() : '';

    if (numeroDoc && comprobanteRepetido(numeroDoc, facturaEditandoSimpleId)) {
      mostrarModalComprobanteDuplicado(numeroDoc);
      return;
    }

    const guardarBtn = document.getElementById('edit-guardar');
    if (guardarBtn) { guardarBtn.disabled = true; guardarBtn.textContent = 'Guardando…'; }

    try {
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
        estado,
        numeroDoc,
        subtotal: totalGs,
        total: totalGs,
        updated_at: new Date().toISOString()
      };
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
      if (bancoWrapEditar) bancoWrapEditar.classList.toggle('visible', this.value === 'Transferencia');
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
    }

    initNuevaOperacion();
    wireModalEvents();
    // El modal de "N.º de comprobante repetido" se usa desde el modal de
    // Nueva Operación, que también vive en menu.html (no solo acá) — se
    // inicializa siempre; internamente no hace nada si la página no tiene
    // el overlay correspondiente.
    initModalComprobanteDuplicado();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales. Recién ahí
  // sabemos el empresaId real y podemos cargar facturas/clientes/productos.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;

    const esPaginaFacturacionCompleta = !!document.getElementById("facturas-body");
    if (esPaginaFacturacionCompleta) {
      pagina = 1;
      renderTodo();
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
        if (clienteCombobox) clienteCombobox.setOptions(c);
      });
      cargarProductos().then(p => { productos = p; });
    }
  });

})();