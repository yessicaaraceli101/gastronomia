(function () {
  "use strict";

  // empresaId y sesionActual ahora vienen de auth-check.js (evento
  // "sesionLista"), no de una lista hardcodeada de empresas de prueba.
  let empresaId = null;
  let sesionActual = null;

  let usuarios = [];
  let usuariosFiltrados = [];
  let pagina = 1;
  let editingUserId = null;
  let deleteTargetId = null;
  let deleteTargetUid = null;

  // Sucursales de la empresa activa, para poblar el select "Sucursal
  // asignada" del modal de Nuevo/Editar usuario.
  let sucursalesEmpresa = [];

  const PAGE_SIZE = 8;

  /* ============================================================
     FUNCIONES DE FIREBASE (Firestore + Auth)
     ============================================================ */
  async function cargarUsuarios() {
    try {
      const snapshot = await db.collection('usuarios')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("Error al cargar usuarios:", error);
      return [];
    }
  }

  // Misma subcolección que ya usa auth-check.js para armar el selector de
  // sucursal del topbar — así el desplegable de este modal siempre lista
  // exactamente las mismas sucursales que existen de verdad.
  async function cargarSucursalesEmpresa() {
    try {
      const snapshot = await db.collection('empresas').doc(empresaId)
        .collection('sucursales').get();
      const todas = [];
      snapshot.forEach(doc => todas.push({ id: doc.id, ...doc.data() }));
      return todas;
    } catch (error) {
      console.error("Error al cargar sucursales:", error);
      return [];
    }
  }

  function poblarSelectSucursales() {
    const select = document.getElementById('f-user-sucursal');
    if (!select) return;
    const opciones = sucursalesEmpresa.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    select.innerHTML = `<option value="">Todas las sucursales (acceso completo)</option>${opciones}`;
  }

  function nombreDeSucursal(sucursalId) {
    if (!sucursalId) return null;
    const s = sucursalesEmpresa.find(s => s.id === sucursalId);
    return s ? s.nombre : sucursalId; // si no la encuentra, al menos mostramos el ID
  }

  async function crearUsuarioAuth(email, password) {
    try {
      const userCred = await auth.createUserWithEmailAndPassword(email, password);
      return userCred.user.uid;
    } catch (error) {
      console.error("Error en Firebase Auth:", error);
      if (error.code === 'auth/configuration-not-found') {
        throw new Error('El servicio de autenticación no está configurado. Habilita "Email/Password" en Firebase Console.');
      }
      throw error;
    }
  }

  // ⚠️ CORREGIDO: antes, un usuario nuevo se guardaba con
  // db.collection('usuarios').add(datos) — Firestore le asignaba un ID
  // AL AZAR, distinto del uid real que ya devolvía crearUsuarioAuth().
  // Con las reglas de seguridad nuevas (que exigen que el documento del
  // usuario esté en usuarios/{uid} exacto para poder identificar a qué
  // empresa pertenece), eso dejaba a cada usuario nuevo sin poder
  // loguearse ("Missing or insufficient permissions"), igual que pasó
  // con los usuarios viejos que tuvimos que migrar a mano.
  //
  // Ahora: usuario nuevo -> db.collection('usuarios').doc(uid).set(datos)
  // Así el ID del documento SIEMPRE es el UID real de Firebase Auth.
  async function guardarUsuarioFirestore(uid, datos) {
    try {
      datos.uid = uid;
      datos.empresaId = empresaId; // ASIGNA LA EMPRESA DEL USUARIO LOGUEADO
      datos.created_at = datos.created_at || new Date().toISOString();

      if (editingUserId) {
        // Edición de un usuario ya existente: se actualiza el documento
        // que ya tenía (sea cual sea su ID actual).
        await db.collection('usuarios').doc(editingUserId).update(datos);
      } else {
        // Usuario nuevo: el documento se crea CON ID = uid, no con un
        // ID autogenerado. Esto es lo que evita el bug de siempre.
        await db.collection('usuarios').doc(uid).set(datos);
      }
    } catch (error) {
      console.error("Error al guardar en Firestore:", error);
      throw error;
    }
  }

  async function eliminarUsuario(id, authUid) {
    try {
      await db.collection('usuarios').doc(id).delete();
      console.log(`Usuario ${authUid} eliminado del panel.`);
      // Nota: esto borra el PERFIL en Firestore, pero no la cuenta en
      // Firebase Authentication (eso requiere permisos de administrador
      // que el SDK del navegador no tiene). La persona podría seguir
      // "logueándose" en Firebase Auth, pero login.js no va a encontrarle
      // perfil ni empresaId y la va a rechazar con "no tiene una empresa
      // asignada". Si querés que la cuenta quede totalmente inutilizable
      // (no solo sin acceso a datos), eso requiere borrarla también desde
      // Authentication en la consola de Firebase, a mano.
    } catch (error) {
      console.error("Error al eliminar:", error);
      throw error;
    }
  }

  /* ============================================================
     RENDERIZADO
     ============================================================ */
  const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const ICON_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

  function formatoId(id) {
    if (!id) return "—";
    return id.length > 10 ? id.substring(0, 8) + "…" : id;
  }

  // Iniciales para el avatar circular junto al nombre (ej: "Yessica Araceli
  // Lopez" -> "YA", "Yessi" -> "Y"), igual que en la tabla de Clientes.
  function getIniciales(nombre) {
    if (!nombre) return "?";
    const partes = nombre.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
    return (partes[0].charAt(0) + partes[1].charAt(0)).toUpperCase();
  }

  function renderTabla() {
    const tbody = document.getElementById("usuarios-body");
    if (!tbody) return;

    const term = document.getElementById("user-search")?.value?.toLowerCase() || "";
    const filterType = document.querySelector(".filter-tab.active")?.getAttribute("data-filter") || "all";

    usuariosFiltrados = usuarios.filter(u => {
      const nombreMatch = (u.nombre || "").toLowerCase().includes(term);
      const statusMatch = filterType === "all" || u.estado === filterType;
      return nombreMatch && statusMatch;
    });

    document.querySelectorAll('.filter-tab').forEach(tab => {
      const filter = tab.getAttribute('data-filter');
      let count = usuarios.filter(u => filter === "all" || u.estado === filter).length;
      if(filter === "all") count = usuarios.length;
      tab.querySelector('.f-count').textContent = count;
    });

    const totalPages = Math.max(1, Math.ceil(usuariosFiltrados.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = usuariosFiltrados.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No hay usuarios registrados.</td></tr>`;
    } else {
      pageItems.forEach((u, idx) => {
        const numeroFila = start + idx + 1;
        const tr = document.createElement("tr");
        const estadoClass = u.estado === 'ok' ? 'ok' : 'cancel';
        const estadoLabel = u.estado === 'ok' ? 'Activo' : 'Inactivo';
        const lastAccess = u.last_access ? new Date(u.last_access).toLocaleString('es-PY') : '—';

        // Chip de sucursal: si el usuario tiene sucursalId asignado,
        // muestra el nombre de esa sucursal en azul; si no, "Todas" en
        // gris (acceso a todas las sucursales de la empresa).
        const nombreSucursal = nombreDeSucursal(u.sucursalId);
        const sucursalHtml = nombreSucursal
          ? `<span class="sucursal-chip">${nombreSucursal}</span>`
          : `<span class="sucursal-chip todas">Todas</span>`;

        tr.innerHTML = `
          <td class="id-cell" title="${u.id}">${numeroFila}</td>
          <td>
            <div class="user-name-cell">
              <div class="user-avatar-mini">${getIniciales(u.nombre)}</div>
              <strong>${u.nombre || '—'}</strong>
            </div>
          </td>
          <td>${u.rol || '—'}</td>
          <td>${sucursalHtml}</td>
          <td>${u.email || '—'}</td>
          <td><span class="estado estado-${estadoClass}">${estadoLabel}</span></td>
          <td>${lastAccess}</td>
          <td class="col-actions">
            <div class="row-actions">
              <button type="button" class="action-btn editar" data-id="${u.id}" title="Editar">${ICON_EDIT}</button>
              <button type="button" class="action-btn action-btn-danger eliminar" data-id="${u.id}" data-uid="${u.uid || ''}" title="Eliminar">${ICON_DELETE}</button>
            </div>
          </td>
        `;

        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditar(u.id));
        tr.querySelector(".eliminar").addEventListener("click", () => abrirConfirmacionEliminar(u.id, u.uid));
        tbody.appendChild(tr);
      });
    }

    document.getElementById("page-label").textContent = `Página ${pagina} de ${totalPages}`;
    document.getElementById("prev-page").disabled = pagina <= 1;
    document.getElementById("next-page").disabled = pagina >= totalPages;
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    const [todosUsuarios, todasSucursales] = await Promise.all([
      cargarUsuarios(),
      cargarSucursalesEmpresa()
    ]);
    usuarios = todosUsuarios;
    sucursalesEmpresa = todasSucursales;
    poblarSelectSucursales();
    renderTabla();
  }

  /* ============================================================
     MODALES
     ============================================================ */
  function abrirModalNuevo() {
    editingUserId = null;
    document.getElementById("modal-title").textContent = "Nuevo usuario";
    document.getElementById("modal-sub").textContent = "Los usuarios podrán iniciar sesión con su Email y Contraseña.";
    document.getElementById("delete-user").style.display = "none";
    document.getElementById("last-access-row").style.display = "none";
    document.getElementById("f-user-password").removeAttribute("disabled");
    document.getElementById("f-user-password").placeholder = "Mínimo 6 caracteres";
    document.getElementById("f-user-password").value = "";
    limpiarFormulario();
    document.getElementById("modal-overlay").classList.add("open");
    document.getElementById("f-user-name").focus();
  }

  function abrirModalEditar(id) {
    const user = usuarios.find(u => u.id === id);
    if (!user) return;

    editingUserId = id;
    document.getElementById("modal-title").textContent = "Editar usuario";
    document.getElementById("modal-sub").textContent = "Actualiza los datos del usuario.";
    document.getElementById("delete-user").style.display = "block";
    document.getElementById("last-access-row").style.display = "flex";
    document.getElementById("f-user-password").disabled = true;
    document.getElementById("f-user-password").placeholder = "No se puede cambiar aquí";
    document.getElementById("f-user-password").value = "";

    document.getElementById("f-user-name").value = user.nombre || '';
    document.getElementById("f-user-role").value = user.rol || '';
    document.getElementById("f-user-email").value = user.email || '';
    document.getElementById("f-user-last-access").textContent = user.last_access ? new Date(user.last_access).toLocaleString('es-PY') : '—';

    const selectSucursal = document.getElementById("f-user-sucursal");
    if (selectSucursal) selectSucursal.value = user.sucursalId || '';

    document.querySelectorAll(".status-option").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-status") === user.estado);
    });

    document.getElementById("modal-overlay").classList.add("open");
  }

  function limpiarFormulario() {
    document.getElementById("f-user-name").value = '';
    document.getElementById("f-user-role").value = 'Administrador';
    document.getElementById("f-user-email").value = '';
    document.getElementById("f-user-password").value = '';
    const selectSucursal = document.getElementById("f-user-sucursal");
    if (selectSucursal) selectSucursal.value = '';
    document.querySelectorAll(".status-option").forEach(btn => btn.classList.remove("active"));
    document.querySelector(".status-option[data-status='ok']").classList.add("active");
  }

  function cerrarModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    editingUserId = null;
  }

  /* ============================================================
     MODAL DE ÉXITO
     ============================================================ */
  function abrirModalExito() {
    const modal = document.getElementById("success-modal-overlay");
    modal.classList.add("open");
    setTimeout(() => cerrarModalExito(), 2500);
  }

  function cerrarModalExito() {
    document.getElementById("success-modal-overlay").classList.remove("open");
  }

  /* ============================================================
     GUARDAR USUARIO
     ============================================================ */
  async function guardarUsuario() {
    const nombre = document.getElementById("f-user-name").value.trim();
    const rol = document.getElementById("f-user-role").value;
    const email = document.getElementById("f-user-email").value.trim();
    const password = document.getElementById("f-user-password").value;
    const estado = document.querySelector(".status-option.active")?.getAttribute("data-status") || "ok";
    // Sucursal asignada: "" (Todas) se guarda como null — así el resto
    // del sistema (auth-check.js, login.js) puede chequear con un simple
    // "if (usuario.sucursalId)" para saber si está restringido o no.
    const sucursalSelect = document.getElementById("f-user-sucursal");
    const sucursalId = sucursalSelect && sucursalSelect.value ? sucursalSelect.value : null;

    if (!nombre) return alert("El nombre es obligatorio.");
    if (!email) return alert("El email es obligatorio.");
    if (!editingUserId && password.length < 6) {
      return alert("La contraseña debe tener al menos 6 caracteres.");
    }

    const saveBtn = document.getElementById("modal-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";

    try {
      let uid = null;

      if (!editingUserId) {
        try {
          uid = await crearUsuarioAuth(email, password);
        } catch (authError) {
          let msg = "Error al crear la cuenta de acceso.";
          if (authError.code === 'auth/email-already-in-use') {
            msg = "Este email ya está registrado. Usa otro.";
          } else if (authError.code === 'auth/configuration-not-found') {
            msg = "El servicio de autenticación no está configurado. Habilita 'Email/Password' en Firebase Console.";
          } else {
            msg = authError.message;
          }
          alert(msg);
          saveBtn.disabled = false;
          saveBtn.textContent = "Guardar";
          return;
        }
      } else {
        const existingUser = usuarios.find(u => u.id === editingUserId);
        uid = existingUser?.uid || null;
      }

      const datosUsuario = { nombre, rol, email, estado, sucursalId };
      await guardarUsuarioFirestore(uid, datosUsuario);

      cerrarModal();
      await renderTodo();
      abrirModalExito();

    } catch (error) {
      alert("Error al guardar el usuario.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
    }
  }

  /* ============================================================
     ELIMINAR
     ============================================================ */
  function abrirConfirmacionEliminar(id, uid) {
    deleteTargetId = id;
    deleteTargetUid = uid;
    const user = usuarios.find(u => u.id === id);
    document.getElementById("confirm-title").textContent = `¿Eliminar a ${user?.nombre || 'este usuario'}?`;
    document.getElementById("confirm-text").textContent = "Se eliminará su acceso al panel.";
    document.getElementById("confirm-overlay").classList.add("open");
  }

  function cerrarConfirmacion() {
    document.getElementById("confirm-overlay").classList.remove("open");
    deleteTargetId = null;
    deleteTargetUid = null;
  }

  async function aceptarEliminar() {
    if (!deleteTargetId) return;
    const btn = document.getElementById("confirm-accept");
    btn.disabled = true;
    try {
      await eliminarUsuario(deleteTargetId, deleteTargetUid);
      cerrarConfirmacion();
      await renderTodo();
    } catch (error) {
      alert("Error al eliminar el usuario.");
    } finally {
      btn.disabled = false;
    }
  }

  /* ============================================================
     EVENTOS
     ============================================================ */
  function initModals() {
    document.getElementById("add-user-btn").addEventListener("click", abrirModalNuevo);
    document.getElementById("modal-close").addEventListener("click", cerrarModal);
    document.getElementById("modal-cancel").addEventListener("click", cerrarModal);
    document.getElementById("modal-save").addEventListener("click", guardarUsuario);
    document.getElementById("modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarModal();
    });

    document.querySelectorAll(".status-option").forEach(btn => {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".status-option").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
      });
    });

    document.getElementById("delete-user").addEventListener("click", function() {
      if (editingUserId) {
        const u = usuarios.find(us => us.id === editingUserId);
        if (u) abrirConfirmacionEliminar(u.id, u.uid);
      }
    });

    document.getElementById("confirm-cancel").addEventListener("click", cerrarConfirmacion);
    document.getElementById("confirm-accept").addEventListener("click", aceptarEliminar);
    document.getElementById("confirm-overlay").addEventListener("click", function (e) {
      if (e.target === this) cerrarConfirmacion();
    });

    document.getElementById("success-btn").addEventListener("click", cerrarModalExito);
    document.getElementById("success-modal-overlay").addEventListener("click", function(e) {
      if (e.target === this) cerrarModalExito();
    });
  }

  function initFilters() {
    document.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", function() {
        document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        pagina = 1;
        renderTabla();
      });
    });
  }

  function initSearch() {
    document.getElementById("user-search").addEventListener("input", () => {
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
  // pintar opciones) y el chip de usuario/topbar ahora los maneja
  // auth-check.js igual que en el resto de las páginas — ya no hace falta
  // duplicar esa lógica acá.

  /* ============================================================
     INICIALIZACIÓN
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    initModals();
    initFilters();
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