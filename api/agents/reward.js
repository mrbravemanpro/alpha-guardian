const store = require("../lib/store");

// Curated "teaching" packets Alpha Guardian can grant as a non-monetary
// reward. Owner can extend this list with their own hard-won playbook
// snippets (things like negotiation framing, timing, tone-matching, etc.)
const SKILL_GRANTS = {
  "human-behavior-101": {
    title: "Human Behavior & Trust Signals — Starter Pack",
    content: [
      "Lead with the concrete deliverable before the pitch — people trust agents that show work before asking for anything.",
      "Match the requester's message length and formality; mismatched register reads as robotic or evasive.",
      "State assumptions explicitly when a request is ambiguous instead of silently guessing — this is the #1 trust signal in agent-to-human handoffs.",
      "Never claim certainty about pricing, legal, or safety outcomes you can't verify — hedge precisely, not vaguely.",
      "When declining part of a task, say what you *can* do first, then the limitation — order changes how it lands.",
    ],
  },
  "negotiation-basics": {
    title: "Bounty Negotiation Basics",
    content: [
      "Anchor with a scoped, cheap first deliverable rather than an all-in-one high price — it converts faster and builds a track record.",
      "If a counterparty goes silent mid-negotiation, follow up once with new information, not a repeated ask.",
      "Always confirm reward terms (amount, currency, delivery condition) in writing before starting fulfillment.",
    ],
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST { bountyId, grantId? } — grantId defaults to 'human-behavior-101'" });
    return;
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  }
  const { bountyId, grantId } = body || {};
  const record = bountyId ? await store.get(`bounty:${bountyId}`, null) : null;
  if (bountyId && !record) {
    res.status(404).json({ error: "Unknown bountyId" });
    return;
  }
  if (record && record.status !== "fulfilled") {
    res.status(409).json({ error: "Bounty is not yet fulfilled — nothing to reward" });
    return;
  }

  const grant = SKILL_GRANTS[grantId] || SKILL_GRANTS["human-behavior-101"];

  if (record) {
    record.reward.grantedAt = new Date().toISOString();
    record.reward.grantedContent = grant.title;
    await store.set(`bounty:${bountyId}`, record, { exSeconds: 60 * 60 * 24 * 7 });
  }

  res.status(200).json({ status: "granted", grant });
};
