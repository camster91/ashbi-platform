# Controlled Notion Markdown migration

Ashbi supports a **one-way, controlled import** of a selected Notion Markdown
export into one existing Ashbi project. It is not a live Notion sync and does
not authorize writing back to Notion.

## Supported input

- UTF-8 `.md` pages from a Notion export;
- nested-page hierarchy when Notion's exported child folder corresponds to its
  parent Markdown page; and
- plain Markdown page content imported as Ashbi `DOC` notes.

Each page receives a stable source key based on its relative export path. Ashbi
records that key, content SHA-256, target project, created note, and latest
outcome in `notion_import_records`. Re-running the same source does not create
another note.

## Deliberately blocked or reported

- attachments, images, databases, CSVs, and other non-Markdown export files;
- an empty Markdown page;
- a child whose exported parent page is absent;
- a source page whose content changed after a prior controlled import;
- a previously imported source whose target note was removed; and
- an existing, unmapped Ashbi note with the same target title and parent.

These conditions are reconciliation findings, not automatic overwrites. The
report remains incomplete until they are reviewed and resolved.

## Pilot procedure

1. Export a sanitized, representative project from Notion and retain the
   original export securely.
2. Take an approved Ashbi backup and record its manifest/checksum.
3. Run the importer without `--confirm`, writing a new report file:

   ```text
   node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <Notion-export> --summary-file <new-report.json>
   ```

4. Review the exact planned hierarchy, unchanged records, conflicts,
   unsupported files, and errors. Do not proceed if the report is incomplete.
5. After a human reconciliation approval, repeat with `--confirm`, the exact
   reviewed dry-run report, and a new report filename:

   ```text
   node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <Notion-export> --confirm --approved-summary <reviewed-dry-run-report.json> --summary-file <new-live-report.json>
   ```

   The importer verifies the tenant, project, SHA-256 fingerprint of every
   exported file, and the destination plan. The live writes run in one database
   transaction and roll back completely if the source, plan, or any
   reconciliation finding differs from the approved dry run.
6. Rerun the same dry-run, compare record/note counts and hierarchy, then
   perform the authenticated editing and recovery checks before retiring the
   Notion workspace.

The report file is reserved before database work and created once with
owner-only permissions. Do not reuse or overwrite a prior report; retain it
with the exact source export, approved dry run, confirmed report, and related
backup evidence.
