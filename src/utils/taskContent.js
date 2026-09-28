// Task page bodies are stored in Task.content as a JSON string holding an array
// of editor blocks (`[{ type, content, checked? }]`). Legacy rows may hold plain
// text, a JSON scalar/object, or blocks with non-string content. Normalise them
// so the page never loses the original value (mirrors web/src/lib/taskContent.js).

function toText(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function normalizeBlock(block) {
  if (block && typeof block === 'object' && !Array.isArray(block) && typeof block.type === 'string') {
    return { ...block, content: String(block.content ?? '') };
  }
  return { type: 'paragraph', content: toText(block) };
}

/** Parses a stored Task.content value into an array of editor blocks. */
export function parseTaskContent(stored) {
  if (stored === null || stored === undefined || stored === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [{ type: 'paragraph', content: String(stored) }];
  }
  if (Array.isArray(parsed)) return parsed.map(normalizeBlock);
  if (parsed === null || parsed === '') return [];
  return [{ type: 'paragraph', content: toText(parsed) }];
}
