# Chat media: screenshots, recordings and files in messages

Status: code-present (2026-09-29); not target verified. See
[product-status.md](product-status.md).

Staff project chat and the client-portal conversation accept files inside
messages: pasted or dropped screenshots and files, a markup step for
screenshots, and Loom-style screen/camera recordings. Storage and limits are
unchanged by owner decision: local-disk uploads, 50 MB per file, the existing
upload policy ([upload-security.md](upload-security.md)).

## Flow: upload first, send second

1. The composer uploads each file as soon as it is added, with progress, as a
   **pending chat upload**: an `Attachment` row with `entityType =
   'CHAT_PENDING'`, `entityId = <projectId>`, owned by the uploader
   (`uploadedById`).
   - Staff: `POST /api/chat/projects/:projectId/uploads` (multipart, field
     `file`); remove one with `DELETE /api/chat/projects/:projectId/uploads/:attachmentId`.
   - Client portal: `POST /api/client-portal/projects/:id/chat-uploads`;
     remove with `DELETE /api/client-portal/projects/:id/chat-uploads/:attachmentId`.
   - A person may hold at most 30 unsent uploads per project (409
     `TOO_MANY_PENDING_UPLOADS`).
2. Sending the message lists the ready ids: `POST .../messages` with
   `attachmentIds` (at most 10; text is optional when files are attached).
   The message create and the claim of the listed files (`CHAT_PENDING` →
   `CHAT`, `entityId` → the message id) run in **one transaction**. If any id
   is not a pending upload of this uploader for this project (already sent,
   someone else's, another project's, purged) the whole send rolls back with
   409 `ATTACHMENT_NOT_PENDING`; no message is created.
3. The composer keeps text and files until the send succeeds, so "Try again"
   resends both. The send button is disabled while an upload runs.

Legacy files (uploaded after their message through `POST /api/attachments`
with `entityType = CHAT`) are the same shape as claimed uploads and render
inline too; that endpoint still works.

Deleting a message deletes its files (rows in the delete transaction, bytes
after commit).

### Unsent uploads

The scheduled-maintenance worker runs `chat-upload-cleanup` hourly
(`src/jobs/chat-upload-cleanup.js`, scheduler id
`chat-upload-cleanup-hourly`): pending uploads older than 24 hours are deleted,
row first and then the file. A row that cannot be deleted is kept and retried
on the next run (the job fails so it is visible). A file claimed between the
read and the delete is kept (the delete is conditional on `CHAT_PENDING`).

## Rendering

The staff message list (`GET /api/chat/projects/:projectId/messages`) and the
portal list load the files of every message on the page, replies included, in
**one** query (`attachments(entityType, entityId)` index, migration
`20260929090000_chat_attachment_lookup_index`). Each message carries
`attachments`; there are no per-message requests.

`web/src/components/media/MessageAttachments.jsx` renders images as
thumbnails that open a lightbox, WebM/MP4 video and audio in native players
(byte ranges for seeking), and anything else as a download card. Quarantined
files are shown as withheld.

## Client isolation

- Portal messages are always `CLIENT` visibility.
- A client reads chat files **only** on `CLIENT`-visible, not-deleted
  messages of projects of their own client record. The portal message list
  only loads `CLIENT` messages, and each file is reduced to the client shape:
  `id`, `name`, `mimeType`, `size`, `url` (the client-portal download route).
  No storage filename, path, uploader or organization.
- `GET /api/client-portal/chat-attachments/:attachmentId` re-checks all of that
  server side: the file must be a sent (`CHAT`) attachment of the client's
  organization, not quarantined, on a `CLIENT`, not-deleted message of a
  project whose `clientId` is the session's client. Anything else is **404**
  (INTERNAL message, another client's project, an unsent upload, a deleted
  message, a missing id), so ids cannot be probed. Images, video and audio are
  served inline (sandboxed CSP, `nosniff`, `private, no-store`); media accept
  byte ranges.
