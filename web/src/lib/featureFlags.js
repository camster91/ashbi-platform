// Feature flags for integration pages
export const FEATURE_FLAGS = {
  upwork: { enabled: false, label: 'Upwork', comingSoon: true },
  shopify: { enabled: false, label: 'Shopify', comingSoon: true },
  'cold-email': { enabled: false, label: 'Cold Email', comingSoon: true },
  'email-triage': { enabled: false, label: 'Email Triage', comingSoon: true },
  'outreach-scheduler': { enabled: false, label: 'Outreach Scheduler', comingSoon: true },
};

export function isEnabled(key) {
  return FEATURE_FLAGS[key]?.enabled ?? true;
}

export function isComingSoon(key) {
  return FEATURE_FLAGS[key]?.comingSoon ?? false;
}
