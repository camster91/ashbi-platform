import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { formatDate } from '../../lib/utils';
import Button from '../ui/Button';
import ConfirmDialog from '../ConfirmDialog';

// The project's files and which of them the client sees. Project files are
// internal by default (screen recordings included); a staff member shares a
// file to list it in the client portal's Documents tab. Files the client
// uploaded through the portal are already visible to them. "Share all with
// client" shares every hidden file in one step (with Undo), for example after
// the deploy that hid staff files from the portal.

// The server caps one bulk request; larger sets go in consecutive requests.
const BULK_BATCH_SIZE = 500;
const UNDO_MS = 10000;

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const filesLabel = (count) => `${count} ${count === 1 ? 'file' : 'files'}`;
const stays = (count) => (count === 1 ? 'stays' : 'stay');
const isClientUpload = (file) => file.uploadedBy?.role === 'CLIENT';
// What the client sees in the portal: files shared with them, and files in a
// media review shared with them (whatever clientVisible says).
const seenByClient = (file) => Boolean(file.clientVisible) || Boolean(file.sharedViaReview);
const reviewNote = (count) => `${filesLabel(count)} shared through a client review ${stays(count)} visible.`;

// Set clientVisible on the given files, BULK_BATCH_SIZE at a time. Returns
// the ids that changed and the skipped files; a failure part-way still
// reports what changed before it (`error.partial`). Silent: the caller shows
// the one message for a failure.
async function setVisibility(projectId, clientVisible, ids) {
  const result = { changedIds: [], skipped: [] };
  for (let start = 0; start < ids.length; start += BULK_BATCH_SIZE) {
    try {
      const batch = await api.setProjectAttachmentsClientVisibility(projectId, clientVisible, ids.slice(start, start + BULK_BATCH_SIZE), { silent: true });
      result.changedIds.push(...(batch?.changedIds || []));
      result.skipped.push(...(batch?.skipped || []));
    } catch (err) {
      err.partial = result;
      throw err;
    }
  }
  return result;
}

function skippedMessage(skipped, shared) {
  const count = (reason) => skipped.filter((skip) => skip.reason === reason).length;
  const notPermitted = count('not_permitted');
  const clientUploads = count('client_upload');
  const missing = skipped.length - notPermitted - clientUploads;
  const parts = [];
  if (notPermitted > 0) {
    parts.push(`${filesLabel(notPermitted)} ${notPermitted === 1 ? 'was' : 'were'} skipped: only the uploader or an admin can ${shared ? 'share' : 'hide'} ${notPermitted === 1 ? 'it' : 'them'}.`);
  }
  if (clientUploads > 0) {
    parts.push(`${filesLabel(clientUploads)} the client uploaded ${stays(clientUploads)} visible.`);
  }
  if (missing > 0) {
    parts.push(`${filesLabel(missing)} ${missing === 1 ? 'was' : 'were'} skipped because ${missing === 1 ? 'it is' : 'they are'} no longer in this project.`);
  }
  return parts.join(' ');
}

