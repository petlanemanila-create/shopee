import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const tokenFile = path.join(__dirname, ".shopee-token.json");
const dataDir = path.join(__dirname, "data");
const packingFile = path.join(dataDir, "packing-records.json");
const dashboardCacheFile = path.join(dataDir, "dashboard-cache.json");
const packingPhotoDir = path.join(publicDir, "packing-photos");

await loadEnv(path.join(__dirname, ".env"));

const config = {
  host: process.env.SHOPEE_HOST || "https://partner.shopeemobile.com",
  partnerId: process.env.SHOPEE_PARTNER_ID,
  partnerKey: process.env.SHOPEE_PARTNER_KEY,
  shopId: process.env.SHOPEE_SHOP_ID,
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  port: Number(process.env.PORT || 3000)
};

const dashboardCache = await readDashboardCache();
const cacheRefreshes = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/config") {
      return sendJson(res, await getConfigStatus());
    }

    if (url.pathname === "/api/products") {
      const days = clamp(Number(url.searchParams.get("days") || 7), 1, 365);
      const force = url.searchParams.get("force") === "1";
      const statuses = (url.searchParams.get("statuses") || "NORMAL,UNLIST")
        .split(",")
        .map((status) => status.trim())
        .filter(Boolean);
      return sendJson(res, await getCachedDashboard({
        key: `products:${days}:${statuses.join(",")}`,
        ttlMs: 10 * 60 * 1000,
        force,
        builder: () => buildProductDashboard({ days, statuses })
      }));
    }

    if (url.pathname === "/api/orders") {
      const days = clamp(Number(url.searchParams.get("days") || 7), 1, 90);
      const force = url.searchParams.get("force") === "1";
      return sendJson(res, await getCachedDashboard({
        key: `orders:${days}`,
        ttlMs: 60 * 1000,
        force,
        builder: () => buildOrderDashboard({ days })
      }));
    }

    if (url.pathname === "/api/packing" && req.method === "GET") {
      return sendJson(res, await buildPackingDashboard());
    }

    if (url.pathname === "/api/packing/lookup" && req.method === "GET") {
      const code = url.searchParams.get("code") || "";
      const days = clamp(Number(url.searchParams.get("days") || 14), 1, 90);
      return sendJson(res, await lookupPackingOrder({ code, days }));
    }

    if (url.pathname === "/api/packing/assign" && req.method === "POST") {
      return sendJson(res, await assignPackingRecord(await readJsonBody(req)));
    }

    if (url.pathname === "/api/packing/accept" && req.method === "POST") {
      return sendJson(res, await acceptPackingRecord(await readJsonBody(req)));
    }

    if (url.pathname === "/api/packing/decline" && req.method === "POST") {
      return sendJson(res, await declinePackingRecord(await readJsonBody(req)));
    }

    if (url.pathname === "/api/packing/complete" && req.method === "POST") {
      return sendJson(res, await completePackingRecord(await readJsonBody(req)));
    }

    if (url.pathname === "/api/packing/remove" && req.method === "POST") {
      return sendJson(res, await removePackingRecord(await readJsonBody(req)));
    }

    if (url.pathname === "/auth/start") {
      ensureConfig(["partnerId", "partnerKey"]);
      const authPath = "/api/v2/shop/auth_partner";
      const timestamp = unixNow();
      const redirect = `${config.appBaseUrl}/auth/callback`;
      const sign = signShopee(authPath, timestamp);
      const authUrl = new URL(authPath, config.host);
      authUrl.searchParams.set("partner_id", config.partnerId);
      authUrl.searchParams.set("timestamp", timestamp);
      authUrl.searchParams.set("sign", sign);
      authUrl.searchParams.set("redirect", redirect);
      res.writeHead(302, { Location: authUrl.toString() });
      return res.end();
    }

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      const shopId = url.searchParams.get("shop_id") || config.shopId;
      if (!code || !shopId) {
        return sendHtml(res, renderMessage("Shopee authorization needs both code and shop_id."));
      }
      const token = await exchangeCodeForToken({ code, shopId });
      await saveToken(token);
      return sendHtml(
        res,
        renderMessage("Shopee authorization saved. You can close this tab or return to the dashboard.")
      );
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, { error: error.message || "Unexpected server error" }, 500);
  }
});

server.listen(config.port, () => {
  console.log(`Shopee dashboard running at http://localhost:${config.port}`);
});

