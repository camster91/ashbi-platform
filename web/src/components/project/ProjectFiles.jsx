import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { formatDate } from '../../lib/utils';

// The project's files and which of them the client sees. Project files are
// internal by default (screen recordings included); a staff member shares a
// file to list it in the client portal's Documents tab. Files the client
// uploaded through the portal are already visible to them.

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectFiles({ projectId }) {
  const id = useId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // The server allows the uploader or an admin to change who sees a file.
  const canChange = (file) => user?.role === 'ADMIN' || (Boolean(user?.id) && file.uploadedBy?.id === user.id);
  const [pendingId, setPendingId] = useState('');
  const [error, setError] = useState('');
  const filesQuery = useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () => api.getAttachments('PROJECT', projectId),
  });
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : [];

  const toggle = async (file) => {
    setError('');
    setPendingId(file.id);
    try {
      await api.setAttachmentClientVisibility(file.id, !file.clientVisible);
      await queryClient.invalidateQueries({ queryKey: ['project-files', projectId] });
    } catch (err) {
      setError(err?.message || 'The file could not be updated.');
    } finally {
      setPendingId('');
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby={`${id}-heading`}>
      <div className="border-b border-border px-5 py-4">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold text-foreground"><FolderOpen className="h-5 w-5 text-primary" aria-hidden="true" />Project files</h2>
        <p className="mt-1 text-sm text-muted-foreground">Files stay internal, including screen recordings, until you share them. Shared files appear in the client portal&apos;s Documents.</p>
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
                      disabled={!canChange(file) || pendingId === file.id}
                      aria-describedby={canChange(file) ? undefined : `${id}-locked-${file.id}`}
                      onChange={() => toggle(file)}
                    />
                    Visible to client
                  </label>
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
    </section>
  );
}
