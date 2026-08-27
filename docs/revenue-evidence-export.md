# Revenue evidence export

The Hub's **Export evidence** control creates a tenant-scoped, deterministic JSON artifact for invoice reconciliation. It is available only to authenticated administrators. The ordinary CSV remains a convenience report; it is not reconciliation evidence.

The artifact includes invoices, line items, delivery attempts and provider lifecycle events, payments, refunds, refund events, settlement events, and checkout audits. Each collection and the complete record set have SHA-256 checksums. Dates are UTC ISO strings and monetary evidence uses integer minor units.

To reduce exposure, the export excludes client email addresses and delivery recipients, invoice and payment notes, public access tokens, payment links, and draft data. The file still contains internal identifiers and Stripe/Mailgun provider identifiers, so store it as confidential financial evidence.

Verify a downloaded artifact without contacting the Hub, Stripe, Mailgun, Bonsai, or any other provider:

```powershell
npm run verify:revenue-evidence -- C:\path\to\ashbi-revenue-evidence-2026-08-27.json
```

The verifier checks checksums, duplicate identifiers, record relationships, supported invoice/payment currency, exact invoice/line/payment/refund amounts, refund currency, and verified settlement arithmetic. A matching checksum detects changes when the original manifest is retained; it does not authenticate the artifact against a malicious rewrite. Any unresolved currency, exact minor-unit amount, or settlement evidence keeps the result invalid and must be reconciled against source records.

This export does not authorize a Bonsai cutover, data migration, provider configuration, billing change, or production release. Those remain separate sandbox, parallel-run, reconciliation, backup, and Cameron approval gates.
