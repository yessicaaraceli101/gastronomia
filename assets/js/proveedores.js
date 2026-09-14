(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  let proveedores = [];
  let proveedoresFiltrados = [];
  let pagina = 1;
  let editingProveedorId = null; // Para saber si estamos editando

  /* ============================================================
     FUNCIONES DE FIREBASE
     ============================================================ */
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

  async function guardarProveedorFirestore(datos) {
    try {
      datos.empresaId = empresaId;

      if (editingProveedorId) {
        // Si estamos editando, actualizamos el documento
        await db.collection('proveedores').doc(editingProveedorId).update(datos);
      } else {
        // Si es nuevo, creamos el documento
        await db.collection('proveedores').add(datos);
      }
    } catch (error) {
      console.error("Error al guardar en Firestore:", error);
      throw error;
    }
  }

  async function eliminarProveedor(id) {
    try {
      await db.collection('proveedores').doc(id).delete();
      console.log(`Proveedor ${id} eliminado.`);
    } catch (error) {
      console.error("Error al eliminar:", error);
      throw error;
    }
  }

  /* ============================================================
     RENDERIZADO
     ============================================================ */
  function renderHeader() {
    if (!sesionActual) return;
    const branchDate = document.getElementById("branch-date");
    if (branchDate) branchDate.textContent = `${sesionActual.sucursalNombre} · Base de proveedores del restaurante`;
  }

  // Íconos
  const ICON_EDIT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const ICON_DELETE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

  function renderTabla() {
    const tbody = document.getElementById("proveedores-body");
    if (!tbody) return;

    // Filtros
    const term = document.getElementById("proveedor-search")?.value?.toLowerCase() || "";

    proveedoresFiltrados = proveedores.filter(p => {
      const nombreMatch = (p.nombre || "").toLowerCase().includes(term);
      return nombreMatch;
    });

    // Paginación
    const PAGE_SIZE = 8;
    const totalPages = Math.max(1, Math.ceil(proveedoresFiltrados.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = proveedoresFiltrados.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No hay proveedores registrados.</td></tr>`;
    } else {
      pageItems.forEach(p => {
        const tr = document.createElement("tr");
        const lastVisit = p.ultima_visita ? new Date(p.ultima_visita).toLocaleDateString('es-PY') : '—';

        tr.innerHTML = `
          <td><strong>${p.nombre || '—'}</strong></td>
          <td>${p.telefono || '—'}</td>
          <td>${p.email || '—'}</td>
          <td>${p.ci_ruc || '—'}</td>
          <td class="text-center">${p.visitas || 0}</td>
          <td>${lastVisit}</td>
          <td style="display: flex; gap: 6px; justify-content: center; align-items: center;">
            <button class="btn-accion editar" data-id="${p.id}" title="Editar">${ICON_EDIT}</button>
            <button class="btn-accion eliminar" data-id="${p.id}" title="Eliminar">${ICON_DELETE}</button>
          </td>
        `;

        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditar(p.id));
        tr.querySelector(".eliminar").addEventListener("click", () => abrirConfirmacionEliminar(p.id));
        tbody.appendChild(tr);
      });
    }

    document.getElementById("page-label").textContent = `Página ${pagina} de ${totalPages}`;
    document.getElementById("prev-page").disabled = pagina <= 1;
    document.getElementById("next-page").disabled = pagina >= totalPages;
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    const todos = await cargarProveedores();
    proveedores = todos;
    renderHeader();
    renderTabla();
  }

  /* ============================================================
     MODAL: NUEVO / EDITAR
     ============================================================ */
  function abrirModalNuevo() {
    editingProveedorId = null;
    document.getElementById("modal-title").textContent = "Nuevo proveedor";
    document.getElementById("modal-sub").textContent = "Ingresa los datos del nuevo proveedor.";

    document.getElementById("modal-overlay").classList.add("open");
    document.getElementById("f-name").focus();
    limpiarFormulario();
  }

  function abrirModalEditar(id) {
    const proveedor = proveedores.find(p => p.id === id);
    if (!proveedor) return;

    editingProveedorId = id;
    document.getElementById("modal-title").textContent = "Editar proveedor";
    document.getElementById("modal-sub").textContent = "Actualiza los datos del proveedor.";

    document.getElementById("f-name").value = proveedor.nombre || '';
    document.getElementById("f-phone").value = proveedor.telefono || '';
    document.getElementById("f-email").value = proveedor.email || '';
    document.getElementById("f-ci").value = proveedor.ci_ruc || '';
    document.getElementById("f-visits").value = proveedor.visitas || 0;
    document.getElementById("f-last-visit").value = proveedor.ultima_visita || '';

    document.getElementById("modal-overlay").classList.add("open");
  }

  function limpiarFormulario() {
    document.getElementById("f-name").value = '';
    document.getElementById("f-phone").value = '';
    document.getElementById("f-email").value = '';
    document.getElementById("f-ci").value = '';
    document.getElementById("f-visits").value = 0;
    document.getElementById("f-last-visit").value = '';
  }

  function cerrarModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    editingProveedorId = null;
  }

  async function guardarProveedor() {
    const nombre = document.getElementById("f-name").value.trim();
    const telefono = document.getElementById("f-phone").value.trim();
    const email = document.getElementById("f-email").value.trim();
    const ci_ruc = document.getElementById("f-ci").value.trim();
    const visitas = parseInt(document.getElementById("f-visits").value) || 0;
    const ultima_visita = document.getElementById("f-last-visit").value;

    if (!nombre) return alert("El nombre es obligatorio.");

    const datosProveedor = { nombre, telefono, email, ci_ruc, visitas, ultima_visita };

    const saveBtn = document.getElementById("modal-save");
    saveBtn.disabled = true;

    try {
      await guardarProveedorFirestore(datosProveedor);
      cerrarModal();
      await renderTodo();
    } catch (error) {
      alert("Error al guardar el proveedor.");
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ============================================================
     CONFIRMACIÓN ELIMINAR
     ============================================================ */
  let deleteTargetId = null;

  function abrirConfirmacionEliminar(id) {
    deleteTargetId = id;
    const proveedor = proveedores.find(p => p.id === id);
    document.getElementById("confirm-title").textContent = `¿Eliminar a ${proveedor?.nombre || 'este proveedor'}?`;
    document.getElementById("confirm-text").textContent = "Se eliminará permanentemente de la base de datos.";
    document.getElementById("confirm-overlay").classList.add("open");
  }

  function cerrarConfirmacion() {
    document.getElementById("confirm-overlay").classList.remove("open");
    deleteTargetId = null;
  }

  async function aceptarEliminar() {
    if (!deleteTargetId) return;
    const btn = document.getElementById("confirm-accept");
    btn.disabled = true;
    try {
      await eliminarProveedor(deleteTargetId);
      cerrarConfirmacion();
      await renderTodo();
    } catch (error) {
      alert("Error al eliminar el proveedor.");
    } finally {
      btn.disabled = false;
    }
  }

  /* ============================================================
     EVENTOS Y LISTENERS
     ============================================================ */
  function initModals() {
    document.getElementById("add-proveedor-btn").addEventListener("click", abrirModalNuevo);
    document.getElementById("modal-close").addEventListener("click", cerrarModal);
    document.getElementById("modal-cancel").addEventListener("click", cerrarModal);
    document.getElementById("modal-save").addEventListener("click", guardarProveedor);
    document.getElementById("modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarModal();
    });

    document.getElementById("confirm-cancel").addEventListener("click", cerrarConfirmacion);
    document.getElementById("confirm-accept").addEventListener("click", aceptarEliminar);
    document.getElementById("confirm-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarConfirmacion();
    });
  }

  function initSearch() {
    document.getElementById("proveedor-search").addEventListener("input", () => {
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

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  /* ============================================================
     INICIALIZACIÓN FINAL
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    initModals();
    initSearch();
    initPagination();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    pagina = 1;
    renderTodo();
  });
})();