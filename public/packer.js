const state = {
  staff: localStorage.getItem("packerName") || "",
  orders: [],
  products: [],
  packingRecords: [],
  activeRecord: null,
  detailRecord: null,
  proofPhotos: [],
  proofRecordId: "",
  lookupTimer: null,
  scannerStream: null,
  scannerTimer: null,
  barcodeDetector: null
};

const elements = {
  loginScreen: document.querySelector("#loginScreen"),
  searchScreen: document.querySelector("#searchScreen"),
  detailScreen: document.querySelector("#detailScreen"),
  staffName: document.querySelector("#staffName"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  welcomeName: document.querySelector("#welcomeName"),
  orderSearch: document.querySelector("#orderSearch"),
  cameraScan: document.querySelector("#cameraScan"),
  cameraPanel: document.querySelector("#cameraPanel"),
  cameraVideo: document.querySelector("#cameraVideo"),
  stopCamera: document.querySelector("#stopCamera"),
  orderMatches: document.querySelector("#orderMatches"),
  searchMessage: document.querySelector("#searchMessage"),
  todayPackedLabel: document.querySelector("#todayPackedLabel"),
  todayPackedCount: document.querySelector("#todayPackedCount"),
  todayPackedList: document.querySelector("#todayPackedList"),
  detailOrderId: document.querySelector("#detailOrderId"),
  detailOrderDate: document.querySelector("#detailOrderDate"),
  packedStatus: document.querySelector("#packedStatus"),
  packedStaff: document.querySelector("#packedStaff"),
  packedTime: document.querySelector("#packedTime"),
  detailItems: document.querySelector("#detailItems"),
  detailPhoto: document.querySelector("#detailPhoto"),
  takePhotosButton: document.querySelector("#takePhotosButton"),
  photoCount: document.querySelector("#photoCount"),
  photoPreview: document.querySelector("#photoPreview"),
  packedButton: document.querySelector("#packedButton"),
  unassignButton: document.querySelector("#unassignButton"),
  backToSearch: document.querySelector("#backToSearch"),
  detailMessage: document.querySelector("#detailMessage"),
  photoModal: document.querySelector("#photoModal"),
  photoModalImage: document.querySelector("#photoModalImage"),
  closePhotoModal: document.querySelector("#closePhotoModal")
};

elements.loginButton.addEventListener("click", login);
elements.staffName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
elements.logoutButton.addEventListener("click", logout);
elements.orderSearch.addEventListener("input", queueSearch);
elements.orderSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") assignFirstMatch();
});
elements.cameraScan.addEventListener("click", startBarcodeScan);
elements.stopCamera.addEventListener("click", stopBarcodeScan);
elements.packedButton.addEventListener("click", completeActiveOrder);
elements.unassignButton.addEventListener("click", unassignActiveOrder);
elements.backToSearch.addEventListener("click", showSearch);
elements.takePhotosButton.addEventListener("click", () => elements.detailPhoto.click());
elements.detailPhoto.addEventListener("change", addProofPhotos);
elements.photoPreview.addEventListener("click", handlePhotoPreviewClick);
elements.closePhotoModal.addEventListener("click", closePhotoPreview);
elements.photoModal.addEventListener("click", (event) => {
  if (event.target === elements.photoModal) closePhotoPreview();
});

elements.staffName.value = state.staff;
if (state.staff) {
  await bootPacker();
} else {
  showLogin();
}

async function login() {
  const staff = elements.staffName.value.trim();
  if (!staff) return;
  state.staff = staff;
  localStorage.setItem("packerName", staff);
  await bootPacker();
}

function logout() {
  localStorage.removeItem("packerName");
  state.staff = "";
  state.activeRecord = null;
  showLogin();
}

async function bootPacker() {
  elements.welcomeName.textContent = state.staff;
  showSearch();
  await refreshData();
  syncActiveRecord();
  if (state.activeRecord) showDetail();
}

async function refreshData() {
  setSearchMessage("Loading orders...");
  const [ordersDashboard, productsDashboard, packingDashboard] = await Promise.all([
    fetchJson("/api/orders?days=7"),
    fetchJson("/api/products?days=7"),
    fetchJson("/api/packing")
  ]);
  state.orders = ordersDashboard.orders || [];
  state.products = productsDashboard.products || [];
  state.packingRecords = packingDashboard.records || [];
  renderTodayStats();
  setSearchMessage("");
}

