(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sucursalId = null;
  let sesionActual = null;

  let moneda = "Gs";
  let insumos = [];
  let insumosFiltrados = [];
  let comprarTargetId = null;
  let insumoEditandoId = null; // null = creando nuevo insumo, si tiene valor = editando
  let idEliminarInsumo = null;

  // Buscador de proveedor dentro del modal de insumo: lista cargada desde
  // Firestore (colección 'proveedores', igual que en proveedores.js), y el
  // proveedor elegido de esa lista (o null si el usuario escribió un
  // nombre libre que no está en la base).
  let proveedores = [];
  let proveedorSeleccionado = null;
  let proveedorCombobox = null;

  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };
  // ⚠️ FIX: antes formatoMoneda() solo le pegaba el símbolo elegido al
  // mismo número guardado en Gs, sin dividir ni multiplicar nada — el
  // costo por unidad se veía igual en Gs/US$/R$, solo cambiaba el
  // símbolo. Mismas tasas que ya usan facturacion.js, reportes.js y
  // dashboard.js: 1 US$ = 7300 Gs, 1 US$ = 5.4 R$.
  const rates = { "US$": 7300, "Gs": 1, "R$": 7300 / 5.4 };

  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>';
  // Ícono de "comprar / reponer stock" — sin color fijo para heredar el
  // estilo de .action-btn (igual que editar/eliminar)
  // Ícono de "registrar salida" (consumo de personal, cortesía, vencido)
  const ICON_SALIDA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  let salidaTargetId = null;
  const ICON_CARRITO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

  /* ============================================================
     FUNCIONES DE FIREBASE
     ============================================================ */
  async function cargarInsumos() {
    try {
      // Filtrar SOLO los insumos de la empresa actual
      const snapshot = await db.collection('insumos')
        .where('empresaId', '==', empresaId)
        .get();

      const todos = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        // Cada sucursal tiene su propio stock físico — mismo criterio que
        // "productos" en facturacion.js/menu.js. Si el insumo no tiene
        // sucursalId (de antes de este cambio), se deja pasar igual: no
        // hay forma de saber a qué sucursal pertenecía.
        if (data.sucursalId && data.sucursalId !== sucursalId) return;
        todos.push({ id: doc.id, ...data });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar insumos:", error);
      return [];
    }
  }

  // Misma colección 'proveedores' que usa proveedores.js, filtrada por la
  // empresa activa — así el buscador del modal de insumo lista los mismos
  // proveedores que ya están cargados en la sección Proveedores. Los
  // proveedores SÍ se comparten entre sucursales de una misma empresa
  // (mismo criterio que "clientes" en facturacion.js): un mismo proveedor
  // suele entregar a más de una sucursal.
  async function cargarProveedores() {
    try {
      const snapshot = await db.collection('proveedores')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar proveedores:", error);
      return [];
    }
  }

  async function crearInsumo(datos) {
    try {
      datos.empresaId = empresaId; // Asignar automáticamente la empresa activa
      datos.sucursalId = sucursalId; // y la sucursal activa (stock físico por sucursal)
      const docRef = await db.collection('insumos').add(datos);
      console.log("Insumo creado correctamente");
      return docRef.id;
    } catch (error) {
      console.error("Error al crear el insumo:", error);
      throw error;
    }
  }

  async function actualizarInsumo(id, datos) {
    try {
      await db.collection('insumos').doc(id).update(datos);
      console.log("Insumo actualizado correctamente:", id);
    } catch (error) {
      console.error("Error al actualizar el insumo:", error);
      throw error;
    }
  }

  async function eliminarInsumoDeFirebase(id) {
    try {
      await db.collection('insumos').doc(id).delete();
      console.log("Insumo eliminado correctamente:", id);
    } catch (error) {
      console.error("Error al eliminar el insumo:", error);
      throw error;
    }
  }

  async function actualizarStockInsumo(id, nuevaCantidad) {
    try {
      await db.collection('insumos').doc(id).update({ cantidad: nuevaCantidad });
      console.log(`Stock actualizado a ${nuevaCantidad}`);
    } catch (error) {
      console.error("Error al actualizar stock:", error);
      throw error;
    }
  }

  // Registra el gasto de una compra de insumo en la colección 'gastos' —
  // la misma que reportes.js ya lee y suma en "Gastos totales" / "Balance
  // neto". Antes de esto, registrar una compra solo tocaba el stock del
  // insumo y no dejaba ningún rastro contable, así que Reportes no tenía
  // de dónde sacar el gasto.
  // Devuelve true/false en vez de relanzar el error: preferimos que el
  // stock quede actualizado igual aunque el gasto falle, pero el llamador
  // necesita saber si falló para avisarle al usuario (si no, un error de
  // permisos de Firestore pasaría totalmente inadvertido).
  async function crearGastoInventario(insumo, cantidadAAgregar, montoGastado, motivo) {
    try {
      const ahora = new Date();
      const verbo = motivo === 'inicial' ? 'Stock inicial de' : (motivo === 'ajuste' ? 'Ajuste de stock de' : 'Compra de');
      const datos = {
        empresaId: empresaId,
        sucursalId: sucursalId,
        fecha: ahora.toISOString().slice(0, 10),
        created_at: ahora.toISOString(),
        categoria: 'Inventario',
        monto: montoGastado,
        descripcion: `${verbo} ${cantidadAAgregar} ${insumo.unidad || ''} de ${insumo.nombre || 'insumo'}`.trim()
          + (insumo.proveedor ? ` a ${insumo.proveedor}` : ''),
        insumoId: insumo.id,
        insumoNombre: insumo.nombre || '',
        cantidad: cantidadAAgregar,
        proveedor: insumo.proveedor || ''
      };
      await db.collection('gastos').add(datos);
      console.log("Gasto de inventario registrado:", datos);
      return { ok: true };
    } catch (error) {
      console.error("Error al registrar el gasto de inventario:", error);
      return { ok: false, error };
    }
  }

  /* ============================================================
     INSUMOS "AMBIGUOS" (sin sucursalId, de antes de este cambio)
     ------------------------------------------------------------
     Se ven en todas las sucursales hasta que se les asigna una. En
     vez de obligar a editarlos uno por uno, este botón los asigna
     TODOS de una sola vez a la sucursal activa.
     ============================================================ */
  function contarInsumosAmbiguos() {
    return insumos.filter(i => !i.sucursalId).length;
  }

  function renderAmbiguoBanner() {
    const banner = document.getElementById("ambiguo-banner");
    const text = document.getElementById("ambiguo-text");
    if (!banner || !text) return;
    const cantidad = contarInsumosAmbiguos();
    if (cantidad > 0) {
      text.textContent = `${cantidad} insumo(s) todavía no tienen sucursal asignada y por eso se ven en todas.`;
      banner.style.display = "flex";
    } else {
      banner.style.display = "none";
    }
  }

  async function asignarInsumosAmbiguosAEstaSucursal() {
    const btn = document.getElementById("ambiguo-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Asignando...";
    try {
      const ambiguos = insumos.filter(i => !i.sucursalId);
      if (!ambiguos.length) return;

      const batch = db.batch();
      ambiguos.forEach(i => {
        batch.update(db.collection('insumos').doc(i.id), { sucursalId: sucursalId });
      });
      await batch.commit();
      console.log(`✅ Se asignaron ${ambiguos.length} insumo(s) a la sucursal "${sucursalId}".`);
      await renderTodo();
    } catch (error) {
      console.error("Error al asignar insumos ambiguos:", error);
      alert("No se pudieron asignar los insumos. Revisá la consola.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Asignar a esta sucursal";
    }
  }

  function initAmbiguo() {
    const btn = document.getElementById("ambiguo-btn");
    if (btn) btn.addEventListener("click", asignarInsumosAmbiguosAEstaSucursal);
  }

  /* ============================================================
     RENDERIZADO (Incluyendo encabezados)
     ============================================================ */
  function renderHeader() {
    if (!sesionActual) return;
    const branchDate = document.getElementById("branch-date");
    if (branchDate) branchDate.textContent = `${sesionActual.sucursalNombre} · Control de stock e insumos`;
  }

  function getEstado(stock, min) {
    if (stock <= 0) return { label: 'Sin stock', class: 'cancel' };
    if (stock <= min) return { label: 'Crítico', class: 'cancel' };
    if (stock <= min * 2) return { label: 'Bajo', class: 'pending' };
    return { label: 'Suficiente', class: 'ok' };
  }

  // "valor" siempre llega guardado en Gs (así se cargan costoUnitario y
  // costoCompra en este archivo). Se convierte a la moneda elegida antes
  // de mostrarlo — antes esta función no convertía nada, así que el
  // costo por unidad se veía idéntico en Gs/US$/R$, solo cambiando el
  // símbolo.
  function formatoMoneda(valorGs) {
    const symbol = symbols[moneda] || "";
    const num = Number(valorGs) || 0;
    const convertido = moneda === "Gs" ? num : num / rates[moneda];
    const maximoDecimales = moneda === "Gs" ? 0 : 2;
    return `${symbol}${convertido.toLocaleString('es-PY', { maximumFractionDigits: maximoDecimales })}`;
  }

  // Muestra el ID completo si es corto, o lo recorta con "…" si es muy largo
  // (los IDs de Firestore suelen tener 20 caracteres)
  function formatoId(id) {
    if (!id) return "—";
    return id.length > 10 ? id.substring(0, 8) + "…" : id;
  }

  function renderTabla() {
    const tbody = document.getElementById("inventario-body");
    if (!tbody) return;

    const term = document.getElementById("insumo-search")?.value?.toLowerCase() || "";
    const categoriaFiltro = document.getElementById("filter-categoria")?.value || "all";

    insumosFiltrados = insumos.filter(i => {
      const nombreMatch = (i.nombre || "").toLowerCase().includes(term);
      const catMatch = categoriaFiltro === "all" || (i.categoria || "").toLowerCase() === categoriaFiltro.toLowerCase();
      return nombreMatch && catMatch;
    });

    tbody.innerHTML = "";
    if (insumosFiltrados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No hay insumos registrados para esta empresa.</td></tr>`;
    } else {
      insumosFiltrados.forEach(ins => {
        const estado = getEstado(ins.cantidad, ins.minimo);
        const tr = document.createElement("tr");

        tr.innerHTML = `
          <td class="id-cell" title="${ins.id}">${formatoId(ins.id)}</td>
          <td><strong>${ins.nombre || '—'}</strong></td>
          <td>${ins.categoria || '—'}</td>
          <td>${ins.proveedor || '—'}</td>
          <td class="text-center"><strong>${ins.cantidad || 0}</strong></td>
          <td>${ins.unidad || '—'}</td>
          <td>${formatoMoneda(ins.costoUnitario)}</td>
          <td class="text-center">${ins.minimo || 0}</td>
          <td><span class="estado ${estado.class}">${estado.label}</span></td>
          <td class="col-actions">
            <div class="row-actions">
              <button type="button" class="action-btn editar" data-id="${ins.id}" title="Editar insumo" aria-label="Editar">${ICON_EDIT}</button>
              <button type="button" class="action-btn action-btn-danger eliminar" data-id="${ins.id}" title="Eliminar insumo" aria-label="Eliminar">${ICON_DELETE}</button>
              <button type="button" class="action-btn comprar" data-id="${ins.id}" title="Comprar / Reponer stock" aria-label="Comprar">${ICON_CARRITO}</button>
              <button type="button" class="action-btn action-btn-salida salida" data-id="${ins.id}" title="Registrar salida (consumo, cortesía, vencido)" aria-label="Registrar salida">${ICON_SALIDA}</button>
            </div>
          </td>
        `;

        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditar(ins.id));
        tr.querySelector(".eliminar").addEventListener("click", () => confirmarEliminarInsumo(ins.id));
        tr.querySelector(".comprar").addEventListener("click", () => abrirModalComprar(ins.id));
        tr.querySelector(".salida").addEventListener("click", () => abrirModalSalida(ins.id));
        tbody.appendChild(tr);
      });
    }
    document.getElementById("page-label").textContent = `Mostrando ${insumosFiltrados.length} insumos`;
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    const todos = await cargarInsumos();
    insumos = todos;
    renderHeader();
    renderTabla();
    renderAmbiguoBanner();
  }

  /* ============================================================
     COMBOBOX DE PROVEEDOR (buscar por nombre o escribir uno nuevo)
     ============================================================ */
  function initComboboxProveedor(comboboxId, inputId, optionsId, onSelect) {
    const combobox = document.getElementById(comboboxId);
    const input = document.getElementById(inputId);
    const optionsContainer = document.getElementById(optionsId);
    if (!combobox || !input || !optionsContainer) return null;

    let currentOptions = [];

    function filterOptions(query) {
      const q = query.toLowerCase().trim();
      const filtered = currentOptions.filter(p => (p.nombre || '').toLowerCase().includes(q));
      renderOptions(filtered);
    }

    function renderOptions(list) {
      if (list.length === 0) {
        optionsContainer.innerHTML = `<div class="no-results">No se encontraron proveedores. Podés escribir uno nuevo.</div>`;
        return;
      }
      let html = '';
      list.forEach(p => {
        const label = p.nombre + (p.telefono ? ` (${p.telefono})` : '');
        html += `<div class="option-item" data-id="${p.id}" data-nombre="${p.nombre || ''}">${label}</div>`;
      });
      optionsContainer.innerHTML = html;
      optionsContainer.querySelectorAll('.option-item').forEach(el => {
        el.addEventListener('click', function () {
          const nombre = this.dataset.nombre;
          input.value = nombre;
          optionsContainer.classList.remove('show');
          if (onSelect) onSelect({ id: this.dataset.id, nombre });
        });
      });
    }

    input.addEventListener('input', function () {
      const query = this.value;
      filterOptions(query);
      optionsContainer.classList.toggle('show', query.length > 0);
      // El usuario está escribiendo texto libre: mientras no elija una
      // opción de la lista, no hay proveedor "seleccionado" (id real).
      if (onSelect) onSelect(null);
    });

    input.addEventListener('focus', function () {
      if (this.value.length > 0) {
        filterOptions(this.value);
        optionsContainer.classList.add('show');
      } else if (currentOptions.length > 0) {
        renderOptions(currentOptions);
        optionsContainer.classList.add('show');
      }
    });

    input.addEventListener('blur', function () {
      setTimeout(() => optionsContainer.classList.remove('show'), 200);
    });

    document.addEventListener('click', function (e) {
      if (!combobox.contains(e.target)) optionsContainer.classList.remove('show');
    });

    function setOptions(list) { currentOptions = list || []; }
    function clear() { input.value = ''; optionsContainer.classList.remove('show'); }

    return { setOptions, clear, input };
  }

  /* ============================================================
     MODAL: NUEVO / EDITAR INSUMO
     ============================================================ */
  function llenarFormularioInsumo(ins) {
    document.getElementById("input-nombre").value = ins.nombre || "";
    document.getElementById("input-categoria").value = ins.categoria || "Carnes";
    document.getElementById("input-proveedor").value = ins.proveedor || "";
    document.getElementById("input-unidad").value = ins.unidad || "kg";
    document.getElementById("input-unidad-compra").value = ins.unidadCompra || "";
    document.getElementById("input-factor-conversion").value = ins.factorConversion || 1;
    document.getElementById("input-costo-compra").value = ins.costoCompra || 0;
    document.getElementById("input-stock").value = ins.cantidad || 0;
    document.getElementById("input-minimo").value = ins.minimo || 10;
    // El proveedor del insumo llega como texto guardado; se muestra tal
    // cual en el campo, pero no se marca como "seleccionado de la lista"
    // hasta que el usuario lo vuelva a elegir del buscador.
    proveedorSeleccionado = ins.proveedorId ? { id: ins.proveedorId, nombre: ins.proveedor || '' } : null;
    actualizarPreviaCostoUnitario();
  }

  function abrirModalNuevo() {
    insumoEditandoId = null;
    document.getElementById("insumo-modal-title").textContent = "Nuevo Insumo";
    document.getElementById("guardar-nuevo-insumo").textContent = "Guardar insumo";
    document.getElementById("label-input-stock").textContent = "Stock inicial";
    document.getElementById("form-nuevo-insumo").reset();
    document.getElementById("input-unidad").value = "kg";
    document.getElementById("input-factor-conversion").value = 1;
    proveedorSeleccionado = null;
    if (proveedorCombobox) proveedorCombobox.clear();
    actualizarPreviaCostoUnitario();
    document.getElementById("nuevo-insumo-modal").classList.add("open");
    document.getElementById("input-nombre").focus();

    cargarProveedores().then(data => {
      proveedores = data;
      if (proveedorCombobox) proveedorCombobox.setOptions(data);
    });
  }

  function abrirModalEditar(id) {
    const ins = insumos.find(i => i.id === id);
    if (!ins) return;
    insumoEditandoId = id;
    document.getElementById("insumo-modal-title").textContent = `Editar: ${ins.nombre || ''}`;
    document.getElementById("guardar-nuevo-insumo").textContent = "Guardar cambios";
    document.getElementById("label-input-stock").textContent = "Stock actual";
    llenarFormularioInsumo(ins);
    document.getElementById("nuevo-insumo-modal").classList.add("open");
    document.getElementById("input-nombre").focus();

    cargarProveedores().then(data => {
      proveedores = data;
      if (proveedorCombobox) proveedorCombobox.setOptions(data);
    });
  }

  function cerrarModalNuevo() {
    document.getElementById("nuevo-insumo-modal").classList.remove("open");
    document.getElementById("form-nuevo-insumo").reset();
    insumoEditandoId = null;
    proveedorSeleccionado = null;
    if (proveedorCombobox) proveedorCombobox.clear();
    actualizarPreviaCostoUnitario();
  }

  function actualizarPreviaCostoUnitario() {
    // Lo que se tipea en "Costo por unidad de compra" siempre se guarda
    // en Gs (igual que costoUnitario/costoCompra en el resto del
    // archivo), sin importar qué moneda esté elegida arriba en el
    // topbar — por eso se convierte acá antes de mostrarlo, igual que en
    // formatoMoneda().
    const costoCompra = parseFloat(document.getElementById("input-costo-compra").value) || 0;
    const factor = parseFloat(document.getElementById("input-factor-conversion").value) || 1;
    const costoUnitarioGs = factor > 0 ? costoCompra / factor : 0;
    const symbol = symbols[moneda] || "";
    const convertido = moneda === "Gs" ? costoUnitarioGs : costoUnitarioGs / rates[moneda];
    const maximoDecimales = moneda === "Gs" ? 0 : 2;
    document.getElementById("preview-costo-unitario").textContent =
      `${symbol}${convertido.toLocaleString('es-PY', { maximumFractionDigits: maximoDecimales })} / ${document.getElementById("input-unidad").value || 'unidad'}`;
  }

  async function guardarNuevoInsumo() {
    const nombre = document.getElementById("input-nombre").value.trim();
    const categoria = document.getElementById("input-categoria").value;
    const proveedor = document.getElementById("input-proveedor").value.trim();
    const unidad = document.getElementById("input-unidad").value.trim();
    const unidadCompra = document.getElementById("input-unidad-compra").value.trim();
    const factorConversion = parseFloat(document.getElementById("input-factor-conversion").value) || 1;
    const costoCompra = parseFloat(document.getElementById("input-costo-compra").value) || 0;
    const costoUnitario = factorConversion > 0 ? costoCompra / factorConversion : 0;
    const cantidad = parseInt(document.getElementById("input-stock").value) || 0;
    const minimo = parseInt(document.getElementById("input-minimo").value) || 0;

    if (!nombre) return alert("El nombre del insumo es obligatorio.");

    const datos = {
      nombre,
      categoria,
      proveedor,
      // Si el proveedor se eligió del buscador (y el texto no fue tocado
      // después), guardamos también su id para poder relacionarlo más
      // adelante; si el usuario escribió un nombre libre, queda en null.
      proveedorId: (proveedorSeleccionado && proveedorSeleccionado.nombre === proveedor) ? proveedorSeleccionado.id : null,
      unidad,
      unidadCompra,
      factorConversion,
      costoCompra,
      costoUnitario,
      cantidad,
      minimo,
      // Al editar un insumo VIEJO que todavía no tenía sucursalId (de
      // antes de este cambio), esto lo "reclama" para la sucursal desde
      // la que se está editando — así deja de mostrarse en todas y pasa a
      // pertenecer solo a esta, resolviendo la ambigüedad la primera vez
      // que alguien lo toca. Si ya tenía sucursalId, esto simplemente lo
      // reafirma (no cambia nada).
      sucursalId
    };

    try {
      if (insumoEditandoId) {
        // Si desde "Editar" se sube el stock a mano (en vez de usar el
        // carrito "Comprar"), es económicamente lo mismo que una compra:
        // entró más cantidad y salió plata. Antes esto no generaba
        // ningún gasto porque solo tocaba actualizarInsumo(). Ahora, si
        // el stock subió respecto al valor que tenía antes de abrir el
        // modal, se registra la diferencia como gasto también.
        const insumoAnterior = insumos.find(i => i.id === insumoEditandoId);
        const stockAnterior = insumoAnterior ? (insumoAnterior.cantidad || 0) : 0;
        const diferencia = cantidad - stockAnterior;

        await actualizarInsumo(insumoEditandoId, datos);

        if (diferencia > 0 && costoUnitario > 0) {
          const montoGastadoAjuste = diferencia * costoUnitario;
          const resultadoGasto = await crearGastoInventario(
            { id: insumoEditandoId, nombre, unidad, proveedor },
            diferencia,
            montoGastadoAjuste,
            'ajuste'
          );
          if (!resultadoGasto.ok) {
            alert(
              "El insumo se actualizó, pero no se pudo registrar el gasto por el aumento de stock en Reportes.\n\n" +
              "Detalle técnico: " + (resultadoGasto.error?.message || resultadoGasto.error)
            );
          }
        }
      } else {
        const nuevoId = await crearInsumo(datos);
        // El stock inicial también es plata real que salió para surtir el
        // insumo por primera vez — antes esto no dejaba rastro en
        // Reportes (a diferencia de una compra hecha con "Comprar/Reponer
        // stock", que sí lo hace desde el cambio anterior). Lo alineamos:
        // si cargaste stock inicial y tiene costo, también genera gasto.
        if (cantidad > 0 && costoUnitario > 0) {
          const montoGastadoInicial = cantidad * costoUnitario;
          const resultadoGasto = await crearGastoInventario(
            { id: nuevoId, nombre, unidad, proveedor },
            cantidad,
            montoGastadoInicial,
            'inicial'
          );
          if (!resultadoGasto.ok) {
            alert(
              "El insumo se guardó, pero no se pudo registrar el gasto del stock inicial en Reportes.\n\n" +
              "Detalle técnico: " + (resultadoGasto.error?.message || resultadoGasto.error)
            );
          }
        }
      }
      cerrarModalNuevo();
      await renderTodo();
    } catch (e) {
      alert("Error al guardar el insumo.");
    }
  }

  function initModalNuevo() {
    document.getElementById("btn-nuevo-insumo").addEventListener("click", abrirModalNuevo);
    document.getElementById("cierre-nuevo-insumo").addEventListener("click", cerrarModalNuevo);
    document.getElementById("cancelar-nuevo-insumo").addEventListener("click", cerrarModalNuevo);
    document.getElementById("guardar-nuevo-insumo").addEventListener("click", guardarNuevoInsumo);

    // Evita que el <form> recargue la página (el "salto" del modal)
    document.getElementById("form-nuevo-insumo").addEventListener("submit", function (e) {
      e.preventDefault();
    });

    // Recalcula el costo por unidad de uso en vivo
    ["input-costo-compra", "input-factor-conversion", "input-unidad"].forEach(id => {
      document.getElementById(id).addEventListener("input", actualizarPreviaCostoUnitario);
    });

    // Buscador de proveedor: al elegir uno de la lista queda "seleccionado"
    // (con su id); si el usuario sigue escribiendo, initComboboxProveedor
    // ya se encarga de poner proveedorSeleccionado en null.
    proveedorCombobox = initComboboxProveedor('proveedor-combobox', 'input-proveedor', 'proveedor-options-list', function (data) {
      proveedorSeleccionado = data;
    });

    const overlay = document.getElementById("nuevo-insumo-modal");
    overlay.addEventListener("click", function (e) { if (e.target === this) cerrarModalNuevo(); });
  }

  /* ============================================================
     MODAL: COMPRAR / REPONER STOCK
     ============================================================ */
  function actualizarVistaPreviaCompra() {
    if (!comprarTargetId) return;
    const insumo = insumos.find(i => i.id === comprarTargetId);
    if (!insumo) return;

    const input = document.getElementById("input-cantidad-comprar");
    let cantidad = parseInt(input.value) || 0;
    if (cantidad < 0) cantidad = 0;
    input.value = cantidad;

    const stockActual = insumo.cantidad || 0;
    const nuevoStock = stockActual + cantidad;
    document.getElementById("comprar-stock-final").textContent = nuevoStock;

    // Desglose explícito para que quede claro que el número grande es el
    // TOTAL resultante (stock actual + lo que se está agregando), no la
    // cantidad que se tipeó arriba — eso confundía cuando el stock actual
    // ya no era 0.
    const unidad = insumo.unidad || '';
    const desgloseEl = document.getElementById("comprar-desglose");
    if (desgloseEl) {
      desgloseEl.textContent = `${stockActual} ${unidad} actual + ${cantidad} ${unidad} agregado = ${nuevoStock} ${unidad}`;
    }

    const btnGuardar = document.getElementById("guardar-comprar-insumo");
    btnGuardar.disabled = cantidad <= 0;
  }

  function abrirModalComprar(id) {
    const insumo = insumos.find(i => i.id === id);
    if (!insumo) return;

    comprarTargetId = id;
    document.getElementById("comprar-nombre").textContent = insumo.nombre || '-';
    document.getElementById("comprar-categoria").textContent = insumo.categoria || '-';
    document.getElementById("comprar-proveedor").textContent = insumo.proveedor || '-';
    document.getElementById("comprar-stock-actual").textContent = insumo.cantidad || 0;
    document.getElementById("comprar-unidad").textContent = insumo.unidad || '';
    document.getElementById("input-cantidad-comprar").value = 0;

    actualizarVistaPreviaCompra();
    document.getElementById("comprar-insumo-modal").classList.add("open");
  }

  function cerrarModalComprar() {
    document.getElementById("comprar-insumo-modal").classList.remove("open");
    comprarTargetId = null;
  }

  async function guardarCompra() {
    if (!comprarTargetId) return;
    const insumo = insumos.find(i => i.id === comprarTargetId);
    if (!insumo) return;

    const input = document.getElementById("input-cantidad-comprar");
    let cantidadAAgregar = parseInt(input.value) || 0;
    if (cantidadAAgregar <= 0) return alert("La cantidad debe ser mayor a 0.");

    const nuevoTotal = insumo.cantidad + cantidadAAgregar;
    // Gasto de esta compra: cantidad agregada × costo por unidad de uso
    // (el mismo costoUnitario que se calcula en el modal de Nuevo Insumo,
    // ya expresado en la unidad "kg"/"L"/etc. con la que se mide el stock).
    const montoGastado = cantidadAAgregar * (insumo.costoUnitario || 0);

    try {
      await actualizarStockInsumo(comprarTargetId, nuevoTotal);
      // Solo dejamos rastro en Reportes si hay un costo cargado — evita
      // llenar la tabla de gastos con filas en Gs. 0 para insumos a los
      // que todavía no se les puso costo.
      if (montoGastado > 0) {
        const resultadoGasto = await crearGastoInventario(insumo, cantidadAAgregar, montoGastado);
        if (!resultadoGasto.ok) {
          // El stock SÍ se actualizó; lo que falló fue solo el registro
          // contable. Avisamos para que no quede pasando desapercibido
          // (por ejemplo, si son las reglas de seguridad de Firestore las
          // que están bloqueando la escritura en 'gastos').
          alert(
            "El stock se actualizó, pero no se pudo guardar el gasto en Reportes.\n\n" +
            "Detalle técnico: " + (resultadoGasto.error?.message || resultadoGasto.error) + "\n\n" +
            "Si el error menciona \"permission\" o \"insufficient permissions\", hay que habilitar " +
            "en las reglas de seguridad de Firestore que los usuarios autenticados puedan crear " +
            "documentos en la colección 'gastos'."
          );
        }
      }
      cerrarModalComprar();
      await renderTodo();
    } catch (e) {
      alert("Error al registrar la compra.");
    }
  }

  function initModalComprar() {
    const inputCantidad = document.getElementById("input-cantidad-comprar");

    document.querySelectorAll(".btn-inc").forEach(btn => {
      btn.addEventListener("click", function() {
        let currentVal = parseInt(inputCantidad.value) || 0;
        const increment = parseInt(this.getAttribute("data-val"));
        inputCantidad.value = currentVal + increment;
        actualizarVistaPreviaCompra();
      });
    });

    inputCantidad.addEventListener("input", actualizarVistaPreviaCompra);

    document.getElementById("cierre-comprar-insumo").addEventListener("click", cerrarModalComprar);
    document.getElementById("cancelar-comprar-insumo").addEventListener("click", cerrarModalComprar);
    document.getElementById("guardar-comprar-insumo").addEventListener("click", guardarCompra);

    const overlay = document.getElementById("comprar-insumo-modal");
    overlay.addEventListener("click", function (e) { if (e.target === this) cerrarModalComprar(); });
  }

  /* ============================================================
     MODAL: REGISTRAR SALIDA (sin venta)
     ------------------------------------------------------------
     Para lo que sale del stock sin venderse: consumo del personal,
     cortesías, vencido o roto. Descuenta el stock y deja el
     movimiento guardado en "movimientos_inventario" (con su motivo
     y su valor a costo). NO se registra como gasto: ese gasto ya se
     anotó cuando se compró el insumo.
     El modal se crea desde acá, así no hace falta tocar el HTML.
     ============================================================ */
  function asegurarModalSalida() {
    if (document.getElementById("salida-insumo-modal")) return;

    const style = document.createElement("style");
    style.id = "salida-insumo-style";
    style.textContent = `
      .action-btn-salida:hover { border-color: #ea580c !important; color: #ea580c !important; background: #fff7ed !important; }
      #salida-insumo-modal .modal-card { max-width: 460px; width: 95%; }
      #salida-insumo-modal .salida-info { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
        padding: 12px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; gap: 10px; }
      #salida-insumo-modal .salida-info strong { font-size: 15px; }
      #salida-insumo-modal label { display: block; font-size: 13px; font-weight: 600; color: #4b5563; margin: 0 0 6px; }
      #salida-insumo-modal input, #salida-insumo-modal select { width: 100%; box-sizing: border-box; padding: 10px 12px;
        border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; font-family: inherit; margin-bottom: 14px; }
      #salida-insumo-modal .salida-rapidos { display: flex; gap: 8px; margin: -6px 0 14px; }
      #salida-insumo-modal .salida-rapidos button { flex: 1; padding: 7px 0; border: 1px solid #fdba74; background: #fff7ed;
        color: #9a3412; border-radius: 8px; font-weight: 700; cursor: pointer; }
      #salida-insumo-modal .salida-resultado { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;
        padding: 12px 14px; text-align: center; color: #9a3412; font-size: 14px; }
      #salida-insumo-modal .salida-resultado strong { font-size: 20px; display: block; color: #7c2d12; }
      #salida-insumo-modal .salida-error { color: #b91c1c; font-size: 13px; font-weight: 600; min-height: 18px; margin-top: 8px; text-align: center; }
      #salida-insumo-modal .modal-actions { justify-content: flex-end; }
      #salida-insumo-modal .modal-actions .btn { flex: 0 0 auto; min-width: 130px; }
      #salida-cancelar { background: #6b7280 !important; border-color: #6b7280 !important; color: #fff !important; }
      #salida-guardar { background: #ea580c !important; border-color: #ea580c !important; color: #fff !important; }
      #salida-guardar:disabled { opacity: .55; cursor: not-allowed; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "salida-insumo-modal";
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <h3>Registrar salida</h3>
          <button class="modal-close" id="salida-cerrar" type="button">&times;</button>
        </div>
        <div class="modal-body">
          <div class="salida-info">
            <span>Insumo: <strong id="salida-nombre">—</strong></span>
            <span>Stock: <strong id="salida-stock">0</strong></span>
          </div>
          <label for="salida-cantidad">¿Cuánto salió?</label>
          <input type="number" id="salida-cantidad" min="0" step="0.01" value="1">
          <div class="salida-rapidos">
            <button type="button" data-val="1">1</button><button type="button" data-val="2">2</button>
            <button type="button" data-val="5">5</button><button type="button" data-val="10">10</button>
          </div>
          <label for="salida-motivo">Motivo</label>
          <select id="salida-motivo">
            <option value="Consumo de personal">Consumo de personal</option>
            <option value="Cortesía">Cortesía</option>
            <option value="Vencido / roto">Vencido / roto</option>
            <option value="Otro">Otro</option>
          </select>
          <label for="salida-detalle">Detalle (opcional)</label>
          <input type="text" id="salida-detalle" placeholder="Ej.: almuerzo de los mozos" autocomplete="off">
          <div class="salida-resultado">Después de la salida quedan<strong id="salida-quedan">0</strong></div>
          <div class="salida-error" id="salida-error"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="salida-cancelar" type="button">Cancelar</button>
          <button class="btn" id="salida-guardar" type="button">Registrar salida</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cantidad = document.getElementById("salida-cantidad");
    cantidad.addEventListener("input", actualizarVistaSalida);
    overlay.querySelectorAll(".salida-rapidos button").forEach(b => b.addEventListener("click", () => {
      cantidad.value = b.dataset.val; actualizarVistaSalida(); cantidad.focus();
    }));
    document.getElementById("salida-cerrar").addEventListener("click", cerrarModalSalida);
    document.getElementById("salida-cancelar").addEventListener("click", cerrarModalSalida);
    document.getElementById("salida-guardar").addEventListener("click", guardarSalida);
    overlay.addEventListener("click", e => { if (e.target === overlay) cerrarModalSalida(); });
    overlay.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); guardarSalida(); }
      if (e.key === "Escape") cerrarModalSalida();
    });
  }

  function actualizarVistaSalida() {
    const insumo = insumos.find(i => i.id === salidaTargetId);
    if (!insumo) return;
    const cant = parseFloat(document.getElementById("salida-cantidad").value) || 0;
    const stock = Number(insumo.cantidad) || 0;
    const quedan = stock - cant;
    document.getElementById("salida-quedan").textContent = `${Math.max(0, +quedan.toFixed(2))} ${insumo.unidad || ''}`;
    const errorEl = document.getElementById("salida-error");
    const btn = document.getElementById("salida-guardar");
    if (cant <= 0) { errorEl.textContent = ""; btn.disabled = true; }
    else if (quedan < 0) { errorEl.textContent = `No hay tanto stock: hay ${stock} ${insumo.unidad || ''}.`; btn.disabled = true; }
    else { errorEl.textContent = ""; btn.disabled = false; }
  }

  function abrirModalSalida(id) {
    const insumo = insumos.find(i => i.id === id);
    if (!insumo) return;
    asegurarModalSalida();
    salidaTargetId = id;
    document.getElementById("salida-nombre").textContent = insumo.nombre || "—";
    document.getElementById("salida-stock").textContent = `${insumo.cantidad || 0} ${insumo.unidad || ''}`;
    document.getElementById("salida-cantidad").value = 1;
    document.getElementById("salida-motivo").selectedIndex = 0;
    document.getElementById("salida-detalle").value = "";
    const btn = document.getElementById("salida-guardar");
    btn.textContent = "Registrar salida";
    actualizarVistaSalida();
    document.getElementById("salida-insumo-modal").classList.add("open");
    setTimeout(() => document.getElementById("salida-cantidad").select(), 50);
  }

  function cerrarModalSalida() {
    const overlay = document.getElementById("salida-insumo-modal");
    if (overlay) overlay.classList.remove("open");
    salidaTargetId = null;
  }

  async function guardarSalida() {
    const insumo = insumos.find(i => i.id === salidaTargetId);
    if (!insumo) return;
    const btn = document.getElementById("salida-guardar");
    if (btn.disabled) return;
    const cant = parseFloat(document.getElementById("salida-cantidad").value) || 0;
    const stock = Number(insumo.cantidad) || 0;
    if (cant <= 0 || cant > stock) return;
    const nuevoStock = +(stock - cant).toFixed(2);
    const motivo = document.getElementById("salida-motivo").value;
    const detalle = document.getElementById("salida-detalle").value.trim();

    btn.disabled = true;
    btn.textContent = "Registrando...";
    try {
      await actualizarStockInsumo(insumo.id, nuevoStock);
    } catch (e) {
      document.getElementById("salida-error").textContent = "No se pudo descontar el stock. Intentá de nuevo.";
      btn.disabled = false; btn.textContent = "Registrar salida";
      return;
    }

    // Historial del movimiento (no es un gasto: el gasto ya se anotó al comprar)
    try {
      const ahora = new Date();
      await db.collection('movimientos_inventario').add({
        empresaId, sucursalId,
        tipo: 'salida',
        motivo, detalle,
        insumoId: insumo.id,
        insumoNombre: insumo.nombre || '',
        cantidad: cant,
        unidad: insumo.unidad || '',
        costoUnitario: insumo.costoUnitario || 0,
        valor: cant * (insumo.costoUnitario || 0),
        stockAnterior: stock,
        stockNuevo: nuevoStock,
        usuario: sesionActual?.nombre || '',
        fecha: ahora.toISOString().slice(0, 10),
        created_at: ahora.toISOString()
      });
    } catch (e) {
      console.error("No se pudo guardar el historial de la salida:", e);
      alert("El stock se descontó, pero no se pudo guardar el historial de la salida.\n\n" +
        "Si el error dice \"permission\", hay que permitir en las reglas de Firestore la colección 'movimientos_inventario'.\n\n" +
        "Detalle: " + (e?.message || e));
    }

    cerrarModalSalida();
    await renderTodo();
  }

  /* ============================================================
     MODAL: CONFIRMAR ELIMINACIÓN
     ============================================================ */
  function confirmarEliminarInsumo(id) {
    idEliminarInsumo = id;
    const insumo = insumos.find(i => i.id === id);
    if (!insumo) return;
    document.getElementById("confirm-eliminar-title").textContent = `¿Eliminar "${insumo.nombre}"?`;
    document.getElementById("confirm-eliminar-text").textContent = "Esta acción no se puede deshacer.";
    document.getElementById("confirm-eliminar-insumo-modal").classList.add("open");
  }

  function cerrarConfirmacionEliminar() {
    document.getElementById("confirm-eliminar-insumo-modal").classList.remove("open");
    idEliminarInsumo = null;
  }

  async function eliminarInsumoConfirmado() {
    if (!idEliminarInsumo) return;
    try {
      await eliminarInsumoDeFirebase(idEliminarInsumo);
      cerrarConfirmacionEliminar();
      await renderTodo();
    } catch (e) {
      alert("Error al eliminar el insumo.");
    }
  }

  function initModalEliminar() {
    document.getElementById("confirm-eliminar-cancel").addEventListener("click", cerrarConfirmacionEliminar);
    document.getElementById("confirm-eliminar-accept").addEventListener("click", eliminarInsumoConfirmado);
    const overlay = document.getElementById("confirm-eliminar-insumo-modal");
    overlay.addEventListener("click", function (e) { if (e.target === this) cerrarConfirmacionEliminar(); });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.classList.contains("open")) cerrarConfirmacionEliminar();
    });
  }

  /* ============================================================
     EVENTOS DE BÚSQUEDA Y FILTROS
     ============================================================ */
  function initSearch() {
    document.getElementById("insumo-search").addEventListener("input", renderTabla);
  }

  function initFilters() {
    document.getElementById("filter-categoria").addEventListener("change", renderTabla);
  }

  function initCurrencyToggle() {
    const container = document.getElementById("currency-toggle");
    if (!container) return;
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", function () {
        container.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        moneda = this.getAttribute("data-currency");
        renderTabla(); // Refresca los costos con la nueva moneda
      });
    });
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  /* ============================================================
     INICIALIZACIÓN FINAL
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    initModalNuevo();
    initModalComprar();
    initModalEliminar();
    initSearch();
    initFilters();
    initCurrencyToggle();
    initAmbiguo();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    sucursalId = sesionActual.sucursalId;
    renderTodo();

    // Actualización cada 30 segundos para mantener el inventario fresco
    if (!window.__gastroInventarioInterval) {
      window.__gastroInventarioInterval = setInterval(renderTodo, 30000);
    }
  });
})();

/* ==============================================================
   INVENTARIO RÁPIDO (agregado)
   --------------------------------------------------------------
   • "Nuevo / Editar insumo" en pantalla completa, con las 3
     secciones lado a lado (sin scroll en computadora).
   • Enter guarda el insumo (menos en Proveedor, para poder elegir
     de la lista) y Esc cancela.
   • Desde el acceso rápido del Panel principal
     (inventario.html?nuevo=1) se abre directo "Nuevo insumo".
   No cambia nada de cómo se guardan los insumos.
   ============================================================== */
