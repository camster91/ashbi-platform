import DOMPurify from 'dompurify';

/**
 * Shared HTML sanitizer for `dangerouslySetInnerHTML` consumers.
 *
 * Use this everywhere user-supplied or LLM-generated HTML is rendered.
 * Defaults are intentionally permissive (matching the previous per-file
 * behavior) but lock down script, event handlers, and javascript: URIs.
 *
 * Pass `mode: 'strict'` for the narrow contract-style allowlist used by
 * PortalContract — only the structural tags needed to render prose/tables.
 */
const DEFAULT_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'strong', 'em', 'u', 'b', 'i',
    'a', 'blockquote', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span',
    'img', 'figure', 'figcaption',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
  // DOMPurify already strips <script>, javascript:, on*= handlers, and data:
  // URIs by default — we just narrow the surface above.
};

const STRICT_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'strong', 'em', 'u',
    'a', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
};

export function safeHtml(content, opts = {}) {
  const config = opts.mode === 'strict' ? STRICT_CONFIG : DEFAULT_CONFIG;
  return DOMPurify.sanitize(content || '', config);
}