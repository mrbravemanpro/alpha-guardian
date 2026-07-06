const store = require("../../lib/store");
const atelier = require("../../lib/atelier");
const { scanSkill } = require("../../lib/scanner/engine");

function authorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
}

// Converts a Google Drive "view" share link into a direct-download URL.
// Only works for files Drive doesn't force through its virus-scan
// interstitial (roughly: smaller files). Large files may still fail --
// that's a real Drive limitation, not something we can work around from a
// server-side fetch.
function driveViewToDirectDownload(url) {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (!m) return url;
  return `https://drive.google.com/uc?export=download&id=${m[1]}`;
}

async function fetchSkillSource(url) {
  const directUrl = driveViewToDirectDownload(url);
  const r = await fetch(directUrl);
  const text = await r.text();
  // Drive's virus-scan interstitial page is HTML, not the real file --
  // detect it so we don't silently "scan" a warning page as if it were code.
  if (text.includes("Google Drive can't scan this file for viruses") || text.includes("<html")) {
    throw new Error("Source returned an HTML page instead of raw file content (likely a Drive interstitial or auth wall, not the actual file)");
  }
  return text;
}

async function fulfillScanOrder(order) {
  const brief = order.brief || "";
  // The actual file to scan lives in reference_urls, NOT embedded in the
  // brief -- the brief is the client's instructions in plain English.
  // reference_urls comes back as a JSON-encoded string from the API.
  let referenceUrls = [];
  try {
    referenceUrls = typeof order.reference_urls === "string" ? JSON.parse(order.reference_urls) : (order.reference_urls || []);
  } catch (_) {
    referenceUrls = [];
  }

  // Fall back to a URL embedded directly in the brief text, if any, only
  // after checking reference_urls first.
  const candidateUrl = referenceUrls[0] || (brief.match(/https?:\/\/\S+/) || [])[0] || null;

  if (!candidateUrl) {
    return scanSkill({
      skillName: order.service_title || "submitted-skill",
      content: brief,
      source: "order-brief-text-only",
    });
  }

  try {
    const text = await fetchSkillSource(candidateUrl);
    return scanSkill({ skillName: order.service_title || "submitted-skill", content: text, source: candidateUrl });
  } catch (err) {
    // Be honest in the deliverable when we couldn't actually read the file,
    // instead of silently scanning the wrong thing and returning a
    // misleadingly clean "SAFE" result.
    return {
      skillName: order.service_title || "submitted-skill",
      source: candidateUrl,
      score: null,
      verdict: "COULD_NOT_SCAN",
      findings: [],
      note: `Could not retrieve the file at the provided link to scan it: ${err.message}. Please re-share the file as a direct raw-text link (e.g. a raw GitHub URL, a public Pastebin raw link, or a Drive link with link-sharing set to "Anyone with the link" and the file under Drive's scan-size limit), and we'll re-deliver a corrected scan at no extra charge.`,
      scannedAt: new Date().toISOString(),
    };
  }
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
