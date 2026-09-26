# Media review

Status: **slice 1 of #417** — review sessions, positioned and timestamped
annotations, approval decisions and expiring client share links. Malware and
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
   - **images**: pinned to a point on the image, stored as a normalized
     region `{x, y, w, h}` with each value in `0..1`, so it survives any
     display size;
   - **PDF**: pinned to a page number (the file opens in the browser's own
     viewer; there is no inline PDF renderer in this slice);
   - or unpinned, as a general comment.
   Replies are one level deep (`parentId` must be a top-level annotation of
   the same session) and carry no anchor. Staff resolve and reopen top-level
   annotations.
4. A decision (`approved` or `changes_requested`, with an optional note) is
   appended to the session's decision history and becomes the session status.
   Decisions are never edited: record a new one to change the outcome.
5. To involve the client, staff create a **share link** (step-up
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

Migration `20260926140000_media_review`; field reference in
[data-dictionary.md](data-dictionary.md).

| Model | Notes |
| --- | --- |
| `ReviewSession` | `organizationId`, `projectId`, `attachmentId`, `title`, `status`, `version`, `previousSessionId` (unique), `createdById`. A direct tenant model; the tenant proxy verifies that the project, the attachment and the previous session belong to the caller's organization before a create. |
| `ReviewAnnotation` | `authorType` is `staff` (`authorUserId` set) or `guest` (`authorName`, optional `authorEmail`, and the `shareLinkId` it came through). The author name is a snapshot. `body` is plain text of at most 5,000 characters. Optional `timecodeMs`, region (`regionX/Y/W/H`, all or none, inside the unit square) or `pageNumber`; `resolvedAt`/`resolvedById` set together. |
| `ReviewDecision` | `decision`, `actorType` (`staff` or `guest`), actor name/email/user id, `shareLinkId`, `note` (at most 2,000 characters). **Append-only**: a trigger rejects every `UPDATE`, every `TRUNCATE`, and any `DELETE` except the cascade from deleting the session; the request-scoped Prisma proxy rejects update, upsert and delete. |
| `ReviewShareLink` | `tokenHash` (SHA-256 hex, unique), `label`, `expiresAt`, `revokedAt`/`revokedById`, `allowDecision`, `createdById`, `lastUsedAt`. |

CHECK constraints enforce the closed vocabularies, the author/actor one-of
rules, text lengths, the region bounds, the token-hash format and the
90-day expiry ceiling. Actor and creator ids have no foreign keys, like
`audit_events`, so the history outlives user accounts.

A file under review cannot be deleted: `review_sessions.attachmentId` is
`ON DELETE RESTRICT`, and both delete routes (`DELETE
/api/attachments/attachments/:id` and the client portal's `DELETE
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
| `GET /api/reviews/:id` | The session with its annotations, decisions and share links. |
| `POST /api/reviews/:id/annotations` | Add an annotation or reply. |
| `POST /api/reviews/:id/annotations/:annotationId/resolve` | `{ resolved: true \| false }`. |
| `POST /api/reviews/:id/decisions` | `{ decision, note? }`. |
| `GET /api/reviews/:id/share-links` | Links with their state (`active`, `expired`, `revoked`); never the token or hash. |
| `POST /api/reviews/:id/share-links` | **Step-up.** `{ label?, expiresInDays? (1–90, default 14), allowDecision? }`. Returns the token once. |
| `POST /api/reviews/:id/share-links/:linkId/revoke` | Revoke (idempotent). |

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

## Share-link security

Share links reuse the capability-token pattern of the portal view and signing
links (`src/utils/public-document-access.js`), with a stricter storage rule.

| Control | How |
| --- | --- |
| Unguessable | 32 random bytes (`crypto.randomBytes`), base64url: 256 bits. |
| Hashed at rest | Only the SHA-256 hex digest is stored. The token is returned once, in the create response (`Cache-Control: no-store`), and is never written to the database, audit events or logs. |
| Constant-time lookup | Malformed tokens are refused before any query. The lookup is by digest through a unique index, so the database never compares secret material, and the stored digest is re-checked with `crypto.timingSafeEqual`. Malformed and unknown tokens get the same `404`. |
| Expiry | 14 days by default, at most 90 (*Proposal*: both numbers). Enforced by the API and by a CHECK constraint. Expired links answer `410`. |
| Revocation | `POST …/revoke` sets `revokedAt`; revoked links answer `410`. |
| Scope | A link names one session. Every query is keyed by that session: its own annotations and decisions, replies only to its own annotations, and only its own file. No project, client, organization, user or storage details are returned. Deleted projects answer `404`. Closed sessions are read-only. |
| Decisions opt-in | A guest decision needs a link created with `allowDecision`; otherwise `403`. A link records **at most one** decision (`409 SHARE_LINK_DECISION_RECORDED`, backed by a unique index on `review_decisions.shareLinkId`); staff can still decide, and a new link can be issued. |
| Write bounds | At most 500 comments per share link and 2,000 per session (staff included): further comments answer `409 ANNOTATION_LIMIT_REACHED` (*Proposal*). The share-link view returns the newest 500 threads with all their replies, plus `annotationTotal` and `annotationsTruncated`, so recent comments are never hidden. |
| Decision races | A decision sets the session status with a compare-and-set (`status <> 'closed'`) inside its transaction; if the session was closed meanwhile (for example replaced by a new version), the decision is rolled back and answers `409 REVIEW_SESSION_CLOSED`. |
| Step-up to create | Creating a link exposes tenant data outside the tenant, so it requires recent re-authentication (*Proposal*, listed in [privileged-actions.md](privileged-actions.md)). |
| Rate limits | Per route, per IP and per link (token hash), see the table above. |
| Response headers | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. The file is sent with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, inline for images, video and audio and as a download for PDFs. |
| Logs | Fastify's request log serializer masks the token in `/api/portal/review/<token>` and `/portal/review/<token>` URLs (`src/utils/log-redaction.js`). Reverse proxies in front of the API log full URLs too: mask or drop those paths there. |
| Guest input | Name (at most 120 characters), optional email, and plain-text comments. Control and bidi-override characters are removed; the UI renders text only, never HTML. |
| Tenancy | The routes live under the tenancy-exempt `/api/portal` prefix and get the raw Prisma client, so they confine every query to the linked session themselves. A real-database test (`src/tests/integration/media-review.database.test.js`) proves another session's and another organization's data is unreachable. |

`lastUsedAt` is updated at most once a minute per link, so staff can see
whether a link was used.

## Retention

Not decided in this slice: review sessions, annotations, decisions and share
links are kept until their project or attachment is deleted. Retention,
export and legal hold for review history (including guest names and emails
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

The staff page (`/review/:id`) and the client page (`/portal/review/:token`)
share one review component:

- every annotation is in a list with its anchor spelled out ("at 0:05",
  "page 2", "pinned at 40% across, 25% down"), so the list is the equivalent
  of the pins on the image;
- pins are buttons with labels, reachable by Tab; activating a pin or its
  list entry selects the annotation, and a list entry with a timecode seeks
  the video;
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
