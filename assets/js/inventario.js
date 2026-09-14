(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  let moneda = "Gs";
  let insumos = [];
  let insumosFiltrados = [];
  let comprarTargetId = null;
  let insumoEditandoId = null; // null = creando nuevo insumo, si tiene valor = editando
  let idEliminarInsumo = null;

  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

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
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar insumos:", error);
      return [];
    }
  }

  async function crearInsumo(datos) {
    try {
      datos.empresaId = empresaId; // Asignar automáticamente la empresa activa
      await db.collection('insumos').add(datos);
      console.log("Insumo creado correctamente");
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

  function formatoMoneda(valor) {
    const symbol = symbols[moneda] || "";
    const num = Number(valor) || 0;
    return `${symbol}${num.toLocaleString('es-PY', { maximumFractionDigits: 2 })}`;
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
    actualizarPreviaCostoUnitario();
    document.getElementById("nuevo-insumo-modal").classList.add("open");
    document.getElementById("input-nombre").focus();
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
  }

  function cerrarModalNuevo() {
    document.getElementById("nuevo-insumo-modal").classList.remove("open");
    document.getElementById("form-nuevo-insumo").reset();
    insumoEditandoId = null;
    actualizarPreviaCostoUnitario();
  }

  function actualizarPreviaCostoUnitario() {
    const costoCompra = parseFloat(document.getElementById("input-costo-compra").value) || 0;
    const factor = parseFloat(document.getElementById("input-factor-conversion").value) || 1;
    const costoUnitario = factor > 0 ? costoCompra / factor : 0;
    const symbol = symbols[moneda] || "";
    document.getElementById("preview-costo-unitario").textContent =
      `${symbol}${costoUnitario.toLocaleString('es-PY', { maximumFractionDigits: 2 })} / ${document.getElementById("input-unidad").value || 'unidad'}`;
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
      unidad,
      unidadCompra,
      factorConversion,
      costoCompra,
      costoUnitario,
      cantidad,
      minimo
    };

    try {
      if (insumoEditandoId) {
        await actualizarInsumo(insumoEditandoId, datos);
      } else {
        await crearInsumo(datos);
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

    const nuevoStock = insumo.cantidad + cantidad;
    document.getElementById("comprar-stock-final").textContent = nuevoStock;

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

    try {
      await actualizarStockInsumo(comprarTargetId, nuevoTotal);
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
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    renderTodo();

    // Actualización cada 30 segundos para mantener el inventario fresco
    if (!window.__gastroInventarioInterval) {
      window.__gastroInventarioInterval = setInterval(renderTodo, 30000);
    }
  });
})();