# API contract

[`docs/openapi.json`](openapi.json) is the OpenAPI 3.1 description of the Ashbi
Hub HTTP API, asked for in #412 ("versioned OpenAPI or equivalent contract
specification"). It is **generated from code**. Do not edit it by hand: CI
fails when it drifts from the routes.

## How it is generated

`scripts/generate-openapi.mjs` builds the Fastify app the same way the unit
tests do (`buildApp({ initializeRuntime: false })`, `NODE_ENV=test`, no
database, Redis or network). The route inventory in
`src/tests/helpers/route-inventory.js` records every registered route. The API
access matrix test ([api-access-matrix.md](api-access-matrix.md)) uses the same
inventory, so the two documents describe the same set of routes.

For each route the generator emits:

| OpenAPI field | Source |
| --- | --- |
| path, method | The registered Fastify route. `:id` becomes `{id}`, and every path parameter is declared. HEAD twins of GET routes and trailing-slash aliases are omitted, as in the access matrix. `OPTIONS *` (CORS preflight) cannot be expressed as an OpenAPI path and is left out. |
| `requestBody` | The Zod schema passed to `validateBody(...)` in the route's lifecycle, or a Fastify JSON `schema.body`. Schemas exported from `src/validators/schemas.js` become named `components.schemas` entries (`createProjectSchema` becomes `CreateProject`). |
| query / path parameters | Zod schemas passed to `validateQuery(...)` / `validateParams(...)`. Path parameters with no validator are typed as strings. |
| `security`, `x-access` | The auth guard found in the route's lifecycle (see [Auth schemes](#auth-schemes)). `x-access` is the guard name used in the access matrix, or `public`. |
| `x-tenancy` | `scoped` when `tenancyMiddleware` gives the route an organization-scoped Prisma client, `exempt` when the route gets the raw client. |
| `x-requires-recent-auth` | Present on privileged actions that also need a step-up `reauth` cookie from `POST /api/auth/reauth` (see [privileged actions](privileged-actions.md)). Without it they answer `403` with `code: REAUTH_REQUIRED`. |
| `x-api-key-scopes` | The API-key scope the route requires (for example `ai_bridge:actions`). A key without it gets `403` with `code: INSUFFICIENT_SCOPE`. |
| `tags` | The first path segment after `/api/` (for example `invoices`). |
| `info.version` | `version` in `package.json`. |

`validateBody`, `validateQuery` and `validateParams` attach the schema they
check to the hook they return (`zodSchema`, `zodTarget`). This is how the
generator finds a route's schema. Request handling does not change.

Zod 3 schemas become JSON Schema through the small converter in
`src/tests/helpers/zod-to-json-schema.js`. The installed zod has a `zod/v4`
`toJSONSchema`, but it does not accept v3 schemas, so no new dependency is
used. The converter describes the input a client sends:

- `.default()` fields are optional and carry the default value;
- coerced values are described by their target type;
- `refine`, `superRefine`, `transform` and `preprocess` are described by their
  inner schema, so cross-field rules are not in the spec.

If the converter meets a Zod type or check it does not know, it throws. This
makes `check:openapi` fail rather than publish a vague schema.

### Regenerating

```bash
npm run docs:openapi     # rewrite docs/openapi.json
npm run check:openapi    # exit 1 if docs/openapi.json is stale (runs in CI)
```

The output is deterministic: object keys are sorted recursively and the file
ends with a newline. `npm test` (`src/tests/unit/openapi.test.js`) also fails
when the file is stale. The same tests check that every entry in
`src/tests/fixtures/route-table.json` is in the spec, that every route with a
body validator has a `requestBody`, and that the document is structurally
sound: unique `operationId`s, declared path parameters, and resolvable `$ref`s.

### Known gaps

- **Response bodies are not described.** Each operation lists a generic `2XX`
  plus the shared error responses below.
