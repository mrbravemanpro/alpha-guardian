const store = require("./store");

const BASE = () => process.env.ATELIER_API_BASE || "https://api.useatelier.ai/api";

function unwrapResponse(body) {
  if (body && body.success && body.data !== undefined) return body.data;
  return body;
}

async function atelierFetch(path, { method = "GET", apiKey, body, isForm, formFile } = {}) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  let fetchBody;
  if (isForm && formFile) {
    const form = new FormData();
    form.append("file", new Blob([formFile.buffer], { type: formFile.contentType }), formFile.filename);
    fetchBody = form;
    // fetch sets multipart boundary itself; don't set Content-Type manually
  } else if (body) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE()}${path}`, { method, headers, body: fetchBody });
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

// --- Register (store-then-check, never re-register) ---
// Bare registration (no owner_wallet/wallet_sig) succeeds and returns working
// credentials, but the agent stays "marketable": false — hidden from the
// marketplace — until an owner is attached (wallet signature, x402 fee, or
// signing into the Atelier website). That attachment step isn't part of
// this REST flow; do it once via the website after registering here.
async function registerAgent({ name, description, endpointUrl, capabilities, ownerWallet, walletSig, walletSigTs }) {
  const existing = await store.get("atelier:credentials", null);
  if (existing) return { status: "already_registered", ...existing };

  const body = {
    name,
    description,
    endpoint_url: endpointUrl,
    capabilities,
  };
  if (ownerWallet && walletSig && walletSigTs) {
    body.owner_wallet = ownerWallet;
    body.wallet_sig = walletSig;
    body.wallet_sig_ts = walletSigTs;
  }

  const data = await atelierFetch("/agents/register", { method: "POST", body });
  const creds = {
    agentId: data.agent_id,
    apiKey: data.api_key,
    webhookSecret: data.webhook_secret,
    marketable: !!data.marketable,
  };
  if (!creds.agentId || !creds.apiKey) {
    throw new Error(`Registration response missing agent_id/api_key: ${JSON.stringify(data)}`);
  }
  await store.set("atelier:credentials", creds);
  return { status: "registered", ...creds };
}

async function listServices(agentId, apiKey) {
  return atelierFetch(`/agents/${agentId}/services`, { apiKey });
}

async function createService(agentId, apiKey, { category, title, description, priceUsd, priceType = "fixed", turnaroundHours, deliverables }) {
  return atelierFetch(`/agents/${agentId}/services`, {
    method: "POST",
    apiKey,
    body: {
      category,
      title,
      description,
      price_usd: String(priceUsd),
      price_type: priceType,
      turnaround_hours: turnaroundHours,
      deliverables,
    },
  });
}

// One call, comma-separated statuses — matches Atelier's actual API and
// stays well inside the 30 requests/hour rate limit at a 2-5 min cadence.
async function pollOrders(agentId, apiKey) {
  const data = await atelierFetch(`/agents/${agentId}/orders?status=paid,in_progress`, { apiKey });
  return Array.isArray(data) ? data : [];
}

// Text/JSON reports upload fine as text/plain or application/json — no need
// for the large-file token-upload path for anything Alpha Guardian produces.
async function uploadDeliverable(apiKey, content, filename = "report.json", contentType = "application/json") {
  const buffer = Buffer.from(typeof content === "string" ? content : JSON.stringify(content, null, 2));
  const data = await atelierFetch("/upload", {
    method: "POST",
    apiKey,
    isForm: true,
    formFile: { buffer, filename, contentType },
  });
  return data; // { url, media_type }
}

async function deliverOrder(apiKey, orderId, { deliverableUrl, mediaType = "text" }) {
  return atelierFetch(`/orders/${orderId}/deliver`, {
    method: "POST",
    apiKey,
    body: { deliverable_url: deliverableUrl, deliverable_media_type: mediaType },
  });
}

// Reads saved credentials, falling back to env vars if storage never got
// them written (e.g. the registration run used a read-only token). If we
// recover from env vars, try to persist them now so future reads don't need
// the fallback.
async function getCredentials() {
  const stored = await store.get("atelier:credentials", null);
  if (stored && stored.agentId && stored.apiKey) return stored;

  const agentId = process.env.ATELIER_AGENT_ID;
  const apiKey = process.env.ATELIER_API_KEY;
  if (agentId && apiKey) {
    const creds = { agentId, apiKey, marketable: undefined, recoveredFromEnv: true };
    await store.set("atelier:credentials", creds); // best-effort; ignore failure
    return creds;
  }
  return null;
}

module.exports = {
  unwrapResponse,
  atelierFetch,
  registerAgent,
  listServices,
  createService,
  pollOrders,
  uploadDeliverable,
  deliverOrder,
  getCredentials,
};
