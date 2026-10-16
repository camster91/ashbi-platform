# Internal pilot launch status

## Current execution overlay — October 16

Verified October 16, 2026: production is `4130e804d610557bb4b8315cb3a674a53fdb5575` ([#622](https://github.com/camster91/ashbi-platform/pull/622)). [Exact-main CI 38846564863](https://github.com/camster91/ashbi-platform/actions/runs/38846564863) and [hosted artifact build 38847562286](https://github.com/camster91/ashbi-platform/actions/runs/38847562286) passed. The reviewed SSH controller deployed the verified image after a fresh encrypted off-server backup; API and worker are healthy on the same image, and exact-revision strict readiness passed. Previous containers/images remain available for rollback. This is not a restore-drill claim.

Bounded live API QA passed **51/51** in the synthetic QA tenant, covering client task preview/confirmation/receipt, saved-report publication/CAS/role boundaries, own timesheets and ADMIN-only finance denial, with profile/fixture cleanup verified. Bounded Chrome 155 browser QA covered canonical channel drafts, own timesheets, finance denial, saved-report visibility/provenance and the actual unconfirmed task preview. The preserved bounded full browser run passed 34/35 checks and stopped at a helper selector mismatch; a subsequent task-only run passed 20/20 checks for the affected workflow and cleanup. These runs do not prove whole-app, mobile or human acceptance. The earlier 169 checks remain dated evidence on `37d02b3` and are not relabeled as rerun on `4130e80`. No model/provider requests, real email delivery or billing mutation were performed. Operational alert owner/destination remains unset. Sources stay primary until reviewed input/readback and final cutover.

Newly deployed: persisted source context #614, bounded successful-exchange memory #615, stored-inbox email-to-task #616, default-off confirmed client task proposals #617, saved service-report mappings/publication and last-good data #618, canonical client/project channel creation #619, included-work retainer notes #620 and TEAM own Timesheets navigation #621. Saved reports are not a live OpenSEO adapter. Human chat does not establish bot participation or private bot memory. Real provider quality, ChatGPT connection acceptance and Cameron/Bianca daily use remain unverified.

[#565](https://github.com/camster91/ashbi-platform/issues/565) remains the current execution queue. The following earlier records retain their original dates and revision attribution.

## Historical execution overlay — October 15

Verified production is `37d02b304898ec5c621199f4a2a880ebd64a6372`, including #608 shared staff questions/durable runs, #609 unused-export cleanup and #606 document history. Required main CI [38808629217](https://github.com/camster91/ashbi-platform/actions/runs/38808629217) passed 2,195 backend, 183 integration and 1,351 frontend tests plus required release gates.

Public exact-revision readiness and 169/169 bounded live API checks passed: 41 core/API/MCP/role checks, 24 communication/privacy checks, five client-portal filtering checks, 52 note/wiki-history checks and 47 agent-conversation CRUD checks. Normal QA browser acceptance on this release verified creating a shared conversation and persistence after full reload; a separate API cleanup helper passed 11/11 archive/readback checks. No Send or provider/model call was made; these results do not establish model quality, provider acceptance, full W1, whole-app replacement or source cutover.

The #608 W1 foundation is deployed. Prior-turn conversational memory, persisted context observation/source evidence and real-provider/team acceptance remain open. Source apps remain primary until bounded input/readback and cutover are verified. Coolify adoption and alert ownership/destination remain separate work.

Build-only xcode UUID fix #610 is merged as `82b1ec3fb0771eeea58d6171131b1bd05a66d60b`; main CI [38811217856](https://github.com/camster91/ashbi-platform/actions/runs/38811217856) is still in progress. It changes no runtime code and its packages are absent from the final production image. GitHub alert #208 was verified fixed at 2026-10-15T21:37:03Z; #207/#209 and stale automation #546/#567/#568 remain separate. This is not a claim that production serves the #610 merge.

### Earlier document-history release evidence — ebafa8c

Document history #606 and separate #605/#607 cleanup were verified at `ebafa8cd853b3f19a6397992b503fcaa4315a64e`. Final PR CI [38799311311](https://github.com/camster91/ashbi-platform/actions/runs/38799311311) and main CI [38801093378](https://github.com/camster91/ashbi-platform/actions/runs/38801093378) passed. The reviewed SSH controller deployed matching source after a fresh encrypted off-server backup; API and worker shared image `sha256:f29809ca8d368d2471256a0a956ffb9aa78fd9b24317c8e778012d7dd06b2da5`, with rollback containers retained. This was backup verification, not an executed restore drill.

That release passed 122/122 bounded live checks and normal QA-admin browser verification of unsaved-draft preservation while inspecting history, edit/save, restore as a third revision and reload persistence. Synthetic documents were soft-deleted/archived and QA sessions signed out. This browser restore evidence remains attributed to `ebafa8c`; it is not relabeled as a new test on `37d02b3`. The newest-100 policy, including current, has no automatic time purge; populated migration/retention/rollback/permission CI passed.

[#565](https://github.com/camster91/ashbi-platform/issues/565) owns the current execution queue. The older 18:43 UTC record below is retained as dated evidence; its serving revision and next-step list describe that earlier verification.

## Historical verification — October 15, 18:43 UTC

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
