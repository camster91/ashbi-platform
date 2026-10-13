# Shared financial portfolio views

Invoices and expenses filter by the canonical project's portfolio. Unlinked records and records linked to an unclassified project appear in Unclassified; a shared client does not determine portfolio. Existing tenant/staff permissions still apply. These filters do not rewrite issuers, clients, invoice numbers, currencies or billing status.

Invoice list and collection statistics apply the same optional portfolio to invoices and their payment balances. Money remains separated by currency. Expense summaries aggregate all matching records by currency and monthly category rather than summing a capped list or mixing CAD and USD. Mixed-currency legacy top-level monetary totals are null; `byCurrency` contains each currency's totals and category breakdown. Counts remain counts across currencies.

Both screens retain `portfolio` in their URL and support loading later rows. The expense summary currency selector affects summary cards/category values, not the stored records or currencies. Changing portfolio is disabled while a financial draft is open. Read-only MCP `list_invoices` and `list_expenses` provide bounded pages with explicit organization and portfolio scope; Checkout links and receipt URLs are omitted.

Unit/UI coverage includes nullable project classification, search and overdue filter composition, currency separation, aggregate counts beyond the read cap, explicit MCP scope, later rows, portfolio changes and invoice status/accessibility regressions. A synthetic authenticated CI journey verifies linked and unlinked expenses, persisted portfolio URLs, canonical client IDs and draft invoices without sending or charging. Required CI and production acceptance must be recorded independently.

This slice supplies financial views; historical issuer mapping, approved-time/expense invoicing, provider acceptance and reviewed one-time data input remain separate work. Production is held.
