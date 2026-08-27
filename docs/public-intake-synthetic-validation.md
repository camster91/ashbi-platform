# Public inquiry synthetic validation

Status: local two-sided contract and browser proof complete; target persistence pending

## Proven locally

- Ashbi.ca builds a canonical Hub inquiry payload with explicit consent, the active privacy version, a stable unchanged-payload retry key, safe landing/referrer attribution, canonical service lines, and paired budget/currency evidence.
- The website remains visibly inert when its Hub endpoint or the Hub intake configuration is absent.
- The website content-security policy allows the canonical `https://hub.ashbi.ca` origin and no broader intake destination.
- The Hub permits its explicitly approved public intake origins through CORS while preserving the authenticated Hub origins.
- The Hub route accepts one synthetic inquiry, creates one tenant-owned lead, one durable source event, and one internal owner notification, and returns no personal data.
- Exact replay, simultaneous replay, changed-payload conflict, stale privacy consent, invalid content, unapproved origin, disabled configuration, and honeypot behavior are covered by executable tests.
- A local browser flow against a synthetic non-persistent Hub response passed at 1440×1000 and 390×844 with native required-field validation, success feedback, no horizontal overflow, no console errors, and no failed requests.

## Not proven

- The committed intake and weekly-growth migrations have not been applied to a named environment.
- No exact Ashbi tenant or staff owner has been configured for intake.
- No record has been written to a migrated Hub database from an authorized Ashbi.ca origin.
- Authenticated staff review, retention/deletion, owner-notification visibility, and production monitoring have not been exercised in this journey.
- Ashbi.ca and the Hub have not been deployed or changed by this validation.

## Controlled target test

After migration and configuration approval, submit one visibly synthetic record from the exact authorized Ashbi.ca review origin. Capture the request receipt without personal data, then verify the tenant, owner, consent version/time, attribution, source event, and internal notification in authenticated Hub views. Replay the unchanged request and prove no new lead/event/notification appears. Do not qualify, message, convert, promote, invoice, or charge the record as part of the intake test. Exercise the approved deletion/retention path separately and record the result.
