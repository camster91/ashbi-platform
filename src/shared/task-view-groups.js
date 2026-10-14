import { TASK_PRIORITIES } from './task-priority.js';

export function validateTaskViewGrouping(fields, grouping) {
  if (grouping?.by !== 'FIELD') return;
  const field = fields.find(item => item.key === grouping.fieldKey && !item.archived);
  if (!field || field.type === 'RELATION') throw Object.assign(new Error('Choose an available scalar or choice field for grouping.'), { statusCode: 400 });
}
export function groupTaskViewRows(tasks, grouping, fields = [], stages = []) {
  if (!grouping || grouping.by === 'NONE') return [{ key: 'all', label: 'All tasks', tasks }];
  const groups = new Map();
  const field = fields.find(item => item.key === grouping.fieldKey && !item.archived);
  for (const task of tasks) {
    const value = grouping.by === 'STATUS' ? task.status : grouping.by === 'PRIORITY' ? task.priority : grouping.by === 'STAGE' ? task.stageKey : field ? task.fieldValues?.[field.key] : null;
    const values = grouping.by === 'FIELD' && field?.type === 'MULTI_SELECT' && Array.isArray(value) ? (value.length ? value : [null]) : [value];
    for (const item of new Set(values)) {
      const missing = item === undefined || item === null || item === '';
      const key = missing ? 'missing' : JSON.stringify(item);
      let label = missing ? 'Unspecified' : typeof item === 'boolean' ? item ? 'Yes' : 'No' : String(item);
      if (!missing && grouping.by === 'STAGE') label = stages.find(stage => stage.key === item)?.name ?? 'Unavailable stage';
      else if (!missing && ['STATUS', 'PRIORITY'].includes(grouping.by)) label = label.replaceAll('_', ' ').toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, label, value: item, tasks: [] });
      groups.get(key).tasks.push(task);
    }
  }
  const order = grouping.by === 'PRIORITY' ? TASK_PRIORITIES : grouping.by === 'STAGE' ? stages.map(stage => stage.key) : [];
  const rank = group => { const index = order.indexOf(group.value); return index >= 0 ? index : order.length; };
  return [...groups.values()].sort((a, b) => (a.key === 'missing') - (b.key === 'missing') || rank(a) - rank(b) || a.label.localeCompare(b.label));
}
