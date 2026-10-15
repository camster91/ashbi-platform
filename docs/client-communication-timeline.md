# Stored client communication timeline

The client page includes a collapsed **Stored email history** panel. Opening it
reads existing Hub inbox messages and project communications. It does not connect
a mailbox, invoke a model, fetch provider history or send mail. Coverage is
explicitly incomplete; this is a useful view of records already stored in Hub.

Each entry identifies its source, sender, direction, date and linked thread or
project. The initial response contains bounded snippets. Opening an entry loads
bounded plaintext through a separate authorized detail request; HTML, raw email,
headers, account strings and AI extraction metadata are not returned.

Current active ADMIN and TEAM membership is checked on every request. TEAM inbox
entries remain limited to assigned threads; project communications follow the
existing staff project policy. Both sources require the live canonical client
and project relationship. Client-less inbox threads attached only through a
project remain excluded by the existing tenant ownership policy, as stated in
coverage. Mailbox identity work must resolve this consistently before complete
history claims.

The two sources share descending date/source/id pagination, with a bounded query
per source. An unavailable source produces a partial warning and no continuation
cursor, so retrying can start again without silently skipping unavailable rows.
Authorization or tenant validation failures fail closed. The panel keeps source
identities distinct and resets history/body state when the client changes.

HTTP reads are `GET /api/client-communications/:clientId` and
`GET /api/client-communications/:clientId/:source/:messageId`. Workspace MCP
exposes the same services as `list_client_communications` and
`get_client_communication` under `workspace:read`.

No schema migration is required. Verified mailbox connections, transactional
provider receipts, full inbox/sent pagination, RFC threading headers and safe
outbound delivery remain separate work. Source apps remain primary during
migration verification.
