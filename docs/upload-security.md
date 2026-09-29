# Upload security and supported files

All application upload entry points use `src/security/file-upload-policy.js`.
The policy accepts only these extension families when the extension, declared
MIME type, and file signature agree:

- Images: JPEG, PNG, GIF, WebP
- Documents: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX
- Text: TXT and CSV, provided the content is inert text
- Archives: ZIP
- Media: MP4, WebM (browser screen/camera recordings), MP3, WAV

SVG, HTML, JavaScript, XML, executable/script formats, double extensions,
empty files, files over 50 MB, and signature mismatches are rejected. SVG is
intentionally excluded instead of being sanitized because uploaded files do
not need same-origin active rendering.

Downloads require application or client-portal authentication and tenant
authorization. Responses carry `X-Content-Type-Options: nosniff` and a
sandboxed content security policy (`default-src 'none'; sandbox`). Documents
are sent as `Content-Disposition: attachment`; audio and video (and, on the
client-portal chat route, images) are sent `inline` so chat and review players
can show them, with byte ranges for media.

## Chat uploads

Chat files ([chat-media.md](chat-media.md)) go through the same policy and
50 MB limit. They are uploaded before the message is sent, as pending uploads
owned by the uploader and bound to one project, and are claimed by the message
send in the same transaction as the message. Unsent uploads are deleted after
24 hours by the scheduled-maintenance worker; each person may hold at most 30
unsent uploads per project. Clients download chat files only through
`/api/client-portal/chat-attachments/:attachmentId`, which answers 404 unless
the file is on a client-visible message of their own client's project.

## Existing-file audit

Run the inventory in the target environment before deployment:

```sh
npm run audit:uploads
```

The command is read-only and exits with status 2 when it finds incompatible,
missing, or unsafe files. Review the JSON report with the product owner. After
approval, quarantine those files with:

```sh
npm run quarantine:uploads
```

Quarantine moves files under `uploads/quarantine`, updates their stored paths,
and prevents portal download. Preserve a filesystem/database backup before the
write mode. Do not delete quarantined files until retention requirements are
approved under issue #310.
