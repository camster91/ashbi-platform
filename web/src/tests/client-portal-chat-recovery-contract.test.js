import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/ClientPortal.jsx'), 'utf8');

describe('client portal chat recovery', () => {
  it('preserves an unsent message and announces a recoverable failure in both chat surfaces', () => {
    expect(source).toContain('const [sendError, setSendError] = useState(\'\');');
    expect(source).toContain('const [sending, setSending] = useState(false);');
    expect(source).toContain('throw new Error(');
    expect(source).toContain('setChatInput(\'\');');
    expect(source).toContain('setInput(\'\');');
    expect(source).toContain("role=\"alert\"");
    expect(source).toContain('disabled={!chatInput.trim() || sending}');
    expect(source).toContain('disabled={!input.trim() || sending}');
  });
});
