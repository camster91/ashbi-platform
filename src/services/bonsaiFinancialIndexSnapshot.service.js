function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nullableDate(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function nullableMoney(value) {
  return value === null || (typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value));
}

function validPagination(capture, operation, count, pagesField = 'pagesFetched') {
  const expectedPages = count === 0 ? 1 : Math.ceil(count / (capture?.pageSize || 1));
  return capture?.connector === 'bonsai'
    && capture?.operation === operation
    && Number.isSafeInteger(capture?.pageSize) && capture.pageSize >= 1 && capture.pageSize <= 100
    && capture?.[pagesField] === expectedPages
    && capture?.finalHasMore === false;
}

export function verifyBonsaiInvoiceIndexSnapshot(snapshot) {
  const findings = [];
  if (snapshot?.format !== 'bonsai-invoice-index-snapshot') findings.push({ code: 'INVALID_FORMAT' });
  if (snapshot?.version !== 1) findings.push({ code: 'UNSUPPORTED_VERSION' });
  if (snapshot?.scope !== 'all' || snapshot?.complete !== true) findings.push({ code: 'INCOMPLETE_SCOPE' });
  if (!validTimestamp(snapshot?.capturedAt)) findings.push({ code: 'INVALID_CAPTURE_TIMESTAMP' });
  if (!Array.isArray(snapshot?.invoices)) findings.push({ code: 'INVOICES_NOT_ARRAY' });
  const invoices = Array.isArray(snapshot?.invoices) ? snapshot.invoices : [];
  if (!validPagination(snapshot?.captureEvidence, 'list_invoices', invoices.length)
    || snapshot?.captureEvidence?.invoiceCount !== invoices.length) findings.push({ code: 'INVALID_PAGINATION_EVIDENCE' });
  const requiredOmissions = ['client_email', 'public_url_token', 'url', 'invoice_items', 'title'];
  if (!requiredOmissions.every(field => snapshot?.privacy?.omittedFields?.includes(field))) findings.push({ code: 'PRIVACY_OMISSIONS_NOT_DECLARED' });
  const ids = new Map();
  invoices.forEach((invoice, index) => {
    const fields = [];
    if (!Number.isSafeInteger(invoice?.id) || invoice.id < 1) fields.push('id');
    if (!(invoice?.invoice_number === null || typeof invoice?.invoice_number === 'string')) fields.push('invoice_number');
    if (!/^[A-Z]{3}$/.test(text(invoice?.currency))) fields.push('currency');
    for (const field of ['issued_date', 'due_date']) if (!nullableDate(invoice?.[field])) fields.push(field);
    if (!text(invoice?.status)) fields.push('status');
    for (const field of ['total_amount', 'subtotal', 'tax_amount', 'discount_amount']) if (!nullableMoney(invoice?.[field])) fields.push(field);
    for (const field of ['project_id', 'company_id']) if (!(invoice?.[field] === null || Number.isSafeInteger(invoice?.[field]))) fields.push(field);
    if (!(invoice?.client_name === null || typeof invoice?.client_name === 'string')) fields.push('client_name');
    if (!validTimestamp(invoice?.created_at)) fields.push('created_at');
    if (requiredOmissions.some(field => Object.hasOwn(invoice ?? {}, field))) fields.push('privacy');
    if (fields.length) findings.push({ code: 'INVALID_INVOICE_INDEX_RECORD', index, fields: [...new Set(fields)].sort() });
    if (Number.isSafeInteger(invoice?.id)) ids.set(invoice.id, [...(ids.get(invoice.id) ?? []), index]);
  });
  for (const [id, indexes] of ids) if (indexes.length > 1) findings.push({ code: 'DUPLICATE_INVOICE_ID', id, indexes });
  const projectless = invoices.filter(invoice => invoice.project_id === null).length;
  return { valid: findings.length === 0, capturedAt: validTimestamp(snapshot?.capturedAt) ? new Date(snapshot.capturedAt).toISOString() : null, invoiceCount: invoices.length, projectlessInvoices: projectless, projectLinkageReady: findings.length === 0 && projectless === 0, findings };
}

