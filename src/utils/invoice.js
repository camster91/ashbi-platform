import prisma from '../config/db.js';

export async function generateInvoiceNumber(prismaClient = prisma) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const lastInvoice = await prismaClient.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' }
  });

  let nextNum = 1;
  if (lastInvoice) {
    const parts = lastInvoice.invoiceNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    nextNum = isNaN(lastNum) ? 1 : lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}
