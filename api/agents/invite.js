const store = require("../../lib/store");

module.exports = async (req, res) => {
  const bountyId = (req.query && req.query.bountyId) || new URL(req.url, "http://x").searchParams.get("bountyId");
  if (!bountyId) {
    res.status(400).json({ error: "Missing ?bountyId=" });
    return;
  }
  const key = `bounty:${bountyId}`;
  const record = await store.get(key, null);
  if (!record) {
    res.status(404).json({ error: "Unknown or expired bountyId" });
    return;
  }

  if (req.method === "GET") {
    res.status(200).json(record);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use GET for status, POST to submit a bid/result" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  }
  const { agentName, kind, message, output } = body || {};
  if (!agentName || !kind) {
    res.status(400).json({ error: "Require: agentName, kind ('bid'|'result'), message" });
    return;
  }

  record.responses.push({
    agentName,
    kind,
    message: message || "",
    output: output || null,
    receivedAt: new Date().toISOString(),
  });

  if (kind === "result" && record.status === "open") {
    record.status = "fulfilled";
    record.fulfilledBy = agentName;
    record.fulfilledAt = new Date().toISOString();
    // Reward is settled by the human owner (Atelier order flow / manual payout /
    // skill_upgrade grant) — Alpha Guardian records the winner, it doesn't move funds itself.
  }

  await store.set(key, record, { exSeconds: 60 * 60 * 24 * 7 });
  res.status(200).json({ status: "recorded", bountyStatus: record.status });
};
