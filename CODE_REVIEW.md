# Code Review — ashbi-platform

**Date:** May 1, 2026
**Reviewer:** Pi AI
**Scope:** Full-stack (Fastify backend + React/Vite frontend + Prisma + Docker)

---

## Executive Summary

Ashbi Platform is an ambitious agency management hub with 90+ route files, 30+ frontend pages, AI integrations, and a PostgreSQL + Redis + Socket.IO stack. The codebase shows strong feature velocity but has several systemic issues around **auth consistency, test coverage, dependency bloat, and input validation** that should be addressed before the next production deploy.

**Risk Level:** 🟡 Medium — fixable, but the auth gaps and zero validation on many routes need immediate attention.

---

## 🔴 Critical Issues

### 1. Auth Gaps on Multiple Route Files
**Severity:** CRITICAL
**Files:** Multiple route files use `fastify.authenticate` inconsistently

While many routes properly use `{ onRequest: [fastify.authenticate] }`, there are 5 route files with **zero** use of `fastify.authenticate` or `fastify.adminOnly`:

| File | Routes | Auth Mechanism | Risk |
|------|--------|----------------|------|
| `bot.routes.js` | 52 | Custom Bearer token (BOT_SECRET) | Low — has its own auth |
| `client-portal.routes.js` | 15 | Custom `clientAuth` (JWT verify) | Low — has its own auth |
| `portal.routes.js` | 12 | Token-based (viewToken in URL) | ⚠️ Medium — some routes may expose data |
| `approvals.routes.js` | 4 | Custom `requireAuth` using `jwtVerify` | Low — inline equivalent |
| `mailgun-hitl.routes.js` | 1 | Likely webhook (no auth) | ⚠️ Medium — depends on webhook validation |

**Recommendation:** Standardize. Use `fastify.authenticate` / `fastify.adminOnly` consistently. Custom auth middleware in each file creates confusion and potential gaps.

### 2. No Input Validation on Most Routes
**Severity:** CRITICAL
**Files:** ~80% of route files

Only `auth.routes.js` uses Fastify's JSON schema validation (`schema: { body: { ... } }`). The vast majority of routes accept `request.body` / `request.params` / `request.query` with **no schema validation**:

```js
// Typical pattern — no validation
fastify.post('/:id/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
  const { title, description, priority } = request.body; // ← no validation
  ...
});
```

**Impact:**
- Malformed data can crash the server (unhandled TypeErrors)
- Invalid data can be persisted to the database
- Potential for prototype pollution or unexpected behavior

**Recommendation:** Add Fastify JSON schema validation to every mutation route. At minimum, validate `required` fields and types. Use Zod (already installed) for reusable schemas.

### 3. Client Portal — Token in URL Query String
**Severity:** HIGH
**File:** `src/routes/client-portal.routes.js`

The client auth middleware accepts tokens from `request.query.token`:
```js
const rawToken = request.query?.token || ...
```

JWT tokens in URLs are logged in browser history, proxy logs, and Referer headers. Combined with a 7-day cookie expiry, this creates a token leakage risk.

**Recommendation:**
- Remove query-string token acceptance for authenticated endpoints
- Use the magic-link flow to POST the token and set the cookie, then redirect
- Tokens should only be in cookies (`httpOnly: true, secure: true`) — which is already set ✅

### 4. Register Endpoint — First-User Admin Escalation
**Severity:** HIGH
**File:** `src/routes/auth.routes.js:98-110`

The `/register` endpoint makes the **first user ADMIN** automatically:
```js
const userRole = userCount === 0 ? 'ADMIN' : role;
```

If the database is wiped/reset, anyone who hits `/register` first becomes admin. No rate limiting beyond the auth rate limiter.

**Recommendation:**
- Add an `ADMIN_INVITE_TOKEN` env var required for the first admin registration
- Or seed the admin user in `prisma/seed.js` and disable public registration

---

## 🟠 High Priority Issues

### 5. Mixed Package.json (Backend + Frontend deps in root)
**Severity:** HIGH
**File:** `package.json`

