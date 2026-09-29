import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaReview, { VersionSwitcher, describeAnchor } from '../components/review/MediaReview';
import {
  describeShape, isOnSurface, mentionedIds, shapeFromGesture, shapePayload, simplifyStroke,
} from '../components/review/markup';

const NOW = '2026-09-20T10:00:00.000Z';
const base = { parentId: null, authorType: 'staff', timecodeMs: null, pageNumber: null, resolved: false, createdAt: NOW };

describe('markup geometry', () => {
  it('turns pointer gestures into normalized shapes', () => {
    expect(shapeFromGesture('pin', [[0.2, 0.3]])).toEqual({ shape: 'pin', region: { x: 0.2, y: 0.3, w: 0, h: 0 } });
    expect(shapeFromGesture('rect', [[0.6, 0.5], [0.2, 0.1]])).toEqual({ shape: 'rect', region: { x: 0.2, y: 0.1, w: 0.4, h: 0.4 } });
    // A click with the area tool is a pin, not a zero-size area.
    expect(shapeFromGesture('rect', [[0.5, 0.5], [0.501, 0.5]]).shape).toBe('pin');
    expect(shapeFromGesture('arrow', [[0.1, 0.1], [0.5, 0.2], [0.9, 0.9]])).toEqual({ shape: 'arrow', points: [[0.1, 0.1], [0.9, 0.9]] });
    expect(shapeFromGesture('arrow', [[0.1, 0.1], [0.1, 0.1]])).toBeNull();
    expect(shapeFromGesture('pen', [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]])).toEqual({ shape: 'pen', points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]] });
  });

  it('keeps strokes within the 500-point limit the API enforces', () => {
    const long = Array.from({ length: 2000 }, (_, i) => [i / 2000, 0.5]);
    const reduced = simplifyStroke(long);
    expect(reduced).toHaveLength(500);
    expect(reduced[0]).toEqual(long[0]);
    expect(reduced.at(-1)).toEqual(long.at(-1));
    expect(simplifyStroke([[0, 0], [0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });

  it('describes shapes in words and knows which surface they belong to', () => {
    expect(describeShape({ shape: 'rect', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } })).toBe('area from 10% across, 20% down, 30% wide and 40% tall');
    expect(describeShape({ shape: 'arrow', points: [[0, 0], [0.5, 0.75]] })).toBe('arrow pointing to 50% across, 75% down');
    expect(describeAnchor({ timecodeMs: 5000, shape: 'pen', points: [[0.2, 0.2], [0.4, 0.4]], region: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } }))
      .toBe('at 0:05, drawing around 30% across, 30% down');
    expect(describeAnchor({ pageNumber: 2, shape: 'rect', region: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe('page 2, area from 0% across, 0% down, 50% wide and 50% tall');
    expect(isOnSurface({ shape: 'rect', region: {}, pageNumber: 2 }, { kind: 'pdf', page: 2 })).toBe(true);
    expect(isOnSurface({ shape: 'rect', region: {}, pageNumber: 2 }, { kind: 'pdf', page: 3 })).toBe(false);
    expect(isOnSurface({ shape: 'pen', region: {}, timecodeMs: 5000 }, { kind: 'video', timeMs: 5800 })).toBe(true);
    expect(isOnSurface({ shape: 'pen', region: {}, timecodeMs: 5000 }, { kind: 'video', timeMs: 9000 })).toBe(false);
  });

  it('sends pins as bare regions and drawings with their shape and colour', () => {
    expect(shapePayload({ shape: 'pin', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, color: 'red' })).toEqual({ region: { x: 0.1, y: 0.1, w: 0, h: 0 } });
    expect(shapePayload({ shape: 'pen', points: [[0, 0], [1, 1]], color: 'blue' })).toEqual({ shape: 'pen', points: [[0, 0], [1, 1]], color: 'blue' });
    expect(mentionedIds('Thanks @Avery Admin and @Nobody', [{ id: 'u1', name: 'Avery Admin' }, { id: 'u2', name: 'Terry Team' }])).toEqual(['u1']);
  });
});

function renderReview(props = {}) {
  const onAddAnnotation = vi.fn(async (data) => ({ id: 'new-1', ...data }));
  const onResolve = vi.fn(async () => {});
  const utils = render(
    <MediaReview
      media={{ kind: 'image', fileName: 'Homepage.png', url: '/file.png' }}
      status="open"
      annotations={[]}
      decisions={[]}
      canComment
      canResolve
      onAddAnnotation={onAddAnnotation}
      onResolve={onResolve}
      onDecide={vi.fn(async () => {})}
      {...props}
    />,
  );
  return { ...utils, onAddAnnotation, onResolve };
}

describe('MediaReview markup', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} });
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws an area in the chosen colour and attaches it to the next comment', async () => {
    const user = userEvent.setup();
    const { onAddAnnotation } = renderReview();
    await user.click(screen.getByRole('button', { name: 'Area' }));
    expect(screen.getByRole('button', { name: 'Area' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    const surface = screen.getByTestId('annotation-overlay');
    fireEvent.pointerDown(surface, { clientX: 20, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 120, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 120, clientY: 60, pointerId: 1 });
    expect(screen.getByText(/Attached: area from 10% across, 10% down, 50% wide and 50% tall/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Too busy');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(onAddAnnotation).toHaveBeenCalledWith({ body: 'Too busy', shape: 'rect', region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, color: 'blue' });
  });

  it('draws a freehand stroke and can drop it before posting', async () => {
    const user = userEvent.setup();
    const { onAddAnnotation } = renderReview();
    await user.click(screen.getByRole('button', { name: 'Pen' }));
    const surface = screen.getByTestId('annotation-overlay');
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    for (const [x, y] of [[30, 20], [50, 40], [70, 20]]) fireEvent.pointerMove(surface, { clientX: x, clientY: y, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    await user.click(screen.getByRole('button', { name: 'Remove drawing' }));
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'General');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(onAddAnnotation).toHaveBeenCalledWith({ body: 'General' });
  });

  it('numbers every shape with a labelled badge, and selecting one highlights both', async () => {
    const user = userEvent.setup();
    const { container } = renderReview({
      annotations: [
        { ...base, id: 'r1', authorName: 'Terry', body: 'Area', shape: 'rect', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, color: 'orange' },
        { ...base, id: 'p1', authorName: 'Casey', authorType: 'client', body: 'Stroke', shape: 'pen', points: [[0.5, 0.5], [0.6, 0.6]], region: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
      ],
    });
    const badge = screen.getByRole('button', { name: 'Comment 2 by Casey, drawing around 55% across, 55% down' });
    await user.click(badge);
    expect(badge).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('[data-shape="pen"][data-selected="true"]')).not.toBeNull();
    expect(container.querySelector('li[data-selected="true"]')).toHaveAttribute('aria-labelledby', 'annotation-p1-heading');
    expect(screen.getByText(/^Client ·/)).toBeInTheDocument();

    // And from the list back to the shape.
    await user.click(screen.getByRole('button', { name: /Show markup 1/ }));
    expect(container.querySelector('[data-shape="rect"][data-selected="true"]')).not.toBeNull();
  });

  it('filters by status with counts', async () => {
    const user = userEvent.setup();
    renderReview({
      annotations: [
        { ...base, id: 'o1', authorName: 'A', body: 'Open one' },
        { ...base, id: 'o2', authorName: 'B', body: 'Open two' },
        { ...base, id: 'd1', authorName: 'C', body: 'Done one', resolved: true },
      ],
    });
    expect(screen.getByText('2 open, 1 resolved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show open (2)' }));
    const list = screen.getByRole('list', { name: 'Comment list' });
    expect(within(list).queryByText('Done one')).not.toBeInTheDocument();
    expect(within(list).getByText('Open two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show resolved (1)' }));
    expect(within(screen.getByRole('list', { name: 'Comment list' })).getByText('Done one')).toBeInTheDocument();
    // Numbers stay stable whatever the filter.
    expect(screen.getByRole('heading', { name: 'Comment 3 by C' })).toBeInTheDocument();
  });

  it('puts a marker on the video timeline for each timestamped comment, and seeks from it', async () => {
    const user = userEvent.setup();
    const { container } = renderReview({
      media: { kind: 'video', fileName: 'Walkthrough.webm', url: '/file.webm' },
      annotations: [
        { ...base, id: 'v1', authorName: 'Casey', body: 'Flicker', timecodeMs: 5000 },
        { ...base, id: 'v2', authorName: 'Terry', body: 'Arrow here', timecodeMs: 12_000, shape: 'arrow', points: [[0.1, 0.1], [0.3, 0.3]], region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      ],
    });
    const video = container.querySelector('video');
    const markers = screen.getByRole('list', { name: 'Comment markers on the timeline' });
    await user.click(within(markers).getByRole('button', { name: 'Comment 2 at 0:12, by Terry' }));
    expect(video.currentTime).toBe(12);
    expect(container.querySelector('[data-shape="arrow"]')).not.toBeNull();
  });

  it('attaches a drawing on a paused video frame to that frame\'s time', async () => {
    const user = userEvent.setup();
    const { container, onAddAnnotation } = renderReview({ media: { kind: 'video', fileName: 'Walkthrough.webm', url: '/file.webm' } });
    const video = container.querySelector('video');
    video.currentTime = 7.25;
    await user.click(screen.getByRole('button', { name: 'Arrow' }));
    const surface = screen.getByTestId('annotation-overlay');
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Point here');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(onAddAnnotation).toHaveBeenCalledWith({ body: 'Point here', shape: 'arrow', points: [[0.05, 0.1], [0.5, 0.5]], timecodeMs: 7250 });
  });

  it('mentions a teammate and sends their id with the comment', async () => {
    const user = userEvent.setup();
    const { onAddAnnotation } = renderReview({ mentionables: [{ id: 'u1', name: 'Avery Admin' }, { id: 'u2', name: 'Terry Team' }] });
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Please check');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mention a teammate' }), 'u1');
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Please check @Avery Admin ');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(onAddAnnotation).toHaveBeenCalledWith({ body: 'Please check @Avery Admin', mentionUserIds: ['u1'] });
  });

  it('never offers mentions to guests', () => {
    renderReview({ mentionables: [{ id: 'u1', name: 'Avery Admin' }], guest: { name: 'Casey', email: '', setName: vi.fn(), setEmail: vi.fn() } });
    expect(screen.queryByRole('combobox', { name: 'Mention a teammate' })).not.toBeInTheDocument();
  });
});

describe('VersionSwitcher', () => {
  it('switches between versions and says older ones are read-only', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<VersionSwitcher versions={[{ id: 'v1', version: 1, status: 'closed' }, { id: 'v2', version: 2, status: 'open' }]} currentId="v2" onSelect={onSelect} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Version' }), 'v1');
    expect(onSelect).toHaveBeenCalledWith('v1');
    expect(screen.getByText('Earlier versions and their comments are read-only.')).toBeInTheDocument();
  });

  it('is hidden for a single version', () => {
    const { container } = render(<VersionSwitcher versions={[{ id: 'v1', version: 1, status: 'open' }]} currentId="v1" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PDF review', () => {
  it('keeps the download link and explains when the inline viewer is unavailable', async () => {
    renderReview({ media: { kind: 'pdf', fileName: 'Brochure.pdf', url: '/file.pdf' } });
    expect(screen.getByRole('link', { name: 'Download PDF (Brochure.pdf)' })).toBeInTheDocument();
    // jsdom has no Worker/OffscreenCanvas: the lazy viewer says so instead of failing.
    await waitFor(() => expect(screen.getByText(/cannot show the PDF inline/)).toBeInTheDocument());
  });
});
