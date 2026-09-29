import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getChatMessages: vi.fn(async () => [
      { id: 'm1', content: 'Round 2 logos are up', authorId: 'u2', author: { name: 'Priya' }, createdAt: '2030-01-01T10:00:00.000Z' },
    ]),
    getAttachments: vi.fn(async () => []),
  },
}));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Cameron' } }) }));

const { default: ProjectChat } = await import('../components/ProjectChat');

describe('ProjectChat', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalScrollTo = Element.prototype.scrollTo;
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    Element.prototype.scrollTo = originalScrollTo;
  });

  it('scrolls only its own message list, never the page, when messages load', async () => {
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    Element.prototype.scrollTo = scrollTo;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectChat projectId="p1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Round 2 logos are up')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollTo.mock.contexts.at(-1)).toHaveClass('overflow-y-auto');
  });

  it('offers a labelled, focusable Attach button that opens the file picker', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectChat projectId="p1" />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole('button', { name: 'Attach a file to this message' });
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveClass('hidden');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(click).toHaveBeenCalled();
  });
});
