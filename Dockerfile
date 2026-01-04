FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install build dependencies for native modules (node-pty), git, and Docker CLI + Compose
RUN apk add --no-cache python3 make g++ linux-headers git bash docker-cli docker-cli-compose

# Install Claude Code CLI and Gemini CLI globally
RUN npm install -g @anthropic-ai/claude-code @google/gemini-cli

# The node:alpine image already has a 'node' user (uid 1000)

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install dependencies (not using frozen-lockfile for self-hosted flexibility)
RUN pnpm install

# Copy source code
COPY . .

# Build shared types
RUN pnpm --filter shared build

# Build frontend
RUN pnpm --filter frontend build

# Create directories and set permissions for node user
RUN mkdir -p /home/node/.claude && \
    chown -R node:node /app /home/node

# Expose ports
EXPOSE 3001

# Set environment
ENV NODE_ENV=production
ENV HOME=/home/node

# Switch to non-root user
USER node

# Start the server using tsx (handles ES module resolution)
CMD ["npx", "tsx", "packages/backend/src/index.ts"]
