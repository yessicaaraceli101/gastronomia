// ================================================================
// 1. CONFIGURACIÓN DE FIREBASE
// ================================================================
const firebaseConfig = {
  apiKey: "AIzaSyAtbBVd83gI77fHlBucrqDVzMuqLcYONNY",
  authDomain: "gastro-7c5ad.firebaseapp.com",
  projectId: "gastro-7c5ad",
  storageBucket: "gastro-7c5ad.firebasestorage.app",
  messagingSenderId: "990850475087",
  appId: "1:990850475087:web:09a5066610de6c7e81df8a"
};

// ================================================================
// 2. IMPORTAR FIREBASE DESDE CDN
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log("Firebase conectado (app.js)");

// ================================================================
// 3. FUNCIONES DE DATOS (Firestore)
// ================================================================

// Obtener productos ordenados
async function fetchProducts() {
  try {
    const q = query(collection(db, "products"), orderBy("category"), orderBy("name"));
    const snapshot = await getDocs(q);
    const products = [];
    snapshot.forEach(doc => {
      products.push({ id: doc.id, ...doc.data() });
    });
    return products;
  } catch (error) {
    console.error("Error al obtener productos:", error);
    alert("Error al conectar con Firebase. Revisa tu conexión a internet.");
    return [];
  }
}

// Crear producto
async function createProduct(product) {
  try {
    const { id, ...data } = product;
    const docRef = await addDoc(collection(db, "products"), data);
    return { id: docRef.id, ...data };
  } catch (error) {
    console.error("Error al crear:", error);
    throw error;
  }
}

// Actualizar producto
async function updateProduct(id, patch) {
  try {
    const docRef = doc(db, "products", id);
    await updateDoc(docRef, patch);
    return { id, ...patch };
  } catch (error) {
    console.error("Error al actualizar:", error);
    throw error;
  }
}

// Eliminar producto
async function deleteProductApi(id) {
  try {
    await deleteDoc(doc(db, "products", id));
  } catch (error) {
    console.error("Error al eliminar:", error);
    throw error;
  }
}

// Crear pedido
async function createOrder(tableNumber, items) {
  try {
    const orderData = {
      table_number: tableNumber,
      status: "open",
      items: items,
      createdAt: new Date().toISOString()
    };
    const docRef = await addDoc(collection(db, "orders"), orderData);
    return { id: docRef.id, ...orderData };
  } catch (error) {
    console.error("Error al crear pedido:", error);
    throw error;
  }
}

// ================================================================
// 4. DATOS ESTÁTICOS Y ESTADO
// ================================================================
const restaurant = {
  name: "Pakecho Restaurant",
  date: "21 de agosto de 2022",
  table: "31"
};

const fallbackIcons = {
  pizza: `<svg viewBox="0 0 64 64"><path d="M32 6 58 54H6z" fill="#E8A23B"/><path d="M32 14 51 50H13z" fill="#F2B24A"/><circle cx="26" cy="34" r="3" fill="#C4622D"/><circle cx="38" cy="30" r="2.5" fill="#7BAA45"/><circle cx="32" cy="42" r="2.5" fill="#C4622D"/><circle cx="40" cy="40" r="2" fill="#7BAA45"/></svg>`,
  noodles: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="40" rx="26" ry="16" fill="#E8A23B"/><ellipse cx="32" cy="36" rx="24" ry="14" fill="#FBEADC"/><path d="M14 34c4-4 8 4 12 0s8-4 12 0 8 4 12 0" stroke="#E8A23B" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
  drinks: `<svg viewBox="0 0 64 64"><path d="M20 14h24l-4 38a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" fill="#F2B24A"/><rect x="18" y="10" width="28" height="6" rx="3" fill="#C4622D"/></svg>`,
  desserts: `<svg viewBox="0 0 64 64"><path d="M22 28h20l-6 26a4 4 0 0 1-4 3.2 4 4 0 0 1-4-3.2z" fill="#F2B24A"/><circle cx="32" cy="20" r="14" fill="#E8A23B"/></svg>`
};

