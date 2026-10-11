# Product improvement acceptance plan

The October 10 competitive assessment is an expert judgment of 70/100, not a
measured certification. Improvements earn credit after their user journeys work
in the target environment. Adding features or passing unit tests alone does not
change the score. The supported agency milestone in product-status.md remains
authoritative.

| Area | Baseline | Next evidence required |
| --- | --- | --- |
| Core operations | 18/25 | A team member completes intake, project setup, tasks, review and handoff without an operator repairing records. |
| Usability | 15/20 | Cameron and Bianca complete daily work on desktop and mobile; record task completion time, wrong turns and recovery failures. |
| Client experience | 14/20 | A disposable client completes onboarding, document review and approval while tenant isolation and internal visibility remain intact. |
| API and MCP | 10/15 | Clear connection setup, a deployed read-only discovery/query journey, and a reviewed OAuth implementation with a real ChatGPT connection and revocation test. |
| Finance | 7/10 | One sandbox proposal → contract → invoice → payment journey, including rejection, duplicate webhook, retry and receipt evidence. |
| Operations | 6/10 | An approved alert recipient receives an intentional test alert; restore, rollback and failed-deployment drills retain evidence. |

## Delivery order

1. Simplify API/MCP connection setup in Settings. Keep secrets out of exported
   schemas, preserve read-only defaults and preview/confirmation writes. Show
   the current direct ChatGPT OAuth limitation clearly.
2. Implement a scoped OAuth connector as a separate security-reviewed change.
   Discovery, PKCE, consent, tenant binding, short-lived tokens, revocation and
   adversarial tests precede a deployed ChatGPT acceptance test.
3. Exercise complete staff and client delivery journeys with existing QA
   accounts. Fix observed friction rather than adding navigation or dashboards
   without evidence.
4. Verify the sandbox revenue journey and fix failures in sequence. Live charges,
   customer messages and provider settings retain their explicit action gates.
5. Verify alert delivery and recovery using approved ownership and destinations.
   Do not invent monitoring owners or silently change production configuration.

## Evidence for each slice

Record revision, target, automated checks, actual browser/API journeys, remaining
gaps and rollback. Local checks support implementation readiness; CI supports
merge readiness; refreshed target evidence supports deployment acceptance.
Re-score the same six categories after that evidence is available. A 90+ target
requires repeatable daily use and successful failure recovery, not cosmetic
polish alone.
