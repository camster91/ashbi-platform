import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const task = {
  id: 'task-1',
  title: 'Logo concepts round 2',
  icon: '📄',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  content: [
    { type: 'heading1', content: 'Brief' },
    { type: 'paragraph', content: 'Push the serif further' },
  ],
  project: { id: 'p1', name: 'Northwind Brand Refresh' },
  subpages: [],
  comments: [],
};

const updateTaskContent = vi.fn(async () => ({ id: 'task-1' }));
const updateTask = vi.fn(async () => ({ id: 'task-1' }));

vi.mock('../lib/api', () => ({
  api: {
    getTaskPage: vi.fn(async () => task),
    getTaskBreadcrumbs: vi.fn(async () => []),
    updateTaskContent: (...args) => updateTaskContent(...args),
    updateTask: (...args) => updateTask(...args),
    createSubpage: vi.fn(),
    addTaskComment: vi.fn(),
    searchMentions: vi.fn(async () => ({ users: [], tasks: [] })),
  },
}));

const { default: TaskPage } = await import('../pages/TaskPage');

function renderTask() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/task/task-1']}>
          <Routes>
            <Route path="/task/:id" element={<TaskPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('TaskPage content autosave', () => {
  beforeEach(() => { updateTaskContent.mockClear(); updateTask.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('shows stored blocks and does not autosave when the page opens', async () => {
    renderTask();
    expect(await screen.findByDisplayValue('Push the serif further')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(updateTaskContent).not.toHaveBeenCalled();
  });

  it('saves the edited block array once after the user types', async () => {
    renderTask();
    const block = await screen.findByDisplayValue('Push the serif further');
    fireEvent.change(block, { target: { value: 'Push the serif much further' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(updateTaskContent).toHaveBeenCalledTimes(1);
    const [id, body] = updateTaskContent.mock.calls[0];
    expect(id).toBe('task-1');
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.content[1]).toMatchObject({ type: 'paragraph', content: 'Push the serif much further' });
  });

  it('clearing the title restores the saved title instead of sending an empty one', async () => {
    renderTask();
    const title = await screen.findByLabelText('Task title');
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(updateTaskContent).not.toHaveBeenCalledWith('task-1', expect.objectContaining({ title: expect.anything() }));
    expect(title).toHaveValue('Logo concepts round 2');
  });

  it('title edits send only the title, never the block content', async () => {
    renderTask();
    const title = await screen.findByLabelText('Task title');
    fireEvent.change(title, { target: { value: 'Logo concepts round 3' } });
    fireEvent.blur(title);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(updateTaskContent).toHaveBeenCalledWith('task-1', { title: 'Logo concepts round 3' });
  });

  it('shows the stored due-date calendar day for a viewer in Toronto', async () => {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const viewerFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function viewerDateFormat(locale, options) {
      return new NativeDateTimeFormat(locale, { timeZone: 'America/Toronto', ...options });
    });
    task.dueDate = '2026-10-10T00:00:00.000Z';
    try {
      renderTask();
      expect(await screen.findByText('Oct 10, 2026')).toBeInTheDocument();
      expect(screen.queryByText('Oct 9, 2026')).not.toBeInTheDocument();
    } finally {
      delete task.dueDate;
      viewerFormat.mockRestore();
    }
  });

  it('edits task properties through the task API without overwriting document content', async () => {
    renderTask();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit task properties' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Task status' }), { target: { value: 'COMPLETED' } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(updateTask).toHaveBeenCalledWith('task-1', { status: 'COMPLETED' });
    expect(updateTaskContent).not.toHaveBeenCalled();
  });
});
