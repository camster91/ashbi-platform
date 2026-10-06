// Per-organization branding for client-facing output (issue #531): invoice and
// contract PDFs, proposals, client emails and the public portal pages show the
// agency's own name, never another workspace's.
//
// resolveBranding is read-only. It never creates a BrandSettings row, so
// rendering a document cannot change stored data.

import { headerValue } from '../routes/gmail.routes.js';

/** One-line header text: CR, LF and other control characters removed. */
export { headerValue as sanitizeHeader };

/**
 * The BrandSettings.companyName schema default. getOrCreateBrandSettings used
 * to create rows with it for organizations that never chose it, so a stored
 * value equal to it is only trusted when it is also the organization's name.
 */
export const LEGACY_DEFAULT_COMPANY_NAME = 'Ashbi Design';

/** The product's own name, for system mail with no organization behind it. */
export const PRODUCT_NAME = 'Ashbi Hub';

const BRAND_FIELDS = [
  'email', 'website', 'address', 'phone', 'taxId',
  'invoiceFooter', 'proposalFooter', 'contractHeader', 'primaryColor', 'accentColor',
];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Branding with nothing brand-specific in it (no organization known). */
export function emptyBranding() {
  return {
    companyName: '',
    logoUrl: null,
    email: null,
    website: null,
    address: null,
    phone: null,
    taxId: null,
    invoiceFooter: null,
    proposalFooter: null,
    contractHeader: null,
    primaryColor: null,
    accentColor: null,
  };
}

/**
 * The company name to show for a stored brand row and the organization's name.
 * @param {string | null | undefined} storedName BrandSettings.companyName
 * @param {string | null | undefined} organizationName Organization.name
 */
export function effectiveCompanyName(storedName, organizationName) {
  const stored = text(storedName);
  const orgName = text(organizationName);
  if (!stored) return orgName;
  if (stored === LEGACY_DEFAULT_COMPANY_NAME && orgName && orgName !== stored) return orgName;
  return stored;
}

/**
 * The organization's branding. Never creates a row.
 * @param {any} db a Prisma client (request.prisma or the raw client)
 * @param {string | null | undefined} organizationId
 */
export async function resolveBranding(db, organizationId) {
  const branding = emptyBranding();
  if (!organizationId || !db) return branding;
  const [brand, organization] = await Promise.all([
    db.brandSettings?.findUnique ? db.brandSettings.findUnique({ where: { organizationId } }) : null,
    db.organization?.findUnique
      ? db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logo: true } })
      : null,
  ]);
  branding.companyName = effectiveCompanyName(brand?.companyName, organization?.name);
  branding.logoUrl = text(brand?.logoUrl) || text(organization?.logo) || null;
  for (const field of BRAND_FIELDS) {
    const value = text(brand?.[field]);
    branding[field] = value || null;
  }
  return branding;
}

/**
 * The organization a client belongs to ('' when unknown).
 * @param {any} db
 * @param {string | null | undefined} clientId
 */
export async function organizationIdForClient(db, clientId) {
  if (!clientId || !db?.client?.findUnique) return '';
  const client = await db.client.findUnique({ where: { id: clientId }, select: { organizationId: true } });
  return client?.organizationId || '';
}

/** resolveBranding for the organization that owns a client. */
export async function resolveBrandingForClient(db, clientId) {
  return resolveBranding(db, await organizationIdForClient(db, clientId));
}

/**
 * resolveBranding for the organization that owns a document (an invoice,
 * proposal, contract or estimate row): its own organizationId, its included
 * client's, or its clientId's.
 * @param {any} db
 * @param {{ organizationId?: string | null, clientId?: string | null, client?: { organizationId?: string } | null } | null | undefined} document
 */
export async function resolveBrandingForDocument(db, document) {
  const organizationId = document?.organizationId
    || document?.client?.organizationId
    || await organizationIdForClient(db, document?.clientId);
  return resolveBranding(db, organizationId);
}

/**
 * The small brand block a public (unauthenticated) document response carries:
 * only the name and a logo the browser can load without a staff session (an
 * absolute https URL; stored uploads are staff-only). Null when there is
 * nothing to show.
 * @param {{ companyName?: string, logoUrl?: string | null } | null | undefined} branding
 * @returns {{ companyName: string, logoUrl: string | null } | null}
 */
export function publicBrand(branding) {
  const companyName = text(branding?.companyName);
  const logo = text(branding?.logoUrl);
  const logoUrl = /^https:\/\/[^\s"'<>]+$/i.test(logo) ? logo : null;
  if (!companyName && !logoUrl) return null;
  return { companyName, logoUrl };
}

/**
 * A "From" header value: the display name sanitized (no CR/LF or control
 * characters, no quotes or backslashes) and quoted, with the configured
 * address. An empty display name becomes the product name.
 * @param {string | null | undefined} displayName
 * @param {string} address
 */
export function formatFromHeader(displayName, address) {
  const name = headerValue(displayName).replace(/["\\]/g, '').trim() || PRODUCT_NAME;
  return `"${name}" <${headerValue(address)}>`;
}

/**
 * The From header for mail an organization sends to its clients: the
 * organization's company name at the configured no-reply address.
 * @param {{ companyName?: string } | null | undefined} branding
 * @param {string} mailDomain
 * @param {string} [localPart]
 */
export function brandedSender(branding, mailDomain, localPart = 'noreply') {
  return formatFromHeader(branding?.companyName, `${localPart}@${mailDomain}`);
}

/** The product-named sender for mail with no organization context. */
export function systemSender(mailDomain, localPart = 'noreply') {
  return formatFromHeader(PRODUCT_NAME, `${localPart}@${mailDomain}`);
}

/**
 * An ASCII-safe filename part from a company name ('' when none is left).
 * @param {string | null | undefined} companyName
 */
export function brandSlug(companyName) {
  return text(companyName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
}

/**
 * "<Company>_Proposal_<id>.pdf", or "Proposal_<id>.pdf" without a usable name.
 * @param {string | null | undefined} companyName
 * @param {string} kind e.g. 'Proposal'
 * @param {string | number} id
 */
export function brandedPdfFilename(companyName, kind, id) {
  const slug = brandSlug(companyName);
  const safeId = String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return `${slug ? `${slug}_` : ''}${kind}_${safeId}.pdf`;
}

/** HTML-escape a value for interpolation into an HTML template. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
