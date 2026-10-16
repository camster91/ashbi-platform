// Pure rate-derived arithmetic, shared by project budgets and bot hours.
// Neither stored rates nor projects establish a currency or verified labor cost.
export function summarizeLabor(entries) {
  const users = new Map();
  let knownRateAmount = 0, missingRateMinutes = 0, missingRateEntries = 0;
  for (const entry of entries) {
    const rate = entry.hourlyRate ?? entry.user?.hourlyRate;
    const known = Number.isFinite(rate) && rate >= 0;
    const hours = entry.duration / 60;
    const id = entry.userId ?? entry.user?.id;
    if (!users.has(id)) users.set(id, { user: entry.user, hours: 0, cost: 0, knownRateAmount: 0, missingRateMinutes: 0, missingRateEntries: 0 });
    const group = users.get(id);
    group.hours += hours;
    if (known) {
      const amount = hours * rate;
      knownRateAmount += amount; group.knownRateAmount += amount;
    } else {
      missingRateMinutes += entry.duration; missingRateEntries++;
      group.missingRateMinutes += entry.duration; group.missingRateEntries++;
    }
  }
  for (const group of users.values()) group.cost = group.missingRateEntries ? null : group.knownRateAmount;
  return { knownRateAmount, missingRateMinutes, missingRateEntries, costByUser: [...users.values()] };
}
