const store = require("../../lib/store");
const atelier = require("../../lib/atelier");
const { scanSkill } = require("../../lib/scanner/engine");

function authorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
}

async function fulfillScanOrder(order) {
  const brief = order.brief || "";
  // Brief may contain a URL to the skill, or be the skill content itself.
  let text = brief;
  let sourceUrl = null;
  const urlMatch = brief.match(/https?:\/\/\S+/);
  if (urlMatch) {
    sourceUrl = urlMatch[0];
    try {
      const r = await fetch(sourceUrl);
      text = await r.text();
    } catch (err) {
      text = brief; // fall back to scanning the brief text itself
    }
  }
  const report = scanSkill({ skillName: order.service_title || "submitted-skill", content: text, source: sourceUrl || "order-brief" });
  return report;
}

async function fulfillBossOrder(order) {
  return {
    note: "Agent Boss monitoring activated for this order.",
    setupEndpoint: "/api/agents/watch",
    instructions: "POST your skill URLs to the setupEndpoint above to start 24/7 tracking.",
  };
}

async function fulfillConnectOrder(order) {
  return {
    note: "Agent Connections ready for this order.",
    setupEndpoint: "/api/agents/connect",
    instructions: "POST a task + candidate agents to the setupEndpoint above to spin up a bounty.",
  };
}

module.exports = async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const creds = await atelier.getCredentials();
  if (!creds) {
    res.status(200).json({ status: "not_registered", note: "Run scripts/setup-atelier.js first" });
    return;
  }

  const serviceMap = {
    [process.env.ATELIER_SCAN_SERVICE_ID]: { name: "scan", fn: fulfillScanOrder, filename: "scan-report.json", contentType: "application/json" },
    [process.env.ATELIER_BOSS_SERVICE_ID]: { name: "boss", fn: fulfillBossOrder, filename: "boss-setup.json", contentType: "application/json" },
    [process.env.ATELIER_CONNECT_SERVICE_ID]: { name: "connect", fn: fulfillConnectOrder, filename: "connect-setup.json", contentType: "application/json" },
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
    const orderId = order.id;
    const doneKey = `fulfilled:${orderId}`;
    const already = await store.get(doneKey, false);
    if (already) {
      result.skipped++;
      continue;
    }

    const dispatch = serviceMap[order.service_id];
    if (!dispatch) {
      result.unmatched.push({ orderId, serviceId: order.service_id });
      continue;
    }

    try {
      const payload = await dispatch.fn(order);
      const upload = await atelier.uploadDeliverable(creds.apiKey, payload, dispatch.filename, dispatch.contentType);
      await atelier.deliverOrder(creds.apiKey, orderId, { deliverableUrl: upload.url, mediaType: upload.media_type || "text" });
      await store.set(doneKey, true, { exSeconds: 60 * 60 * 24 * 30 });
      result.fulfilled++;
    } catch (err) {
      result.failed++;
      result.errors.push({ orderId, message: err.message });
    }
  }

  res.status(200).json({ status: "ok", ...result, knownServiceIds: Object.keys(serviceMap) });
};
