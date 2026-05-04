# Ashbi Platform - Enterprise Architecture Guide

This project has been upgraded to a high-end enterprise-grade architecture. All future development must adhere to these standards.

## 1. Multi-Tenancy (Data Isolation)
The application uses a **Virtual Private Database** pattern.
- **NEVER** import `prisma` from `config/db.js` directly in route handlers.
- **ALWAYS** use `request.prisma`. This is a scoped proxy that automatically filters all queries by `organizationId`.
- To support a new model in multi-tenancy, add it to the `scopedModels` list in `src/utils/prisma-tenant-proxy.js`.

## 2. Event-Driven Architecture (EDA)
Core business logic must be decoupled from side-effects.
- **Pattern:** `Route -> Service -> Event Bus -> Subscriber`.
- Use the `bus` from `src/utils/events.js` to emit events for side-effects like:
    - Sending emails/notifications.
    - Queuing AI embeddings.
    - Syncing with 3rd party APIs.
- Real-time updates to the frontend are handled automatically via the **Socket.IO Bridge** (`src/subscribers/socket.subscriber.js`).

## 3. Observability
- **Logging:** Use `request.log` (Fastify's Pino instance). Avoid `console.log`.
- **Tracing:** The app is instrumented with **OpenTelemetry**. Every request is traceable across DB queries and external calls.

## 4. Testing & Compliance
- **100% Coverage:** Aim for 100% coverage on all new business logic.
- **Compliance Workflow:** The `.github/workflows/enterprise-compliance.yml` enforces:
    - Passing unit tests.
    - Linting.
    - **Multi-Tenancy Guard:** Fails the build if direct `prisma` imports are found in routes.

## 5. Visual Standards
- **Typography:** Use `Instrument Serif` for headers and high-impact data.
- **Interaction:** Use the `.hover-lift` utility for interactive elements.
- **Glassmorphism:** Use `.glass-card` and `.glass-header` for modern, immersive UI layers.
