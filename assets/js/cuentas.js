/* ============================================================
   LÓGICA DE CUENTAS POR PAGAR
   Antes esta página trabajaba sobre un array "cuentas" de datos de
   ejemplo, en memoria, con TODOs marcando dónde debía ir Firestore.
   Ahora lee y escribe de verdad en la colección "cuentasPorPagar",
   filtrada por la empresa de la sesión activa (igual que el resto
   de los módulos: Reservas, Clientes, Proveedores, etc.).
   ============================================================ */
(function () {
  "use strict";

  // empresaId y sesionActual vienen de auth-check.js (evento
  // "sesionLista"), no de datos hardcodeados.
  let empresaId = null;
  let sucursalId = null;
  let sesionActual = null;

  let cuentas = [];
  let editandoId = null;
  let eliminandoId = null;

  const PAGE_SIZE = 5;
  let currentPage = 1;

  const tbody = document.getElementById('cuentas-body');
  const pageLabel = document.getElementById('page-label');
  const searchInput = document.getElementById('cuenta-search');
  const filterEstado = document.getElementById('filter-estado');
  const pageIndicator = document.getElementById('page-indicator');
  const pagePrev = document.getElementById('page-prev');
  const pageNext = document.getElementById('page-next');

  function formatGs(n){
    return 'Gs. ' + Math.round(n).toLocaleString('es-PY');
  }
  function formatFecha(iso){
    if (!iso) return '—';
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  function estadoLabel(e){
    return e === 'pendiente' ? 'Pendiente' : e === 'vencida' ? 'Vencida' : 'Pagada';
  }

  /* ============================================================
     FIRESTORE: CRUD de cuentas por pagar
     ============================================================ */
  async function cargarCuentas() {
    try {
      const snapshot = await db.collection('cuentasPorPagar')
        .where('empresaId', '==', empresaId)
        .get();
      const todas = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        // Mismo criterio que en el resto del sistema: cuenta de otra
        // sucursal (con sucursalId cargado y distinto) queda afuera;
        // cuenta ambigua (sin sucursalId, de antes de este cambio) se
        // deja pasar en todas hasta que se edite o se reclame con el
        // botón de arriba.
        if (data.sucursalId && data.sucursalId !== sucursalId) return;
        todas.push({ id: doc.id, ...data });
      });
      return todas;
    } catch (error) {
      console.error('Error al cargar cuentas por pagar:', error);
      return [];
    }
  }

  async function crearCuenta(datos) {
    try {
      datos.empresaId = empresaId;
      datos.codigo = `CP-${Date.now().toString().slice(-6)}`;
      await db.collection('cuentasPorPagar').add(datos);
    } catch (error) {
      console.error('Error al crear cuenta por pagar:', error);
      throw error;
    }
  }

  async function actualizarCuenta(id, datos) {
    try {
      await db.collection('cuentasPorPagar').doc(id).update(datos);
    } catch (error) {
      console.error('Error al actualizar cuenta por pagar:', error);
      throw error;
    }
  }

  async function eliminarCuentaDeFirebase(id) {
    try {
      await db.collection('cuentasPorPagar').doc(id).delete();
    } catch (error) {
      console.error('Error al eliminar cuenta por pagar:', error);
      throw error;
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderStats(list){
    const totalGeneral = list.reduce((s,c)=>s+(c.total||0),0);
    const totalPend = list.filter(c=>c.estado==='pendiente').reduce((s,c)=>s+(c.total||0),0);
    const totalVenc = list.filter(c=>c.estado==='vencida').reduce((s,c)=>s+(c.total||0),0);
    const totalPag = list.filter(c=>c.estado==='pagada').reduce((s,c)=>s+(c.total||0),0);
    document.getElementById('stat-total-general').textContent = formatGs(totalGeneral);
    document.getElementById('stat-total-pendiente').textContent = formatGs(totalPend);
    document.getElementById('stat-total-vencida').textContent = formatGs(totalVenc);
    document.getElementById('stat-total-pagada').textContent = formatGs(totalPag);
    document.getElementById('stat-count-pill').textContent = list.length;
  }

  function render(){
    const q = searchInput.value.trim().toLowerCase();
    const estadoF = filterEstado.value;
    let filtered = cuentas.filter(c=>{
      const matchQ = !q || (c.proveedor||'').toLowerCase().includes(q) || (c.ruc||'').toLowerCase().includes(q);
      const matchE = estadoF === 'all' || c.estado === estadoF;
      return matchQ && matchE;
    });
    filtered = filtered.slice().sort((a,b)=> (a.fecha||'').localeCompare(b.fecha||''));

    renderStats(cuentas);

    if(filtered.length === 0){
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No se encontraron cuentas a pagar con ese criterio.</div></td></tr>`;
      pageLabel.textContent = '0 resultados';
      pageIndicator.textContent = 'Página 1 de 1';
      pagePrev.disabled = true;
      pageNext.disabled = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if(currentPage > totalPages) currentPage = totalPages;
    if(currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const list = filtered.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = list.map(c => `
      <tr data-id="${c.id}">
        <td class="id-cell">${c.codigo || c.id.slice(0, 8).toUpperCase()}</td>
        <td>${c.proveedor || '—'}</td>
        <td class="ruc-cell">${c.ruc || '—'}</td>
        <td class="text-right">${formatGs(c.total || 0)}</td>
        <td>${formatFecha(c.fecha)}</td>
        <td><span class="estado-tag ${c.estado}">${estadoLabel(c.estado)}</span></td>
        <td class="col-actions">
          <div class="row-actions">
            <button class="action-btn btn-editar" data-id="${c.id}" title="Editar" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn action-btn-danger btn-eliminar" data-id="${c.id}" title="Eliminar" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
    pageLabel.textContent = `Mostrando ${start + 1}–${start + list.length} de ${filtered.length} cuentas`;
    pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
    pagePrev.disabled = currentPage <= 1;
    pageNext.disabled = currentPage >= totalPages;

    tbody.querySelectorAll('.btn-editar').forEach(b => b.addEventListener('click', () => abrirEditar(b.dataset.id)));
    tbody.querySelectorAll('.btn-eliminar').forEach(b => b.addEventListener('click', () => abrirConfirmEliminar(b.dataset.id)));
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó "sesionLista"
    cuentas = await cargarCuentas();
    render();
    renderAmbiguoBanner();
  }

  /* ============================================================
     CUENTAS "AMBIGUAS" (sin sucursalId, de antes de este cambio)
     ------------------------------------------------------------
     Se ven en todas las sucursales hasta que se les asigna una. En
     vez de obligar a editarlas una por una, este botón las asigna
     TODAS de una sola vez a la sucursal activa.
     ============================================================ */
  function contarCuentasAmbiguas() {
    return cuentas.filter(c => !c.sucursalId).length;
  }

  function renderAmbiguoBanner() {
    const banner = document.getElementById('ambiguo-banner');
    const text = document.getElementById('ambiguo-text');
    if (!banner || !text) return;
    const cantidad = contarCuentasAmbiguas();
    if (cantidad > 0) {
      text.textContent = `${cantidad} cuenta(s) todavía no tienen sucursal asignada y por eso se ven en todas.`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  async function asignarCuentasAmbiguasAEstaSucursal() {
    const btn = document.getElementById('ambiguo-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Asignando...';
    try {
      const ambiguas = cuentas.filter(c => !c.sucursalId);
      if (!ambiguas.length) return;

      const batch = db.batch();
      ambiguas.forEach(c => {
        batch.update(db.collection('cuentasPorPagar').doc(c.id), { sucursalId: sucursalId });
      });
      await batch.commit();
      console.log(`✅ Se asignaron ${ambiguas.length} cuenta(s) a la sucursal "${sucursalId}".`);
      await renderTodo();
    } catch (error) {
      console.error('Error al asignar cuentas ambiguas:', error);
      alert('No se pudieron asignar las cuentas. Revisá la consola.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Asignar a esta sucursal';
    }
  }

  (function initAmbiguo() {
    const btn = document.getElementById('ambiguo-btn');
    if (btn) btn.addEventListener('click', asignarCuentasAmbiguasAEstaSucursal);
  })();

  pagePrev.addEventListener('click', () => { currentPage--; render(); });
  pageNext.addEventListener('click', () => { currentPage++; render(); });

  // ----- Modal nueva/editar -----
  const modal = document.getElementById('nueva-cuenta-modal');
  const modalTitle = document.getElementById('cuenta-modal-title');
  const inputProveedor = document.getElementById('input-proveedor');
  const inputRuc = document.getElementById('input-ruc');
  const inputTotal = document.getElementById('input-total');
  const inputFecha = document.getElementById('input-fecha');
  const inputEstado = document.getElementById('input-estado');

  function abrirNueva(){
    editandoId = null;
    modalTitle.textContent = 'Nueva Cuenta a Pagar';
    inputProveedor.value = '';
    inputRuc.value = '';
    inputTotal.value = '';
    inputFecha.value = '';
    inputEstado.value = 'pendiente';
    modal.classList.add('open');
  }
  function abrirEditar(id){
    const c = cuentas.find(x=>x.id===id);
    if(!c) return;
    editandoId = id;
    modalTitle.textContent = 'Editar Cuenta a Pagar';
    inputProveedor.value = c.proveedor || '';
    inputRuc.value = c.ruc || '';
    inputTotal.value = c.total || '';
    inputFecha.value = c.fecha || '';
    inputEstado.value = c.estado || 'pendiente';
    modal.classList.add('open');
  }
  function cerrarModal(){ modal.classList.remove('open'); }

  document.getElementById('btn-nueva-cuenta').addEventListener('click', abrirNueva);
  document.getElementById('cierre-nueva-cuenta').addEventListener('click', cerrarModal);
  document.getElementById('cancelar-nueva-cuenta').addEventListener('click', cerrarModal);

  document.getElementById('guardar-nueva-cuenta').addEventListener('click', async () => {
    if(!inputProveedor.value.trim() || !inputRuc.value.trim() || !inputTotal.value || !inputFecha.value){
      alert('Completá proveedor, RUC, total y fecha.');
      return;
    }

    const datos = {
      proveedor: inputProveedor.value.trim(),
      ruc: inputRuc.value.trim(),
      total: parseFloat(inputTotal.value),
      fecha: inputFecha.value,
      estado: inputEstado.value,
      // Se reconstruye este objeto entero cada vez que se guarda (tanto al
      // crear como al editar), así que agregar sucursalId acá alcanza para
      // reclamar automáticamente cualquier cuenta ambigua (sin sucursalId,
      // de antes de este cambio) apenas alguien la edite.
      sucursalId: sucursalId
    };

    const guardarBtn = document.getElementById('guardar-nueva-cuenta');
    guardarBtn.disabled = true;
    try {
      if (editandoId) {
        await actualizarCuenta(editandoId, datos);
      } else {
        await crearCuenta(datos);
      }
      cerrarModal();
      await renderTodo();
    } catch (e) {
      alert('Error al guardar la cuenta. Revisá la consola (F12) para más detalles.');
    } finally {
      guardarBtn.disabled = false;
    }
  });

  // ----- Confirmar eliminación -----
  const confirmModal = document.getElementById('confirm-eliminar-cuenta-modal');
  function abrirConfirmEliminar(id){
    const c = cuentas.find(x=>x.id===id);
    if(!c) return;
    eliminandoId = id;
    document.getElementById('confirm-eliminar-text').textContent =
      `Vas a eliminar la cuenta de "${c.proveedor}" por ${formatGs(c.total || 0)}.`;
    confirmModal.classList.add('open');
  }
  document.getElementById('confirm-eliminar-cancel').addEventListener('click', () => confirmModal.classList.remove('open'));
  document.getElementById('confirm-eliminar-accept').addEventListener('click', async () => {
    if (!eliminandoId) return;
    const acceptBtn = document.getElementById('confirm-eliminar-accept');
    acceptBtn.disabled = true;
    try {
      await eliminarCuentaDeFirebase(eliminandoId);
      eliminandoId = null;
      confirmModal.classList.remove('open');
      await renderTodo();
    } catch (e) {
      alert('Error al eliminar la cuenta.');
    } finally {
      acceptBtn.disabled = false;
    }
  });

  // ----- Búsqueda y filtros -----
  searchInput.addEventListener('input', () => { currentPage = 1; render(); });
  filterEstado.addEventListener('change', () => { currentPage = 1; render(); });

  // ----- Moneda (visual only por ahora) -----
  document.querySelectorAll('#currency-toggle button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#currency-toggle button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // El selector de empresa/sucursal (abrir/cerrar menú, "Agregar empresa",
  // pintar opciones) ahora lo maneja auth-check.js igual que en el resto
  // de las páginas — ya no hace falta duplicar esa lógica acá.

  // auth-check.js valida la sesión, carga la empresa/sucursal real del
  // usuario logueado desde Firestore, pinta el topbar/sidebar y recién
  // entonces dispara "sesionLista" con esos datos reales.
  document.addEventListener('sesionLista', function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    sucursalId = sesionActual.sucursalId;
    currentPage = 1;
    renderTodo();
  });

})();