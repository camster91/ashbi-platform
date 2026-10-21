import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Button, EmptyState, KanbanPageSkeleton } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import CreateProjectModal from '../components/CreateProjectModal';
import ProjectBoard from '../components/projects/ProjectBoard';
import ProjectListView from '../components/projects/ProjectListView';
import ProjectCalendarView from '../components/projects/ProjectCalendarView';
import { matchesOwner, projectSummary, teamOwners } from '../components/projects/projectBoard';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { PORTFOLIO_OPTIONS, PORTFOLIO_VALUES } from '@shared/portfolio.js';

// Ashbi Hub projects page (design: Projects mockup). Board, List and Calendar
// views of the same projects, kept in ?view= with the portfolio (?portfolio=)
// and owner (?owner=) filters, so a link or reload lands on the same view.
// ?create=true (with an optional &clientId=) opens the new project dialog.
// Nothing here shows money; the project list API leaves budgets out for
// non-admins too.

const VIEWS = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
];
const VIEW_VALUES = VIEWS.map((view) => view.value);

const toolbarSelect = 'min-h-11 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

function Chip({ children, tone }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1',
        tone === 'warning' && 'bg-warning/10 text-warning font-semibold',
        tone === 'danger' && 'bg-destructive/10 text-destructive font-semibold',
        tone === 'info' && 'bg-secondary text-secondary-foreground',
        !tone && 'border border-border/40 bg-card',
      )}
    >
      {children}
    </span>
  );
}

export default function Projects() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [portfolioError, setPortfolioError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPortfolio = searchParams.get('portfolio');
  const portfolio = [...PORTFOLIO_VALUES, 'UNCLASSIFIED'].includes(requestedPortfolio) ? requestedPortfolio : '';
  const requestedView = searchParams.get('view');
  const view = VIEW_VALUES.includes(requestedView) ? requestedView : 'board';
  const owner = (searchParams.get('owner') || '').slice(0, 80);
  const showCreateModal = searchParams.get('create') === 'true';
  const preselectedClientId = searchParams.get('clientId') || '';

  const setParam = useCallback((key, value, fallback = '') => {
    const nextParams = new URLSearchParams(searchParams);
    if (value && value !== fallback) nextParams.set(key, value); else nextParams.delete(key);
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const openCreateModal = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('create', 'true');
    nextParams.delete('clientId');
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const closeCreateModal = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('create');
    nextParams.delete('clientId');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const clearFilters = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('portfolio');
    nextParams.delete('owner');
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const { data: projects = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['projects', { portfolio }],
    queryFn: async () => {
      const all = [];
      let response;
      do {
        response = await api.getProjects({ limit: 200, offset: all.length, ...(portfolio ? { portfolio } : {}) });
        const page = response?.projects ?? [];
        all.push(...page);
        if (!page.length) break;
      } while (all.length < (response.total ?? 0));
      return all;
    },
  });

  // Names for owner avatars and the owner filter. Shares the create dialog's
  // cache; without it the page still works, just without names.
  const { data: team } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.getTeam(),
    retry: false,
  });
  const owners = useMemo(() => teamOwners(team), [team]);
  const ownerById = useMemo(() => new Map(owners.map((member) => [member.id, member])), [owners]);
  const ownerFor = useCallback((project) => ownerById.get(project.defaultOwnerId) || null, [ownerById]);

  const classify = useMutation({
    mutationFn: ({ id, value }) => api.updateProject(id, { portfolio: value }),
    onSuccess: () => {
      setPortfolioError('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
    },
    onError: (err) => setPortfolioError(err.message || 'Portfolio could not be saved. Try again.'),
  });
  const onPortfolioChange = useCallback((id, value) => classify.mutate({ id, value }), [classify]);
  const savingId = classify.isPending ? classify.variables?.id : null;

  // Show real API data only. (Previously fell back to hardcoded demo projects
  // when the response looked empty, which hid real projects.)
  const allProjects = Array.isArray(projects) ? projects : [];
  const shown = owner ? allProjects.filter((project) => matchesOwner(project, owner, user?.id)) : allProjects;
  const summary = projectSummary(shown);
  const filtered = Boolean(portfolio || owner);

  if (isLoading) {
    return <KanbanPageSkeleton label="Loading projects" />;
  }

  if (isError) {
    return (
      <QueryErrorState
        error={error}
        message="Projects could not be loaded"
        onRetry={refetch}
        isRetrying={isFetching}
      />
    );
  }

  const ownerKnown = !owner || ['me', 'none'].includes(owner) || ownerById.has(owner);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Work</p>
          <h1 className="mt-1.5 text-3xl font-heading font-semibold tracking-tight text-foreground">
            Projects <span className="font-display italic font-normal text-primary">in motion</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-border/60">
            {VIEWS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setParam('view', value, 'board')}
                className={cn(
                  'min-h-11 px-3.5 font-mono text-xs uppercase tracking-[0.1em] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  view === value ? 'bg-foreground text-background' : 'bg-transparent text-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button type="button" onClick={openCreateModal}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New project
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="project-owner" className="text-eyebrow text-muted-foreground">Owner</label>
          <select id="project-owner" value={owner} className={toolbarSelect} onChange={(event) => setParam('owner', event.target.value)}>
            <option value="">Everyone</option>
            {user?.id && <option value="me">Mine</option>}
            {owners.filter((member) => member.id !== user?.id).map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
            {!ownerKnown && <option value={owner}>Selected person</option>}
            <option value="none">No owner</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-portfolio" className="text-eyebrow text-muted-foreground">Work portfolio</label>
          <select id="project-portfolio" value={portfolio} className={toolbarSelect} onChange={(event) => setParam('portfolio', event.target.value)}>
            <option value="">All work</option>
            {PORTFOLIO_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            <option value="UNCLASSIFIED">Unclassified</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">Both portfolios are shared with the Ashbi team.</p>
      </div>

      {/* Summary */}
      <div aria-label="Project summary" role="group" className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
        <Chip><span className="figure">{summary.active}</span> active · <span className="figure">{summary.total}</span> in total</Chip>
        {summary.overdue > 0 && <Chip tone="danger"><span className="figure">{summary.overdue}</span> overdue</Chip>}
        <Chip tone={summary.dueThisWeek > 0 ? 'warning' : undefined}><span className="figure">{summary.dueThisWeek}</span> due this week</Chip>
        <Chip tone="info"><span className="figure">{summary.inReview}</span> in client review</Chip>
        <Link
          to="/project-templates"
          className="inline-flex min-h-11 items-center rounded-full px-2.5 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Project templates
        </Link>
      </div>
      {portfolioError && <p role="alert" className="text-sm text-destructive">{portfolioError}</p>}

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        preselectedClientId={preselectedClientId}
        preselectedPortfolio={portfolio === 'UNCLASSIFIED' ? '' : portfolio}
      />

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card">
          {filtered ? (
            <EmptyState
              icon="search"
              title="No projects match these filters"
              description="Try another owner or portfolio."
              actionLabel="Show all projects"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              icon="projects"
              title="No projects yet"
              description="Use New project to set up the first one, or start from a project template."
            />
          )}
        </div>
      ) : view === 'list' ? (
        <ProjectListView projects={shown} ownerFor={ownerFor} savingId={savingId} onPortfolioChange={onPortfolioChange} />
      ) : view === 'calendar' ? (
        <ProjectCalendarView projects={shown} />
      ) : (
        <ProjectBoard projects={shown} ownerFor={ownerFor} isAdmin={isAdmin} savingId={savingId} onPortfolioChange={onPortfolioChange} />
      )}
    </div>
  );
}