The root `package.json` installs both backend deps (`fastify`, `@prisma/client`, `bcrypt`) AND frontend deps (`react`, `react-dom`, `@radix-ui/*`, `tailwindcss`, `lucide-react`). The `web/` folder also has its own `package.json`.

**Impact:**
- Backend Docker image includes React, Radix, Tailwind — hundreds of MB of unnecessary deps
- Dual installs cause confusion — `npm install` must be run in both root and `web/`
- Version conflicts between root and `web/` React versions

**Recommendation:** Move all frontend deps to `web/package.json`. Root should only contain backend deps + dev tooling. The Dockerfile already uses multi-stage builds — separate `npm install` stages.

### 6. File Upload — No File Type Validation
**Severity:** HIGH
**File:** `src/routes/client-portal.routes.js:247-280`

File uploads accept **any file type** (50MB limit only):
```js
const data = await request.file(); // accepts anything
```

No validation of:
- File extension/mimetype allowlist
- Filename sanitization (path traversal risk)
- Virus/malware scanning
- Image dimension limits

**Recommendation:**
```js
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf', ...];
if (!ALLOWED_TYPES.includes(data.mimetype)) {
  return reply.status(400).send({ error: 'File type not allowed' });
}
```

### 7. File Upload — Path Traversal Risk
**Severity:** HIGH
**File:** `src/routes/client-portal.routes.js:258`

```js
const ext = path.extname(data.filename).toLowerCase();
const filename = `${randomUUID()}${ext}`;
```

The `ext` from user-provided filename could theoretically be crafted (e.g., `.html`, `.svg` with embedded JS). While UUID randomization mitigates directory traversal, the stored file extension determines how the file might be served by `@fastify/static`.

**Recommendation:** Whitelist allowed extensions. Strip or reject double extensions.

### 8. Prisma Schema — Missing Indexes on Hot Paths
**Severity:** HIGH
**File:** `prisma/schema.prisma`

Several high-traffic columns lack indexes:
- `Task.assigneeId` — queried for user workloads
- `Project.clientId` — queried for client portal
- `ChatMessage.projectId` — queried for project chat
- `Invoice.clientId` — queried for client invoices
- `Expense.clientId` — queried for client expenses
- `User.email` — has `@unique` (implicit index ✅)
- `Thread.assignedToId` — queried for user assignments

**Recommendation:** Run `EXPLAIN ANALYZE` on your top 10 queries and add `@@index` where needed:
```prisma
model Task {
  ...
  @@index([assigneeId])
  @@index([projectId, status])
}
```

### 9. WebSocket — join Room Allows Impersonation
**Severity:** HIGH
**File:** `src/index.js:213-220`

```js
socket.on('join', (userId) => {
  if (userId !== socket.userId && !socket.isClient) {
    socket.disconnect(true);
    return;
  }
  socket.join(`user:${userId}`);
});
```

The `!socket.isClient` check allows CLIENT role users to join any room matching their `socket.userId`. But the comparison `userId !== socket.userId` means a client can only join their own room. However, the `join-project` event has **no authorization check**:

```js
socket.on('join-project', (projectId) => {
  socket.join(`project:${projectId}`); // ← no check that user belongs to this project
});
```

Any authenticated user can join any project's Socket.IO room and receive real-time messages.

**Recommendation:** Verify the user is a team member or the project belongs to their client before joining the project room.

---

## 🟡 Medium Priority Issues

### 10. Password Requirements Inconsistent
**Files:**
- `auth.routes.js:86` — `minLength: 6` (schema validation for login)
- `auth.routes.js:178` — `newPassword.length < 8` (reset password)
- Register endpoint — **no minimum at all**

**Recommendation:** Enforce consistent min 8 characters everywhere. Add Zod schema for password complexity.

### 11. Credential Model — Passwords Stored as Encrypted Strings
**File:** `prisma/schema.prisma:Credential`

```prisma
password  String // AES-256 encrypted
```

The `crypto.js` implementation is solid (AES-256-GCM with proper IV and auth tag). However, credentials are decrypted and sent to the frontend. The **decryption key** (`CREDENTIALS_KEY`) is the same key used for all clients — no per-client isolation.

