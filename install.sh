#!/usr/bin/env bash
# @license Apache-2.0
# ClawGate — Installation Script
set -euo pipefail

INSTALL_DIR="${CLAWGATE_HOME:-$HOME/.clawgate}"
BIN_PATH="/usr/local/bin/clawgate"

echo "📦 Installing ClawGate into $INSTALL_DIR..."

# Dependency checks
command -v node >/dev/null 2>&1 || { echo '❌ Node.js required (v20+)'; exit 1; }
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm
command -v gemini >/dev/null 2>&1 || echo '⚠️  gemini-cli missing — install with: npm i -g @google/gemini-cli'
command -v claude >/dev/null 2>&1 || echo '⚠️  claude-code missing — install with: npm i -g @anthropic-ai/claude-code'
command -v codex >/dev/null 2>&1 || echo '⚠️  codex-cli missing'

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "♻️  Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "🚚 Cloning repository..."
  git clone https://github.com/mawababotossi/ClawGate.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
echo "🛠️  Installing dependencies..."
pnpm install --frozen-lockfile
echo "🏗️  Building project..."
pnpm build

# Symlink CLI
CLI_BIN="$INSTALL_DIR/packages/cli/dist/index.js"
chmod +x "$CLI_BIN"

echo "🔗 Creating symlink in $BIN_PATH (requires sudo)..."
sudo ln -sf "$CLI_BIN" "$BIN_PATH"

echo ""
echo "✅ ClawGate installed successfully!"
echo "💡 Run the configuration wizard: clawgate onboard"
