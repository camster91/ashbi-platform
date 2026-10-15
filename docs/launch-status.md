# Internal pilot launch status

Verified October 15, 2026 at 18:43 UTC. This is a dated evidence record, not a
claim that a later checkout or deployment has the same state. Recheck current
main, public revision and the evidence for any issue before changing behavior.

## Deployed and verified

- Public app: <https://hub.ashbi.ca>.
- Serving revision: `5238fefbcb2f6003c474cacddea6c41e6b3edf1f` (#603), including #600.
- Required PR CI: [38784234495](https://github.com/camster91/ashbi-platform/actions/runs/38784234495).
  Main CI: [38785907330](https://github.com/camster91/ashbi-platform/actions/runs/38785907330).
- Cameron explicitly requested SSH deployment after the protected Coolify
  attempts stopped before deployment. The reviewed `scripts/deploy-vps-direct.sh`
  remains the production controller. VPS release history records success at
  `2026-10-15T18:41:03Z`; both API and worker use image
  `sha256:041ccad5e16b00c74d0a1509fe5b46cea253677644f1d0e53bc0e09cef96a437`.
- A fresh encrypted backup passed manifest/database-catalog verification and
  off-server byte/checksum verification before cutover. Prior API and worker
  containers were retained by the release script. No restore is claimed.
- Public exact-revision and strict readiness passed. Database, Redis, worker
  and backup report healthy; zero failed jobs. `degraded=true` reflects missing
  alert destination and owner configuration, not a failed dependency.
- 41/41 post-deploy API/MCP checks passed in the approved isolated QA tenant:
  four-role login/identity/project access, organization boundaries, foreign
  project denial, scoped discovery and real reads, write denial, probe-key
  revocation/readback and logout.
- Browser smoke: TEAM login, dashboard/project navigation, synthetic project
  Note/task creation, full reload/content readback, private DM persistence and
  unrelated-admin denial passed on the preceding `4349f6d` release. On `5238fef`,
  a synthetic $1 CAD draft invoice persisted with correct details; full reload
  no longer opens an empty recovery draft after successful creation (#602).
- 24/24 communication checks and 5/5 client-portal read checks passed again on
  `5238fef`: replay-safe channel send, membership revocation, recipient DM read,
  unrelated-admin denial, incomplete stored-history labeling, QA mailbox
  isolation, missing receipt denial and internal chat filtering. All QA sessions
  were logged out. These are 70 bounded checks, not whole-app acceptance.
- #603 restored migrated integration coverage: 165 integration tests passed in
  required CI, alongside 2,050 backend and 1,303 frontend tests. Intentional
  browser-matrix skips remain; passing CI does not prove every browser journey.

The protected [Coolify run 38730654741](https://github.com/camster91/ashbi-platform/actions/runs/38730654741)
failed; it is not evidence of a successful GitHub deployment. Its URL was
corrected, but adoption remains incomplete: the resource lacks the production
domain and its serialized Compose fails an exact-text check despite structural
equivalence. A temporary token created through a model write was revoked and
removed from GitHub Secrets after the provisioning-boundary conflict was found.
Use normal authorized API token provisioning for any future adoption. Do not
weaken review rules, create credentials through database writes, or reactivate
this controller merely to make the workflow green.

## Next work, in order

1. Fix the freshly reproduced cross-account push-consent backfill and inaccurate
   device-local recovery copy (#321/#319). Preserve explicit consent, failed
   disable retry, tenancy, permissions and billing identity. Keep current target
   OS/browser and assistive-technology acceptance (#305/#318/#319/#321) open.
   Populated communication/email recovery and provider billing remain separate.
2. Configure alert destination/owner after approval of the actual destination.
   Complete Cameron/Bianca daily-use acceptance for the internal pilot.
3. Continue saved agent conversations/durable runs and the approved agency
   expansion in bounded slices after pilot blockers. Profiles and human
   channels/DMs (#597), stored client timelines (#598), and Gmail send receipts
   (#600) already exist; do not rebuild them from older plan checklists.
4. Verify the bounded one-time data input, reconcile a final delta and cut over
   only after acceptance. Source apps remain primary until then; retirement is
   separate. No reusable importer is required by the current scope.

Real ChatGPT OAuth, provider delivery/payment/signature acceptance, complete
browser/mobile/accessibility coverage and full incumbent replacement remain
unproved. A successful deployment or synthetic QA does not close those gates.

## Backlog authority

[#565](https://github.com/camster91/ashbi-platform/issues/565) is the execution
checklist; [master-app-delivery-plan.md](master-app-delivery-plan.md) orders the
work and [product-status.md](product-status.md) classifies capabilities.
Older plans and issue labels are historical evidence. Close an issue only when
its actual exit criteria are met or its scope is explicitly superseded; link
the replacement/evidence and retain genuine acceptance gaps. Do not restore
removed navigation, agents or integrations solely because an old ticket asks.
