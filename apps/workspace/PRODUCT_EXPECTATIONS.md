# Professional workspace expectations

Research date: 29 October 2026. Continuation of UX rebuild #784. There is no established universal “2027 standard”; the requirements below use current primary sources as the baseline for 2027 planning. Competitor capabilities are references, not promises of parity.

| Expectation and evidence | Ashbi evidence / gap | Acceptance direction |
| --- | --- | --- |
| Fast task navigation, search, filters, assignment and multiple views: [ClickUp views](https://help.clickup.com/hc/en-us/articles/35368731425175-The-views-control-bar), [keyboard shortcuts](https://help.clickup.com/hc/en-us/articles/6309030550167-Use-keyboard-shortcuts) | Search, list/board and server-side filters exist. Reusable named task views and one-click own assignments were missing. | This increment adds explicit saved task views and Assigned to me; verify reload, deletion, failure, mobile and keyboard behavior. |
| Connected client collaboration with controlled project/task/file/billing visibility: [Bonsai portal](https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal), [permissions](https://help.hellobonsai.com/en/articles/1894805-all-about-user-permissions-in-bonsai) | Scoped records, agreements and invoice workflows exist with synthetic integration coverage. Client uploads and project messaging are implemented locally. Production client-account acceptance and notifications remain outstanding. | Test staff/client workflows with explicit sharing and denial paths; implement missing capabilities as separate complete slices. |
| Accessible interactions: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Existing automated checks largely target 2.1 AA. | Add 2.2 AA checks for changed surfaces, keyboard focus and mobile reflow; manual assistive-technology testing remains necessary before claiming conformance. |
| Responsive loading and interaction: [Web Vitals](https://web.dev/articles/vitals) | No representative production field baseline established. | Target p75 LCP ≤2.5 seconds, INP ≤200 ms, CLS ≤0.1 separately on mobile/desktop. Lab checks are diagnostic, not field acceptance. |
| Secure account, session and resource authorization: [OWASP ASVS](https://owasp.org/projects/asvs) | Native auth and tenant isolation have tests; no full ASVS assessment established. | Verify authorization/session requirements against a documented ASVS scope; do not label this increment security certification. |
| Dependable paid workflows | Stripe remains test-only; real payments/email acceptance incomplete. | Provider-backed sandbox journey and reviewed live activation are release gates for billing. Do not present test receipts as delivery or payment. |
| Recovery and operational reliability | Private D1 export restored successfully before last production release. | Maintain database/object recovery coverage and documented recovery objectives; interrupted-save behavior stays under regression testing. |

## Implemented slice: reusable task views

The Tasks page now offers Assigned to me for staff and explicit named saved views for each account/project context. A view stores applied search/project/status/assignee filters, archived-project inclusion and List/Board layout. Apply always re-queries the existing API; it does not cache results or widen authorization. Project routes retain their project boundary. Clear filters leaves saved views intact. Removing a view removes preferences only.

Preferences stay on the current browser/origin, keyed by actor ID and project ID; they are not team-shared or synchronized. They may contain the user's view names/search text and opaque record IDs. Saving is explicit and explained before storage. Limits are 20 views per context, 60-character names and bounded validated preference records. Duplicate names, unavailable/full storage and malformed stored data produce visible errors. No credentials or task bodies are stored. Browser data clearing removes the views.

## Controlled client uploads

Staff can now enable **Allow client uploads** when adding or editing a project. Migration `0029.sql` adds a default-off flag. Clients can upload only to their own shared, non-archived projects with this setting enabled. Client uploads are shared with the team and authorized contacts for that client; deletion, restoration and sharing changes remain staff controls.

Active identity, organization, role, client ownership, sharing, archive status and opt-in are checked before upload and atomically before publication after storage. A revoked upload remains pending and unavailable. The 5 MiB stream limit, safe filenames, private originals, checksum verification, attachment-only downloads and Origin checks remain enforced. Disabling uploads prevents new submissions without unsharing existing files.

Verified locally: source file API 13/13; combined compiled-file/native-auth/record API 58/58; core browser 156/156; compiled recovery 46/46. A separate two-session browser walkthrough verified staff opt-in, client upload, staff access and mobile rendering. The new browser journey checks byte-exact retrieval, revocation and WCAG 2.2 AA rules at 390/768/1440px. The final build adds explanatory text beside the setting; the final local walkthrough exercised that build.

Production is unchanged. Apply the additive migration through the established backup/release procedure before deploying this bundle. Existing projects remain opted out until staff enables them. Antivirus scanning, automatic upload deduplication, client notifications and project messaging remain separate readiness gaps. Check Files before retrying an upload with a lost acknowledgement.

## Validation and release status

Implementation is local on `agent/784-saved-task-views`. Production remains the October 29 deployment. Automated/browser results are recorded after execution; this document does not establish hosted acceptance, full accessibility conformance, competitor parity or completion of the other gaps above.

Verified locally on 29 October: dry-run Worker build passed; the core built-artifact browser group passed 155/155 with no skips. New coverage exercises saved filters/layout through reload, duplicate names, removal, isolated browser storage, unavailable storage and keyboard focus. The changed surface passed axe WCAG 2.2 AA rules; retained board checks passed at 390/768/1440px. A separate native-auth fixture walkthrough verified save/reload/apply and mobile overflow, with zero axe violations and rendered screenshots inspected. Initial regression runs caught a duplicate live-status selector and selected-button transition contrast; both were corrected without relaxing assertions. No real-provider, production performance or hosted acceptance claim follows from these checks.


## Project conversations

Each project now has a Messages tab for staff and authorized client contacts. Messages are plain text, newest first, with explicit refresh and older-history pagination. Project sharing controls client visibility; archiving makes the conversation read-only. Message history is retained without edit/delete controls. No email, push notification or real-time subscription is implied.

The API validates active actor identity and project scope in reads and atomic inserts. Author IDs are server-owned. Per-author request IDs recover repeated/concurrent submissions once; reusing an ID with different content or another project conflicts. The interface retains the draft and original request ID for uncertain replies in the current page session, prevents editing an uncertain submission, and ignores stale view responses. After a full browser reload, review the conversation before manually posting again; cross-reload pending-message recovery is not implemented.

Migration `0030.sql` adds the conversation table and paging index. Staff's bounded export now includes project messages. Recovery verification seeds a real message through the API, restores exact table/schema data, checks client access and recovers the original retry identity. Current source/compiled API and record checks pass 49/49; recovery passes 47/47. Browser and local visual results are recorded after the final run.

Release remains local. Production requires both pending migrations (`0029.sql`, then `0030.sql`) through the existing backup/release procedure. Both migrations are additive; a previous Worker can be restored without dropping the new data. Client notifications, real provider billing acceptance, production performance measurement and the scoped security review remain open.

Final messaging validation: core browser 157/157 passed with no skips. The run covers literal text rendering, client replies, a dropped POST acknowledgement followed by duplicate-safe retry, archive read-only behavior and WCAG 2.2 AA checks at 390/768/1440px. Separate local staff/client sessions exchanged messages and refreshed the conversation; the mobile screenshot was inspected. A capture timeout on the busy local machine was resolved with a read-only capture, without repeating the posts. The wider suite exposed a transient contrast failure while deselecting a task view; transitions are now disabled for both selected and unselected task-view controls, with the original assertion retained. No production, email or real-time delivery acceptance is implied.
