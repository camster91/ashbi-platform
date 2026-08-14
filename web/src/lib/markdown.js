import { safeHtml } from './safeHtml';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInline(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 font-mono text-xs">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Renders Ashbi's intentionally small Markdown subset. Source HTML is escaped
 * before parsing and sanitized again before mounting, so stored document text
 * never becomes executable markup.
 */
export function renderMarkdown(content) {
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p class="mb-3">${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const listClass = list.ordered ? 'mb-3 list-decimal space-y-1 pl-5' : 'mb-3 list-disc space-y-1 pl-5';
    blocks.push(`<${tag} class="${listClass}">${list.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
    list = null;
  };

  for (const line of String(content ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level} class="mb-2 mt-4 font-semibold ${level === 1 ? 'text-xl' : level === 2 ? 'text-lg' : 'text-base'}">${renderInline(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (!list || list.ordered !== nextOrdered) {
        flushList();
        list = { ordered: nextOrdered, items: [] };
      }
      list.items.push((unordered || ordered)[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return safeHtml(blocks.join(''), { mode: 'strict' });
}
