// Task page bodies are stored as an array of editor blocks
// (`[{ type, content, checked? }]`). The API sends and accepts that array; this
// helper keeps legacy or malformed rows readable instead of dropping them:
// - every block's content is coerced to a string (null → '');
// - a non-block entry becomes a paragraph holding its value;
// - a stored scalar or object becomes one paragraph with the original value
//   (strings as-is, everything else JSON-encoded) rather than an empty page.
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

export function normalizeTaskBlocks(content) {
  if (Array.isArray(content)) return content.map(normalizeBlock);
  if (content === null || content === undefined || content === '') return [];
  return [{ type: 'paragraph', content: toText(content) }];
}
