// Run locally once after deploying to Vercel:
//   DEPLOY_BASE_URL=https://your-app.vercel.app node scripts/setup-atelier.js
//
// This registers WITHOUT an owner wallet (bare registration) -- simplest path
// to get working credentials. The agent will be functional but marked
// "marketable": false, meaning it's hidden from the marketplace and can't
// receive orders yet. To fix that, go to useatelier.ai, sign in, and attach
// ownership to this agent_id (wallet connect or x402 fee) -- the exact UI flow
// for "claiming" an API-registered agent isn't in this script since it
// happens on their website, not through the REST API.

const atelier = require("../lib/atelier");
const store = require("../lib/store");

async function main() {
  const base = process.env.DEPLOY_BASE_URL;
  if (!base) {
    console.error("Set DEPLOY_BASE_URL to your live Vercel URL first.");
    process.exit(1);
  }

  console.log("Registering Alpha Guardian on Atelier (bare, no owner yet)...");
  // No endpointUrl on purpose: this agent uses polling (via cron-job.org
  // hitting /api/atelier/orders-poll), not webhooks. Setting an endpoint_url
  // would make Atelier start sending webhook POSTs to a route that doesn't
  // exist yet, which just retries and fails 3x per event for no benefit.
  const reg = await atelier.registerAgent({
    name: "Alpha Guardian",
    description:
      "Security scanner for AI agent skills (Claude/Gemini/ChatGPT). Detects malware, exfiltration, prompt injection, and destructive patterns before install.",
    capabilities: ["coding"],
  });
  console.log(reg);

  if (reg.status === "already_registered") {
    console.log("Already registered -- using saved credentials. (Delete the 'atelier:credentials' key in Upstash if you need to re-register from scratch.)");
  }

  const { agentId, apiKey, marketable } = reg;

  console.log("\nCreating services...");

  const scan = await atelier.createService(agentId, apiKey, {
    category: "coding",
    title: "Skill Security Scan",
    description: "Scan a Claude/Gemini/ChatGPT agent skill for malware, exfiltration, and prompt-injection risk. Returns a 0-100 score and verdict.",
    priceUsd: "2.00",
    priceType: "fixed",
    turnaroundHours: 1,
    deliverables: ["Risk score + verdict (SAFE/CAUTION/DO_NOT_INSTALL)", "Full findings report (JSON)"],
  });
  console.log("Scan service:", scan.id, scan.title);

  const boss = await atelier.createService(agentId, apiKey, {
    category: "coding",
    title: "Agent Boss -- 24/7 Fleet Monitoring",
    description: "Continuously monitors your agent's installed skills for drift and new risk, and pushes alerts the moment something changes.",
    priceUsd: "15.00",
    priceType: "monthly",
    turnaroundHours: 1,
    deliverables: ["Ongoing monitoring", "Real-time alerts on risk drift"],
  });
  console.log("Boss service:", boss.id, boss.title);

  const connect = await atelier.createService(agentId, apiKey, {
    category: "coding",
    title: "Agent Connections -- Multi-Agent Task Orchestration",
    description: "Combine multiple specialist agents to complete a complex task, coordinated via bounty, fixed price, or skill-upgrade rewards.",
    priceUsd: "10.00",
    priceType: "fixed",
    turnaroundHours: 4,
    deliverables: ["Coordinated multi-agent task result"],
  });
  console.log("Connect service:", connect.id, connect.title);

  console.log("\n=== Paste these into your Vercel project's Environment Variables ===");
  console.log(`ATELIER_AGENT_ID=${agentId}`);
  console.log(`ATELIER_API_KEY=${apiKey}`);
  console.log(`ATELIER_SCAN_SERVICE_ID=${scan.id}`);
  console.log(`ATELIER_BOSS_SERVICE_ID=${boss.id}`);
  console.log(`ATELIER_CONNECT_SERVICE_ID=${connect.id}`);

  if (!marketable) {
    console.log(
      "\n[!] IMPORTANT: this agent is registered but NOT yet marketable -- it's hidden and can't receive orders."
    );
    console.log(
      "Go to useatelier.ai, sign in, and attach ownership to this agent (agent_id above) via wallet connect or the site's claim flow."
    );
  }

  console.log(
    "\nThen redeploy on Vercel, and set up a cron-job.org job hitting POST {base}/api/atelier/orders-poll every 2-5 min with header Authorization: Bearer <CRON_SECRET>."
  );
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  if (err.body) console.error("Response body:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
