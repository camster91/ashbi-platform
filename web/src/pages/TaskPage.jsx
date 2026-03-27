import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  MoreHorizontal,
  Plus,
  Calendar,
  User,
  Flag,
  CheckCircle2,
  Clock,
  FolderOpen,
  ChevronRight,
  Image as ImageIcon,
  Smile,
  MessageSquare,
  Paperclip,
  History,
  Share2,
  Star,
  Copy,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, cn } from '../lib/utils';
import NotionEditor from '../components/NotionEditor';
import { Button, Badge, Card, EmptyState } from '../components/ui';

// Breadcrumbs component
function Breadcrumbs({ taskId }) {
  const { data: breadcrumbs } = useQuery({
    queryKey: ['task-breadcrumbs', taskId],
    queryFn: () => api.getTaskBreadcrumbs(taskId),
    enabled: !!taskId
  });

  if (!breadcrumbs || breadcrumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {breadcrumbs.map((item, index) => (
        <div key={item.id} className="flex items-center">
          {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
          <Link
            to={item.isProject ? `/project/${item.id}` : `/task/${item.id}`}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <span>{item.icon || (item.isProject ? '📁' : '📄')}</span>
            <span className="truncate max-w-[150px]">{item.title}</span>
          </Link>
        </div>
      ))}
    </nav>
  );
}

// Page header with icon and cover
function PageHeader({ task, onUpdate, isEditing }) {
  const [icon, setIcon] = useState(task?.icon || '📄');
  const [title, setTitle] = useState(task?.title || '');
  const [showIconPicker, setShowIconPicker] = useState(false);

  const emojis = ['📄', '✅', '📝', '🎯', '🚀', '💡', '🔥', '⭐', '📊', '🎨', '💻', '📱', '🐛', '🔧', '📅'];

  useEffect(() => {
    setIcon(task?.icon || '📄');
    setTitle(task?.title || '');
  }, [task]);

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
  };

  const handleTitleBlur = () => {
    if (title !== task?.title) {
      onUpdate({ title });
    }
  };

  const handleIconSelect = (newIcon) => {
    setIcon(newIcon);
    onUpdate({ icon: newIcon });
    setShowIconPicker(false);
  };

  return (
    <div className="mb-8">
      {/* Cover image */}
      {task?.coverImage ? (
        <div className="relative h-48 -mx-6 -mt-6 mb-6 rounded-t-xl overflow-hidden">
          <img 
            src={task.coverImage} 
            alt="Cover" 
            className="w-full h-full object-cover"
          />
          <button 
            onClick={() => onUpdate({ coverImage: null })}
            className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex justify-end mb-4">
          <button 
            onClick={() => onUpdate({ coverImage: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1200&h=300&fit=crop' })}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <ImageIcon className="w-4 h-4" />
            Add cover
          </button>
        </div>
      )}

      {/* Icon picker */}
      <div className="relative mb-4">
        <button
          onClick={() => setShowIconPicker(!showIconPicker)}
          className="text-5xl hover:scale-110 transition-transform"
        >
          {icon}
        </button>
        
        {showIconPicker && (
          <div className="absolute top-full left-0 mt-2 p-3 bg-card border border-border rounded-xl shadow-xl grid grid-cols-5 gap-2 z-50 animate-scale-in">
            {emojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleIconSelect(emoji)}
                className={cn(
                  'text-2xl p-2 rounded-lg hover:bg-muted transition-colors',
                  icon === emoji && 'bg-primary/10'
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={handleTitleChange}
        onBlur={handleTitleBlur}
        onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
        className="w-full text-4xl font-heading font-bold bg-transparent border-0 outline-none placeholder:text-muted-foreground"
        placeholder="Untitled"
      />
    </div>
  );
}

// Properties panel
function PropertiesPanel({ task, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);

  const properties = [
    { 
      key: 'status', 
      label: 'Status', 
      icon: CheckCircle2,
      value: task?.status,
      options: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']
    },
    { 
      key: 'assignee', 
      label: 'Assignee', 
      icon: User,
      value: task?.assignee?.name || 'Unassigned'
    },
    { 
      key: 'priority', 
      label: 'Priority', 
      icon: Flag,
      value: task?.priority,
      options: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW']
    },
    { 
      key: 'dueDate', 
      label: 'Due date', 
      icon: Calendar,
      value: task?.dueDate ? formatDate(task.dueDate) : 'No date'
    },
    { 
      key: 'project', 
      label: 'Project', 
      icon: FolderOpen,
      value: task?.project?.name
    },
  ];

  const getStatusColor = (status) => {
    const colors = {
      'PENDING': 'bg-yellow-100 text-yellow-800',
      'IN_PROGRESS': 'bg-blue-100 text-blue-800',
      'COMPLETED': 'bg-green-100 text-green-800',
      'BLOCKED': 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'CRITICAL': 'text-red-600',
      'HIGH': 'text-orange-600',
      'NORMAL': 'text-blue-600',
      'LOW': 'text-green-600',
    };
    return colors[priority] || 'text-gray-600';
  };

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Properties
        </span>
        <button 
          onClick={() => setIsEditing(!isEditing)}
          className="text-xs text-primary hover:underline"
        >
          {isEditing ? 'Done' : 'Edit'}
        </button>
      </div>
      
      <div className="space-y-2">
        {properties.map((prop) => (
          <div 
            key={prop.key}
            className="flex items-center gap-4 py-1.5 border-b border-border/50 last:border-0"
          >
            <div className="flex items-center gap-2 w-32 text-sm text-muted-foreground">
              <prop.icon className="w-4 h-4" />
              {prop.label}
            </div>
            <div className="flex-1">
              {prop.key === 'status' && (
                <Badge className={getStatusColor(prop.value)}>
                  {prop.value?.replace(/_/g, ' ')}
                </Badge>
              )}
              {prop.key === 'priority' && (
                <span className={cn('text-sm font-medium', getPriorityColor(prop.value))}>
                  {prop.value}
                </span>
              )}
              {prop.key === 'assignee' && (
                <div className="flex items-center gap-2">
                  {task?.assignee ? (
                    <>
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                        {task.assignee.name.charAt(0)}
                      </div>
                      <span className="text-sm">{task.assignee.name}</span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unassigned</span>
                  )}
                </div>
              )}
              {prop.key === 'dueDate' && (
                <span className="text-sm">{prop.value}</span>
              )}
              {prop.key === 'project' && (
                <Link 
                  to={`/project/${task?.project?.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  {prop.value}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Subpages list
function SubpagesList({ subpages, taskId, onCreateSubpage }) {
  const navigate = useNavigate();

  if (!subpages || subpages.length === 0) {
    return (
      <div className="mt-8 pt-8 border-t border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-foreground">Subpages</h3>
          <Button size="sm" onClick={onCreateSubpage} leftIcon={<Plus className="w-4 h-4" />}>
            Add subpage
          </Button>
        </div>
        <EmptyState
          icon="document"
          title="No subpages"
          description="Create subpages to break down this task into smaller pieces"
          actionLabel="Create subpage"
          onAction={onCreateSubpage}
        />
      </div>
    );
  }

  return (
    <div className="mt-8 pt-8 border-t border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-semibold text-foreground">
          Subpages ({subpages.length})
        </h3>
        <Button size="sm" variant="outline" onClick={onCreateSubpage} leftIcon={<Plus className="w-4 h-4" />}>
          Add subpage
        </Button>
      </div>
      
      <div className="grid gap-2">
        {subpages.map((subpage) => (
          <button
            key={subpage.id}
            onClick={() => navigate(`/task/${subpage.id}`)}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg',
              'bg-muted/50 hover:bg-muted transition-colors text-left'
            )}
          >
            <span className="text-xl">{subpage.icon || '📄'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground truncate">{subpage.title}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn(
                  subpage.status === 'COMPLETED' && 'text-success'
                )}>
                  {subpage.status?.replace(/_/g, ' ')}
                </span>
                {subpage.assignee && (
                  <>
                    <span>·</span>
                    <span>{subpage.assignee.name}</span>
                  </>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

// Comments section
function CommentsSection({ comments, taskId }) {
  const [newComment, setNewComment] = useState('');
  const queryClient = useQueryClient();

  const addCommentMutation = useMutation({
    mutationFn: (content) => api.addTaskComment(taskId, content),
    onSuccess: () => {
      queryClient.invalidateQueries(['task', taskId]);
      setNewComment('');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (newComment.trim()) {
      addCommentMutation.mutate(newComment);
    }
  };

  return (
    <div className="mt-8 pt-8 border-t border-border">
      <h3 className="font-heading font-semibold text-foreground mb-4 flex items-center gap-2">
        <MessageSquare className="w-5 h-5" />
        Comments ({comments?.length || 0})
      </h3>

      {/* Comment form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment... Use @ to mention someone"
          className="w-full p-3 bg-muted border-0 rounded-lg resize-none focus:ring-2 focus:ring-primary/20"
          rows={3}
        />
        <div className="flex justify-end mt-2">
          <Button 
            type="submit" 
            size="sm"
            isLoading={addCommentMutation.isPending}
            disabled={!newComment.trim()}
          >
            Comment
          </Button>
        </div>
      </form>

      {/* Comments list */}
      <div className="space-y-4">
        {comments?.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0">
              {comment.author.name.charAt(0)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">{comment.author.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(comment.createdAt)}
                </span>
              </div>
              <p className="text-sm text-foreground">{comment.content}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Main TaskPage component
export default function TaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [content, setContent] = useState([]);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.getTaskPage(id),
    enabled: !!id
  });

  useEffect(() => {
    if (task?.content) {
      setContent(task.content);
    }
  }, [task]);

  const updateMutation = useMutation({
    mutationFn: (updates) => api.updateTaskContent(id, { 
      ...updates, 
      content: updates.content || content 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['task', id]);
    }
  });

  const createSubpageMutation = useMutation({
    mutationFn: (data) => api.createSubpage(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['task', id]);
    }
  });

  const handleUpdate = (updates) => {
    updateMutation.mutate(updates);
  };

  const handleContentChange = (newContent) => {
    setContent(newContent);
    // Debounce save
    updateMutation.mutate({ content: newContent });
  };

  const handleCreateSubpage = () => {
    const title = prompt('Subpage title:');
    if (title) {
      createSubpageMutation.mutate({ title, icon: '📄' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!task) {
    return (
      <EmptyState
        icon="document"
        title="Task not found"
        description="The task you're looking for doesn't exist or you don't have access."
        actionLabel="Back to Tasks"
        onAction={() => navigate('/projects')}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Breadcrumbs */}
      <Breadcrumbs taskId={id} />

      {/* Page header */}
      <PageHeader task={task} onUpdate={handleUpdate} />

      {/* Properties */}
      <PropertiesPanel task={task} onUpdate={handleUpdate} />

      {/* Content editor */}
      <div className="min-h-[300px]">
        <NotionEditor
          initialContent={content}
          onChange={handleContentChange}
          projectId={task.project?.id}
        />
      </div>

      {/* Subpages */}
      <SubpagesList 
        subpages={task.subpages} 
        taskId={id}
        onCreateSubpage={handleCreateSubpage}
      />

      {/* Comments */}
      <CommentsSection comments={task.comments} taskId={id} />
    </div>
  );
}
