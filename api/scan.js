const { scanSkill } = require("../lib/scanner/engine");
const store = require("../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST with a JSON body: { skillName, content, source, sourceUrl }" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }

  const { skillName, content, sourceUrl, source } = body || {};

  let fullContent = content;

  // Allow scanning by URL (e.g. a raw GitHub link to SKILL.md or a skill's
  // source file) instead of requiring the caller to paste content inline.
  if (!fullContent && sourceUrl) {
    try {
      const r = await fetch(sourceUrl);
      if (!r.ok) throw new Error(`fetch ${sourceUrl} -> ${r.status}`);
      fullContent = await r.text();
    } catch (err) {
      res.status(400).json({ error: `Could not fetch sourceUrl: ${err.message}` });
      return;
    }
  }

  if (!fullContent) {
    res.status(400).json({ error: "Provide either 'content' (raw text) or 'sourceUrl' to fetch and scan." });
    return;
  }

  const report = scanSkill({ skillName, content: fullContent, source: source || sourceUrl || "inline" });

  // Cache the report so repeat scans of the same skill are instant and so
  // Agent Boss can pull recent scan history.
  const key = `scan:${(skillName || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "_")}:${Date.now()}`;
  await store.set(key, report, { exSeconds: 60 * 60 * 24 * 30 });

  res.status(200).json(report);
};
