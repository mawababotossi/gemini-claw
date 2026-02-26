# GeminiClaw

Self-hosted AI agent gateway powered by `gemini-cli` via **ACP** (Agent Communication Protocol).

> Inspired by OpenClaw — bring the reasoning power of Gemini 3 to Telegram, WhatsApp and the Web.

## Genèse & Motivation

GeminiClaw est né d'un constat critique : de nombreux utilisateurs d'outils comme OpenClaw ont vu leurs comptes Google bannis pour violation des Conditions de Service (TOS). 

### Le Problème 
L'utilisation de tokens Gemini via des flux OAuth non officiels (sur des comptes personnels "flat-rate") pour alimenter des agents tiers est strictement surveillée par Google. Cela a conduit à des suspensions massives, privant les utilisateurs de l'accès non seulement à Gemini, mais parfois à l'intégralité de leurs services Google (Gmail, Drive, etc.).

### La Solution GeminiClaw
Contrairement aux approches par "scraping" ou OAuth non officiel, GeminiClaw s'appuie sur le **CLI officiel de Google** via le protocole expérimental **ACP (Agent Communication Protocol)**. 
*   **Conformité** : Utilise les canaux de communication légitimes prévus par Google.
*   **Sécurité** : Pas besoin de partager des secrets OAuth ou des clés API sensibles avec des serveurs tiers non vérifiés.
*   **Pérennité** : Conçu pour s'aligner sur l'évolution de l'écosystème "agentique" de Google DeepMind.

## Pourquoi GeminiClaw ?

GeminiClaw n'est pas qu'un simple wrapper d'API. C'est une plateforme de **supervision d'agents** conçue pour exploiter le plein potentiel des nouveaux modèles Gemini 3 de Google (Pro & Flash Preview).

*   **Raisonnement Visible (Thoughts)** : Accédez nativement à la "chaîne de pensée" (Chain of Thought) des modèles Gemini 3. L'IA explique son raisonnement avant de répondre.
*   **Protocoles Standards (ACP & MCP)** : Utilise l'Agent Communication Protocol pour piloter le moteur de Google et le **Model Context Protocol (MCP)** pour connecter vos propres outils.
*   **Boucles ReAct Autonomes** : L'agent gère intelligemment l'utilisation des outils (lecture de fichiers, exécution de commandes, recherche) de manière itérative sans intervention du serveur.
*   **Privacy & Authentification** : Support complet du GCA (Google Cloud Auth) avec stockage local des sessions, garantissant une intégration gratuite et sécurisée.

## Architecture

```
gemini-claw/
├── packages/
│   ├── core/           @geminiclaw/core       ← Superviseur ACP (Bridge vers gemini-cli)
│   ├── gateway/        @geminiclaw/gateway    ← Hub WebSocket, Routage & Files d'attente
│   ├── memory/         @geminiclaw/memory     ← Persistance SQLite (Transcripts & Sessions)
│   ├── channels/       
│   │   ├── telegram/   @geminiclaw/channel-telegram
│   │   ├── whatsapp/   @geminiclaw/channel-whatsapp
│   │   └── webchat/    @geminiclaw/channel-webchat
│   ├── skills/         @geminiclaw/skills     ← Serveur MCP (Registre de compétences)
│   └── dashboard/      @geminiclaw/dashboard  ← Interface Admin React (Agents & Logs)
├── config/
│   └── agents.json     ← Configuration dynamique des agents & canaux
└── docker-compose.yml
```

## Quick Start

### 1. Prérequis
Vous devez avoir le CLI Gemini officiel installé globalement :
```bash
npm install -g @google/gemini-cli
```

### 2. Installation Rapide

Pour installer GeminiClaw automatiquement :
```bash
curl -fsSL https://geminiclaw.ai/install.sh | bash
```

### 3. Utilisation du CLI

Le CLI `geminiclaw` vous permet de configurer et de piloter vos agents :

```bash
# Configuration interactive (Clés API, Modèles par défaut)
geminiclaw configure

# Démarrer les services en arrière-plan (Gateway & Dashboard)
geminiclaw start

# Arrêter les services
geminiclaw stop
```

### 4. Docker (Optionnel)

Si vous préférez utiliser Docker :
```bash
docker-compose up -d
```

### 5. Dashboard
L'interface d'administration est disponible sur `http://localhost:5173/`. 
Elle vous permet de :
- Gérer vos agents en temps réel.
- Voir les "Pensées" de l'IA lors des chats.
- Surveiller la consommation des outils MCP.

## Fonctionnement Technique

GeminiClaw agit comme un **superviseur**. Pour chaque session utilisateur, il lance un processus `gemini --experimental-acp` en arrière-plan. 
1. Le **Gateway** reçoit un message (ex: de Telegram).
2. L'**AgentRuntime** délègue le prompt à l'**ACPBridge**.
3. Le **SkillMcpServer** expose nos fonctions JavaScript (skills) au format MCP.
4. L'agent Gemini 3 appelle nos outils MCP de manière autonome pour enrichir sa réponse.

## License

Apache-2.0
