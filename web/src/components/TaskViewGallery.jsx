import { Link } from 'react-router-dom';
import TaskFieldCell from './TaskFieldCell';
import { formatDate } from '../lib/format';
import { TASK_PRIORITY_LABELS } from '@shared/task-priority.js';

export default function TaskViewGallery({ groups, fields, grouped }) {
  return <div className="space-y-5" role="region" aria-label="Task gallery">{groups.map(group => <section key={group.key} aria-label={grouped ? group.label : 'All tasks'} className="min-w-0">
    {grouped && <h2 className="font-semibold mb-3 break-words">{group.label} ({group.tasks.length})</h2>}
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 min-w-0">{group.tasks.map(task => <li key={task.id} className="min-w-0 rounded border border-border bg-card p-4 space-y-2">
      <Link to={`/task/${task.id}`} className="block min-h-11 font-semibold text-primary [overflow-wrap:anywhere]">{task.title}</Link>
      {task.description && <p className="text-sm text-muted-foreground line-clamp-3 [overflow-wrap:anywhere]">{task.description}</p>}
      <p className="text-xs">{String(task.status).replaceAll('_', ' ').toLowerCase()} · {TASK_PRIORITY_LABELS[task.priority] || task.priority}</p>
      <p className="text-sm [overflow-wrap:anywhere]">{task.assignee?.name || 'Unassigned'} · {task.dueDate ? formatDate(task.dueDate, { dateOnly: true }) : 'No due date'}</p>
      {fields.length > 0 && <dl className="space-y-1">{fields.map(field => <div key={field.key} className="text-sm [overflow-wrap:anywhere]"><dt className="font-medium">{field.name}</dt><dd><TaskFieldCell field={field} value={task.fieldValues?.[field.key]} relation={task.fieldRelations?.[field.key]} /></dd></div>)}</dl>}
    </li>)}</ul>
  </section>)}</div>;
}