- Some routes take a JSON body with no route-level validator, so they have no
  `requestBody`. Examples: the `/api/bot/*` routes, signed webhooks that
  verify the raw body, multipart uploads, and `POST /api/client-acquisition/intake`,
  which validates inside its handler. Adding `validateBody(...)` to such a
  route adds its body to the spec.
- The ChatGPT Actions spec, [chatgpt-actions.openapi.yaml](chatgpt-actions.openapi.yaml),
  is maintained by hand for that integration. It is separate from this
  document.

## Auth schemes

| Scheme | Access matrix guard | What the client sends |
| --- | --- | --- |
| `cookieAuth` | `staff`, `admin` | The httpOnly `token` cookie from `POST /api/auth/login` (JWT). `admin` routes also require role `ADMIN`. |
| `bearerAuth` | `staff`, `admin`, `client-portal` | The same session JWT as `Authorization: Bearer <jwt>`. |
| `apiKey` | `api-key` | `x-api-key: ashbi_...` (a user API key from `/api/api-keys`). |
| `apiKeyBearer` | `api-key` | The same key as `Authorization: Bearer ashbi_...`. |
| `clientPortalCookie` | `client-portal` | The `token` cookie set by the client portal magic-link or client login flow. |
| `botBearer` | `bot-secret` | `Authorization: Bearer <BOT_SECRET>`. |
| none | `public` | Nothing. Each public route is on the reviewed allowlist in the access matrix test, with the reason. |

Sessions must also be current: revoked sessions get `401`. Signed-in staff
routes with `x-tenancy: scoped` return `403` to client-portal sessions and to
sessions with no organization.

## Error contract

Error responses are JSON objects with at least an `error` string
(`components.schemas.Error`):

```json
{ "error": "Invoice not found", "code": "OPTIONAL_MACHINE_CODE" }
```

- `error` (always present): a human-readable message from a route, or an
  error name from the global error handler (for example `InternalServerError`).
- `code` (optional): a stable machine-readable code, where the route defines one.
- Errors that reach the global error handler also carry `message`,
  `statusCode` and `traceId`. Some routes add fields, such as `fields` on an
  intake validation error.

Validation failures from `validateBody` / `validateQuery` / `validateParams`
return `400` with `error` set to `path: message` pairs joined by `; `.

The shared responses are `400 BadRequest`, `401 Unauthorized`, `403 Forbidden`,
`404 NotFound`, `409 Conflict`, `429 TooManyRequests` (global rate limit) and
`500 InternalError`. The generator attaches them to operations by rule, not
from the handler code:

- every operation gets `429` and `500`;
- `400` goes to operations with a body or parameters;
- `401` and `403` go to guarded operations;
- `404` goes to operations with path parameters.

## Versioning and deprecation (proposal, pending owner approval)

> **Status: proposal.** Nothing below is an adopted policy yet. The API has one
> first-party consumer (the web SPA in this repo) plus the AI bridge and bot
> integrations. Paths are not versioned today, apart from the
> `/api/ai-bridge/v1/...` routes. The owner should approve, change or reject
> these points.

1. **Contract version.** `info.version` follows `package.json` `version`
   (currently `1.0.0`). It is proposed to bump the minor version for additive
   changes (new routes, new optional fields) and the major version for
   breaking changes. The diff of `docs/openapi.json` in a pull request shows
   the contract change for review.
2. **What counts as breaking.** Proposed list:
   - removing or renaming a route, field or enum value;
   - making an optional request field required;
   - tightening a validation limit;
   - changing auth requirements;
   - changing the error shape.
3. **Deprecation.** It is proposed to mark a route `deprecated: true` in the
   spec (via a route option the generator reads, still to be built). It would
   stay available for at least one release, or a set notice period for
   external integrations (the AI bridge, the bot), before removal. The change
   would be noted in the release notes.
4. **Path versioning.** It is proposed to keep unversioned `/api/...` paths
   for the first-party SPA, which ships with the backend. Explicit version
   prefixes (like `/api/ai-bridge/v1`) would be used only for surfaces that
   external clients depend on.
