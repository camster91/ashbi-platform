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

`src/index.js` no longer imports or registers any `src/routes/*.routes.js`
module. Every route module is registered by exactly one domain registrar under
`src/domains/<domain>/register-*.js`, and the factory calls the registrars in
this order:

| Registrar | Domain | Route modules (prefix) |
| --- | --- | --- |
| `identity/register-routes.js` | identity and access | auth, settings, API keys, credentials, team |
| `client-delivery/register-work-management-routes.js` | client delivery | clients, projects, tasks |
| `client-communications/register-inbox-routes.js` | client communications | inbox, email triage |
| `platform/register-routes.js` | platform | dashboard, notifications, realtime, push, trash, drafts, search |
| `ai/register-routes.js` | automation and AI | AI, AI bridge, semantic search, automations, AI context, AI team, bot, approvals |
| `revenue/register-commercial-routes.js` | revenue | proposal builder, estimates, rate cards, pipeline, expenses, leads, client acquisition, retainers |
| `integrations/register-routes.js` | integrations and operations | integrations, command center, Mailgun HITL, Mailgun, Slack events, Slack admin, Google Calendar |
| `client-delivery/register-workspace-routes.js` | client delivery | brand, time tracking, time sessions, creative briefs, asset library, templates, public portal, onboarding, notes (`/api`) |
| `revenue/register-core-routes.js` | revenue | invoice chasing, invoices, contracts, proposals |
| `client-delivery/register-collaboration-routes.js` | client delivery | messages, revisions, calendar, comments, attachments, time, milestones |
| `client-communications/register-conversation-routes.js` | client communications | Ash AI chat, project chat |
| `client-communications/register-routes.js` | client communications | responses, threads, webhooks, client portal, Gmail |

`identity/register-routes.js` also re-exports `authenticateApiKey`, which the
factory decorates as `authenticateWithApiKey`, so the factory depends only on
domains. The inline `/api/live` and `/api/health` probes stay in the factory
because they are infrastructure, not a routes module.

### Ordering rules

Security plugins, the JSON content-type parser, the global rate limiter, JWT
and session verification, auth decorators, and tenancy are registered in
`buildApp()` before any registrar runs, so every route inherits them exactly
as before. Inside each registrar, route modules keep their pre-extraction
relative order.

Grouping by domain changed the relative order of some route modules across
domains. That is behavior-preserving because every route module is an
encapsulated Fastify plugin: none uses `fastify-plugin` or `skip-override`,
so hooks added inside one (for example the automation admin guard or the bot
pre-handler) and per-route `rateLimit` config cannot affect sibling plugins,
and the router's matching is independent of insertion order. A route module
that needs to escape encapsulation must be reviewed against this ordering
first.

### Guards

- `src/tests/fixtures/route-table.json` is the sorted `METHOD URL` table of
  the app built with `buildApp()` (captured before the final extraction);
  `src/tests/unit/route-table.test.js` fails if any route is added, removed,
  or re-prefixed. Regenerate intentionally with `UPDATE_ROUTE_TABLE=1` and
  review the diff.
- `src/tests/unit/application-factory.test.js` asserts each registrar's exact
  prefixes and order, single ownership of every route module, that
  `src/index.js` registers no route module directly, and that route modules
  stay encapsulated.

New route modules belong in the registrar for their domain, never directly in
`src/index.js`. Each change must preserve prefixes, pass the complete
route/auth and integration suites, and remain usable through `buildApp()`
without listening.
