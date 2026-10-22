# WordPress health bridge

The Hub accepts signed plugin health pings at PUT /api/wp-bridge. Authenticated
staff can list sites; administrators can enroll a site or rotate its key. Each
site key is encrypted at rest. HMAC covers the timestamp, nonce and exact body;
persisted nonces reject replay. Health updates use the verified site's tenant.
No frontend, remote commands, magic login or scheduled digest is added.

## Deployment and enrollment

1. Cameron reviews and merges the PR, then deploys the Hub.
2. Use authenticated POST /api/wp-bridge with siteUrl (HTTPS) and optional
   siteName. Store the returned one-time bridgeSecret privately in WordPress.
   Existing sites can use POST /api/wp-bridge/:id/rotate-secret. Never print keys.
3. This health-only bridge uses per-site keys and the existing CREDENTIALS_KEY
   encryption configuration. WP_BRIDGE_SECRET and SLACK_WEBHOOK_URL are not
   used by these endpoints; no additional global bridge secret is required.
4. Make a manual Kinsta backup before installing/updating the plugin on each
   site: valengroup.com, valengroup.net, blueoceanfacilities.com, curatorvideo.com.
5. Plugin 1.13.0 defaults to detached mode. Select connected mode after enrollment
   and verify Last Health Ping succeeds. Backup/report/alert/hour uploads and
   remote administration are outside this health-only API.
6. Check the homepage, two inner pages and wp-admin after installation.

The prepared plugin archive is unmodified vendor source commit
016e095fbe03b24f95286a67550c5a1acd90dee6 (1.13.0), with passing source CI.
Installation and live health-ping success remain pending deployment and browser
access. No database schema changes are included.
