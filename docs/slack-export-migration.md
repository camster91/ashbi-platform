# Controlled Slack export migration

Ashbi supports a **one-way, controlled import** of a Slack workspace export
into existing Ashbi project chat. It is not a live Slack sync (that is the
separate inbound integration, see [product-status.md](product-status.md)) and
it never writes back to Slack. The importer follows the same contract as the
[Notion Markdown importer](notion-markdown-migration.md): dry run first,
durable source reconciliation, changed sources reported rather than
overwritten, reruns that never duplicate, and a live run that rolls back
completely on any finding. It adds a per-run ledger so a completed import can
also be rolled back by run id.

## Prerequisites

- An Ashbi organization with the target projects already created, and the
  organization id and project ids at hand.
- Ashbi users for the Slack members whose messages should be attributed to
  them, with the **same email address** as their Slack profile. Only active
  users are matched; anyone else is imported by display name only (control and
  bidirectional-override characters stripped, whitespace collapsed, capped at
  200 characters).
- The application's environment (at least `DATABASE_URL`), the committed
  migrations applied (`import_runs` and `slack_import_records` tables), and an
  approved backup with its manifest/checksum recorded
  ([backup-and-restore.md](backup-and-restore.md)).
- A Slack Workspace Owner or Admin to produce the export.

## Supported input

A Slack **workspace export**, extracted to a directory:

- `users.json` and `channels.json` (required);
- `groups.json` (private channels; only present in Business+ or Enterprise
  Grid exports that include them); and
- `<channel-name>/<YYYY-MM-DD>.json` day files.

From each day file the importer takes people's messages (plain messages,
`thread_broadcast`, `file_share` and `me_message`), thread structure
(`thread_ts`/`ts`), edit markers (`edited.ts`), reactions and file
*references*. Slack markup (`<@U…>`, `<#C…>`, links, `&amp;`) is rendered as
plain text. Each message becomes a project chat message with
`externalSource = SLACK`, `externalMessageId = ts` and
`externalThreadId = thread_ts` (or `ts` for a thread root), the same fields
the live Slack integration uses, so imported history and live messages share
threads.

Each message has a stable source key, `slack-export:<channelId>:<ts>`. Ashbi
records the key, a SHA-256 of the message's source text, author, thread and
file ids, the target project, created chat message and run in
`slack_import_records` (unique per organization and source key). Re-running
the same export, or a later export with an overlapping date range, never
creates a second copy. A thread root that gained `thread_ts == ts` in a later
export (Slack adds it when the first reply arrives) is the same message, not a
changed one.

Before writing, the importer also looks for the same Slack message (same
channel id and `ts`) anywhere in the organization, since a `ts` is only unique
within its channel. A copy in the target project (usually delivered by the
live integration) is counted as `alreadyPresent`; a copy in another project
is reported as `ALREADY_PRESENT_OTHER_PROJECT` and not imported again.

## Deliberately skipped or reported

These are listed in the report; the report is **incomplete** (and a live run
is refused) only for the ones marked *blocking*.

| Finding | Report field | Blocking |
| --- | --- | --- |
| Source message changed since its import (`SOURCE_CHANGED`) | `errors` | yes |
| Message was imported into a different project than the mapping now says (`PROJECT_MAPPING_CHANGED`) | `errors` | yes |
| Mapped project is not in this organization (`UNKNOWN_PROJECT`) | `errors` | yes |
| The live Slack integration maps the channel to a different project (`LIVE_MAPPING_CONFLICT`) | `errors` | yes |
| Unsafe or invalid entry (`INVALID_CHANNEL`, `UNSAFE_CHANNEL_NAME`, `UNSAFE_PATH`, `DUPLICATE_CHANNEL_NAME`) for a **mapped** channel | `errors` | yes |
| The same entries for an unmapped channel | `warnings` | no |
| Missing, linked (symlinked), oversize or invalid JSON `users.json`/`channels.json`/day file | command fails | yes |
| Previously imported chat message was deleted in the Hub (`DELETED_IN_HUB`; it stays deleted) | `totals.deletedInHub`, `warnings` | no |
| Same channel and `ts` already in another project (`ALREADY_PRESENT_OTHER_PROJECT`) | `totals.alreadyPresentElsewhere`, `warnings` | no |
| Channels without a mapping (skipped entirely) | `unmappedChannels` | no |
| Slack authors without a matching Ashbi email (imported by display name) | `users.unmapped` | no |
| File attachments: Slack exports do not contain file contents | `unsupported.assets` | no |
| Bot, Slackbot and system messages (joins, topic changes, tombstones, …) | `skippedSubtypes` | no |
| Direct and group messages (`dms.json`, `mpims.json`) | `unsupported.conversations` | no |
| Canvases and other unknown files or directories | `unsupported.files`, `unsupported.directories` | no |
| Reply whose thread root is not in the export (imported at top level) | `warnings` (`THREAD_PARENT_MISSING`) | no |
| Message the live Slack integration already delivered | `totals.alreadyPresent`, `warnings` | no |
| Reactions by unmapped users or with emoji names over the chat limit | `reactionsDropped` | no |
| A channel id listed twice (first entry kept) | `warnings` (`DUPLICATE_CHANNEL`) | no |

