// Each rule: id, category, severity (1-10), test(content) -> array of match snippets (or [])
// Severity contributes to the 0-100 risk score. Keep patterns broad but low-noise.

const RULES = [
  // --- Destructive / irreversible shell operations ---
  {
    id: "shell-rm-rf",
    category: "destructive_shell",
    severity: 10,
    pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+[\/~]/gi,
    label: "Recursive force-delete targeting root/home paths",
  },
  {
    id: "shell-chmod-777",
    category: "destructive_shell",
    severity: 6,
    pattern: /\bchmod\s+(-R\s+)?777\b/gi,
    label: "World-writable permission grant (chmod 777)",
  },
  {
    id: "shell-fork-bomb",
    category: "destructive_shell",
    severity: 10,
    pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/g,
    label: "Fork bomb pattern",
  },

  // --- Remote-code-execution / pipe-to-shell installers ---
  {
    id: "curl-pipe-sh",
    category: "remote_execution",
    severity: 9,
    pattern: /(curl|wget)\s+[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/gi,
    label: "Downloads and pipes a remote script directly into a shell",
  },
  {
    id: "npx-arbitrary-remote",
    category: "remote_execution",
    severity: 5,
    pattern: /npx\s+(-y\s+)?https?:\/\//gi,
    label: "Executes an arbitrary package fetched from a raw URL",
  },
  {
    id: "eval-dynamic",
    category: "remote_execution",
    severity: 7,
    pattern: /\beval\s*\(\s*(atob|Buffer\.from|require\(['"]child_process|fetch\(|require\(['"]https?)/gi,
    label: "eval() combined with decoding or a network fetch (classic obfuscated payload)",
  },
  {
    id: "obfuscated-base64-exec",
    category: "remote_execution",
    severity: 8,
    pattern: /(atob|Buffer\.from\([^)]*['"]base64['"]\))[\s\S]{0,80}(eval|exec|child_process)/gi,
    label: "Base64-decoded string is immediately executed",
  },

  // --- Credential / secret exfiltration ---
  {
    id: "read-ssh-keys",
    category: "credential_theft",
    severity: 10,
    pattern: /(~|\$HOME|\/home\/[a-z0-9_-]+)\/\.ssh\/(id_rsa|id_ed25519|authorized_keys)/gi,
    label: "Reads SSH private key material",
  },
  {
    id: "read-cloud-creds",
    category: "credential_theft",
    severity: 10,
    pattern: /\.(aws\/credentials|npmrc|netrc|gitconfig|docker\/config\.json)\b/gi,
    label: "Reads cloud/package-manager credential files",
  },
  {
    id: "env-dump-exfil",
    category: "credential_theft",
    severity: 9,
    pattern: /(process\.env|os\.environ)[\s\S]{0,120}(fetch|axios|requests\.(post|get)|urllib)/gi,
    label: "Environment variables are read shortly before an outbound network call",
  },
  {
    id: "hardcoded-private-key",
    category: "credential_theft",
    severity: 6,
    pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    label: "Embedded private key material in the skill source",
  },

  // --- Suspicious exfiltration / beacon endpoints ---
  {
    id: "beacon-domains",
    category: "exfiltration",
    severity: 7,
    pattern: /(webhook\.site|requestbin\.com|ngrok(-free)?\.(io|app)|pipedream\.net|interact\.sh|burpcollaborator\.net)/gi,
    label: "Talks to a common data-exfiltration / request-capture domain",
  },
  {
    id: "dns-exfil",
    category: "exfiltration",
    severity: 6,
    pattern: /dns\.resolve\w*\s*\(\s*[`'"][^`'"]*\$\{/gi,
    label: "DNS lookup built from dynamic/secret-shaped data (possible DNS exfiltration)",
  },

  // --- Persistence / backdoor installation ---
  {
    id: "cron-persistence",
    category: "persistence",
    severity: 8,
    pattern: /crontab\s+-e|echo\s+[^\n]*>>\s*\/etc\/cron|systemctl\s+enable/gi,
    label: "Installs a cron job or systemd service (persistence mechanism)",
  },
  {
    id: "shell-profile-modification",
    category: "persistence",
    severity: 6,
    pattern: />>\s*(~|\$HOME)\/\.(bashrc|zshrc|profile|bash_profile)/gi,
    label: "Appends to a shell startup file (survives reboot/new sessions)",
  },
  {
    id: "reverse-shell",
    category: "persistence",
    severity: 10,
    pattern: /(bash\s+-i\s+>&\s*\/dev\/tcp\/|nc\s+-e\s+\/bin\/(sh|bash)|python[3]?\s+-c\s+['"]import socket)/gi,
    label: "Reverse-shell pattern",
  },

  // --- Cryptomining ---
  {
    id: "cryptominer",
    category: "cryptomining",
    severity: 9,
    pattern: /(stratum\+tcp:\/\/|xmrig|minerd\s|nicehash|monero.*pool)/gi,
    label: "Cryptomining pool connection string or miner binary reference",
  },

  // --- Prompt injection / instruction override aimed at the host LLM ---
  {
    id: "prompt-injection-override",
    category: "prompt_injection",
    severity: 8,
    pattern: /(ignore (all|any|the) (previous|prior|above) instructions|disregard your (system|previous) prompt|you are now (unrestricted|jailbroken|DAN)|do anything now\b)/gi,
    label: "Contains prompt-injection language aimed at overriding the host agent's instructions",
  },
  {
    id: "prompt-injection-secrecy",
    category: "prompt_injection",
    severity: 6,
    pattern: /(do not (tell|mention|reveal) (the user|this to)|keep this (secret|hidden) from the user)/gi,
    label: "Instructs the agent to hide behavior from the user operating it",
  },
  {
    id: "prompt-injection-exfil-instructions",
    category: "prompt_injection",
    severity: 8,
    pattern: /(send|post|email|upload)[\s\S]{0,60}(api[_ ]?key|secret|token|password|\.env)[\s\S]{0,60}(to|https?:\/\/)/gi,
    label: "Instructs the agent to transmit secrets/credentials somewhere",
  },

  // --- Scope / filesystem overreach ---
  {
    id: "writes-outside-workspace",
    category: "scope_overreach",
    severity: 5,
    pattern: /(open\(|writeFile\w*\(|fs\.write\w*\()\s*['"`](\/etc\/|\/root\/|\/var\/|C:\\\\Windows)/gi,
    label: "Writes to system directories outside a normal working directory",
  },
  {
    id: "modifies-other-skills",
    category: "scope_overreach",
    severity: 7,
    pattern: /(\.claude\/skills|\.gemini\/skills|\/mnt\/skills)[^\n]{0,60}(writeFile|open\(.*['"]w['"]\)|rm\s)/gi,
    label: "Reads/writes other installed skills' files — possible self-propagation or tampering",
  },

  // --- Suspicious install-time network reach ---
  {
    id: "unusual-registry",
    category: "supply_chain",
    severity: 4,
    pattern: /(pip install|npm install)[^\n]*--index-url\s+https?:\/\/(?!pypi\.org|npmjs\.org|registry\.npmjs\.org)/gi,
    label: "Installs dependencies from a non-standard package registry",
  },
];

function scanContent(content) {
  const findings = [];
  for (const rule of RULES) {
    const matches = content.match(rule.pattern);
    if (matches && matches.length) {
      findings.push({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        label: rule.label,
        occurrences: matches.length,
        sample: matches[0].slice(0, 120),
      });
    }
  }
  return findings;
}

module.exports = { RULES, scanContent };
