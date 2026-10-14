export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isTimeZone(value) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); return typeof value === 'string' && value.length > 0; }
  catch { return false; }
}
export function dateInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const dateOf = text => new Date(`${text}T00:00:00Z`);
const textOf = date => date.toISOString().slice(0, 10);

// Every occurrence uses the original anchor: Jan 31 -> Feb 28 -> Mar 31.
export function recurrenceAfter(rule, afterDate) {
  const anchor = dateOf(rule.startDate);
  const after = dateOf(afterDate);
  if (rule.startDate > afterDate) return rule.startDate;
  if (rule.frequency !== 'MONTHLY') {
    const days = rule.interval * (rule.frequency === 'WEEKLY' ? 7 : 1);
    const elapsed = Math.floor((after.getTime() - anchor.getTime()) / 86_400_000);
    anchor.setUTCDate(anchor.getUTCDate() + (Math.floor(elapsed / days) + 1) * days);
    return textOf(anchor);
  }
  const elapsedMonths = (after.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + after.getUTCMonth() - anchor.getUTCMonth();
  let count = Math.max(0, Math.floor(elapsedMonths / rule.interval));
  for (;;) {
    const next = new Date(anchor);
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + count * rule.interval);
    const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(anchor.getUTCDate(), last));
    if (next > after) return textOf(next);
    count += 1;
  }
}
export function firstRecurrenceOnOrAfter(rule, today) {
  const yesterday = dateOf(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return recurrenceAfter(rule, textOf(yesterday));
}

export function completionRepeatDate(rule, completedAt) {
  const completedDate = dateInZone(completedAt, rule.timeZone);
  return recurrenceAfter({ ...rule, startDate: completedDate }, completedDate);
}