- Staff files on `CLIENT` messages are visible to that client; files on
  `INTERNAL` messages never are.
- Realtime: `toClientChatPayload` returns nothing for non-`CLIENT` messages,
  so the client room never receives an INTERNAL message or its files; for
  `CLIENT` messages it carries only the client attachment shape.
- Client sessions still cannot use the staff APIs (tenancy guard 403), so the
  staff download route `/api/attachments/uploads/:filename` stays staff-only.

`src/tests/integration/chat-media.database.test.js` proves this against a real
database (client A vs client B, INTERNAL vs CLIENT, pending and deleted files,
the atomic claim, and the purge).

## Composer capture tools

`web/src/components/media/`:

| Tool | Behaviour |
| --- | --- |
| Attach | Several files (up to 10 per message); unsupported types and files over 50 MB are refused before upload with a message. |
| Paste / drop | Clipboard screenshots and files, and files dropped on the composer. Clipboard images get a name; names are reduced to one extension (the policy refuses double extensions). |
| Screenshot | One frame of a `getDisplayMedia` stream (the person picks a tab, window or screen), then a markup step: arrow, rectangle, freehand pen, text, colour, undo (button or Ctrl/Cmd+Z). Exported as PNG at the capture's resolution (longest edge capped at 3840 px). Attached images can be marked up the same way from the tray. |
| Record | Screen only; screen + camera bubble (the camera is composited into the bottom-left corner of the screen video on a canvas and re-captured with `captureStream`; a worker-driven timer keeps drawing while the tab is in the background); or camera only. Microphone audio is mixed with tab/system audio when the browser provides both. 3-second countdown, pause/resume, stop, a visible timer and size meter, preview, re-record, attach. Recording stops itself at 50 MB (with headroom for the last chunk) or at 15 minutes; chat recordings target about 1.2 Mbit/s. Ending the screen share stops the recording. Escape during a recording stops it and shows the preview instead of discarding it. |

The recorder is shared with the project "Record screen" panel
(`web/src/lib/media-recorder.js`, used by `ProjectMedia.jsx`), which now also
stops at the size cap instead of refusing an over-size recording afterwards.

Browser support is feature-detected: without `getDisplayMedia` (iOS Safari,
most mobile browsers) the Screenshot button and the screen options are hidden
and camera recording and files remain; without `MediaRecorder` only files and
screenshots are offered. Controls are labelled buttons, the dialog traps and
restores focus (shared `Modal`), progress and timers are announced, and the
only animation (the recording dot) is `motion-safe`. Drawing on a screenshot is
pointer-based; everything else, including attaching without markup, works from
the keyboard.

The capture/markup dialog is its own lazily loaded chunk, fetched on first use
(prefetched on hover/focus of the buttons), so it is not part of the chat,
ClientPortal or PortalReview route chunks
([frontend-performance-budgets.md](frontend-performance-budgets.md)).

## Deferred

- Thread (email) replies: attachments on email thread replies are out of
  scope; thread replies remain text/HTML only.
- Other chats (AI assistant chat, task comments): not wired to these tools.
- Object storage, larger limits, server-side transcoding, thumbnails and
  recording transcripts: not implemented (owner decision to keep local disk
  and 50 MB for now).
- Retention of chat media follows the general upload retention decision
  ([#310](https://github.com/camster91/ashbi-platform/issues/310)).
- Malware/content scanning: the same vendor decision as
  [media-review.md](media-review.md).

## Operator notes

- Apply migration `20260929090000_chat_attachment_lookup_index`
  (`npx prisma migrate deploy`; an index build inside `BEGIN; SET LOCAL
  lock_timeout = '5s'; … COMMIT;`).
- Restart the worker so it registers the hourly `chat-upload-cleanup-hourly`
  schedule on the scheduled-maintenance queue.
- Disk use grows with recordings (up to 50 MB each); watch the uploads volume.
