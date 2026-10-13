import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';

export default function TaskFieldCell({ field, value }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">Not set</span>;
  if (field.type === 'BOOLEAN') return value ? 'Yes' : 'No';
  if (field.type === 'DATE') return formatDate(value, { dateOnly: true });
  if (field.type === 'MULTI_SELECT') return Array.isArray(value) ? value.join(', ') : 'Unavailable value';
  if (field.type === 'RELATION') {
    const target = { TASK: 'task', PROJECT: 'project', CLIENT: 'client' }[field.target];
    return target ? <Link className="text-primary" to={`/${target}/${encodeURIComponent(value)}`}>Open linked {target}</Link> : 'Linked team member';
  }
  if (field.type === 'URL' && /^https?:\/\//i.test(value)) return <a className="text-primary break-all" href={value} target="_blank" rel="noopener noreferrer">{value}</a>;
  return String(value);
}
