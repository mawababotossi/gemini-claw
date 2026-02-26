FROM node:20-slim AS base
RUN npm install -g pnpm
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/memory/package.json ./packages/memory/
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/channels/webchat/package.json ./packages/channels/webchat/
COPY packages/channels/telegram/package.json ./packages/channels/telegram/
COPY packages/channels/whatsapp/package.json ./packages/channels/whatsapp/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS builder
COPY packages/ ./packages/
RUN pnpm build

# Production image — slim
FROM node:20-slim AS runner
RUN npm install -g pnpm
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/
COPY --from=builder /app/packages/*/dist ./packages/
COPY packages/channels/webchat/public ./packages/channels/webchat/public
COPY pnpm-workspace.yaml package.json ./

# Data and config mounted as volumes
VOLUME ["/app/data", "/root/.gemini"]

EXPOSE 3000 3001

CMD ["node", "packages/gateway/dist/server.js"]
