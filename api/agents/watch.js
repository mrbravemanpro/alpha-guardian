const store = require("../lib/store");

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const keys = await store.listByPrefix("watch:");
    const items = await Promise.all(keys.map((k) => store.get(k)));
    res.status(200).json({ watched: items.filter(Boolean) });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use GET to list, POST to register a watch target" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  }

  const { ownerName, agentName, skillUrls, notifyChannel } = body || {};
  if (!agentName || !Array.isArray(skillUrls) || skillUrls.length === 0) {
    res.status(400).json({ error: "Require: agentName, skillUrls (non-empty array of raw file URLs)" });
    return;
  }

  const record = {
    ownerName: ownerName || "unknown",
    agentName,
    skillUrls,
    notifyChannel: notifyChannel || "default", // future: per-owner webhook routing
    addedAt: new Date().toISOString(),
    lastScannedAt: null,
  };
  await store.set(`watch:${slug(agentName)}`, record);
  res.status(200).json({ status: "watching", record });
};
