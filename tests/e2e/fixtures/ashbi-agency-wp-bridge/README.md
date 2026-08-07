# Ashbi Agency WP Bridge

**Current version: v1.10.1**

Connects WordPress sites to the Ashbi Hub for remote management, maintenance, backups, support-hour tracking, and monthly client reports.

## What's New in v1.10.1

- **Tier system** — `basic` / `professional` / `agency` retainers with per-tier included hours and banked-hour caps. (#21)
- **Slack & Telegram forwarding** — alerts mirror to a Slack incoming webhook and/or Telegram bot, so you hear about new admins or SSL expiry even if the hub is down. (#21)
- **Custom health checks** — sites can register named checks via the `ashbi_register_checks` filter; results render in the monthly report. (#21)
- **SEO health section** — sitemap, robots.txt, meta-description coverage, image-alt coverage, broken-external counts in the monthly report. (#19)
- **Monthly report template** — Ashbi-branded HTML email with verdict, summary, action items; client/internal send-mode gate. (#18, #22)
- **Hardened comments opt-out** — agencies can suppress the "fix"-verdict email to clients by default. (#22)
- **Auto-update opt-in default** — `ashbi_auto_update` now defaults to `true`; respects per-site toggle. (#22)
- **Tag-archive fallback** — broken-link scan now falls back to tag archives when posts are empty. (#21)
- **OLS-safe backup dir** — backup directory is created with `.htaccess deny from all` and an `index.php` silencer so OpenLiteSpeed hosts don't serve backups. (#27)
- **Security fixes** — HMAC now required on `/health` and `/ping` reduced to pong-only; magic-login token rate-limited to 5/min/IP; monthly report refuses to send without `ashbi_internal_email`; `$db_result` → `$db_ok` rename in backup report. (#13, #14, #15, #16)
- **SHA256 verify on releases** — release pipeline emits a `SHA256SUMS` file; client verifies before applying updates. (#28)
- **sslverify rollout** — outbound HTTPS to the hub and to `check_ssl_valid` now uses `sslverify => true`; only the SEO sitemap/robots probes keep `false` (public discovery).
- **CI hardening** — `GITHUB_REF_NAME` sanitized in zip filename; deploy uses atomic rsync with canary + TOFU pubkey check + `SHA256SUMS` pairing.

## Features

### Client-facing

- **Automated backups** — weekly DB + files snapshots with rotation; auto-backup before any file patch.
- **Support-hour tracking** — per-tier included hours with monthly rollover up to the banked cap.
- **Monthly executive report** — uptime, updates, cleanup stats, SSL status, hour usage, SEO health, and custom checks.
- **SSL monitoring** — daily expiry check with alerting before certs lapse.
- **Health pings** — hourly heartbeat carrying TTFB, DB size, and disk usage.
- **Admin alerts** — webhook on new-admin creation or promotion.
- **Magic login** — one-time 60-second SSO tokens issued by the hub.
- **File read / patch** — sandboxed within WordPress root, with auto-backup.
- **WP-CLI access** — whitelisted subcommands (`plugin`, `theme`, `core`, `transient`, `cache`, `db`, `cron`) only.
- **Auto cleanup** — daily purge of revisions, spam, expired transients.
- **GitHub auto-updates** — opt-in check against the public releases feed.

### Operator-internal

- **Tier system** — drives the hourly quota and banked-hour cap.
- **Slack / Telegram forwarding** — chat-side mirror of every alert.
- **Custom health checks** — agency-tier extension point.
- **HMAC + replay protection** — every privileged request is signed; stale timestamps are rejected.
- **AIOWPS compatibility** — plugin filter lets Ashbi routes through All-In-One WP Security when present.
- **Magic-login rate limit** — 5 attempts per IP per minute.
- **Hardening opt-out** — clients can disable the auto-update and report-to-client paths independently.

## Security

- **HMAC signing** — privileged REST routes require `X-Ashbi-SIGNATURE` over the raw body using `hash_hmac('sha256', ...)`. The optional `_timestamp` (or `timestamp`) JSON field enforces a 300-second replay window (`ASHBI_REPLAY_WINDOW`). (#15)
- **Option blocklist** — `/option/get` and `/option/set` refuse `wp_user_roles`, `wp_user_capabilities` (prefix-deny), `ashbi_api_key`, `ashbi_secret_key`, `siteurl`, `home`, `admin_email`, `users_can_register`, `default_role`, `db_password`, and all secret salts (`auth_*`, `secure_auth_*`, `logged_in_*`, `nonce_*`). #19
- **File deny-list** — `file/patch` and `file/read` are confined to the WordPress root; paths containing `..` are rejected, and backups are written to `wp-content/ashbi-backups` with `.htaccess deny from all`. #19
- **Magic-login admin-only + rate limit** — SSO tokens sign in only as administrators; >5 attempts/IP/minute returns HTTP 429. #16
- **Monthly report hardening** — `esc_html()` is applied to every dynamic row in the report template; the report refuses to send without a configured `ashbi_internal_email`. #14, #18
- **OLS backup-dir hardening** — backups dir ships `.htaccess` + `index.php` so OpenLiteSpeed (and Apache) cannot serve the contents. #27
- **sslverify=true on outbound** — hub health pings and SSL self-checks use TLS verification. Public sitemap/robots probes intentionally keep `false` because they're discovery.

## REST Endpoints

All routes are namespaced under `ashbi/v1`. Auth is one of:

- **Public** — `__return_true`
- **Admin** — `current_user_can('manage_options')`
- **HMAC** — `Ashbi_Auth::verify_signature` (signed body + optional timestamp)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET    | `/ping`             | Public | Liveness — returns `pong` |
| POST   | `/register`         | Admin  | Register site with hub, save API key + secret |
| POST   | `/health`           | HMAC   | Trigger a health ping to the hub |
| POST   | `/command`          | HMAC   | Run one whitelisted WP-CLI command |
| POST   | `/command/batch`    | HMAC   | Run up to 20 whitelisted WP-CLI commands |
| POST   | `/file/read`        | HMAC   | Read a file under the WordPress root |
| POST   | `/file/patch`       | HMAC   | Patch a file under the root (auto-backup) |
| POST   | `/magic-login`      | HMAC   | Issue a 60-second SSO token for an admin |
| POST   | `/hygiene/run`      | HMAC   | Run the daily deep clean on demand |
| POST   | `/backup/run`       | HMAC   | Trigger a full DB + files backup |
| POST   | `/backup/list`      | HMAC   | List manual and auto backups |
| POST   | `/hours/status`     | HMAC   | Read tier + hours remaining |
| POST   | `/hours/use`        | HMAC   | Log hours against the retainer |
| POST   | `/report/send`      | HMAC   | Send the monthly report immediately |
| POST   | `/option/get`       | HMAC   | Read a non-blocklisted option |
| POST   | `/option/set`       | HMAC   | Update a non-blocklisted option |

`/ping` is the only public route; everything else requires admin capability or a valid HMAC.

## Scheduled tasks

Five WP-Cron hooks run on the site. The first four are registered by their owning module on `init`; `ashbi_monthly_report` is registered on activation and on plugin upgrade.

| Hook | Schedule | Module | What it does |
| --- | --- | --- | --- |
| `ashbi_hourly_ping`      | hourly  | `Ashbi_Health`   | Posts site status (TTFB, DB size, disk) to the hub |
| `ashbi_daily_hygiene`    | daily   | `Ashbi_Hygiene`  | Deep clean (revisions, spam, transients) + 24h disconnect alert |
| `ashbi_weekly_link_scan` | weekly  | `Ashbi_Hygiene`  | Scan posts for broken external links |
| `ashbi_weekly_backup`    | weekly  | `Ashbi_Backup`   | Full DB + files backup with rotation (max 4 kept) |
| `ashbi_monthly_report`   | monthly | `Ashbi_Report`   | Build + send the Ashbi-branded monthly report |

Two background tasks run on transient-based scheduling (fire on the next page load after expiry, not via WP-Cron):

- **SEO snapshot** — `ashbi_seo_refreshed` transient (24 h) → `Ashbi_SEO::snapshot()`.
- **Custom checks** — `ashbi_checks_run` transient (1 week) → `Ashbi_Checks::run_all()`.

## Installation

1. Upload `ashbi-agency-wp-bridge.zip` to **Plugins → Add New**.
2. Activate the plugin.
3. Go to **Settings → Ashbi Bridge → Connect to Hub** and paste your API + secret keys.