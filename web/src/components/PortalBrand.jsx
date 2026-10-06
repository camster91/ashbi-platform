// The agency's own name and logo on the public portal pages (issue #531).
// The public API answers each document with `brand: { companyName, logoUrl }`
// for the organization that sent it; without one the pages show nothing
// brand-specific rather than another agency's name.
import { Sparkles } from 'lucide-react';

function brandName(brand) {
  return typeof brand?.companyName === 'string' ? brand.companyName.trim() : '';
}

function brandLogo(brand) {
  return typeof brand?.logoUrl === 'string' && /^https:\/\//i.test(brand.logoUrl) ? brand.logoUrl : '';
}

/**
 * @param {{ brand?: { companyName?: string, logoUrl?: string | null } | null, iconClassName?: string }} props
 */
export default function PortalBrand({ brand, iconClassName = 'w-5 h-5 text-warning' }) {
  const name = brandName(brand);
  const logo = brandLogo(brand);
  if (!name && !logo) return null;
  return (
    <div className="flex items-center gap-3 mb-1" data-testid="portal-brand">
      {logo ? (
        <img src={logo} alt={name ? `${name} logo` : 'Logo'} className="h-8 w-auto max-w-[8rem] object-contain" />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Sparkles className={iconClassName} aria-hidden="true" />
        </div>
      )}
      {name && <span className="text-sm font-medium text-muted-foreground">{name}</span>}
    </div>
  );
}

/** The page footer line naming the agency; nothing without a brand. */
export function PortalBrandFooter({ brand }) {
  const name = brandName(brand);
  if (!name) return null;
  return <p className="text-xs text-muted-foreground">{name}</p>;
}
