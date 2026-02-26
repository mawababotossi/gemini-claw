#!/bin/bash
# GeminiClaw Installer
# --------------------
# curl -fsSL https://geminiclaw.ai/install.sh | bash

set -e

RESET="\033[0m"
BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"

echo -e "${BLUE}${BOLD}🤖 Welcome to the GeminiClaw Installer 🤖${RESET}"
echo -e "------------------------------------------"

# 1. Dependency Checks
echo -e "\n${BOLD}🔍 Checking dependencies...${RESET}"

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

if command_exists node; then
    NODE_VERSION=$(node -v | cut -d 'v' -f 2)
    echo -e "${GREEN}✅ Node.js v$NODE_VERSION found${RESET}"
else
    echo -e "${RED}❌ Node.js not found. Please install Node.js v18+ first.${RESET}"
    exit 1
fi

if command_exists pnpm; then
    PNPM_VERSION=$(pnpm -v)
    echo -e "${GREEN}✅ pnpm v$PNPM_VERSION found${RESET}"
else
    echo -e "${YELLOW}⚠️  pnpm not found. Installing pnpm...${RESET}"
    npm install -g pnpm
fi

if command_exists gemini; then
    echo -e "${GREEN}✅ gemini-cli found${RESET}"
else
    echo -e "${YELLOW}⚠️  gemini-cli not found. It is recommended to install it for ACP support.${RESET}"
    echo -e "Install with: npm install -g @google/gemini-cli"
fi

# 2. Project Setup
INSTALL_DIR="$HOME/gemini-claw"
if [ -d "$INSTALL_DIR" ]; then
    echo -e "\n${YELLOW}⚠️  Existing installation found at $INSTALL_DIR${RESET}"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    rm -rf "$INSTALL_DIR"
fi

echo -e "\n${BOLD}🚀 Cloning GeminiClaw repository...${RESET}"
git clone https://github.com/mawababotossi/gemini-claw.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo -e "\n${BOLD}📦 Installing dependencies...${RESET}"
pnpm install

echo -e "\n${BOLD}🛠️ Building packages...${RESET}"
pnpm build

# 3. Configuration
if [ ! -f ".env" ]; then
    echo -e "\n${BOLD}📝 Configuring environment...${RESET}"
    cp .env.example .env || touch .env
    echo -e "${YELLOW}Please edit $INSTALL_DIR/.env to add your API keys.${RESET}"
fi

# 4. Finalizing
echo -e "\n${BOLD}✅ Installation complete!${RESET}"
echo -e "------------------------------------------"
echo -e "To get started:"
echo -e "  1. ${BLUE}cd $INSTALL_DIR${RESET}"
echo -e "  2. ${BLUE}Edit .env with your keys${RESET}"
echo -e "  3. ${BLUE}pnpm run start${RESET}"
echo -e "\n${GREEN}${BOLD}Enjoy your AI Agents! 🤖✨${RESET}"
