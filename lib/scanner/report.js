// Renders a scanSkill() result into a polished, human-readable Markdown
// report. Every line here maps to something the engine actually checks --
// no simulated sandbox execution, no fabricated reputation data, no attack
// simulation stats. Static pattern analysis, presented well, honestly.

const CATEGORY_LABELS = {
  destructive_shell: "Destructive shell commands",
  remote_execution: "Remote code execution / pipe-to-shell installers",
  credential_theft: "Credential & secret theft",
  exfiltration: "Data exfiltration endpoints",
  persistence: "Persistence & backdoor mechanisms",
  cryptomining: "Cryptomining",
  prompt_injection: "Prompt injection targeting the host agent",
  scope_overreach: "Filesystem / scope overreach",
  supply_chain: "Supply-chain / dependency risk",
};
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

function verdictBanner(verdict, score) {
  if (verdict === "SAFE") return `## 🟢 SAFE — ${score}/100\nNo known-bad patterns detected across any checked category.`;
  if (verdict === "CAUTION") return `## 🟡 CAUTION — ${score}/100\nOne or more findings warrant a human look before installing.`;
  if (verdict === "DO_NOT_INSTALL") return `## 🔴 DO NOT INSTALL — ${score}/100\nCritical-severity pattern(s) detected. Do not install without remediation.`;
  return `## ⚪ COULD NOT SCAN\n${score === null ? "" : score}`;
}

function severityIcon(sev) {
  if (sev >= 8) return "🔴";
  if (sev >= 5) return "🟠";
  return "🟡";
}

function renderReport(report) {
  const flaggedCategories = new Set(report.categories || []);
  const lines = [];

  lines.push(`# 🛡️ Alpha Guardian — Skill Security Report`);
  lines.push("");
  lines.push(`**Skill:** ${report.skillName}`);
  lines.push(`**Source:** ${report.source}`);
  lines.push(`**Scanned:** ${report.scannedAt}`);
  lines.push("");
  lines.push(verdictBanner(report.verdict, report.score));
  lines.push("");

  if (report.note) {
    lines.push(`> ${report.note}`);
    lines.push("");
  }

  lines.push(`## Threat Categories Checked`);
  lines.push("");
  lines.push(`| Category | Result |`);
  lines.push(`|---|---|`);
  for (const cat of ALL_CATEGORIES) {
    const flagged = flaggedCategories.has(cat);
    lines.push(`| ${CATEGORY_LABELS[cat]} | ${flagged ? "🔴 Flagged" : "✅ Clear"} |`);
  }
  lines.push("");

  if (report.findings && report.findings.length) {
    lines.push(`## Findings (${report.findings.length})`);
    lines.push("");
    for (const f of report.findings) {
      lines.push(`### ${severityIcon(f.severity)} ${f.label}`);
      lines.push(`- **Category:** ${CATEGORY_LABELS[f.category] || f.category}`);
      lines.push(`- **Severity:** ${f.severity}/10`);
      lines.push(`- **Occurrences:** ${f.occurrences}`);
      lines.push(`- **Matched text:** \`${f.sample}\``);
      lines.push("");
    }
  } else if (report.verdict === "SAFE") {
    lines.push(`## Findings`);
    lines.push("");
    lines.push(`None. This is a static pattern scan, not a runtime sandbox -- it checks the skill's source text against ${ALL_CATEGORIES.length} known-risk categories (see table above). A clean result means no known-bad patterns were found in the text; it is not a guarantee against novel or heavily obfuscated threats.`);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`*Alpha Guardian performs static pattern analysis on skill source text. It does not execute the skill in a sandbox and does not monitor live network traffic. For high-stakes deployments, pair this scan with manual review.*`);

  return lines.join("\n");
}

module.exports = { renderReport };