async function getCachedDashboard({ key, ttlMs, force, builder }) {
  const cached = dashboardCache[key];
  const age = cached ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
  const fresh = age < ttlMs;

  if (cached && !force) {
    if (!fresh) refreshCachedDashboard({ key, builder }).catch((error) => console.error(error));
    return withCacheStatus(cached, fresh ? "fresh" : "refreshing");
  }

  if (cached && cacheRefreshes.has(key)) {
    return withCacheStatus(cached, "refreshing");
  }

  const dashboard = await refreshCachedDashboard({ key, builder });
  return withCacheStatus(dashboard, "fresh");
}

async function refreshCachedDashboard({ key, builder }) {
  if (cacheRefreshes.has(key)) return cacheRefreshes.get(key);
  const refresh = builder()
    .then(async (dashboard) => {
      dashboardCache[key] = dashboard;
      await writeDashboardCache();
      return dashboard;
    })
    .finally(() => {
      cacheRefreshes.delete(key);
    });
  cacheRefreshes.set(key, refresh);
  return refresh;
}

function withCacheStatus(dashboard, status) {
  return {
    ...dashboard,
    cache: {
      status,
      refreshedAt: dashboard.generatedAt
    }
  };
}

async function buildProductDashboard({ days, statuses }) {
  ensureConfig(["partnerId", "partnerKey"]);
  const token = await getToken();
  const productRefs = await getAllItemRefs({ token, statuses });
  const products = await getItemBaseInfo({ token, itemIds: productRefs.map((item) => item.item_id) });
  const soldByItem = await getSoldQuantityByItem({ token, days });

  const rows = productRefs.map((ref) => {
    const detail = products.get(String(ref.item_id)) || {};
    const stock = sumStock(detail);
    const price = firstPrice(detail);
    return {
      itemId: ref.item_id,
      name: detail.item_name || detail.name || `Item ${ref.item_id}`,
      status: detail.item_status || ref.item_status || "",
      sku: detail.item_sku || "",
      stock,
      price,
      currency: detail.currency || "",
      sold: soldByItem.get(String(ref.item_id)) || 0,
      historicalSold: Number(detail.historical_sold || detail.sold || 0),
      imageUrl: pickImage(detail),
      updatedAt: detail.update_time ? new Date(detail.update_time * 1000).toISOString() : null
    };
  });

  rows.sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    shopId: String(token.shopId),
    days,
    totalProducts: rows.length,
    totalSold: rows.reduce((sum, item) => sum + item.sold, 0),
    products: rows
  };
}

async function buildOrderDashboard({ days }) {
  ensureConfig(["partnerId", "partnerKey"]);
  const token = await getToken();
  const statuses = [
    "UNPAID",
    "READY_TO_SHIP",
    "PROCESSED",
    "SHIPPED",
    "COMPLETED",
    "IN_CANCEL",
    "CANCELLED"
  ];
  const orderRefs = await getOrdersByStatuses({ token, days, statuses });
  const orders = await getOrderDetails({ token, orderSns: orderRefs.map((order) => order.order_sn) });
  const statusCounts = {};
  let totalAmount = 0;
  let totalItems = 0;

  for (const order of orders) {
    statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    totalAmount += order.totalAmount;
    totalItems += order.itemCount;
  }

  const metrics = {
    totalOrders: orders.length,
    orderPreparation: countStatuses(statusCounts, ["READY_TO_SHIP", "PROCESSED"]),
    pendingShipment: countStatuses(statusCounts, ["READY_TO_SHIP"]),
    processed: countStatuses(statusCounts, ["PROCESSED"]),
    shipped: countStatuses(statusCounts, ["SHIPPED", "TO_CONFIRM_RECEIVE"]),
    completed: countStatuses(statusCounts, ["COMPLETED"]),
    cancelled: countStatuses(statusCounts, ["CANCELLED", "IN_CANCEL"]),
    unpaid: countStatuses(statusCounts, ["UNPAID"]),
    totalItems,
    totalAmount
  };

  orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return {
    generatedAt: new Date().toISOString(),
    shopId: String(token.shopId),
    days,
    metrics,
    statusCounts,
    orders: orders.slice(0, 100)
  };
}