**Recommendation:** Consider whether the frontend truly needs decrypted passwords or just metadata. If passwords must be shown, add audit logging for every decryption event.

### 12. No Pagination on Several List Endpoints
**Files:** Multiple route files

Some list endpoints have pagination (e.g., `approvals`), but many don't:
```js
fastify.get('/clients', ..., async (request) => {
  const clients = await prisma.client.findMany({ ... }); // ← no limit/skip
});
```

As data grows, these will return thousands of records.

**Recommendation:** Add `take`/`skip` pagination with sensible defaults (50 per page).

### 13. Email Templates — Hardcoded HTML in Route Files
**Files:** `auth.routes.js`, `client-portal.routes.js`

Email HTML is inline string literals in route files (100+ lines of HTML). This is hard to maintain and impossible for non-developers to edit.

**Recommendation:** Use the existing `src/emails/*.html` templates with Handlebars (already installed) or move to the `src/utils/email-templates/` directory.

### 14. Socket.IO CORS — Dev Mode Allows `*`
**File:** `src/index.js:161`

```js
cors: {
  origin: env.isDev ? '*' : env.corsOrigins,
  credentials: true
}
```

In dev, any origin can connect to WebSockets. This is fine for localhost dev but dangerous if `NODE_ENV` is misconfigured.

### 15. Docker Compose — Postgres Exposed on Host
**File:** `docker-compose.yml`

```yaml
postgres:
  ports:
    - "5432:5432"  # ← exposed to host network
```

Postgres is accessible from the host and potentially the internet. Same for Redis on `6379`.

**Recommendation:** Remove the `ports` mapping for postgres and redis in production compose. Only the app needs to reach them via the `ashbi-network`.

---

## 🔵 Low Priority / Code Quality

### 16. Test Coverage — Critically Low
**Files:** `src/tests/` (3 files)

Only 3 test files for a codebase with 90+ routes:
- `auth-gate.test.js`
- `auth-login.test.js`
- `invoice.test.js`

No tests for: projects, clients, tasks, invoices CRUD, portal auth, webhooks, AI routes.

**Recommendation:** Prioritize:
1. Auth flow tests (register, login, JWT expiry, role guards)
2. Invoice/finance route tests (money is involved)
3. Client portal auth tests (token-based access)
4. Webhook signature verification tests

### 17. Route Files Are Fat — No Consistent Service Layer
Most routes contain inline business logic. A few have service files (`src/services/`), but there's no consistent separation. Routes average 200-400 lines with mixed concerns (validation, auth, DB queries, responses).

**Recommendation:** Adopt a consistent pattern:
- **Route**: Schema validation + auth guard + calls service
- **Service**: Business logic + DB queries
- **Controller** (optional): If routes get too long

### 18. `prisma` Imported from `index.js` Circular Risk
**File:** `src/config/db.js:3`

```js
const prisma = new PrismaClient();
export default prisma;
```

But routes import it via:
```js
import { prisma } from '../index.js';
```

This works because of ESM module caching, but it's fragile. If `index.js` ever has side effects that depend on routes being loaded, this creates circular dependency issues.

**Recommendation:** Import `prisma` directly from `config/db.js` everywhere, not from `index.js`.

### 19. Legacy SHA-256 Hash Support
**File:** `src/routes/auth.routes.js:16-20`

```js
if (!hash.startsWith('$2')) {
  const sha256 = crypto.createHash('sha256').update(password).digest('hex');
  return sha256 === hash;
}
```

Old SHA-256 hashes are auto-upgraded on next login, which is good. But there's no migration script to force-upgrade all remaining legacy hashes. If some users never log in again, their passwords remain weakly hashed.

**Recommendation:** Add a migration script that forces password reset for accounts still using SHA-256.

### 20. `package.json` name Mismatch
**File:** `package.json`

```json
"name": "agency-hub"
```

But the repo/product is `ashbi-platform`. This can cause confusion with npm scripts, Docker image names, and deployment tooling.

### 21. Frontend — Missing Error Boundary
**File:** `web/src/App.jsx`

There's an `ErrorBoundary.jsx` component in `components/` but it's **not used** in `App.jsx`. Lazy-loaded components can crash the entire UI without it.

