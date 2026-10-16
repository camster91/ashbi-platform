# Bot project hours and rate-derived amounts

`GET /api/bot/projects/hours/summary` and
`GET /api/bot/projects/:id/hours` retain their existing bot-secret,
organization scope, cache policy and hours/progress behavior. These read-only
endpoints do not set billing rates, create invoices or calculate verified profit.

An entry's `hourlyRate ?? user.hourlyRate` determines its effective rate.
Explicit zero is valid and takes precedence over a nonzero user rate. Missing,
nonfinite, negative and nonnumeric rates are unknown; an invalid explicit entry
override does not fall back to a user rate. No zero or fifty-dollar fallback is
invented. The pure `summarizeLabor` function is shared with project budget
reporting, preserving the project service's existing output and precision.

## Compatibility

For fully known rates, `costToDate` and detailed `breakdown[].cost` retain their
numeric, two-decimal behavior. When any contributing entry has an unknown rate,
the corresponding project or user total is now **null**. Consumers must handle
null explicitly and must not coerce it back to zero.

Both views add `labor` with `knownRateAmount`, `missingRateMinutes`,
`missingRateEntries`, `complete`, `currency: null` and `currencyVerified: false`.
`knownRateAmount` is the subtotal of known entries, not a substitute for an
incomplete total. The user breakdown includes the same metadata for each user;
one incomplete user does not hide another user's known numeric amount. Empty
time sets remain complete with a zero amount. Rates have no persisted currency,
so even complete amounts cannot be called currency-verified cost or profit.

`loggedHours`, `estimatedHours`, `percentUsed`, `overBudget` and the detailed
`budgetRemaining` remain hours-based. In this existing bot API, `budgetRemaining`
means **hours remaining**, including a negative number when over the hours
budget; it is not money. Unknown rates do not suppress hours progress. Existing
no-hour-budget behavior remains unchanged (zero percent, null remaining hours).

Repository consumer search found no frontend, script or MCP consumer calling
these bot hours paths or consuming `costToDate`; the bot route itself defines
them. External bot integrations are not enumerable from this repository and
must adopt the nullable contract. The ordinary project-budget API already has
its reviewed nullable contract; MCP workspace tools do not proxy these bot HTTP
routes. No tool permissions or OAuth/API-key scope is added by this change.

Regression tests exercise actual HTTP summary/detail responses with the real
request-context and tenant proxy, explicit zero, missing/invalid rates, mixed
user completeness, rounding/progress, empty time, cached summary reuse,
unauthenticated denial and a missing/foreign project. Existing project budget
tests verify the shared calculation preserves that API's behavior. These are
synthetic tests, not live database or provider execution.
