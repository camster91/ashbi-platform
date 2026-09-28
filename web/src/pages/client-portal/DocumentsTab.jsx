import { useState, useEffect, useRef } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Alert, LoadingState } from '../../components/ui';
import SlowNotice, { SLOW_WRITE_INLINE as slowWrite } from '../../components/ui/SlowNotice';
import { portalFetch, downloadPortalDocument, deletePortalDocument, PortalDocumentList, PortalUploadZone, portalFieldStyles, pageTitleClass } from './shared';

// ── Documents Tab ─────────────────────────────────────────────────────────────
export default function DocumentsTab({ projects, token }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    portalFetch(`/api/client-portal/projects/${selectedProjectId}/documents`, token)
      .then(r => r.json())
      .then(data => { setDocuments(Array.isArray(data) ? data : []); })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [selectedProjectId, token]);

  async function handleFileUpload(files) {
    if (!files || files.length === 0 || !selectedProjectId) return;
    setUploading(true);
    setUploadError(null);
    const failed = [];
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await portalFetch(`/api/client-portal/projects/${selectedProjectId}/upload`, token, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) {
          failed.push({ name: file.name, status: res.status });
        }
      }
      const res = await portalFetch(`/api/client-portal/projects/${selectedProjectId}/documents`, token);
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
      if (failed.length > 0) {
        setUploadError(`${failed.length} file(s) failed to upload — ${failed.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      setUploadError(err?.message ?? 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc() {
    if (!documentToDelete || deletingDocument) return;
    setDeletingDocument(true);
    setDeleteError('');
    try {
      await deletePortalDocument(token, documentToDelete.id);
      setDocuments(prev => prev.filter(d => d.id !== documentToDelete.id));
      setDocumentToDelete(null);
    } catch (err) {
      setDeleteError(err?.message ?? 'Delete failed — the file remains available.');
    } finally {
      setDeletingDocument(false);
    }
  }

  async function handleDownloadDoc(doc) {
    try {
      await downloadPortalDocument(token, doc);
    } catch (err) {
      setUploadError(err?.message ?? 'Download failed — please try again');
    }
  }

  return (
    <div className="space-y-4">
      <h2 className={pageTitleClass}>Documents</h2>

      {/* Project selector */}
      {projects.length > 1 && (
        <select
          aria-label="Project for documents"
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value)}
          className={portalFieldStyles('max-w-[300px]')}
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {/* Upload area */}
      <PortalUploadZone
        inputRef={fileInputRef}
        inputLabel="Choose documents to upload"
        helpId="documents-upload-help"
        uploading={uploading}
        disabled={uploading || !selectedProjectId}
        onFiles={handleFileUpload}
      />
      <SlowNotice active={uploading} {...slowWrite} />

      {/* Upload and download failures, announced like the project Documents view */}
      {uploadError && (
        <Alert variant="error" onDismiss={() => setUploadError(null)} dismissLabel="Dismiss upload error">
          {uploadError}
        </Alert>
      )}

      {/* Document list */}
      {loading ? (
        <LoadingState label="Loading documents..." />
      ) : (
        <PortalDocumentList
          documents={documents}
          onDownload={handleDownloadDoc}
          onDelete={doc => { setDeleteError(''); setDocumentToDelete(doc); }}
          deleting={deletingDocument}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(documentToDelete)}
        title="Delete document?"
        description={documentToDelete ? `Permanently delete “${documentToDelete.originalName}”? This removes the file from the client portal and cannot be undone.` : ''}
        confirmLabel="Permanently delete"
        onConfirm={handleDeleteDoc}
        onCancel={() => { setDeleteError(''); setDocumentToDelete(null); }}
        pending={deletingDocument}
        error={deleteError}
      />
    </div>
  );
}
