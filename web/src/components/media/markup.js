// Screenshot markup (docs/chat-media.md): shapes are kept as data in image
// pixel coordinates and redrawn on every change, so undo is a pop and the
// exported PNG is drawn at the image's full resolution.

export const MARKUP_TOOLS = Object.freeze([
  { id: 'arrow', label: 'Arrow' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'pen', label: 'Pen' },
  { id: 'text', label: 'Text' },
]);

export const MARKUP_COLORS = Object.freeze([
  { id: '#ef4444', label: 'Red' },
  { id: '#f59e0b', label: 'Amber' },
  { id: '#22c55e', label: 'Green' },
  { id: '#3b82f6', label: 'Blue' },
  { id: '#111827', label: 'Black' },
  { id: '#ffffff', label: 'White' },
]);

/** Stroke width that reads at any screenshot size. */
export function strokeWidthFor(width, height) {
  return Math.max(3, Math.round(Math.max(width, height) / 320));
}

/** Drag distance below which an arrow/rectangle is treated as a stray click. */
export const MIN_SHAPE_SIZE = 4;

export function isMeaningfulShape(shape) {
  if (shape.tool === 'pen') return shape.points.length > 1;
  if (shape.tool === 'text') return Boolean(shape.text?.trim());
  const dx = Math.abs(shape.to.x - shape.from.x);
  const dy = Math.abs(shape.to.y - shape.from.y);
  return Math.max(dx, dy) >= MIN_SHAPE_SIZE;
}

function drawArrow(context, { from, to }, width) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = width * 4;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x - Math.cos(angle) * head * 0.6, to.y - Math.sin(angle) * head * 0.6);
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  context.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {any} shape
 */
export function drawShape(context, shape) {
  context.save();
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = shape.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (shape.tool === 'arrow') drawArrow(context, shape, shape.width);
  else if (shape.tool === 'rect') {
    context.strokeRect(
      Math.min(shape.from.x, shape.to.x),
      Math.min(shape.from.y, shape.to.y),
      Math.abs(shape.to.x - shape.from.x),
      Math.abs(shape.to.y - shape.from.y),
    );
  } else if (shape.tool === 'pen') {
    context.beginPath();
    shape.points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
    context.stroke();
  } else if (shape.tool === 'text') {
    const size = shape.width * 6;
    context.font = `600 ${size}px system-ui, sans-serif`;
    context.textBaseline = 'top';
    // Outline keeps text legible on any background.
    context.lineWidth = Math.max(2, shape.width * 0.8);
    context.strokeStyle = shape.color === '#ffffff' ? '#111827' : '#ffffff';
    context.strokeText(shape.text, shape.from.x, shape.from.y);
    context.fillText(shape.text, shape.from.x, shape.from.y);
  }
  context.restore();
}

/**
 * Draw the image and every shape.
 * @param {CanvasRenderingContext2D} context
 * @param {CanvasImageSource} image
 * @param {any[]} shapes
 */
export function renderMarkup(context, image, shapes) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  for (const shape of shapes) drawShape(context, shape);
}

/** Map a pointer event to canvas pixel coordinates. */
export function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / (rect.width || 1)) * canvas.width,
    y: ((event.clientY - rect.top) / (rect.height || 1)) * canvas.height,
  };
}