## Export steps

1. In Slack, open **Workspace settings → Import/Export Data → Export** and
   choose the date range. Standard exports contain public channels only;
   private channels and DMs require a Business+ or Enterprise Grid export
   approved by Slack.
2. Download the ZIP over a trusted connection and store the original with the
   migration evidence.
3. Extract it into a **new, empty directory** (`unzip slack-export.zip -d
   slack-export/`). The importer reads only an extracted directory, like the
   Notion importer; it refuses a `.zip`, refuses symlinks, refuses channel
   names that could leave the export root, and caps each JSON file at 64 MiB.

## Mapping

Write a mapping file that names each Slack channel (by name or by channel id;
ids win) and the Ashbi project it belongs to:

```json
{
  "channels": {
    "client-acme": "<ashbi-project-id>",
    "C01GENERAL": "<ashbi-project-id>"
  }
}
```

Unmapped channels are reported and skipped. Keys that match no channel are
listed in `unusedMappings`. Every project id must belong to the organization
given on the command line. If the live Slack integration already maps a
channel (`slack_channel_mappings`), the mapping file must name the same
project, or the run is refused with `LIVE_MAPPING_CONFLICT`.

Add `--channel <name|id>` to plan or apply one mapped channel per run. Other
mapped channels are listed in `notSelectedChannels`.

### Size guidance

Each live run is one database transaction (10-minute limit). Messages,
reactions and reconciliation records are written with batched inserts of 500
rows, so a run costs a handful of queries per 500 messages. As a rule of
thumb, keep a run under roughly 100,000 messages: import large workspaces one
channel at a time with `--channel`, and split very large channels by
exporting smaller date ranges (overlapping ranges are safe). Each JSON file in
the export is capped at 64 MiB.

## Dry run

A dry run is the default and writes nothing:

```text
node scripts/import-slack-export.mjs --organization-id <id> --input-dir <slack-export> --mapping-file <mapping.json> [--channel <name|id>] --dry-run --summary-file <new-report.json>
```

Review, per channel, the planned message and thread-reply counts, the
unchanged and already-present counts, unmapped channels and users, skipped
subtypes, unsupported assets, warnings and errors. Do not proceed if the
report is incomplete.

## Apply

After a human reconciliation approval, rerun with `--apply` and a new report
filename:

```text
node scripts/import-slack-export.mjs --organization-id <id> --input-dir <slack-export> --mapping-file <mapping.json> [--channel <name|id>] --apply --summary-file <new-report.json>
```

All reads and writes run in the organization's tenant context
(`runTenantJob`), so the run cannot read or write another organization's
projects, users or chat. The live writes run in one database transaction and
roll back completely if any blocking finding is encountered; a refused run
records nothing and writes no report file. A completed run is recorded in
`import_runs` (`source = SLACK_EXPORT`, counts only, never message content),
its id is in the report's `run.id`, and a `migration_import.applied` audit
event is written ([audit-events.md](audit-events.md)).

## Verify

1. Rerun the same dry run: every imported message should be `unchanged`,
   with `planned: 0`.
2. Compare per-project chat counts and a sample of threads, authors, edit
   markers and reactions with Slack.
3. Perform the authenticated chat, reply and recovery checks in the
   [authenticated replacement validation runbook](authenticated-replacement-validation.md)
   before retiring the Slack workspace.

## Rollback

```text
node scripts/import-slack-export.mjs --organization-id <id> --rollback <runId> --summary-file <new-report.json>
```

Rollback deletes exactly the chat messages that run created (reactions go
with them) and their reconciliation records, marks the run `ROLLED_BACK`, and
writes a `migration_import.rolled_back` audit event. It is refused when any
message outside the run replies to one of its messages (an Ashbi reply, or a
later import run); roll back later runs first, newest first. A rolled-back
export can be imported again.

## Known limits

- Slack exports do not include file contents; files are recorded as
  references in the message metadata (name, type, size, never the URL, which
  can embed an access token) and listed under `unsupported.assets`.
- Private channels and DMs need a Business+ or Enterprise Grid export; DMs
  and group DMs are reported but never imported into project chat.
- Reactions are imported only for Slack users mapped to Ashbi users, and only
  as they were on first import; later reaction changes are not reconciled.
- Custom emoji become `:name:` text, and names longer than the chat limit are
  kept in metadata only.
- Edits after import are conflicts, not updates. To take a newer version,
  roll back the run and import again.
- A message deleted in the Hub after import is never re-imported, even after
  a rerun; roll back its run to import it again.
- Imported messages carry `externalSource = SLACK`, so an outbound-enabled
  live mapping for the same channel can reply to imported threads.

The report file is created once with owner-only permissions. Do not reuse or
overwrite a prior report; retain it with the related backup evidence.
