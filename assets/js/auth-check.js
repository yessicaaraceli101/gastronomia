// auth-check.js — Verifica autenticación, carga empresa/sucursal real
// (multiempresa) y pinta el topbar automáticamente en cualquier página
// que use la estructura estándar (#company-switch-btn, #user-avatar, etc.)
(function () {
  'use strict';

  function iniciales(nombre) {
    if (!nombre) return "?";
    const partes = nombre.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
    return (partes[0].charAt(0) + partes[1].charAt(0)).toUpperCase();
  }

  // Sucursal pendiente de confirmar con contraseña (ver
  // asegurarModalCambioSucursal más abajo).
  let sucursalPendiente = null;

  // Esto es lo que en realidad EJECUTA el cambio de sucursal — antes se
  // llamaba directo al hacer clic en una sucursal del desplegable. Ahora
  // solo se llama después de confirmar la contraseña en el modal.
  function ejecutarCambioSucursal(sucursalId) {
    sessionStorage.setItem('sucursalId', sucursalId);
    window.location.reload();
  }

  // Punto de entrada público: pide confirmar la contraseña antes de
  // cambiar de sucursal (por ejemplo, para que un mesero con la sesión
  // abierta no pueda saltar de sucursal sin que el dueño/encargado
  // reingrese su clave).
  function cambiarSucursal(sucursalId) {
    sucursalPendiente = sucursalId;
    abrirModalCambioSucursal();
  }

  function cerrarSesion() {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('sucursalId');
    auth.signOut().finally(() => { window.location.href = 'login.html'; });
  }

  // Crea (una sola vez) un modal de confirmación propio para el botón
  // "Salir" del sidebar. No depende de que la página tenga su propio
  // #logout-modal ni del confirm() nativo del navegador — siempre funciona
  // igual en cualquier página.
  function asegurarModalLogout() {
    if (document.getElementById('auth-check-logout-modal')) return;

    if (!document.getElementById('auth-check-logout-modal-style')) {
      const style = document.createElement('style');
      style.id = 'auth-check-logout-modal-style';
      style.textContent = `
        #auth-check-logout-modal{display:none;position:fixed;inset:0;
          background:rgba(15,23,20,0.5);align-items:center;justify-content:center;
          z-index:99999;padding:20px;}
        #auth-check-logout-modal.open{display:flex;}
        #auth-check-logout-modal .ac-modal-card{background:#fff;border-radius:16px;
          padding:32px;max-width:380px;width:100%;text-align:center;
          box-shadow:0 24px 60px rgba(0,0,0,0.25);font-family:'Inter',sans-serif;}
        #auth-check-logout-modal .ac-modal-icon{width:44px;height:44px;
          border-radius:50%;border:2px solid #dc2626;color:#dc2626;
          display:flex;align-items:center;justify-content:center;margin:0 auto 14px;}
        #auth-check-logout-modal .ac-modal-icon svg{width:22px;height:22px;}
        #auth-check-logout-modal h3{margin:0 0 8px;color:#111827;font-size:18px;}
        #auth-check-logout-modal p{margin:0 0 22px;color:#6b7280;font-size:14px;}
        #auth-check-logout-modal .ac-modal-actions{display:flex;gap:10px;}
        #auth-check-logout-modal .ac-modal-actions button{flex:1;padding:10px;
          border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;
          border:1px solid transparent;font-family:inherit;}
        #auth-check-logout-modal .ac-btn-cancel{background:#e5e7eb;color:#1f2937;
          border-color:#d1d5db;}
        #auth-check-logout-modal .ac-btn-cancel:hover{background:#d1d5db;}
        #auth-check-logout-modal .ac-btn-confirm{background:#dc2626;color:#fff;
          border-color:#dc2626;}
        #auth-check-logout-modal .ac-btn-confirm:hover{background:#b91c1c;}
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'auth-check-logout-modal';
    modal.innerHTML = `
      <div class="ac-modal-card">
        <div class="ac-modal-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </div>
        <h3>¿Cerrar sesión?</h3>
        <p>¿Estás seguro que desea salir del sistema?</p>
        <div class="ac-modal-actions">
          <button type="button" class="ac-btn-cancel" id="auth-check-logout-cancel">Cancelar</button>
          <button type="button" class="ac-btn-confirm" id="auth-check-logout-confirm">Salir</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('auth-check-logout-cancel').addEventListener('click', () => {
      modal.classList.remove('open');
    });
    document.getElementById('auth-check-logout-confirm').addEventListener('click', () => {
      cerrarSesion();
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  // ============================================================
  // MODAL: confirmar contraseña antes de cambiar de sucursal
  // ============================================================
  // Se re-autentica contra Firebase Auth con el email de la sesión actual
  // y la contraseña que la persona escriba acá — si Firebase la acepta,
  // recién ahí se ejecuta el cambio de sucursal (ejecutarCambioSucursal).
  // Si la contraseña es incorrecta, se muestra el error y no pasa nada.
  function asegurarModalCambioSucursal() {
    if (document.getElementById('auth-check-sucursal-modal')) return;

    if (!document.getElementById('auth-check-sucursal-modal-style')) {
      const style = document.createElement('style');
      style.id = 'auth-check-sucursal-modal-style';
      style.textContent = `
        #auth-check-sucursal-modal{display:none;position:fixed;inset:0;
          background:rgba(15,23,20,0.5);align-items:center;justify-content:center;
          z-index:99999;padding:20px;}
        #auth-check-sucursal-modal.open{display:flex;}
        #auth-check-sucursal-modal .ac-modal-card{background:#fff;border-radius:16px;
          padding:32px;max-width:380px;width:100%;text-align:center;
          box-shadow:0 24px 60px rgba(0,0,0,0.25);font-family:'Inter',sans-serif;}
        #auth-check-sucursal-modal .ac-modal-icon{width:44px;height:44px;
          border-radius:50%;border:2px solid #f59e0b;color:#f59e0b;
          display:flex;align-items:center;justify-content:center;margin:0 auto 14px;}
        #auth-check-sucursal-modal .ac-modal-icon svg{width:22px;height:22px;}
        #auth-check-sucursal-modal h3{margin:0 0 8px;color:#111827;font-size:18px;}
        #auth-check-sucursal-modal p{margin:0 0 16px;color:#6b7280;font-size:14px;}
        #auth-check-sucursal-modal input{width:100%;padding:10px 12px;
          border:1px solid #d1d5db;border-radius:8px;font-size:14px;
          font-family:inherit;margin-bottom:8px;box-sizing:border-box;}
        #auth-check-sucursal-modal input:focus{outline:none;border-color:#f59e0b;
          box-shadow:0 0 0 3px rgba(245,158,11,0.15);}
        #auth-check-sucursal-modal .ac-sucursal-error{color:#dc2626;font-size:13px;
          text-align:left;min-height:18px;margin-bottom:6px;}
        #auth-check-sucursal-modal .ac-modal-actions{display:flex;gap:10px;
          margin-top:8px;}
        #auth-check-sucursal-modal .ac-modal-actions button{flex:1;padding:10px;
          border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;
          border:1px solid transparent;font-family:inherit;}
        #auth-check-sucursal-modal .ac-btn-cancel{background:#e5e7eb;color:#1f2937;
          border-color:#d1d5db;}
        #auth-check-sucursal-modal .ac-btn-cancel:hover{background:#d1d5db;}
        #auth-check-sucursal-modal .ac-btn-confirm{background:#f59e0b;color:#fff;
          border-color:#f59e0b;}
        #auth-check-sucursal-modal .ac-btn-confirm:hover{background:#d97f09;}
        #auth-check-sucursal-modal .ac-btn-confirm:disabled{opacity:0.6;cursor:not-allowed;}
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'auth-check-sucursal-modal';
    modal.innerHTML = `
      <div class="ac-modal-card">
        <div class="ac-modal-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h3>Confirmá tu contraseña</h3>
        <p>Para cambiar de sucursal, volvé a ingresar tu contraseña.</p>
        <input type="password" id="auth-check-sucursal-password" placeholder="Contraseña" autocomplete="current-password">
        <div class="ac-sucursal-error" id="auth-check-sucursal-error"></div>
        <div class="ac-modal-actions">
          <button type="button" class="ac-btn-cancel" id="auth-check-sucursal-cancel">Cancelar</button>
          <button type="button" class="ac-btn-confirm" id="auth-check-sucursal-confirm">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = document.getElementById('auth-check-sucursal-password');
    const errorEl = document.getElementById('auth-check-sucursal-error');
    const confirmBtn = document.getElementById('auth-check-sucursal-confirm');
    const cancelBtn = document.getElementById('auth-check-sucursal-cancel');

    function cerrar() {
      modal.classList.remove('open');
      input.value = '';
      errorEl.textContent = '';
      sucursalPendiente = null;
    }

    async function confirmar() {
      const password = input.value;
      if (!password) {
        errorEl.textContent = 'Ingresá tu contraseña.';
        return;
      }
      if (!sucursalPendiente) { cerrar(); return; }

      const user = auth.currentUser;
      if (!user || !user.email) {
        errorEl.textContent = 'No se pudo verificar la sesión. Volvé a iniciar sesión.';
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Verificando...';
      errorEl.textContent = '';

      try {
        const credencial = firebase.auth.EmailAuthProvider.credential(user.email, password);
        await user.reauthenticateWithCredential(credencial);
        const destino = sucursalPendiente;
        cerrar();
        ejecutarCambioSucursal(destino);
      } catch (error) {
        console.error('Error al confirmar contraseña para cambiar de sucursal:', error);
        errorEl.textContent = 'Contraseña incorrecta. Probá de nuevo.';
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar';
      }
    }

    cancelBtn.addEventListener('click', cerrar);
    confirmBtn.addEventListener('click', confirmar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrar();
    });
  }

  function abrirModalCambioSucursal() {
    asegurarModalCambioSucursal();
    const modal = document.getElementById('auth-check-sucursal-modal');
    modal.classList.add('open');
    const input = document.getElementById('auth-check-sucursal-password');
    setTimeout(() => input.focus(), 50);
  }

  // ============================================================
  // MENÚ MOBILE (botón hamburguesa + fondo oscuro)
  // ------------------------------------------------------------
  // En pantallas chicas (ver el media query ≤768px de dashboard.css)
  // el sidebar pasa a ser un panel off-canvas oculto por defecto.
  // Esta función agrega, una sola vez por página, el botón que lo
  // abre/cierra y el fondo oscuro clickeable para cerrarlo tocando
  // afuera. Como vive acá (auth-check.js), aparece automáticamente
  // en cualquier página que ya cargue este script, sin tocar cada
  // HTML por separado.
  // ============================================================
  function asegurarMenuMobile() {
    if (document.getElementById('sidebar-hamburger-btn')) return;

    // menu.html usa una estructura de topbar distinta (.menu-topbar en vez
    // de .topbar) — buscamos cualquiera de las dos, y si ninguna existe,
    // como último recurso el primer <h1> de la página (así el botón
    // siempre aparece en algún lado, aunque una página futura tenga otro
    // nombre de clase para su encabezado).
    const topbar = document.querySelector('.topbar, .menu-topbar')
      || document.querySelector('main h1')?.parentElement;
    if (!topbar) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sidebar-hamburger-btn';
    btn.className = 'sidebar-hamburger';
    btn.setAttribute('aria-label', 'Abrir menú');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    `;
    // Se inserta como primer hijo del topbar, antes del título, para
    // que quede pegado a la izquierda en mobile.
    topbar.insertBefore(btn, topbar.firstChild);

    const backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    function cerrarMenuMobile() {
      document.body.classList.remove('sidebar-open');
    }

    btn.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
    backdrop.addEventListener('click', cerrarMenuMobile);

    // Si tocan un link del menú (cambiar de página), no hace falta
    // dejar la clase puesta — no molesta porque la página se recarga
    // igual, pero por prolijidad la sacamos.
    document.querySelectorAll('.sidebar .nav-item').forEach((link) => {
      link.addEventListener('click', cerrarMenuMobile);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrarMenuMobile();
    });
  }

  // Reemplaza el bloque de marca ("Gastro / Panel administrativo", arriba
  // del sidebar) por el perfil del usuario activo, y deja solo el botón
  // "Salir" al fondo del sidebar.
  function pintarPerfilEnSidebar(sesion) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    asegurarMenuMobile();

    // Arriba: avatar + nombre + rol, en el mismo lugar donde estaba "Gastro".
    const brandMark = document.querySelector('.sidebar .brand .brand-mark');
    const brandName = document.querySelector('.sidebar .brand .brand-name');
    const brandSub = document.querySelector('.sidebar .brand .brand-sub');
    if (brandMark) brandMark.textContent = iniciales(sesion.nombre);
    if (brandName) brandName.textContent = sesion.nombre;
    if (brandSub) brandSub.textContent = /admin/i.test(sesion.rol || '') ? 'Administrador' : 'Empleado';

    // Oculta el chip de usuario y el botón "Salir" viejos del topbar, si
    // esta página todavía los tiene (quedan redundantes con los de arriba).
    const userChipViejo = document.querySelector('.user-chip');
    if (userChipViejo) userChipViejo.style.display = 'none';
    const logoutViejo = document.getElementById('logout-btn');
    if (logoutViejo) logoutViejo.style.display = 'none';

    asegurarModalLogout();

    if (!document.getElementById('auth-check-sidebar-footer-style')) {
      const style = document.createElement('style');
      style.id = 'auth-check-sidebar-footer-style';
      style.textContent = `
        .sidebar-footer{margin-top:8px;padding-top:14px;
          border-top:1px solid rgba(255,255,255,0.08);}
        .sidebar-logout-btn{display:flex;align-items:center;gap:10px;
          padding:9px 10px;border-radius:8px;border:none;background:none;
          color:#a9b1c7;font-size:13px;font-weight:500;cursor:pointer;
          font-family:inherit;width:100%;text-align:left;}
        .sidebar-logout-btn:hover{background:rgba(220,38,38,0.15);color:#fca5a5;}
        .sidebar-logout-btn svg{width:16px;height:16px;flex-shrink:0;}
      `;
      document.head.appendChild(style);
    }

    let footer = document.getElementById('sidebar-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'sidebar-footer';
      footer.className = 'sidebar-footer';
      // Antes se hacía sidebar.appendChild(footer), que en teoría ya lo
      // dejaba al final — pero para que quede SIEMPRE, de forma
      // predecible, justo debajo del último grupo del menú (hoy
      // "Formas de pago"), lo insertamos explícitamente después de él,
      // en vez de confiar en el orden de inserción + margin-top:auto.
      const gruposNav = sidebar.querySelectorAll('.nav-group');
      const ultimoGrupo = gruposNav[gruposNav.length - 1];
      if (ultimoGrupo && ultimoGrupo.nextSibling) {
        sidebar.insertBefore(footer, ultimoGrupo.nextSibling);
      } else if (ultimoGrupo) {
        sidebar.appendChild(footer);
      } else {
        sidebar.appendChild(footer);
      }
    }

    footer.innerHTML = `
      <button type="button" class="sidebar-logout-btn" id="sidebar-logout-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Salir
      </button>
    `;

    document.getElementById('sidebar-logout-btn').addEventListener('click', () => {
      document.getElementById('auth-check-logout-modal').classList.add('open');
    });
  }

  // Llena el selector de empresa/sucursal del topbar (el chip de usuario y
  // el botón Salir ahora viven en el sidebar, ver pintarPerfilEnSidebar).
  function pintarTopbar(sesion) {
    const btn = document.getElementById("company-switch-btn");
    if (btn) {
      const mark = btn.querySelector(".co-mark");
      const name = btn.querySelector(".co-name");
      const branch = btn.querySelector(".co-branch");
      if (mark) mark.textContent = iniciales(sesion.empresaNombre);
      if (name) name.textContent = sesion.empresaNombre;
      if (branch) branch.textContent = sesion.sucursalNombre;
    }

    // El desplegable ahora lista SOLO las sucursales de la propia empresa
    // (ya no otras empresas) — se elige sucursal, no se cambia de negocio.
    // Elegir una sucursal distinta ahora pide confirmar la contraseña
    // (ver cambiarSucursal / abrirModalCambioSucursal más arriba).
    //
    // Si el usuario tiene sucursal FIJA asignada (sesion.sucursalFija), no
    // tiene sentido mostrarle las demás como si pudiera elegirlas — se
    // reemplaza el desplegable por un aviso.
    const menu = document.getElementById("company-menu-list");
    if (menu) {
      menu.innerHTML = "";
      if (sesion.sucursalFija) {
        menu.innerHTML = `<div style="padding:14px 16px; font-size:12.5px; color:#9ca3af;">Tu cuenta está asignada a esta sucursal. Para cambiar, contactá al administrador.</div>`;
      } else if (sesion.sucursales.length <= 1) {
        menu.innerHTML = `<div style="padding:14px 16px; font-size:12.5px; color:#9ca3af;">Esta empresa todavía no tiene otras sucursales cargadas.</div>`;
      } else {
        sesion.sucursales.forEach(s => {
          const opt = document.createElement("button");
          opt.type = "button";
          opt.className = "company-option" + (s.id === sesion.sucursalId ? " active" : "");
          opt.innerHTML = `
            <div class="co-mark">${iniciales(s.nombre)}</div>
            <div>
              <div class="co-name">${sesion.empresaNombre}</div>
              <div class="co-branch">${s.nombre}</div>
            </div>
            <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          `;
          opt.addEventListener("click", () => {
            if (s.id === sesion.sucursalId) return; // ya estás en esa sucursal
            closeCompanyMenuHelper();
            cambiarSucursal(s.id);
          });
          menu.appendChild(opt);
        });
      }
    }

    // "Agregar empresa" no aplica en multiempresa real (cada negocio es su
    // propia cuenta) — se oculta si el botón existe en el HTML.
    const addBtn = document.getElementById("company-add-btn");
    if (addBtn) addBtn.style.display = "none";

    // El botón para abrir/cerrar el desplegable no tenía ningún listener —
    // por eso nunca se abría al hacer clic. Se agrega una sola vez.
    const wrapper = document.getElementById("company-switch");
    if (btn && wrapper && !btn.dataset.acWired) {
      btn.dataset.acWired = "true";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        wrapper.classList.toggle("open");
      });
      document.addEventListener("click", (e) => {
        if (!wrapper.contains(e.target)) wrapper.classList.remove("open");
      });
    }

    pintarPerfilEnSidebar(sesion);
  }

  function closeCompanyMenuHelper() {
    document.getElementById("company-switch")?.classList.remove("open");
  }

  // Agrega el ítem "Sucursales" al sidebar (grupo ADMINISTRACIÓN) en
  // cualquier página que no lo tenga todavía — así no hace falta editar el
  // HTML de cada una de las páginas existentes a mano.
  function inyectarNavSucursales() {
    if (document.querySelector('a[href="sucursales.html"]')) return; // ya está

    const grupos = document.querySelectorAll('.nav-group[data-group="administracion"] .nav-group-items');
    const grupo = grupos[0];
    if (!grupo) return;

    const esActual = window.location.pathname.endsWith('sucursales.html');
    const link = document.createElement('a');
    link.className = 'nav-item' + (esActual ? ' active' : '');
    link.href = 'sucursales.html';
    link.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/></svg>
      <span>Sucursales</span>
    `;
    grupo.appendChild(link);
  }

  // Funciones que las páginas pueden usar (además de escuchar el evento
  // "sesionLista", que es la forma recomendada de esperar los datos).
  window.Sesion = { pintarTopbar, cambiarSucursal, cerrarSesion, iniciales };

  // La decisión de mostrar la página o no se toma de inmediato, usando lo
  // que login.js ya guardó en sessionStorage (eso es instantáneo y no
  // depende de Firebase). Firebase se sigue usando para las consultas a
  // Firestore en sí.
  const sessionData = JSON.parse(sessionStorage.getItem('user') || 'null');

  if (!sessionData || !sessionData.empresaId) {
    window.location.href = 'login.html';
    return;
  }

  // Se mantiene por compatibilidad con páginas que todavía leen
  // window.empresaId / window.userData directamente.
  window.empresaId = sessionData.empresaId;
  window.userData = sessionData;

  // FIX: pintamos el nombre/rol del usuario en el sidebar YA MISMO, usando
  // lo que ya está en sessionStorage (sincrónico, no depende de red). Antes
  // esto se hacía recién adentro de cargarSesion(), después de esperar la
  // consulta a Firestore — y en ese intervalo se veía "Gastro / Panel
  // administrativo" (el texto fijo del HTML) antes de cambiar al nombre
  // real. Ahora no hay ventana en la que se vea "Gastro": se reemplaza
  // apenas carga la página.
  pintarPerfilEnSidebar(sessionData);

  (async function cargarSesion() {
    try {
      const empresaSnap = await db.collection('empresas').doc(sessionData.empresaId).get();
      const empresa = empresaSnap.exists ? empresaSnap.data() : { nombre: 'Empresa' };

      const sucursalesSnap = await db.collection('empresas').doc(sessionData.empresaId)
        .collection('sucursales').get();
      const sucursales = [];
      sucursalesSnap.forEach(doc => sucursales.push({ id: doc.id, ...doc.data() }));

      // Si el usuario tiene una sucursal FIJA asignada (sessionData.sucursalFija,
      // guardada por login.js desde el perfil en Firestore), esa gana
      // siempre — sin importar qué diga la clave suelta sessionStorage
      // 'sucursalId' (que es la que se usa para el punto de partida de un
      // usuario SIN restricción, o para recordar la última sucursal
      // elegida entre recargas). Así un empleado con sucursal fija no
      // puede terminar en otra ni manipulando esa clave a mano.
      const sucursalGuardada = sessionData.sucursalFija || sessionStorage.getItem('sucursalId');
      const sucursalActual =
        sucursales.find(s => s.id === sucursalGuardada) ||
        sucursales[0] ||
        { id: null, nombre: 'Sin sucursal' };

      window.sesion = {
        uid: sessionData.uid,
        nombre: sessionData.nombre || sessionData.email,
        rol: sessionData.rol || 'empleado',
        empresaId: sessionData.empresaId,
        empresaNombre: empresa.nombre || 'Empresa',
        sucursales: sucursales,
        sucursalId: sucursalActual.id,
        sucursalNombre: sucursalActual.nombre,
        // Si tiene sucursal fija, pintarTopbar() oculta el selector en vez
        // de listar las demás sucursales — no tiene sentido mostrárselas
        // si de todos modos no las puede elegir.
        sucursalFija: sessionData.sucursalFija || null
      };

      pintarTopbar(window.sesion);
      inyectarNavSucursales();

      document.dispatchEvent(new CustomEvent('sesionLista', { detail: window.sesion }));
    } catch (error) {
      // Si esto falla porque en verdad no hay una sesión válida en Firebase
      // (por ejemplo, el token expiró de verdad), ahí sí correspondería
      // cerrar sesión — pero no lo hacemos de forma agresiva para no
      // repetir el mismo problema; solo se informa en consola.
      console.error('Error cargando datos de empresa/sucursal:', error);
    }
  })();

  // ------------------------------------------------------------------
  // FIX: "Salir del sistema" fantasma al navegar dentro del panel.
  //
  // Antes, la PRIMERA vez que Firebase informaba el estado de Auth después
  // de cargar la página, si venía como "sin usuario" (user = null) —cosa
  // que puede pasar por una demora real al restaurar la sesión desde
  // almacenamiento local, sobre todo en localhost— el código borraba
  // sessionStorage y mandaba al login, aunque la sesión guardada por
  // login.js fuera perfectamente válida. Eso era lo que causaba:
  // "entro al panel y al hacer clic en Panel principal me manda al login".
  //
  // Ahora se ignora ese primer aviso (es solo la foto inicial, no
  // confiable) y el listener solo actúa sobre cambios de estado que
  // ocurran DESPUÉS, que sí representan un cierre de sesión real (por
  // ejemplo, revocado desde otro dispositivo mientras la página está
  // abierta).
  // ------------------------------------------------------------------
  let authStateInicializado = false;
  auth.onAuthStateChanged(function (user) {
    if (!authStateInicializado) {
      authStateInicializado = true;
      return;
    }
    if (!user && sessionStorage.getItem('user')) {
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('sucursalId');
      window.location.href = 'login.html';
    }
  });

})();