const categories = [
  { id: "pizza", label: "Pizzas" },
  { id: "noodles", label: "Fideos" },
  { id: "drinks", label: "Bebidas" },
  { id: "desserts", label: "Postres" }
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

// ================================================================
// 5. CONVERSIÓN Y FORMATEO
// ================================================================
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

// ================================================================
// 6. IMÁGENES
// ================================================================
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
    const items = products.filter(p => p.category === category && !state.images[p.id]);
    if (!items.length) continue;
    const urls = await Promise.all(items.map(() => fetchOneFoodishImage(endpointByCategory[category])));
    items.forEach((p, i) => {
      if (urls[i]) {
        state.images[p.id] = urls[i];
        state.imagePools[category].push(urls[i]);
      }
    });
  }
  try {
    if (!state.imagePools.drinks.length) {
      const drinkRes = await fetch("https://www.thecocktaildb.com/api/json/v1/1/filter.php?c=Non_Alcoholic");
      const drinkData = await drinkRes.json();
      state.imagePools.drinks = (drinkData.drinks || []).map(d => d.strDrinkThumb + "/medium");
    }
    products.filter(p => p.category === "drinks" && !state.images[p.id]).forEach((p, i) => {
      if (state.imagePools.drinks.length) state.images[p.id] = state.imagePools.drinks[i % state.imagePools.drinks.length];
    });
  } catch (e) { /* sin conexión */ }
  renderProductGrid();
  renderOrder();
}

// ================================================================
// 7. HELPERS Y RENDERIZADO
// ================================================================
function getProduct(id) {
  return products.find(p => p.id === id);
}

function thumbHTML(product) {
  const url = state.images[product.id];
  const fallback = `<div class="thumb-fallback">${fallbackIcons[product.category]}</div>`;
  const img = url
    ? `<img class="thumb-img" src="${url}" alt="${product.name}" loading="lazy" onerror="this.style.display='none'" />`
    : "";
  return fallback + img;
}

function renderCategoryTabs() {
  const container = document.getElementById("category-tabs");
  container.innerHTML = "";
  categories.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "category-tab" + (cat.id === state.activeCategory ? " active" : "");
    btn.innerHTML = `<span class="cat-icon">${fallbackIcons[cat.id]}</span><span>${cat.label}</span>`;
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
      <div class="product-thumb">${thumbHTML(p)}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-meta">
        <span class="product-price">${formatPrice(p.price)}</span>
        <span class="product-items">${p.sold} vendidos</span>
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

// ================================================================
// 8. CARRITO
// ================================================================
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
  const emptyMsg = document.getElementById("order-empty");
  const ids = Object.keys(state.cart);
  container.innerHTML = "";
  if (ids.length === 0) {
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
      <div class="order-item-thumb">${thumbHTML(product)}</div>
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

// ================================================================
// 9. AGREGAR, EDITAR, ELIMINAR
// ================================================================
function populateCategorySelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = categories.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
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

  priceInput.addEventListener('blur', function () {
    const raw = this.value.replace(/[^0-9.]/g, '');
    const num = parseFloat(raw);
    if (!isNaN(num) && raw.length > 0) {
      const hasDecimals = raw.includes('.');
      this.value = num.toLocaleString('es-PY', {
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: 2
      });
    }
  });
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
      try { imageDataUrl = await readImageAsDataUrl(file); } catch (e) { alert("No se pudo leer la imagen."); }
    }

    const priceUSD = convertToUSD(price, state.currency);
    if (isNaN(priceUSD) || priceUSD <= 0) {
      alert("Error al convertir el precio.");
      saveBtn.disabled = false; saveBtn.textContent = "Guardar plato";
      return;
    }

    const newProduct = {
      category,
      name,
      price: priceUSD,
      sold: 0,
      custom: true
    };
    if (note) newProduct.note = note;
    if (imageDataUrl) newProduct.image = imageDataUrl;

    try {
      const saved = await createProduct(newProduct);
      products.push(saved);
      if (saved.image) state.images[saved.id] = saved.image;
      state.activeCategory = category;
      renderCategoryTabs();
      renderProductGrid();
      if (!imageDataUrl) {
        const img = await fetchImageForCategory(category);
        if (img) {
          state.images[saved.id] = img;
          await updateProduct(saved.id, { image: img });
          renderProductGrid();
        }
      }
      panel.hidden = true;
      clearForm();
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar el plato en Firebase.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar plato";
    }
  });
}

