(function () {
  "use strict";

  // Marcador de versión: si al recargar la página NO ves este mensaje en
  // la consola del navegador, el archivo que se está sirviendo todavía
  // es una versión anterior de menu.js.
  console.log("%c[menu.js] versión con mesa-editable + cajero (v2)", "color:#2563eb;font-weight:bold;");

  /* ============================================================
     Datos del restaurante
     ============================================================ */
  const restaurant = {
    name: "Restaurant",
    date: "21 de agosto de 2022",
    table: "31"
  };

  // empresaId y sesionActual vienen de auth-check.js (evento "sesionLista").
  // ⚠️ Antes, TODA la colección "productos" se leía/guardaba/borraba sin
  // filtrar por empresaId. Con las reglas de seguridad nuevas eso rompía
  // todo ("Missing or insufficient permissions"): la lectura fallaba
  // porque los documentos no tenían empresaId para comparar, y el guardado
  // fallaba porque el producto nuevo tampoco lo traía. Además, aunque las
  // reglas hubieran sido públicas, esto ya era un bug de datos: los
  // productos de Menú nunca tenían empresaId, así que facturacion.js (que
  // sí filtra por empresaId) nunca los veía en el selector de productos.
  let empresaId = null;
  let sucursalId = null;
  let sesionActual = null;

  const CAMERA_ICON = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="18" width="48" height="34" rx="4"/><circle cx="32" cy="35" r="10"/><path d="M22 18l4-6h12l4 6"/></svg>`;

  const fallbackIcons = {
    pizza: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M32 6 L58 50 L6 50 Z" fill="#F5D6A8" stroke="#D4A373"/>
      <circle cx="32" cy="34" r="10" fill="#E8A23B" stroke="#C47D2D"/>
      <path d="M22 30 Q28 24 34 30 Q38 34 42 30" stroke="#FFD700" stroke-width="2.5" fill="none"/>
      <path d="M26 38 Q32 44 38 38" stroke="#FFD700" stroke-width="2" fill="none"/>
      <circle cx="24" cy="28" r="3" fill="#CD5C5C" stroke="#A0522D"/>
      <circle cx="40" cy="32" r="3" fill="#CD5C5C" stroke="#A0522D"/>
      <circle cx="32" cy="42" r="2.5" fill="#CD5C5C" stroke="#A0522D"/>
      <circle cx="28" cy="36" r="2" fill="#CD5C5C" stroke="#A0522D"/>
      <circle cx="36" cy="26" r="2" fill="#CD5C5C" stroke="#A0522D"/>
      <path d="M6 50 Q32 56 58 50" stroke="#D4A373" stroke-width="2" fill="none"/>
    </svg>`,
    noodles: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <ellipse cx="32" cy="42" rx="24" ry="10" fill="#F5F5F5" stroke="#D0D0D0"/>
      <ellipse cx="32" cy="40" rx="20" ry="8" fill="#FAFAFA" stroke="#E0E0E0"/>
      <ellipse cx="28" cy="36" rx="8" ry="4" fill="#8B4513" stroke="#6B3410"/>
      <ellipse cx="36" cy="37" rx="6" ry="3.5" fill="#228B22" stroke="#1A6B1A"/>
      <ellipse cx="30" cy="33" rx="5" ry="3" fill="#FFD700" stroke="#DAA520"/>
      <line x1="12" y1="12" x2="28" y2="30" stroke="#C0C0C0" stroke-width="3"/>
      <line x1="14" y1="10" x2="12" y2="16" stroke="#C0C0C0" stroke-width="2.5"/>
      <line x1="16" y1="12" x2="14" y2="18" stroke="#C0C0C0" stroke-width="2.5"/>
      <line x1="18" y1="14" x2="16" y2="20" stroke="#C0C0C0" stroke-width="2.5"/>
      <line x1="52" y1="12" x2="38" y2="28" stroke="#C0C0C0" stroke-width="3"/>
      <path d="M52 10 L56 6 L54 8 L50 12" stroke="#C0C0C0" stroke-width="2.5"/>
    </svg>`,
    drinks: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M16 14 L20 50 L44 50 L48 14 Z" fill="#E8F4FD" stroke="#90CAF9"/>
      <rect x="20" y="24" width="24" height="26" rx="2" fill="#FF6B00" opacity="0.5"/>
      <rect x="24" y="26" width="8" height="6" rx="1" fill="#FFFFFF" opacity="0.4" transform="rotate(10,28,29)"/>
      <rect x="30" y="30" width="6" height="5" rx="1" fill="#FFFFFF" opacity="0.4" transform="rotate(-15,33,32)"/>
      <rect x="26" y="34" width="7" height="5" rx="1" fill="#FFFFFF" opacity="0.4" transform="rotate(5,29,36)"/>
      <circle cx="28" cy="32" r="2" fill="#FFFFFF" opacity="0.6"/>
      <circle cx="34" cy="38" r="2.5" fill="#FFFFFF" opacity="0.6"/>
      <circle cx="26" cy="42" r="1.5" fill="#FFFFFF" opacity="0.6"/>
      <circle cx="36" cy="28" r="1.5" fill="#FFFFFF" opacity="0.6"/>
      <circle cx="30" cy="46" r="2" fill="#FFFFFF" opacity="0.6"/>
      <line x1="44" y1="10" x2="38" y2="32" stroke="#FF6B00" stroke-width="3"/>
      <rect x="42" y="8" width="4" height="4" rx="1" fill="#FF6B00"/>
    </svg>`,
    desserts: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <ellipse cx="32" cy="48" rx="22" ry="8" fill="#F5F5F5" stroke="#D0D0D0"/>
      <path d="M16 36 Q18 24 32 22 Q46 24 48 36 Z" fill="#F2B24A" stroke="#D4A373"/>
      <path d="M18 36 Q32 26 46 36 Q32 30 18 36 Z" fill="#FFD700" stroke="#DAA520"/>
      <circle cx="32" cy="24" r="6" fill="#DC143C" stroke="#8B0000"/>
      <circle cx="32" cy="22" r="2" fill="#FF6347" opacity="0.6"/>
      <path d="M32 18 L34 14 L36 18" stroke="#228B22" stroke-width="2" fill="none"/>
      <path d="M22 32 Q32 28 42 32" stroke="#D4A373" stroke-width="1.5" fill="none"/>
      <path d="M24 36 Q32 32 40 36" stroke="#D4A373" stroke-width="1.5" fill="none"/>
    </svg>`
  };

  const categories = [
    { id: "pizza", label: "Pizzas" },
    { id: "noodles", label: "Comidas" },
    { id: "drinks", label: "Bebidas" },
    { id: "desserts", label: "Postres" }
  ];

  // ⚠️ NOTA: estos son los platos de EJEMPLO que se auto-cargan la primera
  // vez que una empresa abre Menú y todavía no tiene ningún producto
  // propio (ver uploadInitialProducts). Sirven como demo/punto de partida,
  // pero si no querés que un negocio nuevo aparezca automáticamente con
  // "Pizza Margarita", "Ramen Picante", etc., hay que sacar esta carga
  // automática (o dejar initialProducts vacío) antes de dar de alta
  // negocios reales.
  const initialProducts = [
    { id: "p1", category: "pizza", name: "Pizza Margarita", price: 8.99, sold: 14 },
    { id: "p2", category: "pizza", name: "Pizza Pepperoni", price: 10.49, sold: 16 },
    { id: "p3", category: "pizza", name: "Pizza Cuatro Quesos", price: 11.99, sold: 12 },
    { id: "p4", category: "pizza", name: "Pizza Hawaiana", price: 10.99, sold: 10 },
    { id: "p5", category: "pizza", name: "Pizza Vegetariana", price: 9.99, sold: 9, note: "Sin carne" },
    { id: "p6", category: "pizza", name: "Pizza BBQ con Pollo", price: 12.49, sold: 11, note: "Salsa BBQ" },
    { id: "p7", category: "pizza", name: "Pizza Napolitana", price: 9.49, sold: 8 },
    { id: "p8", category: "pizza", name: "Pizza Suprema", price: 13.99, sold: 13 },
    { id: "p9", category: "noodles", name: "Fideos con Pollo", price: 6.49, sold: 8 },
    { id: "p10", category: "noodles", name: "Ramen Picante", price: 7.20, sold: 6 },
    { id: "p11", category: "noodles", name: "Fideos con Vegetales", price: 5.80, sold: 5 },
    { id: "p12", category: "drinks", name: "Té Helado de Limón", price: 2.50, sold: 14 },
    { id: "p13", category: "drinks", name: "Gaseosa de Naranja", price: 2.20, sold: 12 },
    { id: "p14", category: "drinks", name: "Batido de Leche", price: 3.80, sold: 10 },
    { id: "p15", category: "desserts", name: "Copa de Chocolate", price: 4.10, sold: 7 },
    { id: "p16", category: "desserts", name: "Tarta de Manzana", price: 4.60, sold: 6 }
  ];

  const rates = { "US$": 1, "Gs": 7300, "R$": 5.4 };
  const symbols = { "US$": "$", "Gs": "Gs. ", "R$": "R$" };

  let products = [];
  const state = {
    activeCategory: "pizza",
    searchTerm: "",
    currency: "Gs",
    cart: {},
    images: {},
    imagePools: { pizza: [], noodles: [], drinks: [], desserts: [] },
    editingId: null
  };

  /* ============================================================
     FUNCIONES CON FIREBASE
     ============================================================ */
  async function loadProductsFromFirebase() {
    try {
      const snapshot = await db.collection('productos')
        .where('empresaId', '==', empresaId)
        .where('sucursalId', '==', sucursalId)
        .get();
      const firebaseProducts = [];
      snapshot.forEach(doc => {
        firebaseProducts.push({ id: doc.id, ...doc.data() });
      });
      return firebaseProducts;
    } catch (error) {
      console.error("❌ Error al cargar desde Firebase:", error);
      return [];
    }
  }

  async function saveProductToFirebase(product) {
    try {
      product.empresaId = empresaId; // asigna la empresa activa SIEMPRE
      product.sucursalId = sucursalId; // y la sucursal activa SIEMPRE
      await db.collection('productos').doc(product.id).set(product);
      console.log("✅ Producto guardado en Firebase:", product.id);
    } catch (error) {
      console.error("❌ Error al guardar en Firebase:", error);
      throw error;
    }
  }

  async function deleteProductFromFirebase(productId) {
    try {
      await db.collection('productos').doc(productId).delete();
      console.log("✅ Producto eliminado de Firebase:", productId);
    } catch (error) {
      console.error("❌ Error al eliminar de Firebase:", error);
      throw error;
    }
  }

  async function uploadInitialProducts() {
    const existing = await loadProductsFromFirebase();
    if (existing.length > 0) return;
    console.log("📦 Subiendo productos iniciales a Firebase...");
    for (const p of initialProducts) {
      // ⚠️ Antes se guardaba con el id fijo tal cual (p1, p2, ...), IGUAL
      // para cualquier empresa. Si esos documentos ya existían de antes
      // (de la época en que las reglas eran públicas, sin empresaId), un
      // .set() sobre un documento existente cuenta como "update" para las
      // reglas de Firestore — y como el documento viejo no tenía
      // empresaId, la regla de update lo rechazaba ("Missing or
      // insufficient permissions"), incluso siendo un producto "nuevo"
      // desde el punto de vista de esta empresa.
      // Ahora el id incluye el empresaId, así nunca choca con productos
      // de otra empresa ni con basura vieja sin empresaId.
      const producto = { ...p, id: `${empresaId}-${p.id}` };
      await saveProductToFirebase(producto);
    }
    console.log("✅ Productos iniciales subidos a Firebase");
  }

  /* ============================================================
     CARGA Y PERSISTENCIA
     ============================================================ */
  async function loadProducts() {
    // Antes: si la empresa no tenía ningún producto propio, se le
    // auto-cargaban 16 platos de ejemplo (uploadInitialProducts). Eso ya
    // no pasa — si no hay productos, el menú simplemente arranca vacío y
    // el negocio carga sus propios platos con "+ Agregar plato".
    products = await loadProductsFromFirebase();
    products.forEach(p => {
      if (p.image) state.images[p.id] = p.image;
    });
    renderProductGrid();
    renderOrder();
  }

  /* ============================================================
     CONVERSIÓN Y FORMATEO
     ============================================================ */
  function convertToUSD(value, fromCurrency) {
    if (fromCurrency === "US$") return value;
    const rate = rates[fromCurrency];
    if (!rate) return value;
    return value / rate;
  }

  function formatPrice(usdValue) {
    const rate = rates[state.currency];
    const symbol = symbols[state.currency];
    const converted = usdValue * rate;
    let formatted = converted.toLocaleString("es-PY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (state.currency === "Gs") {
      formatted = Math.round(converted).toLocaleString("es-PY");
    }
    return `${symbol}${formatted}`;
  }

  /* ============================================================
     IMÁGENES
     ============================================================ */
  async function fetchOneFoodishImage(endpoint) {
    try {
      const res = await fetch(`https://foodish-api.com/api/images/${endpoint}`);
      const data = await res.json();
      return data.image || null;
    } catch (e) {
      return null;
    }
  }

  async function fetchImageForCategory(category) {
    if (category === "drinks") {
      if (state.imagePools.drinks.length) {
        return state.imagePools.drinks[Math.floor(Math.random() * state.imagePools.drinks.length)];
      }
      try {
        const res = await fetch("https://www.thecocktaildb.com/api/json/v1/1/filter.php?c=Non_Alcoholic");
        const data = await res.json();
        const imgs = (data.drinks || []).map(d => d.strDrinkThumb + "/medium");
        state.imagePools.drinks = imgs;
        return imgs.length ? imgs[Math.floor(Math.random() * imgs.length)] : null;
      } catch (e) {
        return null;
      }
    }
    const endpoint = category === "noodles" ? "pasta" : category === "desserts" ? "dessert" : "pizza";
    const url = await fetchOneFoodishImage(endpoint);
    if (url) state.imagePools[category].push(url);
    return url;
  }

  async function loadRealPhotos() {
    const endpointByCategory = { pizza: "pizza", noodles: "pasta", desserts: "dessert" };
    for (const category of ["pizza", "noodles", "desserts"]) {
      const items = products.filter(p => p.category === category && !p.custom && !state.images[p.id]);
      const urls = await Promise.all(items.map(() => fetchOneFoodishImage(endpointByCategory[category])));
      items.forEach((p, i) => {
        if (urls[i]) {
          state.images[p.id] = urls[i];
          state.imagePools[category].push(urls[i]);
        }
      });
    }
    try {
      const drinkRes = await fetch("https://www.thecocktaildb.com/api/json/v1/1/filter.php?c=Non_Alcoholic");
      const drinkData = await drinkRes.json();
      state.imagePools.drinks = (drinkData.drinks || []).map(d => d.strDrinkThumb + "/medium");
      products.filter(p => p.category === "drinks" && !p.custom && !state.images[p.id]).forEach((p, i) => {
        if (state.imagePools.drinks.length) state.images[p.id] = state.imagePools.drinks[i % state.imagePools.drinks.length];
      });
    } catch (e) { /* sin conexión */ }
    for (const p of products.filter(p => p.custom && !state.images[p.id])) {
      const img = await fetchImageForCategory(p.category);
      if (img) state.images[p.id] = img;
    }
    renderProductGrid();
    renderOrder();
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function getProduct(id) {
    return products.find(p => p.id === id);
  }

  function todayStr() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function getSoldToday(product) {
    if (product.soldDate === todayStr()) return product.sold || 0;
    return 0;
  }

  function thumbHTML(product) {
    const url = state.images[product.id];
    if (url) {
      return `<img class="thumb-img" src="${url}" alt="${product.name}" loading="lazy" onerror="this.style.display='none'" />`;
    }
    return `
      <div class="thumb-fallback" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#999;width:100%;height:100%;">
        ${CAMERA_ICON}
        <span style="font-size:11px;font-weight:600;color:#aaa;">Sin imagen</span>
      </div>
    `;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderCategoryTabs() {
    const container = document.getElementById("category-tabs");
    container.innerHTML = "";

    categories.forEach(cat => {
      const btn = document.createElement("button");
      btn.className = "category-tab" + (cat.id === state.activeCategory ? " active" : "");
      btn.innerHTML = `<span>${cat.label}</span>`;
      btn.addEventListener("click", () => {
        state.activeCategory = cat.id;
        renderCategoryTabs();
        renderProductGrid();
      });
      container.appendChild(btn);
    });
  }

  function renderProductGrid() {
    const grid = document.getElementById("product-grid");
    grid.innerHTML = "";
    const term = state.searchTerm.trim().toLowerCase();
    const list = products.filter(p => {
      const matchesCategory = p.category === state.activeCategory;
      const matchesSearch = !term || p.name.toLowerCase().includes(term);
      return term ? matchesSearch : matchesCategory;
    });

    if (list.length === 0) {
      grid.innerHTML = `<div class="order-empty">No se encontraron platos.</div>`;
      return;
    }

    list.forEach(p => {
      const card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML = `
        <div class="product-thumb" style="position:relative;overflow:hidden;background:#f5f5f5;">${thumbHTML(p)}</div>
        <div class="product-name">${p.name}</div>
        ${p.note ? `<div class="product-note" style="font-size:12px;color:#888;margin-top:-4px;margin-bottom:6px;">${p.note}</div>` : ""}
        <div class="product-meta">
          <span class="product-price">${formatPrice(p.price)}</span>
          <span class="product-items">${getSoldToday(p)} vendidos</span>
        </div>
        <div class="product-actions">
          <button class="edit-btn" data-id="${p.id}" title="Editar">✎</button>
          <button class="delete-btn" data-id="${p.id}" title="Eliminar">✕</button>
        </div>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest('.product-actions')) return;
        addToOrder(p.id);
      });
      card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(p.id);
      });
      card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDelete(p.id);
      });
      grid.appendChild(card);
    });
  }

  /* ============================================================
     CARRITO / PEDIDO
     ============================================================ */
  function addToOrder(id) {
    if (!state.cart[id]) state.cart[id] = { qty: 0 };
    state.cart[id].qty += 1;
    renderOrder();
  }

  function removeFromOrder(id) {
    delete state.cart[id];
    renderOrder();
  }

  function renderOrder() {
    const container = document.getElementById("order-items");
    const ids = Object.keys(state.cart);
    container.innerHTML = "";

    if (ids.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "order-empty";
      emptyMsg.id = "order-empty";
      emptyMsg.textContent = "Tocá un plato del menú para agregarlo al pedido.";
      container.appendChild(emptyMsg);
      updateTotals();
      return;
    }

    ids.forEach(id => {
      const entry = state.cart[id];
      const product = getProduct(id);
      if (!product) return;
      const lineTotal = product.price * entry.qty;
      const row = document.createElement("div");
      row.className = "order-item";
      row.innerHTML = `
        <div class="order-item-thumb" style="position:relative;overflow:hidden;background:#f5f5f5;">${thumbHTML(product)}</div>
        <div class="order-item-info">
          <div class="order-item-name">${entry.qty > 1 ? `${product.name} (${entry.qty}x)` : product.name}</div>
          ${product.note ? `<div class="order-item-note"><span class="dot"></span>${product.note}</div>` : ""}
        </div>
        <div class="order-item-price">${formatPrice(lineTotal)}</div>
        <button class="order-item-remove" title="Quitar">&times;</button>
      `;
      row.querySelector(".order-item-remove").addEventListener("click", () => removeFromOrder(id));
      container.appendChild(row);
    });
    updateTotals();
  }

  function computeSubtotalUSD() {
    return Object.keys(state.cart).reduce((sum, id) => {
      const product = getProduct(id);
      const entry = state.cart[id];
      if (!product) return sum;
      return sum + product.price * entry.qty;
    }, 0);
  }

  function updateTotals() {
    const subtotalUSD = computeSubtotalUSD();
    const totalUSD = subtotalUSD;
    document.getElementById("subtotal").textContent = formatPrice(subtotalUSD);
    document.getElementById("total").textContent = formatPrice(totalUSD);
  }

  /* ============================================================
     REGISTRAR COMPRA
     → Único modal: abre directamente "Operación de Facturación"
       (operacion-factura.js) con los productos del pedido ya
       precargados. No se usa ningún otro modal de pago/éxito.
     ============================================================ */
  function initRegistrarCompra() {
    const btn = document.getElementById("print-bill");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const ids = Object.keys(state.cart);
      if (ids.length === 0) {
        alert("Agregá al menos un plato al pedido.");
        return;
      }

      const rate = rates[state.currency];
      const items = ids.map(id => {
        const producto = getProduct(id);
        const cantidad = state.cart[id].qty;
        return {
          productoId: id,
          producto: producto.name,
          cantidad: cantidad,
          precio: producto.price * rate
        };
      });

      // Antes esto era siempre restaurant.table ("31" fijo, hardcodeado),
      // así que TODAS las ventas quedaban con "Mesa 31" aunque no se
      // hubiera puesto ninguna. Ahora se lee del campo editable; si queda
      // vacío, se manda null y la venta no lleva mesa asignada.
      const mesaInput = document.getElementById('input-mesa');
      const mesaValor = mesaInput ? mesaInput.value.trim() : '';

      if (window.OperacionFactura && typeof window.OperacionFactura.open === "function") {
        window.OperacionFactura.open(items, {
          empresaNombre: (window.sesion && window.sesion.empresaNombre) || "",
          moneda: state.currency,
          mesa: mesaValor || null
        });
      } else {
        console.error("OperacionFactura no está disponible. Verificá que operacion-factura.js esté incluido en menu.html.");
        alert("No se pudo abrir la operación de facturación. Revisá la consola.");
      }
    });
  }

  /* ============================================================
     Al guardarse la operación de facturación, vaciamos el carrito
     ============================================================ */
  function initOperacionFacturaListener() {
    document.addEventListener("operacion-factura-guardada", async function () {
      const today = todayStr();
      const ids = Object.keys(state.cart);
      for (const id of ids) {
        const product = getProduct(id);
        if (!product) continue;
        const qty = state.cart[id].qty;
        product.sold = (product.soldDate === today ? (product.sold || 0) : 0) + qty;
        product.soldDate = today;
        try {
          await saveProductToFirebase(product);
        } catch (e) {
          console.error("❌ No se pudo actualizar 'vendidos' de", product.id, e);
        }
      }

      state.cart = {};
      renderOrder();
      renderProductGrid();
    });
  }

  /* ============================================================
     AGREGAR PLATO, EDITAR, ELIMINAR
     ============================================================ */
  function populateCategorySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = categories.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  }

  // Separador de miles en vivo: mientras el usuario tipea, se muestra el
  // número ya agrupado ("20.000" en vez de "20000"). Solo permite dígitos
  // (los guaraníes no llevan centavos acá), así que al guardar, quitar los
  // puntos alcanza para recuperar el número real.
  function attachLiveThousandsFormat(input) {
    if (!input || input.dataset.liveThousandsAttached) return;
    input.dataset.liveThousandsAttached = "1";
    input.addEventListener('input', function () {
      const cursorAtEnd = this.selectionStart === this.value.length;
      const digits = this.value.replace(/[^\d]/g, '');
      this.value = digits ? Number(digits).toLocaleString('es-PY') : '';
      if (cursorAtEnd) {
        this.selectionStart = this.selectionEnd = this.value.length;
      }
    });
  }

  function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
      reader.readAsDataURL(file);
    });
  }

  function initAddDishForm() {
    const openBtn = document.getElementById("btn-add-dish");
    const panel = document.getElementById("add-dish-panel");
    const cancelBtn = document.getElementById("btn-cancel-dish");
    const saveBtn = document.getElementById("btn-save-dish");
    const nameInput = document.getElementById("dish-name");
    const priceInput = document.getElementById("dish-price");
    const categorySelect = document.getElementById("dish-category");
    const noteInput = document.getElementById("dish-note");
    const imageInput = document.getElementById("dish-image");
    if (!openBtn || !panel) return;

    // Separador de miles EN VIVO (mientras se escribe), no solo al salir
    // del campo — así "20000" se ve "20.000" a medida que lo tipeás, sin
    // que haya que perder el foco primero para confirmar el monto.
    attachLiveThousandsFormat(priceInput);
    priceInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });

    function clearForm() {
      nameInput.value = "";
      priceInput.value = "";
      noteInput.value = "";
      if (imageInput) imageInput.value = "";
    }

    openBtn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) nameInput.focus();
    });
    cancelBtn.addEventListener("click", () => {
      panel.hidden = true;
      clearForm();
    });

    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const rawPrice = priceInput.value.replace(/\./g, '').replace(',', '.');
      const price = parseFloat(rawPrice);
      const category = categorySelect.value;
      const note = noteInput.value.trim();
      const file = imageInput && imageInput.files && imageInput.files[0];

      if (!name) { alert("Ponele un nombre al plato."); nameInput.focus(); return; }
      if (isNaN(price) || price <= 0) { alert("Ingresá un precio válido (ej: 30.000)."); priceInput.focus(); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = "Guardando...";
      let imageDataUrl = null;
      if (file) {
        try {
          imageDataUrl = await readImageAsDataUrl(file);
          if (imageDataUrl.length > 1000000) {
            alert("La imagen es muy grande (máximo 1 MB). Se usará una imagen automática.");
            imageDataUrl = null;
          }
        } catch (e) { alert("No se pudo leer la imagen."); }
      }

      const priceUSD = convertToUSD(price, state.currency);
      if (isNaN(priceUSD) || priceUSD <= 0) {
        alert("Error al convertir el precio.");
        saveBtn.disabled = false; saveBtn.textContent = "Guardar plato";
        return;
      }

      const product = {
        id: "custom-" + Date.now(),
        category,
        name,
        price: priceUSD,
        sold: 0,
        custom: true
      };
      if (note) product.note = note;
      if (imageDataUrl) product.image = imageDataUrl;

      products.push(product);
      await saveProductToFirebase(product);
      if (imageDataUrl) state.images[product.id] = imageDataUrl;
      state.activeCategory = category;
      renderCategoryTabs();
      renderProductGrid();
      if (!imageDataUrl) {
        const img = await fetchImageForCategory(category);
        if (img) { state.images[product.id] = img; renderProductGrid(); }
      }

      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar plato";
      panel.hidden = true;
      clearForm();
    });
  }

  function openEditModal(productId) {
    const product = getProduct(productId);
    if (!product) return;
    state.editingId = productId;

    document.getElementById("edit-modal-title").textContent = `Editar: ${product.name}`;
    document.getElementById("edit-dish-name").value = product.name;
    // Número plano, sin símbolo de moneda ni letras — así el formateador
    // en vivo (attachLiveThousandsFormat) lo puede seguir agrupando bien
    // apenas el usuario lo toca.
    const precioEnMonedaActual = Math.round(product.price * rates[state.currency]);
    document.getElementById("edit-dish-price").value = precioEnMonedaActual.toLocaleString('es-PY');
    attachLiveThousandsFormat(document.getElementById("edit-dish-price"));
    document.getElementById("edit-dish-category").value = product.category;
    document.getElementById("edit-dish-note").value = product.note || "";
    document.getElementById("edit-dish-image").value = "";

    populateCategorySelect("edit-dish-category");
    document.getElementById("edit-modal-overlay").classList.add("open");
  }

  function closeEditModal() {
    document.getElementById("edit-modal-overlay").classList.remove("open");
    state.editingId = null;
  }

  async function saveEditProduct() {
    const id = state.editingId;
    if (!id) return;
    const product = getProduct(id);
    if (!product) return;

    const name = document.getElementById("edit-dish-name").value.trim();
    const rawPrice = document.getElementById("edit-dish-price").value
      .replace(/[^0-9.,]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const price = parseFloat(rawPrice);
    const category = document.getElementById("edit-dish-category").value;
    const note = document.getElementById("edit-dish-note").value.trim();
    const fileInput = document.getElementById("edit-dish-image");
    const file = fileInput.files && fileInput.files[0];

    if (!name) { alert("El nombre es obligatorio."); return; }
    if (isNaN(price) || price <= 0) { alert("Ingresá un precio válido."); return; }

    const priceUSD = convertToUSD(price, state.currency);
    if (isNaN(priceUSD) || priceUSD <= 0) { alert("Precio inválido después de la conversión."); return; }

    product.name = name;
    product.price = priceUSD;
    product.category = category;
    product.note = note || undefined;

    if (file) {
      try {
        const dataUrl = await readImageAsDataUrl(file);
        if (dataUrl.length > 1000000) {
          alert("La imagen es muy grande (máximo 1 MB). Se mantiene la imagen actual.");
        } else {
          product.image = dataUrl;
          state.images[id] = dataUrl;
        }
      } catch (e) { alert("Error al leer la imagen."); }
    }

    await saveProductToFirebase(product);
    closeEditModal();
    renderProductGrid();
    renderOrder();
  }

  // ============================================================
  // ELIMINAR
  // ============================================================
  let deleteTargetId = null;

  function confirmDelete(productId) {
    const product = getProduct(productId);
    if (!product) return;
    deleteTargetId = productId;

    document.getElementById("confirm-title").textContent = `¿Eliminar "${product.name}"?`;
    document.getElementById("confirm-text").textContent = "Esta acción no se puede deshacer.";
    document.getElementById("confirm-modal-overlay").classList.add("open");
  }

  async function ejecutarEliminacion(productId) {
    const idx = products.findIndex(p => p.id === productId);
    if (idx === -1) {
      console.warn("⚠️ Producto no encontrado en el array local");
      return;
    }
    const product = products[idx];

    try {
      await deleteProductFromFirebase(product.id);
      products.splice(idx, 1);
      if (state.cart[productId]) {
        delete state.cart[productId];
      }
      delete state.images[productId];
      renderProductGrid();
      renderOrder();
      console.log(`✅ Producto "${product.name}" eliminado correctamente`);
    } catch (error) {
      console.error("❌ Error al eliminar producto:", error);
      alert("Error al eliminar el producto. Revisá la consola.");
    }
    deleteTargetId = null;
  }

  /* ============================================================
     MODALES EVENTOS (edición y eliminación de platos)
     ============================================================ */
  function initModals() {
    document.getElementById("edit-modal-close").addEventListener("click", closeEditModal);
    document.getElementById("edit-modal-cancel").addEventListener("click", closeEditModal);
    document.getElementById("edit-modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeEditModal();
    });
    document.getElementById("edit-modal-save").addEventListener("click", saveEditProduct);

    document.getElementById("confirm-cancel").addEventListener("click", function() {
      document.getElementById("confirm-modal-overlay").classList.remove("open");
    });
    document.getElementById("confirm-modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) document.getElementById("confirm-modal-overlay").classList.remove("open");
    });
    document.getElementById("confirm-accept").addEventListener("click", function() {
      const id = deleteTargetId;
      document.getElementById("confirm-modal-overlay").classList.remove("open");
      if (id) ejecutarEliminacion(id);
    });
  }

  /* ============================================================
     OTROS INICIALIZADORES
     ============================================================ */
  function initCurrencyToggle() {
    const container = document.getElementById("currency-toggle");
    if (!container) return;
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", function () {
        container.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        state.currency = this.getAttribute("data-currency");
        renderProductGrid();
        renderOrder();
      });
    });
  }

  function initSearch() {
    const input = document.getElementById("menu-search");
    if (!input) return;
    input.addEventListener("input", function () {
      state.searchTerm = this.value;
      renderProductGrid();
    });
  }

  /* ============================================================
     INICIALIZACIÓN PRINCIPAL
     ------------------------------------------------------------
     Se espera a "sesionLista" (evento que dispara auth-check.js una
     vez que cargó la empresa/sucursal REAL desde Firestore). El
     topbar ya lo pinta auth-check.js solo. Acá lo importante es
     tomar el empresaId real ANTES de tocar la colección "productos",
     que es justo lo que faltaba.
     ============================================================ */
  document.addEventListener("sesionLista", async function (e) {
    sesionActual = e.detail;
    empresaId = sesionActual.empresaId;
    sucursalId = sesionActual.sucursalId;

    await loadProducts();
    renderCategoryTabs();
    populateCategorySelect("dish-category");
    populateCategorySelect("edit-dish-category");
    renderOrder();
    initCurrencyToggle();
    initSearch();
    initRegistrarCompra();
    initOperacionFacturaListener();
    initAddDishForm();
    initModals();
    loadRealPhotos();
  });

})();