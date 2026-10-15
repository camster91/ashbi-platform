import { lazy, Suspense, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from '../hooks/useToast';
import Skeleton from './ui/Skeleton';
import DocumentSaveRecovery from './DocumentSaveRecovery';
const DocumentHistoryPanel = lazy(() => import('./DocumentHistoryPanel'));

const NOTE_TYPES = [
  { value: 'NOTE', label: 'Note', icon: '📝' },
  { value: 'MEETING_NOTES', label: 'Meeting Notes', icon: '📋' },
  { value: 'WIKI', label: 'Wiki', icon: '📚' },
  { value: 'DOC', label: 'Document', icon: '📄' }
];

export default function Notes({ projectId }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedNote, setSelectedNote] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState({ type: '', search: '' });

  // Fetch notes
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', projectId, filter],
    queryFn: () => api.getNotes(projectId, filter)
  });

  // Create note mutation
  const createMutation = useMutation({
    mutationFn: (data) => api.createNote(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
      setShowCreateModal(false);
    }
  });

  // Update note mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateNote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
      setSelectedNote(null);
    }
  });

  // Delete note mutation
  const deleteMutation = useMutation({
    mutationFn: ({ id }) => api.deleteNote(id),
    onSuccess: (result, { title }) => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
      setSelectedNote(null);
      toast.success({
        title: `Deleted “${title}”`,
        message: 'You can undo this deletion for the next 10 seconds.',
        duration: 10000,
        action: {
          label: `Undo delete ${title}`,
          onClick: () => restoreMutation.mutate(result.trashId),
        },
      });
    },
    onError: (error) => {
      toast.error('Note was not deleted', error.message);
    }
  });

  const restoreMutation = useMutation({
    mutationFn: api.restoreTrashItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
      toast.success('Note restored', 'The deleted note is back in this project.');
    },
    onError: (error) => {
      toast.error({
        title: 'Could not restore note',
        message: error.message || 'Open Trash or refresh before trying again.',
        duration: 0,
      });
    },
  });

  // Pin note mutation
  const pinMutation = useMutation({
    mutationFn: api.pinNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
    }
  });

  const getTypeInfo = (type) => NOTE_TYPES.find(t => t.value === type) || NOTE_TYPES[0];

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" aria-label="Loading notes" className="space-y-4">
        <span className="sr-only">Loading notes…</span>
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search notes..."
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            className="border rounded-lg px-3 py-2 w-64"
          />
          <select
            value={filter.type}
            onChange={(e) => setFilter({ ...filter, type: e.target.value })}
            className="border rounded-lg px-3 py-2"
          >
            <option value="">All Types</option>
            {NOTE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-info text-info-foreground px-4 py-2 rounded-lg hover:bg-info/90"
        >
          + New Note
        </button>
      </div>

      {/* Notes Grid */}
      {notes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">No notes yet</p>
          <p className="text-sm mt-1">Create your first note to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {notes.map((note) => (
            <div key={note.id}>
            <button
              type="button"
              onClick={() => { updateMutation.reset(); setSelectedNote(note); }}
              aria-label={`Open note ${note.title}`}
              aria-pressed={selectedNote?.id === note.id}
              className={`w-full min-h-11 bg-card rounded-lg border p-4 text-left cursor-pointer hover:shadow-md active:bg-muted/50 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 ${
                note.isPinned ? 'border-warning border-2' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span>{getTypeInfo(note.type).icon}</span>
                  <h3 className="font-medium text-foreground truncate">{note.title}</h3>
                </div>
                {note.isPinned && (
                  <span className="text-warning">📌</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
                {note.content.replace(/[#*`]/g, '').substring(0, 150)}...
              </p>
              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>{note.author?.name}</span>
                <span>{new Date(note.updatedAt).toLocaleDateString('en-CA')}</span>
              </div>
              {note.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {note.tags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
            <button type="button" onClick={() => pinMutation.mutate(note.id)} disabled={selectedNote?.id === note.id || pinMutation.isPending} aria-label={`${note.isPinned ? 'Unpin' : 'Pin'} ${note.title}`} className="min-h-11 px-3 text-warning disabled:opacity-50">
              {note.isPinned ? 'Unpin' : 'Pin'}
            </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <NoteEditor
          onSave={(data) => createMutation.mutate(data)}
          onClose={() => setShowCreateModal(false)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* Edit Modal */}
      {selectedNote && (
        <NoteEditor
          note={selectedNote}
          key={`${selectedNote.id}:${selectedNote.revision}`}
          onSave={(data) => updateMutation.mutate({ id: selectedNote.id, data: { ...data, revision: selectedNote.revision } })}
          saveError={updateMutation.error}
          onReload={note => { setSelectedNote(note); updateMutation.reset(); }}
          onHistoryRestored={() => {
            setSelectedNote(null);
            queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
            toast.success('Document restored', 'The selected version was saved as a new revision.');
          }}
          onDelete={() => deleteMutation.mutate({ id: selectedNote.id, title: selectedNote.title })}
          onClose={() => setSelectedNote(null)}
          isLoading={updateMutation.isPending}
          isDeleting={deleteMutation.isPending}
          deleteError={deleteMutation.error?.message}
        />
      )}
    </div>
  );
}

function NoteEditor({ note, onSave, onDelete, onClose, isLoading, isDeleting = false, deleteError, saveError, onReload, onHistoryRestored }) {
  const [formData, setFormData] = useState({
    title: note?.title || '',
    content: note?.content || '',
    type: note?.type || 'NOTE',
    tags: note?.tags || []
  });
  const [tagInput, setTagInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const removeTag = (tag) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });
  };

  return (
    <>
    {note && showHistory && <Suspense fallback={<p role="status">Loading version history…</p>}><DocumentHistoryPanel kind="note" documentId={note.id} currentRevision={note.revision} open={showHistory} onOpenChange={setShowHistory} hideTrigger onRestored={onHistoryRestored} /></Suspense>}
    <Modal isOpen={!showDeleteConfirm && !showHistory} onClose={onClose} title={note ? 'Edit Note' : 'Create Note'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {note && <button type="button" className="min-h-11 underline" disabled={isLoading || isDeleting} onClick={() => setShowHistory(true)}>Version history</button>}
        {note && <DocumentSaveRecovery noteId={note.id} draft={formData} error={saveError} onReload={onReload} />}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-medium text-foreground mb-1">Title</label>
            <input
              type="text"
              aria-label="Document title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
          <div className="w-full sm:w-48">
            <label className="block text-sm font-medium text-foreground mb-1">Type</label>
            <select
              aria-label="Document type"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
            >
              {NOTE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.icon} {type.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Content (Markdown supported)
          </label>
          <textarea
            aria-label="Document content"
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
            rows={15}
            placeholder="# Heading&#10;&#10;Write your note content here...&#10;&#10;- List item&#10;- Another item&#10;&#10;**Bold** and *italic* text supported."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Tags</label>
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="New document tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              className="flex-1 border rounded-lg px-3 py-2"
              placeholder="Add a tag..."
            />
            <button
              type="button"
              onClick={addTag}
              className="bg-muted px-4 py-2 rounded-lg hover:bg-muted/70"
            >
              Add
            </button>
          </div>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {formData.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-info/10 text-info px-2 py-1 rounded text-sm flex items-center gap-1"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-foreground"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4 border-t">
          <div>
            {note && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive/80"
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-info text-info-foreground rounded-lg hover:bg-info/90 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
    <ConfirmDialog
      isOpen={showDeleteConfirm}
      title="Delete note"
      description={note ? `Delete “${note.title || 'Note'}”? You can undo this action for 10 seconds.` : ''}
      confirmLabel="Delete note"
      onConfirm={onDelete}
      onCancel={() => setShowDeleteConfirm(false)}
      pending={isDeleting}
      error={deleteError}
    />
    </>
  );
}
