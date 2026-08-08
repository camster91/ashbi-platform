# syntax=docker/dockerfile:1.7
# Multi-stage build for Ashbi Platform
# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Build backend + production image
FROM node:22-alpine

# Install OpenSSL (required by Prisma) and dumb-init for proper signal handling
RUN apk add --no-cache openssl dumb-init

WORKDIR /app

# Copy backend package files
COPY package.json package-lock.json ./
# Package lifecycle scripts for native modules are extremely slow under QEMU
# and can exhaust the multi-architecture CI timeout. Install the locked tree
# first, then rebuild only the native dependency needed at runtime. Prisma's
# target-specific client is generated explicitly after its schema is copied.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm rebuild bcrypt

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/web/dist ./dist

# Copy backend source
COPY src/ ./src/
COPY scripts/ ./scripts/

# SECURITY: Keep application code and dependencies read-only, and grant the
# unprivileged runtime user write access only to the directories that hold
# uploads or runtime-managed integration state. Recursively chowning the full
# dependency tree is especially slow under arm64 emulation.
RUN mkdir -p /app/uploads /app/config \
  && chown node:node /app/uploads /app/config
USER node

# Default environment
ENV NODE_ENV=production
ENV PORT=3002
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/api/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "scripts/start.sh"]
