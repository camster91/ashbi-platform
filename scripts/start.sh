#!/bin/sh
set -e

echo "Running database schema sync..."
npx prisma db push --skip-generate --accept-data-loss || echo "🚨 Database sync failed - this is likely causing the crash"

echo "Starting Ashbi Platform..."
exec node --import ./src/tracing.js src/index.js