(function () {
  'use strict';

  // ========== DOM ELEMENTS ==========
  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('login-btn');
  const errorDiv = document.getElementById('login-error');


  const togglePasswordBtn = document.getElementById('toggle-password');
  const iconEye = togglePasswordBtn ? togglePasswordBtn.querySelector('.icon-eye') : null;
  const iconEyeOff = togglePasswordBtn ? togglePasswordBtn.querySelector('.icon-eye-off') : null;

  // Personalización
  const logoImg = document.getElementById('company-logo');
  const negocioNombre = document.getElementById('negocio-nombre');
  const customizeBtn = document.getElementById('btn-customize');
  const customModal = document.getElementById('customize-modal');
  const customClose = document.getElementById('customize-modal-close');
  const customCancel = document.getElementById('customize-cancel');
  const customSave = document.getElementById('customize-save');
  const customName = document.getElementById('custom-name');
  const customLogoInput = document.getElementById('custom-logo');
  const customLogoPreview = document.getElementById('custom-logo-preview');
  const customMsg = document.getElementById('customize-msg');

  // Recuperación de contraseña
  const forgotLink = document.getElementById('forgot-password');
  const resetModal = document.getElementById('reset-modal');
  const resetEmail = document.getElementById('reset-email');
  const resetMessage = document.getElementById('reset-message');
  const resetSendBtn = document.getElementById('reset-send');
  const resetCancelBtn = document.getElementById('reset-cancel');
  const resetCloseBtn = document.getElementById('reset-modal-close');

  // ========== MOSTRAR / OCULTAR CONTRASEÑA ==========
  // Alterna el type del input entre "password" y "text", y cambia el
  // ícono (ojo <-> ojo tachado) + el aria-label, para que sea accesible
  // con lector de pantalla y no solo visual.
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', function () {
      const wasVisible = passwordInput.type === 'text';
      const willBeVisible = !wasVisible;

      passwordInput.type = willBeVisible ? 'text' : 'password';
      togglePasswordBtn.setAttribute('aria-pressed', String(willBeVisible));
      togglePasswordBtn.setAttribute(
        'aria-label',
        willBeVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'
      );

      // Importante: el ícono refleja el estado NUEVO (después del toggle),
      // no el que había antes del clic — por eso se usa "willBeVisible" y
      // no "wasVisible" acá.
      if (iconEye && iconEyeOff) {
        iconEye.style.display = willBeVisible ? '' : 'none';
        iconEyeOff.style.display = willBeVisible ? 'none' : '';
      }

      // Mantiene el foco (y el cursor donde estaba) en el campo después
      // de tocar el ícono, en vez de que el foco se vaya al botón.
      passwordInput.focus();
    });
  }

  // ========== PERSONALIZACIÓN CON LOCALSTORAGE ==========
  function cargarPersonalizacion() {
    const stored = localStorage.getItem('gastro_custom');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.nombre) {
          negocioNombre.textContent = data.nombre;
          document.title = `Gastro — ${data.nombre}`;
        }
        if (data.logo) {
          logoImg.src = data.logo;
        }
      } catch (e) {
        console.warn('Error al leer personalización:', e);
      }
    }
  }

  function abrirModalPersonalizar() {
    const stored = localStorage.getItem('gastro_custom');
    let data = {};
    if (stored) {
      try { data = JSON.parse(stored); } catch (e) {}
    }
    customName.value = data.nombre || '';
    customLogoPreview.innerHTML = data.logo ? `<img src="${data.logo}" alt="Logo actual">` : '';
    customMsg.textContent = '';
    customMsg.className = '';
    customModal.classList.add('open');
    customLogoInput.value = '';
  }

  function cerrarModalPersonalizar() {
    customModal.classList.remove('open');
  }

  function mostrarCustomMsg(texto, tipo) {
    customMsg.textContent = texto;
    customMsg.className = tipo;
  }

  customLogoInput.addEventListener('change', function () {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        customLogoPreview.innerHTML = `<img src="${e.target.result}" alt="Nuevo logo">`;
      };
      reader.readAsDataURL(file);
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

  async function guardarPersonalizacion() {
    const nombre = customName.value.trim();
    if (!nombre) {
      mostrarCustomMsg('El nombre es obligatorio.', 'error');
      return;
    }

    let logoBase64 = null;
    const file = customLogoInput.files[0];
    if (file) {
      try {
        logoBase64 = await leerArchivoComoBase64(file);
      } catch (e) {
        mostrarCustomMsg('Error al leer la imagen.', 'error');
        return;
      }
    }

    customSave.disabled = true;
    customSave.textContent = 'Guardando...';

    try {
      const data = { nombre };
      if (logoBase64) data.logo = logoBase64;
      localStorage.setItem('gastro_custom', JSON.stringify(data));

      negocioNombre.textContent = nombre;
      document.title = `Gastro — ${nombre}`;
      if (logoBase64) logoImg.src = logoBase64;

      mostrarCustomMsg('✅ Configuración guardada correctamente.', 'success');
      customLogoInput.value = '';
      setTimeout(cerrarModalPersonalizar, 1500);
    } catch (error) {
      console.error(error);
      mostrarCustomMsg('Error al guardar: ' + error.message, 'error');
    } finally {
      customSave.disabled = false;
      customSave.textContent = 'Guardar cambios';
    }
  }

  // Eventos personalización
  customizeBtn.addEventListener('click', abrirModalPersonalizar);
  customClose.addEventListener('click', cerrarModalPersonalizar);
  customCancel.addEventListener('click', cerrarModalPersonalizar);
  customModal.addEventListener('click', function (e) {
    if (e.target === this) cerrarModalPersonalizar();
  });
  customSave.addEventListener('click', guardarPersonalizacion);

  // ========== LOGIN ==========
  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }

  function hideError() {
    errorDiv.style.display = 'none';
  }

  function setLoading(loading) {
    if (loading) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<span class="spinner"></span> Ingresando...';
    } else {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Iniciar sesión';
    }
  }

  // Busca los datos del usuario (empresaId, nombre, rol) en la colección "usuarios".
  // Intenta primero por UID (doc.id === uid, lo recomendado), y si no existe,
  // hace fallback buscando por el campo "email" dentro de la colección.
  // Devuelve también la referencia al documento (docRef), para poder
  // actualizar campos como "last_access" más adelante.
  async function obtenerDatosUsuario(uid, email) {
    // Intento 1: documento con ID = uid
    const porUid = await db.collection('usuarios').doc(uid).get();
    if (porUid.exists) {
      return { data: porUid.data(), docRef: porUid.ref };
    }

    // Intento 2: documento con un campo "email" que coincide
    const porEmail = await db.collection('usuarios')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!porEmail.empty) {
      return { data: porEmail.docs[0].data(), docRef: porEmail.docs[0].ref };
    }

    return null;
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Completa todos los campos.');
      return;
    }

    setLoading(true);

    try {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      const uid = cred.user.uid;

      const resultado = await obtenerDatosUsuario(uid, email);

      if (!resultado || !resultado.data.empresaId) {
        // El login en Firebase Auth funcionó, pero no hay perfil/empresa asociada.
        await auth.signOut();
        showError('Tu cuenta no tiene una empresa asignada. Contactá al administrador.');
        setLoading(false);
        return;
      }

      const datosUsuario = resultado.data;

      // Limpia cualquier sucursal seleccionada de una sesión anterior (por si
      // en este mismo navegador se logueó antes otro usuario/empresa).
      sessionStorage.removeItem('sucursalId');

      sessionStorage.setItem('user', JSON.stringify({
        uid: uid,
        email: cred.user.email,
        empresaId: datosUsuario.empresaId,
        nombre: datosUsuario.nombre || cred.user.email,
        rol: datosUsuario.rol || '',
        // Sucursal FIJA asignada desde Usuarios (si el administrador eligió
        // una en vez de "Todas las sucursales"). Viaja pegada a la sesión
        // (no solo como sessionStorage.sucursalId suelto) para que
        // auth-check.js pueda forzarla siempre y ocultar el selector,
        // aunque alguien intente cambiar la clave suelta a mano.
        sucursalFija: datosUsuario.sucursalId || null
      }));

      // Si el usuario tiene una sucursal fija asignada en su perfil, arranca
      // en esa. Si no tiene ninguna (Administrador con acceso a todas), no
      // se fija nada acá — auth-check.js va a usar la primera sucursal de
      // la lista como punto de partida.
      if (datosUsuario.sucursalId) {
        sessionStorage.setItem('sucursalId', datosUsuario.sucursalId);
      }

      // Registra la fecha/hora de este login en Firestore, para que la
      // columna "Último acceso" en Usuarios deje de estar siempre vacía.
      // No se espera (no "await") a propósito: si esto falla, no debe
      // bloquear ni demorar el ingreso del usuario a la app.
      resultado.docRef.update({ last_access: new Date().toISOString() })
        .catch(err => console.warn('No se pudo actualizar last_access:', err));

      window.location.href = 'dashboard.html';
    } catch (error) {
      console.error('Error de login:', error);
      let msg = 'Credenciales incorrectas. Verifica tu email y contraseña.';
      if (error.code === 'auth/user-not-found') msg = 'No existe una cuenta con este email.';
      else if (error.code === 'auth/wrong-password') msg = 'Contraseña incorrecta.';
      else if (error.code === 'auth/too-many-requests') msg = 'Demasiados intentos. Espera un momento.';
      else if (error.code === 'auth/invalid-email') msg = 'Email inválido.';
      else if (error.code === 'auth/network-request-failed') msg = 'Error de conexión.';
      showError(msg);
      setLoading(false);
    }
  });

  // ========== RECUPERAR CONTRASEÑA ==========
  function openResetModal() {
    resetModal.classList.add('open');
    resetEmail.value = '';
    resetMessage.textContent = '';
    resetMessage.className = '';
    resetEmail.focus();
  }

  function closeResetModal() {
    resetModal.classList.remove('open');
  }

  forgotLink.addEventListener('click', function (e) {
    e.preventDefault();
    openResetModal();
  });

  resetCloseBtn.addEventListener('click', closeResetModal);
  resetCancelBtn.addEventListener('click', closeResetModal);
  resetModal.addEventListener('click', function (e) {
    if (e.target === this) closeResetModal();
  });

  resetSendBtn.addEventListener('click', async function () {
    const email = resetEmail.value.trim();
    if (!email) {
      resetMessage.textContent = 'Ingresa tu correo electrónico.';
      resetMessage.className = 'error';
      return;
    }

    resetSendBtn.disabled = true;
    resetSendBtn.textContent = 'Enviando...';
    resetMessage.textContent = '';
    resetMessage.className = '';

    try {
      await auth.sendPasswordResetEmail(email);
      resetMessage.textContent = '📨 Se envió un enlace de recuperación a tu correo.';
      resetMessage.className = 'success';
      resetEmail.value = '';
      setTimeout(closeResetModal, 3000);
    } catch (error) {
      let msg = 'Error al enviar el enlace.';
      if (error.code === 'auth/user-not-found') msg = 'No existe una cuenta con este email.';
      else if (error.code === 'auth/invalid-email') msg = 'Email inválido.';
      resetMessage.textContent = msg;
      resetMessage.className = 'error';
    } finally {
      resetSendBtn.disabled = false;
      resetSendBtn.textContent = 'Enviar enlace';
    }
  });

  resetEmail.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      resetSendBtn.click();
    }
  });

  // ========== INICIO ==========
  cargarPersonalizacion();

})();