async function buildPackingDashboard() {
  const records = await readPackingRecords();
  const today = new Date().toISOString().slice(0, 10);
  const todayRecords = records.filter((record) => (record.assignedAt || "").slice(0, 10) === today);
  const metrics = {
    total: records.filter((record) => record.status !== "REMOVED").length,
    inProgress: records.filter((record) => ["ASSIGNED", "PACKING"].includes(record.status)).length,
    completed: records.filter((record) => record.status === "COMPLETED").length,
    completedToday: todayRecords.filter((record) => record.status === "COMPLETED").length
  };

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    records: records
      .filter((record) => record.status !== "REMOVED")
      .sort((a, b) => new Date(b.completedAt || b.assignedAt || 0) - new Date(a.completedAt || a.assignedAt || 0))
      .slice(0, 200)
  };
}

async function lookupPackingOrder({ code, days }) {
  ensureConfig(["partnerId", "partnerKey"]);
  const value = cleanText(code).toLowerCase();
  if (!value) throw new Error("Scan or enter an order number or tracking number first.");

  const token = await getToken();
  const statuses = ["READY_TO_SHIP", "PROCESSED", "SHIPPED", "COMPLETED", "CANCELLED"];
  const orderRefs = await getOrdersByStatuses({ token, days, statuses });
  const orders = await getOrderDetails({ token, orderSns: orderRefs.map((order) => order.order_sn) });
  const match = orders.find((order) => {
    return [order.orderSn, ...order.packageNumbers].some((field) => String(field || "").toLowerCase() === value);
  }) || orders.find((order) => {
    return [order.orderSn, ...order.packageNumbers].some((field) => String(field || "").toLowerCase().includes(value));
  });

  if (!match) {
    return { found: false, code, message: "No matching recent order found. Try the Shopee order number if the tracking number is not available yet." };
  }

  return { found: true, order: match };
}

