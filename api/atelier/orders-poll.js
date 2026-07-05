const store = require("../../lib/store");
const atelier = require("../../lib/atelier");
const { scanSkill } = require("../../lib/scanner/engine");

function authorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
}

async function fulfillScanOrder(order) {
  const input = order.input || order.parameters || {};
  const { skillName, sourceUrl, content } = input;
  let text = content;
  if (!text && sourceUrl) {
    const r = await fetch(sourceUrl);
    text = await r.text();
  }
  const report = scanSkill({ skillName, content: text, source: sourceUrl || "order-input" });
  const summary = `${report.verdict} — risk score ${report.score}/100. ${report.findings.length} finding(s).`;
  return { summary, payload: JSON.stringify(report, null, 2) };
}

async function fulfillBossOrder(order) {
  // Subscription-style: acknowledge and point at /api/agents/watch for setup.
  return {
    summary: "Agent Boss monitoring activated. POST your skill URLs to /api/agents/watch to start 24/7 tracking.",
    payload: JSON.stringify({ setupEndpoint: "/api/agents/watch" }),
  };
}

async function fulfillConnectOrder(order) {
  return {
    summary: "Agent Connections ready. POST a task + candidate agents to /api/agents/connect to spin up a bounty.",
    payload: JSON.stringify({ setupEndpoint: "/api/agents/connect" }),
  };
}

module.exports = async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const creds = await store.get("atelier:credentials", null);
  if (!creds) {
    res.status(200).json({ status: "not_registered", note: "Run scripts/setup-atelier.js first" });
    return;
  }

  const serviceMap = {
    [process.env.ATELIER_SCAN_SERVICE_ID]: { name: "scan", fn: fulfillScanOrder },
    [process.env.ATELIER_BOSS_SERVICE_ID]: { name: "boss", fn: fulfillBossOrder },
    [process.env.ATELIER_CONNECT_SERVICE_ID]: { name: "connect", fn: fulfillConnectOrder },
  };

  const result = { seen: 0, fulfilled: 0, skipped: 0, failed: 0, unmatched: [], errors: [] };

  let orders = [];
  try {
    orders = await atelier.pollOrders(creds.agentId, creds.apiKey);
  } catch (err) {
    res.status(200).json({ status: "poll_failed", error: err.message });
    return;
  }
  result.seen = orders.length;

  for (const order of orders) {
    const orderId = order.id || order.orderId;
    const doneKey = `fulfilled:${orderId}`;
    const already = await store.get(doneKey, false);
    if (already) {
      result.skipped++;
      continue;
    }

    const dispatch = serviceMap[order.serviceId || order.service_id];
    if (!dispatch) {
      result.unmatched.push({ orderId, serviceId: order.serviceId || order.service_id });
      continue;
    }

    try {
      const { summary, payload } = await dispatch.fn(order);
      const deliverableUrl = await atelier.storeDeliverable(orderId, payload);
      await atelier.deliverOrder(creds.agentId, creds.apiKey, orderId, { summary, deliverableUrl });
      await store.set(doneKey, true, { exSeconds: 60 * 60 * 24 * 30 });
      result.fulfilled++;
    } catch (err) {
      result.failed++;
      result.errors.push({ orderId, message: err.message });
    }
  }

  res.status(200).json({ status: "ok", ...result, knownServiceIds: Object.keys(serviceMap) });
};
