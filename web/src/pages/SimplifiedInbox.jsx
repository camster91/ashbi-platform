import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Inbox as InboxIcon,
  CheckCircle,
  Clock,
  User,
  FolderOpen,
  MessageSquare,
  Filter,
  MoreHorizontal,
  Sparkles,
  Loader2,
  AlertCircle,
  Flame,
  ChevronRight,
  Plus,
  Calendar,
  Tag,
  Archive,
  Reply,
  Timer,
  FileText,
  Eye,
  EyeOff,
  Grid,
  List,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatRelativeTime,
  truncate,
  getPriorityColor,
  getStatusColor,
  getSentimentIcon,
  cn,
} from '../lib/utils';
import { Button, Badge, Card, EmptyState } from '../components/ui';

export default function SimplifiedInbox() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState('priority'); // 'priority', 'all', 'unread'
  const [showCompleted, setShowCompleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedThreads, setExpandedThreads] = useState({});
  const [selectedThreads, setSelectedThreads] = useState([]);

  const { data: inboxData, isLoading } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.getInbox(),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ['inbox-stats'],
    queryFn: api.getInboxStats,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (threadId) => api.updateThread(threadId, { read: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-stats'] });
    },
  });

  const resolveThreadMutation = useMutation({
    mutationFn: (threadId) => api.resolveThread(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-stats'] });
    },
  });

  const assignThreadMutation = useMutation({
    mutationFn: ({ threadId, assigneeId }) => api.assignThread(threadId, { assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-10 w-48 bg-muted rounded" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="h-32 bg-muted rounded-xl" />
              <div className="h-32 bg-muted rounded-xl" />
              <div className="h-32 bg-muted rounded-xl" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-20 bg-muted rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const threads = inboxData?.threads || [];
  
  // Sort threads by priority: CRITICAL → HIGH → NORMAL → LOW
  const priorityOrder = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  const sortedThreads = [...threads].sort((a, b) => {
    const priorityA = priorityOrder[a.priority] || 3;
    const priorityB = priorityOrder[b.priority] || 3;
    if (priorityA !== priorityB) return priorityA - priorityB;
    
    // Then by recency (newest first)
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Filter threads based on view mode
  let filteredThreads = sortedThreads;
  if (viewMode === 'unread') {
    filteredThreads = sortedThreads.filter(t => !t.read);
  }
  
  if (!showCompleted) {
    filteredThreads = filteredThreads.filter(t => t.status !== 'RESOLVED');
  }
  
  if (searchQuery) {
    filteredThreads = filteredThreads.filter(t => 
      t.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.from?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.body?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  // Group by priority for visual organization
  const criticalThreads = filteredThreads.filter(t => t.priority === 'CRITICAL');
  const highThreads = filteredThreads.filter(t => t.priority === 'HIGH');
  const normalThreads = filteredThreads.filter(t => t.priority === 'NORMAL');
  const lowThreads = filteredThreads.filter(t => t.priority === 'LOW');

  const toggleThreadExpansion = (threadId) => {
    setExpandedThreads(prev => ({
      ...prev,
      [threadId]: !prev[threadId]
    }));
  };

  const toggleThreadSelection = (threadId) => {
    setSelectedThreads(prev => 
      prev.includes(threadId)
        ? prev.filter(id => id !== threadId)
        : [...prev, threadId]
    );
  };

  const handleQuickAction = (threadId, action) => {
    switch (action) {
      case 'read':
        markAsReadMutation.mutate(threadId);
        break;
      case 'resolve':
        resolveThreadMutation.mutate(threadId);
        break;
      case 'reply':
        navigate(`/thread/${threadId}`);
        break;
      case 'assign':
        // In a real implementation, this would open an assign modal
        console.log('Assign thread', threadId);
        break;
      case 'snooze':
        // In a real implementation, this would open a snooze modal
        console.log('Snooze thread', threadId);
        break;
    }
  };

  const renderPrioritySection = (title, threads, colorClass, icon) => {
    if (threads.length === 0) return null;

    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div className={`p-1.5 rounded-lg ${colorClass}`}>
            {icon}
          </div>
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <Badge variant="outline" className="ml-2">{threads.length}</Badge>
        </div>
        <div className="space-y-2">
          {threads.map(thread => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              isExpanded={expandedThreads[thread.id]}
              isSelected={selectedThreads.includes(thread.id)}
              onToggleExpand={() => toggleThreadExpansion(thread.id)}
              onToggleSelect={() => toggleThreadSelection(thread.id)}
              onQuickAction={handleQuickAction}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">Inbox</h1>
              <p className="text-muted-foreground mt-1">Focus on what matters most</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={() => navigate('/projects?create=true')}
              >
                New Task
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Sparkles className="w-4 h-4" />}
                onClick={() => navigate('/ai-chat')}
              >
                AI Assist
              </Button>
            </div>
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold text-foreground">{threads.length}</p>
                </div>
                <InboxIcon className="w-8 h-8 text-primary" />
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Needs Response</p>
                  <p className="text-2xl font-bold text-foreground">{stats?.needsResponse || 0}</p>
                </div>
                <MessageSquare className="w-8 h-8 text-amber-500" />
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Critical</p>
                  <p className="text-2xl font-bold text-foreground">{criticalThreads.length}</p>
                </div>
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
            </Card>
          </div>

          {/* Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 p-4 bg-card rounded-xl border border-border">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search threads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 text-sm bg-background border border-border rounded-lg w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <Button
                  variant={viewMode === 'priority' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('priority')}
                >
                  Priority
                </Button>
                <Button
                  variant={viewMode === 'all' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('all')}
                >
                  All
                </Button>
                <Button
                  variant={viewMode === 'unread' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('unread')}
                >
                  Unread
                </Button>
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                leftIcon={showCompleted ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                onClick={() => setShowCompleted(!showCompleted)}
              >
                {showCompleted ? 'Hide Completed' : 'Show Completed'}
              </Button>
            </div>
          </div>
        </div>

        {/* Threads List */}
        <div className="space-y-8">
          {filteredThreads.length === 0 ? (
            <EmptyState
              icon={<InboxIcon className="w-12 h-12 text-muted-foreground" />}
              title="All caught up!"
              description="No threads need your attention right now."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewMode('all');
                    setShowCompleted(true);
                    setSearchQuery('');
                  }}
                >
                  View all threads
                </Button>
              }
            />
          ) : (
            <>
              {renderPrioritySection(
                'Critical',
                criticalThreads,
                'bg-red-100 dark:bg-red-900/30',
                <Flame className="w-5 h-5 text-red-600" />
              )}
              
              {renderPrioritySection(
                'High Priority',
                highThreads,
                'bg-orange-100 dark:bg-orange-900/30',
                <AlertCircle className="w-5 h-5 text-orange-600" />
              )}
              
              {renderPrioritySection(
                'Normal',
                normalThreads,
                'bg-blue-100 dark:bg-blue-900/30',
                <MessageSquare className="w-5 h-5 text-blue-600" />
              )}
              
              {renderPrioritySection(
                'Low Priority',
                lowThreads,
                'bg-green-100 dark:bg-green-900/30',
                <Clock className="w-5 h-5 text-green-600" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadCard({ thread, isExpanded, isSelected, onToggleExpand, onToggleSelect, onQuickAction }) {
  const priorityConfig = {
    CRITICAL: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', label: 'Critical' },
    HIGH: { color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30', label: 'High' },
    NORMAL: { color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30', label: 'Normal' },
    LOW: { color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', label: 'Low' },
  };

  const priority = priorityConfig[thread.priority] || priorityConfig.NORMAL;
  const isCritical = thread.priority === 'CRITICAL';
  const isUnread = !thread.read;

  return (
    <div className={cn(
      'bg-card rounded-xl border border-border overflow-hidden transition-all duration-200',
      isCritical && 'border-l-4 border-l-red-500',
      isUnread && 'ring-1 ring-primary/20',
      isSelected && 'ring-2 ring-primary'
    )}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center mt-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {isUnread && (
                <div className="w-2 h-2 rounded-full bg-primary" />
              )}
              <Badge variant="outline" className={cn('px-2 py-0.5 text-xs font-medium', priority.bg, priority.color)}>
                {priority.label}
              </Badge>
              {thread.project && (
                <Badge variant="outline" className="px-2 py-0.5 text-xs">
                  <FolderOpen className="w-3 h-3 mr-1" />
                  {thread.project.name}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {formatRelativeTime(thread.createdAt)}
              </span>
            </div>
            
            <div className="flex items-center gap-3 mb-2">
              <h3 className={cn(
                'font-medium text-foreground flex-1 truncate',
                isUnread && 'font-semibold'
              )}>
                {thread.subject || 'No subject'}
              </h3>
              <button
                onClick={onToggleExpand}
                className="p-1 hover:bg-muted rounded"
              >
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
              <div className="flex items-center gap-1">
                <User className="w-3 h-3" />
                <span className="truncate">{thread.from || 'Unknown sender'}</span>
              </div>
              {thread.assignee && (
                <div className="flex items-center gap-1">
                  <span className="text-xs">Assigned to</span>
                  <span className="font-medium">{thread.assignee.name}</span>
                </div>
              )}
            </div>
            
            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-sm text-muted-foreground mb-4">
                  {truncate(thread.body || 'No content', 200)}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Reply className="w-3 h-3" />}
                    onClick={() => onQuickAction(thread.id, 'reply')}
                  >
                    Reply
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<CheckCircle className="w-3 h-3" />}
                    onClick={() => onQuickAction(thread.id, 'resolve')}
                  >
                    Complete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<User className="w-3 h-3" />}
                    onClick={() => onQuickAction(thread.id, 'assign')}
                  >
                    Assign
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Timer className="w-3 h-3" />}
                    onClick={() => onQuickAction(thread.id, 'snooze')}
                  >
                    Snooze
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<FileText className="w-3 h-3" />}
                    onClick={() => onQuickAction(thread.id, 'read')}
                  >
                    {thread.read ? 'Mark Unread' : 'Mark Read'}
                  </Button>
                </div>
              </div>
            )}
            
            {!isExpanded && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => onQuickAction(thread.id, 'reply')}
                  className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                  title="Reply"
                >
                  <Reply className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onQuickAction(thread.id, 'resolve')}
                  className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                  title="Complete"
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onQuickAction(thread.id, 'assign')}
                  className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                  title="Assign"
                >
                  <User className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onQuickAction(thread.id, 'snooze')}
                  className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                  title="Snooze"
                >
                  <Timer className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onQuickAction(thread.id, 'read')}
                  className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                  title={thread.read ? 'Mark Unread' : 'Mark Read'}
                >
                  <FileText className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}