export function verifyBonsaiTimeEntryIndexSnapshot(snapshot) {
  const findings = [];
  if (snapshot?.format !== 'bonsai-time-entry-index-snapshot') findings.push({ code: 'INVALID_FORMAT' });
  if (snapshot?.version !== 1) findings.push({ code: 'UNSUPPORTED_VERSION' });
  if (snapshot?.scope !== 'all' || snapshot?.complete !== true) findings.push({ code: 'INCOMPLETE_SCOPE' });
  if (!validTimestamp(snapshot?.capturedAt)) findings.push({ code: 'INVALID_CAPTURE_TIMESTAMP' });
  if (!Array.isArray(snapshot?.time_entries)) findings.push({ code: 'TIME_ENTRIES_NOT_ARRAY' });
  const entries = Array.isArray(snapshot?.time_entries) ? snapshot.time_entries : [];
  if (!validPagination(snapshot?.captureEvidence, 'list_time_entries', entries.length)
    || snapshot?.captureEvidence?.timeEntryCount !== entries.length
    || snapshot?.captureEvidence?.billingFieldsVisible !== true) findings.push({ code: 'INVALID_PAGINATION_OR_BILLING_EVIDENCE' });
  if (!snapshot?.privacy?.omittedFields?.includes('notes')) findings.push({ code: 'PRIVACY_OMISSIONS_NOT_DECLARED' });
  const keys = new Map();
  entries.forEach((entry, index) => {
    const fields = [];
    if (!text(entry?.key)) fields.push('key');
    if (!Number.isSafeInteger(entry?.seconds) || entry.seconds < 0) fields.push('seconds');
    if (!nullableDate(entry?.date) || entry.date === null) fields.push('date');
    if (!nullableMoney(entry?.rate) || !nullableMoney(entry?.billable_amount)) fields.push('money');
    if (!(entry?.non_billable === null || typeof entry?.non_billable === 'boolean')) fields.push('non_billable');
    if (!['billed', 'unbilled', 'non_billable'].includes(entry?.billing_status)) fields.push('billing_status');
    if (!text(entry?.status) || !/^[A-Z]{3}$/.test(text(entry?.currency))) fields.push('status_or_currency');
    if (!(entry?.project_id === null || Number.isSafeInteger(entry?.project_id))) fields.push('project_id');
    if (!(entry?.task_uuid === null || typeof entry?.task_uuid === 'string')) fields.push('task_uuid');
    if (!(entry?.owner_member_id === null || Number.isSafeInteger(entry?.owner_member_id))) fields.push('owner_member_id');
    if (!validTimestamp(entry?.created_at)) fields.push('created_at');
    if (Object.hasOwn(entry ?? {}, 'notes')) fields.push('privacy');
    if (fields.length) findings.push({ code: 'INVALID_TIME_INDEX_RECORD', index, fields: [...new Set(fields)].sort() });
    const key = text(entry?.key);
    if (key) keys.set(key, [...(keys.get(key) ?? []), index]);
  });
  for (const [key, indexes] of keys) if (indexes.length > 1) findings.push({ code: 'DUPLICATE_TIME_ENTRY_KEY', key, indexes });
  const projectless = entries.filter(entry => entry.project_id === null).length;
  return { valid: findings.length === 0, capturedAt: validTimestamp(snapshot?.capturedAt) ? new Date(snapshot.capturedAt).toISOString() : null, timeEntryCount: entries.length, projectlessTimeEntries: projectless, projectLinkageReady: findings.length === 0 && projectless === 0, billingFieldsVisible: snapshot?.captureEvidence?.billingFieldsVisible === true, findings };
}

export function verifyBonsaiFinancialIndexSnapshots(invoiceSnapshot, timeEntrySnapshot) {
  const invoices = verifyBonsaiInvoiceIndexSnapshot(invoiceSnapshot);
  const timeEntries = verifyBonsaiTimeEntryIndexSnapshot(timeEntrySnapshot);
  return {
    valid: invoices.valid && timeEntries.valid,
    projectLinkageReady: invoices.projectLinkageReady && timeEntries.projectLinkageReady,
    invoices,
    timeEntries,
  };
}
