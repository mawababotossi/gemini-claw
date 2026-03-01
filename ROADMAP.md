# GeminiClaw Improvement Plan & Roadmap

J'ai maintenant une vue complète des deux projets. Voici l'analyse comparative et le plan d'amélioration détaillé.

---

## Analyse comparative : forces et lacunes (GeminiClaw vs OpenClaw)

**Installation & onboarding** : OpenClaw propose un script d'installation one-liner, un wizard `openclaw onboard --install-daemon`, et une intégration système (systemd/launchd) out-of-the-box. GeminiClaw nécessite encore un `git clone` + `pnpm install` + configuration manuelle du JSON. C'est le point d'entrée le moins mature.

**Modèles & failover** : Les deux projets ont un système de `fallbackModels`. OpenClaw pousse plus loin avec un mécanisme de cooldown progressif (1min → 5min → 25min → 1h) en cas de rate limit. GeminiClaw n'a pas encore ce comportement.

**Canaux** : OpenClaw couvre Telegram, WhatsApp, Discord, Slack. GeminiClaw couvre Telegram, WhatsApp et WebChat — Discord et Slack sont absents.

**Nodes (appareils physiques)** : C'est la différence structurelle la plus importante. OpenClaw supporte des appareils iOS/Android/macOS comme extensions physiques (caméra, GPS, notifications, canvas). GeminiClaw a une page UI planifiée pour les Nodes mais aucune implémentation backend.

**Sécurité** : OpenClaw a `mentionGating`, SSH tunnel et support Tailscale natif. GeminiClaw a une ACL ouverte par défaut (bug documenté dans `geminiclaw-corrections.md`) et les endpoints REST ne sont pas authentifiés.

**Skills/outils** : OpenClaw dispose de ClawHub (registry tiers installable via npx). GeminiClaw a un bon système MCP mais pas d'équivalent à un hub de compétences partagées.

**CLI** : OpenClaw a une CLI très riche (`doctor`, `pairing`, `devices`, `dashboard`). GeminiClaw a un CLI minimal (`start`, `stop`, `status`).

**Heartbeat & mémoire** : GeminiClaw a un avantage ici avec la distillation MEMORY.md et les `thought_chunk` visibles dans le dashboard. OpenClaw n'expose pas la chaîne de raisonnement.

---

## Plan d'amélioration détaillé

### Priorité 1 — Sécurité (corrections critiques)
C'est le point bloquant avant tout déploiement en dehors d'un réseau local. 
- **ACL "Deny by Default"** : Passer l'ACL en mode "deny par défaut" en production : si un canal n'est pas configuré dans `geminiclaw.json`, l'accès est refusé plutôt qu'ouvert.
- **Authentification REST** : Ajouter un middleware Express qui vérifie un token `GEMINICLAW_GATEWAY_TOKEN` sur toutes les routes `/api/*`.

### Priorité 2 — Onboarding & installation
L'objectif est de passer de `git clone` à une commande unique. 
- Publier le package `@geminiclaw/cli` sur npm.
- Créer un script d'install (`install.sh`) analogue à celui d'OpenClaw. 
- Commande `geminiclaw onboard` : guide l'utilisateur étape par étape.
- Flag `--install-daemon` pour systemd/launchd.

### Priorité 3 — Robustesse du failover
- **Cooldown Progressif** : Implémenter dans l'`AgentRuntime` une logique qui, sur réception d'une erreur 429 ou d'un timeout ACP, place le modèle primaire en cooldown progressif (1min → 5min → 25min → 1h cap) avant de tenter le suivant. Stockage des compteurs dans `AgentRegistry`.

### Priorité 4 — CLI enrichie
- `geminiclaw doctor` : diagnostique la connectivité vers Google ACP, vérifie `gemini --version`, valide les clés d'environnement et les ports.
- `geminiclaw status --all` : tableau de santé complet (canaux, agents, sessions actives, dernier heartbeat).
- `geminiclaw audit` : scan de sécurité (ACL ouverte, endpoints non authentifiés, permissions trop larges).

### Priorité 5 — Nouveaux canaux (Discord et Slack)
- Création de `@geminiclaw/channel-discord` et `@geminiclaw/channel-slack`.
- Gestion des `Privileged Gateway Intents` pour Discord.
- Activation via la page Channels du dashboard.

### Priorité 6 — Système de Nodes
- Créer un package `@geminiclaw/nodes` (WebSocket).
- Enregistrement des appareils avec ID et approbation via `geminiclaw devices approve <ID>`.
- Capabilities (`camera.snap`, `location.get`, `system.notify`) comme outils MCP.
- Implémentation minimale initiale : `location.get` et `system.notify` (via Pushover ou ntfy).

