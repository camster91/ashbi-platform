// Regression: proposal-builder.agent.js called `new PDFDocument()` without
// importing pdfkit, so every proposal PDF (and the Gmail draft that attaches
// it) failed with a ReferenceError.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { generatePdf } = await import('../../agents/proposal-builder.agent.js');

describe('proposal builder PDF export', () => {
  it('renders proposal HTML to a non-empty PDF buffer', async () => {
    const html = `<html><head><style>body { color: red; }</style></head><body>
      <h1>ASHBI DESIGN</h1>
      <h2>INVESTMENT</h2>
      <p>Branding Full &mdash; $3,500. ${'A long paragraph of proposal copy. '.repeat(40)}</p>
    </body></html>`;

    const pdf = await generatePdf(html);

    assert.ok(Buffer.isBuffer(pdf), 'expected a Buffer');
    assert.ok(pdf.length > 500, `expected a real PDF, got ${pdf.length} bytes`);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(pdf.subarray(-8).toString('latin1'), /%%EOF/);
  });
});
