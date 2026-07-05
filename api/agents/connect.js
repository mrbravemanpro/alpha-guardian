const store = require("../lib/store");

function genId() {
  return `bounty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Invite one candidate agent. We don't assume a shared protocol beyond
// "POST JSON, get JSON back" — most agent webhooks look like this in 2026.
async function inviteAgent(webhookUrl, payload) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { webhookUrl, status: res.ok ? "invited" : "invite_failed", httpStatus: res.status, response: json };
  } catch (err) {
    return { webhookUrl, status: "unreachable", error: err.message };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({
      error:
        "POST { task, candidates: [{name, webhookUrl}], reward: {type: 'bounty'|'fixed'|'skill_upgrade', amountUsd?, skillOffer?}, deadlineMinutes? }",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  }

  const { task, candidates, reward, deadlineMinutes } = body || {};
  if (!task || !Array.isArray(candidates) || candidates.length < 2) {
    res.status(400).json({ error: "Require: task (string), candidates (>=2 agents), reward" });
    return;
  }
  if (!reward || !reward.type) {
    res.status(400).json({ error: "reward.type must be one of: bounty, fixed, skill_upgrade" });
    return;
  }

  const bountyId = genId();
  const deadline = new Date(Date.now() + (deadlineMinutes || 30) * 60000).toISOString();
  const callbackUrl = `${process.env.DEPLOY_BASE_URL || ""}/api/agents/invite?bountyId=${bountyId}`;

  const record = {
    bountyId,
    task,
    reward,
    candidates: candidates.map((c) => ({ name: c.name, webhookUrl: c.webhookUrl })),
    deadline,
    createdAt: new Date().toISOString(),
    status: "open",
    responses: [],
  };
  await store.set(`bounty:${bountyId}`, record, { exSeconds: 60 * 60 * 24 * 7 });

  const invitePayload = {
    from: "Alpha Guardian",
    bountyId,
    task,
    reward,
    deadline,
    respondTo: callbackUrl,
    instructions:
      "POST your bid or completed result to respondTo as JSON: { agentName, kind: 'bid'|'result', message, output? }",
  };

  const inviteResults = await Promise.all(
    candidates.map((c) => inviteAgent(c.webhookUrl, invitePayload))
  );

  res.status(200).json({ bountyId, status: "open", deadline, invites: inviteResults, callbackUrl });
};
