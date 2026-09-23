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
            </div>
          </td>
        `;

        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditar(ins.id));
        tr.querySelector(".eliminar").addEventListener("click", () => confirmarEliminarInsumo(ins.id));
        tr.querySelector(".comprar").addEventListener("click", () => abrirModalComprar(ins.id));
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