# Account manager run attention

Failed and uncertain account manager requests appear in their requester's Daily
Queue until that requester explicitly marks them reviewed. The queue links to
the exact saved conversation and run, including an older run outside the first
history page. It never includes prompts or responses in the queue projection.

Only active staff with current access to the client and conversation can read
or review a run. Workspace-channel requests additionally require current source
channel membership and matching client/project bindings. Administrators cannot
mark a teammate's personal attention reviewed. Shared conversation pickers do
not enumerate channel-bound history.

`POST /api/clients/:clientId/assistant/conversations/:conversationId/runs/:runId/review`
accepts an empty JSON object and returns the normal authorized run projection
with `attentionReviewedAt`. Repeated acknowledgement returns the persisted
timestamp. The sidecar and `client_agent_run.reviewed` audit event commit in one
transaction. A failed audit leaves the run unreviewed. Reads also include
`attentionReviewedAt`, which is null until acknowledged.

Marking reviewed removes personal attention only. It does not change the
immutable FAILED/UNKNOWN outcome, reconcile provider cost, retry or cancel a
request, start inference, send a message or change billing. The uncertain-cost
warning remains in history. A response that cannot confirm persistence requires
an explicit read of saved review status before another manual attempt. Opening
or rendering a run never acknowledges it.

The queue applies organization, requester, audience, client and project filters
before its 101-row sentinel limit. Its existing date and owner semantics still
apply; these undated requests are excluded when a due-date filter is supplied.
The source participates in existing truncation and isolated-source failure
reporting. Queued, running, successful and cancelled requests are excluded.

Migration `20261017020000_client_agent_run_reviews` adds the review sidecar and
same-organization run foreign key. It preserves terminal-run triggers and
existing confidentiality migrations. Run deletion cascades its review; this
does not grant request code permission to delete review evidence independently.
Old application builds ignore the additive table. Existing deployment backup,
schema-boundary and rollback checks remain required.

Implementation, required CI, deployment and target acceptance are separate
checkpoints. See issue #565 for current status; this contract does not establish
a live release, actual provider response or company/team acceptance.
