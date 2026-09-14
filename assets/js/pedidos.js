(function () {
  "use strict";

  const PAGE_SIZE = 8;

  // Antes esto era un array EMPRESAS fijo (mock). Ahora empresaId se llena
  // recién cuando llega el evento "sesionLista" que dispara auth-check.js
  // con los datos reales de Firestore.
  let empresaId = null;
  let pagina = 1;
  let moneda = "Gs";
  let pedidos = [];
  let pedidosFiltrados = [];
  let productos = [];

  let estadoModalTargetId = null;
  let estadoModalSelected = null;
  let nuevoPedidoItems = [];
  let editPedidoItems = [];
  let editPedidoId = null;

  const rates = { "US$": 1, "Gs": 7300, "R$": 5.4 };
  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

  /* ============================================================
     FUNCIONES DE FIREBASE
     ------------------------------------------------------------
     cargarPedidos ahora filtra por empresaId real (antes traía
     TODOS los pedidos de TODAS las empresas sin filtrar).
     ============================================================ */
  async function cargarPedidos() {
    try {
      const snapshot = await db.collection('pedidos')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("❌ Error al cargar pedidos:", error);
      return [];
    }
  }

  // ⚠️ Antes esto traía TODA la colección "productos", de TODAS las
  // empresas, sin ningún .where(). Con las reglas de seguridad de
  // Firestore (que exigen que el documento tenga el mismo empresaId que
  // la sesión activa), una consulta sin filtrar es rechazada por completo
  // ("Missing or insufficient permissions") — por eso el combobox de
  // "Nuevo pedido" / "Editar pedido" quedaba vacío ("No se encontraron
  // productos") aunque el producto existiera y se viera bien en Menú.
  // Se agrega el mismo filtro por empresaId que ya usan facturacion.js y
  // menu.js.
  async function cargarProductos() {
    try {
      const snapshot = await db.collection('productos')
        .where('empresaId', '==', empresaId)
        .get();
      const todos = [];
      snapshot.forEach(doc => {
        todos.push({ id: doc.id, ...doc.data() });
      });
      return todos;
    } catch (error) {
      console.error("❌ Error al cargar productos:", error);
      return [];
    }
  }

  async function actualizarEstadoPedido(id, nuevoEstado) {
    try {
      await db.collection('pedidos').doc(id).update({ status: nuevoEstado });
      console.log(`✅ Pedido ${id} actualizado a ${nuevoEstado}`);
    } catch (error) {
      console.error("❌ Error al actualizar pedido:", error);
      throw error;
    }
  }

  async function crearPedido(datos) {
    try {
      datos.empresaId = empresaId;
      datos.created_at = new Date().toISOString();
      const docRef = await db.collection('pedidos').add(datos);
      console.log("✅ Pedido creado con ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("❌ Error al crear pedido:", error);
      throw error;
    }
  }

  async function actualizarPedido(id, datos) {
    try {
      datos.empresaId = empresaId;
      await db.collection('pedidos').doc(id).update(datos);
      console.log(`✅ Pedido ${id} actualizado`);
    } catch (error) {
      console.error("❌ Error al actualizar pedido:", error);
      throw error;
    }
  }

  /* ============================================================
     FUNCIONES DE UTILIDAD Y FORMATEO
     ============================================================ */
  function formatearPrecio(valor) {
    const simbolo = symbols[moneda];
    let montoFinal;

    if (moneda === "Gs") {
      montoFinal = Math.round(valor);
      return `${simbolo}${montoFinal.toLocaleString("es-PY", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
      })}`;
    } else if (moneda === "US$") {
      montoFinal = valor / rates["Gs"];
      return `${simbolo}${montoFinal.toFixed(2)}`;
    } else if (moneda === "R$") {
      montoFinal = (valor / rates["Gs"]) * rates["R$"];
      return `${simbolo}${montoFinal.toFixed(2)}`;
    }
  }

  function formatearNumero(valor) {
    if (isNaN(valor) || valor === 0) return '';
    return Math.round(valor).toLocaleString('es-PY');
  }

  function parseNumero(texto) {
    if (!texto) return 0;
    const limpio = texto.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(limpio);
    return isNaN(num) ? 0 : num;
  }

  function formatearFecha(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  }

  function getEstadoLabel(estado) {
    const map = {
      "Pending": "Pendiente",
      "Preparing": "Preparando",
      "Out for delivery": "En camino",
      "Delivered": "Entregado",
      "Canceled": "Cancelado"
    };
    return map[estado] || estado;
  }

  function calcularTotalFinal(pedido) {
    let total = 0;
    if (pedido.items && Array.isArray(pedido.items)) {
      total += pedido.items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0);
    }
    if (pedido.charges && pedido.charges.delivery) {
      total += pedido.charges.delivery;
    }
    return total;
  }

  function getItemsSummary(items) {
    if (!items || items.length === 0) return "—";
    const names = items.map(i => i.name || "Producto");
    const totalCount = items.reduce((s, i) => s + (i.qty || 1), 0);

    if (items.length === 1) {
      const qty = items[0].qty || 1;
      return `${names[0]} ${qty > 1 ? `× ${qty}` : ''}`;
    }

    let summary = names.slice(0, 2).join(", ");
    if (names.length > 2) {
      summary += ` +${names.length - 2} más`;
    }
    summary += ` (${totalCount} ítems)`;
    return summary;
  }

  /* ============================================================
     COMBOBOX PERSONALIZADO
     ============================================================ */
  function initCombobox(comboboxId, inputId, optionsId, onSelect) {
    const combobox = document.getElementById(comboboxId);
    const input = document.getElementById(inputId);
    const optionsContainer = document.getElementById(optionsId);

    if (!combobox || !input || !optionsContainer) return null;

    let currentOptions = [];

    function filterOptions(query) {
      const q = query.toLowerCase().trim();
      const filtered = currentOptions.filter(p => p.name.toLowerCase().includes(q));
      renderOptions(filtered);
    }

    function renderOptions(list) {
      if (list.length === 0) {
        optionsContainer.innerHTML = `<div class="no-results">No se encontraron productos</div>`;
      } else {
        let html = '';
        list.forEach(p => {
          html += `<div class="option-item" data-name="${p.name}" data-price="${p.price}">${p.name}</div>`;
        });
        optionsContainer.innerHTML = html;
        optionsContainer.querySelectorAll('.option-item').forEach(el => {
          el.addEventListener('click', function() {
            const name = this.dataset.name;
            const price = parseFloat(this.dataset.price);
            input.value = name;
            optionsContainer.classList.remove('show');
            if (onSelect) onSelect(name, price);
          });
        });
      }
    }

    input.addEventListener('input', function() {
      const query = this.value;
      filterOptions(query);
      if (query.length > 0) {
        optionsContainer.classList.add('show');
      } else {
        optionsContainer.classList.remove('show');
      }
    });

    input.addEventListener('focus', function() {
      if (this.value.length > 0) {
        filterOptions(this.value);
        optionsContainer.classList.add('show');
      } else {
        if (currentOptions.length > 0) {
          renderOptions(currentOptions);
          optionsContainer.classList.add('show');
        }
      }
    });

    input.addEventListener('blur', function() {
      setTimeout(() => {
        optionsContainer.classList.remove('show');
      }, 200);
    });

    document.addEventListener('click', function(e) {
      if (!combobox.contains(e.target)) {
        optionsContainer.classList.remove('show');
      }
    });

    function setOptions(list) {
      currentOptions = list;
    }

    function clear() {
      input.value = '';
      optionsContainer.classList.remove('show');
    }

    return { setOptions, clear, input };
  }

  /* ============================================================
     RENDER
     ------------------------------------------------------------
     El selector de empresa/sucursal y el chip de usuario ya los
     pinta auth-check.js — acá ya no se tocan.
     ============================================================ */
  const ICON_VER = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const ICON_CHECK = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  const ICON_EDITAR = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  function renderTabla() {
    const tbody = document.getElementById("pedidos-body");
    if (!tbody) return;

    const term = document.getElementById("pedido-search")?.value?.toLowerCase() || "";
    const estadoFilter = document.getElementById("filter-estado")?.value || "all";

    pedidosFiltrados = pedidos.filter(p => {
      const matchTerm = !term ||
        (p.id || "").toLowerCase().includes(term) ||
        (p.customer?.name || "").toLowerCase().includes(term) ||
        (p.customer?.phone || "").includes(term);
      const matchEstado = estadoFilter === "all" || p.status === estadoFilter;
      return matchTerm && matchEstado;
    });

    pedidosFiltrados.sort((a, b) => {
      const da = new Date(a.created_at);
      const db = new Date(b.created_at);
      return db - da;
    });

    const totalPages = Math.max(1, Math.ceil(pedidosFiltrados.length / PAGE_SIZE));
    if (pagina > totalPages) pagina = totalPages;
    const start = (pagina - 1) * PAGE_SIZE;
    const pageItems = pedidosFiltrados.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No hay pedidos registrados.</td></tr>`;
    } else {
      pageItems.forEach(p => {
        const tr = document.createElement("tr");
        const estadoLabel = getEstadoLabel(p.status);
        const total = calcularTotalFinal(p);
        const itemsSummary = getItemsSummary(p.items);
        const fullItemList = p.items?.map(i => `${i.name || ''} x${i.qty || 1}`).join(', ') || '';
        const shortId = (p.id || "").slice(0, 20).toUpperCase();

        tr.innerHTML = `
          <td class="id" style="font-size: 11px;">${shortId}</td>
          <td>${p.customer?.name || "—"}</td>
          <td>${p.customer?.phone || "—"}</td>
          <td title="${fullItemList}">${itemsSummary}</td>
          <td>${p.deliveryType === "pickup" ? "Retiro" : "Delivery"}</td>
          <td>${formatearFecha(p.created_at)}</td>
          <td>${formatearPrecio(total)}</td>
          <td><span class="estado ${p.status}">${estadoLabel}</span></td>
          <td style="display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: nowrap;">
            <button class="btn-accion ver" data-id="${p.id}" title="Ver detalle">${ICON_VER}</button>
            <button class="btn-accion registrar" data-id="${p.id}" title="Registrar pedido">${ICON_CHECK}</button>
            <button class="btn-accion editar" data-id="${p.id}" title="Editar pedido">${ICON_EDITAR}</button>
          </td>
        </tr>`;

        tr.querySelector(".ver").addEventListener("click", () => abrirDetalle(p.id));
        tr.querySelector(".registrar").addEventListener("click", () => abrirModalRegistrar(p.id));
        tr.querySelector(".editar").addEventListener("click", () => abrirModalEditarPedido(p.id));
        tbody.appendChild(tr);
      });
    }

    const pageLabel = document.getElementById("page-label");
    if (pageLabel) pageLabel.textContent = `Página ${pagina} de ${totalPages}`;
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.disabled = pagina <= 1;
    if (nextBtn) nextBtn.disabled = pagina >= totalPages;
  }

  async function renderTodo() {
    if (!empresaId) return; // todavía no llegó la sesión
    const todos = await cargarPedidos();
    pedidos = todos;
    renderTabla();
  }

  /* ============================================================
     CAMBIAR ESTADO (modal)
     ============================================================ */
  function abrirModalEstado(id) {
    const pedido = pedidos.find(p => p.id === id);
    if (!pedido) return;
    estadoModalTargetId = id;
    estadoModalSelected = pedido.status || "Pending";

    const idLabel = document.getElementById("estado-modal-id");
    if (idLabel) idLabel.textContent = (id || "").slice(0, 20).toUpperCase();

    document.querySelectorAll("#estado-options .estado-option").forEach(btn => {
      btn.classList.toggle("selected", btn.getAttribute("data-estado") === estadoModalSelected);
    });

    const overlay = document.getElementById("estado-modal-overlay");
    if (overlay) overlay.classList.add("open");
  }

  function cerrarModalEstado() {
    const overlay = document.getElementById("estado-modal-overlay");
    if (overlay) overlay.classList.remove("open");
    estadoModalTargetId = null;
  }

  async function guardarEstadoModal() {
    if (!estadoModalTargetId || !estadoModalSelected) return;
    const guardarBtn = document.getElementById("estado-modal-guardar");
    try {
      if (guardarBtn) guardarBtn.disabled = true;
      await actualizarEstadoPedido(estadoModalTargetId, estadoModalSelected);
      cerrarModalEstado();
      await renderTodo();
    } catch (e) {
      alert("Error al cambiar estado.");
    } finally {
      if (guardarBtn) guardarBtn.disabled = false;
    }
  }

  function initModalEstado() {
    const overlay = document.getElementById("estado-modal-overlay");
    const closeBtn = document.getElementById("estado-modal-close");
    const cancelBtn = document.getElementById("estado-modal-cancelar");
    const guardarBtn = document.getElementById("estado-modal-guardar");

    if (closeBtn) closeBtn.addEventListener("click", cerrarModalEstado);
    if (cancelBtn) cancelBtn.addEventListener("click", cerrarModalEstado);
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === this) cerrarModalEstado(); });
    document.querySelectorAll("#estado-options .estado-option").forEach(btn => {
      btn.addEventListener("click", () => {
        estadoModalSelected = btn.getAttribute("data-estado");
        document.querySelectorAll("#estado-options .estado-option").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });
    if (guardarBtn) guardarBtn.addEventListener("click", guardarEstadoModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarModalEstado();
      }
    });
  }

  /* ============================================================
     MODAL REGISTRAR PEDIDO (Check verde)
     ============================================================ */
  function abrirModalRegistrar(id) {
    const pedido = pedidos.find(p => p.id === id);
    if (!pedido) return;

    document.getElementById('registrar-modal-actions').style.display = 'flex';
    document.getElementById('registrar-modal-guardar').disabled = false;

    let itemsHtml = '';
    let subtotal = 0;
    if (pedido.items && pedido.items.length > 0) {
      pedido.items.forEach(item => {
        const qty = item.qty || 1;
        const price = item.price || 0;
        const totalItem = price * qty;
        subtotal += totalItem;
        itemsHtml += `<li><span>${item.name || 'Producto'} × ${qty}</span><span>${formatearPrecio(totalItem)}</span></li>`;
      });
    } else {
      itemsHtml = "<li>Sin productos</li>";
    }

    const delivery = pedido.charges?.delivery || 0;
    const total = subtotal + delivery;

    const infoHtml = `
      <div class="detalle-info">
        <div class="detalle-row">
          <span><strong>Pedido ID:</strong> ${(pedido.id || "").toUpperCase()}</span>
          <span><strong>Cliente:</strong> ${pedido.customer?.name || "—"}</span>
        </div>
        <div class="detalle-row">
          <span><strong>Teléfono:</strong> ${pedido.customer?.phone || "—"}</span>
          <span><strong>Fecha:</strong> ${formatearFecha(pedido.created_at)}</span>
        </div>
        <div class="detalle-row">
          <span><strong>Tipo:</strong> ${pedido.deliveryType === "pickup" ? "Retiro en local" : "Delivery"}</span>
          <span><strong>Estado actual:</strong> ${getEstadoLabel(pedido.status)}</span>
        </div>
        <hr />
        <div class="detalle-items">
          <h4>Productos</h4>
          <ul>${itemsHtml}</ul>
        </div>
        <div class="detalle-totales">
          <div><span>Subtotal</span><span>${formatearPrecio(subtotal)}</span></div>
          <div><span>Delivery</span><span>${formatearPrecio(delivery)}</span></div>
          <div class="total"><span>Total</span><span>${formatearPrecio(total)}</span></div>
        </div>
      </div>
    `;

    document.getElementById('registrar-pedido-info').innerHTML = infoHtml;
    document.getElementById('registrar-modal-overlay').classList.add("open");
    document.getElementById('registrar-modal-guardar').dataset.id = id;
  }

  function cerrarModalRegistrar() {
    document.getElementById('registrar-modal-overlay').classList.remove("open");
  }

  async function registrarPedido() {
    const guardarBtn = document.getElementById('registrar-modal-guardar');
    const id = guardarBtn.dataset.id;
    if (!id) return;

    try {
      guardarBtn.disabled = true;
      await actualizarEstadoPedido(id, "Delivered");

      document.getElementById('registrar-modal-actions').style.display = 'none';
      document.getElementById('registrar-pedido-info').innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <svg width="60" height="60" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="25" fill="#22c55e" />
            <path d="M15 27.5 L22.5 35 L38 18" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <h3 style="color: #22c55e; margin-top: 15px; margin-bottom: 5px;">¡Pedido registrado con éxito!</h3>
          <p style="color: #6b7280; margin-top: 0;">El estado del pedido ha sido actualizado a Entregado.</p>
        </div>
      `;

      setTimeout(() => {
        cerrarModalRegistrar();
        renderTodo();
      }, 2000);

    } catch (e) {
      alert("Error al registrar el pedido.");
      guardarBtn.disabled = false;
    }
  }

  function initModalRegistrar() {
    const overlay = document.getElementById('registrar-modal-overlay');
    const closeBtn = document.getElementById('registrar-modal-close');
    const cancelBtn = document.getElementById('registrar-modal-cancelar');
    const guardarBtn = document.getElementById('registrar-modal-guardar');

    if (closeBtn) closeBtn.addEventListener("click", cerrarModalRegistrar);
    if (cancelBtn) cancelBtn.addEventListener("click", cerrarModalRegistrar);
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === this) cerrarModalRegistrar(); });
    if (guardarBtn) guardarBtn.addEventListener("click", registrarPedido);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarModalRegistrar();
      }
    });
  }

  /* ============================================================
     DETALLE DEL PEDIDO
     ============================================================ */
  function abrirDetalle(id) {
    const pedido = pedidos.find(p => p.id === id);
    if (!pedido) return;

    document.getElementById("detalle-modal-title").textContent = `Pedido #${(id || "").slice(0, 20).toUpperCase()}`;
    document.getElementById("detalle-cliente").textContent = pedido.customer?.name || "—";
    document.getElementById("detalle-telefono").textContent = pedido.customer?.phone || "—";
    document.getElementById("detalle-fecha").textContent = formatearFecha(pedido.created_at);
    document.getElementById("detalle-estado").textContent = getEstadoLabel(pedido.status);
    document.getElementById("detalle-tipo").textContent = pedido.deliveryType === "pickup" ? "Retiro en local" : "Delivery";
    document.getElementById("detalle-direccion").textContent = pedido.customer?.address || "—";

    const list = document.getElementById("detalle-items-list");
    list.innerHTML = "";
    let subtotal = 0;

    if (pedido.items && pedido.items.length > 0) {
      pedido.items.forEach(item => {
        const qty = item.qty || 1;
        const price = item.price || 0;
        const totalItem = price * qty;
        subtotal += totalItem;
        const li = document.createElement("li");
        li.innerHTML = `<span>${item.name || 'Producto'} × ${qty}</span><span>${formatearPrecio(totalItem)}</span>`;
        list.appendChild(li);
      });
    } else {
      list.innerHTML = "<li>Sin productos</li>";
    }

    const deliveryCharge = pedido.charges?.delivery || 0;
    const total = subtotal + deliveryCharge;

    document.getElementById("detalle-subtotal").textContent = formatearPrecio(subtotal);
    document.getElementById("detalle-delivery").textContent = formatearPrecio(deliveryCharge);
    document.getElementById("detalle-total").textContent = formatearPrecio(total);

    document.getElementById("detalle-modal-overlay").classList.add("open");
  }

  function cerrarDetalle() {
    document.getElementById("detalle-modal-overlay").classList.remove("open");
  }

  function initDetalle() {
    const closeBtn = document.getElementById("detalle-modal-close");
    const cerrarBtn = document.getElementById("detalle-modal-cerrar");
    const overlay = document.getElementById("detalle-modal-overlay");

    if (closeBtn) closeBtn.addEventListener("click", cerrarDetalle);
    if (cerrarBtn) cerrarBtn.addEventListener("click", cerrarDetalle);
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === this) cerrarDetalle(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarDetalle();
      }
    });
  }

  /* ============================================================
     NUEVO PEDIDO (MODAL con combobox)
     ============================================================ */
  let npCombobox = null;

  function initNewPedido() {
    const btn = document.getElementById("new-pedido-btn");
    if (!btn) return;
    btn.addEventListener("click", abrirModalNuevoPedido);
  }

  async function abrirModalNuevoPedido() {
    document.getElementById("np-cliente").value = "";
    document.getElementById("np-telefono").value = "";
    document.getElementById("np-tipo").value = "pickup";
    document.getElementById("np-estado").value = "Pending";
    const ahora = new Date();
    const fecha = ahora.toISOString().split('T')[0];
    const hora = ahora.toTimeString().slice(0,5);
    document.getElementById("np-fecha").value = fecha;
    document.getElementById("np-hora").value = hora;
    document.getElementById("np-item-precio").value = "";

    productos = await cargarProductos();
    if (npCombobox) {
      npCombobox.setOptions(productos);
      npCombobox.clear();
    }

    nuevoPedidoItems = [];
    renderItemsListNuevo();
    actualizarTotalNuevo();

    document.getElementById("nuevo-pedido-modal").classList.add("open");
  }

  function cerrarModalNuevoPedido() {
    document.getElementById("nuevo-pedido-modal").classList.remove("open");
  }

  function renderItemsListNuevo() {
    const container = document.getElementById("np-items-list");
    if (nuevoPedidoItems.length === 0) {
      container.innerHTML = `<div style="color: #9ca3af; text-align:center; padding:8px;">Sin items agregados</div>`;
      return;
    }
    let html = "";
    nuevoPedidoItems.forEach((item, index) => {
      const totalItem = item.price * item.qty;
      html += `
        <div class="item-row">
          <span>${item.name} × ${item.qty} <span style="color:#6b7280;font-size:13px;">${formatearPrecio(totalItem)}</span></span>
          <span class="item-remove" data-index="${index}">✕</span>
        </div>
      `;
    });
    container.innerHTML = html;
    container.querySelectorAll(".item-remove").forEach(el => {
      el.addEventListener("click", function() {
        const idx = parseInt(this.dataset.index);
        nuevoPedidoItems.splice(idx, 1);
        renderItemsListNuevo();
        actualizarTotalNuevo();
      });
    });
  }

  function actualizarTotalNuevo() {
    const total = nuevoPedidoItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    document.getElementById("np-total").textContent = formatearPrecio(total);
  }

  function agregarItemNuevo() {
    const nombreInput = document.getElementById("np-item-nombre");
    const cantidadInput = document.getElementById("np-item-cantidad");
    const precioInput = document.getElementById("np-item-precio");

    const nombre = nombreInput.value.trim();
    const cantidad = parseInt(cantidadInput.value) || 1;
    const precio = parseNumero(precioInput.value);

    if (!nombre) {
      alert("Ingresa el nombre del producto.");
      nombreInput.focus();
      return;
    }
    if (precio <= 0) {
      alert("Ingresa un precio válido (ej. 54.000).");
      precioInput.focus();
      return;
    }

    nuevoPedidoItems.push({ name: nombre, qty: cantidad, price: precio });
    renderItemsListNuevo();
    actualizarTotalNuevo();

    nombreInput.value = "";
    cantidadInput.value = "1";
    precioInput.value = "";
    if (npCombobox) npCombobox.clear();
    nombreInput.focus();
  }

  async function guardarNuevoPedido(e) {
    e.preventDefault();

    const cliente = document.getElementById("np-cliente").value.trim();
    const telefono = document.getElementById("np-telefono").value.trim();
    const tipo = document.getElementById("np-tipo").value;
    const estado = document.getElementById("np-estado").value;
    const fecha = document.getElementById("np-fecha").value;
    const hora = document.getElementById("np-hora").value;

    if (!cliente) {
      alert("El nombre del cliente es obligatorio.");
      document.getElementById("np-cliente").focus();
      return;
    }
    if (nuevoPedidoItems.length === 0) {
      alert("Agrega al menos un item al pedido.");
      return;
    }

    const fechaHora = new Date(`${fecha}T${hora}:00`).toISOString();

    const datosPedido = {
      customer: {
        name: cliente,
        phone: telefono || ""
      },
      deliveryType: tipo,
      status: estado,
      items: nuevoPedidoItems.map(item => ({
        name: item.name,
        qty: item.qty,
        price: item.price
      })),
      charges: {
        delivery: 0,
        tax: 0
      },
      created_at: fechaHora
    };

    const guardarBtn = document.getElementById("nuevo-pedido-guardar");
    guardarBtn.disabled = true;
    guardarBtn.textContent = "Guardando...";

    try {
      await crearPedido(datosPedido);
      cerrarModalNuevoPedido();
      await renderTodo();
    } catch (error) {
      alert("Error al crear el pedido. Revisa la consola.");
    } finally {
      guardarBtn.disabled = false;
      guardarBtn.textContent = "Guardar pedido";
    }
  }

  function initNuevoPedidoModal() {
    const closeBtn = document.getElementById("nuevo-pedido-close");
    const cancelBtn = document.getElementById("nuevo-pedido-cancelar");
    const overlay = document.getElementById("nuevo-pedido-modal");
    const addItemBtn = document.getElementById("np-add-item-btn");
    const form = document.getElementById("nuevo-pedido-form");
    const precioInput = document.getElementById("np-item-precio");

    if (closeBtn) closeBtn.addEventListener("click", cerrarModalNuevoPedido);
    if (cancelBtn) cancelBtn.addEventListener("click", cerrarModalNuevoPedido);
    if (overlay) overlay.addEventListener("click", function (e) {
      if (e.target === this) cerrarModalNuevoPedido();
    });
    if (addItemBtn) addItemBtn.addEventListener("click", agregarItemNuevo);

    npCombobox = initCombobox('np-combobox', 'np-item-nombre', 'np-options-list', function(name, price) {
      precioInput.value = formatearNumero(price);
    });

    precioInput.addEventListener('blur', function() {
      const num = parseNumero(this.value);
      if (num > 0) {
        this.value = formatearNumero(num);
      }
    });

    document.getElementById("np-item-nombre").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); agregarItemNuevo(); }
    });
    precioInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); agregarItemNuevo(); }
    });

    if (form) form.addEventListener("submit", guardarNuevoPedido);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarModalNuevoPedido();
      }
    });
  }

  /* ============================================================
     EDITAR PEDIDO (MODAL con combobox)
     ============================================================ */
  let epCombobox = null;

  function abrirModalEditarPedido(id) {
    const pedido = pedidos.find(p => p.id === id);
    if (!pedido) return;

    editPedidoId = id;

    document.getElementById("ep-cliente").value = pedido.customer?.name || "";
    document.getElementById("ep-telefono").value = pedido.customer?.phone || "";
    document.getElementById("ep-tipo").value = pedido.deliveryType || "pickup";
    document.getElementById("ep-estado").value = pedido.status || "Pending";

    if (pedido.created_at) {
      const d = new Date(pedido.created_at);
      const fecha = d.toISOString().split('T')[0];
      const hora = d.toTimeString().slice(0,5);
      document.getElementById("ep-fecha").value = fecha;
      document.getElementById("ep-hora").value = hora;
    } else {
      const ahora = new Date();
      document.getElementById("ep-fecha").value = ahora.toISOString().split('T')[0];
      document.getElementById("ep-hora").value = ahora.toTimeString().slice(0,5);
    }

    editPedidoItems = pedido.items ? pedido.items.map(i => ({ ...i })) : [];
    renderItemsListEditar();
    actualizarTotalEditar();

    if (epCombobox) {
      epCombobox.setOptions(productos);
      epCombobox.clear();
    }

    document.getElementById("editar-pedido-modal").classList.add("open");
  }

  function cerrarModalEditarPedido() {
    document.getElementById("editar-pedido-modal").classList.remove("open");
    editPedidoId = null;
    editPedidoItems = [];
  }

  function renderItemsListEditar() {
    const container = document.getElementById("ep-items-list");
    if (editPedidoItems.length === 0) {
      container.innerHTML = `<div style="color: #9ca3af; text-align:center; padding:8px;">Sin items agregados</div>`;
      return;
    }
    let html = "";
    editPedidoItems.forEach((item, index) => {
      const totalItem = item.price * item.qty;
      html += `
        <div class="item-row">
          <span>${item.name} × ${item.qty} <span style="color:#6b7280;font-size:13px;">${formatearPrecio(totalItem)}</span></span>
          <span class="item-remove" data-index="${index}">✕</span>
        </div>
      `;
    });
    container.innerHTML = html;
    container.querySelectorAll(".item-remove").forEach(el => {
      el.addEventListener("click", function() {
        const idx = parseInt(this.dataset.index);
        editPedidoItems.splice(idx, 1);
        renderItemsListEditar();
        actualizarTotalEditar();
      });
    });
  }

  function actualizarTotalEditar() {
    const total = editPedidoItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    document.getElementById("ep-total").textContent = formatearPrecio(total);
  }

  function agregarItemEditar() {
    const nombreInput = document.getElementById("ep-item-nombre");
    const cantidadInput = document.getElementById("ep-item-cantidad");
    const precioInput = document.getElementById("ep-item-precio");

    const nombre = nombreInput.value.trim();
    const cantidad = parseInt(cantidadInput.value) || 1;
    const precio = parseNumero(precioInput.value);

    if (!nombre) {
      alert("Ingresa el nombre del producto.");
      nombreInput.focus();
      return;
    }
    if (precio <= 0) {
      alert("Ingresa un precio válido (ej. 54.000).");
      precioInput.focus();
      return;
    }

    editPedidoItems.push({ name: nombre, qty: cantidad, price: precio });
    renderItemsListEditar();
    actualizarTotalEditar();

    nombreInput.value = "";
    cantidadInput.value = "1";
    precioInput.value = "";
    if (epCombobox) epCombobox.clear();
    nombreInput.focus();
  }

  async function guardarEditarPedido(e) {
    e.preventDefault();

    if (!editPedidoId) return;

    const cliente = document.getElementById("ep-cliente").value.trim();
    const telefono = document.getElementById("ep-telefono").value.trim();
    const tipo = document.getElementById("ep-tipo").value;
    const estado = document.getElementById("ep-estado").value;
    const fecha = document.getElementById("ep-fecha").value;
    const hora = document.getElementById("ep-hora").value;

    if (!cliente) {
      alert("El nombre del cliente es obligatorio.");
      document.getElementById("ep-cliente").focus();
      return;
    }
    if (editPedidoItems.length === 0) {
      alert("El pedido debe tener al menos un item.");
      return;
    }

    const fechaHora = new Date(`${fecha}T${hora}:00`).toISOString();

    const datosPedido = {
      customer: {
        name: cliente,
        phone: telefono || ""
      },
      deliveryType: tipo,
      status: estado,
      items: editPedidoItems.map(item => ({
        name: item.name,
        qty: item.qty,
        price: item.price
      })),
      charges: {
        delivery: 0,
        tax: 0
      },
      created_at: fechaHora
    };

    const guardarBtn = document.getElementById("editar-pedido-guardar");
    guardarBtn.disabled = true;
    guardarBtn.textContent = "Actualizando...";

    try {
      await actualizarPedido(editPedidoId, datosPedido);
      cerrarModalEditarPedido();
      await renderTodo();
    } catch (error) {
      alert("Error al actualizar el pedido. Revisa la consola.");
    } finally {
      guardarBtn.disabled = false;
      guardarBtn.textContent = "Actualizar pedido";
    }
  }

  function initEditarPedidoModal() {
    const closeBtn = document.getElementById("editar-pedido-close");
    const cancelBtn = document.getElementById("editar-pedido-cancelar");
    const overlay = document.getElementById("editar-pedido-modal");
    const addItemBtn = document.getElementById("ep-add-item-btn");
    const form = document.getElementById("editar-pedido-form");
    const precioInput = document.getElementById("ep-item-precio");

    if (closeBtn) closeBtn.addEventListener("click", cerrarModalEditarPedido);
    if (cancelBtn) cancelBtn.addEventListener("click", cerrarModalEditarPedido);
    if (overlay) overlay.addEventListener("click", function (e) {
      if (e.target === this) cerrarModalEditarPedido();
    });
    if (addItemBtn) addItemBtn.addEventListener("click", agregarItemEditar);

    epCombobox = initCombobox('ep-combobox', 'ep-item-nombre', 'ep-options-list', function(name, price) {
      precioInput.value = formatearNumero(price);
    });

    precioInput.addEventListener('blur', function() {
      const num = parseNumero(this.value);
      if (num > 0) {
        this.value = formatearNumero(num);
      }
    });

    document.getElementById("ep-item-nombre").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); agregarItemEditar(); }
    });
    precioInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); agregarItemEditar(); }
    });

    if (form) form.addEventListener("submit", guardarEditarPedido);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
        cerrarModalEditarPedido();
      }
    });
  }

  /* ============================================================
     PAGINACIÓN, BÚSQUEDA, FILTROS, MONEDA
     ============================================================ */
  function initPagination() {
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.addEventListener("click", () => { if (pagina > 1) { pagina--; renderTabla(); } });
    if (nextBtn) nextBtn.addEventListener("click", () => { pagina++; renderTabla(); });
  }

  function initSearch() {
    const input = document.getElementById("pedido-search");
    if (input) input.addEventListener("input", () => { pagina = 1; renderTabla(); });
  }

  function initFilters() {
    const select = document.getElementById("filter-estado");
    if (select) select.addEventListener("change", () => { pagina = 1; renderTabla(); });
  }

  function initCurrencyToggle() {
    const container = document.getElementById("currency-toggle");
    if (!container) return;
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", function () {
        container.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        moneda = this.getAttribute("data-currency");
        renderTabla();
      });
    });
  }

  /* ============================================================
     INICIALIZACIÓN
     ------------------------------------------------------------
     Antes esto arrancaba en DOMContentLoaded con un array EMPRESAS
     fijo, y tenía su PROPIO selector de empresa (initCompanySwitch,
     initAddCompany, renderEmpresaSwitch, renderHeader) que chocaba
     con el de auth-check.js — cada clic en el botón alternaba la
     clase "open" DOS veces (una por cada listener), por eso nunca
     se veía abrir el desplegable. Todo eso se sacó: ahora el topbar
     lo pinta únicamente auth-check.js, y esta página solo espera a
     "sesionLista" para saber qué empresa cargar.
     ============================================================ */
  document.addEventListener("sesionLista", function (e) {
    empresaId = e.detail.empresaId;

    initPagination();
    initSearch();
    initFilters();
    initCurrencyToggle();
    initModalEstado();
    initDetalle();
    initModalRegistrar();
    initNewPedido();
    initNuevoPedidoModal();
    initEditarPedidoModal();
    renderTodo();

    setInterval(renderTodo, 30000);
  });

})();