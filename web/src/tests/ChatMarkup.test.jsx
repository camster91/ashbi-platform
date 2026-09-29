import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkupEditor from '../components/media/MarkupEditor';
import { drawShape, isMeaningfulShape, strokeWidthFor } from '../components/media/markup';
import { PortalChatComposer, canSendPortalMessage } from '../pages/client-portal/shared';
import { useAttachmentDraft } from '../components/media/useAttachmentDraft';

function fakeContext(canvas) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    canvas,
    calls,
    save: record('save'), restore: record('restore'), beginPath: record('beginPath'), moveTo: record('moveTo'),
    lineTo: record('lineTo'), stroke: record('stroke'), fill: record('fill'), closePath: record('closePath'),
    strokeRect: record('strokeRect'), clearRect: record('clearRect'), drawImage: record('drawImage'),
    strokeText: record('strokeText'), fillText: record('fillText'),
  };
}

describe('markup drawing', () => {
  it('ignores stray clicks and draws each tool', () => {
    expect(isMeaningfulShape({ tool: 'rect', from: { x: 0, y: 0 }, to: { x: 1, y: 2 } })).toBe(false);
    expect(isMeaningfulShape({ tool: 'arrow', from: { x: 0, y: 0 }, to: { x: 40, y: 2 } })).toBe(true);
    expect(isMeaningfulShape({ tool: 'pen', points: [{ x: 0, y: 0 }] })).toBe(false);
    expect(isMeaningfulShape({ tool: 'text', from: { x: 0, y: 0 }, text: '  ' })).toBe(false);
    expect(strokeWidthFor(3840, 2160)).toBe(12);
    expect(strokeWidthFor(200, 100)).toBe(3);
    const context = fakeContext({ width: 100, height: 100 });
    drawShape(context, { tool: 'rect', color: '#ef4444', width: 3, from: { x: 50, y: 40 }, to: { x: 10, y: 5 } });
    expect(context.calls).toContainEqual(['strokeRect', 10, 5, 40, 35]);
    drawShape(context, { tool: 'text', color: '#ffffff', width: 3, from: { x: 5, y: 6 }, text: 'Fix this' });
    expect(context.calls).toContainEqual(['fillText', 'Fix this', 5, 6]);
    expect(context.strokeStyle).toBe('#111827');
  });
});

describe('markup editor', () => {
  let contexts;
  beforeEach(() => {
    contexts = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
      const context = fakeContext(this);
      contexts.push(context);
      return context;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0 });
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) { callback(new Blob(['png'], { type: 'image/png' })); };
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws, undoes with the button and the keyboard, and exports a PNG', async () => {
    const onDone = vi.fn();
    const image = { width: 800, height: 400 };
    render(<MarkupEditor image={image} onCancel={vi.fn()} onDone={onDone} />);
    const canvas = screen.getByRole('img', { name: /Screenshot to mark up \(0 marks\)/ });
    expect(canvas).toHaveAttribute('width', '800');
    expect(screen.getByRole('button', { name: 'Arrow' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    expect(screen.getByRole('button', { name: 'Blue colour' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 80, pointerId: 1 });
    expect(screen.getByRole('img', { name: /\(1 mark\)/ })).toBeInTheDocument();
    // Pointer coordinates are mapped to image pixels (400×200 CSS px → 800×400 px).
    const drawn = contexts.flatMap((context) => context.calls).filter(([name]) => name === 'strokeRect').at(-1);
    expect(drawn).toEqual(['strokeRect', 20, 20, 180, 140]);

    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('img', { name: /\(0 marks\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 2 });
    const textInput = screen.getByLabelText('Text to place on the screenshot');
    fireEvent.change(textInput, { target: { value: 'Too tight' } });
    fireEvent.keyDown(textInput, { key: 'Enter' });
    expect(screen.getByRole('img', { name: /\(1 mark\)/ })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Attach screenshot' })); });
    expect(onDone).toHaveBeenCalledTimes(1);
    const file = onDone.mock.calls[0][0];
    expect(file.type).toBe('image/png');
    expect(file.name).toMatch(/^screenshot-.*\.png$/);
  });
});

function PortalHarness({ upload }) {
  const attachments = useAttachmentDraft({ upload });
  return <PortalChatComposer value="" onChange={() => {}} onSubmit={(event) => event.preventDefault()} connected sending={false} sendError="" attachments={attachments} />;
}

describe('client portal composer attachments', () => {
  it('lets a client attach a file and send it without text once uploaded', async () => {
    let finish;
    const upload = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { container } = render(<PortalHarness upload={upload} />);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(['%PDF-'], 'brief.pdf', { type: 'application/pdf' })] } });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await act(async () => { finish({ id: 'pending-1' }); });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('keeps the text-only composer when no attachment draft is given', () => {
    render(<PortalChatComposer value="Hello" onChange={() => {}} onSubmit={() => {}} connected sending={false} sendError="" />);
    expect(screen.queryByRole('button', { name: 'Attach a file to this message' })).toBeNull();
    expect(canSendPortalMessage('  ', { readyIds: [], uploading: false })).toBe(false);
    expect(canSendPortalMessage('', { readyIds: ['a'], uploading: false })).toBe(true);
    expect(canSendPortalMessage('hi', { readyIds: ['a'], uploading: true })).toBe(false);
  });
});