function syncActiveRecord() {
  const staff = state.staff.toLowerCase();
  state.activeRecord = state.packingRecords.find((record) =>
    String(record.staff || "").toLowerCase() === staff && ["ASSIGNED", "PACKING"].includes(record.status)
  ) || null;
}

function showLogin() {
  elements.loginScreen.classList.remove("hidden");
  elements.searchScreen.classList.add("hidden");
  elements.detailScreen.classList.add("hidden");
}

function showSearch() {
  if (state.activeRecord) return showDetail();
  state.detailRecord = null;
  elements.loginScreen.classList.add("hidden");
  elements.searchScreen.classList.remove("hidden");
  elements.detailScreen.classList.add("hidden");
  setSearchLocked(false);
  elements.orderSearch.focus();
}

function showDetail(record = state.activeRecord) {
  if (!record) return showSearch();
  state.detailRecord = record;
  const isPacked = record.status === "COMPLETED";
  const isAssigned = record.status === "ASSIGNED";
  const isPacking = record.status === "PACKING";
  elements.loginScreen.classList.add("hidden");
  elements.searchScreen.classList.add("hidden");
  elements.detailScreen.classList.remove("hidden");
  setSearchLocked(Boolean(state.activeRecord));
  if (isPacking && state.proofRecordId !== record.id) {
    clearProofPhotos();
    state.proofRecordId = record.id;
  }
  elements.detailOrderId.textContent = record.orderSn || record.code;
  elements.detailOrderDate.textContent = formatDateOnly(record.orderCreatedAt || record.assignedAt);
  elements.detailItems.innerHTML = (record.items || []).map((item) => renderDetailItem(enrichItem(item))).join("");
  renderPackedStatus(record);
  elements.detailPhoto.closest(".photo-proof").classList.toggle("hidden", isPacked || isAssigned);
  elements.packedButton.classList.toggle("hidden", isPacked);
  elements.unassignButton.classList.toggle("hidden", isPacked);
  elements.packedButton.textContent = isAssigned ? "Take task" : "Order packed";
  elements.unassignButton.textContent = isAssigned ? "Decline" : "Unassign";
  renderPhotoPreview();
  setDetailMessage(isAssigned ? `Task assigned to you by manager. Take it when you are ready to pack.` : "");
}

function renderPackedStatus(record) {
  const isPacked = record.status === "COMPLETED";
  elements.packedStatus.classList.toggle("hidden", !isPacked);
  if (!isPacked) return;
  elements.packedStaff.textContent = record.staff || "-";
  elements.packedTime.textContent = formatTime(record.completedAt);
}

function setSearchLocked(locked) {
  elements.orderSearch.disabled = locked;
  elements.cameraScan.disabled = locked;
  elements.backToSearch.disabled = locked;
  elements.backToSearch.classList.toggle("hidden", locked);
  if (locked) {
    elements.orderMatches.innerHTML = "";
    elements.orderSearch.value = "";
    stopBarcodeScan();
  }
}

function queueSearch() {
  if (state.activeRecord) return showDetail();
  if (state.lookupTimer) window.clearTimeout(state.lookupTimer);
  state.lookupTimer = window.setTimeout(renderMatches, 250);
}

function renderMatches() {
  if (state.activeRecord) return showDetail();
  const query = elements.orderSearch.value.trim().toLowerCase();
  if (query.length < 4) {
    elements.orderMatches.innerHTML = "";
    setSearchMessage("");
    return;
  }
  const matches = findOrderMatches(query);
  if (!matches.length) {
    elements.orderMatches.innerHTML = "";
    setSearchMessage("No matching order found.");
    return;
  }
  setSearchMessage("");
  elements.orderMatches.innerHTML = matches.map((match, index) => `
    <button class="packer-match ${match.packed ? "packed-match" : ""}" type="button" data-match="${index}">
      <strong>${escapeHtml(match.record?.orderSn || match.order?.orderSn)}</strong>
      <span>${escapeHtml(match.code)} · ${match.packed ? `PACKED by ${escapeHtml(match.record.staff || "-")} at ${formatTime(match.record.completedAt)}` : `${formatNumber(match.order.itemCount)} item${match.order.itemCount === 1 ? "" : "s"}`}</span>
    </button>
  `).join("");
  for (const button of elements.orderMatches.querySelectorAll("[data-match]")) {
    button.addEventListener("click", () => openMatch(matches[Number(button.dataset.match)]));
  }
}

