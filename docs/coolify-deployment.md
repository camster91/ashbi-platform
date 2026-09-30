# Deploying Ashbi Hub with Coolify

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
  succeeds, so a failed migration stops the deploy before new code serves
  traffic.
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
- **Build revision.** Coolify's `SOURCE_COMMIT` is passed as `APP_REVISION`, so
  `/api/health` reports which commit is running.

## One-time setup

1. In Coolify: **New resource → Public/Private repository → Docker Compose**.
   Choose this repository, branch `main`, and set the compose file location to
   `/docker-compose.coolify.yml`.
2. **Domain.** On the `app` service, set the domain (for example
   `https://hub.example.com`). Coolify fills `SERVICE_FQDN_APP_3002` and issues
   the TLS certificate.
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
   | `CORS_ORIGIN` | yes | the same origin as `APP_URL` |
   | `TRUST_PROXY` | no (default `1`) | `1` behind Coolify's single proxy |
   | `POSTGRES_DB`, `POSTGRES_USER` | no (default `ashbi`) | database name and role |
   | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_SIGNING_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY` | for email | Mailgun sending and webhooks |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for payments | use test-mode keys until the revenue flow is verified (#378) |
   | `AI_PROVIDER` plus that provider's key (`ANTHROPIC_API_KEY`, `OLLAMA_API_KEY`, …) | for AI features | `AI_DISABLED=true` turns AI off |
   | `SENTRY_DSN`, `OBSERVABILITY_OWNER`, `CREDENTIALS_KEY_OWNER` | recommended | error reporting and named owners; missing values are logged as warnings |

   Every variable set in the tab reaches both the API and the worker, so any
   other integration variable from `.env.example` works the same way. The
   deploy fails fast if a required variable is missing, and the API refuses to
   start with any placeholder value from `.env.example`.
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

## Automatic deploys

Only `main` should deploy, and only commits that passed the three required
release gates ([release-gates.md](release-gates.md)). The safe setup is:

1. Branch protection on `main` requires the three release-gate checks, so
   nothing reaches `main` without them.
2. Coolify deploys on push to `main` (its GitHub App or the deploy webhook).

The direct-VPS script also enforces a pre-migration backup and a rollback
floor; Coolify does not. Before switching production:

- Schedule database backups: Coolify's scheduled backup for the `postgres`
  service, or the encrypted job in [backup-and-restore.md](backup-and-restore.md).
  Include the `uploads` volume.
- Take a manual backup before any deploy that adds migrations.
- Rehearse a restore into a separate Coolify environment.

## Rollback

- **Code only (no new migrations):** redeploy the previous commit from
  Coolify's deployment history.
- **With migrations:** migrations are forward-only. Restore the pre-deploy
  database backup, then redeploy the previous commit. Uploaded files are not
  affected by a code rollback.

## Upgrading from the direct-VPS deployment

Move the data before the domain:

1. Stop writes on the old host and take a final backup:
   `pg_dump --format=custom`, plus a copy of `data/uploads` and `data/config`.
2. Restore the dump into the new stack's `postgres` service with `pg_restore`.
   Copy the files into the `uploads` and `appconfig` volumes.
3. Reuse the old `JWT_SECRET` and `CREDENTIALS_KEY`. A new `CREDENTIALS_KEY`
   makes stored integration credentials unreadable; a new `JWT_SECRET` signs
   everyone out.
4. Deploy, verify `/api/health` and a sign-in, then move DNS.
