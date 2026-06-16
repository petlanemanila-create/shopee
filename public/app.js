const state = {
  activePacking: null,
  barcodeDetector: null,
  lookupTimer: null,
  lookupOrder: null,
  matchChoices: [],
  scannerStream: null,
  scannerTimer: null,
  orders: [],
  packingRecords: [],
  products: [],
  ordersDashboard: null,
  packingDashboard: null,
  productsDashboard: null
};

const elements = {
  days: document.querySelector("#days"),
  refresh: document.querySelector("#refresh"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  products: document.querySelector("#products"),
  totalProducts: document.querySelector("#totalProducts"),
  totalSold: document.querySelector("#totalSold"),
  shopId: document.querySelector("#shopId"),
  updated: document.querySelector("#updated"),
  setup: document.querySelector("#setup"),
  setupText: document.querySelector("#setupText"),
  orders: document.querySelector("#orders"),
  orderTotal: document.querySelector("#orderTotal"),
  orderPreparation: document.querySelector("#orderPreparation"),
  pendingShipment: document.querySelector("#pendingShipment"),
  processedOrders: document.querySelector("#processedOrders"),
  shippedOrders: document.querySelector("#shippedOrders"),
  completedOrders: document.querySelector("#completedOrders"),
  cancelledOrders: document.querySelector("#cancelledOrders"),
  unpaidOrders: document.querySelector("#unpaidOrders"),
  orderItems: document.querySelector("#orderItems"),
  ordersTab: document.querySelector("#ordersTab"),
  packingTab: document.querySelector("#packingTab"),
  productsTab: document.querySelector("#productsTab"),
  ordersView: document.querySelector("#ordersView"),
  packingView: document.querySelector("#packingView"),
  productsView: document.querySelector("#productsView"),
  packingTotal: document.querySelector("#packingTotal"),
  packerName: document.querySelector("#packerName"),
  packingCode: document.querySelector("#packingCode"),
  assignPacking: document.querySelector("#assignPacking"),
  activePacking: document.querySelector("#activePacking"),
  activePackingCode: document.querySelector("#activePackingCode"),
  activePackingMeta: document.querySelector("#activePackingMeta"),
  packingPhoto: document.querySelector("#packingPhoto"),
  completePacking: document.querySelector("#completePacking"),
  packingMessage: document.querySelector("#packingMessage"),
  packingRecords: document.querySelector("#packingRecords"),
  packingItemDetails: document.querySelector("#packingItemDetails"),
  scanBarcode: document.querySelector("#scanBarcode"),
  packingMatches: document.querySelector("#packingMatches"),
  packingItems: document.querySelector("#packingItems"),
  packingItemsTitle: document.querySelector("#packingItemsTitle"),
  packingItemsMeta: document.querySelector("#packingItemsMeta"),
  packingItemsList: document.querySelector("#packingItemsList"),
  removePacking: document.querySelector("#removePacking"),
  scannerPanel: document.querySelector("#scannerPanel"),
  scannerVideo: document.querySelector("#scannerVideo"),
  stopScan: document.querySelector("#stopScan")
};

elements.refresh.addEventListener("click", () => loadDashboard());
elements.days.addEventListener("change", () => loadDashboard({ resetSections: true }));
elements.search.addEventListener("input", render);
elements.sort.addEventListener("change", render);
elements.ordersTab.addEventListener("click", () => setView("orders"));
elements.packingTab.addEventListener("click", () => setView("packing"));
elements.productsTab.addEventListener("click", () => setView("products"));
elements.assignPacking.addEventListener("click", assignPacking);
elements.completePacking.addEventListener("click", completePacking);
elements.removePacking.addEventListener("click", removePacking);
elements.scanBarcode.addEventListener("click", startBarcodeScan);
elements.stopScan.addEventListener("click", stopBarcodeScan);
elements.packingCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") assignPacking();
});
elements.packingCode.addEventListener("input", () => {
  state.lookupOrder = null;
  state.matchChoices = [];
  renderPackingItems();
  renderPackingMatches();
  queuePackingLookup();
});
elements.packerName.addEventListener("change", () => {
  localStorage.setItem("packerName", elements.packerName.value.trim());
  syncActivePackingFromStaff();
});

await loadConfig();
elements.packerName.value = localStorage.getItem("packerName") || "";
await loadDashboard();

