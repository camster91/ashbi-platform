# Explicit document conflict recovery

Notes and workspace wiki pages already refuse stale writes using the observed
revision. A failed save retains the local editor draft. The recovery panel now
lets staff request the latest authorized document and compare its plain text
with the untouched local draft. This read does not change either document.

Staff may manually edit a reviewed title/content merge and explicitly put it
back into the editor. That action uses the latest saved metadata and observed
revision, clearly described alongside both sets of metadata. Downloading the
original draft preserves other unsaved fields. Applying a merge does not save;
the normal Save action remains required and a third intervening edit still
returns a conflict. There is no inferred merge, force-overwrite, automatic retry,
new collaboration storage or realtime transport.

The same panel is used by workspace Docs, project notes, the Notes modal and
workspace wiki. A failed/offline/revoked refresh removes the saved comparison
while retaining the local RAM draft and download control. Late responses from
an old document or unmounted editor cannot rebase a different document. The
comparison also expires when its local draft changes or another save begins.

This is explicit human conflict recovery, not simultaneous realtime convergence.
The browser journey uses two independent contexts with a synthetic shared CAS
transport; it cannot prove PostgreSQL serialization. Existing backend race and
history tests remain applicable. Proposals and other financial documents are
outside this slice.

History policy is unchanged: newest 100 recorded revisions including current,
authorized staff reads, fresh administrator restore as a new revision, and no
automatic time-based purge.
