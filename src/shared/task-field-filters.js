export function taskFieldFilterOperators(type) {
  return type === 'MULTI_SELECT' ? ['HAS'] : type === 'NUMBER' || type === 'DATE' ? ['EQ', 'GTE', 'LTE'] : type === 'TEXT' ? ['EQ', 'CONTAINS'] : ['EQ'];
}
export function taskFieldFiltersWhere(filters = []) {
  return filters.map(({ key, operator, value }) => ({ fieldValues: {
    path: [key],
    ...(operator === 'HAS' ? { array_contains: [value] } : operator === 'CONTAINS' ? { string_contains: value, mode: 'insensitive' }
      : { [({ EQ: 'equals', GTE: 'gte', LTE: 'lte' })[operator]]: value }),
  } }));
}