async function loadConfig() {
  const config = await fetchJson("/api/config");
  const missing = [];
  if (!config.hasPartnerId) missing.push("Partner ID");
  if (!config.hasPartnerKey) missing.push("Partner Key");
  if (!config.hasShopId) missing.push("Shop ID");
  if (!config.hasAccessToken) missing.push("Access Token");

  if (missing.length) {
    elements.setup.classList.remove("hidden");
    const credentialText = config.hasPartnerId && config.hasPartnerKey
      ? "Your Shopee app credentials are configured."
      : "Create a .env file from .env.example and add your Shopee app credentials.";
    elements.setupText.textContent = `Missing: ${missing.join(", ")}. ${credentialText} Use the authorize button after Shopee approves live access, or with a sandbox test shop.`;
  }
}

async function loadDashboard({ resetSections = false } = {}) {
  elements.refresh.disabled = true;
  if (resetSections || !state.ordersDashboard) {
    elements.orders.innerHTML = `<tr><td colspan="7" class="empty">Loading orders...</td></tr>`;
  }
  if (resetSections || !state.productsDashboard) {
    elements.products.innerHTML = `<tr><td colspan="6" class="empty">Loading products...</td></tr>`;
  }
  if (!state.packingDashboard) {
    elements.packingRecords.innerHTML = `<tr><td colspan="6" class="empty">Loading packing log...</td></tr>`;
  }

  await loadPackingSection();
  await Promise.allSettled([loadOrdersSection(), loadProductsSection()]);
  if (state.ordersDashboard?.cache?.status === "refreshing" || state.productsDashboard?.cache?.status === "refreshing") {
    window.setTimeout(() => {
      loadOrdersSection();
      loadProductsSection();
    }, 4000);
  }
  elements.refresh.disabled = false;
}

