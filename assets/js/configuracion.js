(function () {
  'use strict';

  const empresaSelect = document.getElementById('empresa-id');
  const nombreInput = document.getElementById('config-nombre');
  const logoInput = document.getElementById('config-logo');
  const logoPreview = document.getElementById('config-logo-preview');
  const saveBtn = document.getElementById('config-save');
  const msgEl = document.getElementById('config-msg');

  let empresas = [];
  let empresaSeleccionada = null;

  // Cargar lista de empresas
  async function cargarEmpresas() {
    try {
      const snapshot = await db.collection('empresas').get();
      empresas = [];
      empresaSelect.innerHTML = '<option value="">Selecciona una empresa</option>';
      snapshot.forEach(doc => {
        const data = doc.data();
        empresas.push({ id: doc.id, ...data });
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = data.nombre || doc.id;
        empresaSelect.appendChild(opt);
      });
      // Seleccionar la primera por defecto
      if (empresas.length > 0) {
        empresaSelect.value = empresas[0].id;
        cargarDatosEmpresa(empresas[0].id);
      }
    } catch (error) {
      console.error('Error cargando empresas:', error);
    }
  }

  function cargarDatosEmpresa(id) {
    const empresa = empresas.find(e => e.id === id);
    if (!empresa) return;
    empresaSeleccionada = empresa;
    nombreInput.value = empresa.nombre || '';
    if (empresa.logo) {
      logoPreview.innerHTML = `<img src="${empresa.logo}" alt="Logo">`;
    } else {
      logoPreview.innerHTML = '';
    }
  }

  empresaSelect.addEventListener('change', function () {
    cargarDatosEmpresa(this.value);
  });

  // Previsualizar logo seleccionado
  logoInput.addEventListener('change', function () {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        logoPreview.innerHTML = `<img src="${e.target.result}" alt="Nuevo logo">`;
      };
      reader.readAsDataURL(file);
    }
  });

  // Guardar cambios
  saveBtn.addEventListener('click', async function () {
    const id = empresaSelect.value;
    if (!id) {
      mostrarMensaje('Selecciona una empresa.', 'error');
      return;
    }

    const nombre = nombreInput.value.trim();
    if (!nombre) {
      mostrarMensaje('El nombre es obligatorio.', 'error');
      return;
    }

    let logoBase64 = null;
    const file = logoInput.files[0];
    if (file) {
      try {
        logoBase64 = await leerArchivoComoBase64(file);
      } catch (e) {
        mostrarMensaje('Error al leer la imagen.', 'error');
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
      const updateData = { nombre };
      if (logoBase64) {
        updateData.logo = logoBase64;
      }
      await db.collection('empresas').doc(id).update(updateData);
      mostrarMensaje('✅ Configuración guardada correctamente.', 'success');
      // Recargar datos
      await cargarEmpresas();
      logoInput.value = '';
    } catch (error) {
      console.error(error);
      mostrarMensaje('Error al guardar: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar cambios';
    }
  });

  function leerArchivoComoBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function mostrarMensaje(texto, tipo) {
    msgEl.textContent = texto;
    msgEl.className = 'msg ' + tipo;
    msgEl.style.display = 'block';
    setTimeout(() => {
      msgEl.style.display = 'none';
    }, 5000);
  }

  // Inicializar
  cargarEmpresas();

  // También renderizar el selector de empresa en el topbar (igual que en dashboard)
  // (Se puede reutilizar la función, pero por simplicidad no lo incluyo aquí)

})();