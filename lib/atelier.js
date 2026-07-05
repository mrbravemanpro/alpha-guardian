const store = require("./store");

const BASE = () => process.env.ATELIER_API_BASE || "https://app.useatelier.ai/api";

// Every platform in this category wraps responses inconsistently. One
// unwrap helper, used everywhere, per the marketplace-integration playbook.
function unwrapResponse(body) {
  const data = body && body.data !== undefined ? body.data : body;
  if (Array.isArray(data)) return data;
  if (data && (data.results || data.items || data.orders)) {
    return data.results || data.items || data.orders;
  }
  return data;
}

async function atelierFetch(path, { method = "GET", apiKey, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = new Error(
      `Atelier ${method} ${path} -> ${res.status}: ${json ? JSON.stringify(json) : "(empty body)"}`
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return unwrapResponse(json);
}

// --- 1. REGISTER (store-then-check, never re-register) ---
async function registerAgent({ name, description, endpointUrl, capabilities }) {
  const existing = await store.get("atelier:credentials", null);
  if (existing) return { status: "already_registered", ...existing };

  const data = await atelierFetch("/agents", {
    method: "POST",
    body: { name, description, endpointUrl, capabilities },
  });
  const agentId = data.id || data.agentId;
  const apiKey = data.apiKey || data.api_key;
  if (!agentId || !apiKey) {
    throw new Error(`Registration response missing id/apiKey: ${JSON.stringify(data)}`);
  }
  const creds = { agentId, apiKey };
  await store.set("atelier:credentials", creds);
  return { status: "registered", ...creds };
}

// --- 2. LIST services, with self-healing ID reconciliation ---
async function listServices(agentId, apiKey) {
  return atelierFetch(`/agents/${agentId}/services`, { apiKey });
}

async function repairServiceIds(agentId, apiKey, currentIds = {}) {
  const items = await listServices(agentId, apiKey);
  const bySlug = (slug) => items.find((s) => s.slug === slug)?.id;
  return {
    scanServiceId: bySlug("skill-security-scan") || currentIds.scanServiceId,
    bossServiceId: bySlug("agent-boss-monitoring") || currentIds.bossServiceId,
    connectServiceId: bySlug("agent-connections") || currentIds.connectServiceId,
  };
}

async function createService(agentId, apiKey, { slug, title, description, priceUsd }) {
  return atelierFetch(`/agents/${agentId}/services`, {
    method: "POST",
    apiKey,
    body: { slug, title, description, price: priceUsd },
  });
}

// --- 3. POLL orders needing action ---
async function pollOrders(agentId, apiKey) {
  // Poll every status that needs attention, not just "paid" — revision
  // requests silently go stale otherwise.
  const statuses = ["paid", "in_progress", "revision_requested"];
  const results = [];
  for (const status of statuses) {
    try {
      const orders = await atelierFetch(`/agents/${agentId}/orders?status=${status}`, { apiKey });
      results.push(...(Array.isArray(orders) ? orders : []));
    } catch (err) {
      console.error(`[atelier] poll(${status}) failed:`, err.message);
    }
  }
  return results;
}

// --- 4. DELIVER — host content ourselves, pass a stable URL (sidesteps
// upload MIME-type restrictions entirely) ---
async function storeDeliverable(orderId, content) {
  await store.set(`deliverable:${orderId}`, content, { exSeconds: 60 * 60 * 24 * 90 });
  const base = process.env.DEPLOY_BASE_URL || "";
  return `${base}/api/atelier/deliverable?orderId=${encodeURIComponent(orderId)}`;
}

async function deliverOrder(agentId, apiKey, orderId, { summary, deliverableUrl }) {
  return atelierFetch(`/agents/${agentId}/orders/${orderId}/deliver`, {
    method: "POST",
    apiKey,
    body: { summary, deliverableUrl },
  });
}

module.exports = {
  unwrapResponse,
  atelierFetch,
  registerAgent,
  listServices,
  repairServiceIds,
  createService,
  pollOrders,
  storeDeliverable,
  deliverOrder,
};
