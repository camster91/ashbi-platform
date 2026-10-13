# Portfolio filters for documents and time

Documents and weekly timesheets use the same shared-project portfolios as Projects. The URL retains the selected portfolio on reload; All work removes the filter. Portfolio never grants access or reassigns a canonical client, owner or billing identity.

`GET /api/notes` accepts `portfolio` and opt-in `paginated=true`, with page and limit (maximum 100). Legacy callers still receive an array. Counts and pages apply search, type, project and portfolio together. The Documents page can load later pages and resets pagination on a portfolio change. Filtering is disabled while a document draft is open.

Project time entries, personal time reads, weekly timesheets and both time summary routes accept the optional portfolio. Existing user ownership and approval/invoice locks remain enforced. Project summaries now page through all matching entries, avoiding the tenant read cap that previously understated totals after 100 entries.

Read-only MCP tools `list_notes` and `list_time_entries` provide bounded pages with explicit organization and portfolio scope. Team time reads remain restricted to the caller; administrator time reads cover the organization. These tools do not send messages, approve time or create invoices.

Local coverage checks combined document pagination, invalid filters, team time ownership, null/unclassified portfolios, explicit MCP tenancy, a 101-entry summary, document load-more/reset and URL restoration. A synthetic authenticated CI journey covers persisted documents and time against canonical projects. CI success and production acceptance must be recorded separately; production remains held.
