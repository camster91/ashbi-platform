import { Link } from 'react-router-dom';
import { getProjectStatusColor, getProjectStatusLabel, cn } from '../../lib/utils';
import { dueState, shortDate, taskProgress } from './projectBoard';
import { OwnerAvatar, PortfolioPicker } from './ProjectBoardCard';

// Projects as one table (the List view on the Projects page), in the API's
// order: at-risk first, then most recently updated.
export default function ProjectListView({ projects, ownerFor, savingId, onPortfolioChange }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Projects</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="px-4 py-3 text-eyebrow text-muted-foreground">Project</th>
            <th scope="col" className="px-3 py-3 text-eyebrow text-muted-foreground">Stage</th>
            <th scope="col" className="px-3 py-3 text-eyebrow text-muted-foreground">Owner</th>
            <th scope="col" className="px-3 py-3 text-eyebrow text-muted-foreground">Due</th>
            <th scope="col" className="px-3 py-3 text-eyebrow text-muted-foreground text-right">Tasks</th>
            <th scope="col" className="px-4 py-3 text-eyebrow text-muted-foreground">Portfolio</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const owner = ownerFor(project);
            const due = dueState(project);
            const { total, done } = taskProgress(project);
            return (
              <tr key={project.id} className="border-t border-border/40 align-middle">
                <td className="px-4 py-2.5">
                  <Link to={`/project/${project.id}`} className="font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm break-words">
                    {project.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{project.client?.name || 'No client'}</div>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', getProjectStatusColor(project.status))}>
                    {getProjectStatusLabel(project.status)}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {owner ? (
                    <span className="flex items-center gap-2"><OwnerAvatar owner={owner} /><span className="text-foreground">{owner.name}</span></span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn('px-3 py-2.5 whitespace-nowrap', due === 'overdue' ? 'font-semibold text-destructive' : due === 'soon' ? 'font-semibold text-warning' : 'text-muted-foreground')}>
                  {project.endDate ? shortDate(project.endDate) : '—'}
                  {due === 'overdue' && <span className="block text-xs">Overdue</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="figure text-muted-foreground">{total > 0 ? `${done} / ${total}` : '—'}</span>
                </td>
                <td className="px-4 py-2.5">
                  <PortfolioPicker project={project} saving={savingId === project.id} onChange={onPortfolioChange} className="w-full max-w-[12rem]" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
