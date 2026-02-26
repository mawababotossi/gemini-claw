# GeminiClaw

**The Autonomous Supervisor for `gemini-cli`.**

GeminiClaw transforms the official Google `gemini-cli` into a fully autonomous, self-hosted AI agent gateway using the **ACP** (Agent Communication Protocol).

> Inspired by OpenClaw — bridging the gap between a standard CLI tool and a powerful, multi-channel autonomous agent.

## Genesis & Motivation: From CLI to Autonomous Agent

While Google provides the `gemini-cli` as a powerful tool for interacting with Gemini 3 models, it remains a developer-focused terminal tool. **GeminiClaw takes this engine and gives it "wings" (and autonomy).**

### The Core Problem: Risk vs. Control
Many users attempted to bridge Gemini into autonomous workflows using unofficial OAuth "scraping" methods (like OpenClaw), which led to massive Google account bans. These methods are brittle, unauthorized, and risky.

### The GeminiClaw Evolution
GeminiClaw doesn't just "talk" to Gemini; it **supervises a headless instance of the official CLI**, granting it full agency while staying within Google's legitimate ecosystem.

*   **Turn CLI into Agent**: Transforms a one-shot command-line tool into a persistent, stateful agent that can live on Telegram, WhatsApp, or the Web.
*   **Autonomous Agency**: Unlike the standard CLI, GeminiClaw enables autonomous "ReAct" loops where the model can use tools (MCP), read files, and execute commands iteratively to solve complex tasks without manual intervention.
*   **TOS Compliance**: By using the experimental **ACP (Agent Communication Protocol)** built into the official `gemini` binary, you avoid the risks of account suspension associated with unofficial OAuth wrappers.
*   **Production Ready**: Adds the missing pieces for a real agent: session persistence, multi-user routing, and a professional admin dashboard.

## Why GeminiClaw?

GeminiClaw is not just another API wrapper. It is an **agent supervision platform** designed to harness the full potential of Google's new Gemini 3 models (Pro & Flash Preview).

*   **Visible Reasoning (Thoughts)**: Natively access the "Chain of Thought" of Gemini 3 models. The AI explains its reasoning before responding.
*   **Standard Protocols (ACP & MCP)**: Uses the Agent Communication Protocol to drive the Google engine and the **Model Context Protocol (MCP)** to connect your own tools.
*   **Autonomous ReAct Loops**: The agent intelligently manages tool usage (file reading, command execution, search) iteratively without server intervention.
*   **Privacy & Authentication**: Full support for GCA (Google Cloud Auth) with local session storage, ensuring a free and secure integration.

## Architecture

```
gemini-claw/
├── packages/
│   ├── core/           @geminiclaw/core       ← ACP Supervisor (Bridge to gemini-cli)
│   ├── gateway/        @geminiclaw/gateway    ← WebSocket Hub, Routing & Queuing
│   ├── memory/         @geminiclaw/memory     ← SQLite Persistence (Transcripts & Sessions)
│   ├── channels/       
│   │   ├── telegram/   @geminiclaw/channel-telegram
│   │   ├── whatsapp/   @geminiclaw/channel-whatsapp
│   │   └── webchat/    @geminiclaw/channel-webchat
│   ├── skills/         @geminiclaw/skills     ← MCP Server (Skill Registry)
│   └── dashboard/      @geminiclaw/dashboard  ← React Admin Interface (Agents & Logs)
├── config/
│   └── agents.json     ← Dynamic configuration of agents & channels
└── docker-compose.yml
```

## Quick Start

### 1. Prerequisites
You must have the official Gemini CLI installed globally:
```bash
npm install -g @google/gemini-cli
```

### 2. Quick Installation

To install GeminiClaw automatically:
```bash
curl -fsSL https://geminiclaw.ai/install.sh | bash
```

### 3. Using the CLI

The `geminiclaw` CLI allows you to configure and drive your agents:

```bash
# Interactive configuration (API Keys, Default Models)
geminiclaw configure

# Start services in the background (Gateway & Dashboard)
geminiclaw start

# Stop services
geminiclaw stop
```

### 4. Docker (Optional)

If you prefer using Docker:
```bash
docker-compose up -d
```

### 5. Dashboard
The administration interface is available at `http://localhost:5173/`.
It allows you to:
- Manage your agents in real-time.
- View the AI's "Thoughts" during chats.
- Monitor MCP tool consumption.

## Technical Operation

GeminiClaw acts as a **supervisor**. For each user session, it launches a `gemini --experimental-acp` process in the background.
1. The **Gateway** receives a message (e.g., from Telegram).
2. The **AgentRuntime** delegates the prompt to the **ACPBridge**.
3. The **SkillMcpServer** exposes our JavaScript functions (skills) in MCP format.
4. The Gemini 3 agent calls our MCP tools autonomously to enrich its response.

## License

Apache-2.0