function assignFirstMatch() {
  if (state.activeRecord) return showDetail();
  const match = findOrderMatches(elements.orderSearch.value.trim())[0];
  if (match) openMatch(match);
}

function openMatch(match) {
  if (match.packed) {
    elements.orderSearch.value = "";
    elements.orderMatches.innerHTML = "";
    setSearchMessage("");
    showDetail(match.record);
    return;
  }
  assignOrder(match);
}

async function assignOrder(match) {
  if (state.activeRecord) return showDetail();
  const order = match.order;
  setSearchMessage("Assigning order...");
  try {
    const result = await postJson("/api/packing/assign", {
      staff: state.staff,
      code: match.code,
      orderSn: order.orderSn,
      packageNumbers: order.packageNumbers || [],
      orderCreatedAt: order.createdAt || "",
      buyer: order.buyer || "",
      items: (order.items || []).map(enrichItem)
    });
    state.activeRecord = result.record;
    state.packingRecords = result.records || [];
    elements.orderSearch.value = "";
    elements.orderMatches.innerHTML = "";
    showDetail();
  } catch (error) {
    setSearchMessage(error.message);
  }
}

async function completeActiveOrder() {
  if (!state.activeRecord) return;
  if (state.activeRecord.status === "ASSIGNED") return acceptAssignedOrder();
  if (state.proofPhotos.length < 3 || state.proofPhotos.length > 5) {
    setDetailMessage("Please take 3 to 5 packing photos before completing.");
    return;
  }
  setDetailMessage("Saving packed order...");
  try {
    const photoDataUrls = await Promise.all(state.proofPhotos.map(compressPhotoDataUrl));
    const result = await postJson("/api/packing/complete", {
      id: state.activeRecord.id,
      staff: state.staff,
      photoDataUrls
    });
    state.packingRecords = result.records || [];
    state.activeRecord = null;
    clearProofPhotos();
    renderTodayStats();
    showSearch();
    setSearchMessage("Order packed.");
    refreshData().catch((error) => setSearchMessage(error.message));
  } catch (error) {
    setDetailMessage(error.message);
  }
}

async function acceptAssignedOrder() {
  if (!state.activeRecord) return;
  setDetailMessage("Taking assigned task...");
  try {
    const result = await postJson("/api/packing/accept", {
      id: state.activeRecord.id,
      staff: state.staff
    });
    state.packingRecords = result.records || [];
    state.activeRecord = result.record;
    clearProofPhotos();
    showDetail();
    setDetailMessage("Task accepted. Pack this order now.");
  } catch (error) {
    setDetailMessage(error.message);
  }
}

async function unassignActiveOrder() {
  if (!state.activeRecord) return;
  const isAssigned = state.activeRecord.status === "ASSIGNED";
  setDetailMessage(isAssigned ? "Declining assigned task..." : "Unassigning order...");
  try {
    const result = await postJson(isAssigned ? "/api/packing/decline" : "/api/packing/remove", {
      id: state.activeRecord.id,
      staff: state.staff
    });
    state.packingRecords = result.records || [];
    state.activeRecord = null;
    clearProofPhotos();
    renderTodayStats();
    showSearch();
    setSearchMessage(isAssigned ? "Task declined." : "Order unassigned.");
  } catch (error) {
    setDetailMessage(error.message);
  }
}

