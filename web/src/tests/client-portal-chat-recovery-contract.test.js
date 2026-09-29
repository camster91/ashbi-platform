import { describe, expect, it } from 'vitest';
import { clientPortalSource } from './helpers/clientPortalSource';

const source = clientPortalSource();

describe('client portal chat recovery', () => {
  it('preserves an unsent message and announces a recoverable failure in both chat surfaces', () => {
    expect(source).toContain('const [sendError, setSendError] = useState(\'\');');
    expect(source).toContain('const [sending, setSending] = useState(false);');
    expect(source).toContain('throw new Error(');
    expect(source).toContain('setChatInput(\'\');');
    expect(source).toContain('setInput(\'\');');
    expect(source).toContain("role=\"alert\"");
    // Send needs text or an uploaded file (docs/chat-media.md), never while sending.
    expect(source).toContain('disabled={!canSendPortalMessage(value, attachments) || sending}');
    expect(source).toContain("return Boolean(text.trim()) || (attachments?.readyIds.length ?? 0) > 0;");
  });

  it('does not present a failed chat history request as an empty conversation', () => {
    expect(source).toContain('const [messagesError, setMessagesError] = useState(\'\');');
    expect(source).toContain('const [loadingMessages, setLoadingMessages] = useState(false);');
    expect(source).toContain('Chat messages could not be loaded. Try again.');
    expect(source).toContain('onClick={reloadMessages}');
  });
});
