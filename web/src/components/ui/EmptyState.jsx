import { cn } from '../../lib/utils';
import Button from './Button';
import { Inbox, FolderOpen, Search, Mail, FileText, Users, Bell, CheckCircle } from 'lucide-react';

const icons = {
  inbox: Inbox,
  projects: FolderOpen,
  search: Search,
  mail: Mail,
  document: FileText,
  team: Users,
  notifications: Bell,
  success: CheckCircle,
};

export default function EmptyState({
  icon: iconName = 'inbox',
  title = 'No items found',
  description = 'There are no items to display at the moment.',
  actionLabel,
  actionHref,
  onAction,
  secondaryAction,
  className,
}) {
  const Icon = icons[iconName] || Inbox;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'py-12 px-4',
        className
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      
      <h3 className="font-heading font-semibold text-lg text-foreground mb-1">
        {title}
      </h3>
      
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        {description}
      </p>
      
      {(actionLabel || onAction) && (
        <div className="flex items-center gap-3">
          {actionLabel && (
            <Button
              onClick={onAction}
              leftIcon={iconName === 'inbox' ? <Mail className="w-4 h-4" /> : undefined}
            >
              {actionLabel}
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

// Pre-configured empty states
export function EmptyInbox({ onBrowseProjects }) {
  return (
    <EmptyState
      icon="inbox"
      title="All caught up!"
      description="No threads need your attention right now. Check back later or browse your projects."
      actionLabel="Browse Projects"
      onAction={onBrowseProjects}
    />
  );
}

export function EmptyProjects({ onCreateProject }) {
  return (
    <EmptyState
      icon="projects"
      title="No projects yet"
      description="Create your first project to start managing client work and tracking requests."
      actionLabel="Create Project"
      onAction={onCreateProject}
    />
  );
}

export function EmptySearch({ query, onClear }) {
  return (
    <EmptyState
      icon="search"
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try adjusting your search terms or filters.`}
      actionLabel="Clear Search"
      onAction={onClear}
    />
  );
}

export function EmptyNotifications() {
  return (
    <EmptyState
      icon="notifications"
      title="No notifications"
      description="You're all caught up! We'll notify you when something important happens."
    />
  );
}

export function EmptyTeam({ onInvite }) {
  return (
    <EmptyState
      icon="team"
      title="No team members"
      description="Invite your team to collaborate on projects and handle client requests."
      actionLabel="Invite Team Member"
      onAction={onInvite}
    />
  );
}