function findOrderMatches(query) {
  const value = String(query || "").toLowerCase();
  if (value.length < 4) return [];
  const unavailableCodes = new Set(state.packingRecords
    .filter((record) => ["ASSIGNED", "PACKING", "COMPLETED"].includes(record.status))
    .flatMap((record) => [record.orderSn, record.code, ...(record.packageNumbers || [])])
    .filter(Boolean)
    .map((code) => String(code).toLowerCase()));
  const openStatuses = new Set(["ready_to_ship", "processed"]);
  const matches = [];

  for (const record of state.packingRecords.filter((record) => record.status === "COMPLETED")) {
    for (const candidate of [record.orderSn, record.code, ...(record.packageNumbers || [])].filter(Boolean)) {
      const text = String(candidate).toLowerCase();
      if (text.startsWith(value) || text.endsWith(value) || text.includes(value)) {
        matches.push({ code: String(candidate), record, packed: true });
      }
    }
  }

  for (const order of state.orders) {
    if (!openStatuses.has(String(order.status || "").toLowerCase())) continue;
    if (unavailableCodes.has(String(order.orderSn).toLowerCase())) continue;
    for (const candidate of [order.orderSn, ...(order.packageNumbers || [])].filter(Boolean)) {
      const text = String(candidate).toLowerCase();
      if (text.startsWith(value) || text.endsWith(value) || text.includes(value)) {
        matches.push({ code: String(candidate), order, packed: false });
      }
    }
  }

  const seen = new Set();
  return matches.filter((match) => {
    const key = `${match.packed ? "packed" : "open"}:${match.code}:${match.record?.orderSn || match.order?.orderSn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function renderTodayStats() {
  if (!state.staff) return;
  const staff = state.staff.toLowerCase();
  const today = new Date().toLocaleDateString();
  const packedToday = state.packingRecords
    .filter((record) => String(record.staff || "").toLowerCase() === staff)
    .filter((record) => record.status === "COMPLETED")
    .filter((record) => record.completedAt && new Date(record.completedAt).toLocaleDateString() === today)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  elements.todayPackedCount.textContent = formatNumber(packedToday.length);
  elements.todayPackedLabel.textContent = packedToday.length === 1 ? "Order packed" : "Orders packed";
  if (!packedToday.length) {
    elements.todayPackedList.innerHTML = `<p class="empty">No packed orders today.</p>`;
    return;
  }

  elements.todayPackedList.innerHTML = packedToday.map((record, index) => `
    <button class="today-order" type="button" data-packed="${index}">
      <strong>${escapeHtml(record.orderSn || record.code)}</strong>
      <span>${formatTime(record.completedAt)}</span>
    </button>
  `).join("");
  for (const button of elements.todayPackedList.querySelectorAll("[data-packed]")) {
    button.addEventListener("click", () => showDetail(packedToday[Number(button.dataset.packed)]));
  }
}

function enrichItem(item) {
  const product = state.products.find((candidate) => String(candidate.itemId) === String(item.itemId));
  return {
    ...item,
    imageUrl: item.imageUrl || product?.imageUrl || "",
    sku: item.sku || product?.sku || ""
  };
}

function renderDetailItem(item) {
  return `
    <article class="item-detail-card">
      ${renderItemImage(item)}
      <div>
        <strong>${escapeHtml(item.name || "Item")}</strong>
        <span>${escapeHtml(item.modelName || "No variation")}</span>
        <span>SKU: ${escapeHtml(item.sku || "-")}</span>
      </div>
      <b>${formatNumber(item.quantity)}</b>
    </article>
  `;
}

function renderItemImage(item) {
  return item.imageUrl
    ? `<img class="item-picture" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="item-picture" aria-hidden="true"></div>`;
}

function addProofPhotos() {
  const incoming = Array.from(elements.detailPhoto.files || []);
  const room = Math.max(0, 5 - state.proofPhotos.length);
  state.proofPhotos.push(...incoming.slice(0, room));
  elements.detailPhoto.value = "";
  if (incoming.length > room) {
    setDetailMessage("Maximum 5 photos allowed.");
  } else {
    setDetailMessage("");
  }
  renderPhotoPreview();
}

function renderPhotoPreview() {
  if (state.activeRecord?.status === "ASSIGNED") {
    elements.photoCount.classList.remove("photo-warning", "photo-ready");
    elements.photoCount.textContent = "Take the task before adding photo proof.";
    elements.packedButton.disabled = false;
    elements.packedButton.textContent = "Take task";
    elements.takePhotosButton.textContent = "Take photos";
    elements.takePhotosButton.disabled = true;
    elements.photoPreview.innerHTML = "";
    return;
  }
  const valid = state.proofPhotos.length >= 3 && state.proofPhotos.length <= 5;
  const missing = Math.max(0, 3 - state.proofPhotos.length);
  elements.photoCount.classList.toggle("photo-warning", !valid);
  elements.photoCount.classList.toggle("photo-ready", valid);
  elements.photoCount.textContent = valid
    ? `${state.proofPhotos.length} of 5 photos ready. You can complete this order.`
    : `${state.proofPhotos.length} of 5 photos. Add ${missing} more photo${missing === 1 ? "" : "s"} to enable Order packed.`;
  elements.packedButton.disabled = !valid;
  elements.packedButton.textContent = valid ? "Order packed" : `Need ${missing} more photo${missing === 1 ? "" : "s"}`;
  elements.takePhotosButton.textContent = state.proofPhotos.length ? "Add photos" : "Take photos";
  elements.takePhotosButton.disabled = state.proofPhotos.length >= 5;
  elements.photoPreview.innerHTML = state.proofPhotos.map((file, index) => `
    <div class="photo-tile">
      <button class="photo-open" type="button" data-photo-open="${index}" aria-label="Preview photo ${index + 1}">
        <img src="${escapeHtml(URL.createObjectURL(file))}" alt="" />
      </button>
      <button class="photo-remove" type="button" data-photo-index="${index}" aria-label="Remove photo ${index + 1}">×</button>
    </div>
  `).join("");
}

function handlePhotoPreviewClick(event) {
  const removeButton = event.target.closest("[data-photo-index]");
  if (removeButton) {
    removeProofPhoto(removeButton);
    return;
  }
  const openButton = event.target.closest("[data-photo-open]");
  if (openButton) openPhotoPreview(Number(openButton.dataset.photoOpen));
}

function removeProofPhoto(button) {
  const index = Number(button.dataset.photoIndex);
  if (!Number.isInteger(index)) return;
  state.proofPhotos.splice(index, 1);
  setDetailMessage("Photo removed.");
  renderPhotoPreview();
}

function openPhotoPreview(index) {
  const file = state.proofPhotos[index];
  if (!file) return;
  elements.photoModalImage.src = URL.createObjectURL(file);
  elements.photoModal.classList.remove("hidden");
}

function closePhotoPreview() {
  elements.photoModal.classList.add("hidden");
  elements.photoModalImage.src = "";
}

function clearProofPhotos() {
  state.proofPhotos = [];
  state.proofRecordId = "";
  elements.detailPhoto.value = "";
  closePhotoPreview();
  renderPhotoPreview();
}

async function startBarcodeScan() {
  if (state.activeRecord) return showDetail();
  setSearchMessage("");
  if (!("BarcodeDetector" in window)) {
    setSearchMessage("Camera barcode scan is not supported in this browser.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setSearchMessage("This browser cannot open the camera here.");
    return;
  }
  try {
    state.barcodeDetector = new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "qr_code"] });
    state.scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    elements.cameraVideo.srcObject = state.scannerStream;
    elements.cameraPanel.classList.remove("hidden");
    state.scannerTimer = window.setInterval(detectBarcodeFrame, 350);
  } catch (error) {
    stopBarcodeScan();
    setSearchMessage(error.message || "Could not start the camera scanner.");
  }
}

async function detectBarcodeFrame() {
  if (!state.barcodeDetector || !elements.cameraVideo.videoWidth) return;
  try {
    const codes = await state.barcodeDetector.detect(elements.cameraVideo);
    if (!codes.length) return;
    elements.orderSearch.value = codes[0].rawValue || "";
    stopBarcodeScan();
    renderMatches();
  } catch {
    stopBarcodeScan();
    setSearchMessage("The camera opened, but this browser could not read the barcode.");
  }
}

function stopBarcodeScan() {
  if (state.scannerTimer) window.clearInterval(state.scannerTimer);
  state.scannerTimer = null;
  if (state.scannerStream) {
    for (const track of state.scannerStream.getTracks()) track.stop();
  }
  state.scannerStream = null;
  elements.cameraVideo.srcObject = null;
  elements.cameraPanel.classList.add("hidden");
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

function readPhotoDataUrl(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the packing photo."));
    reader.readAsDataURL(file);
  });
}

async function compressPhotoDataUrl(file) {
  const image = new Image();
  image.src = await readPhotoDataUrl(file);
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Could not prepare a packing photo."));
  });

  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function setSearchMessage(message) {
  elements.searchMessage.textContent = message;
}

function setDetailMessage(message) {
  elements.detailMessage.textContent = message;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDateOnly(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
