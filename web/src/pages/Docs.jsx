import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Plus,
  Pin,
  PinOff,
  Edit2,
  Trash2,
  Save,
  Search,
  FolderOpen,
  X,
  ChevronDown,
  ChevronRight,
  FileText,
  Users,
  Layers,
  StickyNote,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { cn } from '../lib/utils';
import { Card, Button } from '../components/ui';

const NOTE_TYPES = [
  { value: '', label: 'All Types', icon: Layers },
  { value: 'NOTE', label: 'Note', icon: StickyNote },
  { value: 'MEETING_NOTES', label: 'Meeting Notes', icon: Users },
  { value: 'WIKI', label: 'Wiki', icon: BookOpen },
  { value: 'DOC', label: 'Document', icon: FileText },
];

const TYPE_COLORS = {
  NOTE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  MEETING_NOTES: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  WIKI: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  DOC: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function Docs() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showNewNote, setShowNewNote] = useState(searchParams.get('create') === 'true');
  const [newNoteProjectId, setNewNoteProjectId] = useState('');
  const [newForm, setNewForm] = useState({ title: '', content: '', type: 'NOTE', tags: '' });

  useEffect(() => {
    if (searchParams.get('create') === 'true') setShowNewNote(true);
  }, [searchParams]);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['all-notes', search, filterType],
    queryFn: () => api.getAllNotes({
      ...(search && { search }),
      ...(filterType && { type: filterType }),
    }),
    staleTime: 30000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
    enabled: showNewNote,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateNote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-notes'] });
      setEditingId(null);
      toast.success('Note updated');
    },
    onError: () => toast.error('Failed to update note'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-notes'] });
      toast.success('Note deleted');
    },
    onError: () => toast.error('Failed to delete note'),
  });

  const pinMutation = useMutation({
    mutationFn: (id) => api.pinNote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-notes'] }),
  });

  const createMutation = useMutation({
    mutationFn: ({ projectId, data }) => api.createNote(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-notes'] });
      setShowNewNote(false);
      setNewForm({ title: '', content: '', type: 'NOTE', tags: '' });
      setNewNoteProjectId('');
      toast.success('Note created');
    },
    onError: () => toast.error('Failed to create note'),
  });

  const startEdit = (note) => {
    setEditingId(note.id);
    setEditForm({ title: note.title, content: note.content, type: note.type, tags: (note.tags || []).join(', ') });
    setExpandedId(note.id);
  };

  const handleUpdate = (e) => {
    e.preventDefault();
    updateMutation.mutate({
      id: editingId,
      data: {
        title: editForm.title,
        content: editForm.content,
        type: editForm.type,
        tags: editForm.tags ? editForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      },
    });
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newNoteProjectId) return toast.error('Select a project');
    createMutation.mutate({
      projectId: newNoteProjectId,
      data: {
        title: newForm.title,
        content: newForm.content,
        type: newForm.type,
        tags: newForm.tags ? newForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      },
    });
  };

  // Group notes by project
  const grouped = notes.reduce((acc, note) => {
    const key = note.project?.id || 'ungrouped';
    if (!acc[key]) acc[key] = { project: note.project, notes: [] };
    acc[key].notes.push(note);
    return acc;
  }, {});

  const pinnedNotes = notes.filter(n => n.isPinned);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Docs & Notes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Meeting notes, wikis, and documents across all projects
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowNewNote(true)}>
          New Note
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {NOTE_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilterType(value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                filterType === value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* New Note Form */}
      {showNewNote && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">New Note</h2>
            <button onClick={() => setShowNewNote(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Project</label>
              <select
                value={newNoteProjectId}
                onChange={(e) => setNewNoteProjectId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                required
              >
                <option value="">Select project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — {p.client?.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <input
                value={newForm.title}
                onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                placeholder="Note title..."
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                required
              />
              <select
                value={newForm.type}
                onChange={(e) => setNewForm({ ...newForm, type: e.target.value })}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                {NOTE_TYPES.filter(t => t.value).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={newForm.content}
              onChange={(e) => setNewForm({ ...newForm, content: e.target.value })}
              placeholder="Content... (supports Markdown)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
              rows={6}
            />
            <div className="flex items-center gap-3">
              <input
                value={newForm.tags}
                onChange={(e) => setNewForm({ ...newForm, tags: e.target.value })}
                placeholder="Tags (comma separated)"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
              <Button type="submit" loading={createMutation.isPending} leftIcon={<Save className="w-4 h-4" />}>
                Save
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : notes.length === 0 ? (
        <Card className="p-16 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">
            {search ? 'No notes match your search' : 'No notes yet'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? 'Try a different search term' : 'Create notes from any project page, or use the button above.'}
          </p>
        </Card>
      ) : (
        <>
          {/* Pinned Notes */}
          {pinnedNotes.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Pin className="w-3.5 h-3.5" /> Pinned
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pinnedNotes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    expanded={expandedId === note.id}
                    editing={editingId === note.id}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    onToggle={() => setExpandedId(expandedId === note.id ? null : note.id)}
                    onEdit={() => startEdit(note)}
                    onUpdate={handleUpdate}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => { if (confirm('Delete this note?')) deleteMutation.mutate(note.id); }}
                    onPin={() => pinMutation.mutate(note.id)}
                    updatePending={updateMutation.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Notes grouped by project */}
          <div className="space-y-6">
            {Object.values(grouped).map(({ project, notes: groupNotes }) => (
              <ProjectGroup
                key={project?.id || 'ungrouped'}
                project={project}
                notes={groupNotes}
                expandedId={expandedId}
                editingId={editingId}
                editForm={editForm}
                setEditForm={setEditForm}
                onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                onEdit={startEdit}
                onUpdate={handleUpdate}
                onCancelEdit={() => setEditingId(null)}
                onDelete={(id) => { if (confirm('Delete this note?')) deleteMutation.mutate(id); }}
                onPin={(id) => pinMutation.mutate(id)}
                updatePending={updateMutation.isPending}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectGroup({ project, notes, ...noteProps }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        <FolderOpen className="w-4 h-4 text-muted-foreground" />
        <span>{project?.name || 'Unlinked'}</span>
        {project?.client && (
          <span className="text-muted-foreground">— {project.client.name}</span>
        )}
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{notes.length}</span>
        {project && (
          <Link
            to={`/project/${project.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline ml-1"
          >
            Open project →
          </Link>
        )}
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pl-6">
          {notes.map(note => (
            <NoteCard key={note.id} note={note} {...noteProps} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note, expanded, editing, editForm, setEditForm,
  onToggle, onEdit, onUpdate, onCancelEdit, onDelete, onPin, updatePending
}) {
  return (
    <Card className={cn('p-4 transition-shadow', expanded && 'shadow-md')}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <button
          onClick={onToggle}
          className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left flex-1"
        >
          {note.isPinned && <Pin className="w-3 h-3 text-primary inline mr-1" />}
          {note.title}
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={onPin} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors" title={note.isPinned ? 'Unpin' : 'Pin'}>
            {note.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onEdit} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', TYPE_COLORS[note.type])}>
          {NOTE_TYPES.find(t => t.value === note.type)?.label || note.type}
        </span>
        {note.tags?.map(tag => (
          <span key={tag} className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {note.author?.name} · {new Date(note.updatedAt).toLocaleDateString()}
      </p>

      {expanded && (
        editing ? (
          <form onSubmit={onUpdate} className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                required
              />
              <select
                value={editForm.type}
                onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                className="px-2 py-1.5 rounded border border-border bg-background text-sm"
              >
                {NOTE_TYPES.filter(t => t.value).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm font-mono"
              rows={6}
            />
            <div className="flex items-center gap-2">
              <input
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                placeholder="Tags"
                className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
              />
              <button type="submit" disabled={updatePending} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90">
                {updatePending ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={onCancelEdit} className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted rounded">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          note.content ? (
            <pre className="mt-3 text-sm text-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed border border-border/50 max-h-64 overflow-y-auto">
              {note.content}
            </pre>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground italic">No content. Click edit to add.</p>
          )
        )
      )}
    </Card>
  );
}
