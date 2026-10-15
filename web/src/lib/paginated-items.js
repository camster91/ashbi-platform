// Caller supplies page order; repeated keys keep their first position and latest value.
export function paginatedItems(pages, keySelector) {
  const items = (pages || []).flatMap(page => page.items || []);
  return [...new Map(items.map(item => [keySelector(item), item])).values()];
}
