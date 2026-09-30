# Media review

Status: **slice 1 of #417** — review sessions, positioned and timestamped
annotations, approval decisions and expiring client share links — plus
**markup and portal review** (2026-09-29): drawn shapes on images, inline PDF
pages and video frames, comment tracking, a Reviews tab in the signed-in
client portal, and web page review (off by default). See [Markup](#markup),
[Tracking](#tracking), [Client portal reviews](#client-portal-reviews) and
[Web page review](#web-page-review). Malware and
content scanning is deferred until a vendor is chosen; the code has a
documented seam for it (see [Scanning seam](#scanning-seam)). Retention is
deferred to #310.

## Flow

1. A staff member (ADMIN or TEAM) uploads a file to a project as usual
   (`POST /api/attachments`, see [upload-security.md](upload-security.md)),
   or records one with the project screen recorder.
2. On the project page, **Media review → Start a review** puts one of the
   project's reviewable attachments up for review
   (`POST /api/reviews`). Reviewable types are images (JPEG, PNG, GIF, WebP),
   PDF, video (MP4, WebM, including screen recordings) and audio (MP3, WAV,
   WebM). Office documents, archives and text files cannot be reviewed.
3. Reviewers open the session at `/review/:id` and add annotations:
   - **video and audio**: pinned to the current playback time (`timecodeMs`);
     on a paused video frame a comment can also carry a drawn shape;
   - **images**: a pin, an area, an arrow or a freehand stroke (see
     [Markup](#markup)), stored normalized to `0..1`, so it survives any
     display size;
   - **PDF**: shown inline, page by page; a comment names its page and can
     carry a shape drawn on it;
   - or unpinned, as a general comment.
   Replies are one level deep (`parentId` must be a top-level annotation of
   the same session) and carry no anchor. Staff resolve and reopen top-level
   annotations.
4. A decision (`approved` or `changes_requested`, with an optional note) is
   appended to the session's decision history and becomes the session status.
   Decisions are never edited: record a new one to change the outcome.
5. A review is **internal** until staff turn on **Share with client**. Shared
   reviews appear in the Reviews tab of the project's **client portal**,
   where the client's signed-in users comment as themselves (see
   [Client portal reviews](#client-portal-reviews)).
   To involve someone without a portal account, staff create a **share link** (step-up
   re-authentication required) and send the `/portal/review/:token` URL. The
   client sees the file, the annotations and the decision history, can add
   comments under their name (and optional email), and can approve or
   request changes only if the link was created with **Allow decisions**.
6. A new file version is a new session created with `previousSessionId`: it
   gets `version = previous + 1`, and the previous session becomes `closed`
   (read-only for staff and for its share links). A session has at most one
   next version.

Session statuses: `open`, `approved`, `changes_requested`, `closed`.

## Data model

Migrations `20260926140000_media_review` and `20260929120000_review_markup`
(markup columns, the `client` author type, `sharedWithClient`,
`clientCanDecide` and the web
capture source); field reference in [data-dictionary.md](data-dictionary.md).

| Model | Notes |
| --- | --- |
| `ReviewSession` | `organizationId`, `projectId`, `attachmentId`, `title`, `status`, `version`, `previousSessionId` (unique), `createdById`, `sharedWithClient` (visible in the client portal, default off; every session that existed before the migration is off), `clientCanDecide` (client portal decisions allowed, default off, only while shared: a CHECK constraint), and for web page reviews `sourceUrl` and `captureViewport` (set together). A direct tenant model; the tenant proxy verifies that the project, the attachment and the previous session belong to the caller's organization before a create. |
| `ReviewAnnotation` | `authorType` is `staff` (`authorUserId` set), `guest` (`authorName`, optional `authorEmail`, and the `shareLinkId` it came through) or `client` (a signed-in client portal user: `authorUserId` is the CLIENT user, `authorEmail` the contact's email). Markup: `shape` (`pin`, `rect`, `arrow`, `pen`), `points` (JSON, arrows and strokes) and `color`. The author name is a snapshot. `body` is plain text of at most 5,000 characters. Optional `timecodeMs`, region (`regionX/Y/W/H`, all or none, inside the unit square) or `pageNumber`; `resolvedAt`/`resolvedById` set together. |
| `ReviewDecision` | `decision`, `actorType` (`staff`, `guest` or `client`), actor name/email/user id, `shareLinkId`, `note` (at most 2,000 characters). **Append-only**: a trigger rejects every `UPDATE`, every `TRUNCATE`, and any `DELETE` except the cascade from deleting the session; the request-scoped Prisma proxy rejects update, upsert and delete. |
| `ReviewShareLink` | `tokenHash` (SHA-256 hex, unique), `label`, `expiresAt`, `revokedAt`/`revokedById`, `allowDecision`, `createdById`, `lastUsedAt`. |

CHECK constraints enforce the closed vocabularies, the author/actor one-of
rules, text lengths, the region bounds, the token-hash format and the
90-day expiry ceiling. Actor and creator ids have no foreign keys, like
`audit_events`, so the history outlives user accounts.

A file under review cannot be deleted: `review_sessions.attachmentId` is
`ON DELETE RESTRICT`, and both delete routes (`DELETE
/api/attachments/:id` and the client portal's `DELETE
/api/client-portal/documents/:docId`) answer `409 ATTACHMENT_UNDER_REVIEW`
while any review session references it. A client therefore cannot approve
through a share link and then delete the file, and the approval with it.

Projects are soft-deleted; while a project is in the trash its reviews answer
`404` (staff and share links) but are kept. Purging the project from the trash
(a hard delete by an administrator) is the one deliberate path that removes
its review sessions, annotations, share links and decisions (the decision
trigger allows a delete only once its session is gone). The `review.*` audit
events remain as the durable record. Attachments have no foreign key to their
project, so a purge leaves the files; an organization cannot be hard-deleted
while it has attachments or audit history.

## API

Staff API, `/api/reviews` (staff session, ADMIN or TEAM, tenant-scoped):

| Method and path | Purpose |
| --- | --- |
| `GET /api/reviews?projectId=` | A project's sessions, newest first, with open annotation counts. |
| `POST /api/reviews` | Create a session `{ projectId, attachmentId, title, previousSessionId? }`. |
| `GET /api/reviews/:id` | The session with its annotations, decisions, share links and `versions` (the whole version chain, oldest first). |
| `POST /api/reviews/:id/annotations` | Add an annotation or reply: `{ body, parentId?, timecodeMs?, pageNumber?, region?, shape?, points?, color?, mentionUserIds? }`. |
| `POST /api/reviews/:id/annotations/:annotationId/resolve` | `{ resolved: true \| false }`. |
| `POST /api/reviews/:id/decisions` | `{ decision, note? }`. |
| `POST /api/reviews/:id/client-access` | `{ sharedWithClient?, clientCanDecide? }` (at least one): share the review with the project's client portal, and whether its users may decide. `clientCanDecide: true` on an unshared review answers `409 REVIEW_NOT_SHARED`; unsharing also turns decisions off; decisions cannot be turned on for a closed version. Audited as `review.client_access_changed` when something changes. |
| `GET /api/reviews/capabilities` | `{ webCapture: { enabled, viewports } }`, so the UI hides web page review while it is off. |
| `POST /api/reviews/capture` | Web page review: `{ projectId, url, viewport? (desktop, mobile), title }`. 10 per 10 minutes per IP. |
| `POST /api/reviews/:id/recapture` | Capture the session's URL again as the next version: `{ viewport? }`. Same limit. |
| `GET /api/reviews/:id/share-links` | Links with their state (`active`, `expired`, `revoked`); never the token or hash. |
| `POST /api/reviews/:id/share-links` | **Step-up.** `{ label?, expiresInDays? (1–90, default 14), allowDecision? }`. Returns the token once. |
| `POST /api/reviews/:id/share-links/:linkId/revoke` | Revoke (idempotent). |
| `GET /api/reviews/:id/export` | Evidence export: a JSON download of the whole version chain, see [Evidence export](#evidence-export). Audited as `review.evidence_exported`. |

Staff view the file through the existing authenticated
`GET /api/attachments/uploads/:filename`.

Public share-link API, `/api/portal/review/:token` (no session):

| Method and path | Purpose | Per-IP limit | Per-link limit |
| --- | --- | --- | --- |
| `GET /api/portal/review/:token` | Session title, status, version, file description; annotations and decisions without staff ids, emails or storage paths. | 60 / minute | 120 / minute |
| `GET /api/portal/review/:token/file` | The session's file only. | 30 / minute | 60 / minute |
| `POST /api/portal/review/:token/annotations` | `{ name, email?, body, parentId?, timecodeMs?, region?, pageNumber? }`. | 20 / 10 minutes | 30 / 10 minutes |
| `POST /api/portal/review/:token/decisions` | `{ name, email?, decision, note? }`, only when the link allows decisions. | 10 / 10 minutes | 5 / 10 minutes |

Both limits apply, on top of the global per-IP API limit. The per-link
limit is keyed on the token's SHA-256 (`rv:<route>:<hash>`), so one leaked
link cannot be driven from many addresses; exceeding it answers `429
SHARE_LINK_RATE_LIMITED` with `Retry-After`. Per-IP limits only see the
real client when `TRUST_PROXY` is configured for the deployment's proxy
([deployment-and-rollback.md](deployment-and-rollback.md)); until the
owner sets it, every visitor behind Traefik shares one per-IP bucket and the
per-link limits are the effective bound. All four routes are
in the reviewed public allowlist of the API access matrix
([api-access-matrix.md](api-access-matrix.md)).

Client portal API, `/api/client-portal/reviews` (client portal session,
`clientAuth`; see [Client portal reviews](#client-portal-reviews)):

| Method and path | Purpose | Per-IP limit | Per-user limit |
| --- | --- | --- | --- |
| `GET /api/client-portal/reviews?projectId=` | The client's review sessions, newest first, with open comment counts. | 60 / minute | 120 / minute |
| `GET /api/client-portal/reviews/:id` | One session: file description, `versions`, `permissions`, annotations and decisions (public serialization). | 60 / minute | 120 / minute |
| `GET /api/client-portal/reviews/:id/file` | The session's file only (same headers, scan seam and ranges as the share-link file route). | 30 / minute | 60 / minute |
| `POST /api/client-portal/reviews/:id/annotations` | `{ body, parentId?, timecodeMs?, pageNumber?, region?, shape?, points?, color? }`, as the signed-in contact. | 20 / 10 minutes | 30 / 10 minutes |
| `POST /api/client-portal/reviews/:id/decisions` | `{ decision, note? }`, only on a shared session with `clientCanDecide`. | 10 / 10 minutes | 5 / 10 minutes |

The per-user limits are keyed on the client user id (`crv:<route>:<userId>`)
and answer `429 CLIENT_REVIEW_RATE_LIMITED` with `Retry-After`.

## Markup

A top-level comment can carry one drawn shape. Geometry is normalized to the
unit square of the surface it was drawn on (the image, the PDF page, or the
video frame), so it scales with the media at any size:

| Shape | Stored as | Rules |
| --- | --- | --- |
| Pin (`pin`) | region `{x, y, w: 0, h: 0}` | A bare region with zero size is a pin (older clients send only `region`). |
| Area (`rect`) | region `{x, y, w, h}` | `w` and `h` greater than 0; `x + w` and `y + h` at most 1. |
| Arrow (`arrow`) | `points: [[x1, y1], [x2, y2]]` (tail, head) | Exactly two points. |
| Freehand (`pen`) | `points: [[x, y], …]` | 2 to 500 points (the UI evens out longer strokes). |

Every coordinate is a number in `0..1`. Arrows and strokes also store their
bounding box in the region columns, so every shape has a region. An optional
`color` is one of `red`, `orange`, `yellow`, `green`, `blue`, `purple` (red
by default). Which anchor a shape needs depends on the media:

- **image**: the shape alone;
- **PDF**: the `pageNumber` it was drawn on;
- **video**: the `timecodeMs` of the paused frame it was drawn on;
- **audio**: no shapes (timecodes only).

Replies carry no anchor and no shape. The rules are checked twice on the
server: the Zod request schemas (`src/validators/schemas.js`) bound every
field, and `annotationPositionError` (`src/services/media-review.service.js`)
checks the combination against the media kind. The database repeats them as
CHECK constraints (shape vocabulary, a region for every shape, zero-size
pins and non-empty areas, points only on arrows and strokes, exactly two
arrow points, 2..500 `[x, y]` number pairs in `0..1`, the colour palette).

On screen, shapes are drawn on an SVG overlay sized to the media; each has a
numbered badge (a labelled button) at the pin, the area's corner, the arrow
head or the stroke start. Selecting a badge or a shape selects its comment in
the list, and a comment's "Show markup" (or, for video, "Play from") selects
and reveals its shape: on a PDF it turns to the page, on a video it seeks to
the frame and pauses. On a video, a shape is shown while the playhead is
within 1.5 seconds of its frame, or while its comment is selected. Choosing a
drawing tool pauses the video.

### Inline PDF viewer

PDFs are rendered in the browser with pdf.js (`pdfjs-dist`). The viewer
component is its own lazy chunk (`PdfViewer`), loaded only when a PDF is
reviewed, and pdf.js itself runs entirely inside a dedicated module worker
(`web/src/components/review/pdf-render.worker.js`): it parses the file in the
worker thread and draws each page on an `OffscreenCanvas`, and the main
thread receives finished page bitmaps. pdf.js therefore never enters a
main-thread JavaScript chunk; the worker script is served from the app's own
origin, which the Content-Security-Policy already allows (`worker-src 'self'
blob:`). pdf.js runs with `eval` and WebAssembly decoders disabled (the CSP
allows neither); JPEG 2000 images, which need the WebAssembly decoder, do not
render. The worker file (about 1.4 MB, pdf.js display layer plus parser) is
a worker asset, not a chunk in the Vite manifest, so the frontend budget
gate (`scripts/check-frontend-budgets.mjs`, which measures manifest chunks)
does not measure it; it is downloaded only when a PDF review is opened.
Browsers without `Worker`, `OffscreenCanvas` or `createImageBitmap` see a
message and the download link, and page comments still work.

## Tracking

- **Status filter**: all, open or resolved comments, with counts ("3 open,
  1 resolved"). Comment numbers stay the same under every filter. Staff
  resolve and reopen top-level comments as before; clients cannot.
- **Timeline markers**: under a video or audio player, one numbered marker
  per timestamped comment; activating one seeks the player (recorded WebM
  without a duration is laid out against the latest comment).
- **Versions**: `GET /api/reviews/:id` (and the client portal view) returns
  the version chain; the version switcher opens any version. Older versions
  are closed, so their comments and decisions are read-only. Recapturing a
  web page creates the next version.
- **Decisions** are unchanged: append-only, the latest sets the status.
- **@mentions**: a staff comment may name teammates (`mentionUserIds`, at
  most 20, each an active ADMIN or TEAM user of the organization, else
  `400 INVALID_MENTION`). The UI's "Mention a teammate" picker adds `@Name`
  to the text and sends the ids of the names still in it. Each mentioned
  teammate (never the author) gets a `MENTION` notification through
  `fastify.notify()` with a link to the review. Clients and guests cannot
  mention.
- **Owner notifications**: the session's creator gets `REVIEW_COMMENT` for
  every new share-link or client portal comment and `REVIEW_DECISION` for
  every client decision. A failed notification never fails the comment.

## Client portal reviews

The signed-in client portal (`/client-portal`, magic-link session typed
`client_session`) has a **Reviews** tab. It lists the review sessions staff
**shared with the client**, on the signed-in client's own projects: the API
confines every query to sessions with `sharedWithClient = true` whose project
has the session's `clientId` and `organizationId` and is not in the trash
(`sessionScope` in `src/routes/client-portal-review.routes.js`). An unshared
session of the client's own project, and any session of another client in
the same or another organization, answers `404` exactly like an unknown id,
on every route (list, view, file, comment, decide).

Sharing is **opt-in**, like internal-by-default project chat: a new review
is internal, and every review that existed before this change stayed
internal (the migration sets `sharedWithClient = false`). Staff turn on
**Share with client** on the review page (which then shows a *Visible to
client* badge; the project's review list shows it too) and can unshare at
any time, which hides the review from the portal again and turns client
decisions off. A new version (including a web page recapture) inherits the
sharing of the version it replaces; client decisions must be turned on
again. Share links are unaffected: a share link is already an explicit
share. `/api/client-portal` is
tenancy-exempt and gets the raw Prisma client, like the other portal routes,
so this scoping is the routes' own; a real-database test
(`src/tests/integration/media-review-markup.database.test.js`) proves a
client cannot see, fetch, annotate or decide on another client's session,
nor on an unshared session of their own project until it is shared (and
again after it is unshared).

What a client sees and can do:

- the session's title, status, version, project name and file description
  (never the storage path; for a web page review, only that it is a
  desktop/mobile capture, never the captured URL, which may be internal);
- on a shared review, **every comment on it**, from the team, share-link guests and
  client users alike, with the same public serialization as share links (no
  staff user ids, guest emails or share-link ids). Review comments have **no
  internal-only flag**: once a review is shared, everything written on it is
  visible to that client's portal users. Keep internal discussion on an
  unshared review, in project chat (internal by default) or in tasks;
- comment and reply, with markup, as themselves: the author name is their
  contact name, `authorType` is `client`, `authorUserId` their CLIENT user;
  the name cannot be chosen;
- approve or request changes only when staff turned on **Let the client
  approve or request changes in the client portal** for that shared session
  (`clientCanDecide`, default off, like share-link decisions); otherwise
  `403 CLIENT_DECISION_NOT_ALLOWED`. Portal decisions are recorded with
  `actorType: client` and audited with `via: client_portal`;
- closed sessions (older versions) are read-only; the version switcher
  shows the shared versions of the chain within the client's project.

A support view (admin impersonating a client user, #416) is read-only, as
everywhere in the portal.

## Web page review

Staff enter a URL; the server renders it in headless Chromium, takes a
full-page PNG screenshot, stores it as a project attachment (same storage,
50 MB limit and PNG signature check as uploads), and opens a review session
on it with `sourceUrl` and `captureViewport`. **Recapture** (on the newest
version) captures the same URL again as the next version, so the previous
version's comments stay available read-only.

It is **off** unless `WEB_REVIEW_CAPTURE_ENABLED=true`
(`src/config/env.js`, `.env.example`). While off, `POST
/api/reviews/capture` and `POST /api/reviews/:id/recapture` answer `503
WEB_REVIEW_CAPTURE_DISABLED` and `GET /api/reviews/capabilities` reports
`enabled: false`, so the UI hides the form and the recapture button.

| Setting | Value |
| --- | --- |
| Viewports | `desktop` 1440 x 900 CSS px at 1x; `mobile` 390 x 844 CSS px at 2x, with touch and the mobile viewport meta tag honoured |
| Deadline | 20 seconds for the whole capture (`504 WEB_CAPTURE_TIMEOUT`) |
| Page height | Clamped to 16,000 device pixels (16,000 CSS px desktop, 8,000 mobile); the audit event records `captureTruncated` |
| Size | PNG at most 50 MB (`422 WEB_CAPTURE_TOO_LARGE`); at most 100 MB transferred and 400 requests per capture |
| Concurrency | 2 captures at a time per API process (`429 WEB_CAPTURE_BUSY`) |
| Failure | Error status 400+ or navigation away from http(s): `502 WEB_CAPTURE_FAILED`; no browser: `503 WEB_CAPTURE_UNAVAILABLE` |
| Session | A fresh browser context per capture: no cookies, storage, credentials, service workers or downloads; closed afterwards |

### SSRF controls

Rendering an arbitrary URL on the server is a server-side request forgery
primitive, so the capture service (`src/services/web-capture.service.js`)
confines every request the browser makes to the public internet, in three
independent layers:

1. **The entered URL**: `http` or `https` only, no user name or password,
   ports 80, 443, 8080 or 8443 only, and every address the host resolves to
   (all families) must be publicly routable, using the outbound URL policy
   of `src/security/outbound-url-policy.js`: loopback, private, link-local
   (including the cloud metadata address 169.254.169.254), carrier-grade NAT
   (100.64/10), unique-local (fc00::/7), multicast, documentation, benchmark
   and reserved ranges are refused, including IPv4-mapped/-compatible,
   NAT64 and 6to4 IPv6 forms. Refusals answer `422
   WEB_CAPTURE_URL_REJECTED`, before any browser starts.
2. **An egress proxy as the browser's only route out**: an in-process HTTP
   proxy on 127.0.0.1 (`--proxy-server`, with Chromium's implicit loopback
   bypass removed by `--proxy-bypass-list=<-loopback>`). It resolves every
   host itself, refuses the request (`403`) unless all its addresses are
   public and the port is allowed, and connects to the address it checked,
   so DNS rebinding between check and connect is impossible. Redirects are
   handed back to the browser and the next hop comes back through the
   proxy, so a redirect to a private address is refused. Plain-http
   WebSocket upgrades are refused (secure WebSockets tunnel through the same
   check). Chromium's own DNS is disabled (`--host-resolver-rules` maps every
   name to NOTFOUND), QUIC is off, and WebRTC may not use non-proxied UDP.
3. **A request filter inside the browser**: a route handler aborts any
   request that is not http(s) (file:, ftp:, chrome: …), uses a disallowed
   port or names a non-public IP literal, and caps the number of requests;
   after navigation the main frame must still be on http(s).

The browser process gets a minimal environment (no application secrets).
Unit tests cover the policy, the proxy (with real sockets: private targets,
redirect hops, rebinding, ports, upgrades) and the capture flow with an
injected fake browser (`src/tests/unit/web-capture.service.test.js`).

### Operator steps (not done in the image)

The production image (Alpine) does not contain a browser, and this change
does not add one. To enable web page review on a host, the owner approves
and an operator:

1. installs Chromium in the API image or host, for Alpine
   `apk add --no-cache chromium nss freetype harfbuzz ttf-freefont`
   (Playwright's bundled browsers do not run on musl);
2. sets `WEB_REVIEW_CHROMIUM_PATH` to the executable (Alpine:
   `/usr/bin/chromium-browser` or `/usr/bin/chromium`); in development the playwright-core bundled
   headless shell works with `PLAYWRIGHT_BROWSERS_PATH`, or point the
   variable at any Chromium, e.g.
   `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`;
3. sets `WEB_REVIEW_CAPTURE_ENABLED=true` and restarts the API;
4. confirms egress: the API host must be able to reach public web servers
   on ports 80/443 directly (the capture proxy connects straight to the
   checked address; an outbound HTTP proxy in front of the host is not
   used);
5. expects roughly 150 to 300 MB of memory per concurrent capture;
6. provides Chromium's OS sandbox. Captures launch with the sandbox on
   (`chromiumSandbox: true`; the page is untrusted and runs JavaScript, and
   the egress proxy only confines Chromium's own network stack, not a
   compromised renderer). The host must allow unprivileged user namespaces
   (or ship Chromium's setuid sandbox); in Docker this can need a seccomp
   profile that permits them. If the sandbox cannot start, capture fails
   closed with 503 `WEB_CAPTURE_UNAVAILABLE`, never unsandboxed. Running
   captures in a separate low-privilege container whose only route out is
   the public internet is the stronger option.

Unresolvable and private hosts get the same 422 message, so the endpoint
cannot be used to learn which names exist on the server's network.

`playwright-core` (the driver, no browsers) is a runtime dependency.

## Share-link security

Share links reuse the capability-token pattern of the portal view and signing
links (`src/utils/public-document-access.js`), with a stricter storage rule.

| Control | How |
| --- | --- |
| Unguessable | 32 random bytes (`crypto.randomBytes`), base64url: 256 bits. |
| Hashed at rest | Only the SHA-256 hex digest is stored. The token is returned once, in the create response (`Cache-Control: no-store`), and is never written to the database, audit events or logs. |
| Constant-time lookup | Malformed tokens are refused before any query. The lookup is by digest through a unique index, so the database never compares secret material, and the stored digest is re-checked with `crypto.timingSafeEqual`. Malformed, unknown, expired and revoked tokens all get the same `404` and message. |
| Expiry | 14 days by default, at most 90 (*Proposal*: both numbers). Enforced by the API and by a CHECK constraint. Expired links answer `404`, exactly like an unknown token. |
| Revocation | `POST …/revoke` sets `revokedAt`; revoked links answer `404`, exactly like an unknown token, so a response never confirms that a token once existed. The client page's not-available state says the link may be mistyped, expired or revoked. |
| Scope | A link names one session. Every query is keyed by that session: its own annotations and decisions, replies only to its own annotations, and only its own file. No project, client, organization, user or storage details are returned. Deleted projects answer `404`. Closed sessions are read-only. |
| Decisions opt-in | A guest decision needs a link created with `allowDecision`; otherwise `403`. A link records **at most one** decision (`409 SHARE_LINK_DECISION_RECORDED`, backed by a unique index on `review_decisions.shareLinkId`); staff can still decide, and a new link can be issued. |
| Write bounds | At most 500 comments per share link and 2,000 per session (staff included): further comments answer `409 ANNOTATION_LIMIT_REACHED` (*Proposal*). The share-link view returns the newest 500 threads with all their replies, plus `annotationTotal` and `annotationsTruncated`, so recent comments are never hidden. |
| Decision races | A decision sets the session status with a compare-and-set (`status <> 'closed'`) inside its transaction; if the session was closed meanwhile (for example replaced by a new version), the decision is rolled back and answers `409 REVIEW_SESSION_CLOSED`. |
| Step-up to create | Creating a link exposes tenant data outside the tenant, so it requires recent re-authentication (*Proposal*, listed in [privileged-actions.md](privileged-actions.md)). |
| Rate limits | Per route, per IP and per link (token hash), see the table above. |
| Response headers | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. The file is sent with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, inline for images, video and audio and as a download for PDFs. The name is sent as an ASCII `filename` fallback plus the exact UTF-8 `filename*` (RFC 5987), so any file name is a valid header. Video and audio honour a single `Range: bytes=` request (`206` with `Content-Range`, `Accept-Ranges: bytes`; `416` with `Content-Range: bytes */size` for an unsatisfiable or malformed range; multi-range requests get the whole file), always within that one file. The staff file route (`GET /api/attachments/uploads/:filename`) uses the same helper (`src/utils/send-file.js`). |
| Logs and telemetry | Fastify's request log serializer masks every capability token in a URL (`src/utils/log-redaction.js`): review share links (`/api/portal/review/<token>`, `/portal/review/<token>`), the older portal proposal, contract, invoice, form, estimate and project links (`/api/portal/...`, `/portal/...`), the legacy `/api/proposals/client`, `/api/contracts/sign`, `/api/estimates/view` and `/api/invoices/client` paths, and `token=` query parameters. The browser Sentry integration applies the same rules (`web/src/lib/telemetry-scrub.js`) to event URLs, transactions, spans and breadcrumbs, rewriting tokens to `:token`. Reverse proxies in front of the API log full URLs too: mask or drop those paths there. |
| Guest input | Name (at most 120 characters), optional email, and plain-text comments. Control and bidi-override characters are removed; the UI renders text only, never HTML. |
| Tenancy | The routes live under the tenancy-exempt `/api/portal` prefix and get the raw Prisma client, so they confine every query to the linked session themselves. A real-database test (`src/tests/integration/media-review.database.test.js`) proves another session's and another organization's data is unreachable. |

`lastUsedAt` is updated at most once a minute per link, so staff can see
whether a link was used.

## Evidence export

`GET /api/reviews/:id/export` (the "Export evidence" button on the staff
review page) downloads `review-evidence-<title>-<date>.json` with
`Content-Disposition: attachment`, `Cache-Control: no-store` and an
`X-Evidence-Sha256` header holding the SHA-256 of the exact body sent. Access
is the same as viewing the review: ADMIN or TEAM staff of the review's
organization; another organization's review answers 404 like an unknown id,
non-staff principals 403. Each export is audited as `review.evidence_exported`
(counts only). Format `ashbi.review-evidence`, `formatVersion: 1`:

| Field | Content |
| --- | --- |
| `exportedAt`, `exportedBy` | When and by which staff user. |
| `review` | Id, title, status, version, project id and name, client sharing and decision settings, web capture source, creator and timestamps. |
| `versions` | Every version in the chain (oldest first, `current` marks the exported one), each with its `asset`: attachment id, original file name, stored file name, MIME type, kind, size, `checksum` (`{ algorithm: "sha256", value }`, or `null` for files stored before checksums) and uploader and upload time. |
| `annotations` | Every comment and reply of every version with `sessionId`/`version`, author type, `authorRole` (`ADMIN`/`TEAM` for staff, `CLIENT`, `GUEST`), author id, name and guest email, share link used, body, timecode, page, region, markup `shape`/`points`/`color`, resolution and timestamps. |
| `decisions` | Every append-only decision with version, decision, actor type, `actorRole`, actor id, name and email, share link used, `comment` and timestamp. |
| `shareLinks` | Every share link: label, `allowDecision`, creator, created, expiry, revocation (time and by whom), last use and state. Never the token or its hash. |
| `auditTrail` | The `review.*` audit events of these sessions and links (session creation, client access changes, share link creation and revocation, decisions, earlier exports). |
| `completeness` | Whether the version chain, annotations (bounded at 2,000 per version) and audit trail (2,000 events) are complete, and how many assets have no checksum. |

Storage paths and share tokens are never included.

## Upload checksums

Every newly stored attachment records `checksumSha256` (lowercase hex,
CHECK-constrained by migration `20261001090000_attachment_checksum`),
computed from the same in-memory buffer that is written to disk, so the file
is not read back: staff attachments (`POST /api/attachments`), staff and
client-portal chat uploads, client-portal document uploads, web page
captures, and Loom and MarkUp.io imports. Review asset versions are
attachments, so every new version carries its checksum into the evidence
export. Rows stored earlier keep `NULL` (no backfill). Expense receipts are
referenced by URL rather than an attachment row; `POST
/api/expenses/upload-receipt` returns the checksum with the URL but nothing
stores it yet.

A file the upload policy refuses on any of those HTTP upload routes (and the
expense receipt route) is recorded as an `upload.rejected` audit event with
the surface, refusal code (`DOUBLE_EXTENSION`, `EXTENSION_NOT_ALLOWED`,
`MIME_MISMATCH`, `EMPTY_FILE`, `TOO_LARGE`, `CONTENT_MISMATCH`), declared MIME
type, size, extension and project, never the file name or content
([audit-events.md](audit-events.md)). Multipart bodies over the transport
limit are cut off by the multipart parser before the policy runs and are not
audited yet.

## Retention

Not decided in this slice: review sessions, annotations, decisions and share
links are kept until their project or attachment is deleted. The
[evidence export](#evidence-export) gives a portable copy of one review;
retention, bulk export and legal hold for review history (including guest names and emails
on annotations and decisions) belong to #310. Expired and revoked links stay
as records so the audit trail and "via" references keep meaning.

## Scanning seam

Uploads already pass the file-type policy in
`src/security/file-upload-policy.js` (extension, MIME type and signature must
agree; SVG, HTML and scripts are rejected). Malware and content scanning of
review media needs a vendor decision, which is open.

The seam is `scanReviewMedia(attachment)` in
`src/services/media-scan.service.js`. With no scanner configured it answers
`{ verdict: 'unscanned' }`, which is allowed. A scanner plugs in with
`setMediaScanner({ scan })`, where `scan` receives
`{ attachmentId, organizationId, path, mimeType, size }` and resolves to one
of:

| Verdict | Effect |
| --- | --- |
| `clean` | Allowed. |
| `unscanned` | Allowed today; whether it stays allowed once a vendor exists is a policy switch in the seam, not a route change. |
| `pending` | Creating a session answers `409 MEDIA_SCAN_PENDING`; the share-link file download answers `409` without the file. |
| `blocked` | Creating a session answers `422 MEDIA_BLOCKED`; the share-link file download answers `403 MEDIA_BLOCKED`. |

Scanner errors and unknown verdicts are treated as `pending`, never `clean`.
The seam is called when a session is created and on every share-link file
download, so a verdict that changes after upload takes effect. Open
decisions for the owner: the vendor (self-hosted engine or API), whether
scanning happens at upload time for every attachment (the upload routes would
call the same seam), what happens to already-shared links when a file is
blocked, and whether `unscanned` files may be shared outside the tenant.

## Accessibility

The staff page (`/review/:id`), the client page (`/portal/review/:token`)
and the client portal's Reviews tab share one review component:

- every annotation is in a list with its anchor and shape spelled out ("at
  0:05", "page 2", "pinned at 40% across, 25% down", "area from 10% across,
  20% down, 30% wide and 40% tall", "arrow pointing to …", "drawing around
  …"), so the list is the equivalent of the markup on the media;
- every shape has a numbered badge that is a labelled button, reachable by
  Tab; activating a badge or its list entry selects the annotation (and
  highlights the shape), and a list entry with a timecode seeks the video;
  the timeline markers are labelled buttons too ("Comment 2 at 0:12, by
  Terry");
- the markup tools are toggle buttons and the colours a labelled radio
  group; areas, arrows and freehand strokes need a pointer, pins can also be
  placed from the keyboard;
- a point on the image can be chosen with the pointer or, from the keyboard,
  with the labelled "Across" and "Down" position fields under "Pin to a
  point" (arrow keys step them, and the marker on the image follows);
- all controls are labelled, status changes are announced in a polite live
  region, and focus moves to the new comment or the error that needs
  attention.

The browser suites run axe on both pages and drive the client page by
keyboard only (`tests/media-review-accessibility.spec.ts`, plus the staff
page in `tests/authenticated-accessibility.spec.ts`); the public page is also
in the deep-link chunk check (`tests/public-route-deep-links.spec.ts`).
Review media has no captions track: the timestamped comment list is its text
companion, and captions for uploaded video are out of scope for this slice.