(function () {
  "use strict";

  function estilosInsumoGrande() {
    if (document.getElementById("insumo-grande-style")) return;
    const style = document.createElement("style");
    style.id = "insumo-grande-style";
    style.textContent = `
      #nuevo-insumo-modal { padding: 0 !important; align-items: stretch !important; justify-content: stretch !important; }
      #nuevo-insumo-modal .modal-card {
        width: 100vw !important; max-width: 100vw !important; height: 100vh !important; max-height: 100vh !important;
        border-radius: 0 !important; margin: 0 !important; display: flex !important; flex-direction: column !important;
      }
      #nuevo-insumo-modal .modal-head { background: #0369a1; flex-shrink: 0; padding: 14px 24px !important; }
      #nuevo-insumo-modal .modal-head h3 { color: #fff !important; font-size: 20px !important; }
      #nuevo-insumo-modal .modal-close { color: #fff !important; }
      #nuevo-insumo-modal .modal-body { flex: 1 1 auto; overflow-y: auto; padding: 20px 24px !important; }
      #form-nuevo-insumo {
        max-width: 1320px; margin: 0 auto; display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start;
      }
      #form-nuevo-insumo .form-section { margin: 0 !important; padding: 18px 20px !important; }
      #form-nuevo-insumo .form-section-title { margin-bottom: 12px; }
      #form-nuevo-insumo .form-grid { grid-template-columns: 1fr !important; gap: 12px !important; margin-bottom: 12px !important; }
      #form-nuevo-insumo .form-section:nth-child(2) .form-grid { grid-template-columns: 1fr 1fr !important; }
      #form-nuevo-insumo .form-grid:last-child { margin-bottom: 0 !important; }
      #form-nuevo-insumo .field input, #form-nuevo-insumo .field select { padding: 10px 12px; }
      #form-nuevo-insumo .costo-preview { margin-top: 12px; }
      #nuevo-insumo-modal .modal-actions {
        flex-shrink: 0; display: flex; justify-content: flex-end; gap: 10px;
        padding: 12px 24px !important; border-top: 1px solid #e5e7eb; background: #fbfbfc;
      }
      #nuevo-insumo-modal .modal-actions .btn { flex: 0 0 auto !important; min-width: 150px; padding: 11px 22px; }
      #cancelar-nuevo-insumo { background: #6b7280 !important; border-color: #6b7280 !important; color: #fff !important; }
      .insumo-ayuda { margin-right: auto; align-self: center; font-size: 12.5px; color: #6b7280; }
      @media (max-width: 1000px) {
        #form-nuevo-insumo { grid-template-columns: 1fr; }
        #form-nuevo-insumo .form-section:nth-child(2) .form-grid { grid-template-columns: 1fr !important; }
        .insumo-ayuda { display: none; }
      }
    `;
    document.head.appendChild(style);

    const acciones = document.querySelector("#nuevo-insumo-modal .modal-actions");
    if (acciones && !acciones.querySelector(".insumo-ayuda")) {
      acciones.insertAdjacentHTML("afterbegin", '<span class="insumo-ayuda">Enter para guardar · Esc para cancelar</span>');
    }
  }

  function atajosTeclado() {
    const form = document.getElementById("form-nuevo-insumo");
    const overlay = document.getElementById("nuevo-insumo-modal");
    if (!form || !overlay) return;

    form.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (!t || t.tagName !== "INPUT") return;
      e.preventDefault();
      if (t.id === "input-proveedor") return; // en Proveedor, Enter no guarda
      document.getElementById("guardar-nuevo-insumo")?.click();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) {
        document.getElementById("cancelar-nuevo-insumo")?.click();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    estilosInsumoGrande();
    atajosTeclado();
  });

  document.addEventListener("sesionLista", function () {
    const params = new URLSearchParams(window.location.search);
    if (params.get("nuevo") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      setTimeout(() => document.getElementById("btn-nuevo-insumo")?.click(), 0);
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