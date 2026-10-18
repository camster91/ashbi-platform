import { useState } from 'react';
import ProjectBoardCard from './ProjectBoardCard';
import { LAUNCHED_VISIBLE, groupProjectsByColumn, sortByFinished } from './projectBoard';

// The Board view on the Projects page: one column per stage, wrapping on
// narrow screens instead of scrolling sideways. Launched shows the latest few
// and keeps the rest behind "Show older".
function BoardColumn({ column, ownerFor, isAdmin, savingId, onPortfolioChange }) {
  const [showAll, setShowAll] = useState(false);
  const headingId = `project-column-${column.key.toLowerCase()}`;
  const collapsible = column.key === 'LAUNCHED' && column.projects.length > LAUNCHED_VISIBLE;
  const ordered = column.key === 'LAUNCHED' ? sortByFinished(column.projects) : column.projects;
  const visible = collapsible && !showAll ? ordered.slice(0, LAUNCHED_VISIBLE) : ordered;
  const hidden = ordered.length - visible.length;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5 rounded-lg bg-muted/50 p-3">
      <div className="flex items-center justify-between gap-2 px-1 py-0.5">
        <h2 id={headingId} className="text-eyebrow text-foreground">{column.label}</h2>
        <span className="figure text-xs text-muted-foreground">{column.projects.length}<span className="sr-only"> {column.projects.length === 1 ? 'project' : 'projects'}</span></span>
      </div>
      {column.projects.length === 0 ? (
        <p className="px-1 pb-2 text-sm text-muted-foreground">{column.emptyText}</p>
      ) : (
        visible.map((project) => (
          <ProjectBoardCard
            key={project.id}
            project={project}
            column={column.key}
            owner={ownerFor(project)}
            isAdmin={isAdmin}
            saving={savingId === project.id}
            onPortfolioChange={onPortfolioChange}
          />
        ))
      )}
      {collapsible && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
          className="min-h-11 rounded-lg border border-dashed border-border bg-transparent text-sm text-muted-foreground hover:bg-card focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll ? 'Show fewer' : `Show ${hidden} older`}
        </button>
      )}
    </section>
  );
}

export default function ProjectBoard({ projects, ownerFor, isAdmin, savingId, onPortfolioChange }) {
  const columns = groupProjectsByColumn(projects);
  return (
    <div
      role="region"
      aria-label="Project status board"
      className="grid grid-cols-[repeat(auto-fit,minmax(min(15.5rem,100%),1fr))] items-start gap-4"
    >
      {columns.map((column) => (
        <BoardColumn
          key={column.key}
          column={column}
          ownerFor={ownerFor}
          isAdmin={isAdmin}
          savingId={savingId}
          onPortfolioChange={onPortfolioChange}
        />
      ))}
    </div>
  );
}
