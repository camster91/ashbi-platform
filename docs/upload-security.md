# Upload security and supported files

All application upload entry points use `src/security/file-upload-policy.js`.
The policy accepts only these extension families when the extension, declared
MIME type, and file signature agree:

- Images: JPEG, PNG, GIF, WebP
- Documents: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX
- Text: TXT and CSV, provided the content is inert text
- Archives: ZIP
- Media: MP4, MP3, WAV

SVG, HTML, JavaScript, XML, executable/script formats, double extensions,
empty files, files over 50 MB, and signature mismatches are rejected. SVG is
intentionally excluded instead of being sanitized because uploaded files do
not need same-origin active rendering.

Downloads require application or client-portal authentication and tenant
authorization. Responses force `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff`, and a sandboxed content security policy.

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
