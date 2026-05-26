#!/bin/sh
set -e

echo "Running database schema sync..."
npx prisma migrate deploy || { echo "🚨 Migration failed — exiting"; exit 1; }

echo "Generating Prisma client..."
npx prisma generate || { echo "🚨 Prisma generate failed — exiting"; exit 1; }

echo "Building frontend (if needed)..."
npx vite build --outDir dist || echo "⚠️ Frontend build failed — serving existing dist if present"

echo "Starting Ashbi Platform..."
exec node --import ./src/tracing.js src/index.js