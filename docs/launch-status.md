# Internal pilot launch status

Verified October 15, 2026 at 17:49 UTC. This is a dated evidence record, not a
claim that a later checkout or deployment has the same state. Recheck current
main, public revision and the evidence for any issue before changing behavior.

## Deployed and verified

- Public app: <https://hub.ashbi.ca>.
- Serving revision: `4349f6d5c9718745f210dd7828636a1f2f22da5d` (#600).
- Required PR CI: [38728031650](https://github.com/camster91/ashbi-platform/actions/runs/38728031650).
  Main CI: [38729606172](https://github.com/camster91/ashbi-platform/actions/runs/38729606172).
- Cameron explicitly requested SSH deployment after the protected Coolify
  attempts stopped before deployment. The reviewed `scripts/deploy-vps-direct.sh`
  remains the production controller. VPS release history records success at
  `2026-10-15T17:48:58Z`; both API and worker use image
  `sha256:00ea4b015f02f52f4721d0436c331a78a55147d06d73d4849056674c483f0ea9`.
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
  Note creation, full reload/content readback, and logout passed.

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

1. Complete focused live QA of task persistence, team/DM privacy, stored
   communication/email recovery and draft billing. Reproduce defects before
   fixing them; preserve tenancy, permissions, assignments and billing identity.
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
