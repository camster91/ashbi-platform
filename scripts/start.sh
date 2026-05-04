#!/bin/sh
set -e

echo "Running database schema sync..."
npx prisma db push --skip-generate --accept-data-loss 2>/dev/null || echo "Warning: Database sync failed, continuing anyway"

echo "Starting Ashbi Platform..."
exec node --import ./src/tracing.js src/index.js