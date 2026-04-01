// Professional Invoice PDF Generator — uses pdfkit
import PDFDocument from 'pdfkit';

const BRAND_BLUE = '#2563eb';
const DARK = '#1e293b';
const MUTED = '#64748b';
const LIGHT_BG = '#f8fafc';
const BORDER = '#e2e8f0';
const GREEN = '#16a34a';
const RED = '#dc2626';

function fmt(n) {
  const num = parseFloat(n) || 0;
  return '$' + num.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return 'Upon receipt';
  return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Generate a professional PDF invoice buffer
 * @param {Object} invoice - Invoice with client, lineItems, payments
 * @returns {Promise<Buffer>}
 */
export async function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 100; // margins on each side = 50
    const LEFT = 50;
    const RIGHT = doc.page.width - 50;

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.rect(LEFT - 50, 0, doc.page.width, 90).fill(DARK);

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#ffffff')
      .text('ASHBI DESIGN', LEFT, 22);
    doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.7)')
      .text('ashbi.ca  ·  cameron@ashbi.ca  ·  Toronto, Ontario, Canada', LEFT, 50);

    // "INVOICE" label on right side of header
    doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff')
      .text('INVOICE', LEFT, 22, { width: pageWidth, align: 'right' });
    doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.8)')
      .text(invoice.invoiceNumber, LEFT, 55, { width: pageWidth, align: 'right' });

    // ── Status badge ─────────────────────────────────────────────────────────
    const statusColors = {
      PAID: GREEN,
      SENT: BRAND_BLUE,
      DRAFT: MUTED,
      OVERDUE: RED,
      VOID: MUTED,
    };
    const statusColor = statusColors[invoice.status] || MUTED;
    const statusLabel = invoice.status || 'DRAFT';

    // Draw status badge
    const badgeText = statusLabel;
    const badgeX = RIGHT - 60;
    doc.roundedRect(badgeX, 72, 60, 16, 4).fill(statusColor);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
      .text(badgeText, badgeX, 75, { width: 60, align: 'center' });

    // ── Bill To + Invoice Meta ────────────────────────────────────────────────
    let y = 110;

    // Bill To (left)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      .text('BILL TO', LEFT, y);
    y += 14;

    const client = invoice.client;
    const contact = client?.contacts?.[0];

    doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK)
      .text(client?.name || 'Client', LEFT, y);
    y += 16;

    if (contact?.email) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text(contact.email, LEFT, y);
      y += 13;
    }
    if (contact?.phone) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text(contact.phone, LEFT, y);
      y += 13;
    }
    if (client?.domain) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text(client.domain, LEFT, y);
      y += 13;
    }

    // Invoice meta (right column)
    const metaX = LEFT + pageWidth / 2;
    let metaY = 110;

    const metaRows = [
      ['Invoice #:', invoice.invoiceNumber],
      ['Issue Date:', fmtDate(invoice.issueDate || invoice.createdAt)],
      ['Due Date:', fmtDate(invoice.dueDate)],
      ['Status:', statusLabel],
    ];

    for (const [label, value] of metaRows) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
        .text(label, metaX, metaY, { width: 90 });
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
        .text(value, metaX + 90, metaY, { width: pageWidth / 2 - 90 });
      metaY += 16;
    }

    // ── Title (if any) ────────────────────────────────────────────────────────
    const sectionY = Math.max(y, metaY) + 20;

    if (invoice.title) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK)
        .text(invoice.title, LEFT, sectionY);
    }

    // ── Line items table ──────────────────────────────────────────────────────
    const tableY = invoice.title ? sectionY + 24 : sectionY;
    const colWidths = [pageWidth * 0.48, pageWidth * 0.12, pageWidth * 0.20, pageWidth * 0.20];
    const colX = [LEFT, LEFT + colWidths[0], LEFT + colWidths[0] + colWidths[1], LEFT + colWidths[0] + colWidths[1] + colWidths[2]];

    // Header row
    doc.rect(LEFT - 50, tableY - 6, doc.page.width, 24).fill(LIGHT_BG);
    const headers = ['DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'];
    const headerAligns = ['left', 'center', 'right', 'right'];
    headers.forEach((h, i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
        .text(h, colX[i], tableY, { width: colWidths[i], align: headerAligns[i] });
    });

    let rowY = tableY + 22;
    const lineItems = invoice.lineItems || [];

    for (const li of lineItems) {
      // zebra stripe
      if (lineItems.indexOf(li) % 2 === 1) {
        doc.rect(LEFT - 50, rowY - 4, doc.page.width, 22).fill('#fafbfc');
      }
      doc.font('Helvetica').fontSize(10).fillColor(DARK)
        .text(li.description || '', colX[0], rowY, { width: colWidths[0] - 8 });
      doc.text(String(li.quantity ?? 1), colX[1], rowY, { width: colWidths[1], align: 'center' });
      doc.text(fmt(li.unitPrice), colX[2], rowY, { width: colWidths[2], align: 'right' });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
        .text(fmt(li.total), colX[3], rowY, { width: colWidths[3], align: 'right' });
      rowY += 22;
    }

    // Table bottom border
    doc.moveTo(LEFT, rowY).lineTo(RIGHT, rowY).strokeColor(BORDER).lineWidth(1).stroke();
    rowY += 16;

    // ── Totals block ──────────────────────────────────────────────────────────
    const totalsX = RIGHT - 220;
    const totalsLabelW = 130;
    const totalsValueW = 90;

    const totalRows = [
      ['Subtotal', fmt(invoice.subtotal), false],
    ];
    if (invoice.discountAmount > 0) {
      totalRows.push([`Discount`, `-${fmt(invoice.discountAmount)}`, false]);
    }
    totalRows.push([`${invoice.taxType || 'HST'} (${invoice.taxRate || 13}%)`, fmt(invoice.tax), false]);

    // Paid amount
    const totalPaid = (invoice.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const balanceDue = Math.max(0, (invoice.total || 0) - totalPaid);

    for (const [label, value, bold] of totalRows) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(MUTED)
        .text(label + ':', totalsX, rowY, { width: totalsLabelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(DARK)
        .text(value, totalsX + totalsLabelW, rowY, { width: totalsValueW, align: 'right' });
      rowY += 18;
    }

    // Total line
    doc.moveTo(totalsX, rowY).lineTo(RIGHT, rowY).strokeColor(DARK).lineWidth(1.5).stroke();
    rowY += 8;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK)
      .text('Total:', totalsX, rowY, { width: totalsLabelW, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK)
      .text(fmt(invoice.total) + ' CAD', totalsX + totalsLabelW, rowY, { width: totalsValueW, align: 'right' });
    rowY += 22;

    if (invoice.status === 'PAID' || totalPaid > 0) {
      doc.font('Helvetica').fontSize(10).fillColor(GREEN)
        .text('Amount Paid:', totalsX, rowY, { width: totalsLabelW, align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor(GREEN)
        .text(fmt(totalPaid), totalsX + totalsLabelW, rowY, { width: totalsValueW, align: 'right' });
      rowY += 18;

      doc.font('Helvetica-Bold').fontSize(10).fillColor(balanceDue === 0 ? GREEN : RED)
        .text('Balance Due:', totalsX, rowY, { width: totalsLabelW, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(balanceDue === 0 ? GREEN : RED)
        .text(fmt(balanceDue), totalsX + totalsLabelW, rowY, { width: totalsValueW, align: 'right' });
      rowY += 18;
    }

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (invoice.notes) {
      rowY += 16;
      doc.rect(LEFT - 50, rowY - 8, doc.page.width, 1).fill(BORDER);
      rowY += 10;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('NOTES', LEFT, rowY);
      rowY += 14;
      doc.font('Helvetica').fontSize(10).fillColor(DARK)
        .text(invoice.notes, LEFT, rowY, { width: pageWidth });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 70;
    doc.rect(LEFT - 50, footerY - 10, doc.page.width, 1).fill(BORDER);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('Thank you for your business!', LEFT, footerY, { align: 'center', width: pageWidth });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Ashbi Design  ·  Toronto, Ontario, Canada  ·  HST: 123456789 RT 0001  ·  ashbi.ca', LEFT, footerY + 14, { align: 'center', width: pageWidth });

    doc.end();
  });
}
