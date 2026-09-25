import { useState, useEffect, useRef } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import SlowNotice, { SlowLoadingStatus, SLOW_WRITE_INLINE as slowWrite } from '../../components/ui/SlowNotice';
import { portalFetch, downloadPortalDocument, deletePortalDocument, BRAND, fmtDate, Icons } from './shared';

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
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Documents</h2>

      {/* Project selector */}
      {projects.length > 1 && (
        <select
          aria-label="Project for documents"
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value)}
          className="cp-input"
          style={{ maxWidth: 300 }}
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {/* Upload area */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="cp-visually-hidden"
        aria-label="Choose documents to upload"
        onChange={e => { if (e.target.files.length > 0) handleFileUpload(e.target.files); }}
      />
      <button
        type="button"
        className="cp-upload-zone"
        aria-describedby="documents-upload-help"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || !selectedProjectId}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BRAND.primary; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = BRAND.border; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = BRAND.border;
          if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
        }}
      >
        {Icons.upload}
        <p className="cp-text" style={{ fontWeight: 600, marginTop: '0.5rem' }}>
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <p id="documents-upload-help" className="cp-text-muted" style={{ fontSize: '0.8rem' }}>PDF, images, documents — up to 50MB</p>
      </button>
      <SlowNotice active={uploading} {...slowWrite} />

      {/* Document list */}
      {loading ? (
        <SlowLoadingStatus label="Loading documents..." className="cp-loading" />
      ) : documents.length === 0 ? (
        <div className="cp-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p className="cp-text-muted">No documents yet. Upload one above.</p>
        </div>
      ) : (
        <div className="cp-space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="cp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1.25rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="cp-text" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.originalName}</p>
                <p className="cp-text-muted" style={{ fontSize: '0.75rem' }}>
                  {(doc.size / 1024).toFixed(1)} KB &middot; {fmtDate(doc.createdAt)} &middot; {doc.uploadedBy?.name || 'Unknown'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem' }}>
                <button type="button" onClick={() => handleDownloadDoc(doc)} className="cp-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                  {Icons.download} Download
                </button>
                <button type="button" onClick={() => { setDeleteError(''); setDocumentToDelete(doc); }} disabled={deletingDocument} className="cp-btn-danger" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', minWidth: 44, minHeight: 44 }} aria-label={`Delete ${doc.originalName}`}>
                  {Icons.trash}
                </button>
              </div>
            </div>
          ))}
        </div>
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
