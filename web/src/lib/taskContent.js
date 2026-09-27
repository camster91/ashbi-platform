// Task page bodies are stored as an array of editor blocks
// (`[{ type, content, checked? }]`). The API sends and accepts that array; this
// helper tolerates legacy rows that were saved as a bare string.
export function normalizeTaskBlocks(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim()) return [{ type: 'paragraph', content }];
  return [];
}
