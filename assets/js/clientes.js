(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>';

  let pagina = 1;
  let filtro = "";
  let clientes = [];
  let clienteEditandoId = null;

  const PAGE_SIZE = 6;

  function formatearFecha(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function getInitials(name) {
    return name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
  }

  /* ============================================================
     FIREBASE: CRUD de clientes
     ============================================================ */
  async function cargarClientesDesdeFirebase() {
    try {
      const snapshot = await db.collection('clientes')
        .where('empresaId', '==', empresaId)
        .get();
      const lista = [];
      snapshot.forEach(doc => {
        lista.push({ id: doc.id, ...doc.data() });
      });
      return lista;
    } catch (error) {
      console.error("❌ Error al cargar clientes:", error);
      return [];
    }
  }

  async function guardarClienteEnFirebase(cliente) {
    try {
      await db.collection('clientes').doc(cliente.id).set(cliente);
      console.log("✅ Cliente guardado:", cliente.id);
    } catch (error) {
      console.error("❌ Error al guardar cliente:", error);
      throw error;
    }
  }

  async function eliminarClienteDeFirebase(id) {
    try {
      await db.collection('clientes').doc(id).delete();
      console.log("✅ Cliente eliminado:", id);
    } catch (error) {
      console.error("❌ Error al eliminar cliente:", error);
      throw error;
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderHeader() {
    if (!sesionActual) return;
    const branchDate = document.getElementById("branch-date");
    if (branchDate) branchDate.textContent = `${sesionActual.sucursalNombre} · Base de clientes del restaurante`;
  }

  function renderTabla() {
    const tbody = document.getElementById("clientes-body");
    const term = filtro.trim().toLowerCase();
    const filtrados = clientes.filter(c =>
      c.name.toLowerCase().includes(term) ||
      (c.ciRuc || "").toLowerCase().includes(term) ||
      (c.phone || "").includes(term) ||
      (c.email || "").toLowerCase().includes(term)
    );
    const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = filtrados.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No se encontraron clientes.</td></tr>`;
    } else {
      pageItems.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div class="client-avatar">
              <div class="avatar-sm">${getInitials(c.name)}</div>
              <span class="client-name">${c.name}</span>
            </div>
          </td>
          <td>${c.phone || "—"}</td>
          <td>${c.email || "—"}</td>
          <td>${c.ciRuc || "—"}</td>
          <td class="text-center">${c.visits || 0}</td>
          <td>${formatearFecha(c.lastVisit)}</td>
          <td class="col-actions">
            <div class="row-actions">
              <button type="button" class="action-btn" data-action="edit" data-id="${c.id}" aria-label="Editar">${ICON_EDIT}</button>
              <button type="button" class="action-btn action-btn-danger" data-action="delete" data-id="${c.id}" aria-label="Eliminar">${ICON_DELETE}</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    document.getElementById("page-label").textContent = `Página ${pagina} de ${totalPages}`;
    document.getElementById("prev-page").disabled = pagina <= 1;
    document.getElementById("next-page").disabled = pagina >= totalPages;
  }

  function onTableClick(e) {
    const btn = e.target.closest(".action-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "edit") abrirModalEditar(id);
    else if (action === "delete") confirmarEliminar(id);
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    clientes = await cargarClientesDesdeFirebase();
    renderHeader();
    renderTabla();
  }

  /* ============================================================
     MODAL: Nuevo / Editar
     ============================================================ */
  function abrirModalNuevo() {
    clienteEditandoId = null;
    document.getElementById("modal-title").textContent = "Nuevo cliente";
    document.getElementById("modal-sub").textContent = `${sesionActual.empresaNombre} · ${sesionActual.sucursalNombre}`;
    document.getElementById("f-name").value = "";
    document.getElementById("f-ci").value = "";
    document.getElementById("f-phone").value = "";
    document.getElementById("f-email").value = "";
    document.getElementById("f-visits").value = 0;
    document.getElementById("f-last-visit").value = "";
    document.getElementById("modal-overlay").classList.add("open");
  }

  function abrirModalEditar(id) {
    const cliente = clientes.find(c => c.id === id);
    if (!cliente) return;
    clienteEditandoId = id;
    document.getElementById("modal-title").textContent = `Editar: ${cliente.name}`;
    document.getElementById("modal-sub").textContent = `${sesionActual.empresaNombre} · ${sesionActual.sucursalNombre}`;
    document.getElementById("f-name").value = cliente.name;
    document.getElementById("f-ci").value = cliente.ciRuc || "";
    document.getElementById("f-phone").value = cliente.phone || "";
    document.getElementById("f-email").value = cliente.email || "";
    document.getElementById("f-visits").value = cliente.visits || 0;
    document.getElementById("f-last-visit").value = cliente.lastVisit || "";
    document.getElementById("modal-overlay").classList.add("open");
  }

  function cerrarModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    clienteEditandoId = null;
  }

  function guardarCliente() {
    const name = document.getElementById("f-name").value.trim();
    const ciRuc = document.getElementById("f-ci").value.trim();
    const phone = document.getElementById("f-phone").value.trim();
    const email = document.getElementById("f-email").value.trim();
    const visits = parseInt(document.getElementById("f-visits").value) || 0;
    const lastVisit = document.getElementById("f-last-visit").value;

    if (!name) {
      alert("El nombre del cliente es obligatorio.");
      return;
    }

    const cliente = {
      empresaId: empresaId,
      name,
      ciRuc: ciRuc || "",
      phone: phone || "",
      email: email || "",
      visits: visits,
      lastVisit: lastVisit || ""
    };

    cliente.id = clienteEditandoId ? clienteEditandoId : "cli-" + Date.now();

    guardarClienteEnFirebase(cliente).then(() => {
      cerrarModal();
      renderTodo();
    }).catch(err => alert("Error al guardar: " + err.message));
  }

  /* ============================================================
     ELIMINAR (confirmación)
     ============================================================ */
  let idEliminar = null;

  function confirmarEliminar(id) {
    idEliminar = id;
    const cliente = clientes.find(c => c.id === id);
    if (!cliente) return;
    document.getElementById("confirm-title").textContent = `¿Eliminar "${cliente.name}"?`;
    document.getElementById("confirm-text").textContent = "Esta acción no se puede deshacer.";
    document.getElementById("confirm-overlay").classList.add("open");
  }

  function cerrarConfirmacion() {
    document.getElementById("confirm-overlay").classList.remove("open");
    idEliminar = null;
  }

  function eliminarCliente() {
    if (!idEliminar) return;
    eliminarClienteDeFirebase(idEliminar).then(() => {
      cerrarConfirmacion();
      renderTodo();
    }).catch(err => alert("Error al eliminar: " + err.message));
  }

  /* ============================================================
     INICIALIZADORES (búsqueda, paginación, modales)
     ============================================================ */
  function initSearch() {
    const input = document.getElementById("client-search");
    input.addEventListener("input", function () {
      filtro = this.value;
      pagina = 1;
      renderTabla();
    });
  }

  function initPagination() {
    document.getElementById("prev-page").addEventListener("click", () => {
      if (pagina > 1) { pagina--; renderTabla(); }
    });
    document.getElementById("next-page").addEventListener("click", () => {
      pagina++;
      renderTabla();
    });
  }

  function initTable() {
    document.getElementById("clientes-body").addEventListener("click", onTableClick);
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  function initModal() {
    document.getElementById("add-client-btn").addEventListener("click", abrirModalNuevo);
    document.getElementById("modal-close").addEventListener("click", cerrarModal);
    document.getElementById("modal-cancel").addEventListener("click", cerrarModal);
    document.getElementById("modal-save").addEventListener("click", guardarCliente);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) cerrarModal();
    });

    document.getElementById("confirm-cancel").addEventListener("click", cerrarConfirmacion);
    document.getElementById("confirm-accept").addEventListener("click", eliminarCliente);
    document.getElementById("confirm-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) cerrarConfirmacion();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.getElementById("confirm-overlay").classList.contains("open")) cerrarConfirmacion();
        else if (document.getElementById("modal-overlay").classList.contains("open")) cerrarModal();
      }
    });
  }

  /* ============================================================
     INICIALIZACIÓN
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    initSearch();
    initPagination();
    initTable();
    initModal();
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