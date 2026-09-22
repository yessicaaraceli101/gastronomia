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