# Project budget reporting contract

`GET /api/projects/:id/budget` retains existing project/tenant scoping and
permissions. It changes no stored time, expenses, rates, currencies or invoices.

Time entry overrides take precedence, including zero; null/omitted overrides use
the stored user rate. Missing/invalid rates are unknown, never an invented zero
or fifty. `totalCost` and each `costByUser[].cost` are null when contributing
entries lack rates. Complete known rate-derived scalar totals remain numeric,
including genuine zero. `labor.knownRateAmount`, `missingRateMinutes`,
`missingRateEntries` and `complete` describe partial amounts; per-user groups carry
the same completeness information. These are recorded rate amounts with currency
unspecified, not verified costs, revenue or profit.

`expenses.byCurrency[code] = { total, count }` groups supported CAD/USD/EUR/GBP
records. `currencies`, `mixedCurrency`, `unknownCurrencyCount` expose coverage.
Unknown currency is excluded and never assigned the invoice default. The legacy
`expenses.total` is numeric only for no expenses or one known currency; it is null
for mixed or unknown currency. No foreign-exchange conversion is performed.

Budget and time-rate currencies are absent from the data model. Accordingly
`financial.available` is false with explicit reason codes, `budgetUsed` and
`budgetRemaining` are null, and monetary progress is unavailable. `percentUsed` is
null when a positive financial budget exists, otherwise the hourly percentage.
`hoursPercentUsed` separately reports billable-hour progress against a positive
hours budget; unset/zero denominators yield null. Stored project null/zero budget
values remain distinct.

## Compatibility and limits

API consumers must handle nullable totals/percentages instead of coercing them to
zero. The project UI does so, groups expense currencies, labels hourly progress,
and offers read retry. No schema, billing, business rate or default currency is
changed. Explicit currency metadata and a business policy would be needed before
financial budget comparisons or profitability claims can be established.

Repository consumer search found this route and the Project page only; direct
external consumers may need nullable handling. Separate legacy BOT project-hours
rate calculations remain a follow-up outside this bounded change.
