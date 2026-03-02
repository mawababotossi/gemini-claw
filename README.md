<div align="center">

# 🦀 GeminiClaw — ACP Gateway

**Turn `gemini-cli`, `claude-code`, and `codex` into fully autonomous, multi-channel AI agents.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange)](https://pnpm.io)
[![ACP](https://img.shields.io/badge/protocol-ACP%20%2B%20MCP-purple)](https://github.com/google-gemini/gemini-cli)

</div>

---

## The Problem GeminiClaw Solves

### The OpenClaw OAuth Ban Wave

In early 2025, OpenClaw — an open-source AI agent framework that accumulated over 200,000 GitHub stars in just a few months — became the center of a mass account suspension crisis.

To power its agents with Gemini 3 models, many OpenClaw users authenticated through **Google Antigravity OAuth**: they extracted OAuth tokens from Google's Antigravity IDE (a subsidized developer environment offering access to Gemini 2.5 Pro) and injected them into OpenClaw. This allowed them to bypass the official Gemini API's per-token pricing and instead run unlimited agent workloads against Google's flat-rate infrastructure.

When usage spiked, Google's systems flagged the traffic. The response was swift and severe:

- Hundreds of developers received **403 Terms of Service violation errors** with no prior warning
- **Google AI Ultra subscribers paying $249.99/month** lost access without explanation or refund path
- Some users reported that creating a fresh Google account also triggered a restriction
- Access to linked services — Gmail, Workspace, YouTube — was threatened in some cases
- The OpenClaw GitHub issue was ultimately closed as *"won't fix"* with a note that users should read provider ToS

A Google DeepMind engineer described the enforcement publicly: the company had been seeing a massive increase in usage of the Antigravity backend that degraded quality of service, and needed to quickly shut off access to users not using the product as intended. OpenClaw's creator called the enforcement "pretty draconian" and removed Antigravity support entirely. Anthropic followed suit days later, updating its legal terms to explicitly ban OAuth token usage in third-party tools. Two of the three largest AI providers locked down third-party OAuth access in the same week.

> The core issue was not technical — it was economic. Antigravity's OAuth infrastructure offered subsidized access to frontier models. Using it to power an autonomous agent that burns millions of tokens per session violated the implicit contract of flat-rate pricing. **Subscription OAuth from any provider is subsidized access running on borrowed time.**

### The GeminiClaw Answer

GeminiClaw was built from the ground up to sidestep this entire problem. Instead of extracting and reusing OAuth tokens from a subsidized IDE backend, it drives the **official `gemini-cli` binary directly** through its own supported integration protocol: `--experimental-acp`.

| Approach | Auth method | Risk |
|---|---|---|
| OpenClaw + Antigravity OAuth | Extracts tokens from a subsidized IDE backend | ❌ ToS violation, account ban, no refund |
| GeminiClaw + `gemini-cli` ACP | Runs the official binary you already authenticated | ✅ Fully within Google's intended use |

The `--experimental-acp` mode (or internal ACP protocols for Claude/Codex) is the **same protocol** used by Zed, Emacs, and other official integrations. GeminiClaw wraps these as long-running supervised subprocesses. Your account authenticates the CLI once via the standard flow, and GeminiClaw never touches your API keys or tokens during execution except to pass them to the official binary.

---

**GeminiClaw** is an open-source **agent supervision framework** built around the **ACP (Agent Communication Protocol)**. It supports multiple providers out-of-the-box:

- **Google Gemini** (via `gemini-cli`)
- **Anthropic Claude** (via `claude-code`)
- **OpenAI Codex** (via `codex-cli`)

It exposes these models as persistent autonomous agents equipped with:

- **Long-term memory** (JSONL transcripts + `MEMORY.md` file)
- **Visible reasoning** (native `thought_chunk` stream)
- **Autonomous ReAct loops** via custom MCP tools
- **Multi-channel routing** (Telegram, WhatsApp, WebChat, Discord, Slack)
- **React Admin Dashboard**

---

## 2. Why GeminiClaw?

### The Problem: Subscription OAuth Risk
In early 2025, many AI framework users faced account suspensions for using "scraping" or "OAuth token injection" methods to access frontier models. These methods violate the implicit contract of flat-rate pricing.

### The Answer: Official ACP Integration
GeminiClaw drives **official CLI binaries directly** through their supported integration protocols (ACP). This is the same protocol used by official IDE integrations like Zed. Your account authenticates the CLI once, and GeminiClaw never touches your raw tokens.

| Feature | Gemini API | GeminiClaw |
|---|---|---|
| Persistent memory across sessions | ❌ | ✅ JSONL + `MEMORY.md` |
| Visible Chain-of-Thought | ❌ | ✅ Native `thought_chunk` stream |
| Autonomous ReAct loops with tools | Manual | ✅ Built-in via MCP |
| Multi-channel routing | ❌ | ✅ Pluggable adapters |
| Google/Anthropic Safety | | ✅ Official ACP binary |
| Admin Dashboard | ❌ | ✅ React UI with live logs |

---

## 3. Architecture

```
                    ┌──────────────────────────────────────────┐
                    │            GeminiClaw Gateway             │
  Telegram ─────────┤                                          │
  WhatsApp ─────────┤  MessageQueue (FIFO per session)         │
  WebChat  ─────────┤       │                                  │
  Discord  ─────────┤       ▼                                  │
  Slack    ─────────┤  AgentRuntime ◄──── SessionMap           │
  Internal ─────────┤       │                                  │
                    │       ▼                                  │
                    │   ACPBridge ──── CLI Subprocess        │
                    │       │           (gemini / claude)      │
                    │       ▼                                  │
                    │  SkillMcpServer (JS tools via MCP)       │
                    │       │                                  │
                    │  TranscriptStore (JSONL + MEMORY.md)     │
                    └──────────────────────────────────────────┘
                                        │
                              React Dashboard (port 5173)
```

### Key Components

| Component | Role |
|---|---|
| **Gateway** | Central WebSocket hub. Receives messages from all channels, routes them to the correct agent. |
| **AgentRuntime** | Manages agent lifecycle: sessions, heartbeats, queues, and GC of inactive bridges. |
| **ACPBridge** | Subprocess supervisor for AI CLIs. Handles JSON-RPC stdin/stdout streaming for Gemini, Claude Code, and Codex. |
| **MessageQueue** | Per-session FIFO queue to prevent context corruption during simultaneous messages. |
| **SkillMcpServer** | HTTP/SSE MCP server exposing registered JS skills to the agent. |
| **TranscriptStore** | Persistence of conversations in JSONL format + `MEMORY.md` for long-term memory. |
| **Dashboard** | React-based UI (port 5173) to manage agents, sessions, logs, skills, and channels. |

---

## 4. Project Structure

```
geminiclaw/
├── packages/
│   ├── core/           @geminiclaw/core       ← Runtime, ACP Bridge, Failover
│   ├── gateway/        @geminiclaw/gateway    ← Main router, ingest(), sessions, Nodes
│   ├── memory/         @geminiclaw/memory     ← JSONL read/write
│   ├── skills/         @geminiclaw/skills     ← MCP Server & Registry
│   ├── channels/
│   │   ├── telegram/   @geminiclaw/channel-telegram
│   │   ├── whatsapp/   @geminiclaw/channel-whatsapp
│   │   ├── webchat/    @geminiclaw/channel-webchat
│   │   ├── discord/    @geminiclaw/channel-discord
│   │   └── slack/      @geminiclaw/channel-slack
│   └── dashboard/      @geminiclaw/dashboard  ← React Admin UI
├── config/
│   └── geminiclaw.json          ← Main configuration
├── data/                        ← Transcripts, sessions, MEMORY.md
├── docker-compose.yml
└── scripts/
    └── install.sh
```

---

## 5. Prerequisites

- **Node.js ≥ 20**
- **pnpm ≥ 9**
- **Gemini CLI** installed globally and authenticated:

```bash
npm install -g @google/gemini-cli
gemini auth          # perform one-time Google authentication
gemini --version     # verification
```

> GeminiClaw launches `gemini --experimental-acp` as a supervised subprocess. Authentication via `gemini auth` is mandatory — no extra API keys are required for the base setup.

---

## 6. Installation

### Via Installation Script

```bash
curl -fsSL https://geminiclaw.ai/install.sh | bash
```

### Manual Installation

```bash
git clone https://github.com/mawababotossi/geminiclaw.git
cd geminiclaw
pnpm install
pnpm build
```

---

## 7. Quick Start

### Step 1 — Copy Example Config

```bash
cp config/geminiclaw.example.json config/geminiclaw.json
```

### Step 2 — Minimum Configuration

Edit `config/geminiclaw.json`:

```json
{
  "dataDir": "./data",
  "port": 3000,
  "agents": [
    {
      "name": "main",
      "model": "gemini-2.5-pro-preview",
      "allowedPermissions": ["read_file", "write_file", "run_shell_command"],
      "channels": ["webchat"]
    }
  ]
}
```

### Step 3 — Start

```bash
pnpm start
```

Or using the CLI:

```bash
geminiclaw start      # starts gateway + dashboard in background
geminiclaw stop       # clean shutdown
geminiclaw status     # show agents and connection status
geminiclaw onboard    # guided configuration wizard
```

**Dashboard available at: http://localhost:5173**

---

## 8. Configuration Reference

### Agent Configuration (`geminiclaw.json`)

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique agent identifier (used for routing) |
| `provider` | `string` | AI Provider: `gemini`, `claude-code`, `codex` |
| `model` | `string` | Primary model (e.g., `gemini-2.0-flash`, `claude-3-7-sonnet`) |
| `fallbackModels` | `string[]` | Ordered list of fallback models if the primary fails |
| `authType` | `string` | Auth type: `oauth-personal`, `gemini-api-key`, `claude-api-key`, `openai-api-key` |
| `apiKey` | `string` | API Key. Required for non-OAuth flows. Supports `${ENV_VAR}` |
| `systemPrompt` | `string` | Path to a Markdown system prompt file |
| `allowedPermissions` | `string[]` | Auto-approved tools without confirmation prompts |
| `mcpServers` | `array` | External MCP servers to mount |
| `baseDir` | `string` | Base directory for `MEMORY.md`, `SOUL.md`, and workspace |
| `heartbeat` | `object` | Scheduled proactive wakeups (cron expression) |
| `skills` | `string[]` | Active prompt-driven skills (based on `SKILL.md`) |

### Channel Configuration

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "${TELEGRAM_BOT_TOKEN}",
      "allowedUserIds": [12345678]
    },
    "whatsapp": {
      "enabled": true,
      "phoneNumber": "+33612345678"
    },
    "webchat": {
      "enabled": true,
      "port": 3001
    }
  }
}
```

---

## 9. Communication Channels

| Channel | Package | Prerequisites |
|---|---|---|
| **Telegram** | `@geminiclaw/channel-telegram` | Bot Token from BotFather |
| **WhatsApp** | `@geminiclaw/channel-whatsapp` | QR Scan via Baileys (first time) |
| **WebChat** | `@geminiclaw/channel-webchat` | None |
| **Discord** | `@geminiclaw/channel-discord` | Discord Bot Token |
| **Slack** | `@geminiclaw/channel-slack` | Signing Secret + App Token |

### Cross-Channel Mirroring
Owner messages and agent responses can be synchronized between channels (e.g., WebChat ↔ WhatsApp), allowing you to follow the conversation anywhere.

---

## 10. Skill System (MCP Tools)

Skills are JavaScript functions exposed as MCP tools. The Gemini agent calls them autonomously during a ReAct loop.

### Integrated System Skills

The Gateway automatically provides these core skills:

| Skill | Description |
|---|---|
| `read_memory_file` / `update_memory_file` | Manage long-term agent memory |
| `delegate_task` | Hand off tasks to another specialized agent |
| `schedule_task` / `list_tasks` | Manage scheduled recurring jobs |
| `list_agents` | Discover other agents in the system |

---

## 11. Memory & Transcripts

### TranscriptStore (JSONL)
Conversations are persisted in `data/` as JSONL files. Each line represents a `ChatMessage` with roles, content, and optional `thought` data.

### Agent Context Files
Agents load contextual files from their `baseDir`:
- `SOUL.md`: Personality and behavior instructions.
- `USER.md`: User profile and preferences.
- `MEMORY.md`: Long-term memory updated by the agent itself.

---

## 12. React Dashboard

Open **http://localhost:5173** to access the administration interface:

- **Overview**: System health, WebSocket status, and metrics.
- **Agents**: Configuration, file editor, and active session management.
- **Sessions**: Complete chat history with visible reasoning chains.
- **Skills**: Skill management and API key configuration.
- **Logs**: Live log tail with levels and export functionality.

---

## 13. Security

- **`DASHBOARD_SECRET`**: Required environment variable to protect the API and WebSocket in production.
- **`allowedPermissions`**: Execution firewall. Only whitelisted actions are auto-approved.
- **`NODE_SECRET`**: Authentication for remote WebSocket Nodes (Priority 6).
- **Network Isolation**: Always use a reverse proxy (Nginx/Caddy) with TLS for production deployments.

---

## 14. License

[Apache-2.0](LICENSE) — free to use, modify, and distribute.

---

<div align="center">
  <sub>Built on top of <a href="https://github.com/google-gemini/gemini-cli">google/gemini-cli</a> · Not affiliated with Google</sub>
</div>