async function assignPackingRecord(payload) {
  const staff = cleanText(payload.staff);
  const code = cleanText(payload.code);
  const orderSn = cleanText(payload.orderSn || code);
  const managerAssigned = Boolean(payload.managerAssigned);
  if (!staff) throw new Error("Enter the staff name before assigning a packing task.");
  if (!code) throw new Error("Scan or enter the waybill/order code first.");

  const records = await readPackingRecords();
  const completedRecord = records.find((record) => {
    const sameOrder = String(record.orderSn || "").toLowerCase() === orderSn.toLowerCase();
    const sameCode = String(record.code || "").toLowerCase() === code.toLowerCase();
    const samePackage = (record.packageNumbers || []).some((packageNumber) => String(packageNumber).toLowerCase() === code.toLowerCase());
    return record.status === "COMPLETED" && (sameOrder || sameCode || samePackage);
  });
  if (completedRecord) {
    throw new Error(`This order was already packed by ${completedRecord.staff} at ${new Date(completedRecord.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  }

  const currentStaffTask = records.find((record) =>
    String(record.staff || "").toLowerCase() === staff.toLowerCase() && ["ASSIGNED", "PACKING"].includes(record.status)
  );
  if (currentStaffTask && currentStaffTask.code !== code) {
    throw new Error(`${staff} already has ${currentStaffTask.code} assigned. Complete, accept, decline, or remove it first.`);
  }

  const existing = records.find((record) => {
    if (!["ASSIGNED", "PACKING"].includes(record.status)) return false;
    const sameOrder = String(record.orderSn || "").toLowerCase() === orderSn.toLowerCase();
    const sameCode = String(record.code || "").toLowerCase() === code.toLowerCase();
    const samePackage = (record.packageNumbers || []).some((packageNumber) => String(packageNumber).toLowerCase() === code.toLowerCase());
    return sameOrder || sameCode || samePackage;
  });
  if (existing) {
    if (String(existing.staff || "").toLowerCase() !== staff.toLowerCase()) {
      throw new Error(`This order is already assigned to ${existing.staff}.`);
    }
    if (existing.status === "PACKING") {
      throw new Error(`This order is already being packed by ${existing.staff}.`);
    }
    existing.staff = staff;
    existing.orderSn = orderSn;
    existing.packageNumbers = Array.isArray(payload.packageNumbers) ? payload.packageNumbers.map(cleanText).filter(Boolean) : existing.packageNumbers || [];
    existing.items = Array.isArray(payload.items) ? payload.items : existing.items || [];
    existing.updatedAt = new Date().toISOString();
    await writePackingRecords(records);
    return { record: existing, records: await latestPackingRecords() };
  }

  const record = {
    id: crypto.randomUUID(),
    code,
    orderSn,
    packageNumbers: Array.isArray(payload.packageNumbers) ? payload.packageNumbers.map(cleanText).filter(Boolean) : [],
    items: Array.isArray(payload.items) ? payload.items : [],
    orderCreatedAt: cleanText(payload.orderCreatedAt || ""),
    buyer: cleanText(payload.buyer || ""),
    staff,
    status: managerAssigned ? "ASSIGNED" : "PACKING",
    assignedAt: new Date().toISOString(),
    acceptedAt: managerAssigned ? null : new Date().toISOString(),
    completedAt: null,
    photoUrl: "",
    photoUrls: [],
    notes: cleanText(payload.notes || "")
  };
  records.push(record);
  await writePackingRecords(records);
  return { record, records: await latestPackingRecords() };
}

async function acceptPackingRecord(payload) {
  const id = cleanText(payload.id);
  const staff = cleanText(payload.staff);
  if (!id) throw new Error("Choose an assigned packing task.");
  if (!staff) throw new Error("Enter the staff name before accepting a packing task.");

  const records = await readPackingRecords();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Packing record was not found.");
  if (record.status !== "ASSIGNED") throw new Error("Only assigned tasks can be accepted.");
  if (String(record.staff || "").toLowerCase() !== staff.toLowerCase()) {
    throw new Error(`This packing task is assigned to ${record.staff}.`);
  }

  const currentPacking = records.find((item) =>
    item.id !== id && String(item.staff || "").toLowerCase() === staff.toLowerCase() && item.status === "PACKING"
  );
  if (currentPacking) {
    throw new Error(`You already have ${currentPacking.code} in progress. Complete or remove it first.`);
  }

  record.status = "PACKING";
  record.acceptedAt = new Date().toISOString();
  record.updatedAt = record.acceptedAt;
  await writePackingRecords(records);
  return { record, records: await latestPackingRecords() };
}

async function declinePackingRecord(payload) {
  const id = cleanText(payload.id);
  const staff = cleanText(payload.staff);
  if (!id) throw new Error("Choose an assigned packing task.");
  if (!staff) throw new Error("Enter the staff name before declining a packing task.");

  const records = await readPackingRecords();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Packing record was not found.");
  if (record.status !== "ASSIGNED") throw new Error("Only assigned tasks can be declined.");
  if (String(record.staff || "").toLowerCase() !== staff.toLowerCase()) {
    throw new Error(`This packing task is assigned to ${record.staff}.`);
  }

  record.status = "REMOVED";
  record.declinedAt = new Date().toISOString();
  record.updatedAt = record.declinedAt;
  await writePackingRecords(records);
  return { record, records: await latestPackingRecords() };
}

async function removePackingRecord(payload) {
  const id = cleanText(payload.id);
  const staff = cleanText(payload.staff);
  if (!id) throw new Error("Choose a packing task to remove.");
  if (!staff) throw new Error("Enter the staff name before removing a packing task.");

  const records = await readPackingRecords();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Packing record was not found.");
  if (!["ASSIGNED", "PACKING"].includes(record.status)) throw new Error("Only active packing tasks can be removed.");
  if (String(record.staff || "").toLowerCase() !== staff.toLowerCase()) {
    throw new Error(`This packing task is assigned to ${record.staff}.`);
  }

  record.status = "REMOVED";
  record.removedAt = new Date().toISOString();
  record.updatedAt = record.removedAt;
  await writePackingRecords(records);
  return { record, records: await latestPackingRecords() };
}

async function completePackingRecord(payload) {
  const id = cleanText(payload.id);
  const staff = cleanText(payload.staff);
  if (!id) throw new Error("Choose a packing task to complete.");
  if (!staff) throw new Error("Enter the staff name before completing a packing task.");

  const records = await readPackingRecords();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Packing record was not found.");
  if (record.status !== "PACKING") throw new Error("Accept the assigned task before completing it.");
  if (String(record.staff || "").toLowerCase() !== staff.toLowerCase()) {
    throw new Error(`This packing task is assigned to ${record.staff}.`);
  }

  record.staff = staff;
  record.status = "COMPLETED";
  record.completedAt = new Date().toISOString();
  record.updatedAt = record.completedAt;
  const photoDataUrls = Array.isArray(payload.photoDataUrls)
    ? payload.photoDataUrls
    : (payload.photoDataUrl ? [payload.photoDataUrl] : []);
  if (photoDataUrls.length) {
    record.photoUrls = [];
    for (const dataUrl of photoDataUrls.slice(0, 5)) {
      record.photoUrls.push(await savePackingPhoto({ id, dataUrl: String(dataUrl) }));
    }
    record.photoUrl = record.photoUrls[0] || "";
  }
  await writePackingRecords(records);
  return { record, records: await latestPackingRecords() };
}

async function latestPackingRecords() {
  return (await buildPackingDashboard()).records;
}

async function readPackingRecords() {
  try {
    return JSON.parse(await fs.readFile(packingFile, "utf8"));
  } catch {
    return [];
  }
}

async function writePackingRecords(records) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(packingFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

async function readDashboardCache() {
  try {
    return JSON.parse(await fs.readFile(dashboardCacheFile, "utf8"));
  } catch {
    return {};
  }
}

async function writeDashboardCache() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dashboardCacheFile, `${JSON.stringify(dashboardCache, null, 2)}\n`, "utf8");
}

async function savePackingPhoto({ id, dataUrl }) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) throw new Error("Photo must be a PNG, JPG, or WebP image.");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const fileName = `${id}-${Date.now()}.${extension}`;
  await fs.mkdir(packingPhotoDir, { recursive: true });
  await fs.writeFile(path.join(packingPhotoDir, fileName), Buffer.from(match[2], "base64"));
  return `/packing-photos/${fileName}`;
}

async function getAllItemRefs({ token, statuses }) {
  const items = [];
  for (const status of statuses) {
    let offset = 0;
    let more = true;
    while (more) {
      const body = await shopeeGet({
        token,
        apiPath: "/api/v2/product/get_item_list",
        params: {
          offset,
          page_size: 50,
          item_status: status
        }
      });
      const response = body.response || {};
      const pageItems = response.item || [];
      items.push(...pageItems);
      more = Boolean(response.has_next_page || response.has_next);
      offset = Number(response.next_offset ?? offset + pageItems.length);
      if (!pageItems.length) more = false;
    }
  }

  const seen = new Set();
  return items.filter((item) => {
    const id = String(item.item_id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function getItemBaseInfo({ token, itemIds }) {
  const products = new Map();
  for (const chunk of chunks(itemIds, 50)) {
    const body = await shopeeGet({
      token,
      apiPath: "/api/v2/product/get_item_base_info",
      params: {
        item_id_list: chunk.join(","),
        need_tax_info: false,
        need_complaint_policy: false
      }
    });
    for (const item of body.response?.item_list || []) {
      products.set(String(item.item_id), item);
    }
  }
  return products;
}

async function getSoldQuantityByItem({ token, days }) {
  const sold = new Map();
  const now = unixNow();
  const from = now - days * 24 * 60 * 60;

  for (const [timeFrom, timeTo] of timeChunks(from, now, 14 * 24 * 60 * 60)) {
    let cursor = "";
    let more = true;
    while (more) {
      const body = await shopeeGet({
        token,
        apiPath: "/api/v2/order/get_order_list",
        params: {
          time_range_field: "create_time",
          time_from: timeFrom,
          time_to: timeTo,
          page_size: 100,
          cursor,
          order_status: "COMPLETED"
        }
      });
      const response = body.response || {};
      const snList = (response.order_list || []).map((order) => order.order_sn).filter(Boolean);
      await addOrderDetailsToSoldMap({ token, orderSns: snList, sold });
      more = Boolean(response.more);
      cursor = response.next_cursor || "";
      if (!cursor && more) more = false;
    }
  }

  return sold;
}

async function getOrdersByStatuses({ token, days, statuses }) {
  const seen = new Set();
  const orders = [];
  const now = unixNow();
  const from = now - days * 24 * 60 * 60;

  for (const status of statuses) {
    for (const [timeFrom, timeTo] of timeChunks(from, now, 14 * 24 * 60 * 60)) {
      let cursor = "";
      let more = true;
      while (more) {
        const body = await shopeeGet({
          token,
          apiPath: "/api/v2/order/get_order_list",
          params: {
            time_range_field: "create_time",
            time_from: timeFrom,
            time_to: timeTo,
            page_size: 100,
            cursor,
            order_status: status
          }
        });
        const response = body.response || {};
        for (const order of response.order_list || []) {
          if (!order.order_sn || seen.has(order.order_sn)) continue;
          seen.add(order.order_sn);
          orders.push({ order_sn: order.order_sn, booking_sn: order.booking_sn || "", status });
        }
        more = Boolean(response.more);
        cursor = response.next_cursor || "";
        if (!cursor && more) more = false;
      }
    }
  }

  return orders;
}

async function getOrderDetails({ token, orderSns }) {
  const orders = [];
  for (const chunk of chunks(orderSns, 50)) {
    if (!chunk.length) continue;
    const body = await shopeeGet({
      token,
      apiPath: "/api/v2/order/get_order_detail",
      params: {
        order_sn_list: chunk.join(","),
        response_optional_fields: [
          "buyer_user_id",
          "buyer_username",
          "estimated_shipping_fee",
          "recipient_address",
          "actual_shipping_fee",
          "goods_to_declare",
          "note",
          "note_update_time",
          "item_list",
          "pay_time",
          "dropshipper",
          "dropshipper_phone",
          "split_up",
          "buyer_cancel_reason",
          "cancel_by",
          "cancel_reason",
          "actual_shipping_fee_confirmed",
          "buyer_cpf_id",
          "fulfillment_flag",
          "pickup_done_time",
          "package_list",
          "shipping_carrier",
          "payment_method",
          "total_amount",
          "invoice_data",
          "checkout_shipping_carrier",
          "reverse_shipping_fee",
          "order_chargeable_weight_gram"
        ].join(",")
      }
    });
    for (const order of body.response?.order_list || []) {
      orders.push(normalizeOrder(order));
    }
  }
  return orders;
}

function normalizeOrder(order) {
  const itemCount = (order.item_list || []).reduce(
    (sum, item) => sum + Number(item.model_quantity_purchased || item.quantity_purchased || 0),
    0
  );
  const packageNumbers = (order.package_list || [])
    .map((pack) => pack.package_number)
    .filter(Boolean);
  return {
    orderSn: order.order_sn,
    status: order.order_status || "",
    buyer: order.buyer_username || "",
    itemCount,
    totalAmount: Number(order.total_amount || 0),
    currency: order.currency || "",
    shippingCarrier: order.shipping_carrier || order.checkout_shipping_carrier || "",
    paymentMethod: order.payment_method || "",
    createdAt: order.create_time ? new Date(order.create_time * 1000).toISOString() : null,
    payAt: order.pay_time ? new Date(order.pay_time * 1000).toISOString() : null,
    shipBy: order.ship_by_date ? new Date(order.ship_by_date * 1000).toISOString() : null,
    pickupDoneAt: order.pickup_done_time ? new Date(order.pickup_done_time * 1000).toISOString() : null,
    packageCount: Array.isArray(order.package_list) ? order.package_list.length : 0,
    packageNumbers,
    items: (order.item_list || []).map((item) => ({
      itemId: item.item_id,
      name: item.item_name,
      modelName: item.model_name,
      sku: item.item_sku || item.model_sku || "",
      quantity: Number(item.model_quantity_purchased || item.quantity_purchased || 0)
    }))
  };
}

function countStatuses(statusCounts, statuses) {
  return statuses.reduce((sum, status) => sum + Number(statusCounts[status] || 0), 0);
}

async function addOrderDetailsToSoldMap({ token, orderSns, sold }) {
  for (const chunk of chunks(orderSns, 50)) {
    if (!chunk.length) continue;
    const body = await shopeeGet({
      token,
      apiPath: "/api/v2/order/get_order_detail",
      params: {
        order_sn_list: chunk.join(","),
        response_optional_fields: "item_list,order_status"
      }
    });
    for (const order of body.response?.order_list || []) {
      for (const item of order.item_list || []) {
        const itemId = String(item.item_id);
        const quantity = Number(item.model_quantity_purchased || item.quantity_purchased || 0);
        sold.set(itemId, (sold.get(itemId) || 0) + quantity);
      }
    }
  }
}

async function shopeeGet({ token, apiPath, params = {} }) {
  const timestamp = unixNow();
  const sign = signShopee(apiPath, timestamp, token.accessToken, token.shopId);
  const url = new URL(apiPath, config.host);
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("access_token", token.accessToken);
  url.searchParams.set("shop_id", token.shopId);
  url.searchParams.set("sign", sign);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const body = await fetchShopeeJson(url, apiPath);
  if (body.error) {
    throw new Error(body.message || body.error || `Shopee request failed: ${apiPath}`);
  }
  return body;
}

async function exchangeCodeForToken({ code, shopId }) {
  ensureConfig(["partnerId", "partnerKey"]);
  const apiPath = "/api/v2/auth/token/get";
  const timestamp = unixNow();
  const sign = signShopee(apiPath, timestamp);
  const url = new URL(apiPath, config.host);
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  const body = await fetchShopeeJson(url, apiPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(config.partnerId)
    })
  });
  if (body.error) {
    throw new Error(body.message || body.error || "Could not exchange Shopee authorization code.");
  }
  const data = body.response || body;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    shopId: String(data.shop_id || shopId),
    expiresIn: data.expire_in || data.expires_in,
    savedAt: new Date().toISOString()
  };
}

async function fetchShopeeJson(url, label, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message || body.error || `Shopee request failed: ${label}`);
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Shopee request timed out: ${label}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) throw new Error("The uploaded photos are too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getToken() {
  const saved = await readSavedToken();
  const accessToken = saved.accessToken || process.env.SHOPEE_ACCESS_TOKEN;
  const refreshToken = saved.refreshToken || process.env.SHOPEE_REFRESH_TOKEN;
  const shopId = saved.shopId || config.shopId;
  if (!accessToken || !shopId) {
    throw new Error("Missing Shopee access token or shop ID. Fill .env or open /auth/start after configuring your Shopee callback URL.");
  }
  return { accessToken, refreshToken, shopId: String(shopId) };
}

async function readSavedToken() {
  try {
    return JSON.parse(await fs.readFile(tokenFile, "utf8"));
  } catch {
    return {};
  }
}

async function saveToken(token) {
  await fs.writeFile(tokenFile, `${JSON.stringify(token, null, 2)}\n`, "utf8");
}

async function getConfigStatus() {
  const saved = await readSavedToken();
  return {
    hasPartnerId: Boolean(config.partnerId),
    hasPartnerKey: Boolean(config.partnerKey),
    hasShopId: Boolean(saved.shopId || config.shopId),
    hasAccessToken: Boolean(saved.accessToken || process.env.SHOPEE_ACCESS_TOKEN),
    appBaseUrl: config.appBaseUrl
  };
}

function signShopee(apiPath, timestamp, accessToken = "", shopId = "") {
  const base = `${config.partnerId}${apiPath}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", config.partnerKey).update(base).digest("hex");
}

function sumStock(item) {
  if (Array.isArray(item.stock_info_v2?.seller_stock)) {
    return item.stock_info_v2.seller_stock.reduce((sum, stock) => sum + Number(stock.stock || 0), 0);
  }
  if (Array.isArray(item.model_list)) {
    return item.model_list.reduce((sum, model) => sum + sumStock(model), 0);
  }
  return Number(item.stock_info?.normal_stock || item.normal_stock || 0);
}

function firstPrice(item) {
  if (item.price_info?.length) return Number(item.price_info[0].current_price || item.price_info[0].original_price || 0);
  if (item.model_list?.length) return firstPrice(item.model_list[0]);
  return Number(item.price || 0);
}

function pickImage(item) {
  const image = item.image || {};
  if (Array.isArray(image.image_url_list) && image.image_url_list[0]) return image.image_url_list[0];
  if (Array.isArray(image.image_id_list) && image.image_id_list[0]) {
    return `https://cf.shopee.ph/file/${image.image_id_list[0]}`;
  }
  return "";
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, { error: "Not found" }, 404);
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath) });
    return res.end(data);
  } catch {
    return sendJson(res, { error: "Not found" }, 404);
  }
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderMessage(message) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopee Dashboard</title><body style="font-family:system-ui;margin:40px"><h1>Shopee Dashboard</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to dashboard</a></p></body>`;
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

function chunks(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function timeChunks(from, to, sizeSeconds) {
  const ranges = [];
  for (let start = from; start <= to; start += sizeSeconds) {
    ranges.push([start, Math.min(start + sizeSeconds - 1, to)]);
  }
  return ranges;
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function cleanText(value) {
  return String(value || "").trim();
}

function ensureConfig(keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}. Create a .env file from .env.example.`);
}

async function loadEnv(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional; the dashboard will show what's missing.
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
