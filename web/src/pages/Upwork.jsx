import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Send,
  MessageSquare,
  Users,
  FileText,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Star,
  UserCheck,
  UserX,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';
import { cn, formatRelativeTime, truncate, getPriorityColor } from '../lib/utils';

const priorityConfig = {
  CRITICAL: { label: 'Critical', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  HIGH: { label: 'High', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  NORMAL: { label: 'Normal', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  LOW: { label: 'Low', color: 'bg-muted text-muted-foreground' },
};

const statusColors = {
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

function parseTags(task) {
  try {
    return JSON.parse(task.tags || '[]');
  } catch {
    return [];
  }
}

function parseProps(task) {
  try {
    return JSON.parse(task.properties || '{}');
  } catch {
    return {};
  }
}

function TaskStatusSelect({ task }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, status }) => api.updateUpworkTask(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upwork'] }),
  });

  return (
    <select
      value={task.status}
      onChange={(e) => mutation.mutate({ id: task.id, status: e.target.value })}
      className={cn(
        'text-xs font-medium px-2 py-1 rounded-lg border-0 cursor-pointer',
        statusColors[task.status] || statusColors.PENDING
      )}
      disabled={mutation.isPending}
    >
      <option value="PENDING">Pending</option>
      <option value="IN_PROGRESS">In Progress</option>
      <option value="COMPLETED">Completed</option>
    </select>
  );
}

function TaskRow({ task, expandable = false }) {
  const [expanded, setExpanded] = useState(false);
  const props = parseProps(task);
  const priorityCfg = priorityConfig[task.priority] || priorityConfig.NORMAL;

  return (
    <Card className="p-3 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        {expandable && (
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            {props.score && (
              <span className="flex items-center gap-0.5">
                <Star className="w-3 h-3" /> {props.score}/10
              </span>
            )}
            {props.sender && <span>{props.sender}</span>}
            {props.rate && <span>{props.rate}</span>}
            {props.applicantCount && <span>{props.applicantCount} applicants</span>}
            {props.freelancer && <span>{props.freelancer}</span>}
            {props.hours && <span>{props.hours} hrs</span>}
            <span className="flex items-center gap-0.5">
              <Clock className="w-3 h-3" /> {formatRelativeTime(task.createdAt)}
            </span>
          </div>
        </div>
        <span className={cn('inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full', priorityCfg.color)}>
          {priorityCfg.label}
        </span>
        <TaskStatusSelect task={task} />
        {props.url && (
          <a
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-muted-foreground hover:text-foreground rounded"
            title="Open on Upwork"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        {props.roomUrl && (
          <a
            href={props.roomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-muted-foreground hover:text-foreground rounded"
            title="Open conversation"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
      {expanded && task.description && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
        </div>
      )}
    </Card>
  );
}

function ApplicantRow({ task }) {
  const queryClient = useQueryClient();
  const props = parseProps(task);

  const updateMutation = useMutation({
    mutationFn: ({ id, status }) => api.updateUpworkTask(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upwork'] }),
  });

  return (
    <Card className="p-3 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            {props.rate && <span>{props.rate}</span>}
            <span className="flex items-center gap-0.5">
              <Clock className="w-3 h-3" /> {formatRelativeTime(task.createdAt)}
            </span>
          </div>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-1">{truncate(task.description, 200)}</p>
          )}
        </div>
        <TaskStatusSelect task={task} />
        <Button
          variant="outline"
          size="xs"
          leftIcon={<UserCheck className="w-3 h-3" />}
          onClick={() => updateMutation.mutate({ id: task.id, status: 'IN_PROGRESS' })}
          disabled={task.status === 'IN_PROGRESS'}
        >
          Shortlist
        </Button>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<UserX className="w-3 h-3" />}
          onClick={() => updateMutation.mutate({ id: task.id, status: 'COMPLETED' })}
          disabled={task.status === 'COMPLETED'}
        >
          Pass
        </Button>
      </div>
    </Card>
  );
}

function TaskList({ tasks, emptyMessage, emptyIcon: EmptyIcon, expandable = false, renderItem }) {
  if (!tasks || tasks.length === 0) {
    return (
      <Card className="p-8 text-center">
        <EmptyIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {tasks.map((task) => renderItem ? renderItem(task) : <TaskRow key={task.id} task={task} expandable={expandable} />)}
    </div>
  );
}

export default function Upwork() {
  const [mode, setMode] = useState('freelance');
  const [subTab, setSubTab] = useState('leads');

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['upwork', 'leads'],
    queryFn: () => api.getUpworkTasks('upwork,lead'),
  });

  const { data: proposalsData, isLoading: proposalsLoading } = useQuery({
    queryKey: ['upwork', 'proposals'],
    queryFn: () => api.getUpworkTasks('upwork,proposal'),
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['upwork', 'messages'],
    queryFn: () => api.getUpworkTasks('upwork,message'),
  });

  const { data: hiringData, isLoading: hiringLoading } = useQuery({
    queryKey: ['upwork', 'hiring'],
    queryFn: () => api.getUpworkTasks('upwork,hiring'),
  });

  const { data: applicantsData, isLoading: applicantsLoading } = useQuery({
    queryKey: ['upwork', 'applicants'],
    queryFn: () => api.getUpworkTasks('upwork,applicant'),
  });

  const { data: contractsData, isLoading: contractsLoading } = useQuery({
    queryKey: ['upwork', 'contracts'],
    queryFn: () => api.getUpworkTasks('upwork,contract'),
  });

  const queryClient = useQueryClient();
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['upwork'] });
  };

  const leads = leadsData?.tasks || [];
  const proposals = proposalsData?.tasks || [];
  const messages = messagesData?.tasks || [];
  const hiringJobs = hiringData?.tasks || [];
  const applicants = applicantsData?.tasks || [];
  const contracts = contractsData?.tasks || [];

  const freelanceTabs = [
    { key: 'leads', label: 'Leads', icon: Briefcase, count: leads.length },
    { key: 'proposals', label: 'Proposals', icon: Send, count: proposals.length },
    { key: 'messages', label: 'Messages', icon: MessageSquare, count: messages.length },
  ];

  const hiringTabs = [
    { key: 'jobposts', label: 'Job Posts', icon: FileText, count: hiringJobs.length },
    { key: 'applicants', label: 'Applicants', icon: Users, count: applicants.length },
    { key: 'contracts', label: 'Active Contracts', icon: Briefcase, count: contracts.length },
  ];

  const isLoading = leadsLoading || proposalsLoading || messagesLoading || hiringLoading || applicantsLoading || contractsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Upwork</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage freelance leads, proposals, hiring, and messages
          </p>
        </div>
        <Button
          variant="outline"
          leftIcon={<RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />}
          onClick={handleRefresh}
          disabled={isLoading}
        >
          Refresh
        </Button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        {[
          { key: 'freelance', label: 'Freelance (We Sell)' },
          { key: 'hiring', label: 'Hiring (We Buy)' },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setMode(m.key);
              setSubTab(m.key === 'freelance' ? 'leads' : 'jobposts');
            }}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              mode === m.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {(mode === 'freelance' ? freelanceTabs : hiringTabs).map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
              subTab === t.key
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Freelance tabs */}
          {mode === 'freelance' && subTab === 'leads' && (
            <TaskList tasks={leads} emptyMessage="No leads yet. Run the Upwork agent to sync job listings." emptyIcon={Briefcase} expandable />
          )}
          {mode === 'freelance' && subTab === 'proposals' && (
            <TaskList tasks={proposals} emptyMessage="No proposals synced yet." emptyIcon={Send} />
          )}
          {mode === 'freelance' && subTab === 'messages' && (
            <TaskList tasks={messages} emptyMessage="No unread messages." emptyIcon={MessageSquare} />
          )}

          {/* Hiring tabs */}
          {mode === 'hiring' && subTab === 'jobposts' && (
            <TaskList tasks={hiringJobs} emptyMessage="No job posts synced." emptyIcon={FileText} />
          )}
          {mode === 'hiring' && subTab === 'applicants' && (
            <TaskList
              tasks={applicants}
              emptyMessage="No applicants to review."
              emptyIcon={Users}
              renderItem={(task) => <ApplicantRow key={task.id} task={task} />}
            />
          )}
          {mode === 'hiring' && subTab === 'contracts' && (
            <TaskList tasks={contracts} emptyMessage="No active contracts." emptyIcon={Briefcase} />
          )}
        </>
      )}
    </div>
  );
}
