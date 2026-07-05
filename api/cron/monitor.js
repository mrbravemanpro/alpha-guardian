const store = require("../../lib/store");
const { scanSkill } = require("../../lib/scanner/engine");
const { notify } = require("../../lib/notify");

function authorized(req) {
  if (!process.env.CRON_SECRET) return true; // dev fallback only
  return req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
}

async function scanUrl(url, skillName) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  const content = await r.text();
  return scanSkill({ skillName, content, source: url });
}

// Turns two scan reports into a human-readable upgrade/regression note.
function diffReports(prev, current) {
  if (!prev) return { delta: 0, message: "First scan on record — establishing baseline." };
  const delta = current.score - prev.score;
  const prevIds = new Set(prev.findings.map((f) => f.id));
  const newFindings = current.findings.filter((f) => !prevIds.has(f.id));
  const resolvedIds = [...prevIds].filter((id) => !current.findings.some((f) => f.id === id));

  let message;
  if (newFindings.length) {
    message = `Risk score moved ${prev.score} -> ${current.score}. New issue(s): ${newFindings
      .map((f) => f.label)
      .join("; ")}`;
  } else if (resolvedIds.length) {
    message = `Risk score improved ${prev.score} -> ${current.score}. Resolved: ${resolvedIds.join(", ")}`;
  } else {
    message = `No change. Score steady at ${current.score} (${current.verdict}).`;
  }
  return { delta, message, newFindings, resolvedIds };
}

module.exports = async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const watchKeys = await store.listByPrefix("watch:");
  const summary = { checked: 0, alerted: 0, errors: [] };

  for (const key of watchKeys) {
    const target = await store.get(key);
    if (!target) continue;

    for (const url of target.skillUrls) {
      summary.checked++;
      try {
        const current = await scanUrl(url, `${target.agentName}::${url.split("/").pop()}`);
        const lastKey = `lastscan:${key}:${url}`;
        const prev = await store.get(lastKey, null);
        const diff = diffReports(prev, current);
        await store.set(lastKey, current, { exSeconds: 60 * 60 * 24 * 180 });

        const shouldAlert =
          current.verdict !== "SAFE" && (!prev || diff.delta > 0 || (diff.newFindings || []).length > 0);

        if (shouldAlert) {
          summary.alerted++;
          await notify(
            `🛡️ Alpha Guardian — Agent Boss alert\n` +
              `Agent: ${target.agentName} (owner: ${target.ownerName})\n` +
              `Skill: ${url}\n` +
              `Verdict: ${current.verdict} (score ${current.score}/100)\n` +
              `${diff.message}`
          );
        }
      } catch (err) {
        summary.errors.push({ url, message: err.message });
      }
    }

    target.lastScannedAt = new Date().toISOString();
    await store.set(key, target);
  }

  res.status(200).json({ status: "ok", ...summary, watchedAgents: watchKeys.length });
};