async function loadPackingSection() {
  try {
    const packingDashboard = await fetchJson("/api/packing");
    state.packingDashboard = packingDashboard;
    state.packingRecords = packingDashboard.records;
    renderPackerOptions();
    renderPackingSummary();
    renderPacking();
    renderPackingItemDetails();
    syncActivePackingFromStaff();
    queuePackingLookup();
  } catch (error) {
    elements.packingRecords.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
    elements.packingItemDetails.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

async function loadOrdersSection() {
  try {
    const ordersDashboard = await fetchJson(`/api/orders?days=${elements.days.value}`);
    state.ordersDashboard = ordersDashboard;
    state.orders = ordersDashboard.orders;
    renderOrderSummary();
    renderOrders();
    queuePackingLookup();
  } catch (error) {
    elements.orders.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadProductsSection() {
  try {
    const productsDashboard = await fetchJson(`/api/products?days=${elements.days.value}`);
    state.productsDashboard = productsDashboard;
    state.products = productsDashboard.products;
    renderProductSummary();
    render();
    renderPackingItems();
    renderPackingItemDetails();
  } catch (error) {
    elements.products.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    elements.refresh.disabled = false;
  }
}

function renderProductSummary() {
  const productData = state.productsDashboard;
  if (!productData) return;
  elements.totalProducts.textContent = formatNumber(productData.totalProducts);
  elements.totalSold.textContent = formatNumber(productData.totalSold);
  elements.shopId.textContent = productData.shopId;
  renderUpdated();
}

function renderOrderSummary() {
  const orderData = state.ordersDashboard;
  if (!orderData) return;
  const metrics = orderData.metrics || {};

  elements.orderTotal.textContent = `${formatNumber(metrics.totalOrders)} orders`;
  elements.orderPreparation.textContent = formatNumber(metrics.orderPreparation);
  elements.pendingShipment.textContent = formatNumber(metrics.pendingShipment);
  elements.processedOrders.textContent = formatNumber(metrics.processed);
  elements.shippedOrders.textContent = formatNumber(metrics.shipped);
  elements.completedOrders.textContent = formatNumber(metrics.completed);
  elements.cancelledOrders.textContent = formatNumber(metrics.cancelled);
  elements.unpaidOrders.textContent = formatNumber(metrics.unpaid);
  elements.orderItems.textContent = formatNumber(metrics.totalItems);
  renderUpdated();
}

function renderPackingSummary() {
  elements.packingTotal.textContent = `${formatNumber(state.packingDashboard?.metrics?.total)} records`;
}

function renderPackerOptions() {
  const selected = elements.packerName.value || localStorage.getItem("packerName") || "";
  const staffNames = new Set(["Alfred"]);

  for (const record of state.packingRecords || []) {
    const staff = String(record.staff || "").trim();
    if (staff) staffNames.add(staff);
  }
  if (selected) staffNames.add(selected);

  const options = Array.from(staffNames)
    .sort((a, b) => a.localeCompare(b))
    .map((staff) => `<option value="${escapeHtml(staff)}">${escapeHtml(staff)}</option>`);

  elements.packerName.innerHTML = `<option value="">Select packer</option>${options.join("")}`;
  elements.packerName.value = selected;
}

function renderUpdated() {
  const productTime = state.productsDashboard?.generatedAt;
  const orderTime = state.ordersDashboard?.generatedAt;
  const newest = [productTime, orderTime].filter(Boolean).sort().at(-1);
  if (!newest) return;
  const refreshing = [state.productsDashboard?.cache?.status, state.ordersDashboard?.cache?.status].includes("refreshing");
  elements.updated.textContent = `${refreshing ? "Updating in background. Showing cache from" : "Updated"} ${new Date(newest).toLocaleString()}`;
}

function setView(view) {
  const isOrders = view === "orders";
  const isPacking = view === "packing";
  const isProducts = view === "products";
  elements.ordersTab.classList.toggle("active", isOrders);
  elements.packingTab.classList.toggle("active", isPacking);
  elements.productsTab.classList.toggle("active", isProducts);
  elements.ordersTab.setAttribute("aria-selected", String(isOrders));
  elements.packingTab.setAttribute("aria-selected", String(isPacking));
  elements.productsTab.setAttribute("aria-selected", String(isProducts));
  elements.ordersView.classList.toggle("active", isOrders);
  elements.packingView.classList.toggle("active", isPacking);
  elements.productsView.classList.toggle("active", isProducts);
}

function render() {
  const query = elements.search.value.trim().toLowerCase();
  const sort = elements.sort.value;
  const products = state.products
    .filter((product) => {
      if (!query) return true;
      return `${product.name} ${product.sku} ${product.itemId}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "stock") return b.stock - a.stock;
      if (sort === "price") return b.price - a.price;
      return b.sold - a.sold;
    });

  if (!products.length) {
    elements.products.innerHTML = `<tr><td colspan="6" class="empty">No products found.</td></tr>`;
    return;
  }

  elements.products.innerHTML = products.map(renderProductRow).join("");
}

function renderOrders() {
  if (!state.orders.length) {
    elements.orders.innerHTML = `<tr><td colspan="7" class="empty">No orders found for this period.</td></tr>`;
    return;
  }

  elements.orders.innerHTML = state.orders.map(renderOrderRow).join("");
}

function renderPacking() {
  const records = state.packingRecords || [];
  if (!records.length) {
    elements.packingRecords.innerHTML = `<tr><td colspan="6" class="empty">No packing records yet.</td></tr>`;
    elements.packingItemDetails.innerHTML = `<p class="empty">No packing item details yet.</p>`;
    return;
  }

  elements.packingRecords.innerHTML = records.map(renderPackingRow).join("");
  renderPackingItemDetails();
}

function renderPackingItemDetails() {
  const rows = (state.packingRecords || []).flatMap((record) => {
    return (record.items || []).map((item) => ({ record, item: enrichPackingItem(item) }));
  });

  if (!rows.length) {
    elements.packingItemDetails.innerHTML = `<p class="empty">No packing item details yet.</p>`;
    return;
  }

  elements.packingItemDetails.innerHTML = rows.map(({ item }) => `
    <article class="item-detail-card">
      ${renderItemImage(item)}
      <div>
        <strong>${escapeHtml(item.name || "Item")}</strong>
        <span>${escapeHtml(item.modelName || "No variation")}</span>
        <span>SKU: ${escapeHtml(item.sku || "-")}</span>
      </div>
      <b>${formatNumber(item.quantity)}</b>
    </article>
  `).join("");
}

function syncActivePackingFromStaff() {
  const staff = elements.packerName.value.trim().toLowerCase();
  state.activePacking = staff
    ? state.packingRecords.find((record) => String(record.staff || "").toLowerCase() === staff && ["ASSIGNED", "PACKING"].includes(record.status)) || null
    : null;
  renderActivePacking();
}

function renderPackingRow(record) {
  const photoUrls = record.photoUrls?.length ? record.photoUrls : (record.photoUrl ? [record.photoUrl] : []);
  const photo = photoUrls.length
    ? photoUrls.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Photo ${index + 1}</a>`).join(" ")
    : "-";
  return `
    <tr>
      <td>
        <div class="order-sn">${escapeHtml(record.code)}</div>
        <div class="product-id">${escapeHtml(record.orderSn || "")}</div>
        <div class="product-id">${escapeHtml(recordItemsSummary(record))}</div>
      </td>
      <td><span class="status ${["ASSIGNED", "PACKING"].includes(record.status) ? "status-warn" : ""}">${escapeHtml(formatStatus(record.status))}</span></td>
      <td>${escapeHtml(record.staff || "-")}</td>
      <td>${formatDate(record.assignedAt)}</td>
      <td>${formatDate(record.completedAt)}</td>
      <td>${photo}</td>
    </tr>
  `;
}

async function assignPacking() {
  const staff = elements.packerName.value.trim();
  const code = elements.packingCode.value.trim();
  const order = state.lookupOrder || findOrderForCode(code);
  setPackingMessage("");
  if (!staff) {
    setPackingMessage("Select a packer first.");
    return;
  }
  try {
    const result = await postJson("/api/packing/assign", {
      staff,
      code,
      orderSn: order?.orderSn || code,
      packageNumbers: order?.packageNumbers || [],
      orderCreatedAt: order?.createdAt || "",
      buyer: order?.buyer || "",
      items: order ? enrichPackingItems(order.items || []) : [],
      managerAssigned: true
    });
    state.activePacking = result.record;
    state.packingRecords = result.records;
    elements.packingCode.value = "";
    elements.packingPhoto.value = "";
    state.lookupOrder = null;
    state.matchChoices = [];
    renderActivePacking();
    renderPackingItems();
    renderPackingMatches();
    renderPacking();
    renderPackingItemDetails();
    setPackingMessage(order ? `Task sent to ${staff}. They must take or decline it before packing.` : `Task sent to ${staff}.`);
  } catch (error) {
    setPackingMessage(error.message);
  }
}

async function lookupPackingItems() {
  const code = elements.packingCode.value.trim();
  setPackingMessage("");
  state.lookupOrder = null;
  renderPackingItems();
  renderPackingMatches();
  if (code.length < 4) return;

  const localMatches = findOpenOrderMatches(code);
  state.matchChoices = localMatches;
  renderPackingMatches();
  if (localMatches.length === 1) {
    applyPackingMatch(localMatches[0]);
    return;
  }
  if (localMatches.length > 1) {
    setPackingMessage("Choose the matching order below.");
    return;
  }

  try {
    const result = await fetchJson(`/api/packing/lookup?code=${encodeURIComponent(code)}&days=${elements.days.value}`);
    if (!result.found) {
      setPackingMessage(result.message);
      return;
    }
    state.lookupOrder = result.order;
    renderPackingItems();
    setPackingMessage("Items loaded. Check quantities, then assign the packing task.");
  } catch (error) {
    setPackingMessage(error.message);
  }
}

function queuePackingLookup() {
  if (state.lookupTimer) window.clearTimeout(state.lookupTimer);
  state.lookupTimer = window.setTimeout(lookupPackingItems, 450);
}

function applyPackingMatch(match, fillCode = true) {
  state.lookupOrder = match.order;
  state.matchChoices = [];
  if (fillCode) elements.packingCode.value = match.code;
  renderPackingMatches();
  renderPackingItems();
  setPackingMessage("Items loaded. Check quantities, then assign the packing task.");
}

async function completePacking() {
  if (!state.activePacking) {
    setPackingMessage("Assign a packing task first.");
    return;
  }
  setPackingMessage("");
  try {
    const photoDataUrl = await readPhotoDataUrl(elements.packingPhoto.files[0]);
    const result = await postJson("/api/packing/complete", {
      id: state.activePacking.id,
      staff: elements.packerName.value.trim(),
      photoDataUrl
    });
    state.packingRecords = result.records;
    elements.packingPhoto.value = "";
    syncActivePackingFromStaff();
    renderPacking();
    renderPackingItemDetails();
    setPackingMessage("Packing completed and saved.");
  } catch (error) {
    setPackingMessage(error.message);
  }
}

async function removePacking() {
  if (!state.activePacking) {
    setPackingMessage("There is no active packing task to remove.");
    return;
  }
  setPackingMessage("");
  try {
    const result = await postJson("/api/packing/remove", {
      id: state.activePacking.id,
      staff: elements.packerName.value.trim()
    });
    state.packingRecords = result.records;
    elements.packingPhoto.value = "";
    syncActivePackingFromStaff();
    renderPacking();
    renderPackingItemDetails();
    setPackingMessage("Packing task removed. You can assign another order.");
  } catch (error) {
    setPackingMessage(error.message);
  }
}

async function startBarcodeScan() {
  setPackingMessage("");
  if (!("BarcodeDetector" in window)) {
    setPackingMessage("Camera barcode scan is not supported in this browser. Use a handheld scanner or type the code.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setPackingMessage("This browser cannot open the camera here.");
    return;
  }

  try {
    state.barcodeDetector = new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "qr_code"] });
    state.scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    elements.scannerVideo.srcObject = state.scannerStream;
    elements.scannerPanel.classList.remove("hidden");
    state.scannerTimer = window.setInterval(detectBarcodeFrame, 350);
    setPackingMessage("Point the camera at the waybill barcode.");
  } catch (error) {
    stopBarcodeScan();
    setPackingMessage(error.message || "Could not start the camera scanner.");
  }
}

async function detectBarcodeFrame() {
  if (!state.barcodeDetector || !elements.scannerVideo.videoWidth) return;
  try {
    const codes = await state.barcodeDetector.detect(elements.scannerVideo);
    if (!codes.length) return;
    elements.packingCode.value = codes[0].rawValue || "";
    stopBarcodeScan();
    setPackingMessage("Barcode scanned. Loading items...");
    elements.packingCode.focus();
    queuePackingLookup();
  } catch {
    stopBarcodeScan();
    setPackingMessage("The camera opened, but this browser could not read the barcode.");
  }
}

function stopBarcodeScan() {
  if (state.scannerTimer) window.clearInterval(state.scannerTimer);
  state.scannerTimer = null;
  if (state.scannerStream) {
    for (const track of state.scannerStream.getTracks()) track.stop();
  }
  state.scannerStream = null;
  elements.scannerVideo.srcObject = null;
  elements.scannerPanel.classList.add("hidden");
}

function renderActivePacking() {
  if (!state.activePacking) {
    elements.activePacking.classList.add("hidden");
    elements.activePackingCode.textContent = "-";
    elements.activePackingMeta.textContent = "";
    elements.completePacking.disabled = false;
    return;
  }
  elements.activePacking.classList.remove("hidden");
  elements.activePackingCode.textContent = state.activePacking.code;
  elements.activePackingMeta.textContent = state.activePacking.status === "ASSIGNED"
    ? `Waiting for ${state.activePacking.staff} to take or decline. Assigned at ${formatDate(state.activePacking.assignedAt)}`
    : `Accepted by ${state.activePacking.staff} at ${formatDate(state.activePacking.acceptedAt || state.activePacking.assignedAt)}`;
  elements.completePacking.disabled = state.activePacking.status === "ASSIGNED";
}

function renderPackingItems() {
  if (!state.lookupOrder) {
    elements.packingItems.classList.add("hidden");
    elements.packingItemsTitle.textContent = "-";
    elements.packingItemsMeta.textContent = "";
    elements.packingItemsList.innerHTML = "";
    return;
  }

  const order = state.lookupOrder;
  elements.packingItems.classList.remove("hidden");
  elements.packingItemsTitle.textContent = order.orderSn;
  elements.packingItemsMeta.textContent = `${formatStatus(order.status)} · ${formatNumber(order.itemCount)} item${order.itemCount === 1 ? "" : "s"} · ${order.packageNumbers?.join(", ") || "No package number"}`;
  elements.packingItemsList.innerHTML = enrichPackingItems(order.items || []).map((item) => `
    <article>
      ${renderItemImage(item)}
      <div>
        <strong>${escapeHtml(item.name || "Item")}</strong>
        <span>${escapeHtml(item.modelName || "No variation")}</span>
        <span>SKU: ${escapeHtml(item.sku || "-")}</span>
      </div>
      <b>${formatNumber(item.quantity)}</b>
    </article>
  `).join("");
}

function renderPackingMatches() {
  if (!state.matchChoices.length) {
    elements.packingMatches.classList.add("hidden");
    elements.packingMatches.innerHTML = "";
    return;
  }

  elements.packingMatches.classList.remove("hidden");
  elements.packingMatches.innerHTML = state.matchChoices.map((match, index) => `
    <button class="match-option" type="button" data-match="${index}">
      <strong>${escapeHtml(match.order.orderSn)}</strong>
      <span>${escapeHtml(match.code)} · ${formatNumber(match.order.itemCount)} item${match.order.itemCount === 1 ? "" : "s"}</span>
    </button>
  `).join("");

  for (const button of elements.packingMatches.querySelectorAll("[data-match]")) {
    button.addEventListener("click", () => {
      applyPackingMatch(state.matchChoices[Number(button.dataset.match)]);
    });
  }
}

function findOrderForCode(code) {
  const value = String(code || "").toLowerCase();
  if (!value) return null;
  return state.orders.find((order) => {
    return [order.orderSn, ...(order.packageNumbers || []), order.buyer, order.shippingCarrier].some((field) =>
      String(field || "").toLowerCase().includes(value)
    );
  });
}

function findOpenOrderMatches(code) {
  const value = String(code || "").toLowerCase();
  if (value.length < 4) return [];
  const openStatuses = new Set(["ready_to_ship", "processed"]);
  const matches = [];

  for (const order of state.orders) {
    if (!openStatuses.has(String(order.status || "").toLowerCase())) continue;
    for (const candidate of [order.orderSn, ...(order.packageNumbers || [])].filter(Boolean)) {
      const text = String(candidate).toLowerCase();
      if (text.startsWith(value) || text.endsWith(value) || text.includes(value)) {
        matches.push({ code: String(candidate), order });
      }
    }
  }

  const seen = new Set();
  return matches.filter((match) => {
    const key = `${match.code}:${match.order.orderSn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function enrichPackingItems(items) {
  return items.map(enrichPackingItem);
}

function enrichPackingItem(item) {
  const product = state.products.find((candidate) => String(candidate.itemId) === String(item.itemId));
  return {
    ...item,
    imageUrl: item.imageUrl || product?.imageUrl || "",
    sku: item.sku || product?.sku || ""
  };
}

function renderItemImage(item) {
  return item.imageUrl
    ? `<img class="item-picture" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="item-picture" aria-hidden="true"></div>`;
}

function renderOrderRow(order) {
  return `
    <tr>
      <td>
        <div class="order-sn">${escapeHtml(order.orderSn)}</div>
        <div class="product-id">${escapeHtml(firstOrderItem(order))}</div>
      </td>
      <td><span class="status ${statusClass(order.status)}">${escapeHtml(formatStatus(order.status))}</span></td>
      <td>${escapeHtml(order.buyer || "-")}</td>
      <td class="number">${formatNumber(order.itemCount)}</td>
      <td class="number">${formatMoney(order.totalAmount, order.currency)}</td>
      <td>${formatDate(order.createdAt)}</td>
      <td>${escapeHtml(order.shippingCarrier || "-")}</td>
    </tr>
  `;
}

function renderProductRow(product) {
  const image = product.imageUrl
    ? `<img class="thumb" src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="thumb" aria-hidden="true"></div>`;
  return `
    <tr>
      <td>
        <div class="product">
          ${image}
          <div>
            <div class="product-name">${escapeHtml(product.name)}</div>
            <div class="product-id">Item ${escapeHtml(product.itemId)}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(product.sku || "-")}</td>
      <td><span class="status">${escapeHtml(product.status || "-")}</span></td>
      <td class="number">${formatNumber(product.stock)}</td>
      <td class="number">${formatMoney(product.price, product.currency)}</td>
      <td class="number"><strong>${formatNumber(product.sold)}</strong></td>
    </tr>
  `;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || "Request failed.");
  return body;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || "Request failed.");
  return body;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  if (!currency) return amount ? formatNumber(amount) : "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatStatus(status) {
  return String(status || "-").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (["ready_to_ship", "processed", "unpaid"].includes(value)) return "status-warn";
  if (["shipped", "to_confirm_receive"].includes(value)) return "status-info";
  if (value.includes("cancel")) return "status-bad";
  return "";
}

function firstOrderItem(order) {
  const item = order.items?.[0];
  if (!item) return "No item details";
  const quantity = item.quantity > 1 ? ` x ${formatNumber(item.quantity)}` : "";
  return `${item.name || "Item"}${quantity}`;
}

function recordItemsSummary(record) {
  const items = record.items || [];
  if (!items.length) return "";
  const first = items[0];
  const more = items.length > 1 ? ` + ${items.length - 1} more` : "";
  return `${first.name || "Item"} x ${formatNumber(first.quantity)}${more}`;
}

function readPhotoDataUrl(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the packing photo."));
    reader.readAsDataURL(file);
  });
}

function setPackingMessage(message) {
  elements.packingMessage.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
