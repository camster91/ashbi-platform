# Gmail ingestion boundaries

The deployment-owned Gmail adapter remains configured with
`GMAIL_SYNC_ORGANIZATION_ID` and its existing token file/environment settings.
This change does not create mailbox OAuth connections, request grants, activate
a provider, send mail, call a model, or run the AI processing pipeline.

The script obtains the actual authenticated mailbox address from Gmail's
`users.getProfile` response before any ingestion write. Organization, normalized
mailbox address and native Gmail message ID form a unique durable identity.
RFC Message-ID headers and subjects are not identity keys. A native Gmail thread
ID links only messages from that same mailbox and organization to the same
current canonical client. Existing TEAM assignment and conversation permissions
are preserved; ingestion does not assign a staff member or broaden visibility.

Only nondeleted ACTIVE or PROSPECT clients whose relationshipStatus is neither
ARCHIVED nor CHURNED are eligible; LEAD remains eligible with ACTIVE/PROSPECT.

Each message is handled in one Serializable database transaction: fresh matching,
canonical thread/message or triage storage, thread activity, and immutable
receipt. Before any snapshot-taking query, static `LOCK TABLE clients, contacts IN
SHARE MODE NOWAIT` fences ordinary mapping edits and new ambiguous contacts.
Then a transaction-level advisory lock coordinates native mailbox/thread
identity. Busy mapping tables abort the transaction as a partial scan without
retry; mapping writers wait when ingestion acquired the short barrier first.
These locks cover database work only, never provider fetching. Serialization or receipt uniqueness conflicts are reported as partial scan failures; there
is no hidden transaction retry, queue, provider replay or automatic paid AI work.
A later rolling GET scan can retry an uncommitted message after fresh reads.
Committed receipts are replay tombstones even after their target is deleted.
Migration `20261016120000_gmail_ingest_identity` joins the existing chat, OAuth
binding and private pilot rollback floors in the direct deployment controller,
hosted migration wrapper and backup proof. Once applied, older writers without
this receipt protection cannot serve as a rollback candidate.

Exact contact addresses shared by multiple live clients are filed once in
manual triage. A previously mapped native thread whose client mapping changed,
became ambiguous, disappeared or became inactive receives a durable
`HELD_MAPPING_CHANGE` receipt, rather than splitting the conversation between
clients. Held messages are not imported or automatically released.

Historical `gmail-sync` JSON did not prove mailbox identity. Exact parsed native
message/thread ID overlaps in the same organization receive a durable
`HELD_LEGACY_OVERLAP` receipt. Existing history is neither adopted nor modified,
and no duplicate message is created. A bounded legacy candidate search that
cannot prove absence also holds. Historical triage rows without provider IDs
cannot be reliably reconciled automatically. Resolving these holds and proving
historical completeness require a separately reviewed operation; no fuzzy
subject matching, client relinking or history deletion is included here.

The scan covers **INBOX only**, using a consistent rolling **48-hour** query by
default (`GMAIL_LOOKBACK_HOURS`, explicitly bounded to 1–168 hours). It follows
at most five pages of 200 IDs each. Native IDs repeated across pages are
processed once per scan. Remaining pages, repeated page tokens, detail errors,
serialization failures, or review holds make the result partial. The response
contains numeric counters, `scope: INBOX_WINDOW` and the actual lookback hours;
it never returns raw child stdout/stderr, email addresses, subjects, bodies,
tokens or provider errors. `partial: false` means that this bounded INBOX window
was exhausted successfully; it does not establish mailbox, sent-folder,
attachment, historical or migration completeness. No durable history cursor or
full backfill is implemented, and `resultSizeEstimate` is not used as a count.

Sources remain primary until independently verified and explicitly cut over.
The operator offboarding export explicitly excludes the internal ingestion
receipt ledger and records that exclusion in its manifest; canonical messages
and email triage content remain exported. Full database backups retain native
identities and replay tombstones. The offboarding format alone cannot restore
the exact ingestion deduplication or review-hold state.
Tests use synthetic local fixtures; live mailbox/provider acceptance is separate
from implementation and CI.

Provider contracts: [Gmail message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
and [authenticated mailbox profile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).
