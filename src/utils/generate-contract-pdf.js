// Branded contract PDF, shared by the staff route and the client portal
// download so both render the same signed record.
import PDFDocument from 'pdfkit';

export function contractPdfFilename(contract) {
  return (contract.title || 'contract').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * @param {object} contract Contract row with `client.name` included.
 * @returns {Promise<Buffer>}
 */
export async function generateContractPdf(contract) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));

  // Strip HTML for text rendering
  const stripHtml = (html) => {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '  \u2022 ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const primaryColor = '#2e2958';
  const accentColor = '#e6f354';
  const textColor = '#1a1a1a';
  const mutedColor = '#666666';

  // ---- Header bar ----
  doc.rect(0, 0, doc.page.width, 50).fill(primaryColor);
  doc.fillColor(accentColor).fontSize(18).font('Helvetica-Bold')
    .text('ASHBI HUB', 60, 15, { align: 'left' });
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica')
    .text('hub.ashbi.ca', doc.page.width - 160, 20, { align: 'right', width: 100 });

  // ---- Contract title ----
  doc.moveDown(2);
  doc.fillColor(primaryColor).fontSize(22).font('Helvetica-Bold')
    .text(contract.title || 'Service Agreement', { align: 'center' });
  doc.moveDown(0.5);

  // ---- Meta line ----
  doc.fillColor(mutedColor).fontSize(10).font('Helvetica');
  const metaLine = `Client: ${contract.client?.name || 'N/A'}    |    Date: ${new Date(contract.createdAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}    |    Type: ${contract.templateType || 'N/A'}`;
  doc.text(metaLine, { align: 'center' });
  doc.moveDown(0.3);

  // Accent line separator
  const lineY = doc.y;
  doc.moveTo(60, lineY).lineTo(doc.page.width - 60, lineY).strokeColor(accentColor).lineWidth(2).stroke();
  doc.moveDown(1);

  // ---- Contract content ----
  const plainContent = stripHtml(contract.content);
  doc.fillColor(textColor).fontSize(11).font('Helvetica')
    .text(plainContent, { align: 'left', lineGap: 4 });

  // ---- Signature block ----
  if (contract.status === 'SIGNED' && contract.clientSigName) {
    doc.moveDown(2);
    const sigY = doc.y;
    doc.moveTo(60, sigY).lineTo(300, sigY).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold')
      .text(contract.clientSigName, 60, sigY + 5);
    doc.fillColor(mutedColor).fontSize(9).font('Helvetica')
      .text(`Signed on ${new Date(contract.signedAt || contract.clientSigDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`, 60, sigY + 20);

    // Signature hash
    if (contract.clientSigHash) {
      doc.fontSize(7).fillColor('#aaaaaa')
        .text(`Signature ID: ${contract.clientSigHash}`, 60, sigY + 35);
    }
  }

  // ---- Footer with page numbers ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    const bottomY = doc.page.height - 40;
    doc.moveTo(60, bottomY - 5).lineTo(doc.page.width - 60, bottomY - 5).strokeColor('#eeeeee').lineWidth(0.5).stroke();
    doc.fillColor('#aaaaaa').fontSize(8).font('Helvetica')
      .text(`Ashbi Hub  |  hub.ashbi.ca  |  Page ${i + 1} of ${range.count}`, 60, bottomY, { align: 'center', width: doc.page.width - 120 });
    doc.restore();
  }

  const pdfBuffer = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.end();

  return pdfBuffer;
}