export default function ProjectFiles({ projectId }) {
  const id = useId();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  // The server allows the uploader or an admin to change who sees a file.
  const canChange = (file) => user?.role === 'ADMIN' || (Boolean(user?.id) && file.uploadedBy?.id === user.id);
  const [pendingId, setPendingId] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const filesQuery = useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () => api.getAttachments('PROJECT', projectId),
  });
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['project-files', projectId] });

  // One clear action: share what the client cannot see, or, once they see
  // everything, stop sharing it. A bulk hide leaves the client's own uploads
  // alone (one at a time still works), and a file in a shared client review
  // stays visible through the review.
  const sharedCount = files.filter(seenByClient).length;
  const bulkShare = sharedCount < files.length;
  const candidates = bulkShare
    ? files.filter((file) => !seenByClient(file))
    : files.filter((file) => file.clientVisible && !isClientUpload(file));
  const changeable = candidates.filter(canChange);
  const changeableCount = changeable.length;
  const lockedCount = candidates.length - changeableCount;
  const clientUploadCount = bulkShare ? 0 : files.filter((file) => file.clientVisible && isClientUpload(file)).length;
  const reviewKeptCount = bulkShare ? 0 : changeable.filter((file) => file.sharedViaReview).length;
  const bulkLabel = bulkShare ? 'Share all with client' : 'Hide all from client';

  const toggle = async (file) => {
    setError('');
    setPendingId(file.id);
    try {
      await api.setAttachmentClientVisibility(file.id, !file.clientVisible);
      await refresh();
    } catch (err) {
      setError(err?.message || 'The file could not be updated.');
    } finally {
      setPendingId('');
    }
  };

  const undo = async (shared, changedIds) => {
    try {
      const result = await setVisibility(projectId, !shared, changedIds);
      const note = skippedMessage(result.skipped, !shared);
      toast.success({
        title: shared ? 'Files hidden again' : 'Files shared again',
        message: note || 'The files are back the way they were.',
        duration: note ? 0 : undefined,
        dedupe: false,
      });
    } catch (err) {
      toast.error({
        title: 'Could not undo',
        message: `${err?.message || 'The files could not be updated.'} Change them one at a time in Project files.`,
        duration: 0,
        dedupe: false,
      });
    } finally {
      await refresh();
    }
  };

  // `context` is what the confirm step showed: files it said would stay as
  // they are (lockedIds) and files in a shared client review (reviewIds).
  const announce = (context, { changedIds, skipped }) => {
    const { shared, lockedIds, reviewIds } = context;
    const note = skippedMessage(skipped, shared);
    if (changedIds.length === 0) {
      toast.info({ title: 'No files changed', message: note || 'These files were already up to date.', duration: 0, dedupe: false });
      return;
    }
    const reviewKept = shared ? 0 : changedIds.filter((changedId) => reviewIds.has(changedId)).length;
    let title = `Shared ${filesLabel(changedIds.length)} with the client`;
    let summary = 'They now appear in the client portal’s Documents.';
    if (!shared) {
      title = reviewKept > 0 ? `Stopped sharing ${filesLabel(changedIds.length)}` : `Hid ${filesLabel(changedIds.length)} from the client`;
      summary = reviewKept > 0 ? reviewNote(reviewKept) : 'The client no longer sees them in their portal.';
    }
    // Files the confirm step already named as someone else's are expected;
    // anything else skipped needs reading, so that toast stays until dismissed.
    const expected = skipped.every((skip) => skip.reason === 'not_permitted' && lockedIds.has(skip.id));
    toast.success({
      title,
      message: [summary, note].filter(Boolean).join(' '),
      duration: expected ? UNDO_MS : 0,
      dedupe: false,
      action: { label: 'Undo', onClick: () => undo(shared, changedIds) },
    });
  };

  const runBulk = async () => {
    const context = {
      shared: bulkShare,
      lockedIds: new Set(candidates.filter((file) => !canChange(file)).map((file) => file.id)),
      reviewIds: new Set(files.filter((file) => file.sharedViaReview).map((file) => file.id)),
    };
    setBulkError('');
    setBulkPending(true);
    try {
      const result = await setVisibility(projectId, context.shared, candidates.map((file) => file.id));
      setConfirmOpen(false);
      announce(context, result);
    } catch (err) {
      const partial = err?.partial;
      const message = err?.message || 'The files could not be updated.';
      setBulkError(partial?.changedIds?.length
        ? `${message} ${filesLabel(partial.changedIds.length)} ${context.shared ? 'were shared' : 'were hidden'} before this stopped.`
        : message);
      if (partial?.changedIds?.length) announce(context, partial);
    } finally {
      setBulkPending(false);
      await refresh();
    }
  };

  let confirmLead = `Share ${filesLabel(changeableCount)} with the client? They’ll see ${changeableCount === 1 ? 'it' : 'them'} in their portal’s Documents.`;
  if (!bulkShare) {
    confirmLead = reviewKeptCount > 0
      ? `Stop sharing ${filesLabel(changeableCount)} with the client?`
      : `Hide ${filesLabel(changeableCount)} from the client? They’ll no longer see ${changeableCount === 1 ? 'it' : 'them'} in their portal.`;
  }
  const confirmDescription = [
    confirmLead,
    reviewKeptCount > 0 ? reviewNote(reviewKeptCount) : '',
    clientUploadCount > 0 ? 'Files the client uploaded stay visible.' : '',
    lockedCount > 0
      ? `${filesLabel(lockedCount)} uploaded by someone else will stay ${bulkShare ? 'hidden' : 'shared'}: only the uploader or an admin can change ${lockedCount === 1 ? 'it' : 'them'}.`
      : '',
    'You can undo this right after.',
  ].filter(Boolean).join(' ');
  let confirmLabel = `Share ${filesLabel(changeableCount)}`;
  if (!bulkShare) confirmLabel = reviewKeptCount > 0 ? `Stop sharing ${filesLabel(changeableCount)}` : `Hide ${filesLabel(changeableCount)}`;
  const lockedReason = candidates.length > 0
    ? `Only the uploader or an admin can ${bulkShare ? 'share' : 'hide'} ${candidates.length === 1 ? 'this file' : 'these files'}.`
    : 'Files the client uploaded and files in a shared client review stay visible. Change them one at a time.';

  const showBulk = !filesQuery.isLoading && !filesQuery.error && files.length > 0;

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold text-foreground"><FolderOpen className="h-5 w-5 text-primary" aria-hidden="true" />Project files</h2>
          <p className="mt-1 text-sm text-muted-foreground">Files stay internal, including screen recordings, until you share them. Shared files appear in the client portal&apos;s Documents.</p>
          {showBulk && (
            <p id={`${id}-summary`} className="mt-1 text-sm text-muted-foreground">
              {sharedCount} of {filesLabel(files.length)} shared with the client.
            </p>
          )}
        </div>
        {showBulk && (
          <div className="flex shrink-0 flex-col sm:items-end">
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              leftIcon={bulkShare ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              disabled={changeableCount === 0 || Boolean(pendingId) || bulkPending}
              loading={bulkPending}
              aria-describedby={changeableCount === 0 ? `${id}-bulk-locked` : `${id}-summary`}
              onClick={() => { setBulkError(''); setConfirmOpen(true); }}
            >
              {bulkLabel}
            </Button>
            {changeableCount === 0 && (
              <p id={`${id}-bulk-locked`} className="mt-1 text-xs text-muted-foreground">{lockedReason}</p>
            )}
          </div>
        )}
      </div>
      <div className="p-5">
        {filesQuery.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading files…</p>
        ) : filesQuery.error ? (
          <p role="alert" className="text-sm text-destructive">Files could not be loaded.</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No project files yet.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{file.originalName}</p>
                  <p className="text-xs text-muted-foreground">
                    {[formatFileSize(file.size), file.uploadedBy?.name, formatDate(file.createdAt)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-col items-end">
                  <label
                    className={`inline-flex min-h-11 items-center gap-2 text-sm text-foreground ${canChange(file) ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                    title={canChange(file) ? undefined : 'Only the uploader or an admin can change this'}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={Boolean(file.clientVisible)}
                      disabled={!canChange(file) || pendingId === file.id || bulkPending}
                      aria-describedby={[
                        canChange(file) ? '' : `${id}-locked-${file.id}`,
                        file.sharedViaReview ? `${id}-review-${file.id}` : '',
                      ].filter(Boolean).join(' ') || undefined}
                      onChange={() => toggle(file)}
                    />
                    Visible to client
                  </label>
                  {file.sharedViaReview && (
                    <p id={`${id}-review-${file.id}`} className="text-xs text-muted-foreground">Visible to the client through a shared review.</p>
                  )}
                  {!canChange(file) && (
                    <p id={`${id}-locked-${file.id}`} className="text-xs text-muted-foreground">Only the uploader or an admin can change this.</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
      <ConfirmDialog
        isOpen={confirmOpen}
        title={bulkShare ? 'Share files with the client' : 'Hide files from the client'}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        destructive={false}
        onConfirm={runBulk}
        onCancel={() => { setBulkError(''); setConfirmOpen(false); }}
        pending={bulkPending}
        error={bulkError}
      />
    </section>
  );
}
