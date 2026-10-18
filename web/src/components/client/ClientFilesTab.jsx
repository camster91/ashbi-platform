import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatBytes } from '../../lib/upload';
import { Card } from '../ui';
import QueryErrorState from '../QueryErrorState';
import { emptyClass, panelHeaderClass, panelTitleClass } from './clientPageStyles';

// Client page "Files" tab: the project files of the client's most recently
// updated projects, newest first, from the same per-project request (and
// cache entry) as each project's Files panel. Uploading, sharing and deleting
// stay on the project page.

export const FILES_TAB_PROJECT_LIMIT = 10;

export default function ClientFilesTab({ projects = [] }) {
  const recentProjects = projects.slice(0, FILES_TAB_PROJECT_LIMIT);
  const fileQueries = useQueries({
    queries: recentProjects.map((project) => ({
      queryKey: ['project-files', project.id],
      queryFn: () => api.getAttachments('PROJECT', project.id),
      retry: false,
    })),
  });
  const loading = fileQueries.some((query) => query.isLoading);
  const failed = fileQueries.find((query) => query.isError);
  const files = fileQueries
    .flatMap((query, index) => (Array.isArray(query.data) ? query.data : []).map((file) => ({ ...file, project: recentProjects[index] })))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-files-heading">
      <div className={panelHeaderClass}>
        <h2 id="client-files-heading" className={panelTitleClass}>Files</h2>
        {projects.length > FILES_TAB_PROJECT_LIMIT && (
          <span className="text-xs text-muted-foreground">From the {FILES_TAB_PROJECT_LIMIT} most recently updated projects</span>
        )}
      </div>
      {recentProjects.length === 0 ? (
        <p className={emptyClass}>Files live in projects. This client has no projects yet.</p>
      ) : loading ? (
        <p role="status" className={emptyClass}>Loading files…</p>
      ) : failed && files.length === 0 ? (
        <div className="px-5 pb-4">
          <QueryErrorState error={failed.error} message="Files could not be loaded" onRetry={() => fileQueries.forEach((query) => query.isError && query.refetch())} />
        </div>
      ) : files.length === 0 ? (
        <p className={emptyClass}>No project files yet.</p>
      ) : (
        <>
          {failed && <p role="alert" className="px-5 pb-2 text-sm text-destructive">Some projects&apos; files could not be loaded.</p>}
          <ul className="px-5 pb-3">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 py-3 first:border-t-0">
                <div className="min-w-0 flex-[1_1_240px]">
                  <p className="font-medium text-foreground break-words">{file.originalName}</p>
                  <p className="text-xs text-muted-foreground">
                    <Link to={`/project/${file.project.id}`} className="underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{file.project.name}</Link>
                    {' · '}
                    {[formatBytes(file.size), file.uploadedBy?.name, formatDate(file.createdAt)].filter(Boolean).join(' · ')}
                    {(file.clientVisible || file.sharedViaReview) && <> · <span className="font-semibold text-success">In the client portal</span></>}
                  </p>
                </div>
                {typeof file.filename === 'string' && file.filename.length > 0 && (
                  <a
                    href={api.attachmentFileUrl(file.filename)}
                    download={file.originalName}
                    aria-label={`Download ${file.originalName}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
