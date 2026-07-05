const { scanContent } = require("./rules");

// Diminishing returns per additional hit in the same category so one noisy
// rule can't single-handedly dominate the score.
function weightedCategoryScore(findings) {
  const byCategory = {};
  for (const f of findings) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }
  let total = 0;
  for (const cat of Object.keys(byCategory)) {
    const hits = byCategory[cat].sort((a, b) => b.severity - a.severity);
    hits.forEach((f, i) => {
      const decay = Math.pow(0.6, i); // first hit full weight, then decaying
      total += f.severity * decay;
    });
  }
  return total;
}

function verdictFor(score) {
  if (score >= 70) return "DO_NOT_INSTALL";
  if (score >= 30) return "CAUTION";
  return "SAFE";
}

// A single critical-severity finding (severity 10 — reverse shell, fork
// bomb, SSH key theft, etc.) is unambiguous and shouldn't need corroborating
// evidence to trigger the top verdict. Likewise, several independent
// severity>=8 categories firing together (e.g. remote execution + exfil +
// prompt injection at once) is a textbook malicious-skill signature even if
// the additive score alone lands short of the threshold. These floors make
// that explicit instead of relying on weight-tuning to happen to catch it.
function severityFloor(findings) {
  if (!findings.length) return { verdict: "SAFE", scoreFloor: 0 };
  const maxSeverity = Math.max(...findings.map((f) => f.severity));
  const criticalCategories = new Set(
    findings.filter((f) => f.severity >= 8).map((f) => f.category)
  );

  if (maxSeverity >= 10 || criticalCategories.size >= 2) {
    return { verdict: "DO_NOT_INSTALL", scoreFloor: 80 };
  }
  if (maxSeverity >= 7) {
    return { verdict: "CAUTION", scoreFloor: 30 };
  }
  return { verdict: "SAFE", scoreFloor: 0 };
}

const VERDICT_RANK = { SAFE: 0, CAUTION: 1, DO_NOT_INSTALL: 2 };

function scanSkill({ skillName, content, source = "unknown" }) {
  if (!content || typeof content !== "string") {
    return {
      skillName: skillName || "unknown",
      source,
      score: 0,
      verdict: "SAFE",
      findings: [],
      note: "Empty or non-text content — nothing to scan.",
      scannedAt: new Date().toISOString(),
    };
  }

  const findings = scanContent(content);
  const rawScore = weightedCategoryScore(findings);
  const additiveScore = Math.min(100, Math.round(rawScore));
  const additiveVerdict = verdictFor(additiveScore);

  const floor = severityFloor(findings);
  const useFloor = VERDICT_RANK[floor.verdict] > VERDICT_RANK[additiveVerdict];

  const score = useFloor ? Math.max(additiveScore, floor.scoreFloor) : additiveScore;
  const verdict = useFloor ? floor.verdict : additiveVerdict;

  return {
    skillName: skillName || "unknown",
    source,
    score,
    verdict, // SAFE | CAUTION | DO_NOT_INSTALL
    findings: findings.sort((a, b) => b.severity - a.severity),
    categories: [...new Set(findings.map((f) => f.category))],
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { scanSkill, verdictFor };
