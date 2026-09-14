(function () {
  "use strict";

  const db = firebase.firestore(); // ← LÍNEA AGREGADA: faltaba esta conexión a Firestore

  const STATUS_LABEL = { free: "Libre", occupied: "Ocupada", reserved: "Reservada" };

  const CHAIR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3"/><path d="M7 16v5M17 16v5M5 9h14"/></svg>`;

  const EMPRESAS = [
    { id: "parrilla-sur", name: "Parrilla del Sur", branch: "Sucursal Centro", mark: "PS", user: { name: "Yessica", role: "Mesero/a", initial: "Y" } },
    { id: "bambu-sushi", name: "Bambú Sushi Bar", branch: "Sucursal Shopping", mark: "BS", user: { name: "Marcelo", role: "Encargado", initial: "M" } },
    { id: "cafe-nanduti", name: "Café Ñandutí", branch: "Sucursal Villa Morra", mark: "CÑ", user: { name: "Elena", role: "Cajera", initial: "E" } }
  ];

  let empresaId = EMPRESAS[0].id;
  let mesas = [];
  let mesasFiltradas = [];
  let openTableId = null;
  let state = { filter: "all" };

  /* ============================================================
     LEER Y ESCRIBIR EN FIRESTORE
     ============================================================ */
  async function cargarMesas() {
    try {
      const snapshot = await db.collection('mesas')
        .where('empresaId', '==', empresaId)
        .get();
      const todas = [];
      snapshot.forEach(doc => {
        todas.push({ id: doc.id, ...doc.data() });
      });
      return todas;
    } catch (error) {
      console.error("Error al cargar mesas:", error);
      return [];
    }
  }

  async function actualizarMesa(id, datos) {
    try {
      await db.collection('mesas').doc(id).update(datos);
      console.log(`Mesa ${id} actualizada correctamente.`);
    } catch (error) {
      console.error("Error al actualizar la mesa:", error);
      throw error;
    }
  }

  function getEmpresa() { return EMPRESAS.find(e => e.id === empresaId); }

  function todayLabel() {
    const d = new Date();
    const time = d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
    return `Estado en tiempo real del salón · actualizado ${time}`;
  }

  /* ============================================================
     RENDERIZADO DE LA INTERFAZ
     ============================================================ */
  function renderEmpresaSwitch() {
    const empresa = getEmpresa();
    const btn = document.getElementById("company-switch-btn");
    if (btn) {
      btn.querySelector(".co-mark").textContent = empresa.mark;
      btn.querySelector(".co-name").textContent = empresa.name;
      btn.querySelector(".co-branch").textContent = empresa.branch;
    }
    const menu = document.getElementById("company-menu-list");
    if (!menu) return;
    menu.innerHTML = "";
    EMPRESAS.forEach(e => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "company-option" + (e.id === empresaId ? " active" : "");
      opt.innerHTML = `
        <div class="co-mark">${e.mark}</div>
        <div>
          <div class="co-name">${e.name}</div>
          <div class="co-branch">${e.branch}</div>
        </div>
        <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      `;
      opt.addEventListener("click", () => {
        empresaId = e.id;
        state.filter = "all";
        closeCompanyMenu();
        renderTodo();
      });
      menu.appendChild(opt);
    });
  }

  function renderHeader() {
    const empresa = getEmpresa();
    document.getElementById("branch-date").textContent = todayLabel();
    const avatar = document.getElementById("user-avatar");
    const name = document.getElementById("user-name");
    const role = document.getElementById("user-role");
    if (avatar) avatar.textContent = empresa.user.initial;
    if (name) name.textContent = empresa.user.name;
    if (role) role.textContent = empresa.user.role;
  }

  function countsFor(tables) {
    return {
      all: tables.length,
      free: tables.filter((t) => t.status === "free").length,
      occupied: tables.filter((t) => t.status === "occupied").length,
      reserved: tables.filter((t) => t.status === "reserved").length
    };
  }

  function renderLegendAndFilters() {
    const counts = countsFor(mesas);
    document.getElementById("count-free").textContent = counts.free;
    document.getElementById("count-occupied").textContent = counts.occupied;
    document.getElementById("count-reserved").textContent = counts.reserved;

    document.querySelectorAll(".filter-tab").forEach((tab) => {
      const key = tab.getAttribute("data-filter");
      tab.classList.toggle("active", state.filter === key);
      const countSpan = tab.querySelector(".f-count");
      if (countSpan) countSpan.textContent = counts[key];
    });
  }

  function renderGrid() {
    const grid = document.getElementById("tables-grid");
    grid.innerHTML = "";

    mesasFiltradas = mesas.filter((t) => state.filter === "all" || t.status === state.filter);

    if (!mesasFiltradas.length) {
      grid.innerHTML = `<div class="empty-state">No hay mesas en este estado por ahora.</div>`;
      return;
    }

    mesasFiltradas.forEach((t) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `table-card ${t.status}`;

      // Usamos 'numero_mesa' o el ID si no existe
      const nombreMesa = t.numero_mesa || `Mesa ${t.id.slice(0,4)}`;
      const nombreCliente = t.cliente || `Libre · ${t.capacidad || 2} personas`;

      card.innerHTML = `
        <div class="t-top">
          <div class="t-icon">${CHAIR_ICON}</div>
          <div class="t-state-dot">${STATUS_LABEL[t.status]}</div>
        </div>
        <div>
          <div class="t-num">${nombreMesa}</div>
          <div class="t-meta">${nombreCliente}</div>
        </div>
      `;
      card.addEventListener("click", () => openModal(t.id));
      grid.appendChild(card);
    });
  }

  async function renderTodo() {
    mesas = await cargarMesas();
    renderEmpresaSwitch();
    renderHeader();
    renderLegendAndFilters();
    renderGrid();
  }

  /* ============================================================
     MODAL DE EDICIÓN (Para cambiar manualmente el estado)
     ============================================================ */
  const PERSON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const PHONE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z"/></svg>`;
  const GROUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;

  function openModal(tableId) {
    openTableId = tableId;
    const mesa = mesas.find((t) => t.id === tableId);
    if (!mesa) return;

    const empresa = getEmpresa();

    document.getElementById("modal-title").textContent = `Mesa ${mesa.numero_mesa || tableId}`;
    document.getElementById("modal-sub").textContent = `${empresa.name} · ${empresa.branch}`;

    const detailBlock = document.getElementById("detail-block");
    if (mesa.status === "free" || !mesa.cliente) {
      detailBlock.innerHTML = `<div class="detail-empty">Esta mesa está libre, todavía no hay una reserva u ocupante asociado.</div>`;
    } else {
      const statusText = mesa.status === "reserved" ? "Reservó" : "Sentado en mesa";
      detailBlock.innerHTML = `
        <div class="detail-row">${PERSON_ICON}
          <div><div class="detail-label">${statusText}</div><div class="detail-value">${mesa.cliente}</div></div>
        </div>
        <div class="detail-row">${PHONE_ICON}
          <div><div class="detail-label">Teléfono</div><div class="detail-value">${mesa.telefono || "No registrado"}</div></div>
        </div>
        <div class="detail-row">${GROUP_ICON}
          <div><div class="detail-label">Personas</div><div class="detail-value">${mesa.personas || mesa.capacidad}</div></div>
        </div>
        <div class="detail-row">${CLOCK_ICON}
          <div><div class="detail-label">${mesa.status === "reserved" ? "Hora de reserva" : "Tiempo en mesa"}</div><div class="detail-value">${mesa.nota || "—"}</div></div>
        </div>
      `;
    }

    document.getElementById("modal-client").value = mesa.cliente || "";
    document.getElementById("modal-phone").value = mesa.telefono || "";
    document.getElementById("modal-capacity").value = mesa.capacidad || 2;
    document.getElementById("modal-note").value = mesa.nota || "";

    document.querySelectorAll(".status-option").forEach((opt) => {
      opt.classList.toggle("active", opt.getAttribute("data-status") === mesa.status);
    });

    document.getElementById("modal-overlay").classList.add("open");
  }

  function closeModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    openTableId = null;
  }

  async function saveModal() {
    const mesa = mesas.find((t) => t.id === openTableId);
    if (!mesa) return;

    const activeStatus = document.querySelector(".status-option.active");
    const nuevoEstado = activeStatus ? activeStatus.getAttribute("data-status") : mesa.status;
    const capacidad = Math.max(1, parseInt(document.getElementById("modal-capacity").value, 10) || mesa.capacidad);
    const nota = document.getElementById("modal-note").value.trim();
    const cliente = document.getElementById("modal-client").value.trim();
    const telefono = document.getElementById("modal-phone").value.trim();
    const personas = cliente ? capacidad : null;

    const datosActualizados = {
      status: nuevoEstado,
      capacidad: capacidad,
      nota: nota,
      cliente: cliente,
      telefono: telefono,
      personas: personas
    };

    try {
      await actualizarMesa(openTableId, datosActualizados);
      closeModal();
      await renderTodo();
    } catch (error) {
      alert("Hubo un error al guardar los cambios de la mesa.");
    }
  }

  /* ============================================================
     EVENTOS Y CONFIGURACIÓN
     ============================================================ */
  function closeCompanyMenu() {
    document.getElementById("company-switch").classList.remove("open");
  }

  function initCompanySwitch() {
    const wrapper = document.getElementById("company-switch");
    const btn = document.getElementById("company-switch-btn");
    if (!wrapper || !btn) return;
    btn.addEventListener("click", (e) => { e.stopPropagation(); wrapper.classList.toggle("open"); });
    document.addEventListener("click", (e) => { if (!wrapper.contains(e.target)) closeCompanyMenu(); });
  }

  function initAddCompany() {
    const btn = document.getElementById("company-add-btn");
    if (!btn) return;
    btn.addEventListener("click", () => { alert("Para dar de alta una nueva empresa, contactá a un administrador de Gastro."); closeCompanyMenu(); });
  }

  function initFilters() {
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.filter = tab.getAttribute("data-filter");
        renderLegendAndFilters();
        renderGrid();
      });
    });
  }

  function closeConfirm() {
    document.getElementById("confirm-overlay").classList.remove("open");
  }

  function openConfirm() {
    document.getElementById("confirm-overlay").classList.add("open");
  }

  function initModal() {
    document.querySelectorAll(".status-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        document.querySelectorAll(".status-option").forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");
      });
    });
    document.getElementById("modal-close").addEventListener("click", openConfirm);
    document.getElementById("modal-cancel").addEventListener("click", openConfirm);
    document.getElementById("modal-save").addEventListener("click", saveModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") openConfirm();
    });

    document.getElementById("confirm-keep").addEventListener("click", closeConfirm);
    document.getElementById("confirm-discard").addEventListener("click", () => {
      closeConfirm();
      closeModal();
    });
    document.getElementById("confirm-overlay").addEventListener("click", (e) => {
      if (e.target.id === "confirm-overlay") closeConfirm();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const confirmOpen = document.getElementById("confirm-overlay").classList.contains("open");
      if (confirmOpen) { closeConfirm(); return; }
      const modalOpen = document.getElementById("modal-overlay").classList.contains("open");
      if (modalOpen) openConfirm();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initCompanySwitch();
    initAddCompany();
    initFilters();
    initModal();
    renderTodo();

    // Actualizar cada 30 segundos
    setInterval(renderTodo, 30000);
  });
})();