### Priorité 7 — Mémoire avancée & distillation
- **Distillation Automatique** : Job cron nocturne qui résume les nouvelles entrées JSONL de la journée et les append dans MEMORY.md.
- Taille maximale configurable pour les fichiers de mémoire.

### Priorité 8 — Hub de compétences (ClawHub equivalent)
- Registre JSON hébergé référençant des skills npm compatibles MCP.
- Commande `geminiclaw skills add <package>` pour installation et enregistrement automatique.

---

## Récapitulatif priorisé

| # | Chantier | Effort | Impact |
|---|---|---|---|
| 1 | Sécurité : ACL deny-by-default + auth REST | Faible | Critique |
| 2 | Onboarding : script install + wizard `onboard` | Moyen | Élevé |
| 3 | Failover cooldown progressif | Faible | Élevé |
| 4 | CLI : `doctor`, `status --all`, `audit` | Moyen | Élevé |
| 5 | Canaux Discord & Slack | Moyen | Moyen |
| 6 | Nodes (appareils physiques) | Élevé | Élevé |
| 7 | Distillation mémoire automatique | Faible | Moyen |
| 8 | Hub de compétences (ClawHub-like) | Élevé | Moyen |

---

## Appendice : Détails Techniques de l'Infrastructure

### 1. Installation façon OpenClaw (`curl | bash`)

#### Le problème actuel
GeminiClaw est un **monorepo pnpm workspace** — il n'existe pas en tant que package npm global installable. OpenClaw peut faire `npm install -g openclaw` parce que c'est un seul package compilé, autonome. GeminiClaw démarre depuis un `git clone` avec 7 packages interdépendants.

#### Ce qu'il faut faire concrètement (Chemin B, le plus rapide)
Créer un fichier `install.sh` à la racine :

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${GEMINICLAW_HOME:-$HOME/.geminiclaw}"
BIN_PATH="/usr/local/bin/geminiclaw"

echo "📦 Installing GeminiClaw into $INSTALL_DIR..."

# 1. Cloner ou mettre à jour
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone https://github.com/mawababotossi/geminiclaw.git "$INSTALL_DIR"
fi

# 2. Installer les dépendances et compiler
cd "$INSTALL_DIR"
pnpm install --frozen-lockfile
pnpm build

# 3. Symlink de la CLI
chmod +x "$INSTALL_DIR/packages/cli/dist/index.js"
sudo ln -sf "$INSTALL_DIR/packages/cli/dist/index.js" "$BIN_PATH"

echo "✅ GeminiClaw installé. Lance : geminiclaw onboard"
```

Avec ça, l'utilisateur fait juste :
```bash
curl -fsSL https://raw.githubusercontent.com/mawababotossi/geminiclaw/main/install.sh | bash
```

#### Évolutions CLI nécessaires
1. **`GEMINICLAW_HOME`** : Modifier `packages/cli/src/commands/start.ts` pour que la CLI connaisse son répertoire d'installation.
2. **`geminiclaw onboard`** : Créer un wizard interactif (`inquirer`) pour configurer la clé API, les canaux et le token Telegram.

---

### 2. Gestion par systemctl (daemon Linux)

#### Fonctionnement
`systemctl` gère des **services systemd**, définis par des fichiers `.service` dans `/etc/systemd/system/`.

#### Le fichier `.service` type
```ini
# /etc/systemd/system/geminiclaw.service
[Unit]
Description=GeminiClaw AI Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%i
WorkingDirectory=/home/%i/.geminiclaw
ExecStart=/usr/bin/node /home/%i/.geminiclaw/packages/gateway/dist/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=geminiclaw

# Variables d'environnement
EnvironmentFile=-/home/%i/.geminiclaw/.env
Environment=CONFIG_PATH=/home/%i/.geminiclaw/config/geminiclaw.json
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

#### Intégration CLI (`geminiclaw onboard --install-daemon`)
Ajouter une fonction dans le CLI pour automatiser le déploiement du service :
1. Générer le fichier service avec le bon nom d'utilisateur.
2. Écrire dans `/etc/systemd/system/`.
3. Activer et démarrer via `systemctl`.

#### Usage final
```bash
# Configuration + daemon
geminiclaw onboard --install-daemon

# Gestion simplifiée
sudo systemctl status geminiclaw@$(whoami)
journalctl -u geminiclaw@$(whoami) -f
```

---

### Récapitulatif des fichiers à créer/modifier

| Fichier | Action |
|---|---|
| `install.sh` | Créer — script curl-installable |
| `packages/cli/src/commands/onboard.ts` | Créer — wizard interactif |
| `packages/cli/src/commands/start.ts` | Modifier — utiliser `GEMINICLAW_HOME` |
| `packages/cli/src/index.ts` | Ajouter la commande `onboard` |
| `scripts/geminiclaw.service.template` | Créer — template du fichier systemd |

*Dernière mise à jour technique : 2026-03-01*
