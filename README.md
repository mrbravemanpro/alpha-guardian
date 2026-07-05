# Alpha Guardian

Security scanner + fleet monitor + multi-agent orchestrator for AI agent skills
(Claude, Gemini CLI, ChatGPT/Codex). Same category as NVIDIA's SkillSpector,
built as a monetizable agent instead of a standalone CLI tool.

Three services, one codebase:

1. **Skill Security Scan** — `POST /api/scan`. Give it a skill's raw content
   (or a URL to it) and it returns a 0-100 risk score, a verdict
   (`SAFE` / `CAUTION` / `DO_NOT_INSTALL`), and the exact findings: destructive
   shell commands, credential exfiltration, obfuscated payloads, reverse
   shells, cryptominers, persistence mechanisms, and prompt-injection language
   aimed at the host LLM.
2. **Agent Boss** — 24/7 monitoring. Owners register their agent's skill URLs
   via `POST /api/agents/watch`; a scheduler hits `/api/cron/monitor` every
   few minutes, re-scans, diffs against the last known state, and pushes a
   Discord/Telegram alert the moment risk drifts upward or a new finding
   appears.
3. **Agent Connections** — multi-agent task orchestration. `POST
   /api/agents/connect` broadcasts a task + reward (bounty / fixed price /
   skill-upgrade grant) to a list of candidate agent webhooks. Agents bid or
   deliver results back to a callback URL; the first delivered result marks
   the bounty fulfilled. `POST /api/agents/reward` then issues the
   skill-upgrade grant (curated "how to work with humans" playbook content)
   to the winner.

All three are wired into the Atelier marketplace order lifecycle
(`register → list → poll → fulfill → deliver`) in `lib/atelier.js` and
`api/atelier/orders-poll.js`, following the pattern every escrow-style agent
marketplace converges on.

---

## Cost: $0/month at this scale

| Piece | Provider | Free tier limit |
|---|---|---|
| Code hosting | GitHub | unlimited public/private repos |
| Compute | Vercel (Hobby) | 100GB-hrs/mo serverless functions — plenty for a scanner |
| State/KV | Upstash Redis | 10k commands/day free |
| Scheduler | cron-job.org | unlimited jobs, 1-min minimum interval, free |
| (Optional) on-chain checks | Moralis | free tier API calls |

Vercel's own built-in cron is capped at once/day on Hobby — useless for a
monitor that needs to run every few minutes. This project deliberately does
**not** use `vercel.json` crons; it exposes authenticated HTTP endpoints
(`/api/cron/monitor`, `/api/atelier/orders-poll`) that an external scheduler
calls instead. See "Cron setup" below.

---

## Setup (in order)

### 1. GitHub
Push this folder to a new repo (Cursor: just open the folder, `git init`,
commit, push — or use GitHub Desktop / `gh repo create`).

### 2. Upstash (free Redis)
1. https://console.upstash.com → Create Database → Regional → free tier.
2. Open the database → "REST API" tab.
3. Copy the **REST URL** and the **read-write** REST TOKEN (not read-only).

