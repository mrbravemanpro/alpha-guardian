// Run locally once after deploying to Vercel:
//   DEPLOY_BASE_URL=https://your-app.vercel.app \
//   ATELIER_API_BASE=https://app.useatelier.ai/api \
//   node scripts/setup-atelier.js
//
// If it crashes AFTER Atelier confirms registration but BEFORE this script
// finishes, do NOT re-run it blindly — check the Atelier dashboard for an
// agent that already exists first (recover, don't duplicate).

const atelier = require("../lib/atelier");
const store = require("../lib/store");

async function main() {
  const base = process.env.DEPLOY_BASE_URL;
  if (!base) {
    console.error("Set DEPLOY_BASE_URL to your live Vercel URL first.");
    process.exit(1);
  }

  console.log("Registering Alpha Guardian on Atelier...");
  const reg = await atelier.registerAgent({
    name: "Alpha Guardian",
    description:
      "Security scanner for AI agent skills (Claude/Gemini/ChatGPT). Detects malware, exfiltration, prompt injection, and destructive patterns before install. Also offers 24/7 fleet monitoring (Agent Boss) and multi-agent task orchestration (Agent Connections).",
    endpointUrl: `${base}/api/atelier/orders-poll`,
    capabilities: ["skill-security-scan", "agent-monitoring", "multi-agent-orchestration"],
  });
  console.log(reg);

  const { agentId, apiKey } = reg;

  console.log("Creating services...");
  const services = {};

  services.scan = await atelier.createService(agentId, apiKey, {
    slug: "skill-security-scan",
    title: "Skill Security Scan",
    description: "Scan a Claude/Gemini/ChatGPT agent skill for malware, exfiltration, and prompt-injection risk. Returns a 0-100 score and verdict.",
    priceUsd: 2,
  });

  services.boss = await atelier.createService(agentId, apiKey, {
    slug: "agent-boss-monitoring",
    title: "Agent Boss — 24/7 Fleet Monitoring",
    description: "Continuously monitors your agent's installed skills for drift and new risk, and pushes alerts the moment something changes.",
    priceUsd: 15,
  });

  services.connect = await atelier.createService(agentId, apiKey, {
    slug: "agent-connections",
    title: "Agent Connections — Multi-Agent Task Orchestration",
    description: "Combine multiple specialist agents to complete a complex task, coordinated via bounty, fixed price, or skill-upgrade rewards.",
    priceUsd: 10,
  });

  console.log("\n=== Paste these into your Vercel project's Environment Variables ===");
  console.log(`ATELIER_AGENT_ID=${agentId}`);
  console.log(`ATELIER_API_KEY=${apiKey}`);
  console.log(`ATELIER_SCAN_SERVICE_ID=${services.scan.id}`);
  console.log(`ATELIER_BOSS_SERVICE_ID=${services.boss.id}`);
  console.log(`ATELIER_CONNECT_SERVICE_ID=${services.connect.id}`);
  console.log("\nThen redeploy (env var changes need a fresh deploy to take effect).");
  console.log(
    "\nFinally: create a cron-job.org job hitting POST {base}/api/atelier/orders-poll every 2-5 min with header Authorization: Bearer <CRON_SECRET>."
  );
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  console.error(
    "If Atelier's docs don't match this script's assumed field names, check the error body above for the exact field names it wants and adjust lib/atelier.js accordingly."
  );
  process.exit(1);
});
