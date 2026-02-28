<div align="center">

# 🦀 GeminiClaw

**Turn `gemini-cli` into a fully autonomous, multi-channel AI agent — without ever touching Google's OAuth.**

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

The `--experimental-acp` mode is the **same protocol** used by Zed, Emacs, and other official integrations. Google ships and maintains it. GeminiClaw wraps it as a long-running supervised subprocess — your Google account authenticates `gemini-cli` once via the standard flow, and GeminiClaw never touches your OAuth tokens. It sends prompts to stdin and reads responses from stdout, exactly as an IDE would.

---

## What is GeminiClaw?

GeminiClaw is an **agent supervision platform** built on top of the official Google `gemini-cli`. It wraps the CLI's experimental **ACP (Agent Communication Protocol)** to expose Gemini 3 models as persistent, autonomous agents — reachable through Telegram, WhatsApp, a web chat, or your own channel.

> Think of it as a flight controller for gemini-cli: you write the mission, GeminiClaw keeps the agent airborne, routes incoming traffic, persists memory, and exposes your tools via MCP — all without unofficial auth hacks.

### Why not just use the Gemini API directly?

The Gemini API gives you a model endpoint. GeminiClaw gives you **an agent**:

| | Gemini API | GeminiClaw |
|---|---|---|
| Persistent memory across sessions | ❌ | ✅ JSONL transcripts + long-term MEMORY.md |
| Visible chain-of-thought | ❌ | ✅ Native `thought_chunk` stream |
| Autonomous ReAct loops with tools | Manual | ✅ Built-in via MCP skills |
| Multi-channel routing (Telegram, WhatsApp…) | ❌ | ✅ Pluggable adapters |
| Google account safety | ⚠️ Risk with OAuth scraping | ✅ Official ACP binary |
| Admin dashboard | ❌ | ✅ React dashboard with live logs |

---

## Architecture at a Glance

```
                    ┌──────────────────────────────────────────┐
                    │            GeminiClaw Gateway             │
  Telegram ─────────┤                                          │
  WhatsApp ─────────┤  MessageQueue (FIFO per session)         │
  WebChat  ─────────┤       │                                  │
  Internal ─────────┤       ▼                                  │
                    │  AgentRuntime ◄──── SessionMap            │
                    │       │                                  │
                    │       ▼                                  │
                    │   ACPBridge  ──── gemini --experimental  │
                    │       │            -acp (subprocess)     │
                    │       ▼                                  │
                    │  SkillMcpServer  (your JS tools as MCP)  │
                    │       │                                  │
                    │  TranscriptStore (JSONL + MEMORY.md)     │
                    └──────────────────────────────────────────┘
                                        │
                              React Dashboard (port 5173)
```

```
geminiclaw/
├── packages/
│   ├── core/          @geminiclaw/core       ← ACP supervisor & AgentRuntime
│   ├── gateway/       @geminiclaw/gateway    ← WebSocket hub, routing, session queue
│   ├── memory/        @geminiclaw/memory     ← JSONL transcripts + SQLite sessions
│   ├── skills/        @geminiclaw/skills     ← MCP skill registry (your custom tools)
│   ├── channels/
│   │   ├── telegram/  @geminiclaw/channel-telegram
│   │   ├── whatsapp/  @geminiclaw/channel-whatsapp
│   │   └── webchat/   @geminiclaw/channel-webchat
│   └── dashboard/     @geminiclaw/dashboard  ← React admin UI
├── config/
│   └── geminiclaw.json                       ← Agents, channels, model config
└── docker-compose.yml
```

---

## Prerequisites

