# Backend application boundaries

Ashbi's backend has two explicit composition layers:

- `src/index.js` owns application construction. `buildApp()` creates Fastify,
  registers security and infrastructure plugins in order, adds authentication
  and tenancy, registers routes, attaches Socket.IO, and returns the ready-to-
  initialize application without opening a network port.
- `src/server.js` owns the operating-system process. It initializes optional
  runtime providers, calls `buildApp()`, listens on the configured port, handles
  signals and fatal process errors, and closes Fastify, runtime-health clients,
  and Prisma during shutdown.

Tests and local tools must import `buildApp()` and use Fastify `inject()`. They
must not import `src/server.js`, bind a port, register process handlers, or call
`process.exit()`.

## Dependency direction

Routes, services, agents, and subscribers must not import `src/server.js` or
`src/index.js`. Runtime dependencies are passed inward:

- subscribers receive the Fastify and Socket.IO instances;
- notification persistence receives an optional Socket.IO emitter;
- routes use the request-scoped `request.prisma` client;
- application configuration that prevents isolated construction is supplied
  through `buildApp()` options.

This avoids entry-point import cycles and keeps tenant-scoped request ownership
visible. New infrastructure should follow the same direction: server -> app ->
domain module, never domain module -> entry point.

## Route domains

Route registration is moving out of `src/index.js` one contiguous vertical at
a time. `src/domains/revenue/register-core-routes.js` owns the first extracted
proposal-to-cash sequence: invoice chasing, invoices, contracts, and proposals.
`src/domains/client-delivery/register-collaboration-routes.js` owns the next
project-collaboration sequence: messages, revisions, calendar, comments,
attachments, time, and milestones. These registrars preserve their original
prefixes and order. `src/domains/client-delivery/register-work-management-routes.js`
owns the contiguous client-to-work sequence: clients, projects, and tasks.
`src/domains/client-communications/register-routes.js` owns the contiguous
response-to-delivery sequence: responses, threads, webhooks, the authenticated
client portal, and Gmail. It preserves the existing order so inbound and
outbound communication behavior remains unchanged.
`src/domains/client-communications/register-conversation-routes.js` owns the
adjacent Ash AI and project-chat routes, preserving their established order and
prefixes independently from communication delivery integrations.
Subsequent independently reviewable slices should move
existing registrations, without changing prefixes or relative order, into
these domain groups:

1. identity and access: auth, team, settings, API keys, credentials;
2. client delivery: clients, projects, tasks, notes, files, portal, chat;
3. revenue: proposals, estimates, contracts, invoices, expenses, retainers;
4. automation and AI: AI, semantic search, agents, approvals, automations;
5. integrations and operations: Gmail, Mailgun, calendar, webhooks, WordPress;
6. platform: health, onboarding, notifications, search, trash, drafts.

Each future group extraction must preserve the registered prefix and ordering,
pass the complete route/auth and integration suites, and remain usable through
`buildApp()` without listening.
