(function () {
  'use strict';

  let moneda = 'GS';
  const symbols = { 'GS': 'Gs. ', 'USD': '$', 'BRL': 'R$' };

  // ⚠️ FIX: antes no existía ninguna tasa de cambio acá — el texto solo
  // le pegaba el símbolo de la moneda elegida (Gs./US$/R$) al mismo
  // número guardado en guaraníes, sin dividir ni multiplicar nada, así
  // que "Ingresos de hoy" mostraba siempre el mismo valor (ej. 7.000)
  // cambiando solo el símbolo. Mismas tasas que ya usan facturacion.js y
  // reportes.js: 1 US$ = 7300 Gs, 1 US$ = 5.4 R$.
  const RATE_USD_EN_GS = 7300;
  const RATE_BRL_POR_USD = 5.4;

  // Convierte un monto guardado en Gs (como siempre se guardan las
  // facturas) a la moneda actualmente seleccionada, y le agrega el
  // símbolo correspondiente.
  function formatearMonto(valorGs) {
    const v = Number(valorGs) || 0;
    const simbolo = symbols[moneda] || '';
    if (moneda === 'GS') {
      return `${simbolo}${Math.round(v).toLocaleString('es-PY')}`;
    }
    if (moneda === 'USD') {
      return `${simbolo}${(v / RATE_USD_EN_GS).toFixed(2)}`;
    }
    if (moneda === 'BRL') {
      return `${simbolo}${((v / RATE_USD_EN_GS) * RATE_BRL_POR_USD).toFixed(2)}`;
    }
    return `${simbolo}${Math.round(v).toLocaleString('es-PY')}`;
  }

  // ========== DOM ELEMENTS ==========
  const branchDate = document.getElementById('branch-date');

  // Estadísticas
  const statReservations = document.querySelector('#stat-reservations .stat-value');
  const statOrders = document.querySelector('#stat-active-orders .stat-value');
  const statGuests = document.querySelector('#stat-guests .stat-value');
  const statRevenue = document.querySelector('#stat-revenue .stat-value');

  // Toggle de moneda
  const currencyBtns = document.querySelectorAll('#currency-toggle button');

  // Botón de logout (esta página usa su propio modal, más lindo que el
  // genérico que auth-check.js agregaría solo si esta página no tuviera uno).
  const logoutBtn = document.getElementById('logout-btn');
  const logoutModal = document.getElementById('logout-modal');
  const logoutCancel = document.getElementById('logout-cancel');
  const logoutConfirm = document.getElementById('logout-confirm');

  // ========== ESTADÍSTICAS ==========
  // Antes esto eran valores fijos de ejemplo (5, 12, 34, Gs. 1.250.000).
  // Ahora se calculan de verdad a partir de Firestore, filtrando siempre
  // por la empresa de la sesión activa (sesion.empresaId).
  //
  // Supuestos sobre los campos de "reservas" y "pedidos" (no tengo el
  // código de esas páginas en este proyecto): cada documento tiene
  // "empresaId" y una fecha en el campo "fecha" o "created_at". Si en tu
  // proyecto se llaman distinto, avisame para ajustar el filtro.
  //
  // ⚠️ "Reservados" y "Total pedidos" TODAVÍA se cuentan solo por
  // empresaId, sin sucursalId — porque no tengo reservas.js/pedidos.js en
  // este proyecto para saber si esos documentos ya guardan sucursalId.
  // Si esas colecciones no lo tienen, filtrar por sucursalId acá dejaría
  // esas dos tarjetas en 0 SIEMPRE. Pasame esos dos archivos para
  // aplicarles el mismo arreglo que a "Ventas hoy" / "Ingresos de hoy".
  function inicioDeHoy() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function fechaDeDocumento(datos) {
    const valor = datos.fecha || datos.created_at;
    if (!valor) return null;
    if (valor.seconds) return new Date(valor.seconds * 1000); // Firestore Timestamp
    return new Date(valor); // string ISO
  }

  async function contarDocumentosDeHoy(coleccion, empresaId) {
    try {
      const snap = await db.collection(coleccion).where('empresaId', '==', empresaId).get();
      const inicioHoy = inicioDeHoy();
      let contador = 0;
      snap.forEach(doc => {
        const fecha = fechaDeDocumento(doc.data());
        if (fecha && fecha >= inicioHoy) contador++;
      });
      return contador;
    } catch (error) {
      console.error(`Error contando "${coleccion}" de hoy:`, error);
      return null;
    }
  }

  // "Ventas hoy" e "Ingresos de hoy" SÍ se filtran por sucursalId además
  // de empresaId — facturacion.js ahora guarda sucursalId en cada
  // factura nueva, así que esto refleja solo la sucursal activa. Las
  // facturas viejas (de antes de ese cambio) no tienen sucursalId y
  // quedan excluidas de ambas sucursales — son datos ambiguos, no se
  // pueden asignar a una en particular.
  async function calcularVentasEIngresosDeHoy(empresaId, sucursalId) {
    try {
      const snap = await db.collection('facturas').where('empresaId', '==', empresaId).get();
      const inicioHoy = inicioDeHoy();
      let ventas = 0, ingresos = 0;
      snap.forEach(doc => {
        const f = doc.data();
        if (f.sucursalId !== sucursalId) return;
        if (f.estado !== 'Pagada') return;
        if (!f.created_at) return;
        const fecha = new Date(f.created_at);
        if (fecha >= inicioHoy) {
          ventas++;
          ingresos += (typeof f.total === 'number' ? f.total : 0);
        }
      });
      return { ventas, ingresos };
    } catch (error) {
      console.error('Error calculando ventas/ingresos de hoy:', error);
      return { ventas: null, ingresos: null };
    }
  }

  async function renderStats(sesion) {
    // Mientras carga, mostramos "…" en vez de dejar el valor anterior.
    statReservations.textContent = '…';
    statOrders.textContent = '…';
    statGuests.textContent = '…';
    statRevenue.textContent = '…';

    const [reservas, pedidos, ventasIngresos] = await Promise.all([
      contarDocumentosDeHoy('reservas', sesion.empresaId),
      contarDocumentosDeHoy('pedidos', sesion.empresaId),
      calcularVentasEIngresosDeHoy(sesion.empresaId, sesion.sucursalId)
    ]);

    statReservations.textContent = reservas === null ? '—' : reservas;
    statOrders.textContent = pedidos === null ? '—' : pedidos;
    statGuests.textContent = ventasIngresos.ventas === null ? '—' : ventasIngresos.ventas;
    statRevenue.textContent = ventasIngresos.ingresos === null
      ? '—'
      : formatearMonto(ventasIngresos.ingresos);
  }

  function renderFecha(sesion) {
    if (!branchDate) return;
    const hoy = new Date().toLocaleDateString('es-PY');
    branchDate.textContent = `${sesion.sucursalNombre} - ${hoy}`;
  }

  // ========== LOGOUT (modal propio de esta página) ==========
  function initLogout() {
    if (!logoutBtn || !logoutModal) return;

    logoutBtn.addEventListener('click', () => {
      logoutModal.classList.add('open');
    });

    logoutCancel.addEventListener('click', () => {
      logoutModal.classList.remove('open');
    });

    logoutConfirm.addEventListener('click', () => {
      // window.Sesion.cerrarSesion() ya viene de auth-check.js: borra la
      // sesión guardada, cierra Firebase Auth y redirige a login.html.
      window.Sesion.cerrarSesion();
    });

    logoutModal.addEventListener('click', (e) => {
      if (e.target === logoutModal) logoutModal.classList.remove('open');
    });
  }

  // ========== MONEDA ==========
  let sesionActual = null;
  function initCurrencyToggle() {
    currencyBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        currencyBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        moneda = this.getAttribute('data-currency');
        if (sesionActual) renderStats(sesionActual);
      });
    });
  }

  // ========== INICIALIZACIÓN ==========
  // auth-check.js valida la sesión, carga empresa/sucursal reales desde
  // Firestore, pinta el topbar (selector de empresa, avatar, nombre, rol) y
  // recién entonces dispara "sesionLista" con todos esos datos.
  document.addEventListener('sesionLista', function (e) {
    const sesion = e.detail;
    sesionActual = sesion;
    renderFecha(sesion);
    renderStats(sesion);
    initCurrencyToggle();
    initLogout();
  });

})();