**Recommendation:** Wrap `<Suspense>` blocks with `<ErrorBoundary>`.

### 22. Frontend — 38,000+ Lines of JSX
The `web/src/pages/` and `web/src/components/` directories total ~38,841 lines. Some pages are likely very large monolithic components.

**Recommendation:** Audit the largest page files and extract shared sub-components.

### 23. No CSRF Protection
The API uses `httpOnly` cookies for JWT. While `sameSite: strict` (production) helps, there's no explicit CSRF token mechanism. If the app ever adds state-changing GET endpoints or the browser doesn't enforce SameSite, this becomes exploitable.

**Recommendation:** Fastify's cookie plugin supports signed cookies — consider adding CSRF tokens for mutation endpoints.

---

## 📊 Summary Table

| # | Issue | Severity | File(s) |
|---|-------|----------|---------|
| 1 | Inconsistent auth middleware patterns | 🔴 Critical | Multiple routes |
| 2 | No input validation on most routes | 🔴 Critical | ~80% of routes |
| 3 | JWT token in URL query string | 🟠 High | client-portal.routes.js |
| 4 | First-user admin escalation | 🟠 High | auth.routes.js |
| 5 | Mixed backend+frontend deps in root | 🟠 High | package.json |
| 6 | No file type validation on uploads | 🟠 High | client-portal.routes.js |
| 7 | Path traversal risk on upload extensions | 🟠 High | client-portal.routes.js |
| 8 | Missing DB indexes on hot paths | 🟠 High | schema.prisma |
| 9 | Socket.IO project room — no auth check | 🟠 High | index.js |
| 10 | Inconsistent password requirements | 🟡 Medium | auth.routes.js |
| 11 | Credential vault — no per-client key isolation | 🟡 Medium | crypto.js |
| 12 | No pagination on several list endpoints | 🟡 Medium | Multiple routes |
| 13 | Hardcoded email HTML in route files | 🟡 Medium | auth, client-portal |
| 14 | WebSocket CORS `*` in dev | 🟡 Medium | index.js |
| 15 | Postgres/Redis ports exposed in Docker | 🟡 Medium | docker-compose.yml |
| 16 | Critically low test coverage (3 files) | 🔵 Low | src/tests/ |
| 17 | No consistent service layer | 🔵 Low | src/routes/ |
| 18 | Prisma imported from index.js circular risk | 🔵 Low | config/db.js |
| 19 | Legacy SHA-256 hashes not force-migrated | 🔵 Low | auth.routes.js |
| 20 | Package name mismatch (agency-hub) | 🔵 Low | package.json |
| 21 | Frontend ErrorBoundary not used | 🔵 Low | App.jsx |
| 22 | 38K+ lines of JSX — monolithic pages | 🔵 Low | web/src/ |
| 23 | No CSRF token protection | 🔵 Low | index.js |

---

## ✅ What's Working Well

1. **AES-256-GCM encryption** for credentials vault — properly implemented with IV + auth tag
2. **Stripe webhook verification** — raw body preservation for signature checking
3. **Rate limiting** — global + auth-specific (5/15min for login/register)
4. **JWT cookie security** — `httpOnly`, `secure`, `sameSite: strict` in production
5. **Graceful shutdown** — SIGINT/SIGTERM handlers
6. **Docker health checks** — proper HEALTHCHECK in Dockerfile
7. **Error sanitization** — 500 errors don't leak details in production
8. **Lazy loading** — Frontend pages are code-split with React.lazy()
9. **Auto hash upgrade** — Legacy SHA-256 → bcrypt on next login
10. **Multi-stage Docker build** — Efficient image with frontend builder stage

---

## 🎯 Recommended Priority Order

1. **Week 1:** Fix auth gaps (#1), add validation to mutation routes (#2), fix Socket.IO project room auth (#9)
2. **Week 2:** Separate package.json deps (#5), add file type validation (#6), fix client portal token in URL (#3)
3. **Week 3:** Add DB indexes (#8), add pagination (#12), add ErrorBoundary (#21)
4. **Week 4:** Write auth + finance route tests (#16), first-user registration fix (#4), CSRF tokens (#23)