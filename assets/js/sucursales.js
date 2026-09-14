(function () {
  "use strict";

  let empresaId = null;
  let sucursales = [];
  let editandoId = null;
  let eliminandoId = null;

  const tbody = document.getElementById('sucursales-body');
  const btnNueva = document.getElementById('btn-nueva-sucursal');

  const modal = document.getElementById('sucursal-modal');
  const modalTitle = document.getElementById('sucursal-modal-title');
  const inputNombre = document.getElementById('input-sucursal-nombre');
  const inputDireccion = document.getElementById('input-sucursal-direccion');
  const inputTelefono = document.getElementById('input-sucursal-telefono');

  const confirmModal = document.getElementById('sucursal-confirm-modal');

  function coleccion() {
    return db.collection('empresas').doc(empresaId).collection('sucursales');
  }

  async function cargarSucursales() {
    try {
      const snap = await coleccion().get();
      sucursales = [];
      snap.forEach(doc => sucursales.push({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error cargando sucursales:', error);
      sucursales = [];
    }
  }

  function render() {
    if (sucursales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Todavía no tenés sucursales cargadas.</td></tr>`;
      return;
    }
    tbody.innerHTML = sucursales.map(s => `
      <tr data-id="${s.id}">
        <td><strong>${s.nombre || '—'}</strong></td>
        <td>${s.direccion || '—'}</td>
        <td>${s.telefono || '—'}</td>
        <td class="col-actions">
          <div class="row-actions">
            <button class="action-btn btn-editar" data-id="${s.id}" title="Editar" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn action-btn-danger btn-eliminar" data-id="${s.id}" title="Eliminar" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-editar').forEach(b => b.addEventListener('click', () => abrirEditar(b.dataset.id)));
    tbody.querySelectorAll('.btn-eliminar').forEach(b => b.addEventListener('click', () => abrirConfirmEliminar(b.dataset.id)));
  }

  function abrirNueva() {
    editandoId = null;
    modalTitle.textContent = 'Nueva sucursal';
    inputNombre.value = '';
    inputDireccion.value = '';
    inputTelefono.value = '';
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirEditar(id) {
    const s = sucursales.find(x => x.id === id);
    if (!s) return;
    editandoId = id;
    modalTitle.textContent = 'Editar sucursal';
    inputNombre.value = s.nombre || '';
    inputDireccion.value = s.direccion || '';
    inputTelefono.value = s.telefono || '';
    modal.classList.add('open');
  }

  function cerrarModal() {
    modal.classList.remove('open');
  }

  async function guardar() {
    const nombre = inputNombre.value.trim();
    if (!nombre) {
      alert('El nombre de la sucursal es obligatorio.');
      return;
    }
    const datos = {
      nombre,
      direccion: inputDireccion.value.trim(),
      telefono: inputTelefono.value.trim()
    };

    const btn = document.getElementById('sucursal-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      if (editandoId) {
        await coleccion().doc(editandoId).update(datos);
      } else {
        await coleccion().add(datos);
      }
      cerrarModal();
      await cargarSucursales();
      render();
    } catch (error) {
      console.error('Error al guardar sucursal:', error);
      alert('No se pudo guardar la sucursal.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  }

  function abrirConfirmEliminar(id) {
    const s = sucursales.find(x => x.id === id);
    if (!s) return;
    eliminandoId = id;
    document.getElementById('sucursal-confirm-text').textContent =
      `Vas a eliminar "${s.nombre}". Esta acción no se puede deshacer.`;
    confirmModal.classList.add('open');
  }

  async function eliminar() {
    if (!eliminandoId) return;
    try {
      await coleccion().doc(eliminandoId).delete();
      eliminandoId = null;
      confirmModal.classList.remove('open');
      await cargarSucursales();
      render();
    } catch (error) {
      console.error('Error al eliminar sucursal:', error);
      alert('No se pudo eliminar la sucursal.');
    }
  }

  function initEventos() {
    btnNueva.addEventListener('click', abrirNueva);
    document.getElementById('sucursal-modal-close').addEventListener('click', cerrarModal);
    document.getElementById('sucursal-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('sucursal-guardar').addEventListener('click', guardar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });

    document.getElementById('sucursal-confirm-cancel').addEventListener('click', () => confirmModal.classList.remove('open'));
    document.getElementById('sucursal-confirm-accept').addEventListener('click', eliminar);
    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) confirmModal.classList.remove('open'); });
  }

  // Espera a que auth-check.js confirme la sesión y entregue empresaId real.
  // Solo un admin puede crear/editar/eliminar sucursales; el resto solo ve
  // la lista (el botón "+ Nueva sucursal" queda oculto si no es admin).
  document.addEventListener('sesionLista', async (e) => {
    const sesion = e.detail;
    empresaId = sesion.empresaId;

    // El rol se guarda como "Administrador" (así lo carga Usuarios), no
    // como "admin" — por eso antes el botón quedaba oculto siempre.
    const esAdmin = /admin/i.test(sesion.rol || '');
    if (esAdmin) {
      btnNueva.style.display = 'inline-flex';
    }

    initEventos();
    await cargarSucursales();
    render();
  });

})();