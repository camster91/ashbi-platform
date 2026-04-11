# Multi-stage build for Ashbi Platform
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY web/ ./
RUN npm run build

# Stage 2: Build backend + production image
FROM node:20-alpine

# Install OpenSSL (required by Prisma) and dumb-init for proper signal handling
RUN apk add --no-cache openssl dumb-init

WORKDIR /app

# Copy backend package files
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/web/dist ./dist

# Copy backend source
COPY src/ ./src/
COPY scripts/ ./scripts/

# Default environment
ENV NODE_ENV=production
ENV PORT=3002

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/api/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "scripts/start.sh"]