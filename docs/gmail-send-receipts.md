# Gmail send receipts and recovery

Every Gmail send requires a caller-generated UUID `idempotencyKey`. The app
retains that key before making the request, scoped to user, organization and
Hub thread. Browser storage contains only the key and delivery state.

The server verifies active staff authority, TEAM thread assignment, live
canonical client/project relationships and the connected mailbox. Approved
drafts retain their exact approved subject and body. A receipt and audit commit
before dispatch; only that claim may call Gmail. Changed content or mailbox
cannot reuse its key. Concurrent keys cannot send the same approved response
while an earlier attempt may have delivered it.

| State | Meaning | Recovery |
| --- | --- | --- |
| `DISPATCHING` | The committed claim may already have contacted Gmail | Check saved status; never automatically redispatch |
| `UNKNOWN` | Delivery could not be confirmed | Check the original mailbox; a replacement send may duplicate delivery |
| `ACCEPTED_PENDING_RECORD` | Gmail accepted, but Hub records are unfinished | Explicitly finish saving locally; no email is sent |
| `COMPLETED` | Message, thread, approved Response and receipt finalized together | Read the result; repeated requests do not dispatch |
| `REJECTED` | A definite rejection was recorded | Explicitly clear the confirmed attempt before reviewing a new send |

Acceptance IDs persist before business-record projection. If recording acceptance
fails, the original claim remains a no-resend fence. Concurrent local repairs
lock the receipt and create at most one Hub message. Finalization preserves
`AWAITING_RESPONSE` and resets escalation; the UI no longer calls the separate
`/responses/:id/sent` action that could reopen the thread after delivery.

`GET /api/gmail/send-receipts/:key` reads a safe local projection.
`POST /api/gmail/send-receipts/:key/reconcile` with `{}` repairs accepted
records. Both recheck current authority and record scope; neither needs OAuth,
calls Gmail or resends mail. `POST /api/gmail/send` retains success/message/thread
IDs and adds receipt identity/status. Uncertain outcomes return 202 without
claiming success. Missing keys fail validation before dispatch.

Only a 404 with `GMAIL_SEND_NOT_FOUND` confirms absence of a claim for the active
actor's saved key. Generic thread/assignment denials retain the uncertain intent;
losing access does not prove that an earlier email was never sent.

Migration `20261015120000_gmail_send_receipts` is required. SQL guards preserve
immutable identity, payload/mailbox binding, accepted IDs and valid transitions.
The scoped client permits only outcome updates and blocks deletion/upsert.
Exports omit internal keys/hashes. Audits contain states and record IDs, never
email content, tokens or raw provider errors.

Tests use injected transports. PostgreSQL coverage verifies committed claims,
same-key races, different-key approved-draft collisions, uncertain outcomes,
rollback and concurrent repair. This does not establish real inbox/provider
acceptance. Verified per-mailbox connections, complete synchronization and RFC
threading remain separate work. Source apps stay primary during migration QA.
