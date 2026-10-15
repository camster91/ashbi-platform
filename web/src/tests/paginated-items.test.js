import { describe, expect, it } from 'vitest';
import { paginatedItems } from '../lib/paginated-items.js';

describe('paginatedItems', () => {
  it('returns an empty list for absent pages and missing or null item lists', () => {
    const key = item => item.id;
    for (const pages of [undefined, null, [], [{}, { items: null }, { items: [] }]]) {
      expect(paginatedItems(pages, key)).toEqual([]);
    }
  });

  it('keeps the first key position and last item value in the supplied page order', () => {
    const first = { id: 'first', text: 'Original' };
    const second = { id: 'second' };
    const updated = { id: 'first', text: 'Updated' };
    const third = { id: 'third' };
    const pages = [{ items: [first, second] }, { items: [updated, third] }];

    expect(paginatedItems(pages, item => item.id)).toEqual([updated, second, third]);
    expect(paginatedItems([...pages].reverse(), item => item.id)).toEqual([first, third, second]);
  });

  it('lets the caller distinguish records sharing an id using a composite key', () => {
    const email = { source: 'email', id: 'same', text: 'Email' };
    const chat = { source: 'chat', id: 'same', text: 'Chat' };
    const updatedEmail = { ...email, text: 'Updated email' };
    expect(paginatedItems([
      { items: [email, chat] }, { items: [updatedEmail] },
    ], item => `${item.source}:${item.id}`)).toEqual([updatedEmail, chat]);
  });

  it('preserves input pages, arrays and record references without mutation', () => {
    const item = Object.freeze({ id: 'item' });
    const items = Object.freeze([item]);
    const page = Object.freeze({ items });
    const pages = Object.freeze([page]);
    const result = paginatedItems(pages, record => record.id);

    expect(result).toEqual([item]);
    expect(result).not.toBe(items);
    expect(result[0]).toBe(item);
    expect(pages[0]).toBe(page);
    expect(page.items).toBe(items);
  });
});
