import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Modal from './Modal';
import { useToast } from '../hooks/useToast';

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
    onSuccess: (_, { id, title }) => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] });
      setSelectedNote(null);
      toast.success({
        title: `Deleted “${title}”`,
        message: 'You can undo this deletion for the next 10 seconds.',
        duration: 10000,
        action: {
          label: `Undo delete ${title}`,
          onClick: () => restoreMutation.mutate(id),
        },
      });
    },
    onError: (error) => {
      toast.error('Note was not deleted', error.message);
    }
  });

  const restoreMutation = useMutation({
    mutationFn: api.restoreNote,
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
      <div className="animate-pulse space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-gray-100 rounded-lg h-24"></div>
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
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + New Note
        </button>
      </div>

      {/* Notes Grid */}
      {notes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No notes yet</p>
          <p className="text-sm mt-1">Create your first note to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {notes.map((note) => (
            <button
              type="button"
              key={note.id}
              onClick={() => setSelectedNote(note)}
              aria-label={`Open note ${note.title}`}
              aria-pressed={selectedNote?.id === note.id}
              className={`w-full min-h-11 bg-white rounded-lg border p-4 text-left cursor-pointer hover:shadow-md active:bg-gray-50 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                note.isPinned ? 'border-yellow-400 border-2' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span>{getTypeInfo(note.type).icon}</span>
                  <h3 className="font-medium text-gray-900 truncate">{note.title}</h3>
                </div>
                {note.isPinned && (
                  <span className="text-yellow-500">📌</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-2 line-clamp-3">
                {note.content.replace(/[#*`]/g, '').substring(0, 150)}...
              </p>
              <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                <span>{note.author?.name}</span>
                <span>{new Date(note.updatedAt).toLocaleDateString('en-CA')}</span>
              </div>
              {note.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {note.tags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
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
          onSave={(data) => updateMutation.mutate({ id: selectedNote.id, data })}
          onDelete={() => deleteMutation.mutate({ id: selectedNote.id, title: selectedNote.title })}
          onPin={() => pinMutation.mutate(selectedNote.id)}
          onClose={() => setSelectedNote(null)}
          isLoading={updateMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function NoteEditor({ note, onSave, onDelete, onPin, onClose, isLoading, isDeleting = false }) {
  const [formData, setFormData] = useState({
    title: note?.title || '',
    content: note?.content || '',
    type: note?.type || 'NOTE',
    tags: note?.tags || []
  });
  const [tagInput, setTagInput] = useState('');

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
    <Modal isOpen={true} onClose={onClose} title={note ? 'Edit Note' : 'Create Note'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
          <div className="w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Content (Markdown supported)
          </label>
          <textarea
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
            rows={15}
            placeholder="# Heading&#10;&#10;Write your note content here...&#10;&#10;- List item&#10;- Another item&#10;&#10;**Bold** and *italic* text supported."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              className="flex-1 border rounded-lg px-3 py-2"
              placeholder="Add a tag..."
            />
            <button
              type="button"
              onClick={addTag}
              className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200"
            >
              Add
            </button>
          </div>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {formData.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm flex items-center gap-1"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-blue-900"
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
                  onClick={onPin}
                  className="text-yellow-600 hover:text-yellow-700 mr-4"
                >
                  {note.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-red-600 hover:text-red-700"
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
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