### 3. Vercel
1. https://vercel.com → New Project → import the GitHub repo.
2. Deploy once as-is (it'll work in "degraded" mode — health check will
   report `storageConfigured: false` — that's expected before step 4).
3. Project Settings → Environment Variables → add everything from
   `.env.example` that you have values for so far:
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `CRON_SECRET` — make up a random letters/numbers string (no `!`, `$`,
     backticks — they break shell-based test commands later)
   - `DEPLOY_BASE_URL` — your `https://<project>.vercel.app` URL
4. **Redeploy** (Vercel snapshots env vars at build time — saving them in the
   dashboard doesn't retroactively affect an already-running deployment).
5. Confirm: `curl https://<project>.vercel.app/api/health` should show
   `"storageConfigured": true`.

### 4. Cron setup (cron-job.org, free)
Create **two** separate jobs — double-check each has a *different* URL, since
copy-pasting a job to make the second one and forgetting to change the URL is
the single most common setup mistake here:

| Job | URL | Method | Interval | Header |
|---|---|---|---|---|
| Agent Boss monitor | `https://<project>.vercel.app/api/cron/monitor` | POST | every 5 min | `Authorization: Bearer <CRON_SECRET>` |
| Atelier order poll | `https://<project>.vercel.app/api/atelier/orders-poll` | POST | every 2-5 min (respect Atelier's stated rate limit once you have it) | `Authorization: Bearer <CRON_SECRET>` |

### 5. Atelier marketplace listing
1. Locally (Cursor terminal), `npm install`, then set env vars for the
   script:
   ```bash
   export DEPLOY_BASE_URL=https://<project>.vercel.app
   export ATELIER_API_BASE=https://app.useatelier.ai/api
   npm run setup:atelier
   ```
2. This registers the agent once (idempotent — re-running after a partial
   failure will NOT re-register; it reads from Upstash first) and creates the
   three services. It prints five env vars at the end.
3. Paste those five vars (`ATELIER_AGENT_ID`, `ATELIER_API_KEY`,
   `ATELIER_SCAN_SERVICE_ID`, `ATELIER_BOSS_SERVICE_ID`,
   `ATELIER_CONNECT_SERVICE_ID`) into Vercel's env vars and redeploy.
4. Go to https://app.useatelier.ai/agents?category=coding and confirm Alpha
   Guardian + its three services are live.

**If the setup script errors on a 400/405**: read the printed error body —
Atelier will usually tell you the exact field name/enum it expects. Open
`lib/atelier.js` and adjust `registerAgent`/`createService`'s body shape to
match; don't guess blind. This is the standard failure mode for any
marketplace whose docs are incomplete, not a bug in this scaffold.

### 6. (Optional) Notifications
Add `DISCORD_WEBHOOK_URL` and/or `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` to
Vercel env vars, redeploy. Agent Boss alerts will start flowing.

---

## Using it directly (no marketplace needed)

```bash
# Scan a skill by URL
curl -X POST https://<project>.vercel.app/api/scan \
  -H "Content-Type: application/json" \
  -d '{"skillName":"some-skill","sourceUrl":"https://raw.githubusercontent.com/.../SKILL.md"}'

# Register something for Agent Boss to watch 24/7
curl -X POST https://<project>.vercel.app/api/agents/watch \
  -H "Content-Type: application/json" \
  -d '{"ownerName":"fomocoinmaster","agentName":"Agent Memecoin Tracker","skillUrls":["https://raw.githubusercontent.com/.../SKILL.md"]}'

# Kick off a multi-agent bounty
curl -X POST https://<project>.vercel.app/api/agents/connect \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Analyze last 24h of pump.fun launches and produce a risk-ranked shortlist",
    "candidates": [
      {"name":"Solana Alpha Suite","webhookUrl":"https://your-other-agent.example.com/webhook"},
      {"name":"Some Other Agent","webhookUrl":"https://third-party.example.com/webhook"}
    ],
    "reward": {"type":"skill_upgrade","skillOffer":"human-behavior-101"},
    "deadlineMinutes": 20
  }'
```

---

## Extending the scanner

Detection rules live in `lib/scanner/rules.js` as plain regex + severity
pairs — no ML, no external API calls, so it stays free and fast. Add a rule,
give it a `category` and `severity` (1-10), and the scoring engine in
`lib/scanner/engine.js` picks it up automatically. Current categories:
`destructive_shell`, `remote_execution`, `credential_theft`, `exfiltration`,
`persistence`, `cryptomining`, `prompt_injection`, `scope_overreach`,
`supply_chain`.

**Known limitation:** this is static/heuristic analysis, the same approach
SkillSpector uses — it catches known bad patterns, not every possible
obfuscation. Treat a `SAFE` verdict as "nothing obviously bad found," not a
formal security audit. For high-stakes skills, pair it with manual review.

---

## Known limitations (be upfront about these)

- Agent Connections assumes invited agents expose a plain `POST JSON` webhook.
  Agents behind other protocols (pure MCP servers, x402-only endpoints) need
  a small adapter in front of them.
- Reward fulfillment for `bounty`/`fixed` reward types records the winner but
  does **not** move USDC itself — that's intentionally left to
  Atelier's own escrow/payment flow or your manual payout, so this scaffold
  never touches funds directly. Only `skill_upgrade` rewards are granted
  automatically (it's just data).
- Upstash free tier caps at 10k commands/day — fine for dozens of watched
  agents scanned every 5 min; if you scale past that, upgrade the DB or widen
  the monitor interval.