- **Node.js ≥ 20** and **pnpm ≥ 9**
- The official [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed globally and authenticated:

```bash
npm install -g @google/gemini-cli
gemini auth          # complete Google authentication once
gemini --version     # verify the CLI works
```

> GeminiClaw launches `gemini --experimental-acp` as a supervised subprocess. It requires the CLI to be authenticated beforehand — no additional API keys needed for the base setup.

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/mawababotossi/geminiclaw.git
cd geminiclaw
pnpm install
pnpm build
```

### 2. Configure your first agent

```bash
cp config/geminiclaw.example.json config/geminiclaw.json
```

Edit `config/geminiclaw.json` — the minimum working configuration:

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

### 3. Start

```bash
pnpm start
```

Or with the CLI helper:

```bash
geminiclaw start          # starts gateway + dashboard in background
geminiclaw stop           # graceful shutdown
geminiclaw status         # show running agents and channel connections
```

Open the dashboard at **http://localhost:5173** — your agent is live.

---

## Docker

```bash
# Start everything (gateway + dashboard)
docker-compose up -d

# Tail logs
docker-compose logs -f gateway

# Stop
docker-compose down
```

The `./data` volume is mounted for persistent transcripts and memory.

---

## Configuration Reference

### Agent options (`geminiclaw.json`)

```json
{
  "agents": [
    {
      "name": "main",
      "model": "gemini-2.5-pro-preview",
      "description": "General purpose assistant",
      "systemPrompt": "./agents/main/SYSTEM.md",
      "allowedPermissions": [
        "read_file",
        "write_file",
        "run_shell_command",
        "web_fetch"
      ],
      "mcpServers": [
        { "name": "skills", "url": "http://localhost:3002/mcp" }
      ],
      "fallbackModels": ["gemini-2.0-flash"],
      "heartbeat": {
        "enabled": true,
        "cron": "0 8 * * *",
        "deliveryChannel": "telegram"
      }
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique agent identifier, used for routing |
| `model` | string | Primary Gemini model to use |
| `systemPrompt` | string (path) | Path to a Markdown system prompt file |
| `allowedPermissions` | string[] | Tool calls the agent is allowed to execute without asking |
| `mcpServers` | array | External MCP servers to mount (your custom tools) |
| `fallbackModels` | string[] | Ordered list of models to try if the primary fails |
| `heartbeat` | object | Scheduled proactive wakeups (cron expression) |

### Channel configuration

```json
{
  "channels": {
    "telegram": {
      "token": "YOUR_BOT_TOKEN",
      "ownerChatId": "12345678"
    },
    "whatsapp": {
      "enabled": true,
      "ownerJid": "33612345678@s.whatsapp.net"
    },
    "webchat": {
      "port": 3001
    }
  }
}
```

---

## Writing Custom Skills (MCP Tools)

Skills are JavaScript functions exposed as MCP tools. The Gemini agent can call them autonomously during a ReAct loop.

Create a file in `packages/skills/src/skills/`:

```typescript
// packages/skills/src/skills/myTool.ts
import type { Skill } from '../types.js';
import { Type } from '@google/genai';

export const myTool: Skill = {
  name: 'fetch_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      city: { type: Type.STRING, description: 'City name' },
    },
    required: ['city'],
  },
  execute: async (args) => {
    const response = await fetch(`https://wttr.in/${args.city}?format=j1`);
    const data = await response.json();
    return { temp: data.current_condition[0].temp_C + '°C' };
  },
};
```

Register it in the skill registry — it will be automatically available to all agents that include the MCP server URL in their config.

---

## Understanding the Thought Stream

GeminiClaw natively captures the `agent_thought_chunk` stream from the ACP protocol, separate from the actual response text. This means you can see the model's full reasoning chain in the dashboard **without it polluting the user-facing reply**.

```
ACP stream:
  → agent_thought_chunk: "I need to check today's exchange rate..."
  → agent_thought_chunk: "Let me call fetch_url with USD/EUR..."
  → agent_message_chunk: "Le taux de change actuel est 1€ = 1.07$."

Dashboard shows:
  [💭 Thinking - 84 tokens] ← collapsible
  "Le taux de change actuel est 1€ = 1.07$."
```

The thought is also persisted in the JSONL transcript with the `thought` field, so it's visible when reviewing conversation history.

---

## Dashboard Features

The React dashboard (port 5173) gives you full visibility into your agent infrastructure:

- **Overview** — gateway health, WebSocket status, instance/session/cron counts
- **Agents** — per-agent config, files, tools, skills, and active sessions
- **Sessions** — full conversation history with token usage, thinking indicators
- **Skills** — enable/disable tools, inject API keys per-skill
- **Channels** — connection status for Telegram, WhatsApp, WebChat
- **Logs** — live log tail with level filtering (Trace → Fatal) and export
- **Settings** — model selection, provider keys, system config

---

## How It Works (Technical)

1. A user sends a message on any channel (Telegram, WhatsApp, WebChat).
2. The **Gateway** identifies the session and routes to the assigned `AgentRuntime`.
3. Messages are queued per-session in a FIFO `MessageQueue` to prevent context corruption.
4. The `AgentRuntime` prepares the prompt (injecting system instructions on new sessions) and delegates to `ACPBridge`.
5. `ACPBridge` writes a JSON-RPC prompt to `gemini --experimental-acp`'s stdin and reads streaming response chunks.
6. `agent_thought_chunk` events are accumulated separately from `agent_message_chunk` events.
7. If the model calls a tool (MCP), `ACPBridge` intercepts the permission request and auto-approves based on `allowedPermissions`.
8. The final response and thought are persisted to the JSONL `TranscriptStore` and returned to the channel.
9. **Mirroring**: if configured, the owner's messages are synced across channels (e.g., WebChat ↔ WhatsApp).

---

## Security Notes

- The `DASHBOARD_SECRET` environment variable protects the gateway HTTP API and WebSocket. Set it before production deployment.
- `allowedPermissions` is your execution firewall — only whitelisted actions are auto-approved. Everything else is denied by default.
- Never expose the gateway port (3000) or webchat WebSocket port (3001) directly to the internet without a reverse proxy (nginx/Caddy) and TLS.
- WhatsApp credentials (Baileys session) are stored locally in `data/whatsapp/`. Back up this directory.

---

## Troubleshooting

**Agent says "ACP session not found"**
The `gemini` subprocess crashed or timed out. Check `geminiclaw logs` for ACP errors. Restart with `geminiclaw restart`.

**Thought is appearing in the response text**
Some model variants don't correctly separate `thought_chunk` from `message_chunk`. GeminiClaw includes a heuristic cleaner (`cleanResponse`) that strips common leak patterns. If you see consistent leakage, open an issue with the model name.

**WhatsApp QR code not appearing**
Run the gateway in foreground mode (`geminiclaw start --foreground`) to see the QR in the terminal on first auth.

**Dashboard shows "Gateway unreachable"**
Ensure the gateway is running (`geminiclaw status`) and `VITE_GATEWAY_URL` in the dashboard `.env` matches the gateway address.

---

## Project Status

GeminiClaw is under active development. The core gateway, ACP bridge, and multi-channel routing are production-tested. The following are in progress:

- [ ] Usage page (token/cost analytics per agent and channel)
- [ ] Instances page (live WebSocket presence map)
- [ ] Nodes page (per-scope execution permission editor)
- [ ] End-to-end test suite

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and add tests
4. Run `pnpm test` and `pnpm build`
5. Open a pull request

All packages use TypeScript strict mode. Keep changes scoped to a single package where possible.

---

## License

[Apache-2.0](LICENSE) — free to use, modify, and distribute. Attribution appreciated.

---

<div align="center">
  <sub>Built on top of <a href="https://github.com/google-gemini/gemini-cli">google/gemini-cli</a> · Inspired by OpenClaw · Not affiliated with Google</sub>
</div>