function openEditModal(productId) {
  const product = getProduct(productId);
  if (!product) return;
  state.editingId = productId;

  document.getElementById("edit-modal-title").textContent = `Editar: ${product.name}`;
  document.getElementById("edit-dish-name").value = product.name;
  document.getElementById("edit-dish-price").value = formatPrice(product.price);
  document.getElementById("edit-dish-category").value = product.category;
  document.getElementById("edit-dish-note").value = product.note || "";
  document.getElementById("edit-dish-image").value = "";

  populateCategorySelect("edit-dish-category");
  document.getElementById("edit-dish-category").value = product.category;
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
  const rawPrice = document.getElementById("edit-dish-price").value.replace(/\./g, '').replace(',', '.');
  const price = parseFloat(rawPrice);
  const category = document.getElementById("edit-dish-category").value;
  const note = document.getElementById("edit-dish-note").value.trim();
  const fileInput = document.getElementById("edit-dish-image");
  const file = fileInput.files && fileInput.files[0];

  if (!name) { alert("El nombre es obligatorio."); return; }
  if (isNaN(price) || price <= 0) { alert("Ingresá un precio válido."); return; }

  const priceUSD = convertToUSD(price, state.currency);
  if (isNaN(priceUSD) || priceUSD <= 0) { alert("Precio inválido después de la conversión."); return; }

  const patch = {
    name,
    price: priceUSD,
    category,
    note: note || null
  };

  if (file) {
    try {
      const dataUrl = await readImageAsDataUrl(file);
      patch.image = dataUrl;
    } catch (e) { alert("Error al leer la imagen."); }
  }

  try {
    const saved = await updateProduct(id, patch);
    Object.assign(product, patch);
    if (saved && saved.image) state.images[id] = saved.image;
    else if (patch.image) state.images[id] = patch.image;
    closeEditModal();
    renderProductGrid();
    renderOrder();
  } catch (e) {
    console.error(e);
    alert("No se pudo guardar los cambios en Firebase.");
  }
}

let deleteTargetId = null;

function confirmDelete(productId) {
  deleteTargetId = productId;
  const product = getProduct(productId);
  if (!product) return;
  document.getElementById("confirm-title").textContent = `¿Eliminar "${product.name}"?`;
  document.getElementById("confirm-text").textContent = "Esta acción no se puede deshacer.";
  document.getElementById("confirm-modal-overlay").classList.add("open");
}

function closeConfirm() {
  document.getElementById("confirm-modal-overlay").classList.remove("open");
  deleteTargetId = null;
}

async function deleteProduct() {
  if (!deleteTargetId) return;
  const idx = products.findIndex(p => p.id === deleteTargetId);
  if (idx === -1) return;
  try {
    await deleteProductApi(deleteTargetId);
    products.splice(idx, 1);
    delete state.images[deleteTargetId];
    delete state.cart[deleteTargetId];
    closeConfirm();
    renderProductGrid();
    renderOrder();
  } catch (e) {
    console.error(e);
    alert("No se pudo eliminar el plato en Firebase.");
  }
}

// ================================================================
// 10. MODALES Y OTROS INICIALIZADORES
// ================================================================
function initModals() {
  document.getElementById("edit-modal-close").addEventListener("click", closeEditModal);
  document.getElementById("edit-modal-cancel").addEventListener("click", closeEditModal);
  document.getElementById("edit-modal-overlay").addEventListener("click", function (e) {
    if (e.target === this) closeEditModal();
  });
  document.getElementById("edit-modal-save").addEventListener("click", saveEditProduct);

  document.getElementById("confirm-cancel").addEventListener("click", closeConfirm);
  document.getElementById("confirm-modal-overlay").addEventListener("click", function (e) {
    if (e.target === this) closeConfirm();
  });
  document.getElementById("confirm-accept").addEventListener("click", deleteProduct);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (document.getElementById("edit-modal-overlay").classList.contains("open")) closeEditModal();
      else if (document.getElementById("confirm-modal-overlay").classList.contains("open")) closeConfirm();
    }
  });
}

function initCurrencyToggle() {
  const container = document.getElementById("currency-toggle");
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

function initPrint() {
  const btn = document.getElementById("print-bill");
  if (!btn) return;
  btn.addEventListener("click", async function () {
    const ids = Object.keys(state.cart);
    if (ids.length === 0) { alert("Agregá al menos un plato."); return; }

    const items = ids.map(id => {
      const product = getProduct(id);
      return { product_id: id, qty: state.cart[id].qty, unit_price: product.price };
    });

    try {
      await createOrder(restaurant.table, items);
      alert("Cuenta guardada en Firebase e impresa (simulación).");
      state.cart = {};
      renderOrder();
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar el pedido en Firebase.");
    }
  });
}

function updateDate() {
  const el = document.getElementById("branch-date");
  if (el) el.textContent = restaurant.date;
}

// ================================================================
// 11. INICIALIZACIÓN
// ================================================================
document.addEventListener("DOMContentLoaded", async function () {
  updateDate();
  await loadProducts();
  renderCategoryTabs();
  populateCategorySelect("dish-category");
  populateCategorySelect("edit-dish-category");
  renderProductGrid();
  renderOrder();
  initCurrencyToggle();
  initSearch();
  initPrint();
  initAddDishForm();
  initModals();
  loadRealPhotos();
});