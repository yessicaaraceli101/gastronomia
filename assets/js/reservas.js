(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sucursalId = null;
  let sesionActual = null;

  let reservas = [];
  let reservasFiltradas = [];
  let pagina = 1;
  let editingReservaId = null;
  let deleteTargetId = null;

  const PAGE_SIZE = 8;
  const ESTADOS = { "ok": "Confirmada", "pending": "Pendiente", "cancel": "Cancelada" };

  function getEstadoLabel(estado) { return ESTADOS[estado] || estado; }

  /* ============================================================
     CARGAR MESAS PARA EL DROPDOWN
     ------------------------------------------------------------
     ⚠️ FIX: antes traía TODAS las mesas de la empresa, sin importar
     la sucursal — así que al crear una reserva en una sucursal se
     podía elegir (y "reservar") una mesa que en realidad es de otra.
     Ahora se filtra con el mismo criterio de siempre: mesa de otra
     sucursal (con sucursalId cargado y distinto) queda afuera; mesa
     ambigua (sin sucursalId, de antes de este cambio) se deja pasar.
     ============================================================ */
  async function cargarMesasDropdown() {
    try {
      const snapshot = await db.collection('mesas')
        .where('empresaId', '==', empresaId)
        .get();
      const select = document.getElementById('f-table');
      select.innerHTML = '<option value="">Selecciona una mesa...</option>';
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.sucursalId && data.sucursalId !== sucursalId) return;
        const nombreMesa = data.numero_mesa || `Mesa ${doc.id.slice(0, 4)}`;
        const opt = document.createElement('option');
        opt.value = nombreMesa;
        opt.textContent = nombreMesa + (data.capacidad ? ` (${data.capacidad} pers.)` : '');
        select.appendChild(opt);
      });
    } catch (error) {
      console.error("Error al cargar mesas para el dropdown:", error);
    }
  }

  /* ============================================================
     SINCRONIZACIÓN DE ESTADO DE MESA (ignora mayúsculas y espacios)
     ------------------------------------------------------------
     ⚠️ FIX: antes buscaba la mesa por nombre entre TODAS las de la
     empresa, sin filtrar por sucursal — si dos sucursales tenían
     cada una su propia "mesa 2" (algo normal y esperable), esta
     función podía terminar actualizando la mesa de la sucursal
     equivocada. Ahora primero descarta las mesas de otras sucursales
     (mismo criterio ambiguo/estricto de siempre) antes de buscar por
     nombre. Además, si la mesa encontrada todavía era ambigua (sin
     sucursalId), queda "reclamada" para esta sucursal en el mismo
     paso — así mesa y reserva quedan del mismo lado.
     ============================================================ */
  async function actualizarEstadoMesa(numeroMesaInput, nuevoEstado) {
    if (!numeroMesaInput) return;
    try {
      const limpioInput = numeroMesaInput.trim().toLowerCase();

      const snapshot = await db.collection('mesas')
        .where('empresaId', '==', empresaId)
        .get();

      let mesaDoc = null;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.sucursalId && data.sucursalId !== sucursalId) return; // de otra sucursal, no es candidata
        const nombreMesaDB = (data.numero_mesa || '').trim().toLowerCase();
        if (nombreMesaDB === limpioInput) {
          mesaDoc = { id: doc.id, ...data };
        }
      });

      if (mesaDoc) {
        const cambios = { status: nuevoEstado };
        if (!mesaDoc.sucursalId) cambios.sucursalId = sucursalId; // reclama si era ambigua
        await db.collection('mesas').doc(mesaDoc.id).update(cambios);
        console.log(`✅ Mesa "${mesaDoc.numero_mesa}" actualizada a estado: ${nuevoEstado}`);
      } else {
        console.warn(`⚠️ No se encontró la mesa "${numeroMesaInput}" en esta sucursal. Verifica el nombre.`);
      }
    } catch (error) {
      console.error(`Error al actualizar la mesa ${numeroMesaInput}:`, error);
    }
  }

  /* ============================================================
     CRUD DE RESERVAS
     ============================================================ */
  async function cargarReservas() {
    try {
      const snapshot = await db.collection('reservas')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        // Mismo criterio que en el resto del sistema: reserva de otra
        // sucursal (con sucursalId cargado y distinto) queda afuera;
        // reserva ambigua (sin sucursalId, de antes de este cambio) se
        // deja pasar en todas hasta que se edite o se reclame con el
        // botón de arriba.
        if (data.sucursalId && data.sucursalId !== sucursalId) return;
        todos.push({ id: doc.id, ...data });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar reservas:", error);
      return [];
    }
  }

  async function crearReserva(datos) {
    try {
      datos.empresaId = empresaId;
      datos.sucursalId = sucursalId;
      datos.codigo = `RES-${Date.now().toString().slice(-6)}`;
      await db.collection('reservas').add(datos);

      if (datos.mesa && datos.estado !== 'cancel') {
        await actualizarEstadoMesa(datos.mesa, 'reserved');
      }
      console.log("Reserva creada correctamente");
    } catch (error) {
      console.error("Error al crear reserva:", error);
      throw error;
    }
  }

  async function actualizarReserva(id, datos) {
    try {
      const oldReserva = reservas.find(r => r.id === id);
      const oldMesa = oldReserva?.mesa || '';
      const oldEstado = oldReserva?.estado || '';

      // Al editar una reserva vieja (ambigua, sin sucursalId), queda
      // reclamada para la sucursal activa — mismo patrón que insumos y
      // mesas.
      datos.sucursalId = sucursalId;
      await db.collection('reservas').doc(id).update(datos);

      if (datos.mesa !== oldMesa || datos.estado !== oldEstado) {
        if (oldMesa && oldMesa !== datos.mesa) {
          await actualizarEstadoMesa(oldMesa, 'free');
        }
        if (datos.mesa) {
          const nuevoEstadoMesa = datos.estado === 'cancel' ? 'free' : 'reserved';
          await actualizarEstadoMesa(datos.mesa, nuevoEstadoMesa);
        }
      }
    } catch (error) {
      console.error("Error al actualizar reserva:", error);
      throw error;
    }
  }

  async function eliminarReserva(id) {
    try {
      const reserva = reservas.find(r => r.id === id);
      if (reserva && reserva.mesa) {
        await actualizarEstadoMesa(reserva.mesa, 'free');
      }
      await db.collection('reservas').doc(id).delete();
    } catch (error) {
      console.error("Error al eliminar reserva:", error);
      throw error;
    }
  }

  /* ============================================================
     RESERVAS "AMBIGUAS" (sin sucursalId, de antes de este cambio)
     ------------------------------------------------------------
     Se ven en todas las sucursales hasta que se les asigna una. En
     vez de obligar a editarlas una por una, este botón las asigna
     TODAS de una sola vez a la sucursal activa — y de paso reclama
     también las mesas ambiguas que tenían asociadas, para que mesa y
     reserva queden del mismo lado.
     ============================================================ */
  function contarReservasAmbiguas() {
    return reservas.filter(r => !r.sucursalId).length;
  }

  function renderAmbiguoBanner() {
    const banner = document.getElementById("ambiguo-banner");
    const text = document.getElementById("ambiguo-text");
    if (!banner || !text) return;
    const cantidad = contarReservasAmbiguas();
    if (cantidad > 0) {
      text.textContent = `${cantidad} reserva(s) todavía no tienen sucursal asignada y por eso se ven en todas.`;
      banner.style.display = "flex";
    } else {
      banner.style.display = "none";
    }
  }

  async function asignarReservasAmbiguasAEstaSucursal() {
    const btn = document.getElementById("ambiguo-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Asignando...";
    try {
      const ambiguas = reservas.filter(r => !r.sucursalId);
      if (!ambiguas.length) return;

      const batch = db.batch();
      ambiguas.forEach(r => {
        batch.update(db.collection('reservas').doc(r.id), { sucursalId: sucursalId });
      });
      await batch.commit();
      console.log(`✅ Se asignaron ${ambiguas.length} reserva(s) a la sucursal "${sucursalId}".`);

      // Además de la reserva, reclamamos también la mesa asociada a cada
      // una (si todavía era ambigua) — así mesas.html deja de mostrarlas
      // en las otras sucursales también.
      for (const r of ambiguas) {
        if (r.mesa && r.estado !== 'cancel') {
          await actualizarEstadoMesa(r.mesa, 'reserved');
        }
      }

      await renderTodo();
    } catch (error) {
      console.error("Error al asignar reservas ambiguas:", error);
      alert("No se pudieron asignar las reservas. Revisá la consola.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Asignar a esta sucursal";
    }
  }

  /* ============================================================
     RENDERIZADO
     ============================================================ */
  function renderFecha() {
    const el = document.getElementById("branch-date");
    if (!el || !sesionActual) return;
    el.textContent = `${sesionActual.sucursalNombre} · Reservas de mesas próximas · ${new Date().toLocaleDateString('es-PY')}`;
  }

  function renderFiltros() {
    const activeFilter = document.querySelector(".filter-tab.active")?.getAttribute("data-filter") || "all";
    const counts = {
      all: reservas.length,
      ok: reservas.filter(r => r.estado === 'ok').length,
      pending: reservas.filter(r => r.estado === 'pending').length,
      cancel: reservas.filter(r => r.estado === 'cancel').length
    };
    document.querySelectorAll(".filter-tab").forEach(tab => {
      const key = tab.getAttribute("data-filter");
      tab.classList.toggle("active", key === activeFilter);
      const countSpan = tab.querySelector(".f-count");
      if (countSpan) countSpan.textContent = counts[key] || 0;
    });
  }

  const ICON_VIEW = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const ICON_EDIT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const ICON_DELETE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

  function renderTabla() {
    const tbody = document.getElementById("reservas-body");
    if (!tbody) return;
    const activeFilter = document.querySelector(".filter-tab.active")?.getAttribute("data-filter") || "all";
    reservasFiltradas = reservas.filter(r => activeFilter === "all" || r.estado === activeFilter);
    reservasFiltradas.sort((a, b) => new Date(b.fecha + ' ' + b.hora) - new Date(a.fecha + ' ' + a.hora));

    const totalPages = Math.max(1, Math.ceil(reservasFiltradas.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = reservasFiltradas.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No hay reservas.</td></tr>`;
    } else {
      pageItems.forEach(r => {
        const tr = document.createElement("tr");
        const estadoLabel = getEstadoLabel(r.estado);
        const estadoClass = r.estado;
        tr.innerHTML = `
          <td><strong>${r.codigo || '—'}</strong></td>
          <td>${r.cliente || '—'}</td>
          <td>${r.fecha || '—'}</td>
          <td>${r.hora || '—'}</td>
          <td>${r.personas || 1}</td>
          <td>${r.mesa || '—'}</td>
          <td><span class="estado ${estadoClass}">${estadoLabel}</span></td>
          <td class="col-actions">
            <div class="row-actions">
              <button class="action-btn ver" data-id="${r.id}" title="Ver detalle">${ICON_VIEW}</button>
              <button class="action-btn editar" data-id="${r.id}" title="Editar">${ICON_EDIT}</button>
              <button class="action-btn action-btn-danger eliminar" data-id="${r.id}" title="Eliminar">${ICON_DELETE}</button>
            </div>
          </td>
        `;
        tr.querySelector(".ver").addEventListener("click", () => abrirDetalle(r.id));
        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditar(r.id));
        tr.querySelector(".eliminar").addEventListener("click", () => abrirConfirmacion(r.id));
        tbody.appendChild(tr);
      });
    }

    document.getElementById("page-label").textContent = `Página ${pagina} de ${totalPages}`;
    document.getElementById("prev-page").disabled = pagina <= 1;
    document.getElementById("next-page").disabled = pagina >= totalPages;
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    reservas = await cargarReservas();
    renderFecha();
    renderFiltros();
    renderTabla();
    renderAmbiguoBanner();
    await cargarMesasDropdown();
  }

  /* ============================================================
     LÓGICA DE MODALES
     ============================================================ */
  function abrirModalNuevo() {
    editingReservaId = null;
    document.getElementById("modal-title").textContent = "Nueva reserva";
    document.getElementById("modal-sub").textContent = "Completa los datos de la reserva.";
    document.getElementById("delete-reserva").style.display = "none";
    document.getElementById("f-client").value = '';
    document.getElementById("f-phone").value = '';
    document.getElementById("f-date").value = '';
    document.getElementById("f-time").value = '';
    document.getElementById("f-people").value = 2;
    document.getElementById("f-table").value = '';

    document.querySelectorAll(".status-option").forEach(btn => btn.classList.remove("active"));
    document.querySelector(".status-option[data-status='pending']").classList.add("active");

    document.getElementById("modal-overlay").classList.add("open");
    document.getElementById("f-client").focus();
  }

  function abrirModalEditar(id) {
    const reserva = reservas.find(r => r.id === id);
    if (!reserva) return;
    editingReservaId = id;
    document.getElementById("modal-title").textContent = "Editar reserva";
    document.getElementById("modal-sub").textContent = "Actualiza los datos de la reserva.";
    document.getElementById("delete-reserva").style.display = "block";

    document.getElementById("f-client").value = reserva.cliente || '';
    document.getElementById("f-phone").value = reserva.telefono || '';
    document.getElementById("f-date").value = reserva.fecha || '';
    document.getElementById("f-time").value = reserva.hora || '';
    document.getElementById("f-people").value = reserva.personas || 1;
    document.getElementById("f-table").value = reserva.mesa || '';

    document.querySelectorAll(".status-option").forEach(btn => btn.classList.toggle("active", btn.getAttribute("data-status") === reserva.estado));
    document.getElementById("modal-overlay").classList.add("open");
  }

  function cerrarModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    editingReservaId = null;
  }

  async function guardarReserva() {
    const cliente = document.getElementById("f-client").value.trim();
    const telefono = document.getElementById("f-phone").value.trim();
    const fecha = document.getElementById("f-date").value;
    const hora = document.getElementById("f-time").value;
    const personas = parseInt(document.getElementById("f-people").value) || 1;
    const mesa = document.getElementById("f-table").value.trim();
    const estado = document.querySelector(".status-option.active")?.getAttribute("data-status") || "pending";

    if (!cliente) return alert("El nombre del cliente es obligatorio.");
    if (!fecha || !hora) return alert("Debes seleccionar una fecha y hora.");

    const datos = { cliente, telefono, fecha, hora, personas, mesa, estado };
    const saveBtn = document.getElementById("modal-save");
    saveBtn.disabled = true;

    try {
      if (editingReservaId) {
        await actualizarReserva(editingReservaId, datos);
      } else {
        await crearReserva(datos);
      }
      cerrarModal();
      await renderTodo();
    } catch (e) {
      console.error("Error detallado al guardar:", e);
      alert("Error al guardar la reserva. Revisa la consola (F12) para más detalles.");
    } finally {
      saveBtn.disabled = false;
    }
  }

  function abrirDetalle(id) {
    const r = reservas.find(res => res.id === id);
    if (!r) return;
    document.getElementById("detail-title").textContent = r.codigo || 'RES-000';
    document.getElementById("detail-sub").textContent = `${sesionActual.empresaNombre} · ${sesionActual.sucursalNombre}`;
    document.getElementById("detail-status").textContent = getEstadoLabel(r.estado);
    document.getElementById("detail-status").className = `status ${r.estado}`;
    document.getElementById("detail-client").textContent = r.cliente || '—';
    document.getElementById("detail-phone").textContent = r.telefono || '—';
    document.getElementById("detail-date").textContent = r.fecha || '—';
    document.getElementById("detail-time").textContent = r.hora || '—';
    document.getElementById("detail-people").textContent = r.personas || '—';
    document.getElementById("detail-table").textContent = r.mesa || '—';
    document.getElementById("detail-delete").dataset.id = id;
    document.getElementById("detail-edit").dataset.id = id;
    document.getElementById("detail-overlay").classList.add("open");
  }

  function cerrarDetalle() {
    document.getElementById("detail-overlay").classList.remove("open");
  }

  function abrirConfirmacion(id) {
    deleteTargetId = id;
    document.getElementById("confirm-title").textContent = "¿Eliminar esta reserva?";
    document.getElementById("confirm-text").textContent = "Esta acción no se puede deshacer.";
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
      await eliminarReserva(deleteTargetId);
      cerrarConfirmacion();
      cerrarDetalle();
      cerrarModal();
      await renderTodo();
    } catch (e) {
      alert("Error al eliminar la reserva.");
    } finally {
      btn.disabled = false;
    }
  }

  /* ============================================================
     EVENTOS Y LISTENERS
     ============================================================ */
  function initModals() {
    document.getElementById("new-reserva-btn").addEventListener("click", abrirModalNuevo);
    document.getElementById("modal-close").addEventListener("click", cerrarModal);
    document.getElementById("modal-cancel").addEventListener("click", cerrarModal);
    document.getElementById("modal-save").addEventListener("click", guardarReserva);
    document.getElementById("modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarModal();
    });

    document.querySelectorAll(".status-option").forEach(btn => {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".status-option").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
      });
    });

    document.getElementById("delete-reserva").addEventListener("click", function () {
      if (editingReservaId) { abrirConfirmacion(editingReservaId); }
    });

    document.getElementById("detail-close").addEventListener("click", cerrarDetalle);
    document.getElementById("detail-close-btn").addEventListener("click", cerrarDetalle);
    document.getElementById("detail-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarDetalle();
    });
    document.getElementById("detail-edit").addEventListener("click", function () {
      const id = this.dataset.id;
      cerrarDetalle();
      abrirModalEditar(id);
    });
    document.getElementById("detail-delete").addEventListener("click", function () {
      const id = this.dataset.id;
      cerrarDetalle();
      abrirConfirmacion(id);
    });

    document.getElementById("confirm-cancel").addEventListener("click", cerrarConfirmacion);
    document.getElementById("confirm-accept").addEventListener("click", aceptarEliminar);
    document.getElementById("confirm-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarConfirmacion();
    });
  }

  function initFilters() {
    document.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        pagina = 1;
        renderTabla();
        renderFiltros();
      });
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

  function initAmbiguo() {
    const btn = document.getElementById("ambiguo-btn");
    if (btn) btn.addEventListener("click", asignarReservasAmbiguasAEstaSucursal);
  }

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  document.addEventListener("DOMContentLoaded", function () {
    initModals();
    initFilters();
    initPagination();
    initAmbiguo();
  });

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener("sesionLista", function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    sucursalId = sesionActual.sucursalId;
    pagina = 1;
    renderTodo();
  });
})();

/* ==============================================================
   RESERVAS RÁPIDO (agregado)
   --------------------------------------------------------------
   • "Nueva / Editar reserva" en pantalla completa, sin scroll, con
     la barra celeste y los botones fijos abajo.
   • Estado bien marcado: Confirmada (verde), Pendiente (naranja),
     Cancelada (rojo).
   • En una reserva nueva, la fecha arranca en HOY.
   • Enter guarda y Esc cancela.
   • Desde el acceso rápido del Panel principal
     (reservas.html?nuevo=1) se abre directo "Nueva reserva".
   No cambia nada de cómo se guardan las reservas ni las mesas.
   ============================================================== */
(function () {
  "use strict";

  function hoyLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function estilosReservaGrande() {
    if (document.getElementById("reserva-grande-style")) return;
    const style = document.createElement("style");
    style.id = "reserva-grande-style";
    style.textContent = `
      #modal-overlay { padding: 0 !important; align-items: stretch !important; justify-content: stretch !important; }
      #modal-overlay .modal-card {
        width: 100vw !important; max-width: 100vw !important; height: 100vh !important; max-height: 100vh !important;
        border-radius: 0 !important; margin: 0 !important; padding: 0 !important;
        display: flex !important; flex-direction: column !important;
      }
      #modal-overlay .modal-head {
        background: #0369a1 !important; flex-shrink: 0; padding: 14px 24px !important; margin: 0 !important;
        display: flex; align-items: center; justify-content: space-between;
      }
      #modal-overlay .modal-head h3 { color: #fff !important; font-size: 22px !important; margin: 0 !important; }
      #modal-overlay .modal-close { color: #fff !important; background: rgba(255,255,255,.15) !important; border: 0 !important; border-radius: 8px; }
      #modal-overlay .modal-sub {
        flex-shrink: 0; width: 100%; max-width: 1000px; margin: 0 auto !important; box-sizing: border-box;
        padding: 12px 24px 0 !important; font-size: 13px; color: #6b7280; border: 0 !important;
      }
      #modal-overlay .modal-body {
        flex: 1 1 auto; overflow-y: auto; width: 100%; max-width: 1000px; margin: 0 auto !important; box-sizing: border-box;
        display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 20px 32px !important;
        align-content: start; padding: 18px 24px !important;
      }
      #modal-overlay .modal-field input, #modal-overlay .modal-field select {
        padding-top: 11px !important; padding-bottom: 11px !important; font-size: 15px !important;
      }

      /* Estado: el elegido queda lleno de color */
      #modal-overlay .status-options { display: grid !important; grid-template-columns: repeat(3, 1fr); gap: 10px;
        background: transparent !important; padding: 0 !important; border: 0 !important; }
      #modal-overlay .status-option {
        display: flex !important; flex-direction: row !important; align-items: center; justify-content: center; gap: 8px;
        padding: 13px 10px !important; border-radius: 10px !important; font-size: 15px !important; font-weight: 700 !important;
        background: #fff !important; color: #6b7280 !important; border: 1.5px solid #d1d5db !important; cursor: pointer;
        transition: background .15s, color .15s, border-color .15s;
      }
      #modal-overlay .status-option i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin: 0 !important; border: 0 !important; }
      #modal-overlay .status-option[data-status="ok"] i { background: #16a34a; }
      #modal-overlay .status-option[data-status="pending"] i { background: #ea580c; }
      #modal-overlay .status-option[data-status="cancel"] i { background: #dc2626; }
      #modal-overlay .status-option[data-status="ok"].active { background: #16a34a !important; border-color: #16a34a !important; color: #fff !important; }
      #modal-overlay .status-option[data-status="pending"].active { background: #ea580c !important; border-color: #ea580c !important; color: #fff !important; }
      #modal-overlay .status-option[data-status="cancel"].active { background: #dc2626 !important; border-color: #dc2626 !important; color: #fff !important; }
      #modal-overlay .status-option.active i { background: #fff !important; }

      /* Botones fijos abajo */
      #modal-overlay .modal-card > .modal-actions {
        flex-shrink: 0; display: flex; align-items: center; gap: 10px;
        margin: 0 !important; padding: 12px 24px !important; border-top: 1px solid #e5e7eb !important; background: #fbfbfc;
        grid-column: auto !important;
      }
      #modal-overlay .modal-card > .modal-actions .btn { flex: 0 0 auto !important; min-width: 150px !important; padding: 11px 22px !important; }
      #modal-cancel { background: #6b7280 !important; border-color: #6b7280 !important; color: #fff !important; }
      .reserva-ayuda { font-size: 12.5px; color: #6b7280; }
      /* Detalle de la reserva: botón "Cerrar" en rojo */
      #detail-close-btn { background: #dc2626 !important; border: 1px solid #dc2626 !important; color: #fff !important; }
      #detail-close-btn:hover { background: #b91c1c !important; border-color: #b91c1c !important; }
      /* Confirmación de eliminar: "Volver" gris y "Confirmar" rojo, llenos */
      #confirm-cancel { background: #6b7280 !important; border: 1px solid #6b7280 !important; color: #fff !important; }
      #confirm-cancel:hover { background: #4b5563 !important; border-color: #4b5563 !important; }
      #confirm-accept { background: #dc2626 !important; border: 1px solid #dc2626 !important; color: #fff !important; }
      #confirm-accept:hover { background: #b91c1c !important; border-color: #b91c1c !important; }
      @media (max-width: 800px) {
        #modal-overlay .modal-body { grid-template-columns: 1fr !important; }
        #modal-overlay .modal-body > .span-2 { grid-column: auto !important; }
        .reserva-ayuda { display: none; }
      }
    `;
    document.head.appendChild(style);

    const card = document.querySelector("#modal-overlay .modal-card");
    const acciones = document.querySelector("#modal-overlay .modal-actions");
    if (card && acciones) {
      if (acciones.parentElement !== card) card.appendChild(acciones);
      if (!acciones.querySelector(".reserva-ayuda")) {
        const spacer = acciones.querySelector(".spacer");
        const ayuda = document.createElement("span");
        ayuda.className = "reserva-ayuda";
        ayuda.textContent = "Enter para guardar · Esc para cancelar";
        if (spacer) spacer.before(ayuda); else acciones.prepend(ayuda);
      }
    }
  }

  function atajos() {
    const overlay = document.getElementById("modal-overlay");
    if (!overlay) return;

    // Reserva nueva: la fecha arranca en hoy
    document.getElementById("new-reserva-btn")?.addEventListener("click", () => {
      const fecha = document.getElementById("f-date");
      if (fecha && !fecha.value) fecha.value = hoyLocal();
    });

    // Enter en un campo = Guardar
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
        e.preventDefault();
        document.getElementById("modal-save")?.click();
      }
    });

    // Esc: cierra lo que esté arriba (confirmación, detalle o la reserva)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const abierto = id => document.getElementById(id)?.classList.contains("open");
      if (abierto("confirm-overlay")) document.getElementById("confirm-cancel")?.click();
      else if (abierto("detail-overlay")) document.getElementById("detail-close")?.click();
      else if (abierto("modal-overlay")) document.getElementById("modal-cancel")?.click();
    });

    // Al editar, el cursor va al nombre del cliente
    const enfocar = () => setTimeout(() => document.getElementById("f-client")?.focus(), 60);
    document.getElementById("reservas-body")?.addEventListener("click", (e) => { if (e.target.closest(".editar")) enfocar(); });
    document.getElementById("detail-edit")?.addEventListener("click", enfocar);
  }

  document.addEventListener("DOMContentLoaded", function () {
    estilosReservaGrande();
    atajos();
  });

  document.addEventListener("sesionLista", function () {
    const params = new URLSearchParams(window.location.search);
    if (params.get("nuevo") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      setTimeout(() => document.getElementById("new-reserva-btn")?.click(), 0);
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
    html body span.estado:not(#_e1):not(#_e2), html body span.status:not(#_e1):not(#_e2) {
      color: #fff !important; border: 0 !important; font-weight: 700 !important;
      padding: 4px 11px !important; border-radius: 999px !important; display: inline-flex !important;
      align-items: center; gap: 6px; white-space: nowrap; box-shadow: none !important; opacity: 1 !important;
    }
    html body span.estado:not(#_e1):not(#_e2) *, html body span.status:not(#_e1):not(#_e2) * { color: #fff !important; }
    html body span.estado:not(#_e1):not(#_e2)::before, html body span.status:not(#_e1):not(#_e2)::before,
    html body span.estado:not(#_e1):not(#_e2)::after, html body span.status:not(#_e1):not(#_e2)::after {
      display: none !important; content: none !important;
    }
    html body span.estado:not(#_e1):not(#_e2).ok, html body span.estado:not(#_e1):not(#_e2).estado-ok, html body span.estado:not(#_e1):not(#_e2).Delivered,
    html body span.estado:not(#_e1):not(#_e2).Pagada, html body span.estado:not(#_e1):not(#_e2).confirmada,
    html body span.status:not(#_e1):not(#_e2).ok { background: #16a34a !important; background-color: #16a34a !important; }
    html body span.estado:not(#_e1):not(#_e2).pending, html body span.estado:not(#_e1):not(#_e2).Pending, html body span.estado:not(#_e1):not(#_e2).Pendiente,
    html body span.estado:not(#_e1):not(#_e2).pendiente,
    html body span.status:not(#_e1):not(#_e2).pending { background: #d97706 !important; background-color: #d97706 !important; }
    html body span.estado:not(#_e1):not(#_e2).cancel, html body span.estado:not(#_e1):not(#_e2).estado-cancel, html body span.estado:not(#_e1):not(#_e2).Canceled,
    html body span.estado:not(#_e1):not(#_e2).Anulada, html body span.estado:not(#_e1):not(#_e2).cancelada,
    html body span.status:not(#_e1):not(#_e2).cancel { background: #dc2626 !important; background-color: #dc2626 !important; }
    html body span.estado:not(#_e1):not(#_e2).Preparing { background: #2563eb !important; background-color: #2563eb !important; }
    html body span.estado:not(#_e1):not(#_e2).Out { background: #7c3aed !important; background-color: #7c3aed !important; }
    html body span.estado:not(#_e1):not(#_e2).Sin { background: #6b7280 !important; background-color: #6b7280 !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
})();