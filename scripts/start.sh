#!/bin/sh
set -e

# SECURITY/HARDENING: This script runs inside the `app` container. Migrations
# have been moved to a separate `migrate` one-shot service in
# docker-compose.yml (depends_on with `service_completed_successfully`) so they
# apply exactly once before any app replica starts. Running `prisma migrate
# deploy` here would race with other replicas in a rolling deploy.

echo "Starting Ashbi Platform..."
exec node --import ./src/tracing.js src/index.js