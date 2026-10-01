# Deploying Ashbi Hub with Coolify

Existing VPS production adoption uses `docker-compose.coolify-production.yml`
and the preserved external database, Redis and `/opt/ashbi-platform/data`
directories. Follow [checked-coolify-release.md](checked-coolify-release.md)
for its ownership transfer and required backup gate. The production release
controller rejects the fresh-database staging file.

`docker-compose.coolify.yml` is a complete Ashbi Hub stack for Coolify's
**Docker Compose** build pack. It contains the API, the background worker, a
one-shot migration runner, PostgreSQL 16 with pgvector, and Redis 7.

Until the owner records a decision in
[deployment-and-rollback.md](deployment-and-rollback.md) that production moves
to Coolify, the direct-VPS script remains the production controller. Use this
stack for staging or a new environment, and to rehearse that move.

## What the stack does

- **Migrations first.** `migrate` runs `prisma migrate deploy` against the
  committed migration chain and exits. `app` and `worker` start only after it
  succeeds.
- **Deploys have downtime.** Coolify runs `docker compose up`: the old API and
  worker are stopped before the migration runs and the new ones start, so
  expect an outage of the migration time plus about a minute. A failed
  migration leaves the API **down**, not on the old version; see
  [Rollback](#rollback). On redeploy the API gets 30 seconds and the worker
  120 seconds to finish in-flight work.
- **Expected status.** Coolify may show the stack as *degraded* after a
  deploy because the one-shot `migrate` container has exited. That is normal.
- **Persistent data** lives in named volumes that survive redeploys:
  - `pgdata`: the database;
  - `redisdata`: Redis, with append-only persistence;
  - `uploads` (`/app/uploads`): every uploaded file, shared by the API and
    the worker;
  - `appconfig` (`/app/config`): runtime integration state and the backup
    status file.
- **Nothing is published on the host.** Coolify's proxy routes your domain to
  `app` on port 3002. PostgreSQL and Redis are reachable only inside the stack.
- **Health.** The API container reports healthy when `/api/live` answers; the
  worker when its Redis heartbeat is fresh. `/api/health` shows database,
  Redis and worker readiness.
- **Build revision.** Coolify's `SOURCE_COMMIT` is passed as `APP_REVISION`
  when **Include Source Commit in Build** is enabled in the resource's
  settings (it is off by default); otherwise the revision reads `unknown`.

## One-time setup

1. In Coolify: **New resource → Public/Private repository → Docker Compose**.
   Choose this repository, branch `main`, and set the compose file location to
   `/docker-compose.coolify.yml`.
2. **Domain.** On the `app` service, set the domain with the container port,
   `https://hub.example.com:3002`. Coolify serves it on
   `https://hub.example.com` (the port only tells its proxy where to send
   traffic), fills `SERVICE_FQDN_APP_3002` and issues the TLS certificate.
   Before the first deploy, also decide `POSTGRES_USER` and `POSTGRES_DB` if
   you do not want the `ashbi` defaults: they only take effect when the
   database volume is first created.
3. **Environment variables.** Coolify generates `SERVICE_PASSWORD_POSTGRES`.
   Set the rest in the Environment Variables tab. Generate secrets with
   `openssl rand -hex 32` and never reuse them between environments.

   | Variable | Required | Value |
   | --- | --- | --- |
   | `JWT_SECRET` | yes | 64 random hex characters |
   | `CREDENTIALS_KEY` | yes | 64 random hex characters. **Back it up outside Coolify**: stored integration credentials cannot be decrypted without it |
   | `ADMIN_INVITE_TOKEN` | yes | random; used once to create the first admin |
   | `WEBHOOK_SECRET` | yes | random |
   | `APP_URL` | yes | the public URL, for example `https://hub.example.com` |
   | `HUB_URL` | yes | the same URL. Used in password-reset and invite emails, estimate links, automations and OAuth callbacks; unset, the app falls back to the production host |
   | `PORTAL_BASE_URL` | yes | the same URL (client portal and proposal links) |
   | `CORS_ORIGIN` | yes | the same origin as `APP_URL` |
   | `TRUST_PROXY` | no (default `1`) | `1` behind Coolify's single proxy |
   | `POSTGRES_DB`, `POSTGRES_USER` | no (default `ashbi`) | database name and role |
   | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_SIGNING_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY` | for email | Mailgun sending and webhooks |
   | `HITL_APPROVER_EMAIL` | for HITL email | email of the active ADMIN/TEAM user who receives human-in-the-loop notifications and emails; unset or unmatched creates none. Replies are applied only from that user or an admin of their org, with an SPF/DKIM pass aligned with the From domain |
   | `MAILGUN_ALLOW_UNSIGNED_INBOUND` | never on a deployed host | local-development opt-in to unsigned inbound email when `MAILGUN_SIGNING_KEY` is unset; ignored unless `NODE_ENV=development` |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for payments | use test-mode keys until the revenue flow is verified (#378) |
   | `AI_PROVIDER` plus that provider's key (`ANTHROPIC_API_KEY`, `OLLAMA_API_KEY`, …) | for AI features | `AI_DISABLED=true` turns AI off |
   | `SENTRY_DSN`, `OBSERVABILITY_OWNER`, `CREDENTIALS_KEY_OWNER` | recommended | error reporting and named owners; missing values are logged as warnings |

   The required variables are passed explicitly, and the deploy fails fast if
   one is missing. Every other variable reaches the containers through the
   `.env` file Coolify writes beside the compose file, so any integration
   variable from `.env.example` works the same way. The API refuses to start
   with any placeholder value from `.env.example`.

   Check this after the first deploy, from Coolify's terminal for the `app`
   container, for each optional integration you set:
   `printenv MAILGUN_DOMAIN STRIPE_SECRET_KEY SENTRY_DSN | wc -l`. A missing
   one means the `.env` passthrough did not work; add it to the `environment`
   list of `app` and `worker` as `NAME=${NAME:-}`.
4. **Deploy.** Watch the `migrate` logs finish with "All migrations have been
   successfully applied", then check `https://<domain>/api/health`.
5. **First administrator.** Create the first admin once, then keep the invite
   token secret or rotate it:

   ```bash
   curl -sS -X POST https://<domain>/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@example.com","password":"<a strong password>","name":"Your Name","organizationName":"Your Agency","adminInviteToken":"<ADMIN_INVITE_TOKEN>"}'
   ```

   Sign in at `https://<domain>`, then turn on two-factor authentication for
   the admin account.

## Email approvals (HITL replies)

Human-in-the-loop emails go to `HITL_APPROVER_EMAIL` with a Reply-To of
`reply+<notificationId>.<token>@<MAILGUN_DOMAIN>`. The token is an HMAC of
the notification id (key derived from `HITL_REPLY_SECRET`, or `JWT_SECRET`
when unset), and the sent Message-Id is stored on the notification. A reply
posted to `/api/mailgun-hitl/hitl-reply` is applied only when all of these
hold, and is otherwise answered 406 (Mailgun does not retry):

- the Mailgun signature, timestamp window and single-use token are valid;
- the reply address token matches the notification;
- `message-headers` is present, `In-Reply-To` or `References` names the
  stored Message-Id, and the `Date` header is not older than the
  notification;
- the From header is one mailbox: the notified user or an active admin of
  that user's organization;
- Mailgun's verdicts, read only from the `X-Mailgun-*` headers that come
  before the first other header (such as `Received`), show a DKIM pass where
  every `DKIM-Signature` has one `d=` equal to the From domain or a subdomain
  of it, or an SPF pass for an envelope sender in that domain or a subdomain;
- an approval is still `PENDING`.

Mailgun setup: create a route with the expression
`match_recipient("reply\+.*@<MAILGUN_DOMAIN>")` and the action
`forward("https://<domain>/api/mailgun-hitl/hitl-reply")`, and use the
domain's HTTP webhook signing key as `MAILGUN_SIGNING_KEY`. Rotating
`HITL_REPLY_SECRET` (or `JWT_SECRET` without it) invalidates replies to
emails already sent.

**Before relying on email approvals, capture one real reply.** The exact
layout of Mailgun's forwarded fields (the order of `message-headers`, and
whether the SPF and DKIM verdict headers are present for your domain) could
not be confirmed when this was built. To check:

1. Add a second action to the route, `store(notify="https://<a request bin you control>")`,
   or temporarily forward to that bin instead. Do not use a public bin for
   real approval mail.
2. Trigger a test HITL notification and reply to its email from the
   approver's normal mail client with a harmless text (not `APPROVED`).
3. In the captured POST, confirm: `recipient` carries the `.token` part;
   `message-headers` is a JSON list whose first entries are Mailgun's
   `X-Mailgun-*` headers, including `X-Mailgun-Spf` and/or
   `X-Mailgun-Dkim-Check-Result` with `Pass`, before the first `Received`;
   the `DKIM-Signature` `d=` (or the `sender` domain) is the approver's From
   domain or a subdomain of it; and `In-Reply-To` names the HITL email.
4. Remove the extra action. If any check fails (for example, Mailgun adds no
   DKIM verdict and the approver's domain fails SPF alignment), replies will
   be refused with 406 and the approver must use the Hub approvals page.

## Automatic deploys

Only `main` should deploy, and only commits that passed the three required
release gates ([release-gates.md](release-gates.md)). The safe setup is:

1. Branch protection on `main` requires the three release-gate checks, so
   nothing reaches `main` without them.
2. After adoption, the disabled-by-default **Checked Coolify release** workflow
   listens to successful **Required release gates** runs for same-repository
   pushes to the current default branch. It skips superseded revisions, pins
   the verified full SHA in Coolify, waits for the matching deployment and
   checks public strict readiness plus the serving revision.
3. Keep Coolify's direct Git auto-deploy disabled. Direct push deployment would
   bypass post-merge CI. Follow [checked-coolify-release.md](checked-coolify-release.md)
   before setting `COOLIFY_RELEASE_ENABLED=true`.

The direct-VPS script also enforces a pre-migration backup and a rollback
floor; Coolify does not. Before switching production:

- Schedule backups of the database **and** the `uploads` volume. Coolify's
  scheduled backups cover standalone database resources, not a `postgres`
  service inside this stack, so adapt the encrypted job in
  [backup-and-restore.md](backup-and-restore.md): `pg_dump` through
  `docker exec` on the `postgres` container, plus an archive of the `uploads`
  volume. Until that job writes `/app/config/backup-status.json`, the backup
  check in `/api/health/details` reads unavailable.
- Take a manual backup before any deploy that adds migrations.
- Rehearse a restore into a separate Coolify environment.

## Rollback

Coolify's one-click rollback to an earlier image is not available for Docker
Compose resources. Roll back by pinning the source:

- **Code only (no new migrations):** set the resource's Git commit to the
  previous good SHA and redeploy, then set it back to `main` once fixed.
- **With migrations:** migrations are forward-only, so the old code needs the
  old schema.
  1. Stop the `app` and `worker` services, so nothing writes while you
     restore and no new code runs against the old schema.
  2. Restore the pre-deploy database backup into `postgres`.
  3. Pin the previous commit and redeploy.

  Restoring loses every database write since the backup. Files uploaded
  after it stay in the `uploads` volume without a database record; list and
  remove them only after checking with the people affected.
- **Prefer fixing forward** when the failed migration can be corrected: a
  fix commit on `main` redeploys without losing data.

## Upgrading from the direct-VPS deployment

Move the data before the domain:

1. Stop writes on the old host and take a final backup:
   `pg_dump --format=custom`, plus a copy of `data/uploads` and `data/config`.
2. Restore the dump into the new stack's `postgres` service with `pg_restore`.
   Copy the files into the `uploads` and `appconfig` volumes. Coolify
   prefixes volume names with the resource id (`<id>_uploads`); copied files
   must be owned by uid 1000 (`node`), for example with
   `chown -R 1000:1000` inside a helper container that mounts the volume.
3. Reuse the old `JWT_SECRET` and `CREDENTIALS_KEY`. A new `CREDENTIALS_KEY`
   makes stored integration credentials unreadable; a new `JWT_SECRET` signs
   everyone out.
4. Deploy, verify `/api/health` and a sign-in, then move DNS.
